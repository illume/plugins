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

import type { RequiredMechanism } from './evaluationContracts.js';

/**
 * Mechanisms KWOK is independently proved to provide.
 *
 * Per `evals/docs/implementation-phases.md`: "KWOK is admitted only for
 * fields whose mechanism is independently proved." `kwokctl` runs a real
 * kube-apiserver, controller-manager, and scheduler; only node kubelets, CNI,
 * and CSI are simulated. Because this repository has not yet run the
 * independent control proving that KWOK's scheduler binds Pods using the
 * same decision path as a real kubelet-backed node (rather than simply
 * accepting fixture-authored capacity numbers), `scheduler` is deliberately
 * withheld from this list. Widen this list only after that control passes,
 * and record the evidence next to the change.
 */
export const KWOK_PROVEN_MECHANISMS: readonly RequiredMechanism[] = [
  'api-server',
  'endpointslice-controller',
];

/**
 * Returns whether every mechanism a scenario declares as required is one
 * that KWOK is independently proved to provide. This is the single source of
 * truth for kwok-compatible subset selection; a scenario author's
 * `declared_kwok_compatible` flag is cross-checked against it and never
 * silently trusted.
 *
 * @param requiredMechanisms - Mechanisms required by the scenario's scored truth.
 * @returns Whether every required mechanism is independently proven under KWOK.
 */
export function isKwokCompatible(requiredMechanisms: RequiredMechanism[]): boolean {
  return requiredMechanisms.every(mechanism =>
    (KWOK_PROVEN_MECHANISMS as RequiredMechanism[]).includes(mechanism)
  );
}
