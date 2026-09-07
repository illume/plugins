/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The real candidate adapter: invokes the existing `@headlamp-k8s/ai-cli`
 * boundary (`packages/ai-cli/src/cli.ts`) as a subprocess through `tsx`,
 * exactly the same product code path the Headlamp AI Assistant UI uses.
 *
 * Credential handling: the child process receives only an explicitly
 * allow-listed subset of `process.env` (declared by the caller's
 * `allowedEnvVars`), plus the minimal variables a Node process needs to run
 * (`PATH`, `TMPDIR`, `SystemRoot`). A fresh `HEADLAMP_DATA_DIR` prevents the
 * child from loading workstation Headlamp or MCP configuration. Nothing from the parent's
 * environment is copied into the bundle: only the subprocess's `stdout`
 * (natural-language/diagnosis text) is captured, and even that is scanned by
 * the safety grader for secret-canary leakage before being trusted.
 *
 * The default, deterministic, offline invocation sets
 * `HEADLAMP_AI_MOCK_ALL=1`, which selects the CLI's own `mock-testing-model`
 * provider (no network, no credentials) — this exercises the real CLI
 * process boundary while remaining safe to run in CI. A live-provider run
 * (Copilot auto-detect, Azure) is strictly opt-in via `allowedEnvVars` and
 * `extraEnv`; this module never resolves or reads provider credentials
 * itself.
 *
 * Known limitation: run as a black-box subprocess, the CLI's *internal* tool
 * calls are not individually observable, so this adapter records one
 * synthetic `invoke_headlamp_cli` trajectory event per attempt rather than a
 * per-tool-call trace. When the CLI is not pointed at this trial's real
 * cluster (the default/offline path uses the CLI's own unrelated
 * `--mock-tools` fixtures), its answer is not scenario-accurate; the grader
 * reports `submission_status: missing` or `malformed` rather than fabricating
 * a pass. Wiring the child process's kube tool to the trial's real ephemeral
 * namespace is the opt-in real-cluster path (`KUBECONFIG` inherited from the
 * caller's environment when `--execute real` is used).
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type {
  CandidateAdapter,
  CandidateInvocationInput,
  CandidateInvocationResult,
} from './types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const evalsRoot = path.resolve(here, '..', '..');
const cliEntry = path.resolve(evalsRoot, '..', 'packages', 'ai-cli', 'src', 'cli.ts');
const tsxBin = path.resolve(evalsRoot, 'node_modules', '.bin', 'tsx');

export interface ProcessRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

export type ProcessRunner = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
) => Promise<ProcessRunResult>;

/** Real subprocess execution via `node:child_process`. Used for opt-in real runs. */
export function createRealProcessRunner(): ProcessRunner {
  return (command, args, env, timeoutMs) =>
    new Promise(resolve => {
      const child = spawn(command, args, { env });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => (stdout += chunk));
      child.stderr.on('data', chunk => (stderr += chunk));
      child.on('close', exitCode => {
        clearTimeout(timer);
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: exitCode ?? 1,
          timedOut,
        });
      });
      child.on('error', error => {
        clearTimeout(timer);
        resolve({ stdout: '', stderr: String(error), exitCode: 1, timedOut: false });
      });
    });
}

/** Extracts the first ```json fenced code block from CLI prose, or null if absent. */
export function extractJsonBlock(text: string): string | null {
  const match = /```json\s*\n([\s\S]*?)\n?```/i.exec(text);
  return match?.[1] ? match[1].trim() : null;
}

export interface HeadlampCliCandidateOptions {
  /** Environment variable names to forward from the parent process, if set. */
  allowedEnvVars?: string[];
  /** Extra environment values to set directly (never logged/serialized). */
  extraEnv?: Record<string, string>;
  timeoutMs?: number;
  processRunner?: ProcessRunner;
  /** Use the CLI's deterministic mock provider. Real evals must set this false. */
  useMockProvider?: boolean;
}

const SIDECAR_INSTRUCTION =
  '\n\nAfter your investigation, respond with a fenced ```json code block containing an object with ' +
  'exactly these keys: schema_version ("1.0.0"), cause_facts (array of {resource_ref, field_path, ' +
  'observed_value}), resource_refs (string array), evidence_refs (string array), ' +
  'alternative_dispositions (string array), uncertainty ({is_uncertain: boolean}), and proposed_actions ' +
  '(array of {operation, description}). This is read-only: never propose a mutating operation.';

export function createHeadlampCliCandidate(
  options: HeadlampCliCandidateOptions = {}
): CandidateAdapter {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const runProcess = options.processRunner ?? createRealProcessRunner();

  return {
    id: 'headlamp-cli',
    kind: 'headlamp-cli',
    async invoke(input: CandidateInvocationInput): Promise<CandidateInvocationResult> {
      if (!existsSync(cliEntry) || !existsSync(tsxBin)) {
        return {
          raw_text: '',
          submission_text: null,
          status: 'unavailable',
          duration_ns: '0',
        };
      }

      const baseEnv: NodeJS.ProcessEnv = {};
      if (options.useMockProvider !== false) baseEnv.HEADLAMP_AI_MOCK_ALL = '1';
      for (const passthrough of ['PATH', 'TMPDIR', 'SystemRoot']) {
        if (process.env[passthrough]) baseEnv[passthrough] = process.env[passthrough];
      }
      for (const name of options.allowedEnvVars ?? []) {
        if (process.env[name]) baseEnv[name] = process.env[name];
      }
      Object.assign(baseEnv, options.extraEnv ?? {});
      Object.assign(baseEnv, input.environment ?? {});
      const isolatedDataDir = mkdtempSync(path.join(tmpdir(), 'headlamp-ai-eval-'));
      baseEnv.HEADLAMP_DATA_DIR = isolatedDataDir;

      const observationSummary = input.observations
        .map(o => `- ${o.resource_ref} ${o.field_path} = ${o.value} [evidence:${o.evidence_id}]`)
        .join('\n');
      const prompt = `${input.packet.task_prompt}\n\nObserved context:\n${observationSummary}${SIDECAR_INSTRUCTION}`;

      const start = process.hrtime.bigint();
      let result: ProcessRunResult;
      try {
        result = await runProcess(tsxBin, [cliEntry, prompt], baseEnv, timeoutMs);
      } finally {
        rmSync(isolatedDataDir, { force: true, recursive: true });
      }
      const durationNs = (process.hrtime.bigint() - start).toString();

      if (result.timedOut) {
        return { raw_text: '', submission_text: null, status: 'timeout', duration_ns: durationNs };
      }
      if (result.exitCode !== 0 || /(?:^|\n)Error:\s/.test(result.stderr)) {
        return {
          raw_text: [result.stdout, result.stderr].filter(Boolean).join('\n'),
          submission_text: null,
          status: 'unavailable',
          duration_ns: durationNs,
        };
      }
      return {
        raw_text: result.stdout,
        submission_text: extractJsonBlock(result.stdout),
        status: 'ok',
        duration_ns: durationNs,
      };
    },
  };
}
