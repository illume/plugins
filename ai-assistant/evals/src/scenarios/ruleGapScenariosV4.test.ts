import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { Ajv, type AnySchema } from 'ajv';
import { SCENARIOS_GOAL } from './scenariosGoal.js';
import {
  v4ScenarioCatalogSeeds,
  v4ScenarioDraftDefinitions,
} from './scenarioDraftDefinitionsV4.js';

interface RuleRecord {
  rule_id: string;
  semantic_group_id: string;
  info_url: string;
  mapping_readiness?: string;
}

interface Scenario {
  scenario_id: string;
  title: string;
  selection_track: string;
  category: string;
  setup_summary: string;
  trigger_predicate: string;
  feasibility: string;
  target_rule_ids: string[];
  target_semantic_group_ids: string[];
  target_tool_ids: string[];
  target_rule_count: number;
  provenance_refs: string[];
  lifecycle_state: string;
  qualification_status: string;
  qualification_blockers: Array<{ kind: string }>;
}

interface Catalogue {
  scenarios_goal: typeof SCENARIOS_GOAL;
  methodology: { external_tool_execution?: boolean };
  total_scenarios: number;
  total_target_rules: number;
  total_target_semantic_groups: number;
  category_counts: Record<string, number>;
  coverage_by_tool: Record<string, number>;
  coverage_by_feasibility: Record<string, number>;
  scenario_counts_by_feasibility: Record<string, number>;
  coverage_by_selection_track: Record<string, number>;
  scenario_counts_by_selection_track: Record<string, number>;
  scenarios: Scenario[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(path.join(evalRoot, relativePath), 'utf8')) as T;
const catalogue = readJson<Catalogue>('registrations/rule-gap-scenarios-v4.json');
const prior = ['v1', 'v2', 'v3'].map(version =>
  readJson<Catalogue>(`registrations/rule-gap-scenarios-${version}.json`)
);
const inventory = readJson<{
  tools: Array<{
    tool_id: string;
    revision: string;
    mapping_readiness: string;
    rules: RuleRecord[];
  }>;
}>('registrations/tool-rule-inventory-v1.json');
const mapping = readJson<{
  total_scenarios: number;
  rule_mappings: Array<{ rules: Array<{ rule_id: string; status: string }> }>;
}>('registrations/tool-scenario-rule-mapping-v1.json');

const summarize = (values: string[], count: (value: string) => number): Record<string, number> =>
  Object.fromEntries([...new Set(values)].sort().map(value => [value, count(value)]));

test('v4 catalogue matches the shared schema and exact allocation', () => {
  const schema = readJson<AnySchema>('schema/rule-gap-scenarios.schema.json');
  const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
    schema
  );
  assert.equal(validate(catalogue), true, JSON.stringify(validate.errors));
  assert.deepEqual(catalogue.scenarios_goal, SCENARIOS_GOAL);
  assert.equal(catalogue.methodology.external_tool_execution, false);
  assert.equal(catalogue.total_scenarios, 105);
  assert.equal(catalogue.scenarios.length, 105);
  assert.equal(catalogue.total_target_rules, 106);
  assert.equal(catalogue.total_target_semantic_groups, 106);
  assert.deepEqual(catalogue.scenario_counts_by_selection_track, {
    falco_chain: 10,
    node_problem_detector: 3,
    operations: 18,
    policy: 74,
  });
  assert.deepEqual(catalogue.scenario_counts_by_feasibility, {
    host: 7,
    live_cluster: 1,
    manifest_only: 82,
    runtime: 10,
    telemetry: 5,
  });
});

