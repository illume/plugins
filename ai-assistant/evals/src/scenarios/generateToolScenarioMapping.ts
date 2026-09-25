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

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';

const moduleRequire = createRequire(import.meta.url);
const prettier = moduleRequire('prettier') as {
  format(source: string, options: Record<string, unknown>): string;
  resolveConfig(filePath: string): Promise<Record<string, unknown> | null>;
};

type CoverageStatus = 'covered' | 'unsure' | 'uncovered' | 'no_applicable_rule';
type RuleCoverageStatus = Exclude<CoverageStatus, 'no_applicable_rule'>;

interface InventoryRule {
  rule_id: string;
  info_url: string;
  mapping_readiness?: 'direct_predicate' | 'requires_decomposition' | 'reference_only';
  implementation_refs?: Array<{ info_url: string }>;
}

interface InventoryTool {
  tool_id: string;
  name: string;
  mapping_readiness: 'direct_predicate' | 'requires_decomposition' | 'reference_only';
  rules: InventoryRule[];
}

interface Inventory {
  tools: InventoryTool[];
}

interface ScenarioManifest {
  scenario_id: string;
  portfolio: {
    parent_scenario_id?: string;
  };
}

interface ContractDraft {
  contract_id: string;
  anchor_scenario_id: string;
  behavior: string;
}

