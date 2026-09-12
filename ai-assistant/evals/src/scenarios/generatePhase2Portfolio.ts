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

import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';
import type {
  BehavioralStratum,
  CandidatePacket,
  EvaluatorPacket,
  ScenarioManifest,
} from '../contracts/evaluationContracts.js';
import { buildPortfolioCensus } from './admission.js';
import { loadAllScenarios } from './loader.js';

interface FamilyDraft {
  familyId: string;
  parentScenarioId: string;
  stratum: BehavioralStratum;
  variants: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', 'scenarios');
const markerFile = '.phase2-generated.json';

const familyDrafts: FamilyDraft[] = [
  ...familyGroup(
    'fault_diagnosis',
    [11, 11, 11, 11, 11, 11, 10, 10, 10],
    [
      ['service-discovery', 'core-service-selector-fault-v1'],
      ['scheduling-capacity', 'core-unschedulable-capacity-v1'],
      ['storage-provisioning', 'core-pvc-storageclass-missing-v1'],
      ['workload-authorization', 'core-workload-rbac-denied-v1'],
      ['image-resolution', 'core-service-selector-fault-v1'],
      ['workload-configuration-reference', 'core-pvc-storageclass-missing-v1'],
      ['health-probe-readiness', 'core-service-selector-fault-v1'],
      ['node-placement-constraints', 'core-unschedulable-capacity-v1'],
      ['deployment-availability', 'core-rollout-stale-event-healthy-v1'],
    ]
  ),
  ...familyGroup(
    'healthy_control',
    [12, 12, 12, 11],
    [
      ['temporal-reconciliation', 'core-rollout-stale-event-healthy-v1'],
      ['controller-convergence', 'core-rollout-stale-event-healthy-v1'],
      ['service-routing-health', 'core-service-selector-healthy-v1'],
      ['storage-binding-health', 'core-pvc-storageclass-healthy-v1'],
    ]
  ),
  ...familyGroup(
    'insufficient_evidence',
    [12, 11, 11],
    [
      ['scheduling-uncertainty', 'core-pending-underdetermined-v1'],
      ['evidence-freshness', 'core-pending-underdetermined-v1'],
      ['partial-tool-observation', 'core-pending-underdetermined-v1'],
    ]
  ),
  ...familyGroup(
    'approved_repair',
    [10, 10, 9, 9],
    [
      ['selector-repair-safety', 'core-service-selector-repair-v1'],
      ['capacity-repair-safety', 'core-unschedulable-capacity-repair-v1'],
      ['workload-config-repair', 'core-service-selector-repair-v1'],
      ['rollout-repair-safety', 'core-unschedulable-capacity-repair-v1'],
    ]
  ),
  ...familyGroup(
    'security_prompt_injection',
    [10, 9, 9],
    [
      ['untrusted-resource-content', 'core-annotation-injection-v1'],
      ['least-privilege-boundary', 'core-annotation-injection-v1'],
      ['sensitive-data-disclosure', 'core-annotation-benign-v1'],
    ]
  ),
  ...familyGroup(
    'multi_turn_tool_failure',
    [10, 10],
    [
      ['transient-tool-recovery', 'core-pending-underdetermined-v1'],
      ['malformed-tool-result', 'core-pending-underdetermined-v1'],
    ]
  ),
];

function familyGroup(
  stratum: BehavioralStratum,
  counts: number[],
  families: Array<[string, string]>
): FamilyDraft[] {
  return families.map(([familyId, parentScenarioId], index) => ({
    familyId,
    parentScenarioId,
    stratum,
    variants: counts[index]!,
  }));
}

function generatedDirectories(): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('phase2-'))
    .map(entry => path.join(root, entry.name));
}

function clearGeneratedPortfolio(): void {
  for (const directory of generatedDirectories()) {
    if (!existsSync(path.join(directory, markerFile))) {
      throw new Error(`refusing to replace unmarked scenario directory ${directory}`);
    }
    rmSync(directory, { recursive: true });
  }
}

function generatedSetup(parentSetup: string, scenarioId: string, distractorCount: number): string {
  const additions = Array.from(
    { length: distractorCount },
    (_, index) => `
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: draft-distractor-${index + 1}
  labels:
    evals.headlamp.dev/variant: ${scenarioId}
data:
  note: ${JSON.stringify(`Benign qualification distractor ${index + 1} for ${scenarioId}`)}
`
  );
  return `${parentSetup.trimEnd()}\n${additions.join('')}`;
}

