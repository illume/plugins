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

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { Ajv, type AnySchema } from 'ajv';
import { SCENARIOS_GOAL } from './scenariosGoal.js';

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
  supported_cluster_profiles: string[];
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
const catalogue = readJson<Catalogue>('registrations/rule-gap-scenarios-v2.json');
const v1 = readJson<Catalogue>('registrations/rule-gap-scenarios-v1.json');
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

test('v2 catalogue matches the shared schema and exact allocation', () => {
  const schema = readJson<AnySchema>('schema/rule-gap-scenarios.schema.json');
  const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
    schema
  );
  assert.equal(validate(v1), true, `v1: ${JSON.stringify(validate.errors)}`);
  assert.equal(validate(catalogue), true, `v2: ${JSON.stringify(validate.errors)}`);
  assert.deepEqual(v1.scenarios_goal, SCENARIOS_GOAL);
  assert.deepEqual(catalogue.scenarios_goal, SCENARIOS_GOAL);
  assert.equal(catalogue.total_scenarios, 42);
  assert.equal(catalogue.scenarios.length, 42);
  assert.deepEqual(catalogue.scenario_counts_by_selection_track, {
    falco_chain: 13,
    node_problem_detector: 20,
    operations: 3,
    policy: 6,
  });
  assert.deepEqual(catalogue.scenario_counts_by_feasibility, {
    host: 20,
    live_cluster: 1,
    manifest_only: 6,
    runtime: 13,
    telemetry: 2,
  });
  assert.deepEqual(catalogue.coverage_by_feasibility, {
    host: 28,
    live_cluster: 29,
    manifest_only: 233,
    runtime: 231,
    telemetry: 9,
  });
});

test('v2 scenarios expose one trigger unit without hidden parameterization', () => {
  const aggregateWording = /\b(?:independently|each case|matrix)\b/i;
  for (const scenario of catalogue.scenarios) {
    assert.doesNotMatch(scenario.setup_summary, aggregateWording, scenario.scenario_id);
    assert.doesNotMatch(scenario.trigger_predicate, aggregateWording, scenario.scenario_id);
  }

  const npdScenarios = catalogue.scenarios.filter(
    scenario => scenario.selection_track === 'node_problem_detector'
  );
  assert.equal(npdScenarios.length, 20);
  assert.equal(npdScenarios.flatMap(scenario => scenario.target_rule_ids).length, 28);
  assert.equal(
    new Set(npdScenarios.flatMap(scenario => scenario.target_semantic_group_ids)).size,
    20
  );
  assert.ok(npdScenarios.every(scenario => scenario.feasibility === 'host'));
  assert.deepEqual(
    npdScenarios
      .filter(scenario => scenario.scenario_id.includes('-windows-'))
      .map(scenario => scenario.supported_cluster_profiles),
    [['aks'], ['aks']]
  );
  assert.ok(
    npdScenarios
      .filter(scenario => !scenario.scenario_id.includes('-windows-'))
      .every(scenario => scenario.supported_cluster_profiles.join(',') === 'local-minikube,aks')
  );
});

test('v2 targets exist, are direct and uncovered, and do not overlap v1', () => {
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
  const v1Targets = new Set(v1.scenarios.flatMap(scenario => scenario.target_rule_ids));
  const targetIds = catalogue.scenarios.flatMap(scenario => scenario.target_rule_ids);
  assert.equal(new Set(targetIds).size, targetIds.length);
  assert.equal(
    targetIds.some(ruleId => v1Targets.has(ruleId)),
    false
  );

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

test('v2 identities and predicates are unique across both draft batches', () => {
  for (const field of ['scenario_id', 'title', 'trigger_predicate'] as const) {
    const values = [...v1.scenarios, ...catalogue.scenarios].map(scenario => scenario[field]);
    assert.equal(new Set(values).size, values.length, field);
  }
});

test('v2 generated summaries match the selected scenarios and exact totals', () => {
  const rules = new Map(
    inventory.tools.flatMap(tool =>
      tool.rules.map(rule => [rule.rule_id, { ...rule, tool_id: tool.tool_id }] as const)
    )
  );
  const targetIds = catalogue.scenarios.flatMap(scenario => scenario.target_rule_ids);
  const groupIds = new Set(
    catalogue.scenarios.flatMap(scenario => scenario.target_semantic_group_ids)
  );
  assert.equal(targetIds.length, 530);
  assert.equal(catalogue.total_target_rules, 530);
  assert.equal(groupIds.size, 156);
  assert.equal(catalogue.total_target_semantic_groups, 156);
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

test('v2 drafts remain outside the 275-scenario active roster', () => {
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

test('v2 documentation lists every generated draft and target count', () => {
  const documentation = readFileSync(
    path.resolve(evalRoot, '..', 'docs', 'kubernetes-rule-gap-scenarios-v2.md'),
    'utf8'
  );
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
  assert.equal(documentedRows.size, 42);
});
