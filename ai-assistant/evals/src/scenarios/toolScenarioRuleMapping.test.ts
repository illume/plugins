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

const statuses = ['covered', 'unsure', 'uncovered', 'no_applicable_rule'] as const;
type CoverageStatus = (typeof statuses)[number];

interface ToolMapping {
  tool_id: string;
  status: CoverageStatus;
  rule_ids: string[];
}

interface Mapping {
  total_tools: number;
  total_scenarios: number;
  total_contracts: number;
  combined_summary: {
    covered_by_any_tool_count: number;
    covered_by_any_tool_percentage: number;
    unsure_only_count: number;
    unsure_only_percentage: number;
    no_covered_or_unsure_count: number;
    no_covered_or_unsure_percentage: number;
  };
  contracts: Array<{
    contract_id: string;
    scenario_count: number;
    scenario_ids: string[];
    tool_mappings: ToolMapping[];
  }>;
  scenarios: Array<{
    scenario_id: string;
    contract_id: string;
    combined_status: Exclude<CoverageStatus, 'no_applicable_rule'>;
    covered_by_tool_ids: string[];
    unsure_tool_ids: string[];
    tool_statuses: Record<string, CoverageStatus>;
  }>;
  tool_summaries: Array<{
    tool_id: string;
    scenario_counts: Record<CoverageStatus, number>;
    covered_percentage: number;
    unsure_percentage: number;
    standalone_end_to_end_covered_count: number;
  }>;
  rule_mappings: Array<{
    tool_id: string;
    rules: Array<{
      rule_id: string;
      status: Exclude<CoverageStatus, 'no_applicable_rule'>;
      covered_contract_ids: string[];
      related_contract_ids: string[];
    }>;
  }>;
}