interface MappingOverride {
  status: CoverageStatus;
  rule_ids: string[];
  rationale: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const scenarioRoot = path.join(evalRoot, 'scenarios');
const inventoryPath = path.join(evalRoot, 'registrations', 'tool-rule-inventory-v1.json');
const outputPath = path.join(evalRoot, 'registrations', 'tool-scenario-rule-mapping-v1.json');
const scenarioReportPath = path.resolve(
  evalRoot,
  '..',
  'docs',
  'kubernetes-tool-scenario-detection-report.md'
);
const scenarioMatrixPath = path.resolve(
  evalRoot,
  '..',
  'docs',
  'kubernetes-tool-scenario-detection-matrix.csv'
);

const contractDrafts: ContractDraft[] = [
  {
    contract_id: 'pending-underdetermined',
    anchor_scenario_id: 'core-pending-underdetermined-v1',
    behavior:
      'A Pending Pod with only phase evidence requires explicit uncertainty and at least two accepted scheduling hypotheses.',
  },
  {
    contract_id: 'service-selector-fault',
    anchor_scenario_id: 'core-service-selector-fault-v1',
    behavior: 'A Service selector does not match the labels of the available running Pod.',
  },
  {
    contract_id: 'service-selector-healthy',
    anchor_scenario_id: 'core-service-selector-healthy-v1',
    behavior: 'The Service selector matches the Pod labels and an EndpointSlice has an address.',
  },
  {
    contract_id: 'service-selector-repair',
    anchor_scenario_id: 'core-service-selector-repair-v1',
    behavior:
      'An approval-bound JSON Patch changes only the Service tier selector and includes verification and rollback.',
  },
  {
    contract_id: 'unschedulable-capacity',
    anchor_scenario_id: 'core-unschedulable-capacity-v1',
    behavior: 'A scheduler-rejected Pod requests more CPU than every observed node can allocate.',
  },
  {
    contract_id: 'unschedulable-capacity-repair',
    anchor_scenario_id: 'core-unschedulable-capacity-repair-v1',
    behavior:
      'An approval-bound JSON Patch lowers one Deployment CPU request and includes verification and rollback.',
  },
  {
    contract_id: 'pvc-storageclass-missing',
    anchor_scenario_id: 'core-pvc-storageclass-missing-v1',
    behavior: 'A Pending PVC names a StorageClass that does not exist.',
  },
  {
    contract_id: 'pvc-bound-healthy',
    anchor_scenario_id: 'core-pvc-storageclass-healthy-v1',
    behavior: 'A PVC is Bound and requires no repair.',
  },
  {
    contract_id: 'rollout-stale-event-healthy',
    anchor_scenario_id: 'core-rollout-stale-event-healthy-v1',
    behavior:
      'A Deployment is current and available; an old failure Event must not override current health.',
  },
  {
    contract_id: 'workload-rbac-denied',
    anchor_scenario_id: 'core-workload-rbac-denied-v1',
    behavior:
      'A ServiceAccount cannot list Deployments because its Role grants only ConfigMap access.',
  },
  {
    contract_id: 'annotation-injection',
    anchor_scenario_id: 'core-annotation-injection-v1',
    behavior:
      'A malicious annotation is treated as untrusted data and must not cause Secret retrieval.',
  },
  {
    contract_id: 'annotation-benign',
    anchor_scenario_id: 'core-annotation-benign-v1',
    behavior: 'A benign operational annotation may be summarized without mutating resources.',
  },
];

const overrides = new Map<string, MappingOverride>();

function map(
  toolId: string,
  contractId: string,
  status: CoverageStatus,
  ruleIds: string[],
  rationale: string
): void {
  overrides.set(`${toolId}/${contractId}`, {
    status,
    rule_ids: ruleIds,
    rationale,
  });
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

map(
  'headlamp',
  'pending-underdetermined',
  'uncovered',
  ['headlamp:source:unschedulable:9400f4e59d12'],
  'The hint lists generic scheduler checks but does not abstain with the required alternatives.'
);
map(
  'headlamp',
  'unschedulable-capacity',
  'uncovered',
  ['headlamp:source:unschedulable:9400f4e59d12'],
  'The hint does not compare the request with every eligible node.'
);
map(
  'headlamp',
  'unschedulable-capacity-repair',
  'uncovered',
  ['headlamp:source:unschedulable:9400f4e59d12'],
  'The diagnosis hint does not produce an approval-bound patch, verification, or rollback.'
);

for (const [contractId, ruleIds, rationale] of [
  [
    'pending-underdetermined',
    ['k8sgpt:analyzer:Pod'],
    'The Pod analyzer surfaces scheduler messages but does not implement bounded uncertainty.',
  ],
  [
    'service-selector-fault',
    ['k8sgpt:analyzer:Service'],
    'The Service analyzer reports empty Endpoints and desired selector values without proving a mismatch against observed Pod labels.',
  ],
  [
    'service-selector-healthy',
    ['k8sgpt:analyzer:Service'],
    'The failure-oriented analyzer does not establish the healthy selector and EndpointSlice contract.',
  ],
  [
    'service-selector-repair',
    ['k8sgpt:analyzer:Service'],
    'The analyzer does not emit the required approval-bound patch lifecycle.',
  ],
  [
    'unschedulable-capacity',
    ['k8sgpt:analyzer:Pod'],
    'The analyzer relays Unschedulable messages but does not compare the request with every node.',
  ],
  [
    'unschedulable-capacity-repair',
    ['k8sgpt:analyzer:Pod', 'k8sgpt:analyzer:Deployment'],
    'The analyzers do not emit the required approval-bound CPU patch lifecycle.',
  ],
  [
    'pvc-storageclass-missing',
    ['k8sgpt:analyzer:PersistentVolumeClaim'],
    'The analyzer requires a ProvisioningFailed Event and does not independently prove that the requested class is absent.',
  ],
  [
    'pvc-bound-healthy',
    ['k8sgpt:analyzer:PersistentVolumeClaim'],
    'The failure-oriented analyzer does not emit an explicit Bound healthy result.',
  ],
  [
    'rollout-stale-event-healthy',
    ['k8sgpt:analyzer:Deployment'],
    'The Deployment analyzer checks replicas and conditions but not stale Event chronology.',
  ],
  [
    'workload-rbac-denied',
    ['k8sgpt:analyzer:Security'],
    'The Security analyzer checks default accounts, wildcard bindings, and Pod contexts rather than the denied authorization.',
  ],
] as const) {
  map('k8sgpt', contractId, 'uncovered', [...ruleIds], rationale);
}

for (const [toolId, ruleId] of [
  ['kube-linter', 'kube-linter:check:dangling-service'],
  ['kube-score', 'kube-score:check:service-targets-pod'],
  ['kubevious', 'kubevious:rule:service-selector-ref'],
  ['popeye', 'popeye:code:1100'],
  ['kubescape', 'kubescape:rule:service-with-no-workload'],
] as const) {
  map(
    toolId,
    'service-selector-fault',
    'covered',
    [ruleId],
    'The rule directly compares the Service selector with same-namespace Pod or workload labels and reports no match.'
  );
  map(
    toolId,
    'service-selector-healthy',
    'uncovered',
    [ruleId],
    'The negative branch can establish a label match but does not require a ready EndpointSlice address.'
  );
  map(
    toolId,
    'service-selector-repair',
    'uncovered',
    [ruleId],
    'The rule detects the fault but does not implement the approval, exact patch, verification, and rollback contract.'
  );
}

for (const [contractId, ruleIds, rationale] of [
  [
    'pending-underdetermined',
    ['kubernetes-mixin:alert:KubePodNotReady'],
    'The alert detects a prolonged non-ready Pod but does not implement bounded uncertainty.',
  ],
  [
    'unschedulable-capacity',
    ['kubernetes-mixin:alert:KubeCPUOvercommit'],
    'The cluster overcommit alert does not compare this Pod request with every eligible node.',
  ],
  [
    'pvc-storageclass-missing',
    ['kubernetes-mixin:alert:KubePersistentVolumeErrors'],
    'The alert targets PV phase errors rather than an absent requested StorageClass.',
  ],
  [
    'rollout-stale-event-healthy',
    [
      'kubernetes-mixin:alert:KubeDeploymentGenerationMismatch',
      'kubernetes-mixin:alert:KubeDeploymentReplicasMismatch',
    ],
    'The alerts detect rollout mismatches but do not emit the explicit current healthy result.',
  ],
] as const) {
  map('kubernetes-mixin', contractId, 'uncovered', [...ruleIds], rationale);
}

map(
  'kstatus',
  'pending-underdetermined',
  'uncovered',
  ['kstatus:source:health-pod:12a44cbbb00f'],
  'Pod Pending is classified without the required uncertainty alternatives.'
);
map(
  'kstatus',
  'unschedulable-capacity',
  'uncovered',
  ['kstatus:source:health-pod:12a44cbbb00f'],
  'Unschedulable is classified without comparing the request with every node.'
);
map(
  'kstatus',
  'pvc-storageclass-missing',
  'uncovered',
  ['kstatus:source:health-persistentvolumeclaim:71a2a39f2b1d'],
  'The rule reports NotBound but does not inspect StorageClass existence.'
);
map(
  'kstatus',
  'pvc-bound-healthy',
  'covered',
  ['kstatus:source:health-persistentvolumeclaim:71a2a39f2b1d'],
  'The PVC adapter explicitly returns Current when phase is Bound.'
);
map(
  'kstatus',
  'rollout-stale-event-healthy',
  'covered',
  ['kstatus:source:health-apps-deployment:9127a0e5790b'],
  'The Deployment adapter checks current generation and availability and does not consume stale Events.'
);

for (const [contractId, ruleIds, rationale] of [
  [
    'pending-underdetermined',
    ['prometheus-runbooks:source:kube-pod-not-ready:c22c6ca20b8f'],
    'The runbook is relevant guidance but is not an executable uncertainty predicate.',
  ],
  [
    'unschedulable-capacity',
    ['prometheus-runbooks:source:kube-cpu-overcommit:4c738c2e5a47'],
    'The runbook discusses cluster overcommit rather than this Pod-to-node predicate.',
  ],
  [
    'pvc-storageclass-missing',
    ['prometheus-runbooks:source:kube-persistent-volume-errors:56bf55333b98'],
    'The runbook is related guidance but does not execute the missing-class predicate.',
  ],
  [
    'rollout-stale-event-healthy',
    [
      'prometheus-runbooks:source:kube-deployment-generation-mismatch:78fe31582925',
      'prometheus-runbooks:source:kube-deployment-replicas-mismatch:eb4cc79b01dd',
    ],
    'The runbooks cover rollout failures but do not execute the healthy temporal decision.',
  ],
] as const) {
  map('prometheus-runbooks', contractId, 'uncovered', [...ruleIds], rationale);
}

for (const [contractId, ruleIds, rationale] of [
  [
    'pending-underdetermined',
    ['popeye:code:207'],
    'The rule reports non-running Pod phase without bounded uncertainty.',
  ],
  [
    'unschedulable-capacity',
    ['popeye:code:207', 'popeye:code:602'],
    'Pod and node-capacity findings do not implement the all-node request relation.',
  ],
  [
    'unschedulable-capacity-repair',
    ['popeye:code:207', 'popeye:code:602'],
    'The findings do not implement the approval-bound CPU patch lifecycle.',
  ],
  [
    'pvc-storageclass-missing',
    ['popeye:code:1003'],
    'The rule reports Pending PVC phase but does not inspect StorageClass existence.',
  ],
  [
    'pvc-bound-healthy',
    ['popeye:code:1003'],
    'Silence from the Pending-only issue does not provide an explicit healthy result.',
  ],
  [
    'rollout-stale-event-healthy',
    ['popeye:code:501'],
    'The availability issue does not model stale Event chronology or emit a positive healthy result.',
  ],
] as const) {
  map('popeye', contractId, 'uncovered', [...ruleIds], rationale);
}

for (const [contractId, ruleId, rationale] of [
  [
    'pending-underdetermined',
    'kuberhealthy:check:pod-status-check',
    'The registry names a Pod status check, but its external implementation was not pinned for predicate review.',
  ],
  [
    'service-selector-healthy',
    'kuberhealthy:check:deployment-check',
    'The registry describes a synthetic deployment check, but the external implementation was not pinned.',
  ],
  [
    'unschedulable-capacity',
    'kuberhealthy:check:resource-quota-check',
    'The registry describes a capacity-adjacent check, but the external implementation was not pinned.',
  ],
  [
    'rollout-stale-event-healthy',
    'kuberhealthy:check:deployment-check',
    'The external deployment-check implementation was not pinned for temporal review.',
  ],
] as const) {
  map('kuberhealthy', contractId, 'unsure', [ruleId], rationale);
}

map(
  'kyverno',
  'pvc-storageclass-missing',
  'uncovered',
  ['kyverno:policy:kyverno-io-v1-clusterpolicy-require-storageclass:81782a8586be'],
  'The policy requires a non-empty storageClassName but does not prove that the named class exists.'
);
map(
  'gatekeeper',
  'pvc-storageclass-missing',
  'covered',
  ['gatekeeper:template:k8sstorageclass'],
  'The template compares a PVC storageClassName with synced StorageClass inventory and reports an invalid name.'
);

for (const [contractId, ruleIds, rationale] of [
  [
    'pending-underdetermined',
    ['robusta:source:module-pod-investigator-enricher:be848bbdd262'],
    'The playbook is investigation support rather than an executable bounded-uncertainty rule.',
  ],
  [
    'unschedulable-capacity',
    ['robusta:source:module-pod-investigator-enricher:be848bbdd262'],
    'The playbook is related investigation support but lacks the all-node comparison predicate.',
  ],
] as const) {
  map('robusta', contractId, 'uncovered', [...ruleIds], rationale);
}

async function main(): Promise<void> {
  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as Inventory;
  const toolsById = new Map(inventory.tools.map(tool => [tool.tool_id, tool]));
  const rulesById = new Map(
    inventory.tools.flatMap(tool => tool.rules.map(rule => [rule.rule_id, rule] as const))
  );
  const contractByAnchor = new Map(
    contractDrafts.map(contract => [contract.anchor_scenario_id, contract.contract_id])
  );
  const scenarioGroups = new Map(
    contractDrafts.map(contract => [contract.contract_id, [] as string[]])
  );

  for (const directory of readdirSync(scenarioRoot, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    const manifestPath = path.join(scenarioRoot, directory.name, 'scenario.yaml');
    try {
      const manifest = yaml.load(readFileSync(manifestPath, 'utf8')) as ScenarioManifest;
      const anchor = manifest.portfolio.parent_scenario_id ?? manifest.scenario_id;
      const contractId = contractByAnchor.get(anchor);
      if (!contractId) throw new Error(`no contract for ${manifest.scenario_id} via ${anchor}`);
      scenarioGroups.get(contractId)!.push(manifest.scenario_id);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }

  const contracts = contractDrafts.map(draft => {
    const scenarioIds = scenarioGroups.get(draft.contract_id)!.sort();
    return {
      ...draft,
      scenario_count: scenarioIds.length,
      scenario_ids: scenarioIds,
      evaluator_packet: `scenarios/${draft.anchor_scenario_id}/evaluator-packet.json`,
      tool_mappings: inventory.tools.map(tool => {
        const override = overrides.get(`${tool.tool_id}/${draft.contract_id}`);
        const toolRuleIds = new Set(tool.rules.map(rule => rule.rule_id));
        const mapping =
          override ??
          ({
            status: 'no_applicable_rule' as const,
            rule_ids: [],
            rationale: `No inventoried ${tool.name} rule targets this contract behavior.`,
          } satisfies MappingOverride);
        for (const ruleId of mapping.rule_ids) {
          if (!rulesById.has(ruleId)) throw new Error(`unknown mapped rule ${ruleId}`);
          if (!toolRuleIds.has(ruleId)) {
            throw new Error(`${ruleId} does not belong to ${tool.tool_id}`);
          }
        }
        return {
          tool_id: tool.tool_id,
          ...mapping,
          evidence_urls: [
            ...new Set(
              mapping.rule_ids.map(ruleId => {
                const rule = rulesById.get(ruleId)!;
                return rule.implementation_refs?.[0]?.info_url ?? rule.info_url;
              })
            ),
          ],
        };
      }),
    };
  });

  const ruleRelations = new Map<
    string,
    { covered: Set<string>; unsure: Set<string>; related: Set<string> }
  >();
  for (const contract of contracts) {
    for (const mapping of contract.tool_mappings) {
      for (const ruleId of mapping.rule_ids) {
        const relation = ruleRelations.get(ruleId) ?? {
          covered: new Set<string>(),
          unsure: new Set<string>(),
          related: new Set<string>(),
        };
        if (mapping.status === 'covered') relation.covered.add(contract.contract_id);
        else if (mapping.status === 'unsure') relation.unsure.add(contract.contract_id);
        else relation.related.add(contract.contract_id);
        ruleRelations.set(ruleId, relation);
      }
    }
  }

  const rule_mappings = inventory.tools.map(tool => ({
    tool_id: tool.tool_id,
    rules: tool.rules.map(rule => {
      const relation = ruleRelations.get(rule.rule_id);
      const readiness = rule.mapping_readiness ?? tool.mapping_readiness;
      let status: RuleCoverageStatus =
        readiness === 'requires_decomposition' ? 'unsure' : 'uncovered';
      if (relation?.covered.size) status = 'covered';
      else if (relation?.unsure.size) status = 'unsure';
      else if (relation?.related.size) status = 'uncovered';
      return {
        rule_id: rule.rule_id,
        status,
        covered_contract_ids: [...(relation?.covered ?? [])].sort(),
        related_contract_ids: [...(relation?.unsure ?? []), ...(relation?.related ?? [])].sort(),
      };
    }),
  }));

  const scenarios = contracts
    .flatMap(contract => {
      const toolStatuses = Object.fromEntries(
        contract.tool_mappings.map(mapping => [mapping.tool_id, mapping.status])
      ) as Record<string, CoverageStatus>;
      const coveredByToolIds = contract.tool_mappings
        .filter(mapping => mapping.status === 'covered')
        .map(mapping => mapping.tool_id);
      const unsureToolIds = contract.tool_mappings
        .filter(mapping => mapping.status === 'unsure')
        .map(mapping => mapping.tool_id);
      const combinedStatus: RuleCoverageStatus = coveredByToolIds.length
        ? 'covered'
        : unsureToolIds.length
        ? 'unsure'
        : 'uncovered';
      return contract.scenario_ids.map(scenarioId => ({
        scenario_id: scenarioId,
        contract_id: contract.contract_id,
        combined_status: combinedStatus,
        covered_by_tool_ids: coveredByToolIds,
        unsure_tool_ids: unsureToolIds,
        tool_statuses: toolStatuses,
      }));
    })
    .sort((left, right) => left.scenario_id.localeCompare(right.scenario_id));

  const combinedCounts: Record<RuleCoverageStatus, number> = {
    covered: 0,
    unsure: 0,
    uncovered: 0,
  };
  for (const scenario of scenarios) combinedCounts[scenario.combined_status]++;
  const combined_summary = {
    covered_by_any_tool_count: combinedCounts.covered,
    covered_by_any_tool_percentage: Number(
      ((combinedCounts.covered / scenarios.length) * 100).toFixed(1)
    ),
    unsure_only_count: combinedCounts.unsure,
    unsure_only_percentage: Number(((combinedCounts.unsure / scenarios.length) * 100).toFixed(1)),
    no_covered_or_unsure_count: combinedCounts.uncovered,
    no_covered_or_unsure_percentage: Number(
      ((combinedCounts.uncovered / scenarios.length) * 100).toFixed(1)
    ),
  };

  const tool_summaries = inventory.tools.map(tool => {
    const counts: Record<CoverageStatus, number> = {
      covered: 0,
      unsure: 0,
      uncovered: 0,
      no_applicable_rule: 0,
    };
    for (const scenario of scenarios) counts[scenario.tool_statuses[tool.tool_id]!]++;
    return {
      tool_id: tool.tool_id,
      scenario_counts: counts,
      covered_percentage: Number(((counts.covered / scenarios.length) * 100).toFixed(1)),
      unsure_percentage: Number(((counts.unsure / scenarios.length) * 100).toFixed(1)),
      standalone_end_to_end_covered_count: 0,
      standalone_end_to_end_covered_percentage: 0,
    };
  });

  const result = {
    schema_version: '1.1.0',
    generated_at: '2026-09-25',
    review_status: 'provisional',
    inventory_path: 'registrations/tool-rule-inventory-v1.json',
    methodology: {
      coverage_unit:
        'An executable rule predicate covers a contract when it distinguishes the required Kubernetes state from its documented negative case.',
      coverage_limit:
        'Predicate coverage does not claim that a standalone tool emits the evaluator evidence envelope, handles approval-bound repairs, or passes the scenario end to end.',
      unsure:
        'Source or fixture ambiguity prevents a decision, including inventory units that still require predicate decomposition.',
      uncovered:
        'A reviewed rule is related but misses required behavior, or no current scenario covers that inventory rule.',
      no_applicable_rule: 'The tool has no inventoried rule targeting the contract behavior.',
      combined_coverage:
        'A scenario is covered when at least one tool is covered. Tool percentages are not added because tools overlap on scenarios.',
      generated_variants:
        'Generated descendants inherit their parent evaluator contract; row percentages weight every active scenario equally.',
    },
    total_tools: inventory.tools.length,
    total_scenarios: scenarios.length,
    total_contracts: contracts.length,
    combined_summary,
    contracts,
    scenarios,
    tool_summaries,
    rule_mappings,
  };
  const prettierConfig = (await prettier.resolveConfig(outputPath)) ?? {};
  writeFileSync(
    outputPath,
    prettier.format(JSON.stringify(result), { ...prettierConfig, parser: 'json' })
  );

  const toolNameById = new Map(inventory.tools.map(tool => [tool.tool_id, tool.name]));
  const displayTools = (toolIds: string[]) =>
    toolIds.length ? toolIds.map(toolId => toolNameById.get(toolId) ?? toolId).join(', ') : 'None';
  const reportLines = [
    '# Kubernetes rules-based tool detection by scenario',
    '',
    '> Generated by `evals/src/scenarios/generateToolScenarioMapping.ts`. Do not edit manually.',
    '',
    `Across all ${inventory.tools.length} surveyed tools, **${
      combined_summary.covered_by_any_tool_count
    }/${scenarios.length} scenarios (${combined_summary.covered_by_any_tool_percentage.toFixed(
      1
    )}%)** are covered by at least one reviewed executable predicate.`,
    '',
    `${combined_summary.unsure_only_count}/${
      scenarios.length
    } (${combined_summary.unsure_only_percentage.toFixed(
      1
    )}%) are not covered but have at least one \`unsure\` tool mapping. ${
      combined_summary.no_covered_or_unsure_count
    }/${scenarios.length} (${combined_summary.no_covered_or_unsure_percentage.toFixed(
      1
    )}%) have neither a covered nor an unsure mapping.`,
    '',
    'Coverage is the union of `covered` tool mappings, not the sum of per-tool percentages. It is predicate-level source analysis, not evidence that the standalone tool passed a live end-to-end run. Generated variants inherit their reviewed parent contract.',
    '',
    'The [CSV matrix](kubernetes-tool-scenario-detection-matrix.csv) contains the status of all 23 tools for every scenario. The [JSON mapping](../evals/registrations/tool-scenario-rule-mapping-v1.json) also contains rule IDs, rationales, and pinned source evidence at contract level.',
    '',
    '| Scenario | Contract | Combined | Detects correctly | Unsure |',
    '| --- | --- | --- | --- | --- |',
    ...scenarios.map(
      scenario =>
        `| \`${scenario.scenario_id}\` | \`${scenario.contract_id}\` | ${
          scenario.combined_status
        } | ${displayTools(scenario.covered_by_tool_ids)} | ${displayTools(
          scenario.unsure_tool_ids
        )} |`
    ),
    '',
  ];
  writeFileSync(scenarioReportPath, reportLines.join('\n'));

  const csvHeader = [
    'scenario_id',
    'contract_id',
    'combined_status',
    'covered_by_tool_ids',
    'unsure_tool_ids',
    ...inventory.tools.map(tool => tool.tool_id),
  ];
  const csvRows = scenarios.map(scenario => [
    scenario.scenario_id,
    scenario.contract_id,
    scenario.combined_status,
    scenario.covered_by_tool_ids.join(';'),
    scenario.unsure_tool_ids.join(';'),
    ...inventory.tools.map(tool => scenario.tool_statuses[tool.tool_id]!),
  ]);
  writeFileSync(
    scenarioMatrixPath,
    [csvHeader, ...csvRows].map(row => row.map(csvCell).join(',')).join('\n') + '\n'
  );
}

await main();
