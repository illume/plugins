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
import yaml from 'js-yaml';
import { isKwokCompatible } from '../contracts/kwokCompatibility.js';
import { loadAllScenarios, scenariosRoot } from './loader.js';

interface Coverage {
  source_catalog:
    | 'registrations/rule-gap-scenarios-v1.json'
    | 'registrations/rule-gap-scenarios-v2.json'
    | 'registrations/rule-gap-scenarios-v3.json'
    | 'registrations/rule-gap-scenarios-v4.json'
    | 'registrations/rule-gap-scenarios-v5.json'
    | 'registrations/rule-gap-scenarios-v6.json'
    | 'registrations/rule-gap-scenarios-v7.json'
    | 'registrations/rule-gap-scenarios-v8.json'
    | 'registrations/rule-gap-scenarios-v9.json';
  scenario_id: string;
  implementation_status: 'authored';
  qualification_status: 'pending';
  detection_validation: 'normalized_predicate';
  external_tool_execution: false;
  target_rule_ids: string[];
  target_semantic_group_ids: string[];
  target_canonical_capability_ids?: string[];
  target_tool_ids: string[];
  target_rule_count: number;
  provenance_refs: string[];
}

interface GapCatalogue {
  scenarios: Array<Coverage & { title: string }>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const draftRoot = path.join(evalRoot, 'scenario-drafts');
const readJson = <T>(filePath: string): T => JSON.parse(readFileSync(filePath, 'utf8')) as T;

function setupDocuments(scenarioId: string): Array<Record<string, any>> {
  const documents: Array<Record<string, any>> = [];
  yaml.loadAll(readFileSync(path.join(draftRoot, scenarioId, 'setup.yaml'), 'utf8'), document => {
    if (document) documents.push(document as Record<string, any>);
  });
  return documents;
}

function resource(
  documents: Array<Record<string, any>>,
  kind: string,
  name: string
): Record<string, any> {
  const match = documents.find(
    document => document.kind === kind && document.metadata?.name === name
  );
  assert.ok(match, `${kind}/${name}`);
  return match;
}

test('Scenarios Goal implementation batches contain 980 valid pending bundles', () => {
  const scenarios = loadAllScenarios(draftRoot);
  assert.equal(scenarios.length, 980);
  assert.ok(scenarios.every(scenario => scenario.manifest.provenance.lifecycle_state === 'draft'));
  assert.ok(
    scenarios.every(scenario => scenario.manifest.portfolio.qualification_status === 'pending')
  );
  assert.ok(
    scenarios.every(
      scenario =>
        scenario.manifest.declared_kwok_compatible ===
        isKwokCompatible(scenario.manifest.required_mechanisms)
    )
  );
  assert.ok(scenarios.some(scenario => !scenario.manifest.declared_kwok_compatible));
  assert.equal(loadAllScenarios(scenariosRoot).length, 275);
});

test('draft coverage metadata exactly matches its v1 through v9 source targets', () => {
  const schema = readJson<AnySchema>(
    path.join(evalRoot, 'schema', 'draft-scenario-coverage.schema.json')
  );
  const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
    schema
  );
  const catalogues = new Map(
    [
      'registrations/rule-gap-scenarios-v1.json',
      'registrations/rule-gap-scenarios-v2.json',
      'registrations/rule-gap-scenarios-v3.json',
      'registrations/rule-gap-scenarios-v4.json',
      'registrations/rule-gap-scenarios-v5.json',
      'registrations/rule-gap-scenarios-v6.json',
      'registrations/rule-gap-scenarios-v7.json',
      'registrations/rule-gap-scenarios-v8.json',
      'registrations/rule-gap-scenarios-v9.json',
    ].map(relativePath => [relativePath, readJson<GapCatalogue>(path.join(evalRoot, relativePath))])
  );
  const coverageRows = readdirSync(draftRoot)
    .filter(directory => existsSync(path.join(draftRoot, directory, 'coverage.json')))
    .map(directory => readJson<Coverage>(path.join(draftRoot, directory, 'coverage.json')));

  assert.equal(coverageRows.length, 980);
  const targetRuleIds = new Set<string>();
  const targetGroupIds = new Set<string>();
  const targetToolIds = new Set<string>();
  for (const coverage of coverageRows) {
    assert.equal(validate(coverage), true, JSON.stringify(validate.errors));
    const gap = catalogues
      .get(coverage.source_catalog)
      ?.scenarios.find(scenario => scenario.scenario_id === coverage.scenario_id);
    assert.ok(gap, coverage.scenario_id);
    assert.equal(coverage.implementation_status, 'authored');
    assert.equal(coverage.qualification_status, 'pending');
    assert.equal(coverage.detection_validation, 'normalized_predicate');
    assert.equal(coverage.external_tool_execution, false);
    assert.equal(coverage.target_rule_count, coverage.target_rule_ids.length);
    assert.deepEqual(coverage.target_rule_ids, gap.target_rule_ids);
    assert.deepEqual(coverage.target_semantic_group_ids, gap.target_semantic_group_ids);
    assert.deepEqual(coverage.target_canonical_capability_ids, gap.target_canonical_capability_ids);
    assert.deepEqual(coverage.target_tool_ids, gap.target_tool_ids);
    for (const ruleId of coverage.target_rule_ids) {
      assert.equal(targetRuleIds.has(ruleId), false, ruleId);
      targetRuleIds.add(ruleId);
    }
    coverage.target_semantic_group_ids.forEach(groupId => targetGroupIds.add(groupId));
    coverage.target_tool_ids.forEach(toolId => targetToolIds.add(toolId));
  }
  assert.equal(targetRuleIds.size, 5299);
  assert.equal(targetGroupIds.size, 1323);
  assert.equal(targetToolIds.size, 12);
});

