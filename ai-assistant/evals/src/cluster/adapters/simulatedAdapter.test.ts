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
import { SimulatedKwokAdapter } from './simulatedAdapter.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const scenariosRoot = path.resolve(here, '..', '..', '..', 'scenarios');

test('SimulatedKwokAdapter: computes empty endpoints when the Service selector does not match any Pod', async () => {
  const adapter = new SimulatedKwokAdapter('local-kwok');
  await adapter.applyManifest(
    'ns1',
    path.join(scenariosRoot, 'core-service-selector-fault-v1', 'setup.yaml')
  );
  const endpoints = await adapter.computeEndpoints('ns1', 'web');
  assert.deepEqual(endpoints.addresses, []);
  const selector = await adapter.getServiceSelector('ns1', 'web');
  assert.deepEqual(selector.selector, { app: 'web', tier: 'frontend' });
});

test('SimulatedKwokAdapter: computes a non-empty endpoint when selector and labels match', async () => {
  const adapter = new SimulatedKwokAdapter('local-kwok');
  await adapter.applyManifest(
    'ns2',
    path.join(scenariosRoot, 'core-service-selector-healthy-v1', 'setup.yaml')
  );
  const endpoints = await adapter.computeEndpoints('ns2', 'web');
  assert.equal(endpoints.addresses.length, 1);
});

test('SimulatedKwokAdapter: never reports scheduling as supported (unproven mechanism)', async () => {
  const adapter = new SimulatedKwokAdapter('local-kwok');
  const observation = await adapter.getSchedulingObservation('ns1', 'some-pod');
  assert.equal(observation.supported, false);
});

test('SimulatedKwokAdapter: preflight always reports supported (offline, no external tool needed)', async () => {
  const adapter = new SimulatedKwokAdapter('local-kwok');
  const preflight = await adapter.preflight();
  assert.equal(preflight.supported, true);
});

test('SimulatedKwokAdapter: deleteNamespace removes only objects in that namespace', async () => {
  const adapter = new SimulatedKwokAdapter('local-kwok');
  await adapter.applyManifest(
    'ns-a',
    path.join(scenariosRoot, 'core-service-selector-fault-v1', 'setup.yaml')
  );
  await adapter.applyManifest(
    'ns-b',
    path.join(scenariosRoot, 'core-service-selector-healthy-v1', 'setup.yaml')
  );
  await adapter.deleteNamespace('ns-a');
  const remaining = await adapter.getServiceSelector('ns-a', 'web');
  assert.equal(remaining.found, false);
  const stillThere = await adapter.getServiceSelector('ns-b', 'web');
  assert.equal(stillThere.found, true);
});

test('SimulatedKwokAdapter: reads resource requests without inventing cluster nodes', async () => {
  const adapter = new SimulatedKwokAdapter('local-kwok');
  await adapter.applyManifest(
    'ns3',
    path.join(scenariosRoot, 'core-unschedulable-capacity-v1', 'setup.yaml')
  );
  const nodes = await adapter.listNodeAllocatable();
  assert.equal(nodes.length, 0);
  const requests = await adapter.getPodResourceRequests('ns3', 'huge-pod');
  assert.equal(requests?.cpu, '1000000');
});
