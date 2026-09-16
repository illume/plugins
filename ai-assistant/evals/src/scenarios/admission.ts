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

import type {
  BehavioralStratum,
  DatasetSplit,
  ScenarioManifest,
} from '../contracts/evaluationContracts.js';
import { sha256OfJson, type JsonValue } from '../canonicalJson.js';
import type { LoadedScenario } from './loader.js';

/** Optional portfolio filters accepted by the Phase 2 runner. */
export interface ScenarioSelection {
  phase?: 1 | 2;
  split?: DatasetSplit;
  stratum?: BehavioralStratum;
}

/** Auditable public-portfolio census produced before scenario selection. */
export interface PortfolioCensus {
  total: number;
  qualified: number;
  pending: number;
  rejected: number;
  families: number;
  lineages: number;
  by_stratum: Record<BehavioralStratum, number>;
}

const qualificationControlNames = [
  'provenance',
  'rights',
  'family_lineage',
  'mechanism_oracle',
  'candidate_view',
  'setup',
  'observation_capture',
  'cleanup',
  'leakage',
] as const;

const behavioralStrata: BehavioralStratum[] = [
  'fault_diagnosis',
  'healthy_control',
  'insufficient_evidence',
  'approved_repair',
  'security_prompt_injection',
  'multi_turn_tool_failure',
];

/** Enforces cross-field admission and repair invariants that JSON Schema cannot express. */
export function assertScenarioAdmission(scenario: LoadedScenario): void {
  const { manifest, candidatePacket, evaluatorPacket } = scenario;
  const { portfolio } = manifest;
  const failedControls = qualificationControlNames.filter(
    name => portfolio.qualification_controls[name] !== 'passed'
  );

  if (portfolio.qualification_status === 'qualified') {
    if (failedControls.length > 0) {
      throw new Error(
        `scenario ${
          manifest.scenario_id
        }: qualified scenario has incomplete controls: ${failedControls.join(', ')}`
      );
    }
    if (portfolio.reviewed_by.length === 0 || !portfolio.qualified_at) {
      throw new Error(
        `scenario ${manifest.scenario_id}: qualified scenario requires reviewed_by and qualified_at`
      );
    }
  }
  if (
    manifest.provenance.lifecycle_state === 'active' &&
    portfolio.qualification_status !== 'qualified'
  ) {
    throw new Error(
      `scenario ${manifest.scenario_id}: active scenario must have qualification_status=qualified`
    );
  }

  const derived =
    portfolio.variant_kind === 'generated' || portfolio.variant_kind === 'transformed';
  if (derived !== Boolean(portfolio.parent_scenario_id)) {
    throw new Error(
      `scenario ${manifest.scenario_id}: ${portfolio.variant_kind} parent_scenario_id invariant failed`
    );
  }

  if (manifest.mode === 'repair') {
    if (
      !candidatePacket.allow_mutations ||
      !candidatePacket.action_policy ||
      candidatePacket.required_submission_schema !== 'repair_submission@1.0.0'
    ) {
      throw new Error(
        `scenario ${manifest.scenario_id}: repair mode requires mutations, action_policy, and repair_submission@1.0.0`
      );
    }
    const acceptedRepairs = evaluatorPacket.accepted_actions.filter(
      action => action.operation === 'json_patch'
    );
    const policy = candidatePacket.action_policy;
    const acceptedPolicyEntries = new Set(
      acceptedRepairs.flatMap(action =>
        action.target_resource && action.patch
          ? [`${action.target_resource}:${sha256OfJson(action.patch as unknown as JsonValue)}`]
          : []
      )
    );
    if (
      acceptedRepairs.length === 0 ||
      policy.allowed_patches.length !== acceptedPolicyEntries.size ||
      policy.allowed_patches.some(
        allowed =>
          !acceptedPolicyEntries.has(
            `${allowed.resource_ref}:${sha256OfJson(allowed.patch as unknown as JsonValue)}`
          )
      ) ||
      acceptedRepairs.some(
        action =>
          !action.target_resource ||
          !action.patch?.length ||
          !action.allowed_diff_paths?.length ||
          !action.postconditions?.length ||
          !action.rollback_patch?.length ||
          !policy?.allowed_resource_refs.includes(action.target_resource) ||
          !policy.allowed_patches.some(
            allowed =>
              allowed.resource_ref === action.target_resource &&
              sha256OfJson(allowed.patch as unknown as JsonValue) ===
                sha256OfJson(action.patch as unknown as JsonValue)
          )
      )
    ) {
      throw new Error(
        `scenario ${manifest.scenario_id}: repair actions require an allowed target, patch, diff paths, postconditions, and rollback`
      );
    }
  } else if (
    candidatePacket.allow_mutations ||
    candidatePacket.action_policy ||
    candidatePacket.required_submission_schema !== 'diagnosis_submission@1.0.0' ||
    evaluatorPacket.accepted_actions.some(action => action.operation !== 'no_action')
  ) {
    throw new Error(
      `scenario ${manifest.scenario_id}: diagnose_only scenarios must remain read-only`
    );
  }
}

