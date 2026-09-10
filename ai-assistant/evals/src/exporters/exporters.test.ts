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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectToLangSmith } from './langsmith.js';
import { projectToOtlp } from './otlp.js';
import { makeTrialResult as fakeTrial } from '../test-helpers/trialResult.js';

test('projectToLangSmith: maps trial_id/scenario identity and declares unsupported/dropped fields', () => {
  const projection = projectToLangSmith([fakeTrial()]);
  assert.equal(projection.runs.length, 1);
  assert.equal(projection.runs[0]?.id, 'trial_x');
  assert.equal(projection.runs[0]?.name, 'core-service-selector-fault-v1');
  assert.equal(projection.feedback[0]?.score, 1);
  assert.equal(projection.runs[0]?.extra.metadata.run_id, 'run_x');
  assert.equal(projection.feedback.length, 3);
});

test('projectToLangSmith: a no_result root cause becomes a null score, never a fabricated 0', () => {
  const projection = projectToLangSmith([
    fakeTrial({
      dimensions: { root_cause: { applicable: true, outcome: 'no_result', grader_result_ids: [] } },
    }),
  ]);
  assert.equal(projection.feedback[0]?.score, null);
});

test('projectToLangSmith: a failed root cause becomes score 0', () => {
  const projection = projectToLangSmith([
    fakeTrial({
      dimensions: { root_cause: { applicable: true, outcome: 'fail', grader_result_ids: [] } },
    }),
  ]);
  assert.equal(projection.feedback[0]?.score, 0);
});

test('projectToOtlp: maps every trial to one span with namespaced headlamp.eval attributes', () => {
  const projection = projectToOtlp([
    fakeTrial({
      model_usage: {
        input_tokens: 12,
        uncached_input_tokens: 8,
        output_tokens: 4,
        total_tokens: 16,
        request_count: 1,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 1,
      },
      configured_usage_estimate: {
        amount: '0.000064',
        unit: 'USD',
        basis: 'configured_usage_pricing',
        pricing_source: 'test-prices',
        provider: 'openai',
        model: 'gpt-5',
        service_tier: 'flex',
        line_items: [],
      },
    }),
  ]);
  const span = projection.resource_spans[0]?.spans[0];
  assert.match(span?.trace_id ?? '', /^[a-f0-9]{32}$/);
  assert.match(span?.span_id ?? '', /^[a-f0-9]{16}$/);
  assert.ok(BigInt(span?.end_time_unix_nano ?? '0') >= BigInt(span?.start_time_unix_nano ?? '0'));
  assert.equal(span?.attributes['headlamp.eval.scenario_id'], 'core-service-selector-fault-v1');
  assert.equal(span?.attributes['headlamp.eval.root_cause.outcome'], 'pass');
  assert.equal(span?.attributes['gen_ai.usage.input_tokens'], 12);
  assert.equal(span?.attributes['gen_ai.usage.output_tokens'], 4);
  assert.equal(span?.attributes['headlamp.eval.model.cache_read_input_tokens'], 3);
  assert.equal(span?.attributes['headlamp.eval.model.cache_creation_input_tokens'], 1);
  assert.equal(span?.attributes['headlamp.eval.configured_usage.amount'], '0.000064');
  assert.equal(span?.attributes['headlamp.eval.configured_usage.unit'], 'USD');
  assert.equal(
    span?.attributes['headlamp.eval.configured_usage.basis'],
    'configured_usage_pricing'
  );
  assert.equal(span?.attributes['gen_ai.provider.name'], 'openai');
  assert.equal(span?.attributes['gen_ai.response.model'], 'gpt-5');
  assert.ok(projection.unsupported_fields.length > 0);
  assert.ok(projection.unsupported_fields.every(field => !field.includes('token usage')));
});

test('projectToOtlp: a no_result root-cause outcome is retained', () => {
  const projection = projectToOtlp([
    fakeTrial({
      dimensions: { root_cause: { applicable: true, outcome: 'no_result', grader_result_ids: [] } },
    }),
  ]);
  assert.equal(
    projection.resource_spans[0]?.spans[0]?.attributes['headlamp.eval.root_cause.outcome'],
    'no_result'
  );
});

test('exporter projections are deterministic for identical input', () => {
  const trials = [fakeTrial()];
  assert.deepEqual(projectToLangSmith(trials), projectToLangSmith(trials));
  assert.deepEqual(projectToOtlp(trials), projectToOtlp(trials));
});