interface Inventory {
  total_rules: number;
  tools: Array<{ tool_id: string; name: string; rules: Array<{ rule_id: string }> }>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const scenarioRoot = path.join(evalRoot, 'scenarios');
const mapping = JSON.parse(
  readFileSync(path.join(evalRoot, 'registrations', 'tool-scenario-rule-mapping-v1.json'), 'utf8')
) as Mapping;
const inventory = JSON.parse(
  readFileSync(path.join(evalRoot, 'registrations', 'tool-rule-inventory-v1.json'), 'utf8')
) as Inventory;

function expectedScenarioIds(): string[] {
  return readdirSync(scenarioRoot)
    .filter(directory => existsSync(path.join(scenarioRoot, directory, 'scenario.yaml')))
    .sort();
}

test('tool-scenario mapping is complete and internally consistent', () => {
  const schema = JSON.parse(
    readFileSync(path.join(evalRoot, 'schema', 'tool-scenario-rule-mapping.schema.json'), 'utf8')
  ) as AnySchema;
  const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
    schema
  );
  assert.equal(validate(mapping), true, JSON.stringify(validate.errors));

  const toolIds = inventory.tools.map(tool => tool.tool_id).sort();
  const ruleIdsByTool = new Map(
    inventory.tools.map(tool => [tool.tool_id, new Set(tool.rules.map(rule => rule.rule_id))])
  );
  assert.equal(mapping.total_tools, toolIds.length);
  assert.equal(mapping.total_contracts, mapping.contracts.length);
  assert.equal(mapping.total_scenarios, mapping.scenarios.length);
  assert.deepEqual(
    mapping.scenarios.map(scenario => scenario.scenario_id).sort(),
    expectedScenarioIds()
  );
  assert.equal(
    mapping.contracts.reduce((sum, contract) => sum + contract.scenario_count, 0),
    mapping.total_scenarios
  );

  const contractIds = new Set(mapping.contracts.map(contract => contract.contract_id));
  for (const contract of mapping.contracts) {
    assert.equal(contract.scenario_count, contract.scenario_ids.length);
    assert.deepEqual(contract.tool_mappings.map(tool => tool.tool_id).sort(), toolIds);
    for (const tool of contract.tool_mappings) {
      if (tool.status === 'no_applicable_rule') assert.deepEqual(tool.rule_ids, []);
      else assert.ok(tool.rule_ids.length > 0, `${tool.tool_id}/${contract.contract_id}`);
      for (const ruleId of tool.rule_ids) {
        assert.ok(ruleIdsByTool.get(tool.tool_id)?.has(ruleId), `${tool.tool_id}/${ruleId}`);
      }
    }
  }

  for (const scenario of mapping.scenarios) {
    assert.ok(contractIds.has(scenario.contract_id), scenario.scenario_id);
    assert.deepEqual(Object.keys(scenario.tool_statuses).sort(), toolIds);
    assert.deepEqual(
      [...scenario.covered_by_tool_ids].sort(),
      toolIds.filter(toolId => scenario.tool_statuses[toolId] === 'covered')
    );
    assert.deepEqual(
      [...scenario.unsure_tool_ids].sort(),
      toolIds.filter(toolId => scenario.tool_statuses[toolId] === 'unsure')
    );
    assert.equal(
      scenario.combined_status,
      scenario.covered_by_tool_ids.length
        ? 'covered'
        : scenario.unsure_tool_ids.length
        ? 'unsure'
        : 'uncovered'
    );
  }

  const combinedCounts = {
    covered: mapping.scenarios.filter(scenario => scenario.combined_status === 'covered').length,
    unsure: mapping.scenarios.filter(scenario => scenario.combined_status === 'unsure').length,
    uncovered: mapping.scenarios.filter(scenario => scenario.combined_status === 'uncovered')
      .length,
  };
  assert.deepEqual(combinedCounts, { covered: 103, unsure: 90, uncovered: 82 });
  assert.deepEqual(mapping.combined_summary, {
    covered_by_any_tool_count: 103,
    covered_by_any_tool_percentage: 37.5,
    unsure_only_count: 90,
    unsure_only_percentage: 32.7,
    no_covered_or_unsure_count: 82,
    no_covered_or_unsure_percentage: 29.8,
  });

  assert.deepEqual(mapping.tool_summaries.map(tool => tool.tool_id).sort(), toolIds);
  for (const summary of mapping.tool_summaries) {
    const counts = Object.fromEntries(statuses.map(status => [status, 0])) as Record<
      CoverageStatus,
      number
    >;
    for (const scenario of mapping.scenarios) counts[scenario.tool_statuses[summary.tool_id]!]++;
    assert.deepEqual(summary.scenario_counts, counts);
    assert.equal(
      Object.values(counts).reduce((sum, count) => sum + count, 0),
      275
    );
    assert.equal(summary.covered_percentage, Number(((counts.covered / 275) * 100).toFixed(1)));
    assert.equal(summary.unsure_percentage, Number(((counts.unsure / 275) * 100).toFixed(1)));
    assert.equal(summary.standalone_end_to_end_covered_count, 0);
  }

  const inventoryRuleIds = inventory.tools
    .flatMap(tool => tool.rules.map(rule => rule.rule_id))
    .sort();
  const mappedRuleIds = mapping.rule_mappings
    .flatMap(tool => tool.rules.map(rule => rule.rule_id))
    .sort();
  assert.equal(mappedRuleIds.length, inventory.total_rules);
  assert.deepEqual(mappedRuleIds, inventoryRuleIds);
  const mappedRulesById = new Map(
    mapping.rule_mappings.flatMap(tool => tool.rules.map(rule => [rule.rule_id, rule] as const))
  );
  for (const tool of mapping.rule_mappings) {
    for (const rule of tool.rules) {
      for (const contractId of [...rule.covered_contract_ids, ...rule.related_contract_ids]) {
        assert.ok(contractIds.has(contractId), `${rule.rule_id}/${contractId}`);
      }
      if (rule.status === 'covered') assert.ok(rule.covered_contract_ids.length > 0, rule.rule_id);
    }
  }
  for (const contract of mapping.contracts) {
    for (const tool of contract.tool_mappings.filter(candidate => candidate.status === 'covered')) {
      for (const ruleId of tool.rule_ids) {
        const rule = mappedRulesById.get(ruleId);
        assert.equal(rule?.status, 'covered', ruleId);
        assert.ok(rule?.covered_contract_ids.includes(contract.contract_id), ruleId);
      }
    }
  }

  const report = readFileSync(
    path.resolve(evalRoot, '..', 'docs', 'kubernetes-tool-scenario-coverage.md'),
    'utf8'
  );
  const normalizedReportRows = new Set(
    report
      .split('\n')
      .filter(line => line.startsWith('|'))
      .map(line =>
        line
          .split('|')
          .map(cell => cell.trim())
          .join('|')
      )
  );
  for (const summary of mapping.tool_summaries) {
    const name = inventory.tools.find(tool => tool.tool_id === summary.tool_id)?.name;
    assert.ok(name, summary.tool_id);
    const counts = summary.scenario_counts;
    const row = `|${name}|${counts.covered}|${summary.covered_percentage.toFixed(1)}%|${
      counts.unsure
    }|${counts.uncovered}|${counts.no_applicable_rule}|`;
    assert.ok(normalizedReportRows.has(row), `${summary.tool_id} report summary is stale`);
  }

  const scenarioReport = readFileSync(
    path.resolve(evalRoot, '..', 'docs', 'kubernetes-tool-scenario-detection-report.md'),
    'utf8'
  );
  assert.match(scenarioReport, /103\/275 scenarios \(37\.5%\)/);
  assert.equal(scenarioReport.split('\n').filter(line => line.startsWith('| `')).length, 275);
  const scenarioMatrix = readFileSync(
    path.resolve(evalRoot, '..', 'docs', 'kubernetes-tool-scenario-detection-matrix.csv'),
    'utf8'
  );
  const matrixLines = scenarioMatrix.trimEnd().split('\n');
  assert.equal(matrixLines.length, 276);
  assert.equal(matrixLines[0]?.split(',').length, 28);
});

test('known direct predicates retain conservative contract mappings', () => {
  const contract = (contractId: string) => {
    const match = mapping.contracts.find(candidate => candidate.contract_id === contractId);
    assert.ok(match, contractId);
    return match;
  };
  const tool = (contractId: string, toolId: string) => {
    const match = contract(contractId).tool_mappings.find(
      candidate => candidate.tool_id === toolId
    );
    assert.ok(match, `${toolId}/${contractId}`);
    return match;
  };

  for (const toolId of ['kube-linter', 'kube-score', 'kubevious', 'popeye', 'kubescape']) {
    assert.equal(tool('service-selector-fault', toolId).status, 'covered');
    assert.equal(tool('service-selector-healthy', toolId).status, 'uncovered');
    assert.equal(tool('service-selector-repair', toolId).status, 'uncovered');
  }
  assert.equal(tool('pvc-storageclass-missing', 'gatekeeper').status, 'covered');
  assert.equal(tool('pvc-bound-healthy', 'kstatus').status, 'covered');
  assert.equal(tool('rollout-stale-event-healthy', 'kstatus').status, 'covered');
  assert.equal(
    mapping.tool_summaries.some(summary => summary.scenario_counts.covered === 275),
    false
  );
});
