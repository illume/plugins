import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { Ajv, type AnySchema } from 'ajv';
import { SCENARIOS_GOAL } from './scenariosGoal.js';
import {
  v6ScenarioCatalogSeeds,
  v6ScenarioDraftDefinitions,
} from './scenarioDraftDefinitionsV6.js';

interface Scenario {
  scenario_id: string;
  title: string;
  target_rule_ids: string[];
  target_semantic_group_ids: string[];
  target_canonical_capability_ids: string[];
  target_tool_ids: string[];
  target_rule_count: number;
}

interface Catalogue {
  scenarios_goal: typeof SCENARIOS_GOAL;
  methodology: { external_tool_execution?: boolean };
  total_scenarios: number;
  total_target_rules: number;
  total_target_semantic_groups: number;
  total_target_canonical_capabilities: number;
  coverage_by_tool: Record<string, number>;
  scenarios: Scenario[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(path.join(evalRoot, relativePath), 'utf8')) as T;
const catalogue = readJson<Catalogue>('registrations/rule-gap-scenarios-v6.json');
const registry = readJson<{
  capabilities: Array<{
    canonical_capability_id: string;
    source_rule_ids: string[];
    source_semantic_group_ids: string[];
    source_tool_ids: string[];
  }>;
}>('registrations/canonical-capability-registry-v1.json');

test('v6 catalogue matches schema and exact batch size', () => {
  const schema = readJson<AnySchema>('schema/rule-gap-scenarios.schema.json');
  const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
    schema
  );
  assert.equal(validate(catalogue), true, JSON.stringify(validate.errors));
  assert.deepEqual(catalogue.scenarios_goal, SCENARIOS_GOAL);
  assert.equal(catalogue.methodology.external_tool_execution, false);
  assert.equal(catalogue.total_scenarios, 115);
  assert.equal(catalogue.scenarios.length, 115);
  assert.equal(catalogue.total_target_canonical_capabilities, 115);
});

test('v6 definitions and catalogue IDs match exactly once', () => {
  const catalogueIds = catalogue.scenarios.map(scenario => scenario.scenario_id).sort();
  const definitionIds = v6ScenarioDraftDefinitions.map(definition => definition.scenarioId).sort();
  const seedIds = v6ScenarioCatalogSeeds.map(seed => seed.scenarioId).sort();
  assert.equal(v6ScenarioDraftDefinitions.length, 115);
  assert.equal(v6ScenarioCatalogSeeds.length, 115);
  assert.deepEqual(definitionIds, catalogueIds);
  assert.deepEqual(seedIds, catalogueIds);
});

test('v6 scenarios target exactly one canonical capability and resolve to registry members', () => {
  const capabilityById = new Map(
    registry.capabilities.map(
      capability => [capability.canonical_capability_id, capability] as const
    )
  );
  for (const scenario of catalogue.scenarios) {
    assert.deepEqual(scenario.target_canonical_capability_ids.length, 1, scenario.scenario_id);
    const capability = capabilityById.get(scenario.target_canonical_capability_ids[0]!);
    assert.ok(capability, scenario.scenario_id);
    assert.deepEqual([...scenario.target_rule_ids].sort(), [...capability!.source_rule_ids].sort());
    assert.deepEqual(
      [...scenario.target_semantic_group_ids].sort(),
      [...capability!.source_semantic_group_ids].sort()
    );
    assert.deepEqual([...scenario.target_tool_ids].sort(), [...capability!.source_tool_ids].sort());
  }
});

test('v6 definitions remain concrete and candidate-safe', () => {
  const serialized = JSON.stringify(v6ScenarioDraftDefinitions);
  assert.doesNotMatch(serialized, /\b(?:TODO|TBD|FIXME|placeholder|replace me)\b/i);
  assert.doesNotMatch(
    serialized,
    /sourceToolIds|sourceRuleIds|represented-state|normalizedPredicate/i
  );
  for (const definition of v6ScenarioDraftDefinitions) {
    assert.ok(definition.setup.length > 0, definition.scenarioId);
    assert.ok(definition.acceptedFacts.length > 0, definition.scenarioId);
    assert.ok(definition.contradictionFacts.length > 0, definition.scenarioId);
    assert.doesNotMatch(definition.taskPrompt, /kube-bench|kubescape|popeye|headlamp/i);
    assert.doesNotMatch(
      JSON.stringify(definition.setup),
      /sourceToolIds|sourceRuleIds|kube-bench|kubescape|popeye|headlamp/i,
      definition.scenarioId
    );
  }
});

test('v6 documentation has exact catalogue parity', () => {
  const documentation = readFileSync(
    path.resolve(evalRoot, '..', 'docs', 'kubernetes-rule-gap-scenarios-v6.md'),
    'utf8'
  );
  assert.match(documentation, /\*\*115\*\* canonical capabilities/);
  const documentedRows = new Set(
    documentation
      .split('\n')
      .filter(line => line.match(/^\|\s*rule-gap-v6-/))
      .map(line =>
        line
          .split('|')
          .map(cell => cell.trim())
          .slice(1, -1)
          .join('|')
      )
  );
  assert.equal(documentedRows.size, 115);
});
