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
import { describe, expect, it, vi } from 'vitest';
import { diagnoseBatch, diagnosePackedBatch, type DiagnosisBatchIssue } from './batch.ts';

const issue = (issueId: string): DiagnosisBatchIssue<null> => ({
  issueId,
  prompt: `Diagnose ${issueId}`,
  allowedEvidenceIds: [`evidence-${issueId}`],
  context: null,
});

describe('diagnoseBatch', () => {
  it('bounds concurrency, isolates failures, and preserves caller order', async () => {
    let active = 0;
    let peak = 0;
    const result = await diagnoseBatch(
      { requestId: 'batch-1', issues: [issue('a'), issue('b'), issue('c')], maxConcurrency: 2 },
      async current => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, current.issueId === 'a' ? 10 : 1));
        active -= 1;
        if (current.issueId === 'b') throw new Error('provider unavailable');
        return { status: 'completed', output: current.issueId };
      }
    );

    expect(peak).toBe(2);
    expect(result.results.map(item => [item.issueId, item.status])).toEqual([
      ['a', 'completed'],
      ['b', 'failed'],
      ['c', 'completed'],
    ]);
  });

  it('stops scheduling new issues after cancellation', async () => {
    const controller = new AbortController();
    const started: string[] = [];
    const result = await diagnoseBatch(
      {
        requestId: 'batch-2',
        issues: [issue('a'), issue('b'), issue('c')],
        maxConcurrency: 1,
        signal: controller.signal,
      },
      async current => {
        started.push(current.issueId);
        controller.abort();
        throw new Error('cancelled');
      }
    );

    expect(started).toEqual(['a']);
    expect(result.results.map(item => item.status)).toEqual([
      'cancelled',
      'not_started',
      'not_started',
    ]);
  });

  it('rejects duplicate issue identities', async () => {
    await expect(
      diagnoseBatch({ requestId: 'batch-3', issues: [issue('a'), issue('a')] }, async () => ({
        status: 'completed',
        output: 'unused',
      }))
    ).rejects.toThrow('duplicate issueId');
  });

  it('validates exact identities returned by one packed model call', async () => {
    const invoke = vi.fn().mockResolvedValue({
      parsed: {
        issues: {
          a: { diagnosis: 'Diagnosis A' },
          b: { diagnosis: 'Diagnosis B' },
        },
      },
      raw: { usage_metadata: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
    });
    const model = { withStructuredOutput: () => ({ invoke }) } as unknown as BaseChatModel;

    const result = await diagnosePackedBatch(
      { requestId: 'packed-1', issues: [issue('a'), issue('b')] },
      model
    );

    expect(result.results.map(item => [item.issueId, item.status])).toEqual([
      ['a', 'completed'],
      ['b', 'completed'],
    ]);
    expect(result.modelRequest).toMatchObject({ inputTokens: 10, outputTokens: 5 });
  });

  it('rejects a packed response with a missing and unknown identity', async () => {
    const model = {
      withStructuredOutput: () => ({
        invoke: async () => ({
          parsed: {
            issues: {
              a: { diagnosis: 'Diagnosis A' },
              c: { diagnosis: 'Unknown C' },
            },
          },
          raw: {},
        }),
      }),
    } as unknown as BaseChatModel;

    await expect(
      diagnosePackedBatch({ requestId: 'packed-2', issues: [issue('a'), issue('b')] }, model)
    ).rejects.toThrow(/missing=b.*unknown=c/);
  });

  it('caps one packed model call at 32 issues', async () => {
    const model = { withStructuredOutput: vi.fn() } as unknown as BaseChatModel;
    await expect(
      diagnosePackedBatch(
        {
          requestId: 'packed-3',
          issues: Array.from({ length: 33 }, (_, index) => issue(`${index}`)),
        },
        model
      )
    ).rejects.toThrow('cannot exceed 32');
  });
});
