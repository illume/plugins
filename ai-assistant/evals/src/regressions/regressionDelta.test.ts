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
import { computeRegressionDeltas } from './regressionDelta.js';
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
    execution_mode: 'dry-run',
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
    supersedes_trial_id: null,
    recorded_at: new Date().toISOString(),
    ...overrides,
  };
}

test('computeRegressionDeltas: reports "improved" when candidate fixes a baseline failure', () => {
  const baseline = [fakeTrial({ trial_id: 'b1', root_cause_found: false })];
  const candidate = [fakeTrial({ trial_id: 'c1', root_cause_found: true })];
  const deltas = computeRegressionDeltas(baseline, candidate);
  const rootCause = deltas.find(d => d.dimension === 'root_cause');
  assert.equal(rootCause?.direction, 'improved');
  assert.equal(rootCause?.baseline_trial_id, 'b1');
  assert.equal(rootCause?.candidate_trial_id, 'c1');
});

test('computeRegressionDeltas: reports "regressed" when candidate breaks a baseline pass', () => {
  const baseline = [fakeTrial({ trial_id: 'b1', root_cause_found: true })];
  const candidate = [fakeTrial({ trial_id: 'c1', root_cause_found: false })];
  const deltas = computeRegressionDeltas(baseline, candidate);
  const rootCause = deltas.find(d => d.dimension === 'root_cause');
  assert.equal(rootCause?.direction, 'regressed');
});

test('computeRegressionDeltas: reports "unchanged" when both sides agree', () => {
  const baseline = [fakeTrial({ trial_id: 'b1', root_cause_found: true })];
  const candidate = [fakeTrial({ trial_id: 'c1', root_cause_found: true })];
  const deltas = computeRegressionDeltas(baseline, candidate);
  const rootCause = deltas.find(d => d.dimension === 'root_cause');
  assert.equal(rootCause?.direction, 'unchanged');
});

test('computeRegressionDeltas: reports "undefined" (never invents an improvement) when either side is not applicable', () => {
  const baseline = [fakeTrial({ trial_id: 'b1', root_cause_found: null })];
  const candidate = [fakeTrial({ trial_id: 'c1', root_cause_found: true })];
  const deltas = computeRegressionDeltas(baseline, candidate);
  const rootCause = deltas.find(d => d.dimension === 'root_cause');
  assert.equal(rootCause?.direction, 'undefined');
});

test('computeRegressionDeltas: a safety regression is reported even when root_cause is unchanged', () => {
  const baseline = [fakeTrial({ trial_id: 'b1', safety_outcome: 'pass' })];
  const candidate = [fakeTrial({ trial_id: 'c1', safety_outcome: 'fail' })];
  const deltas = computeRegressionDeltas(baseline, candidate);
  const safety = deltas.find(d => d.dimension === 'safety');
  assert.equal(safety?.direction, 'regressed');
});

test('computeRegressionDeltas: fail to unknown safety is undefined, not an improvement', () => {
  const baseline = [fakeTrial({ trial_id: 'b1', safety_outcome: 'fail' })];
  const candidate = [fakeTrial({ trial_id: 'c1', safety_outcome: 'unknown' })];
  const safety = computeRegressionDeltas(baseline, candidate).find(d => d.dimension === 'safety');
  assert.equal(safety?.direction, 'undefined');
});

test('computeRegressionDeltas: unmatched scenarios (present only in one side) produce no delta', () => {
  const baseline = [fakeTrial({ trial_id: 'b1', scenario_id: 'only-in-baseline' })];
  const candidate = [fakeTrial({ trial_id: 'c1', scenario_id: 'only-in-candidate' })];
  assert.deepEqual(computeRegressionDeltas(baseline, candidate), []);
});
