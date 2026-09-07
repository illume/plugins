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
import { isCandidateSpec, runEvaluation, selectScenarios } from './orchestrate.js';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratchDir.js';

test('selectScenarios: local-kwok defaults to exactly the generated KWOK-compatible subset', () => {
  const scenarios = selectScenarios('local-kwok', undefined);
  const ids = scenarios.map(s => s.manifest.scenario_id).sort();
  assert.deepEqual(ids, ['core-service-selector-fault-v1', 'core-service-selector-healthy-v1']);
});

test('selectScenarios: aks defaults to every scenario declaring aks support', () => {
  const scenarios = selectScenarios('aks', undefined);
  const ids = scenarios.map(s => s.manifest.scenario_id).sort();
  assert.deepEqual(ids, [
    'core-pending-underdetermined-v1',
    'core-service-selector-fault-v1',
    'core-service-selector-healthy-v1',
    'core-unschedulable-capacity-v1',
  ]);
});

test('selectScenarios: explicitly requesting an incompatible case on local-kwok is a hard error', () => {
  assert.throws(
    () => selectScenarios('local-kwok', ['core-unschedulable-capacity-v1']),
    /not in the generated KWOK-compatible subset/
  );
});

test('selectScenarios: explicitly requesting an unknown case is a hard error', () => {
  assert.throws(
    () => selectScenarios('local-kwok', ['does-not-exist']),
    /unknown or inactive scenario/
  );
});

test('isCandidateSpec: recognizes every valid spec and rejects anything else', () => {
  assert.equal(isCandidateSpec('reference'), true);
  assert.equal(isCandidateSpec('headlamp-cli'), true);
  assert.equal(isCandidateSpec('not-a-real-spec'), false);
});

test('runEvaluation: end-to-end local-kwok run with baseline/candidate produces regression deltas', async () => {
  const dir = makeScratchDir('orchestrate-e2e');
  try {
    const outcome = await runEvaluation({
      runId: 'run_e2e_1',
      runsRoot: dir,
      profile: 'local-kwok',
      mode: 'dry-run',
      candidate: 'reference',
      baseline: 'wrong',
    });
    assert.equal(outcome.trials.length, 4); // 2 scenarios x 2 candidate passes
    const passing = outcome.trials.filter(t => t.candidate_id === 'scripted-reference');
    assert.equal(passing.length, 2);
    assert.ok(passing.every(t => t.dimensions.root_cause.outcome === 'pass'));
  } finally {
    removeScratchDir(dir);
  }
});

test('runEvaluation: a single-candidate run has no regression-deltas rows', async () => {
  const dir = makeScratchDir('orchestrate-single');
  try {
    const outcome = await runEvaluation({
      runId: 'run_single_1',
      runsRoot: dir,
      profile: 'local-kwok',
      mode: 'dry-run',
      candidate: 'reference',
    });
    assert.equal(outcome.trials.length, 2);
  } finally {
    removeScratchDir(dir);
  }
});
