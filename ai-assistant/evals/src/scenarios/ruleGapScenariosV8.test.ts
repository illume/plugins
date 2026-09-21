import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { Ajv, type AnySchema } from 'ajv';
import { SCENARIOS_GOAL } from './scenariosGoal.js';
import {
  v8ScenarioCatalogSeeds,
  v8ScenarioDraftDefinitions,
} from './scenarioDraftDefinitionsV8.js';

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
const catalogue = readJson<Catalogue>('registrations/rule-gap-scenarios-v8.json');
const registry = readJson<{
  capabilities: Array<{
    canonical_capability_id: string;
    source_rule_ids: string[];
    source_semantic_group_ids: string[];
    source_tool_ids: string[];
  }>;
}>('registrations/canonical-capability-registry-v1.json');

test('v8 catalogue matches schema and exact batch size', () => {
  const schema = readJson<AnySchema>('schema/rule-gap-scenarios.schema.json');
  const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
    schema
  );
  assert.equal(validate(catalogue), true, JSON.stringify(validate.errors));
  assert.deepEqual(catalogue.scenarios_goal, SCENARIOS_GOAL);
  assert.equal(catalogue.methodology.external_tool_execution, false);
  assert.equal(catalogue.total_scenarios, 117);
  assert.equal(catalogue.scenarios.length, 117);
  assert.equal(catalogue.total_target_canonical_capabilities, 117);
  assert.deepEqual(catalogue.coverage_by_tool, { 'kube-bench': 698 });
});

test('v8 definitions and catalogue IDs match exactly once', () => {
  const catalogueIds = catalogue.scenarios.map(scenario => scenario.scenario_id).sort();
  const definitionIds = v8ScenarioDraftDefinitions.map(definition => definition.scenarioId).sort();
  const seedIds = v8ScenarioCatalogSeeds.map(seed => seed.scenarioId).sort();
  assert.equal(v8ScenarioDraftDefinitions.length, 117);
  assert.equal(v8ScenarioCatalogSeeds.length, 117);
  assert.deepEqual(definitionIds, catalogueIds);
  assert.deepEqual(seedIds, catalogueIds);
});

test('v8 scenarios target exactly one canonical capability and resolve to registry members', () => {
  const capabilityById = new Map(
    registry.capabilities.map(
      capability => [capability.canonical_capability_id, capability] as const
    )
  );
  for (const scenario of catalogue.scenarios) {
    assert.doesNotMatch(
      scenario.target_canonical_capability_ids[0]!,
      /:rule-manual:/,
      scenario.scenario_id
    );
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

test('v8 definitions remain concrete and candidate-safe', () => {
  const serialized = JSON.stringify(v8ScenarioDraftDefinitions);
  assert.doesNotMatch(serialized, /\b(?:TODO|TBD|FIXME|placeholder|replace me)\b/i);
  assert.doesNotMatch(
    serialized,
    /sourceToolIds|sourceRuleIds|represented-state|normalizedPredicate|misconfigured|configured|not \(/i
  );
  assert.doesNotMatch(serialized, /kube-bench|kubescape|popeye|pluto|headlamp/i);
  for (const definition of v8ScenarioDraftDefinitions) {
    assert.ok(definition.setup.length > 0, definition.scenarioId);
    assert.ok(definition.acceptedFacts.length > 0, definition.scenarioId);
    assert.ok(definition.contradictionFacts.length > 0, definition.scenarioId);
    assert.doesNotMatch(
      JSON.stringify(definition.setup),
      /status\.condition|misconfigured|configured|sourceToolIds|sourceRuleIds|normalizedPredicate|represented-state/i,
      definition.scenarioId
    );
    assert.doesNotMatch(definition.taskPrompt, /kube-bench|kubescape|popeye|pluto|headlamp/i);
  }
});

test('v8 evidence preserves component and negative-predicate semantics', () => {
  const evidenceFor = (capabilityId: string) => {
    const seed = v8ScenarioCatalogSeeds.find(candidate =>
      candidate.targetCanonicalCapabilityIds.includes(capabilityId)
    );
    assert.ok(seed, capabilityId);
    const definition = v8ScenarioDraftDefinitions.find(
      candidate => candidate.scenarioId === seed.scenarioId
    );
    assert.ok(definition, capabilityId);
    const fixture = definition.setup[0] as { data?: Record<string, string> };
    assert.ok(fixture.data?.['evidence.json'], capabilityId);
    const evidence = JSON.parse(fixture.data['evidence.json']) as {
      component: string;
      exactField: string;
      brokenValue: string;
    };
    const healthy = JSON.parse(fixture.data['healthy-control.json']!) as {
      healthyValue: string;
    };
    return {
      component: evidence.component,
      exactField: evidence.exactField,
      brokenValue: evidence.brokenValue,
      healthyValue: healthy.healthyValue,
    };
  };

  const rbac = evidenceFor(
    'canonical:limit-use-of-the-bind-impersonate-and-escalate-permissions-in-th:91751ba76781'
  );
  assert.equal(rbac.component, 'rbac');
  assert.equal(rbac.exactField, 'rules[0].verbs');
  assert.match(rbac.brokenValue, /bind.*impersonate.*escalate/);
  assert.equal(rbac.healthyValue, '["get","list"]');
  assert.deepEqual(
    evidenceFor('canonical:verify-that-the-authorization-mode-argument-is-not-set:57dddd22e00f'),
    {
      component: 'kube-apiserver',
      exactField: 'arguments.--authorization-mode',
      brokenValue: 'RBAC',
      healthyValue: 'absent',
    }
  );
  assert.deepEqual(
    evidenceFor('canonical:verify-that-the-client-ca-file-argument-is-not-set:3701fdf75230'),
    {
      component: 'kube-apiserver',
      exactField: 'arguments.--client-ca-file',
      brokenValue: '/etc/kubernetes/pki/ca.crt',
      healthyValue: 'absent',
    }
  );
  assert.deepEqual(
    evidenceFor('canonical:ensure-that-the-request-timeout-argument-is-set-manual:a18791e1c597'),
    {
      component: 'kube-apiserver',
      exactField: 'arguments.--request-timeout',
      brokenValue: 'absent',
      healthyValue: '60s',
    }
  );
  assert.deepEqual(evidenceFor('canonical:ensure-anonymous-auth-is-not-disabled:22807e48b74f'), {
    component: 'kubelet',
    exactField: 'authentication.anonymous.enabled',
    brokenValue: 'false',
    healthyValue: 'true',
  });
  assert.deepEqual(
    evidenceFor(
      'canonical:ensure-that-the-protect-kernel-defaults-argument-is-not-set-manu:a965e14807ed'
    ),
    {
      component: 'kubelet',
      exactField: 'protectKernelDefaults',
      brokenValue: 'true',
      healthyValue: 'absent',
    }
  );
});

test('v8 documentation has exact catalogue parity', () => {
  const documentation = readFileSync(
    path.resolve(evalRoot, '..', 'docs', 'kubernetes-rule-gap-scenarios-v8.md'),
    'utf8'
  );
  assert.match(documentation, /\*\*117\*\* canonical capabilities/);
  const documentedRows = new Set(
    documentation
      .split('\n')
      .filter(line => line.match(/^\|\s*rule-gap-v8-/))
      .map(line =>
        line
          .split('|')
          .map(cell => cell.trim())
          .slice(1, -1)
          .join('|')
      )
  );
  assert.equal(documentedRows.size, 117);
});
