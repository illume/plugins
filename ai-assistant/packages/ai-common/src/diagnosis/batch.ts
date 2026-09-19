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

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/** One independently scoped issue in a diagnosis batch. */
export interface DiagnosisBatchIssue<TContext = unknown> {
  issueId: string;
  prompt: string;
  allowedEvidenceIds: string[];
  context: TContext;
}

/** Limits and cancellation shared by one batch request. */
export interface DiagnosisBatchRequest<TContext = unknown> {
  requestId: string;
  issues: Array<DiagnosisBatchIssue<TContext>>;
  maxConcurrency?: number;
  signal?: AbortSignal;
}

/** Successful or semantically invalid output returned by an isolated executor. */
export type DiagnosisIssueExecution<TOutput> =
  | { status: 'completed'; output: TOutput }
  | { status: 'invalid'; error: string };

/** Terminal result for one issue, retained in caller order. */
export type DiagnosisBatchIssueResult<TOutput> =
  | { issueId: string; status: 'completed'; output: TOutput; durationMs: number }
  | { issueId: string; status: 'invalid' | 'failed'; error: string; durationMs: number }
  | { issueId: string; status: 'cancelled'; error: string; durationMs: number }
  | { issueId: string; status: 'not_started'; error: string; durationMs: 0 };

/** Ordered result for a complete batch scheduling attempt. */
export interface DiagnosisBatchResult<TOutput> {
  requestId: string;
  results: Array<DiagnosisBatchIssueResult<TOutput>>;
  modelRequest?: {
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export type DiagnoseIssue<TContext, TOutput> = (
  issue: DiagnosisBatchIssue<TContext>,
  signal?: AbortSignal
) => Promise<DiagnosisIssueExecution<TOutput>>;

const DEFAULT_MAX_CONCURRENCY = 2;
const MAX_BATCH_CONCURRENCY = 8;
const MAX_BATCH_ISSUES = 50;
export const MAX_PACKED_DIAGNOSIS_ISSUES = 32;

function validateRequest<TContext>(request: DiagnosisBatchRequest<TContext>): number {
  if (!request.requestId.trim()) throw new Error('Diagnosis batch requestId must not be empty');
  if (request.issues.length > MAX_BATCH_ISSUES) {
    throw new Error(`Diagnosis batch cannot exceed ${MAX_BATCH_ISSUES} issues`);
  }
  const issueIds = new Set<string>();
  for (const issue of request.issues) {
    if (!issue.issueId.trim()) throw new Error('Diagnosis batch issueId must not be empty');
    if (issueIds.has(issue.issueId)) {
      throw new Error(`Diagnosis batch contains duplicate issueId: ${issue.issueId}`);
    }
    issueIds.add(issue.issueId);
    if (!issue.prompt.trim())
      throw new Error(`Diagnosis batch issue ${issue.issueId} has no prompt`);
    if (new Set(issue.allowedEvidenceIds).size !== issue.allowedEvidenceIds.length) {
      throw new Error(`Diagnosis batch issue ${issue.issueId} has duplicate evidence IDs`);
    }
  }
  const maxConcurrency = request.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;
  if (
    !Number.isSafeInteger(maxConcurrency) ||
    maxConcurrency < 1 ||
    maxConcurrency > MAX_BATCH_CONCURRENCY
  ) {
    throw new Error(
      `Diagnosis batch maxConcurrency must be between 1 and ${MAX_BATCH_CONCURRENCY}`
    );
  }
  return maxConcurrency;
}

/** Runs isolated issue diagnoses with bounded concurrency and ordered results. */
export async function diagnoseBatch<TContext, TOutput>(
  request: DiagnosisBatchRequest<TContext>,
  diagnoseIssue: DiagnoseIssue<TContext, TOutput>
): Promise<DiagnosisBatchResult<TOutput>> {
  const maxConcurrency = validateRequest(request);
  const results = new Array<DiagnosisBatchIssueResult<TOutput>>(request.issues.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = cursor++;
      const issue = request.issues[index];
      if (!issue) return;
      if (request.signal?.aborted) {
        results[index] = {
          issueId: issue.issueId,
          status: 'not_started',
          error: 'Diagnosis batch was cancelled before this issue started',
          durationMs: 0,
        };
        continue;
      }

      const startedAt = performance.now();
      try {
        const execution = await diagnoseIssue(issue, request.signal);
        const durationMs = performance.now() - startedAt;
        results[index] =
          execution.status === 'completed'
            ? { issueId: issue.issueId, status: 'completed', output: execution.output, durationMs }
            : { issueId: issue.issueId, status: 'invalid', error: execution.error, durationMs };
      } catch (error) {
        const durationMs = performance.now() - startedAt;
        const message = error instanceof Error ? error.message : String(error);
        results[index] = request.signal?.aborted
          ? { issueId: issue.issueId, status: 'cancelled', error: message, durationMs }
          : { issueId: issue.issueId, status: 'failed', error: message, durationMs };
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, request.issues.length) }, () => worker())
  );
  return { requestId: request.requestId, results };
}

