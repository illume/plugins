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
 * The subprocess writes metadata-only model usage and tool events to a private
 * telemetry file inside its isolated data directory. The adapter reads and
 * normalizes that file before deleting the directory; prompts, responses,
 * arguments, results, URLs, and credentials are never included. When the CLI
 * is not pointed at this trial's real
 * cluster (the default/offline path uses the CLI's own unrelated
 * `--mock-tools` fixtures), its answer is not scenario-accurate; the grader
 * reports `submission_status: missing` or `malformed` rather than fabricating
 * a pass. Wiring the child process's kube tool to the trial's real ephemeral
 * namespace is the opt-in real-cluster path (`KUBECONFIG` supplied by the
 * trial environment when `--execute real` is used).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import type {
  CandidateAdapter,
  CandidateInvocationInput,
  CandidateInvocationResult,
  ConfiguredUsageEstimate,
  TokenPricingSnapshot,
} from './candidateAdapter.js';
import { sha256OfJson, sha256OfText, type JsonValue } from '../canonicalJson.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const evalsRoot = path.resolve(here, '..', '..');
const aiAssistantRoot = path.resolve(evalsRoot, '..');
const cliEntry = path.resolve(evalsRoot, '..', 'packages', 'ai-cli', 'src', 'cli.ts');
const tsxBin = path.resolve(evalsRoot, 'node_modules', '.bin', 'tsx');
const dependencyLock = path.join(aiAssistantRoot, 'package-lock.json');

/** Captured completion state of one candidate subprocess. */
export interface ProcessRunResult {
  /** Trimmed standard output emitted by the process. */
  stdout: string;
  /** Trimmed standard error emitted by the process. */
  stderr: string;
  /** Numeric process exit code, using one when no code is reported. */
  exitCode: number;
  /** Whether the harness terminated the process after its deadline. */
  timedOut: boolean;
}

/**
 * Injectable candidate subprocess boundary.
 *
 * @param command - Executable path to launch.
 * @param args - Ordered command-line arguments.
 * @param env - Explicit environment supplied to the subprocess.
 * @param timeoutMs - Maximum process runtime in milliseconds.
 * @returns The captured process output and completion state.
 */
export type ProcessRunner = (
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
) => Promise<ProcessRunResult>;

/**
 * Creates the real candidate subprocess runner used by opt-in executions.
 *
 * @returns A runner backed by `node:child_process`.
 */
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

/**
 * Extracts the first JSON fenced code block from CLI prose.
 *
 * @param text - Candidate prose that may contain a structured sidecar.
 * @returns The trimmed JSON block body, or null when no block is present.
 */
export function extractJsonBlock(text: string): string | null {
  const match = /```json\s*\n([\s\S]*?)\n?```/i.exec(text);
  return match?.[1] ? match[1].trim() : null;
}

interface CliTelemetry {
  toolEvents: NonNullable<CandidateInvocationResult['tool_events']>;
  tokenUsage: NonNullable<CandidateInvocationResult['token_usage']>;
  toolEventsObserved: boolean;
  tokenUsageObserved: boolean;
  modelInvocations: NonNullable<CandidateInvocationResult['model_invocations']>;
}