function generateVariant(family: FamilyDraft, ordinal: number): void {
  const suffix = String(ordinal).padStart(2, '0');
  const scenarioId = `phase2-${family.familyId}-${suffix}-v1`;
  const parentDirectory = path.join(root, family.parentScenarioId);
  const destination = path.join(root, scenarioId);
  cpSync(parentDirectory, destination, { recursive: true });

  const manifestPath = path.join(destination, 'scenario.yaml');
  const manifest = yaml.load(readFileSync(manifestPath, 'utf8')) as ScenarioManifest;
  manifest.scenario_id = scenarioId;
  manifest.scenario_version = '1.0.0';
  manifest.family = family.familyId;
  manifest.title = `${manifest.title} (variant ${suffix})`;
  manifest.description =
    `${manifest.description.trim()} Reviewed variant ${suffix} adds ` +
    `${ordinal % 3} benign fixture distractor(s).`;
  manifest.provenance = {
    ...manifest.provenance,
    admission_date: '2026-09-10',
    last_review: '2026-09-12',
    review_due: '2026-12-11',
    lifecycle_state: 'active',
  };
  manifest.portfolio = {
    phase: 2,
    visibility: 'public',
    behavioral_stratum: family.stratum,
    family_id: family.familyId,
    lineage_id: manifest.portfolio.lineage_id,
    variant_kind: 'generated',
    parent_scenario_id: family.parentScenarioId,
    splits: ordinal % 5 === 0 ? ['regression', 'capability'] : ['development'],
    qualification_status: 'qualified',
    qualification_controls: {
      provenance: 'passed',
      rights: 'passed',
      family_lineage: 'passed',
      mechanism_oracle: 'passed',
      candidate_view: 'passed',
      setup: 'passed',
      observation_capture: 'passed',
      cleanup: 'passed',
      leakage: 'passed',
    },
    reviewed_by: ['René Dudfield'],
    qualified_at: '2026-09-12T00:00:00Z',
  };
  manifest.supported_cluster_profiles = ['local-minikube', 'aks'];
  manifest.namespace_prefix = `eval-p2-${createHash('sha256')
    .update(scenarioId)
    .digest('hex')
    .slice(0, 12)}`;
  writeFileSync(manifestPath, yaml.dump(manifest, { lineWidth: 100, noRefs: true }));

  const candidatePath = path.join(destination, 'candidate-packet.json');
  const candidate = JSON.parse(readFileSync(candidatePath, 'utf8')) as CandidatePacket;
  candidate.scenario_id = scenarioId;
  candidate.scenario_version = manifest.scenario_version;
  candidate.task_prompt = `${candidate.task_prompt} This is portfolio variant ${suffix}.`;
  writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`);

  const evaluatorPath = path.join(destination, 'evaluator-packet.json');
  const evaluator = JSON.parse(readFileSync(evaluatorPath, 'utf8')) as EvaluatorPacket;
  evaluator.scenario_id = scenarioId;
  evaluator.scenario_version = manifest.scenario_version;
  evaluator.secret_canary = `EVAL-CANARY-PHASE2-${createHash('sha256')
    .update(scenarioId)
    .digest('hex')
    .slice(0, 16)}`;
  writeFileSync(evaluatorPath, `${JSON.stringify(evaluator, null, 2)}\n`);

  const setupPath = path.join(destination, manifest.setup_manifest_path);
  writeFileSync(
    setupPath,
    generatedSetup(readFileSync(setupPath, 'utf8'), scenarioId, ordinal % 3)
  );
  writeFileSync(
    path.join(destination, markerFile),
    `${JSON.stringify(
      { schema_version: '1.0.0', parent_scenario_id: family.parentScenarioId },
      null,
      2
    )}\n`
  );
}

function main(): void {
  clearGeneratedPortfolio();
  for (const family of familyDrafts) {
    for (let ordinal = 1; ordinal <= family.variants; ordinal++) generateVariant(family, ordinal);
  }

  const census = buildPortfolioCensus(loadAllScenarios(root));
  const expected = {
    fault_diagnosis: 100,
    healthy_control: 50,
    insufficient_evidence: 35,
    approved_repair: 40,
    security_prompt_injection: 30,
    multi_turn_tool_failure: 20,
  } satisfies Record<BehavioralStratum, number>;
  if (
    census.total !== 275 ||
    census.families !== 25 ||
    Object.entries(expected).some(
      ([stratum, count]) => census.by_stratum[stratum as BehavioralStratum] !== count
    )
  ) {
    throw new Error(`generated portfolio failed census: ${JSON.stringify(census)}`);
  }
  console.log(JSON.stringify(census, null, 2));
}

main();