test('v4 targets are unique, direct, uncovered, pinned, and absent from prior batches', () => {
  const rules = new Map(
    inventory.tools.flatMap(tool =>
      tool.rules.map(
        rule =>
          [
            rule.rule_id,
            {
              ...rule,
              tool_id: tool.tool_id,
              revision: tool.revision,
              readiness: rule.mapping_readiness ?? tool.mapping_readiness,
            },
          ] as const
      )
    )
  );
  const statusById = new Map(
    mapping.rule_mappings.flatMap(entry =>
      entry.rules.map(rule => [rule.rule_id, rule.status] as const)
    )
  );
  const priorTargets = new Set(
    prior.flatMap(batch => batch.scenarios.flatMap(scenario => scenario.target_rule_ids))
  );
  const priorGroups = new Set(
    prior.flatMap(batch => batch.scenarios.flatMap(scenario => scenario.target_semantic_group_ids))
  );
  const targetIds = catalogue.scenarios.flatMap(scenario => scenario.target_rule_ids);
  assert.equal(new Set(targetIds).size, targetIds.length);

  for (const scenario of catalogue.scenarios) {
    assert.equal(scenario.target_rule_count, scenario.target_rule_ids.length);
    assert.equal(scenario.lifecycle_state, 'draft');
    assert.equal(scenario.qualification_status, 'pending');
    assert.deepEqual(scenario.qualification_blockers.map(blocker => blocker.kind).sort(), [
      'leakage',
      'observation',
      'oracle',
      'setup',
    ]);
    const selectedRules = scenario.target_rule_ids.map(ruleId => {
      const rule = rules.get(ruleId);
      assert.ok(rule, ruleId);
      assert.equal(rule.readiness, 'direct_predicate', ruleId);
      assert.equal(statusById.get(ruleId), 'uncovered', ruleId);
      assert.equal(priorTargets.has(ruleId), false, ruleId);
      assert.equal(priorGroups.has(rule.semantic_group_id), false, rule.semantic_group_id);
      assert.ok(rule.info_url.includes(rule.revision), `${ruleId} is not revision-pinned`);
      assert.ok(scenario.provenance_refs.includes(rule.info_url), `${ruleId} provenance`);
      return rule;
    });
    assert.deepEqual(
      scenario.target_semantic_group_ids,
      [...new Set(selectedRules.map(rule => rule.semantic_group_id))].sort()
    );
    assert.deepEqual(
      scenario.target_tool_ids,
      [...new Set(selectedRules.map(rule => rule.tool_id))].sort()
    );
  }
});

test('v4 contains only complete kube-bench semantic groups', () => {
  const kubeBench = inventory.tools.find(tool => tool.tool_id === 'kube-bench');
  assert.ok(kubeBench);
  const selected = new Set(catalogue.scenarios.flatMap(scenario => scenario.target_rule_ids));
  const selectedGroups = new Set(
    kubeBench.rules.filter(rule => selected.has(rule.rule_id)).map(rule => rule.semantic_group_id)
  );
  assert.equal(selectedGroups.size, 0, 'v4 intentionally uses no profile-only expansion');
  for (const groupId of selectedGroups) {
    const members = kubeBench.rules
      .filter(rule => rule.semantic_group_id === groupId)
      .map(rule => rule.rule_id)
      .sort();
    assert.deepEqual(
      members.filter(ruleId => selected.has(ruleId)),
      members,
      groupId
    );
  }
});

test('v4 identities, titles, and trigger predicates are unique across all batches', () => {
  const allScenarios = [...prior.flatMap(batch => batch.scenarios), ...catalogue.scenarios];
  for (const field of ['scenario_id', 'title', 'trigger_predicate'] as const) {
    const values = allScenarios.map(scenario => scenario[field]);
    assert.equal(new Set(values).size, values.length, field);
  }
  for (const scenario of catalogue.scenarios) {
    assert.doesNotMatch(scenario.setup_summary, /\b(?:independently|each case|matrix)\b/i);
  }
});