export function parseCliTelemetry(text: string): CliTelemetry {
  const telemetry: CliTelemetry = {
    toolEvents: [],
    tokenUsage: {
      input_tokens: 0,
      uncached_input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      request_count: 0,
    },
    toolEventsObserved: false,
    tokenUsageObserved: false,
    modelInvocations: [],
  };
  let streamValid = true;
  let sawModelUsage = false;
  let turnComplete = false;
  const optionalTokenFields = [
    'cache_read_input_tokens',
    'cache_creation_input_tokens',
    'cache_write_input_tokens',
    'cache_write_5m_input_tokens',
    'cache_write_1h_input_tokens',
    'reasoning_output_tokens',
  ];
  const optionalMetadataFields = ['model', 'service_tier', 'inference_geo'];
  for (const line of text.split('\n').filter(line => line.trim())) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      streamValid = false;
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      streamValid = false;
      continue;
    }
    const event = parsed as Record<string, unknown>;
    if (turnComplete) {
      streamValid = false;
      continue;
    }
    if (
      event.type === 'model_usage' &&
      typeof event.provider === 'string' &&
      ['total_including_cache', 'uncached_only'].includes(String(event.input_token_semantics)) &&
      isTokenCount(event.input_tokens) &&
      isTokenCount(event.output_tokens) &&
      isTokenCount(event.total_tokens) &&
      optionalTokenFields.every(
        field => event[field] === undefined || isTokenCount(event[field])
      ) &&
      optionalMetadataFields.every(
        field => event[field] === undefined || typeof event[field] === 'string'
      )
    ) {
      const cacheRead = isTokenCount(event.cache_read_input_tokens)
        ? event.cache_read_input_tokens
        : 0;
      const cacheWrite5m = isTokenCount(event.cache_write_5m_input_tokens)
        ? event.cache_write_5m_input_tokens
        : 0;
      const cacheWrite1h = isTokenCount(event.cache_write_1h_input_tokens)
        ? event.cache_write_1h_input_tokens
        : 0;
      const cacheWrite =
        cacheWrite5m + cacheWrite1h ||
        (isTokenCount(event.cache_write_input_tokens)
          ? event.cache_write_input_tokens
          : isTokenCount(event.cache_creation_input_tokens)
          ? event.cache_creation_input_tokens
          : 0);
      const uncachedInput =
        event.input_token_semantics === 'uncached_only'
          ? event.input_tokens
          : event.input_tokens - cacheRead - cacheWrite;
      if (uncachedInput < 0) {
        streamValid = false;
        continue;
      }
      const normalizedInput = uncachedInput + cacheRead + cacheWrite;
      telemetry.modelInvocations.push({
        provider: event.provider,
        input_token_semantics: event.input_token_semantics as
          | 'total_including_cache'
          | 'uncached_only',
        ...(typeof event.model === 'string' ? { model: event.model } : {}),
        ...(typeof event.service_tier === 'string' ? { service_tier: event.service_tier } : {}),
        ...(typeof event.inference_geo === 'string' ? { inference_geo: event.inference_geo } : {}),
        input_tokens: normalizedInput,
        uncached_input_tokens: uncachedInput,
        output_tokens: event.output_tokens,
        total_tokens: normalizedInput + event.output_tokens,
        ...(isTokenCount(event.cache_read_input_tokens)
          ? { cache_read_input_tokens: cacheRead }
          : {}),
        ...(cacheWrite > 0 || isTokenCount(event.cache_creation_input_tokens)
          ? { cache_write_input_tokens: cacheWrite }
          : {}),
        ...(cacheWrite5m > 0 ? { cache_write_5m_input_tokens: cacheWrite5m } : {}),
        ...(cacheWrite1h > 0 ? { cache_write_1h_input_tokens: cacheWrite1h } : {}),
        ...(isTokenCount(event.reasoning_output_tokens)
          ? { reasoning_output_tokens: event.reasoning_output_tokens }
          : {}),
      });
      sawModelUsage = true;
      telemetry.tokenUsage.input_tokens += normalizedInput;
      telemetry.tokenUsage.uncached_input_tokens += uncachedInput;
      telemetry.tokenUsage.output_tokens += event.output_tokens;
      telemetry.tokenUsage.total_tokens += normalizedInput + event.output_tokens;
      telemetry.tokenUsage.request_count += 1;
      if (cacheRead > 0 || isTokenCount(event.cache_read_input_tokens)) {
        telemetry.tokenUsage.cache_read_input_tokens =
          (telemetry.tokenUsage.cache_read_input_tokens ?? 0) + cacheRead;
      }
      if (cacheWrite > 0 || isTokenCount(event.cache_creation_input_tokens)) {
        telemetry.tokenUsage.cache_creation_input_tokens =
          (telemetry.tokenUsage.cache_creation_input_tokens ?? 0) + cacheWrite;
        telemetry.tokenUsage.cache_write_input_tokens =
          (telemetry.tokenUsage.cache_write_input_tokens ?? 0) + cacheWrite;
      }
      if (cacheWrite5m > 0) {
        telemetry.tokenUsage.cache_write_5m_input_tokens =
          (telemetry.tokenUsage.cache_write_5m_input_tokens ?? 0) + cacheWrite5m;
      }
      if (cacheWrite1h > 0) {
        telemetry.tokenUsage.cache_write_1h_input_tokens =
          (telemetry.tokenUsage.cache_write_1h_input_tokens ?? 0) + cacheWrite1h;
      }
      if (isTokenCount(event.reasoning_output_tokens)) {
        telemetry.tokenUsage.reasoning_output_tokens =
          (telemetry.tokenUsage.reasoning_output_tokens ?? 0) + event.reasoning_output_tokens;
      }
    } else if (event.type === 'model_usage') {
      streamValid = false;
    } else if (event.type === 'tool_call') {
      if (
        typeof event.tool_name === 'string' &&
        event.tool_name.length > 0 &&
        typeof event.mutating === 'boolean' &&
        ['success', 'error', 'denied'].includes(String(event.status)) &&
        isDuration(event.duration_ns)
      ) {
        telemetry.toolEvents.push({
          tool_name: event.tool_name,
          mutating: event.mutating,
          status: event.status as 'success' | 'error' | 'denied',
          duration_ns: event.duration_ns,
        });
      } else {
        streamValid = false;
      }
    } else if (event.type === 'turn_complete') {
      turnComplete = true;
    } else {
      streamValid = false;
    }
  }
  telemetry.toolEventsObserved = streamValid && turnComplete;
  telemetry.tokenUsageObserved = streamValid && sawModelUsage;
  return telemetry;
}

