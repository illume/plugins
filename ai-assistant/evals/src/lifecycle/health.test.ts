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
import { computeHealthSummary } from './health.js';
import { makeTrialResult as fakeTrial } from '../test-helpers/trialResult.js';

test('computeHealthSummary: counts setup/cleanup success and failure separately', () => {
  const summary = computeHealthSummary([
    fakeTrial({ trial_id: 't1' }),
    fakeTrial({
      trial_id: 't2',
      stage_status: {
        setup: 'error',
        candidate: 'skipped',
        grader: 'skipped',
        verifier: 'skipped',
        cleanup: 'skipped',
      },
      run_eligibility: 'invalid',
      first_failure_owner: 'setup',
    }),
  ]);
  assert.equal(summary.total_trials, 2);
  assert.equal(summary.setup_ok, 1);
  assert.equal(summary.setup_failed, 1);
  assert.equal(summary.excluded_count, 1);
  assert.deepEqual(summary.by_first_failure_owner, { setup: 1 });
});

test('computeHealthSummary: counts an invalid-grader row only when the grader stage itself ran', () => {
  const summary = computeHealthSummary([
    fakeTrial({ submission_status: 'malformed' }),
    fakeTrial({
      trial_id: 't2',
      submission_status: 'missing',
      stage_status: {
        setup: 'ok',
        candidate: 'unsupported',
        grader: 'skipped',
        verifier: 'skipped',
        cleanup: 'ok',
      },
      run_eligibility: 'invalid',
    }),
  ]);
  assert.equal(summary.invalid_grader_count, 1);
});

test('computeHealthSummary: aggregates observed duration, tool, and model usage', () => {
  const summary = computeHealthSummary([
    fakeTrial({
      timing: { time_to_diagnosis_ns: '100', time_to_resolution_ns: null },
      tool_summary: {
        attempted: 2,
        completed: 1,
        failed: 1,
        denied: 0,
        unique_tools: 2,
        total_duration_ns: '50',
      },
      model_usage: {
        input_tokens: 10,
        uncached_input_tokens: 5,
        output_tokens: 5,
        total_tokens: 15,
        request_count: 1,
        cache_read_input_tokens: 4,
        cache_creation_input_tokens: 1,
      },
      configured_usage_estimate: {
        amount: '0.125',
        unit: 'USD',
        basis: 'configured_usage_pricing',
        pricing_source: 'test-prices',
        line_items: [],
      },
    }),
    fakeTrial({
      trial_id: 't2',
      timing: {
        time_to_diagnosis_ns: null,
        time_to_resolution_ns: null,
        censoring_reason: 'candidate unavailable',
      },
      tool_summary: {
        attempted: 1,
        completed: 0,
        failed: 0,
        denied: 1,
        unique_tools: 1,
        total_duration_ns: '25',
      },
      model_usage: null,
    }),
  ]);

  assert.equal(summary.diagnosis_duration_observed_count, 1);
  assert.equal(summary.diagnosis_duration_total_ns, '100');
  assert.equal(summary.tool_duration_total_ns, '75');
  assert.equal(summary.tool_calls_attempted, 3);
  assert.equal(summary.tool_calls_failed_or_denied, 2);
  assert.equal(summary.model_usage_observed_count, 1);
  assert.equal(summary.model_input_tokens, 10);
  assert.equal(summary.model_output_tokens, 5);
  assert.equal(summary.model_total_tokens, 15);
  assert.equal(summary.model_cache_usage_observed_count, 1);
  assert.equal(summary.model_cache_read_input_tokens, 4);
  assert.equal(summary.model_cache_creation_input_tokens, 1);
  assert.equal(summary.configured_usage_estimate_observed_count, 1);
  assert.deepEqual(summary.configured_usage_totals_by_unit, { USD: '0.125' });
});

test('computeHealthSummary: never combines incompatible accounting units', () => {
  const summary = computeHealthSummary([
    fakeTrial({
      configured_usage_estimate: {
        amount: '0.5',
        unit: 'USD',
        basis: 'configured_usage_pricing',
        pricing_source: 'usd-prices',
        line_items: [],
      },
    }),
    fakeTrial({
      trial_id: 't2',
      configured_usage_estimate: {
        amount: '2',
        unit: 'github_ai_credit',
        basis: 'configured_usage_pricing',
        pricing_source: 'copilot-policy',
        line_items: [],
      },
    }),
  ]);

  assert.deepEqual(summary.configured_usage_totals_by_unit, {
    USD: '0.5',
    github_ai_credit: '2',
  });
});