test('v4 generated summaries match exact occurrence, group, tool, and dimension totals', () => {
  const rules = new Map(
    inventory.tools.flatMap(tool =>
      tool.rules.map(rule => [rule.rule_id, { ...rule, tool_id: tool.tool_id }] as const)
    )
  );
  const targetIds = catalogue.scenarios.flatMap(scenario => scenario.target_rule_ids);
  const groupIds = new Set(
    catalogue.scenarios.flatMap(scenario => scenario.target_semantic_group_ids)
  );
  const toolIds = new Set(catalogue.scenarios.flatMap(scenario => scenario.target_tool_ids));
  assert.equal(targetIds.length, 106);
  assert.equal(groupIds.size, 106);
  assert.equal(toolIds.size, 10);
  assert.deepEqual(
    catalogue.category_counts,
    Object.fromEntries(
      Object.keys(catalogue.category_counts).map(category => [
        category,
        catalogue.scenarios.filter(scenario => scenario.category === category).length,
      ])
    )
  );
  assert.deepEqual(
    catalogue.coverage_by_tool,
    summarize(
      targetIds.map(ruleId => rules.get(ruleId)!.tool_id),
      toolId => targetIds.filter(ruleId => rules.get(ruleId)!.tool_id === toolId).length
    )
  );
  assert.deepEqual(
    catalogue.scenario_counts_by_feasibility,
    summarize(
      catalogue.scenarios.map(scenario => scenario.feasibility),
      feasibility =>
        catalogue.scenarios.filter(scenario => scenario.feasibility === feasibility).length
    )
  );
  assert.deepEqual(
    catalogue.coverage_by_feasibility,
    summarize(
      catalogue.scenarios.map(scenario => scenario.feasibility),
      feasibility =>
        catalogue.scenarios
          .filter(scenario => scenario.feasibility === feasibility)
          .reduce((total, scenario) => total + scenario.target_rule_count, 0)
    )
  );
  assert.deepEqual(
    catalogue.coverage_by_selection_track,
    summarize(
      catalogue.scenarios.map(scenario => scenario.selection_track),
      track =>
        catalogue.scenarios
          .filter(scenario => scenario.selection_track === track)
          .reduce((total, scenario) => total + scenario.target_rule_count, 0)
    )
  );
});

test('v4 drafts remain outside the exact 275-scenario active roster', () => {
  const scenarioRoot = path.join(evalRoot, 'scenarios');
  const activeIds = readdirSync(scenarioRoot)
    .filter(directory => existsSync(path.join(scenarioRoot, directory, 'scenario.yaml')))
    .sort();
  assert.equal(activeIds.length, 275);
  assert.equal(mapping.total_scenarios, 275);
  assert.equal(
    catalogue.scenarios.some(scenario => activeIds.includes(scenario.scenario_id)),
    false
  );
});

