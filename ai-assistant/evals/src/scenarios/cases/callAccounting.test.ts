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
import type { ClusterAdapter } from '../../cluster/clusterAdapter.js';
import { capacityCase } from './schedulingCases.js';
import { selectorFaultCase } from './serviceSelectorCases.js';

test('selector observation records one list call with per-Pod evidence', async () => {
  const adapter = {
    getServiceSelector: async () => ({ found: true, selector: { app: 'web' } }),
    listPodsByLabelSelector: async () => [
      { name: 'web-1', labels: { app: 'web' }, phase: 'Running' },
      { name: 'web-2', labels: { app: 'web' }, phase: 'Running' },
    ],
    computeEndpoints: async () => ({ addresses: [] }),
  } as unknown as ClusterAdapter;

  const steps = await selectorFaultCase.observe(adapter, 'ns');
  assert.equal(steps.length, 3);
  assert.equal(steps[1]?.operation, 'list_pod_labels');
  assert.equal(steps[1]?.evidenceValues?.length, 2);
});

test('capacity observation records one list call with per-Node evidence', async () => {
  const adapter = {
    listNodeAllocatable: async () => [
      { name: 'node-1', allocatable: { cpu: '2', memory: '4Gi' } },
      { name: 'node-2', allocatable: { cpu: '4', memory: '8Gi' } },
    ],
    getPodResourceRequests: async () => ({ cpu: '8', memory: '1Gi' }),
    getSchedulingObservation: async () => ({
      supported: true,
      phase: 'Pending',
      condition: 'False',
      reason: 'Unschedulable',
    }),
  } as unknown as ClusterAdapter;

  const steps = await capacityCase.observe(adapter, 'ns');
  assert.equal(steps.length, 3);
  assert.equal(steps[0]?.operation, 'list_node_allocatable');
  assert.equal(steps[0]?.evidenceValues?.length, 2);
});
