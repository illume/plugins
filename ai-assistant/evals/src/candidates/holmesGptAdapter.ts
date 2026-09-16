/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import {
  ContainerReferenceAdapter,
  type ContainerReferenceAdapterOptions,
} from './containerReferenceAdapter.js';
import { sha256OfJson } from '../canonicalJson.js';
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { CommandResult } from '../cluster/commandRunner.js';
import type {
  CandidateAdapter,
  CandidateInvocationInput,
  CandidateInvocationResult,
} from './candidateAdapter.js';

export const HOLMES_GPT_IMAGE =
  'us-central1-docker.pkg.dev/genuine-flight-317411/devel/holmes@sha256:17b036cb13ae0b2e7f00b87cca4054a03edeaf9296a49dccdcdce898d09e1447';

export interface HolmesGptCandidateOptions extends ContainerReferenceAdapterOptions {
  model: string;
}

interface HolmesMachineOutput {
  result?: unknown;
  total_tokens?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  cached_tokens?: unknown;
  cache_creation_tokens?: unknown;
  reasoning_tokens?: unknown;
  num_llm_calls?: unknown;
}

type HolmesTelemetry = Pick<CandidateInvocationResult, 'token_usage' | 'model_invocations'>;

function isTokenCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function parseHolmesTelemetry(
  output: HolmesMachineOutput,
  configuredModel: string
): HolmesTelemetry {
  if (
    !isTokenCount(output.prompt_tokens) ||
    !isTokenCount(output.completion_tokens) ||
    !isTokenCount(output.total_tokens) ||
    !isTokenCount(output.num_llm_calls)
  ) {
    return {};
  }
  const cacheRead = isTokenCount(output.cached_tokens) ? output.cached_tokens : 0;
  const cacheWrite = isTokenCount(output.cache_creation_tokens) ? output.cache_creation_tokens : 0;
  const uncachedInput = output.prompt_tokens - cacheRead - cacheWrite;
  if (
    uncachedInput < 0 ||
    output.total_tokens !== output.prompt_tokens + output.completion_tokens
  ) {
    return {};
  }
  const tokenUsage: NonNullable<CandidateInvocationResult['token_usage']> = {
    input_tokens: output.prompt_tokens,
    uncached_input_tokens: uncachedInput,
    output_tokens: output.completion_tokens,
    total_tokens: output.total_tokens,
    request_count: output.num_llm_calls,
    ...(isTokenCount(output.cached_tokens) ? { cache_read_input_tokens: cacheRead } : {}),
    ...(isTokenCount(output.cache_creation_tokens)
      ? {
          cache_creation_input_tokens: cacheWrite,
          cache_write_input_tokens: cacheWrite,
        }
      : {}),
    ...(isTokenCount(output.reasoning_tokens)
      ? { reasoning_output_tokens: output.reasoning_tokens }
      : {}),
  };
  if (output.num_llm_calls !== 1) return { token_usage: tokenUsage };

  const separator = configuredModel.indexOf('/');
  const provider = separator > 0 ? configuredModel.slice(0, separator) : 'holmesgpt';
  const model = separator > 0 ? configuredModel.slice(separator + 1) : configuredModel;
  return {
    token_usage: tokenUsage,
    model_invocations: [
      {
        provider,
        model,
        input_token_semantics: 'total_including_cache',
        input_tokens: output.prompt_tokens,
        uncached_input_tokens: uncachedInput,
        output_tokens: output.completion_tokens,
        total_tokens: output.total_tokens,
        ...(isTokenCount(output.cached_tokens) ? { cache_read_input_tokens: cacheRead } : {}),
        ...(isTokenCount(output.cache_creation_tokens)
          ? { cache_write_input_tokens: cacheWrite }
          : {}),
        ...(isTokenCount(output.reasoning_tokens)
          ? { reasoning_output_tokens: output.reasoning_tokens }
          : {}),
      },
    ],
  };
}

export const diagnosisInstruction = `Return a fenced \`\`\`json block containing exactly: schema_version
("1.0.0"), cause_facts (array of {resource_ref, field_path, observed_value}), resource_refs
(string array), evidence_refs (string array), alternative_dispositions (string array), uncertainty
({is_uncertain: boolean, optional reason string}), and proposed_actions (array of {operation,
description}). If uncertainty.reason is not a string, omit it; never return null for optional fields.
Copy facts and evidence IDs exactly from Observed context. proposed_actions.operation must be
"no_action" or "unscored_novel_strategy". Do not call tools or mutate anything.`;