test('every authored setup contains a concrete non-placeholder fixture', () => {
  for (const directory of readdirSync(draftRoot)) {
    const setup = readFileSync(path.join(draftRoot, directory, 'setup.yaml'), 'utf8');
    assert.ok(setupDocuments(directory).length > 0, directory);
    assert.doesNotMatch(setup, /\b(?:TODO|placeholder|TBD)\b/i, directory);
  }
});

test('generated setup manifests encode each intended predicate', () => {
  const writable = resource(
    setupDocuments('rule-gap-writable-container-root-filesystem'),
    'Deployment',
    'app'
  );
  assert.equal(
    writable.spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem,
    false
  );

  const netRaw = resource(setupDocuments('rule-gap-net-raw-capability'), 'Deployment', 'app');
  assert.deepEqual(netRaw.spec.template.spec.containers[0].securityContext.capabilities, {
    add: ['NET_RAW'],
    drop: [],
  });

  const hostNetwork = resource(
    setupDocuments('rule-gap-host-network-namespace'),
    'Deployment',
    'app'
  );
  assert.equal(hostNetwork.spec.template.spec.hostNetwork, true);

  const binding = resource(
    setupDocuments('rule-gap-cluster-admin-rolebinding'),
    'RoleBinding',
    'app-admin'
  );
  assert.deepEqual(binding.roleRef, {
    apiGroup: 'rbac.authorization.k8s.io',
    kind: 'ClusterRole',
    name: 'cluster-admin',
  });

  const noPolicy = setupDocuments('rule-gap-namespace-without-network-policy');
  assert.equal(noPolicy.filter(document => document.kind === 'Deployment').length, 1);
  assert.equal(noPolicy.filter(document => document.kind === 'NetworkPolicy').length, 0);

  const dangling = setupDocuments('rule-gap-dangling-network-policy-selector');
  const policy = resource(dangling, 'NetworkPolicy', 'web-policy');
  const workload = resource(dangling, 'Deployment', 'web');
  assert.deepEqual(policy.spec.podSelector.matchLabels, { app: 'api' });
  assert.deepEqual(workload.spec.template.metadata.labels, { app: 'web' });

  const noLiveness = resource(
    setupDocuments('rule-gap-missing-liveness-probe'),
    'Deployment',
    'app'
  );
  assert.equal(noLiveness.spec.template.spec.containers[0].livenessProbe, undefined);
  assert.ok(noLiveness.spec.template.spec.containers[0].readinessProbe);

  const noReadiness = resource(
    setupDocuments('rule-gap-missing-readiness-probe'),
    'Deployment',
    'app'
  );
  assert.equal(noReadiness.spec.template.spec.containers[0].readinessProbe, undefined);
  assert.ok(noReadiness.spec.template.spec.containers[0].livenessProbe);

  const noCpu = resource(setupDocuments('rule-gap-cpu-requirements-missing'), 'Deployment', 'app')
    .spec.template.spec.containers[0].resources;
  assert.equal(noCpu.requests.cpu, undefined);
  assert.equal(noCpu.limits.cpu, undefined);
  assert.equal(noCpu.requests.memory, '64Mi');

  const noMemory = resource(
    setupDocuments('rule-gap-memory-requirements-missing'),
    'Deployment',
    'app'
  ).spec.template.spec.containers[0].resources;
  assert.equal(noMemory.requests.memory, undefined);
  assert.equal(noMemory.limits.memory, undefined);
  assert.equal(noMemory.requests.cpu, '100m');

  const latest = resource(setupDocuments('rule-gap-latest-image-tag'), 'Deployment', 'app');
  assert.equal(latest.spec.template.spec.containers[0].image, 'nginx:latest');

  const tagged = resource(setupDocuments('rule-gap-image-not-pinned'), 'Deployment', 'app');
  assert.equal(tagged.spec.template.spec.containers[0].image, 'nginx:1.27');

  const replicas = resource(setupDocuments('rule-gap-insufficient-replicas'), 'Deployment', 'app');
  assert.equal(replicas.spec.replicas, 1);

  const ingress = resource(setupDocuments('rule-gap-dangling-ingress-backend'), 'Ingress', 'web');
  assert.equal(ingress.spec.rules[0].http.paths[0].backend.service.name, 'missing-web');

  const missingAccount = resource(
    setupDocuments('rule-gap-missing-service-account'),
    'Deployment',
    'app'
  );
  assert.equal(missingAccount.spec.template.spec.serviceAccountName, 'missing-app');

  const duplicateEnv = resource(
    setupDocuments('rule-gap-duplicate-environment-variable'),
    'Deployment',
    'app'
  ).spec.template.spec.containers[0].env;
  assert.deepEqual(
    duplicateEnv.map((entry: { name: string }) => entry.name),
    ['LOG_LEVEL', 'LOG_LEVEL']
  );
});

test('candidate packets do not contain rule IDs or evaluator canaries', () => {
  for (const directory of readdirSync(draftRoot)) {
    const candidate = readFileSync(
      path.join(draftRoot, directory, 'candidate-packet.json'),
      'utf8'
    );
    const taskPrompt = (JSON.parse(candidate) as { task_prompt: string }).task_prompt.toLowerCase();
    const coverage = readJson<Coverage>(path.join(draftRoot, directory, 'coverage.json'));
    assert.doesNotMatch(candidate, /EVAL-CANARY/);
    for (const ruleId of coverage.target_rule_ids) assert.equal(candidate.includes(ruleId), false);
    for (const toolId of coverage.target_tool_ids) {
      assert.equal(taskPrompt.includes(toolId.toLowerCase()), false, `${directory}/${toolId}`);
    }
  }
});