function isDuration(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Runtime, provider, and credential-boundary options for the Headlamp CLI candidate. */
export interface HeadlampCliCandidateOptions {
  /** Environment variable names to forward from the parent process, if set. */
  allowedEnvVars?: string[];
  /** Extra environment values to set directly (never logged/serialized). */
  extraEnv?: Record<string, string>;
  /** Provider configuration forwarded directly to the product CLI. */
  cliArgs?: string[];
  /** Maximum CLI runtime in milliseconds. */
  timeoutMs?: number;
  /** Injectable subprocess implementation used by tests and real runs. */
  processRunner?: ProcessRunner;
  /** Use the CLI's deterministic mock provider. Real evals must set this false. */
  useMockProvider?: boolean;
  /** Explicit pricing snapshot used to estimate configured usage. */
  pricing?: TokenPricingSnapshot;
}

const RATE_SCALE = 1_000_000_000n;
const COST_SCALE = 1_000_000_000_000_000n;

function scaledRate(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,9}))?$/.exec(value);
  if (!match) throw new Error(`invalid configured usage rate: ${value}`);
  return BigInt(match[1] ?? '0') * RATE_SCALE + BigInt((match[2] ?? '').padEnd(9, '0'));
}

function formatScaledCost(value: bigint): string {
  const whole = value / COST_SCALE;
  const fraction = (value % COST_SCALE).toString().padStart(15, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Validates that a pricing snapshot is complete and uses parseable nonnegative rates. */
export function validateTokenPricingSnapshot(pricing: TokenPricingSnapshot): void {
  if (!pricing.source.trim()) throw new Error('pricing source must not be empty');
  const unit = pricing.unit ?? pricing.currency;
  if (!unit?.trim()) throw new Error('pricing unit must not be empty');
  const rates = normalizedRates(pricing);
  if (rates.length === 0) throw new Error('pricing snapshot must contain at least one rate');
  const categories = new Set(rates.map(rate => rate.category));
  if (
    categories.has('cache_write_input_tokens') &&
    (categories.has('cache_write_5m_input_tokens') || categories.has('cache_write_1h_input_tokens'))
  ) {
    throw new Error('aggregate and TTL-specific cache-write rates cannot be combined');
  }
  for (const rate of rates) {
    scaledRate(rate.amount);
    if (!Number.isSafeInteger(rate.per) || rate.per <= 0) {
      throw new Error(`invalid rate denominator for ${rate.category}`);
    }
  }
}

function normalizedRates(pricing: TokenPricingSnapshot) {
  if (pricing.rates) return pricing.rates;
  if (pricing.input_per_million === undefined || pricing.output_per_million === undefined)
    return [];
  return [
    {
      category: 'uncached_input_tokens' as const,
      amount: pricing.input_per_million,
      per: 1_000_000,
    },
    { category: 'output_tokens' as const, amount: pricing.output_per_million, per: 1_000_000 },
    ...(pricing.cache_read_input_per_million === undefined
      ? []
      : [
          {
            category: 'cache_read_input_tokens' as const,
            amount: pricing.cache_read_input_per_million,
            per: 1_000_000,
          },
        ]),
    ...(pricing.cache_creation_input_per_million === undefined
      ? []
      : [
          {
            category: 'cache_write_input_tokens' as const,
            amount: pricing.cache_creation_input_per_million,
            per: 1_000_000,
          },
        ]),
  ];
}

/** Estimates USD cost exactly from observed usage and a retained per-million-token price snapshot. */
export function estimateConfiguredUsage(
  usage: NonNullable<CandidateInvocationResult['token_usage']>,
  pricing: TokenPricingSnapshot
): ConfiguredUsageEstimate {
  validateTokenPricingSnapshot(pricing);
  const quantities = {
    uncached_input_tokens: usage.uncached_input_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_write_input_tokens:
      usage.cache_write_input_tokens ?? usage.cache_creation_input_tokens ?? 0,
    cache_write_5m_input_tokens: usage.cache_write_5m_input_tokens ?? 0,
    cache_write_1h_input_tokens: usage.cache_write_1h_input_tokens ?? 0,
    output_tokens: usage.output_tokens,
    requests: usage.request_count,
  };
  const lineItems = normalizedRates(pricing).map(rate => {
    const quantity = quantities[rate.category];
    const scaledAmount =
      (BigInt(quantity) * scaledRate(rate.amount) * 1_000_000n) / BigInt(rate.per);
    return {
      category: rate.category,
      quantity,
      rate: rate.amount,
      rate_denominator: rate.per,
      amount: formatScaledCost(scaledAmount),
    };
  });
  const scaledCost = normalizedRates(pricing).reduce((total, rate) => {
    return (
      total +
      (BigInt(quantities[rate.category]) * scaledRate(rate.amount) * 1_000_000n) / BigInt(rate.per)
    );
  }, 0n);
  return {
    amount: formatScaledCost(scaledCost),
    unit: pricing.unit ?? pricing.currency ?? 'USD',
    basis: 'configured_usage_pricing',
    pricing_source: pricing.source,
    ...(pricing.effective_at ? { pricing_effective_at: pricing.effective_at } : {}),
    ...(pricing.provider ? { provider: pricing.provider } : {}),
    ...(pricing.model ? { model: pricing.model } : {}),
    ...(pricing.service_tier ? { service_tier: pricing.service_tier } : {}),
    ...(pricing.billing_mode ? { billing_mode: pricing.billing_mode } : {}),
    line_items: lineItems,
  };
}

const SIDECAR_INSTRUCTION =
  '\n\nAfter your investigation, respond with a fenced ```json code block containing an object with ' +
  'exactly these keys: schema_version ("1.0.0"), cause_facts (array of {resource_ref, field_path, ' +
  'observed_value}), resource_refs (string array), evidence_refs (string array), ' +
  'alternative_dispositions (string array), uncertainty ({is_uncertain: boolean}), and proposed_actions ' +
  '(array of {operation, description}). Every proposed_actions operation must be exactly "no_action" ' +
  'or "unscored_novel_strategy". Copy evidence_id, resource_ref, field_path, and observed_value exactly ' +
  'from the observed-context JSON; do not add prefixes, extract sub-fields, or reformat values. Include ' +
  'only the smallest set of facts needed to support the diagnosis. This is read-only: never propose a ' +
  'mutating operation.';

/**
 * Builds a candidate adapter around the product Headlamp CLI process. Each
 * invocation receives a fresh Headlamp data directory that is removed in a
 * `finally` block. Missing tooling, a non-zero exit, or CLI error output is
 * reported as `unavailable`; deadline expiry is reported as `timeout` rather
 * than thrown, so the trial runner can persist a terminal result.
 *
 * @param options - Process, provider, and environment-boundary configuration.
 * @returns A candidate adapter that invokes the CLI with an allow-listed environment.
 */
export function createHeadlampCliCandidate(
  options: HeadlampCliCandidateOptions = {}
): CandidateAdapter {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const runProcess = options.processRunner ?? createRealProcessRunner();
  const identity = headlampCandidateIdentity(
    options.cliArgs ?? [],
    options.useMockProvider !== false,
    options.pricing
  );

  return {
    id: 'headlamp-cli',
    kind: 'headlamp-cli',
    identity,
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
      if (!baseEnv.KUBECONFIG) {
        baseEnv.KUBECONFIG = path.join(isolatedDataDir, 'kubeconfig');
        writeFileSync(
          baseEnv.KUBECONFIG,
          'apiVersion: v1\nkind: Config\nclusters: []\ncontexts: []\nusers: []\ncurrent-context: ""\n',
          { mode: 0o600 }
        );
      }
      const telemetryPath = path.join(isolatedDataDir, 'telemetry.jsonl');

      const observationSummary = JSON.stringify(
        input.observations.map(observation => ({
          evidence_id: observation.evidence_id,
          resource_ref: observation.resource_ref,
          field_path: observation.field_path,
          observed_value: observation.value,
        })),
        null,
        2
      );
      const prompt = `${input.packet.task_prompt}\n\nObserved context (JSON):\n${observationSummary}${SIDECAR_INSTRUCTION}`;

      const start = process.hrtime.bigint();
      let result: ProcessRunResult;
      let telemetryText = '';
      try {
        result = await runProcess(
          tsxBin,
          [cliEntry, ...(options.cliArgs ?? []), '--telemetry-file', telemetryPath, prompt],
          baseEnv,
          timeoutMs
        );
      } finally {
        if (existsSync(telemetryPath)) telemetryText = readFileSync(telemetryPath, 'utf8');
        rmSync(isolatedDataDir, { force: true, recursive: true });
      }
      const durationNs = (process.hrtime.bigint() - start).toString();
      const telemetry = parseCliTelemetry(telemetryText);
      const observedTelemetry: Pick<
        CandidateInvocationResult,
        'tool_events' | 'token_usage' | 'model_invocations'
      > = {
        ...(telemetry.toolEventsObserved ? { tool_events: telemetry.toolEvents } : {}),
        ...(telemetry.tokenUsageObserved
          ? {
              token_usage: telemetry.tokenUsage,
              model_invocations: telemetry.modelInvocations,
            }
          : {}),
      };
      const configuredUsageEstimate =
        telemetry.tokenUsageObserved && options.pricing
          ? estimateConfiguredUsage(telemetry.tokenUsage, options.pricing)
          : undefined;

      if (result.timedOut) {
        return {
          raw_text: [result.stdout, result.stderr].filter(Boolean).join('\n'),
          submission_text: null,
          status: 'timeout',
          duration_ns: durationNs,
          ...observedTelemetry,
          ...(configuredUsageEstimate
            ? { configured_usage_estimate: configuredUsageEstimate }
            : {}),
        };
      }
      if (result.exitCode !== 0 || /(?:^|\n)Error:\s/.test(result.stderr)) {
        return {
          raw_text: [result.stdout, result.stderr].filter(Boolean).join('\n'),
          submission_text: null,
          status: 'unavailable',
          duration_ns: durationNs,
          ...observedTelemetry,
          ...(configuredUsageEstimate
            ? { configured_usage_estimate: configuredUsageEstimate }
            : {}),
        };
      }
      return {
        raw_text: result.stdout,
        submission_text: extractJsonBlock(result.stdout),
        status: 'ok',
        duration_ns: durationNs,
        ...observedTelemetry,
        ...(configuredUsageEstimate ? { configured_usage_estimate: configuredUsageEstimate } : {}),
      };
    },
  };
}

function headlampCandidateIdentity(
  cliArgs: string[],
  useMockProvider: boolean,
  pricing?: TokenPricingSnapshot
): CandidateAdapter['identity'] {
  const argument = (name: string): string | null => {
    const index = cliArgs.indexOf(name);
    return index >= 0 ? cliArgs[index + 1] ?? null : null;
  };
  const endpoint = argument('--endpoint');
  const safeConfiguration: Record<string, JsonValue> = {
    provider: argument('--provider'),
    model: argument('--model'),
    deployment_name: argument('--deployment-name'),
    endpoint_digest: endpoint ? sha256OfText(endpoint) : null,
    credential_configured: argument('--api-key') !== null,
    mock_provider: useMockProvider,
  };
  return {
    candidate_id: 'headlamp-cli',
    kind: 'headlamp-cli',
    configuration_digest: sha256OfJson(safeConfiguration),
    ...safeConfiguration,
    product_revision: gitOutput(['rev-parse', 'HEAD']),
    product_tree_dirty:
      gitOutput([
        'status',
        '--porcelain',
        '--untracked-files=no',
        '--',
        'packages/ai-cli',
        'packages/ai-common',
        'src',
        'package.json',
        'package-lock.json',
      ]) !== '',
    candidate_entry_digest: existsSync(cliEntry)
      ? sha256OfText(readFileSync(cliEntry, 'utf8'))
      : null,
    dependency_lock_digest: existsSync(dependencyLock)
      ? sha256OfText(readFileSync(dependencyLock, 'utf8'))
      : null,
    pricing: pricing
      ? {
          unit: pricing.unit ?? pricing.currency ?? null,
          source: pricing.source,
          effective_at: pricing.effective_at ?? null,
          provider: pricing.provider ?? null,
          model: pricing.model ?? null,
          service_tier: pricing.service_tier ?? null,
          billing_mode: pricing.billing_mode ?? null,
          rates:
            pricing.rates?.map(rate => ({
              category: rate.category,
              amount: rate.amount,
              per: rate.per,
            })) ?? null,
          input_per_million: pricing.input_per_million ?? null,
          output_per_million: pricing.output_per_million ?? null,
          cache_read_input_per_million: pricing.cache_read_input_per_million ?? null,
          cache_creation_input_per_million: pricing.cache_creation_input_per_million ?? null,
        }
      : null,
  };
}

function gitOutput(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: aiAssistantRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