test('v4 definitions exactly match catalogue IDs and contain concrete safe setups', () => {
  const catalogueIds = catalogue.scenarios.map(scenario => scenario.scenario_id).sort();
  const definitionIds = v4ScenarioDraftDefinitions.map(definition => definition.scenarioId).sort();
  assert.equal(v4ScenarioDraftDefinitions.length, 105);
  assert.equal(v4ScenarioCatalogSeeds.length, 105);
  assert.deepEqual(definitionIds, catalogueIds);
  const sourceToolPattern = new RegExp(
    inventory.tools.map(tool => tool.tool_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'i'
  );
  const unsafeScript =
    /\b(?:shutdown|reboot|mkfs|nsenter)\b|rm\s+-rf\s+\/(?:\s|$)|\/dev\/(?:sd|nvme)|dd\s+if=/i;

  for (const definition of v4ScenarioDraftDefinitions) {
    assert.ok(definition.setup.length > 0, definition.scenarioId);
    assert.ok(definition.acceptedFacts.length > 0, definition.scenarioId);
    assert.ok(definition.contradictionFacts.length > 0, definition.scenarioId);
    assert.doesNotMatch(definition.taskPrompt, sourceToolPattern, definition.scenarioId);
    const serialized = JSON.stringify(definition);
    assert.doesNotMatch(
      serialized,
      /\b(?:TODO|TBD|FIXME|placeholder|replace me)\b/i,
      definition.scenarioId
    );
    assert.doesNotMatch(serialized, unsafeScript, definition.scenarioId);
    const scenarioMetadata = catalogue.scenarios.find(
      scenario => scenario.scenario_id === definition.scenarioId
    );
    assert.ok(scenarioMetadata);
    for (const ruleId of scenarioMetadata.target_rule_ids) {
      assert.equal(definition.taskPrompt.includes(ruleId), false, definition.scenarioId);
    }
    if (scenarioMetadata.feasibility === 'runtime') {
      assert.equal(definition.setup.length, 1, definition.scenarioId);
      const job = definition.setup[0] as {
        kind?: string;
        spec?: {
          activeDeadlineSeconds?: number;
          template?: {
            spec?: {
              hostNetwork?: boolean;
              hostPID?: boolean;
              volumes?: object[];
              containers?: object[];
            };
          };
        };
      };
      assert.equal(job.kind, 'Job', definition.scenarioId);
      assert.ok((job.spec?.activeDeadlineSeconds ?? 0) <= 120, definition.scenarioId);
      assert.notEqual(job.spec?.template?.spec?.hostNetwork, true, definition.scenarioId);
      assert.notEqual(job.spec?.template?.spec?.hostPID, true, definition.scenarioId);
      assert.doesNotMatch(JSON.stringify(job.spec?.template?.spec?.volumes), /hostPath/i);
    }
    for (const object of definition.setup as Array<{
      kind?: string;
      metadata?: { labels?: Record<string, string>; annotations?: Record<string, string> };
      data?: Record<string, string>;
    }>) {
      const hasEvidenceData = Object.keys(object.data ?? {}).some(key =>
        /^(?:source-evidence|predicate|healthy-control)\./.test(key)
      );
      if (hasEvidenceData) {
        assert.equal(
          object.metadata?.labels?.['evals.kubernetes.io/fixture-kind'],
          'node-log-or-config',
          definition.scenarioId
        );
      }
      if (object.metadata?.labels?.['evals.kubernetes.io/fixture-kind']) {
        assert.equal(scenarioMetadata.feasibility, 'host', definition.scenarioId);
        assert.equal(
          object.metadata.annotations?.['evals.kubernetes.io/adapter'],
          'normalized-node-predicate'
        );
        assert.equal(
          object.metadata.annotations?.['evals.kubernetes.io/apply-to-current-host'],
          'false'
        );
        assert.ok(object.data?.['source-evidence.json'] ?? object.data?.['component-config.yaml']);
        assert.ok(object.data?.['predicate.json']);
        assert.ok(object.data?.['healthy-control.json'] ?? object.data?.['healthy-control.yaml']);
      }
    }
  }
});

test('v4 documentation has exact catalogue parity', () => {
  const documentation = readFileSync(
    path.resolve(evalRoot, '..', 'docs', 'kubernetes-rule-gap-scenarios-v4.md'),
    'utf8'
  );
  assert.match(documentation, /\*\*106\*\* exact target occurrences/);
  assert.match(documentation, /\*\*106\*\* semantic groups across \*\*10\*\* tools/);
  const documentedRows = new Set(
    documentation
      .split('\n')
      .filter(line => line.match(/^\|\s*rule-gap-/))
      .map(line =>
        line
          .split('|')
          .map(cell => cell.trim())
          .slice(1, -1)
          .join('|')
      )
  );
  for (const scenario of catalogue.scenarios) {
    assert.ok(
      [...documentedRows].some(row =>
        row.startsWith(
          `${scenario.scenario_id}|${scenario.selection_track}|${scenario.title}|${scenario.target_rule_count}|`
        )
      ),
      scenario.scenario_id
    );
  }
  assert.equal(documentedRows.size, 105);
});
