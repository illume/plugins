import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { Ajv, type AnySchema } from 'ajv';
import { SCENARIOS_GOAL } from './scenariosGoal.js';
import {
  v9ScenarioCatalogSeeds,
  v9ScenarioDraftDefinitions,
} from './scenarioDraftDefinitionsV9.js';

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
  scenario_counts_by_feasibility: Record<string, number>;
  scenario_counts_by_selection_track: Record<string, number>;
  scenarios: Scenario[];
}

interface ConfigMapSetupEntry {
  kind?: string;
  data?: Record<string, string | undefined>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(path.join(evalRoot, relativePath), 'utf8')) as T;
const catalogue = readJson<Catalogue>('registrations/rule-gap-scenarios-v9.json');
const registry = readJson<{
  capabilities: Array<{
    canonical_capability_id: string;
    source_rule_ids: string[];
    source_semantic_group_ids: string[];
    source_tool_ids: string[];
  }>;
}>('registrations/canonical-capability-registry-v1.json');

test('v9 catalogue matches schema and exact batch size', () => {
  const schema = readJson<AnySchema>('schema/rule-gap-scenarios.schema.json');
  const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
    schema
  );
  assert.equal(validate(catalogue), true, JSON.stringify(validate.errors));
  assert.deepEqual(catalogue.scenarios_goal, SCENARIOS_GOAL);
  assert.equal(catalogue.methodology.external_tool_execution, false);
  assert.equal(catalogue.total_scenarios, 218);
  assert.equal(catalogue.scenarios.length, 218);
  assert.equal(catalogue.total_target_canonical_capabilities, 218);
  assert.deepEqual(catalogue.coverage_by_tool, { 'kube-bench': 851 });
  assert.deepEqual(catalogue.scenario_counts_by_feasibility, { cloud: 50, host: 168 });
  assert.deepEqual(catalogue.scenario_counts_by_selection_track, {
    operations: 50,
    policy: 168,
  });
});

test('v9 definitions and catalogue IDs match exactly once', () => {
  const catalogueIds = catalogue.scenarios.map(scenario => scenario.scenario_id).sort();
  const definitionIds = v9ScenarioDraftDefinitions.map(definition => definition.scenarioId).sort();
  const seedIds = v9ScenarioCatalogSeeds.map(seed => seed.scenarioId).sort();
  assert.equal(v9ScenarioDraftDefinitions.length, 218);
  assert.equal(v9ScenarioCatalogSeeds.length, 218);
  assert.deepEqual(definitionIds, catalogueIds);
  assert.deepEqual(seedIds, catalogueIds);
  assert.equal(
    v9ScenarioCatalogSeeds.some(seed =>
      seed.targetCanonicalCapabilityIds.includes(
        'canonical:revoke-client-certificate-when-possible-leakage-manual:cb8d07814493'
      )
    ),
    false
  );
});