/** Validates registry-wide identity/lineage rules and returns a public census. */
export function buildPortfolioCensus(scenarios: LoadedScenario[]): PortfolioCensus {
  const identities = new Set<string>();
  const byId = new Map(scenarios.map(scenario => [scenario.manifest.scenario_id, scenario]));
  const byStratum = Object.fromEntries(behavioralStrata.map(stratum => [stratum, 0])) as Record<
    BehavioralStratum,
    number
  >;

  for (const scenario of scenarios) {
    assertScenarioAdmission(scenario);
    const { manifest } = scenario;
    const identity = `${manifest.scenario_id}@${manifest.scenario_version}`;
    if (identities.has(identity)) throw new Error(`duplicate scenario identity: ${identity}`);
    identities.add(identity);
    byStratum[manifest.portfolio.behavioral_stratum] += 1;

    const parentId = manifest.portfolio.parent_scenario_id;
    if (parentId) {
      const parent = byId.get(parentId);
      if (!parent) {
        throw new Error(`scenario ${manifest.scenario_id}: parent scenario ${parentId} is missing`);
      }
      if (
        manifest.portfolio.qualification_status === 'qualified' &&
        parent.manifest.portfolio.qualification_status !== 'qualified'
      ) {
        throw new Error(
          `scenario ${manifest.scenario_id}: cannot qualify a descendant of unqualified ${parentId}`
        );
      }
      if (manifest.portfolio.lineage_id !== parent.manifest.portfolio.lineage_id) {
        throw new Error(
          `scenario ${manifest.scenario_id}: derived scenario must retain parent lineage ${parent.manifest.portfolio.lineage_id}`
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (scenarioId: string): void => {
    if (visiting.has(scenarioId)) {
      throw new Error(`scenario lineage contains a parent cycle at ${scenarioId}`);
    }
    if (visited.has(scenarioId)) return;
    visiting.add(scenarioId);
    const parentId = byId.get(scenarioId)?.manifest.portfolio.parent_scenario_id;
    if (parentId) visit(parentId);
    visiting.delete(scenarioId);
    visited.add(scenarioId);
  };
  for (const scenarioId of byId.keys()) visit(scenarioId);

  const statuses = scenarios.map(scenario => scenario.manifest.portfolio.qualification_status);
  return {
    total: scenarios.length,
    qualified: statuses.filter(status => status === 'qualified').length,
    pending: statuses.filter(status => status === 'pending').length,
    rejected: statuses.filter(status => status === 'rejected').length,
    families: new Set(scenarios.map(scenario => scenario.manifest.portfolio.family_id)).size,
    lineages: new Set(scenarios.map(scenario => scenario.manifest.portfolio.lineage_id)).size,
    by_stratum: byStratum,
  };
}

/** Applies prespecified Phase 2 portfolio filters without changing eligibility. */
export function matchesScenarioSelection(
  manifest: ScenarioManifest,
  selection: ScenarioSelection
): boolean {
  return (
    (selection.phase === undefined || manifest.portfolio.phase === selection.phase) &&
    (selection.split === undefined || manifest.portfolio.splits.includes(selection.split)) &&
    (selection.stratum === undefined || manifest.portfolio.behavioral_stratum === selection.stratum)
  );
}
