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

import type { ClusterProfileName } from '../contracts/types.js';
import { AksAdapter } from './aksAdapter.js';
import { createRealCommandRunner, type CommandRunner } from './commandRunner.js';
import { loadClusterProfile } from './profile.js';
import { KubectlKwokAdapter } from './kwokAdapter.js';
import { SimulatedKwokAdapter } from './simulatedAdapter.js';
import type { ClusterAdapter } from './types.js';

export type ExecutionMode = 'dry-run' | 'real';

/**
 * Builds the cluster adapter for a named committed profile.
 *
 * `local-minikube` is a declared Phase 2 profile name kept in the type
 * contract for forward compatibility; Phase 1 has no Minikube adapter and
 * selecting it fails immediately with an explicit, honest message rather than
 * silently falling back to KWOK or fabricating a result.
 */
export function createClusterAdapter(
  profileName: ClusterProfileName,
  mode: ExecutionMode,
  runner: CommandRunner = createRealCommandRunner()
): ClusterAdapter {
  if (profileName === 'local-minikube') {
    throw new Error(
      'local-minikube is a Phase 2 deliverable (see evals/docs/implementation-phases.md, ' +
        '"Phase 2 case inventory"); no adapter is implemented in Phase 1.'
    );
  }
  if (profileName === 'aks') {
    if (mode !== 'real') {
      throw new Error(
        'the aks profile requires --execute real; dry-run never mutates an AKS cluster'
      );
    }
    const config = loadClusterProfile('aks-azure');
    return new AksAdapter(config.cluster.credential_env_vars, runner);
  }
  // local-kwok
  return mode === 'dry-run'
    ? new SimulatedKwokAdapter('local-kwok')
    : new KubectlKwokAdapter('local-kwok', runner);
}
