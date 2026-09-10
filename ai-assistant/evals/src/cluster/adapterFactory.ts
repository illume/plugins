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

import type { ClusterProfileName } from '../contracts/evaluationContracts.js';
import { AksAdapter } from './adapters/aksAdapter.js';
import { createRealCommandRunner, type CommandRunner } from './commandRunner.js';
import { loadClusterProfile } from './profile.js';
import { KwokAdapter } from './adapters/kwokAdapter.js';
import { SimulatedKwokAdapter } from './adapters/simulatedAdapter.js';
import type { ClusterAdapter } from './clusterAdapter.js';
import { MinikubeAdapter } from './adapters/minikubeAdapter.js';

/** Whether a run uses deterministic simulation or real cluster commands. */
export type ExecutionMode = 'dry-run' | 'real';

/**
 * Builds the cluster adapter for a named committed profile.
 *
 * `local-minikube` is real-only because its scheduler-dependent observations
 * cannot be represented honestly by the deterministic KWOK simulation.
 *
 * @param profileName - Committed cluster profile to implement.
 * @param mode - Simulation or real-command execution mode.
 * @param runner - Injectable command boundary for real adapters.
 * @returns An adapter implementing the selected cluster profile.
 */
export function createClusterAdapter(
  profileName: ClusterProfileName,
  mode: ExecutionMode,
  runner: CommandRunner = createRealCommandRunner()
): ClusterAdapter {
  if (profileName === 'local-minikube') {
    if (mode !== 'real') {
      throw new Error('the local-minikube profile requires --execute real');
    }
    return new MinikubeAdapter(runner);
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
  return mode === 'dry-run' ? new SimulatedKwokAdapter('local-kwok') : new KwokAdapter(runner);
}
