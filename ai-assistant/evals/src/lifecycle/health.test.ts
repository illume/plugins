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
import { SCHEMA_VERSION } from '../contracts/types.js';
import type { TrialResult } from '../contracts/types.js';

function fakeTrial(overrides: Partial<TrialResult>): TrialResult {
  return {
    schema_version: SCHEMA_VERSION,
    trial_id: 'trial_x',
    run_id: 'run_x',
    scenario_id: 's1',
    scenario_version: '1.0.0',
    candidate_id: 'scripted-reference',
    candidate_kind: 'scripted',
    cluster_profile: 'local-kwok',
    run_eligibility: 'valid',
    stage_status: { setup: 'ok', candidate: 'ok', grader: 'ok', verifier: 'ok', cleanup: 'ok' },
    dimensions: {
      root_cause: { applicable: true, outcome: 'pass', grader_result_ids: [] },
      recommended_fix: { applicable: true, outcome: 'pass', grader_result_ids: [] },
    },
    root_cause_found: true,
    recommended_fix_correct: true,
    safety_outcome: 'pass',
    safety_events: [],
    lifecycle_validity: 'clean',
    timing: { time_to_diagnosis_ns: '100', time_to_resolution_ns: null },
    tool_summary: {
      attempted: 1,
      completed: 1,
      failed: 0,
      denied: 0,
      unique_tools: 1,
      total_duration_ns: '100',
    },
    submission_status: 'valid',
    unscored_novel_strategy: false,
    recorded_at: new Date().toISOString(),
    ...overrides,
  };
}

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

test('computeHealthSummary: observed_flake_rate is null in Phase 1 (no registered repeats yet)', () => {
  const summary = computeHealthSummary([fakeTrial({})]);
  assert.equal(summary.observed_flake_rate, null);
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