test('v9 scenarios target exactly one canonical capability and resolve to registry members', () => {
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

test('v9 definitions remain concrete and candidate-safe', () => {
  for (const definition of v9ScenarioDraftDefinitions) {
    const serialized = JSON.stringify(definition);
    assert.doesNotMatch(serialized, /\b(?:TODO|TBD|FIXME|placeholder|replace me)\b/i);
    assert.doesNotMatch(serialized, /kube-bench|kubescape|popeye|pluto|headlamp/i);
    assert.ok(definition.setup.length > 0, definition.scenarioId);
    assert.ok(definition.acceptedFacts.length > 0, definition.scenarioId);
    assert.ok(definition.contradictionFacts.length > 0, definition.scenarioId);
    assert.doesNotMatch(definition.taskPrompt, /kube-bench|kubescape|popeye|pluto|headlamp/i);
    for (const resource of definition.setup as ConfigMapSetupEntry[]) {
      if (resource.kind !== 'ConfigMap') continue;
      const evidencePayload = `${resource.data?.['evidence.json'] ?? ''}|${
        resource.data?.['healthy-control.json'] ?? ''
      }`;
      assert.doesNotMatch(
        evidencePayload,
        /status\.condition|misconfigured|configured|sourceToolIds|sourceRuleIds|normalizedPredicate|represented-state/i,
        definition.scenarioId
      );
    }
    for (const fact of [...definition.acceptedFacts, ...definition.contradictionFacts]) {
      assert.doesNotMatch(
        `${fact.field_path}|${fact.observed_value}`,
        /sourceToolIds|sourceRuleIds|represented-state|normalizedPredicate|status\.condition|misconfigured|configured|not \(/i,
        definition.scenarioId
      );
    }
  }
});

test('v9 evidence preserves negative-predicate polarity', () => {
  const componentFor = (capabilityId: string) => {
    const seed = v9ScenarioCatalogSeeds.find(candidate =>
      candidate.targetCanonicalCapabilityIds.includes(capabilityId)
    );
    assert.ok(seed, capabilityId);
    const definition = v9ScenarioDraftDefinitions.find(
      candidate => candidate.scenarioId === seed.scenarioId
    );
    assert.ok(definition, capabilityId);
    const fixture = definition.setup[0] as { data?: Record<string, string> };
    assert.ok(fixture.data?.['evidence.json'], capabilityId);
    return (JSON.parse(fixture.data['evidence.json']) as { component: string }).component;
  };
  const evidenceFor = (capabilityId: string) => {
    const seed = v9ScenarioCatalogSeeds.find(candidate =>
      candidate.targetCanonicalCapabilityIds.includes(capabilityId)
    );
    assert.ok(seed, capabilityId);
    const definition = v9ScenarioDraftDefinitions.find(
      candidate => candidate.scenarioId === seed.scenarioId
    );
    assert.ok(definition, capabilityId);
    const fixture = definition.setup[0] as { data?: Record<string, string> };
    assert.ok(fixture.data?.['evidence.json'], capabilityId);
    const evidence = JSON.parse(fixture.data['evidence.json']) as {
      exactField: string;
      brokenValue: string;
    };
    const healthy = JSON.parse(fixture.data['healthy-control.json']!) as {
      healthyValue: string;
    };
    return {
      exactField: evidence.exactField,
      brokenValue: evidence.brokenValue,
      healthyValue: healthy.healthyValue,
    };
  };

  assert.deepEqual(
    evidenceFor(
      'canonical:verify-the-podsecuritypolicy-is-disabled-to-ensure-use-of-securi:712f7beb9ca2'
    ),
    {
      exactField: 'admissionControl.enabledPlugins',
      brokenValue: '["NamespaceLifecycle","ServiceAccount","PodSecurityPolicy"]',
      healthyValue: '["NamespaceLifecycle","ServiceAccount"]',
    }
  );
  assert.deepEqual(
    evidenceFor(
      'canonical:the-kubernetes-api-server-must-have-the-insecure-bind-address-no:5fb7be158406'
    ),
    {
      exactField: 'arguments.--bind-address',
      brokenValue: '0.0.0.0',
      healthyValue: 'absent',
    }
  );
  assert.deepEqual(
    evidenceFor(
      'canonical:the-kubernetes-kubelet-must-have-the-read-only-port-flag-disable:a962c091f502'
    ),
    {
      exactField: 'readOnlyPort',
      brokenValue: '10255',
      healthyValue: '0',
    }
  );
  assert.deepEqual(
    evidenceFor(
      'canonical:ensure-integrity-monitoring-for-shielded-gke-nodes-is-enabled-au:a7e437b2460d'
    ),
    {
      exactField: 'shieldedInstanceConfig.enableIntegrityMonitoring',
      brokenValue: 'false',
      healthyValue: 'true',
    }
  );
  assert.deepEqual(
    evidenceFor(
      'canonical:ensure-secure-boot-for-shielded-gke-nodes-is-enabled-automated:f312d2ab77ba'
    ),
    {
      exactField: 'shieldedInstanceConfig.enableSecureBoot',
      brokenValue: 'false',
      healthyValue: 'true',
    }
  );
  assert.deepEqual(
    evidenceFor(
      'canonical:ensure-kubernetes-secrets-are-encrypted-using-customer-master-ke:81ef1971c610'
    ),
    {
      exactField: 'encryptionConfig[0].provider.keyArn',
      brokenValue: 'absent',
      healthyValue: 'arn:aws:kms:us-west-2:111122223333:key/example',
    }
  );
  assert.deepEqual(
    evidenceFor(
      'canonical:kubernetes-endpoints-must-use-approved-organizational-certificat:089e6d7d63fd'
    ),
    {
      exactField: 'tlsCertificate.issuer.organization',
      brokenValue: 'unapproved.example',
      healthyValue: 'approved-organizational-pki',
    }
  );
  assert.deepEqual(
    evidenceFor(
      'canonical:the-kubernetes-component-manifests-must-be-owned-by-root-compone:7379d1286a90'
    ),
    {
      exactField: 'files[/etc/kubernetes/manifests].owner',
      brokenValue: 'nobody:nogroup',
      healthyValue: 'root:root',
    }
  );
  assert.deepEqual(
    evidenceFor(
      'canonical:verify-the-openshift-default-etcd-pod-specification-file-ownersh:c12bdeed2819'
    ),
    {
      exactField: 'files[/etc/kubernetes/manifests/etcd.yaml].owner',
      brokenValue: 'nobody:nogroup',
      healthyValue: 'root:root',
    }
  );
  assert.equal(
    componentFor(
      'canonical:kubernetes-controller-manager-must-have-the-ssl-certificate-auth:807e2719223a'
    ),
    'kube-controller-manager'
  );
  assert.deepEqual(
    evidenceFor(
      'canonical:kubernetes-controller-manager-must-have-the-ssl-certificate-auth:807e2719223a'
    ),
    {
      exactField: 'arguments.--root-ca-file',
      brokenValue: 'absent',
      healthyValue: '/etc/kubernetes/pki/ca.crt',
    }
  );
  assert.equal(
    componentFor(
      'canonical:kubernetes-kubelet-must-have-the-ssl-certificate-authority-set-c:01a69ffea4a6'
    ),
    'kubelet'
  );
  assert.equal(
    componentFor(
      'canonical:the-kubernetes-scheduler-must-have-secure-binding-component-of-e:74d655fdae18'
    ),
    'kube-scheduler'
  );
});

test('v9 documentation has exact catalogue parity', () => {
  const documentation = readFileSync(
    path.resolve(evalRoot, '..', 'docs', 'kubernetes-rule-gap-scenarios-v9.md'),
    'utf8'
  );
  assert.match(documentation, /\*\*218\*\* canonical capabilities/);
  const documentedRows = new Set(
    documentation
      .split('\n')
      .filter(line => line.match(/^\|\s*rule-gap-v9-/))
      .map(line =>
        line
          .split('|')
          .map(cell => cell.trim())
          .slice(1, -1)
          .join('|')
      )
  );
  assert.equal(documentedRows.size, 218);
});
