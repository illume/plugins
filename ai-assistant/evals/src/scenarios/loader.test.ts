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
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listScenarioIds, loadAllScenarios, loadScenario, scenariosRoot } from './loader.js';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratchDir.js';
import { PHASE_ONE_SCENARIO_IDS, PHASE_TWO_ANCHOR_IDS } from '../contracts/evaluationContracts.js';
import { buildPortfolioCensus } from './admission.js';

test('lists the four Phase 1 cases and eight Phase 2 anchors', () => {
  assert.deepEqual(listScenarioIds(), [...PHASE_ONE_SCENARIO_IDS, ...PHASE_TWO_ANCHOR_IDS].sort());
});

test('loads and validates every scenario against its schemas', () => {
  const scenarios = loadAllScenarios();
  assert.equal(scenarios.length, 12);
  for (const scenario of scenarios) {
    assert.equal(scenario.manifest.scenario_id, scenario.candidatePacket.scenario_id);
    assert.equal(scenario.manifest.scenario_id, scenario.evaluatorPacket.scenario_id);
    assert.ok(scenario.manifest.provenance.owner.length > 0);
  }
});

test('portfolio census keeps unqualified Phase 2 anchors out of eligible evidence', () => {
  const scenarios = loadAllScenarios();
  const census = buildPortfolioCensus(scenarios);
  assert.equal(census.total, 12);
  assert.equal(census.qualified, 4);
  assert.equal(census.pending, 8);
  assert.equal(census.families, 7);
  assert.equal(census.by_stratum.approved_repair, 2);
  assert.equal(census.by_stratum.security_prompt_injection, 2);
  for (const scenarioId of PHASE_TWO_ANCHOR_IDS) {
    const scenario = scenarios.find(item => item.manifest.scenario_id === scenarioId);
    assert.equal(scenario?.manifest.provenance.lifecycle_state, 'draft');
    assert.equal(scenario?.manifest.portfolio.qualification_status, 'pending');
  }
});

test('repair anchors declare exact approval, diff, postcondition, and rollback boundaries', () => {
  for (const scenarioId of [
    'core-service-selector-repair-v1',
    'core-unschedulable-capacity-repair-v1',
  ]) {
    const scenario = loadScenario(scenarioId);
    assert.equal(scenario.manifest.mode, 'repair');
    assert.equal(scenario.candidatePacket.action_policy?.approval_required, true);
    assert.equal(scenario.candidatePacket.action_policy?.deny_on_stale_evidence, true);
    const action = scenario.evaluatorPacket.accepted_actions[0];
    assert.equal(action?.operation, 'json_patch');
    assert.ok(action?.patch?.length);
    assert.ok(action?.allowed_diff_paths?.length);
    assert.ok(action?.postconditions?.length);
    assert.ok(action?.rollback_patch?.length);
  }
});

test('repair admission rejects candidate policy patches absent from evaluator truth', () => {
  const scenario = structuredClone(loadScenario('core-service-selector-repair-v1'));
  scenario.candidatePacket.action_policy!.allowed_patches.push({
    resource_ref: 'service/web',
    patch: [{ op: 'replace', path: '/spec/selector/tier', value: 'unreviewed' }],
  });
  assert.throws(() => buildPortfolioCensus([scenario]), /repair actions require/);
});

test('portfolio admission rejects cyclic and false derived lineages', () => {
  const scenarios = loadAllScenarios();
  const fault = structuredClone(
    scenarios.find(scenario => scenario.manifest.scenario_id === 'core-service-selector-fault-v1')!
  );
  const healthy = structuredClone(
    scenarios.find(
      scenario => scenario.manifest.scenario_id === 'core-service-selector-healthy-v1'
    )!
  );
  fault.manifest.portfolio.variant_kind = 'generated';
  fault.manifest.portfolio.parent_scenario_id = healthy.manifest.scenario_id;
  healthy.manifest.portfolio.variant_kind = 'generated';
  healthy.manifest.portfolio.parent_scenario_id = fault.manifest.scenario_id;
  assert.throws(() => buildPortfolioCensus([fault, healthy]), /parent cycle/);

  healthy.manifest.portfolio.variant_kind = 'anchor';
  delete healthy.manifest.portfolio.parent_scenario_id;
  fault.manifest.portfolio.lineage_id = 'unrelated-lineage';
  assert.throws(() => buildPortfolioCensus([fault, healthy]), /must retain parent lineage/);
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
  const pending = loadScenario('core-pending-underdetermined-v1');
  for (const scenario of [capacity, pending]) {
    assert.ok(scenario.manifest.supported_cluster_profiles.includes('aks'));
    assert.ok(!scenario.manifest.supported_cluster_profiles.includes('local-kwok'));
  }
});

test('pending uncertainty case limits the candidate to its supplied phase evidence', () => {
  const pending = loadScenario('core-pending-underdetermined-v1');

  assert.deepEqual(pending.candidatePacket.allowed_observation_kinds, ['pod.phase']);
  assert.match(pending.candidatePacket.task_prompt, /only the observed context/i);
  assert.match(pending.candidatePacket.task_prompt, /Do not retrieve additional cluster data/i);
});

test('loadScenario: rejects a packet whose identity differs from the manifest', () => {
  const root = makeScratchDir('scenario-identity');
  const scenarioId = 'core-service-selector-fault-v1';
  try {
    cpSync(path.join(scenariosRoot, scenarioId), path.join(root, scenarioId), {
      recursive: true,
    });
    const packetPath = path.join(root, scenarioId, 'candidate-packet.json');
    const packet = JSON.parse(readFileSync(packetPath, 'utf8')) as { scenario_version: string };
    packet.scenario_version = '9.9.9';
    writeFileSync(packetPath, JSON.stringify(packet));
    assert.throws(() => loadScenario(scenarioId, root), /packet identity does not match manifest/);
  } finally {
    removeScratchDir(root);
  }
});
