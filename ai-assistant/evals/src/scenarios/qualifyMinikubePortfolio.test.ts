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
import type { LoadedScenario } from './loader.js';
import {
  isTransientClusterError,
  selectQualificationScenarios,
} from './qualifyMinikubePortfolio.js';

function scenario(id: string, profiles: Array<'local-minikube' | 'aks'>): LoadedScenario {
  return {
    manifest: {
      scenario_id: id,
      supported_cluster_profiles: profiles,
    },
  } as LoadedScenario;
}

test('standalone kubectl EOF and network failures are transient', () => {
  for (const reason of [
    'Unable to connect to the server: EOF',
    'TLS handshake timeout',
    'connection reset by peer',
    'dial tcp: no such host',
  ]) {
    assert.equal(isTransientClusterError(new Error(reason)), true, reason);
  }
  assert.equal(isTransientClusterError(new Error('forbidden')), false);
});

test('qualification selection respects declared profiles by default', () => {
  const scenarios = [
    scenario('minikube-only', ['local-minikube']),
    scenario('portable', ['local-minikube', 'aks']),
  ];

  assert.deepEqual(
    selectQualificationScenarios(scenarios, 'aks').map(item => item.manifest.scenario_id),
    ['portable']
  );
  assert.deepEqual(
    selectQualificationScenarios(scenarios, 'local-minikube').map(
      item => item.manifest.scenario_id
    ),
    ['minikube-only', 'portable']
  );
});
