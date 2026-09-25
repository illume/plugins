import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SCENARIOS_GOAL } from './scenariosGoal.js';
import { v6ScenarioCatalogSeeds } from './scenarioDraftDefinitionsV6.js';

const moduleRequire = createRequire(import.meta.url);
const prettier = moduleRequire('prettier') as {
  format(source: string, options: Record<string, unknown>): string;
  resolveConfig(filePath: string): Promise<Record<string, unknown> | null>;
};

interface InventoryRule {
  rule_id: string;
  semantic_group_id: string;
  info_url: string;
  mapping_readiness?: 'direct_predicate' | 'requires_decomposition' | 'reference_only';
}

interface InventoryTool {
  tool_id: string;
  revision: string;
  mapping_readiness: 'direct_predicate' | 'requires_decomposition' | 'reference_only';
  rules: InventoryRule[];
}

interface PriorCatalogue {
  scenarios: Array<{
    target_rule_ids: string[];
    target_semantic_group_ids: string[];
    target_canonical_capability_ids?: string[];
  }>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const registrations = path.join(evalRoot, 'registrations');
const inventoryPath = path.join(registrations, 'tool-rule-inventory-v1.json');
const mappingPath = path.join(registrations, 'tool-scenario-rule-mapping-v1.json');
const priorPaths = ['v1', 'v2', 'v3', 'v4', 'v5'].map(version =>
  path.join(registrations, `rule-gap-scenarios-${version}.json`)
);
const outputPath = path.join(registrations, 'rule-gap-scenarios-v6.json');
const documentationPath = path.resolve(
  evalRoot,
  '..',
  'docs',
  'kubernetes-rule-gap-scenarios-v6.md'
);

const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as {
  tools: InventoryTool[];
};
const mapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as {
  rule_mappings: Array<{ rules: Array<{ rule_id: string; status: string }> }>;
};
const priorBatches = priorPaths.map(
  file => JSON.parse(readFileSync(file, 'utf8')) as PriorCatalogue
);
const inventoryRules = inventory.tools.flatMap(tool =>
  tool.rules.map(rule => ({
    ...rule,
    tool_id: tool.tool_id,
    revision: tool.revision,
    readiness: rule.mapping_readiness ?? tool.mapping_readiness,
  }))
);
const byId = new Map(inventoryRules.map(rule => [rule.rule_id, rule] as const));
const statusById = new Map(
  mapping.rule_mappings.flatMap(entry =>
    entry.rules.map(rule => [rule.rule_id, rule.status] as const)
  )
);
const priorTargetIds = new Set(
  priorBatches.flatMap(batch => batch.scenarios.flatMap(scenario => scenario.target_rule_ids))
);
const priorGroupIds = new Set(
  priorBatches.flatMap(batch =>
    batch.scenarios.flatMap(scenario => scenario.target_semantic_group_ids)
  )
);
const priorCanonicalIds = new Set(
  priorBatches.flatMap(batch =>
    batch.scenarios.flatMap(scenario => scenario.target_canonical_capability_ids ?? [])
  )
);

assert.equal(v6ScenarioCatalogSeeds.length, 115, 'expected exactly 115 v6 specifications');
const claimedRuleIds = new Set<string>();
const claimedGroupIds = new Set<string>();
const claimedCanonicalIds = new Set<string>();
const scenarios = v6ScenarioCatalogSeeds.map(seed => {
  const targetRules = seed.targetRuleIds
    .map(ruleId => {
      const rule = byId.get(ruleId);
      assert.ok(rule, `unknown target rule ${ruleId}`);
      return rule;
    })
    .sort((left, right) => left.rule_id.localeCompare(right.rule_id));
  const targetGroupIds = [...new Set(targetRules.map(rule => rule.semantic_group_id))].sort();
  for (const rule of targetRules) {
    assert.equal(rule.readiness, 'direct_predicate', `${rule.rule_id} is not direct`);
    assert.equal(statusById.get(rule.rule_id), 'uncovered', `${rule.rule_id} is not uncovered`);
    assert.equal(priorTargetIds.has(rule.rule_id), false, `${rule.rule_id} overlaps v1-v5`);
    assert.ok(rule.info_url.includes(rule.revision), `${rule.rule_id} URL is not revision-pinned`);
    assert.equal(claimedRuleIds.has(rule.rule_id), false, `${rule.rule_id} is targeted twice`);
    claimedRuleIds.add(rule.rule_id);
  }
  for (const groupId of targetGroupIds) {
    assert.equal(priorGroupIds.has(groupId), false, `${groupId} overlaps v1-v5`);
    assert.equal(claimedGroupIds.has(groupId), false, `${groupId} is targeted twice`);
    claimedGroupIds.add(groupId);
  }
  for (const capabilityId of seed.targetCanonicalCapabilityIds) {
    assert.equal(priorCanonicalIds.has(capabilityId), false, `${capabilityId} overlaps v1-v5`);
    assert.equal(claimedCanonicalIds.has(capabilityId), false, `${capabilityId} is targeted twice`);
    claimedCanonicalIds.add(capabilityId);
  }
  return {
    scenario_id: seed.scenarioId,
    title: seed.title,
    selection_track: seed.selectionTrack,
    category: seed.category,
    setup_summary: `Create the concrete ${seed.resources.join(
      ', '
    )} fixture encoded by the matching ScenarioDraftDefinition and a healthy control differing only in the trigger state.`,
    trigger_predicate: seed.trigger,
    expected_finding: `Identify ${seed.title.toLowerCase()} and cite the exact native evidence satisfying the trigger.`,
    healthy_condition: seed.healthy,
    required_resources: seed.resources,
    required_mechanisms: seed.requiredMechanisms,
    supported_cluster_profiles: seed.supportedClusterProfiles,
    feasibility: seed.feasibility,
    target_rule_ids: targetRules.map(rule => rule.rule_id),
    target_semantic_group_ids: targetGroupIds,
    target_canonical_capability_ids: seed.targetCanonicalCapabilityIds,
    target_tool_ids: [...new Set(targetRules.map(rule => rule.tool_id))].sort(),
    target_rule_count: targetRules.length,
    provenance_refs: [...new Set(targetRules.map(rule => rule.info_url))].sort(),
    lifecycle_state: 'draft',
    qualification_status: 'pending',
    qualification_blockers: [
      { kind: 'setup', detail: 'Generate and validate the isolated fixture and healthy control.' },
      {
        kind: 'observation',
        detail: 'Prove the required native evidence is stable for a bounded observation window.',
      },
      {
        kind: 'oracle',
        detail: 'Freeze exact positive, healthy-control, and contradiction assertions.',
      },
      {
        kind: 'leakage',
        detail:
          'Keep source rule identities and expected findings out of candidate-visible inputs.',
      },
    ],
  };
});

const summarize = <T extends string>(
  values: T[],
  count: (value: T) => number
): Record<string, number> =>
  Object.fromEntries([...new Set(values)].sort().map(value => [value, count(value)]));
const targetIds = scenarios.flatMap(scenario => scenario.target_rule_ids);
const targetGroups = new Set(scenarios.flatMap(scenario => scenario.target_semantic_group_ids));
const targetCapabilities = new Set(
  scenarios.flatMap(scenario => scenario.target_canonical_capability_ids)
);
const targetTools = new Set(scenarios.flatMap(scenario => scenario.target_tool_ids));
const categoryCounts = Object.fromEntries(
  [
    'workload_configuration',
    'control_plane_host_hardening',
    'runtime_node_failure',
    'operations_deprecation',
  ].map(category => [category, scenarios.filter(scenario => scenario.category === category).length])
);
const coverageByTool = summarize(
  targetIds.map(ruleId => byId.get(ruleId)!.tool_id),
  toolId => targetIds.filter(ruleId => byId.get(ruleId)!.tool_id === toolId).length
);
const coverageByFeasibility = summarize(
  scenarios.map(scenario => scenario.feasibility),
  feasibility =>
    scenarios
      .filter(scenario => scenario.feasibility === feasibility)
      .reduce((total, scenario) => total + scenario.target_rule_count, 0)
);
const scenarioCountsByFeasibility = summarize(
  scenarios.map(scenario => scenario.feasibility),
  feasibility => scenarios.filter(scenario => scenario.feasibility === feasibility).length
);
const coverageBySelectionTrack = summarize(
  scenarios.map(scenario => scenario.selection_track),
  track =>
    scenarios
      .filter(scenario => scenario.selection_track === track)
      .reduce((total, scenario) => total + scenario.target_rule_count, 0)
);
const scenarioCountsBySelectionTrack = summarize(
  scenarios.map(scenario => scenario.selection_track),
  track => scenarios.filter(scenario => scenario.selection_track === track).length
);

const document = {
  schema_version: '1.0.0',
  batch_id: 'rule-gap-scenarios-v6',
  generated_at: '2026-09-20',
  review_status: 'provisional',
  inventory_path: 'registrations/tool-rule-inventory-v1.json',
  mapping_path: 'registrations/tool-scenario-rule-mapping-v1.json',
  prior_batch_path: 'registrations/rule-gap-scenarios-v1.json',
  scenarios_goal: SCENARIOS_GOAL,
  optimization_objective:
    'Select exactly 115 untargeted canonical capabilities with priority for Kubernetes manifest/API-observable predicates, while using inert normalized-predicate fixtures for host, cloud, and runtime evidence that cannot be safely applied.',
  methodology: {
    selection:
      'Freeze exactly 115 currently untargeted canonical capabilities, one capability per scenario, prioritizing non-kube-bench-only manifest and API-observable predicates from Popeye, Pluto, Headlamp, Kubescape, and kube-bench plus Kubescape overlaps.',
    deduplication:
      'Reject any active or v1-v5 rule, semantic-group, or canonical-capability overlap and require unique canonical target sets across all authored scenarios.',
    qualification:
      'Keep every v6 specification draft and pending until setup, observation, oracle, and leakage blockers are resolved.',
    external_tool_execution: false,
  },
  total_scenarios: scenarios.length,
  total_target_rules: targetIds.length,
  total_target_semantic_groups: targetGroups.size,
  total_target_canonical_capabilities: targetCapabilities.size,
  category_counts: categoryCounts,
  coverage_by_tool: coverageByTool,
  coverage_by_feasibility: coverageByFeasibility,
  scenario_counts_by_feasibility: scenarioCountsByFeasibility,
  coverage_by_selection_track: coverageBySelectionTrack,
  scenario_counts_by_selection_track: scenarioCountsBySelectionTrack,
  scenarios,
};

const prettierConfig = (await prettier.resolveConfig(outputPath)) ?? {};
writeFileSync(
  outputPath,
  prettier.format(JSON.stringify(document), { ...prettierConfig, parser: 'json' })
);

const markdown = [
  '# Kubernetes rule-gap draft scenarios v6',
  '',
  'Status: draft and pending, 2026-09-20',
  '',
  'This sixth catalogue freezes 115 new authored scenarios against currently',
  'untargeted canonical capabilities. Its machine-readable source is',
  '[`rule-gap-scenarios-v6.json`](../evals/registrations/rule-gap-scenarios-v6.json),',
  'generated by',
  '[`generateRuleGapScenariosV6.ts`](../evals/src/scenarios/generateRuleGapScenariosV6.ts).',
  '',
  '## Scenarios Goal',
  '',
  `> ${SCENARIOS_GOAL.statement}`,
  '',
  'These drafts target canonical capabilities, not raw rule groups. Surveyed tools are',
  'provenance inputs only; the generated fixtures rely on native Kubernetes evidence or',
  'explicit inert normalized-predicate ConfigMap fixtures for host, cloud, and runtime',
  'states that cannot be safely applied.',
  '',
  '## Marginal coverage',
  '',
  `The 115 drafts add **${targetIds.length}** exact target occurrences in`,
  `**${targetGroups.size}** semantic groups across **${targetCapabilities.size}** canonical capabilities and **${targetTools.size}** tools.`,
  '',
  '| Tool | Occurrences |',
  '| --- | ---: |',
  ...Object.entries(coverageByTool).map(([tool, count]) => `| ${tool} | ${count} |`),
  '',
  '| Selection track | Drafts | Occurrences |',
  '| --- | ---: | ---: |',
  ...Object.entries(scenarioCountsBySelectionTrack).map(
    ([track, count]) => `| ${track} | ${count} | ${coverageBySelectionTrack[track]} |`
  ),
  '',
  '| Feasibility | Drafts | Occurrences |',
  '| --- | ---: | ---: |',
  ...Object.entries(scenarioCountsByFeasibility).map(
    ([feasibility, count]) =>
      `| ${feasibility} | ${count} | ${coverageByFeasibility[feasibility]} |`
  ),
  '',
  '## Draft catalogue',
  '',
  '| Scenario ID | Canonical capabilities | Title | Occurrences | Tools |',
  '| --- | ---: | --- | ---: | ---: |',
  ...scenarios.map(
    scenario =>
      `| ${scenario.scenario_id} | ${scenario.target_canonical_capability_ids.length} | ${scenario.title} | ${scenario.target_rule_count} | ${scenario.target_tool_ids.length} |`
  ),
  '',
].join('\n');
const markdownConfig = (await prettier.resolveConfig(documentationPath)) ?? {};
writeFileSync(
  documentationPath,
  prettier.format(markdown, { ...markdownConfig, parser: 'markdown' })
);

console.log(
  `Wrote ${scenarios.length} v6 drafts targeting ${targetIds.length} rule occurrences in ${targetGroups.size} semantic groups across ${targetCapabilities.size} canonical capabilities.`
);
