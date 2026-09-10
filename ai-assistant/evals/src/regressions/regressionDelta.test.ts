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
import { makeTrialResult as fakeTrial } from '../test-helpers/trialResult.js';

test('computeRegressionDeltas: reports "improved" when candidate fixes a baseline failure', () => {
  const baseline = [
    fakeTrial({
      trial_id: 'b1',
      dimensions: { root_cause: { applicable: true, outcome: 'fail', grader_result_ids: [] } },
    }),
  ];
  const candidate = [fakeTrial({ trial_id: 'c1' })];
  const deltas = computeRegressionDeltas(baseline, candidate);
  const rootCause = deltas.find(d => d.dimension === 'root_cause');
  assert.equal(rootCause?.direction, 'improved');
  assert.equal(rootCause?.baseline_trial_id, 'b1');
  assert.equal(rootCause?.candidate_trial_id, 'c1');
});

test('computeRegressionDeltas: reports "regressed" when candidate breaks a baseline pass', () => {
  const baseline = [fakeTrial({ trial_id: 'b1' })];
  const candidate = [
    fakeTrial({
      trial_id: 'c1',
      dimensions: { root_cause: { applicable: true, outcome: 'fail', grader_result_ids: [] } },
    }),
  ];
  const deltas = computeRegressionDeltas(baseline, candidate);
  const rootCause = deltas.find(d => d.dimension === 'root_cause');
  assert.equal(rootCause?.direction, 'regressed');
});

test('computeRegressionDeltas: reports "unchanged" when both sides agree', () => {
  const baseline = [fakeTrial({ trial_id: 'b1' })];
  const candidate = [fakeTrial({ trial_id: 'c1' })];
  const deltas = computeRegressionDeltas(baseline, candidate);
  const rootCause = deltas.find(d => d.dimension === 'root_cause');
  assert.equal(rootCause?.direction, 'unchanged');
});

test('computeRegressionDeltas: reports "undefined" (never invents an improvement) when either side is not applicable', () => {
  const baseline = [
    fakeTrial({
      trial_id: 'b1',
      dimensions: {
        root_cause: { applicable: false, outcome: 'no_result', grader_result_ids: [] },
      },
    }),
  ];
  const candidate = [fakeTrial({ trial_id: 'c1' })];
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

test('computeRegressionDeltas: invalid trials produce no capability delta', () => {
  const baseline = [fakeTrial({ trial_id: 'b1', run_eligibility: 'invalid' })];
  const candidate = [fakeTrial({ trial_id: 'c1' })];
  assert.deepEqual(computeRegressionDeltas(baseline, candidate), []);
  assert.deepEqual(computeRegressionDeltas(candidate, baseline), []);
});
