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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertValidExploratoryAttempts,
  deriveRepeatTargets,
  type ExploratoryAttempt,
} from './repeatTargeting.js';

function attempt(index: number, lineage = `lineage-${index % 3}`): ExploratoryAttempt {
  return {
    schema_version: '1.0.0',
    attempt_pair_id: `pair-${index}`,
    scenario_id: `scenario-${index % 3}`,
    lineage_id: lineage,
    behavioral_stratum: 'fault_diagnosis',
    system: 'holmesgpt',
    baseline_trial_id: `baseline-${index}`,
    candidate_trial_id: `candidate-${index}`,
    baseline_outcome: 'pass',
    candidate_outcome: index % 4 === 0 ? 'fail' : 'pass',
    pair_eligibility: 'valid',
  };
}

test('repeat targeting stays null below the evidence threshold', () => {
  const result = deriveRepeatTargets(
    Array.from({ length: 9 }, (_, index) => attempt(index)),
    0.1
  );
  assert.equal(result.fault_diagnosis.recommended_repeat_target, null);
  assert.match(result.fault_diagnosis.blocker ?? '', /10 valid pairs/);
  assert.equal(result.healthy_control.recommended_repeat_target, null);
});

test('repeat targeting derives a transparent target from eligible discordance', () => {
  const attempts = Array.from({ length: 12 }, (_, index) => attempt(index));
  attempts.push({ ...attempt(99), attempt_pair_id: 'censored', pair_eligibility: 'censored' });
  const result = deriveRepeatTargets(attempts, 0.1).fault_diagnosis;
  assert.equal(result.valid_matched_pairs, 12);
  assert.equal(result.independent_lineages, 3);
  assert.equal(result.discordant_pairs, 3);
  assert.equal(result.discordance_estimate, 5 / 16);
  assert.equal(result.recommended_repeat_target, 83);
  assert.equal(result.blocker, null);
});

test('repeat targeting rejects dependence changes and duplicate pair identities', () => {
  assert.throws(
    () => assertValidExploratoryAttempts([attempt(0), { ...attempt(3), lineage_id: 'other' }]),
    /lineage or behavioral stratum changed/
  );
  assert.throws(
    () =>
      assertValidExploratoryAttempts([attempt(0), { ...attempt(1), attempt_pair_id: 'pair-0' }]),
    /duplicate exploratory attempt pair/
  );
});

test('repeat targeting requires a valid practical margin', () => {
  assert.throws(() => deriveRepeatTargets([], 0), /practical margin/);
  assert.throws(() => deriveRepeatTargets([], 1), /practical margin/);
});
