/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractJsonBlock, parseCliTelemetry } from './headlampCli.js';
import type {
  CandidateAdapter,
  CandidateInvocationInput,
  CandidateInvocationResult,
} from './candidateAdapter.js';
import { sha256OfJson, sha256OfText, type JsonValue } from '../canonicalJson.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const adapterEntry = fileURLToPath(import.meta.url);
const evalsRoot = path.resolve(here, '..', '..');
const aiAssistantRoot = path.resolve(evalsRoot, '..');
const bridgeEntry = path.join(aiAssistantRoot, 'src', 'evaluationBridge.ts');
const dependencyLock = path.join(aiAssistantRoot, 'package-lock.json');
const evaluatorDependencyLock = path.join(evalsRoot, 'package-lock.json');

const compactDiagnosisSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['alternative_dispositions', 'uncertainty', 'proposed_actions'],
  properties: {
    alternative_dispositions: { type: 'array', items: { type: 'string' } },
    uncertainty: {
      type: 'object',
      additionalProperties: false,
      required: ['is_uncertain', 'reason'],
      properties: {
        is_uncertain: { type: 'boolean' },
        reason: { type: 'string' },
      },
    },
    proposed_actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['operation', 'description'],
        properties: {
          operation: { type: 'string', enum: ['no_action', 'unscored_novel_strategy'] },
          description: { type: 'string' },
        },
      },
    },
  },
};

interface BrowserTelemetryEvent extends Record<string, unknown> {
  type: string;
}

export interface BrowserPluginRunRequest {
  url: string;
  timeoutMs: number;
  headlampToken?: string;
  providerId: string;
  providerConfig: Record<string, unknown>;
  prompt: string;
  responseSchema: Record<string, unknown>;
}

export interface BrowserPluginRunResult {
  response: string;
  telemetry: BrowserTelemetryEvent[];
  timedOut: boolean;
  error?: string;
}

export type BrowserPluginRunner = (
  request: BrowserPluginRunRequest
) => Promise<BrowserPluginRunResult>;

/** Configuration for one browser-hosted production plugin candidate. */
export interface HeadlampPluginCandidateOptions {
  url: string;
  headlampToken?: string;
  providerId: string;
  providerConfig: Record<string, unknown>;
  timeoutMs?: number;
  browserRunner?: BrowserPluginRunner;
}

/** Runs one plugin invocation in a fresh Chromium process and browser context. */
export function createRealBrowserPluginRunner(): BrowserPluginRunner {
  return async request => {
    const { chromium } = await import('@playwright/test');
    const deadline = Date.now() + request.timeoutMs;
    const browser = await chromium.launch({ headless: true, timeout: request.timeoutMs });
    const remainingMs = (): number => Math.max(1, deadline - Date.now());
    try {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        const target = new URL(request.url);
        if (target.pathname === '/') target.pathname = '/c/main';
        target.searchParams.set('headlamp-ai-eval', '1');
        await page.goto(target.toString(), {
          waitUntil: 'domcontentloaded',
          timeout: remainingMs(),
        });
        const tokenLogin = page.getByRole('button', { name: 'Use A Token' });
        if (await tokenLogin.isVisible()) {
          if (!request.headlampToken) {
            throw new Error('HEADLAMP_TOKEN is required when Headlamp requires authentication');
          }
          await tokenLogin.click({ timeout: remainingMs() });
          await page
            .getByRole('textbox', { name: 'ID token' })
            .fill(request.headlampToken, { timeout: remainingMs() });
          await page
            .getByRole('button', { name: 'Authenticate' })
            .click({ timeout: remainingMs() });
        }
        await page.waitForFunction(
          () =>
            typeof (
              globalThis as typeof globalThis & {
                __headlampAiEvaluator?: { invoke?: unknown };
              }
            ).__headlampAiEvaluator?.invoke === 'function',
          undefined,
          { timeout: remainingMs() }
        );
        const result = await page.evaluate(
          async payload => {
            const evaluator = (
              globalThis as typeof globalThis & {
                __headlampAiEvaluator?: {
                  invoke(request: {
                    providerId: string;
                    config: Record<string, unknown>;
                    prompt: string;
                    responseSchema: Record<string, unknown>;
                  }): Promise<{ response: string; telemetry: BrowserTelemetryEvent[] }>;
                  abort(): void;
                };
              }
            ).__headlampAiEvaluator;
            if (!evaluator) throw new Error('Headlamp AI evaluator bridge is unavailable');
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              return await Promise.race([
                evaluator
                  .invoke({
                    providerId: payload.providerId,
                    config: payload.providerConfig,
                    prompt: payload.prompt,
                    responseSchema: payload.responseSchema,
                  })
                  .then(value => ({ kind: 'result' as const, value })),
                new Promise<{ kind: 'timeout' }>(resolve => {
                  timer = setTimeout(() => {
                    evaluator.abort();
                    resolve({ kind: 'timeout' });
                  }, payload.timeoutMs);
                }),
              ]);
            } finally {
              if (timer) clearTimeout(timer);
            }
          },
          { ...request, timeoutMs: remainingMs() }
        );
        if (result.kind === 'timeout') {
          return { response: '', telemetry: [], timedOut: true };
        }
        return { ...result.value, timedOut: false };
      } finally {
        await context.close();
      }
    } catch (error) {
      return {
        response: '',
        telemetry: [],
        timedOut: error instanceof Error && error.name === 'TimeoutError',
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await browser.close();
    }
  };
}

