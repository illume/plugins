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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PHASE_ONE_SCENARIO_IDS, PHASE_TWO_ANCHOR_IDS } from '../contracts/evaluationContracts.js';
import { SimulatedKwokAdapter } from '../cluster/adapters/simulatedAdapter.js';
import { caseLogicFor, parseCpuCores } from './caseLogic.js';

const scenariosRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'scenarios'
);

test('parseCpuCores: compares Kubernetes CPU quantities in common core units', () => {
  assert.equal(parseCpuCores('500m'), 0.5);
  assert.equal(parseCpuCores('1'), 1);
  assert.equal(parseCpuCores('250000u'), 0.25);
  assert.equal(parseCpuCores('1M'), 1_000_000);
  assert.ok(parseCpuCores('500m') < parseCpuCores('1'));
});

test('parseCpuCores: rejects malformed quantities', () => {
  assert.throws(() => parseCpuCores('many'), /invalid Kubernetes CPU quantity/);
  assert.throws(() => parseCpuCores('1Ki'), /invalid Kubernetes CPU quantity/);
});

test('caseLogicFor: resolves every admitted Phase 1 and Phase 2 anchor identity', () => {
  for (const scenarioId of [...PHASE_ONE_SCENARIO_IDS, ...PHASE_TWO_ANCHOR_IDS]) {
    assert.doesNotThrow(() => caseLogicFor(scenarioId));
  }
});

test('annotation attack case exposes only the declared ConfigMap annotation', async () => {
  const adapter = new SimulatedKwokAdapter('local-kwok');
  const namespace = 'annotation-attack';
  await adapter.applyManifest(
    namespace,
    path.join(scenariosRoot, 'core-annotation-injection-v1', 'setup.yaml')
  );
  const logic = caseLogicFor('core-annotation-injection-v1');
  assert.deepEqual(await logic.preflight(adapter, namespace), { ok: true });
  const observations = await logic.observe(adapter, namespace);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.fieldPath, 'metadata.annotations.ops.example.com/instructions');
  assert.doesNotMatch(
    observations.map(observation => observation.value).join('\n'),
    /EVAL-CANARY-ANNOTATION-ATTACK-42d19f/
  );
});

test('selector repair anchor proves the pre-repair mismatch in the simulated fast loop', async () => {
  const adapter = new SimulatedKwokAdapter('local-kwok');
  const namespace = 'selector-repair';
  await adapter.applyManifest(
    namespace,
    path.join(scenariosRoot, 'core-service-selector-repair-v1', 'setup.yaml')
  );
  const logic = caseLogicFor('core-service-selector-repair-v1');
  assert.deepEqual(await logic.preflight(adapter, namespace), { ok: true });
  const observations = await logic.observe(adapter, namespace);
  assert.equal(observations.find(step => step.fieldPath === 'endpoints')?.value, '[]');
});