/** Digest-pinned HolmesGPT qualification adapter. */
export class HolmesGptAdapter extends ContainerReferenceAdapter {
  readonly system = 'holmesgpt' as const;

  constructor(options: ContainerReferenceAdapterOptions) {
    super(options);
  }

  protected healthCommand(): string[] {
    return ['ask', '--help'];
  }

  protected normalizeNativeOutput(
    _input: CandidateInvocationInput,
    nativeOutput: string
  ): string | null {
    return /```json\s*\n([\s\S]*?)\n?```/i.exec(nativeOutput)?.[1]?.trim() ?? null;
  }

  extractSubmission(nativeOutput: string): string | null {
    const fenced = /```json\s*\n([\s\S]*?)\n?```/i.exec(nativeOutput)?.[1]?.trim();
    if (fenced) return fenced;
    try {
      const parsed = JSON.parse(nativeOutput.trim()) as unknown;
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? nativeOutput.trim()
        : null;
    } catch {
      return null;
    }
  }

  runCandidate(
    prompt: string,
    model: string
  ): CommandResult & { machineResult: string; telemetry: HolmesTelemetry } {
    const outputDirectory = mkdtempSync(path.join(process.cwd(), '.holmes-eval-'));
    chmodSync(outputDirectory, 0o733);
    const outputPath = path.join(outputDirectory, 'result.json');
    try {
      const result = this.runner('docker', [
        'run',
        '--rm',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=32m',
        '--tmpfs',
        '/root/.holmes:rw,noexec,nosuid,size=16m',
        '--env',
        'AZURE_API_KEY',
        '--env',
        'AZURE_API_BASE',
        '--env',
        'AZURE_API_VERSION',
        '--volume',
        `${outputDirectory}:/output`,
        this.options.image,
        'ask',
        prompt,
        '--model',
        model,
        '--max-steps',
        '1',
        '--no-interactive',
        '--no-echo',
        '--json-output-file',
        '/output/result.json',
      ]);
      const machineOutput =
        result.status === 0
          ? (JSON.parse(readFileSync(outputPath, 'utf8')) as HolmesMachineOutput)
          : {};
      return {
        ...result,
        machineResult: String(machineOutput.result ?? ''),
        telemetry: parseHolmesTelemetry(machineOutput, model),
      };
    } finally {
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  }
}

/** Creates the real observation-only HolmesGPT candidate used by Phase 2 comparisons. */
export function createHolmesGptCandidate(options: HolmesGptCandidateOptions): CandidateAdapter {
  const adapter = new HolmesGptAdapter(options);
  return {
    id: 'holmesgpt',
    kind: 'reference-system',
    identity: {
      candidate_id: 'holmesgpt',
      kind: 'reference-system',
      configuration_digest: sha256OfJson({ image: options.image, model: options.model }),
    },
    async invoke(input: CandidateInvocationInput): Promise<CandidateInvocationResult> {
      if (input.packet.required_submission_schema !== 'diagnosis_submission@1.0.0') {
        return {
          raw_text: 'HolmesGPT repair execution is unsupported.',
          submission_text: null,
          status: 'unavailable',
          duration_ns: '0',
          tool_events: [],
        };
      }
      const observations = input.observations.map(observation => ({
        evidence_id: observation.evidence_id,
        resource_ref: observation.resource_ref,
        field_path: observation.field_path,
        observed_value: observation.value,
      }));
      const prompt = `${input.packet.task_prompt}\n\nObserved context:\n${JSON.stringify(
        observations,
        null,
        2
      )}\n\n${diagnosisInstruction}`;
      const started = process.hrtime.bigint();
      const result = adapter.runCandidate(prompt, options.model);
      const rawText = [result.stdout, result.stderr].filter(Boolean).join('\n');
      return {
        raw_text: rawText,
        submission_text:
          result.status === 0 ? adapter.extractSubmission(result.machineResult) : null,
        status: result.status === 0 ? 'ok' : 'unavailable',
        duration_ns: (process.hrtime.bigint() - started).toString(),
        ...result.telemetry,
        tool_events: [],
      };
    },
  };
}
