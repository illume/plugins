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

interface Catalogue {
  scenarios_goal: typeof SCENARIOS_GOAL;
  total_scenarios: number;
  total_target_rules: number;
  total_target_semantic_groups: number;
  category_counts: Record<string, number>;
  coverage_by_tool: Record<string, number>;
  coverage_by_feasibility: Record<string, number>;
  scenario_counts_by_feasibility: Record<string, number>;
  scenarios: Array<{
    scenario_id: string;
    title: string;
    category: string;
    feasibility: string;
    target_rule_ids: string[];
    target_semantic_group_ids: string[];
    target_tool_ids: string[];
    target_rule_count: number;
    provenance_refs: string[];
    lifecycle_state: string;
    qualification_status: string;
    qualification_blockers: Array<{ kind: string }>;
  }>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(path.join(evalRoot, relativePath), 'utf8')) as T;
const catalogue = readJson<Catalogue>('registrations/rule-gap-scenarios-v1.json');
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
  rule_mappings: Array<{
    rules: Array<{ rule_id: string; status: string }>;
  }>;
}>('registrations/tool-scenario-rule-mapping-v1.json');

test('rule-gap catalogue matches its schema and fixed allocation', () => {
  const schema = readJson<AnySchema>('schema/rule-gap-scenarios.schema.json');
  const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
    schema
  );
  assert.equal(validate(catalogue), true, JSON.stringify(validate.errors));
  assert.deepEqual(catalogue.scenarios_goal, SCENARIOS_GOAL);
  assert.equal(catalogue.total_scenarios, 100);
  assert.equal(catalogue.scenarios.length, 100);
  assert.deepEqual(catalogue.category_counts, {
    workload_configuration: 30,
    control_plane_host_hardening: 25,
    runtime_node_failure: 20,
    operations_deprecation: 25,
  });
  assert.equal(new Set(catalogue.scenarios.map(scenario => scenario.scenario_id)).size, 100);
});

test('every target is unique, uncovered, direct, and revision-pinned', () => {
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
    mapping.rule_mappings.flatMap(tool =>
      tool.rules.map(rule => [rule.rule_id, rule.status] as const)
    )
  );
  const targetIds = catalogue.scenarios.flatMap(scenario => scenario.target_rule_ids);
  assert.equal(targetIds.length, catalogue.total_target_rules);
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

  assert.equal(
    new Set(catalogue.scenarios.flatMap(scenario => scenario.target_semantic_group_ids)).size,
    catalogue.total_target_semantic_groups
  );
  assert.deepEqual(
    catalogue.coverage_by_tool,
    Object.fromEntries(
      [...new Set(targetIds.map(ruleId => rules.get(ruleId)!.tool_id))]
        .sort()
        .map(toolId => [
          toolId,
          targetIds.filter(ruleId => rules.get(ruleId)!.tool_id === toolId).length,
        ])
    )
  );
  assert.deepEqual(
    catalogue.scenario_counts_by_feasibility,
    Object.fromEntries(
      [...new Set(catalogue.scenarios.map(scenario => scenario.feasibility))]
        .sort()
        .map(feasibility => [
          feasibility,
          catalogue.scenarios.filter(scenario => scenario.feasibility === feasibility).length,
        ])
    )
  );
  assert.deepEqual(
    catalogue.coverage_by_feasibility,
    Object.fromEntries(
      [...new Set(catalogue.scenarios.map(scenario => scenario.feasibility))]
        .sort()
        .map(feasibility => [
          feasibility,
          catalogue.scenarios
            .filter(scenario => scenario.feasibility === feasibility)
            .reduce((count, scenario) => count + scenario.target_rule_count, 0),
        ])
    )
  );
});

test('draft catalogue remains outside the 275-scenario active roster', () => {
  const scenarioRoot = path.join(evalRoot, 'scenarios');
  const activeIds = readdirSync(scenarioRoot)
    .filter(directory => existsSync(path.join(scenarioRoot, directory, 'scenario.yaml')))
    .sort();
  assert.equal(activeIds.length, 275);
  assert.equal(mapping.total_scenarios, 275);
  assert.equal(
    activeIds.some(scenarioId => scenarioId.startsWith('rule-gap-')),
    false
  );
});

test('documentation lists every draft with its generated target count', () => {
  const documentation = readFileSync(
    path.resolve(evalRoot, '..', 'docs', 'kubernetes-rule-gap-scenarios.md'),
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
      documentedRows.has(`${scenario.scenario_id}|${scenario.title}|${scenario.target_rule_count}`),
      scenario.scenario_id
    );
  }
  assert.equal(documentedRows.size, 100);
});
