import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SCENARIOS_GOAL } from './scenariosGoal.js';
import { v9ScenarioCatalogSeeds } from './scenarioDraftDefinitionsV9.js';

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
const priorPaths = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7', 'v8'].map(version =>
  path.join(registrations, `rule-gap-scenarios-${version}.json`)
);
const outputPath = path.join(registrations, 'rule-gap-scenarios-v9.json');
const documentationPath = path.resolve(
  evalRoot,
  '..',
  'docs',
  'kubernetes-rule-gap-scenarios-v9.md'
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
const priorCanonicalIds = new Set(
  priorBatches.flatMap(batch =>
    batch.scenarios.flatMap(scenario => scenario.target_canonical_capability_ids ?? [])
  )
);

assert.equal(v9ScenarioCatalogSeeds.length, 218, 'expected exactly 218 v9 specifications');
const claimedRuleIds = new Set<string>();
const claimedCanonicalIds = new Set<string>();
const scenarios = v9ScenarioCatalogSeeds.map(seed => {
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
    assert.equal(priorTargetIds.has(rule.rule_id), false, `${rule.rule_id} overlaps v1-v8`);
    assert.ok(rule.info_url.includes(rule.revision), `${rule.rule_id} URL is not revision-pinned`);
    assert.equal(claimedRuleIds.has(rule.rule_id), false, `${rule.rule_id} is targeted twice`);
    claimedRuleIds.add(rule.rule_id);
  }
  for (const capabilityId of seed.targetCanonicalCapabilityIds) {
    assert.equal(priorCanonicalIds.has(capabilityId), false, `${capabilityId} overlaps v1-v8`);
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
const categoryCounts = {
  workload_configuration: 0,
  control_plane_host_hardening: scenarios.length,
  runtime_node_failure: 0,
  operations_deprecation: 0,
};

const document = {
  schema_version: '1.0.0',
  batch_id: 'rule-gap-scenarios-v9',
  generated_at: '2026-09-20',
  review_status: 'provisional',
  inventory_path: 'registrations/tool-rule-inventory-v1.json',
  mapping_path: 'registrations/tool-scenario-rule-mapping-v1.json',
  prior_batch_path: 'registrations/rule-gap-scenarios-v1.json',
  scenarios_goal: SCENARIOS_GOAL,
  optimization_objective:
    'Select exactly 218 untargeted kube-bench-only canonical capabilities with distinct concrete executable predicates while excluding non-executable artifacts and non-falsifiable recommendation prose.',
  methodology: {
    selection:
      'Freeze exactly 218 currently untargeted kube-bench-only canonical capabilities whose predicates resolve to explicit flags, files, RBAC mappings, admission plugins, audit settings, security-context fields, or concrete managed-cluster evidence.',
    deduplication:
      'Reject every active and v1-v8 overlap and require one canonical capability per scenario with unique canonical target sets across the authored portfolio.',
    qualification:
      'Keep every v9 specification draft and pending until setup, observation, oracle, and leakage blockers are resolved.',
    external_tool_execution: false,
  },
  total_scenarios: scenarios.length,
  total_target_rules: targetIds.length,
  total_target_semantic_groups: targetGroups.size,
  total_target_canonical_capabilities: targetCapabilities.size,
  category_counts: categoryCounts,
  coverage_by_tool: summarize(
    targetIds.map(ruleId => byId.get(ruleId)!.tool_id),
    toolId => targetIds.filter(ruleId => byId.get(ruleId)!.tool_id === toolId).length
  ),
  coverage_by_feasibility: summarize(
    scenarios.map(scenario => scenario.feasibility),
    feasibility =>
      scenarios
        .filter(scenario => scenario.feasibility === feasibility)
        .reduce((total, scenario) => total + scenario.target_rule_count, 0)
  ),
  scenario_counts_by_feasibility: summarize(
    scenarios.map(scenario => scenario.feasibility),
    feasibility => scenarios.filter(scenario => scenario.feasibility === feasibility).length
  ),
  coverage_by_selection_track: summarize(
    scenarios.map(scenario => scenario.selection_track),
    track =>
      scenarios
        .filter(scenario => scenario.selection_track === track)
        .reduce((total, scenario) => total + scenario.target_rule_count, 0)
  ),
  scenario_counts_by_selection_track: summarize(
    scenarios.map(scenario => scenario.selection_track),
    track => scenarios.filter(scenario => scenario.selection_track === track).length
  ),
  scenarios,
};

const prettierConfig = (await prettier.resolveConfig(outputPath)) ?? {};
writeFileSync(
  outputPath,
  prettier.format(JSON.stringify(document), { ...prettierConfig, parser: 'json' })
);

const markdown = [
  '# Kubernetes rule-gap draft scenarios v9',
  '',
  'Status: draft and pending, 2026-09-20',
  '',
  'This ninth catalogue freezes 218 new authored scenarios against currently',
  'untargeted kube-bench-only canonical capabilities with concrete executable',
  'predicates. Its machine-readable source is',
  '[`rule-gap-scenarios-v9.json`](../evals/registrations/rule-gap-scenarios-v9.json),',
  'generated by',
  '[`generateRuleGapScenariosV9.ts`](../evals/src/scenarios/generateRuleGapScenariosV9.ts).',
  '',
  '## Scenarios Goal',
  '',
  `This batch covers **${document.total_target_canonical_capabilities}** canonical capabilities.`,
  '',
  `- Total authored scenarios: **${document.total_scenarios}**`,
  `- Canonical capabilities covered: **${document.total_target_canonical_capabilities}**`,
  `- Rule occurrences represented: **${document.total_target_rules}**`,
  `- Tool-local semantic groups represented: **${document.total_target_semantic_groups}**`,
  '',
  '## Coverage summary',
  '',
  `- Tools: ${Object.entries(document.coverage_by_tool)
    .map(([toolId, count]) => `${toolId} ${count}`)
    .join(', ')}`,
  '',
  '## Scenario index',
  '',
  '| Scenario ID | Canonical capabilities | Title | Rules | Tools |',
  '| --- | ---: | --- | ---: | ---: |',
  ...document.scenarios.map(
    scenario =>
      `| ${scenario.scenario_id} | ${scenario.target_canonical_capability_ids.length} | ${scenario.title} | ${scenario.target_rule_count} | ${scenario.target_tool_ids.length} |`
  ),
  '',
];

const markdownConfig = (await prettier.resolveConfig(documentationPath)) ?? {};
writeFileSync(
  documentationPath,
  prettier.format(`${markdown.join('\n')}\n`, { ...markdownConfig, parser: 'markdown' })
);