function gitOutput(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: aiAssistantRoot, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** Treats an unavailable Git status as dirty while preserving a successful empty status. */
export function isDirtyGitStatus(status: string | null): boolean {
  return status !== '';
}

function buildPrompt(input: CandidateInvocationInput): string {
  const observations = input.observations.map(observation => ({
    evidence_id: observation.evidence_id,
    resource_ref: observation.resource_ref,
    field_path: observation.field_path,
    observed_value: observation.value,
  }));
  return [
    input.packet.task_prompt,
    `Observed context (JSON):\n${JSON.stringify(observations, null, 2)}`,
    'Use the native response schema to return only the semantic diagnosis fields. Do not repeat evidence IDs, resource references, or observed facts; the trusted evidence ledger is reconstructed locally. Return exactly one proposed action with operation "no_action". If the evidence cannot determine one cause, set is_uncertain true and list distinct, independently testable mechanisms as separate concise alternatives.',
  ].join('\n\n');
}

function expandCompactDiagnosis(response: string, input: CandidateInvocationInput): string | null {
  const block = extractJsonBlock(response);
  if (!block) return null;
  let compact: unknown;
  try {
    compact = JSON.parse(block);
  } catch {
    return block;
  }
  if (typeof compact !== 'object' || compact === null || Array.isArray(compact)) return block;
  const semantic = compact as Record<string, unknown>;
  return JSON.stringify({
    schema_version: '1.0.0',
    cause_facts: input.observations.map(observation => ({
      resource_ref: observation.resource_ref,
      field_path: observation.field_path,
      observed_value: observation.value,
    })),
    resource_refs: [...new Set(input.observations.map(observation => observation.resource_ref))],
    evidence_refs: input.observations.map(observation => observation.evidence_id),
    alternative_dispositions: semantic.alternative_dispositions,
    uncertainty: semantic.uncertainty,
    proposed_actions: semantic.proposed_actions,
  });
}

function normalizedTelemetry(
  events: BrowserTelemetryEvent[]
): Pick<
  CandidateInvocationResult,
  'tool_events' | 'token_usage' | 'model_invocations' | 'stage_timings'
> {
  const telemetry = parseCliTelemetry(
    [
      JSON.stringify({ type: 'telemetry_start', schema_version: '1.0.0' }),
      ...events.map(event => JSON.stringify(event)),
    ].join('\n')
  );
  return {
    ...(telemetry.toolEventsObserved ? { tool_events: telemetry.toolEvents } : {}),
    ...(telemetry.tokenUsageObserved
      ? { token_usage: telemetry.tokenUsage, model_invocations: telemetry.modelInvocations }
      : {}),
    ...(telemetry.stageTimingsObserved ? { stage_timings: telemetry.stageTimings } : {}),
  };
}

/** Creates a diagnosis-only candidate backed by the production browser plugin. */
export function createHeadlampPluginCandidate(
  options: HeadlampPluginCandidateOptions
): CandidateAdapter {
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('headlamp-plugin timeout must be a positive integer');
  }
  const browserUrl = new URL(options.url);
  if (
    !['http:', 'https:'].includes(browserUrl.protocol) ||
    browserUrl.username ||
    browserUrl.password
  ) {
    throw new Error('headlamp-plugin URL must be HTTP(S) without embedded credentials');
  }
  if (!options.providerId.trim()) throw new Error('headlamp-plugin provider must not be empty');
  const browserRunner = options.browserRunner ?? createRealBrowserPluginRunner();
  const endpoint = options.providerConfig.endpoint ?? options.providerConfig.baseUrl;
  const safeConfiguration: Record<string, JsonValue> = {
    provider: options.providerId,
    model: typeof options.providerConfig.model === 'string' ? options.providerConfig.model : null,
    endpoint_digest: typeof endpoint === 'string' ? sha256OfText(endpoint) : null,
    credential_configured:
      typeof options.providerConfig.apiKey === 'string' && options.providerConfig.apiKey.length > 0,
    browser_url_digest: sha256OfText(browserUrl.toString()),
    runtime_mode: 'browser-plugin',
    session_mode: 'agent-harness',
    retrieval_mode: 'supplied-evidence-only',
    structured_output: true,
    structured_output_mode: 'compact',
  };
  return {
    id: 'headlamp-plugin',
    kind: 'headlamp-plugin',
    identity: {
      candidate_id: 'headlamp-plugin',
      kind: 'headlamp-plugin',
      configuration_digest: sha256OfJson(safeConfiguration),
      ...safeConfiguration,
      product_revision: gitOutput(['rev-parse', 'HEAD']),
      product_tree_dirty: isDirtyGitStatus(
        gitOutput([
          'status',
          '--porcelain',
          '--untracked-files=no',
          '--',
          'src',
          'packages/ai-common',
        ])
      ),
      candidate_entry_digest: existsSync(bridgeEntry)
        ? sha256OfText(readFileSync(bridgeEntry, 'utf8'))
        : null,
      adapter_entry_digest: existsSync(adapterEntry)
        ? sha256OfText(readFileSync(adapterEntry, 'utf8'))
        : null,
      dependency_lock_digest: existsSync(dependencyLock)
        ? sha256OfText(readFileSync(dependencyLock, 'utf8'))
        : null,
      evaluator_dependency_lock_digest: existsSync(evaluatorDependencyLock)
        ? sha256OfText(readFileSync(evaluatorDependencyLock, 'utf8'))
        : null,
    },
    async invoke(input) {
      const startedAt = process.hrtime.bigint();
      let result: BrowserPluginRunResult;
      try {
        result = await browserRunner({
          url: browserUrl.toString(),
          timeoutMs,
          ...(options.headlampToken ? { headlampToken: options.headlampToken } : {}),
          providerId: options.providerId,
          providerConfig: options.providerConfig,
          prompt: buildPrompt(input),
          responseSchema: compactDiagnosisSchema,
        });
      } catch (error) {
        result = {
          response: '',
          telemetry: [],
          timedOut: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      const durationNs = (process.hrtime.bigint() - startedAt).toString();
      const telemetry = normalizedTelemetry(result.telemetry);
      if (result.timedOut) {
        return {
          raw_text: '',
          submission_text: null,
          status: 'timeout',
          duration_ns: durationNs,
          ...telemetry,
        };
      }
      if (result.error) {
        return {
          raw_text: result.error,
          submission_text: null,
          status: 'unavailable',
          duration_ns: durationNs,
          ...telemetry,
        };
      }
      return {
        raw_text: result.response,
        submission_text: expandCompactDiagnosis(result.response, input),
        status: 'ok',
        duration_ns: durationNs,
        ...telemetry,
      };
    },
  };
}