interface PackedDiagnosisResponse {
  issues: Record<string, { diagnosis: string }>;
}

/** Runs up to 32 independent issue prompts through one strict structured model call. */
export async function diagnosePackedBatch<TContext>(
  request: DiagnosisBatchRequest<TContext>,
  model: BaseChatModel
): Promise<DiagnosisBatchResult<string>> {
  validateRequest(request);
  if (request.issues.length > MAX_PACKED_DIAGNOSIS_ISSUES) {
    throw new Error(
      `Packed diagnosis cannot exceed ${MAX_PACKED_DIAGNOSIS_ISSUES} issues per model call`
    );
  }
  if (request.issues.length === 0) return { requestId: request.requestId, results: [] };

  const issueIds = request.issues.map(issue => issue.issueId);
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['issues'],
    properties: {
      issues: {
        type: 'object',
        additionalProperties: false,
        required: issueIds,
        properties: Object.fromEntries(
          issueIds.map(issueId => [
            issueId,
            {
              type: 'object',
              additionalProperties: false,
              required: ['diagnosis'],
              properties: { diagnosis: { type: 'string' } },
            },
          ])
        ),
      },
    },
  };
  const runnable = model.withStructuredOutput<PackedDiagnosisResponse>(schema, {
    name: `packed_diagnosis_${issueIds.length}`,
    method: 'jsonSchema',
    strict: true,
    includeRaw: true,
  });
  const prompt = [
    'Diagnose every independent issue below.',
    'The issues response is an object keyed by issue_id. Complete every required key exactly once.',
    "Use only that issue's prompt and allowed evidence IDs. Never combine issues.",
    'Keep each diagnosis concise: supported root cause, impact, uncertainty, and safe remediation.',
    'Do not claim that any mutation was executed.',
    JSON.stringify(
      request.issues.map(issue => ({
        issue_id: issue.issueId,
        prompt: issue.prompt,
        allowed_evidence_ids: issue.allowedEvidenceIds,
      }))
    ),
  ].join('\n');

  const startedAt = performance.now();
  const response = await runnable.invoke(prompt, { signal: request.signal });
  const durationMs = performance.now() - startedAt;
  const usageMetadata = (
    response.raw as {
      usage_metadata?: {
        input_tokens?: number;
        output_tokens?: number;
        total_tokens?: number;
      };
    }
  ).usage_metadata;
  const returned = Object.keys(response.parsed.issues);
  const missing = issueIds.filter(issueId => !returned.includes(issueId));
  const duplicates = [
    ...new Set(returned.filter((issueId, index) => returned.indexOf(issueId) !== index)),
  ];
  const unknown = returned.filter(issueId => !issueIds.includes(issueId));
  if (
    returned.length !== issueIds.length ||
    missing.length > 0 ||
    duplicates.length > 0 ||
    unknown.length > 0
  ) {
    throw new Error(
      `Packed diagnosis identity mismatch: missing=${missing.join(',') || 'none'} ` +
        `duplicates=${duplicates.join(',') || 'none'} unknown=${unknown.join(',') || 'none'}`
    );
  }
  return {
    requestId: request.requestId,
    results: issueIds.map(issueId => ({
      issueId,
      status: 'completed',
      output: response.parsed.issues[issueId]!.diagnosis,
      durationMs,
    })),
    modelRequest: {
      durationMs,
      inputTokens: usageMetadata?.input_tokens,
      outputTokens: usageMetadata?.output_tokens,
      totalTokens: usageMetadata?.total_tokens,
    },
  };
}
