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
import { listScenarioIds, loadAllScenarios, loadScenario } from './loader.js';

test('lists exactly the four Phase 1 scenario IDs', () => {
  const ids = listScenarioIds();
  assert.deepEqual(ids, [
    'core-pending-underdetermined-v1',
    'core-service-selector-fault-v1',
    'core-service-selector-healthy-v1',
    'core-unschedulable-capacity-v1',
  ]);
});

test('loads and validates every scenario against its schemas', () => {
  const scenarios = loadAllScenarios();
  assert.equal(scenarios.length, 4);
  for (const scenario of scenarios) {
    assert.equal(scenario.manifest.scenario_id, scenario.candidatePacket.scenario_id);
    assert.equal(scenario.manifest.scenario_id, scenario.evaluatorPacket.scenario_id);
    assert.ok(scenario.manifest.provenance.owner.length > 0);
  }
});

test('the two selector scenarios are KWOK-compatible; the two scheduling scenarios are not', () => {
  const fault = loadScenario('core-service-selector-fault-v1');
  const healthy = loadScenario('core-service-selector-healthy-v1');
  const capacity = loadScenario('core-unschedulable-capacity-v1');
  const pending = loadScenario('core-pending-underdetermined-v1');

  assert.equal(fault.kwokCompatible, true);
  assert.equal(healthy.kwokCompatible, true);
  assert.equal(capacity.kwokCompatible, false);
  assert.equal(pending.kwokCompatible, false);
});

test('capacity/pending scenarios declare aks but not local-kwok as a supported profile', () => {
  const capacity = loadScenario('core-unschedulable-capacity-v1');
  assert.ok(capacity.manifest.supported_cluster_profiles.includes('aks'));
  assert.ok(!capacity.manifest.supported_cluster_profiles.includes('local-kwok'));
});
