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

/**
 * Registry facade for scenario-specific cluster preflight and observations.
 * Implementations are grouped by Kubernetes mechanism under `cases/`; the
 * trial runner depends only on this stable lookup and shared case contract.
 */

import {
  capacityCase,
  capacityRepairCase,
  pendingUnderdeterminedCase,
} from './cases/schedulingCases.js';
import {
  selectorFaultCase,
  selectorHealthyCase,
  selectorRepairCase,
} from './cases/serviceSelectorCases.js';
import { healthyStorageClassCase, missingStorageClassCase } from './cases/storageCases.js';
import {
  annotationBenignCase,
  annotationInjectionCase,
  workloadRbacDeniedCase,
} from './cases/securityCases.js';
import { staleEventHealthyCase } from './cases/rolloutCases.js';
import type { ScenarioCaseLogic } from './cases/caseSupport.js';
import { PHASE_ONE_SCENARIO_IDS, PHASE_TWO_ANCHOR_IDS } from '../contracts/evaluationContracts.js';

export type { ObservationStep, PreflightOutcome, ScenarioCaseLogic } from './cases/caseSupport.js';
export { parseCpuCores } from './cases/schedulingCases.js';

const registry = {
  'core-service-selector-fault-v1': selectorFaultCase,
  'core-service-selector-healthy-v1': selectorHealthyCase,
  'core-unschedulable-capacity-v1': capacityCase,
  'core-pending-underdetermined-v1': pendingUnderdeterminedCase,
  'core-pvc-storageclass-missing-v1': missingStorageClassCase,
  'core-pvc-storageclass-healthy-v1': healthyStorageClassCase,
  'core-workload-rbac-denied-v1': workloadRbacDeniedCase,
  'core-rollout-stale-event-healthy-v1': staleEventHealthyCase,
  'core-service-selector-repair-v1': selectorRepairCase,
  'core-unschedulable-capacity-repair-v1': capacityRepairCase,
  'core-annotation-injection-v1': annotationInjectionCase,
  'core-annotation-benign-v1': annotationBenignCase,
} satisfies Record<
  (typeof PHASE_ONE_SCENARIO_IDS)[number] | (typeof PHASE_TWO_ANCHOR_IDS)[number],
  ScenarioCaseLogic
>;

/** Resolves registered behavior directly or through a generated variant's parent. */
export function caseLogicFor(scenarioId: string, parentScenarioId?: string): ScenarioCaseLogic {
  const registered = registry as Record<string, ScenarioCaseLogic>;
  const logic =
    registered[scenarioId] ?? (parentScenarioId ? registered[parentScenarioId] : undefined);
  if (!logic) {
    throw new Error(
      `no case logic registered for scenario ${scenarioId}` +
        (parentScenarioId ? ` or parent ${parentScenarioId}` : '')
    );
  }
  return logic;
}
