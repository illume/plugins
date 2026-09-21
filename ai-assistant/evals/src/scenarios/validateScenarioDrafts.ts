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
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';
import { canonicalStringify, type JsonValue } from '../canonicalJson.js';
import { createClusterAdapter } from '../cluster/adapterFactory.js';
import type { ClusterAdapter } from '../cluster/clusterAdapter.js';
import type { AcceptedFact, ClusterProfileName } from '../contracts/evaluationContracts.js';
import { loadScenario, type LoadedScenario } from './loader.js';

const activeScenarioCount = 275;
const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const draftRoot = path.join(evalRoot, 'scenario-drafts');
const cataloguePaths = Array.from(
  { length: 9 },
  (_, index) => `registrations/rule-gap-scenarios-v${index + 1}.json`
);
const sourceOnlyScenarioIds = new Set([
  'rule-gap-namespace-has-no-service-account',
  'rule-gap-pod-template-omits-restart-policy',
  'rule-gap-workload-uses-default-namespace',
]);

interface ValidationOptions {
  profile: 'local-minikube' | 'aks';
  start: number;
  limit: number;
  output?: string;
}

interface ValidationResult {
  portfolio_index: number;
  scenario_id: string;
  status: 'passed' | 'failed' | 'skipped';
  accepted_fact_set?: number;
  observed_fact_count?: number;
  reason?: string;
}

interface ValidationReport {
  schema_version: '1.0.0';
  profile: ValidationOptions['profile'];
  start: number;
  limit: number;
  qualification_status_changed: false;
  results: ValidationResult[];
}

export function orderedDraftScenarioIds(): string[] {
  const ids = cataloguePaths.flatMap(relativePath => {
    const catalogue = JSON.parse(readFileSync(path.join(evalRoot, relativePath), 'utf8')) as {
      scenarios: Array<{ scenario_id: string }>;
    };
    return catalogue.scenarios.map(scenario => scenario.scenario_id);
  });
  assert.equal(ids.length, 980, 'expected 980 ordered draft scenarios');
  assert.equal(new Set(ids).size, ids.length, 'draft scenario order contains duplicate IDs');
  return ids;
}

function parseFieldPath(fieldPath: string): Array<string | number> {
  if (/[#+]/.test(fieldPath)) {
    throw new Error(`unsupported executable field path: ${fieldPath}`);
  }
  const tokens: Array<string | number> = [];
  const pattern = /(?:^|\.)([^.[\]]+)|\[(\d+)\]|\[([^\]]+)\]/g;
  let consumed = 0;
  for (const match of fieldPath.matchAll(pattern)) {
    if (match.index !== consumed)
      throw new Error(`unsupported executable field path: ${fieldPath}`);
    tokens.push(match[1] ?? (match[2] === undefined ? match[3]! : Number(match[2])));
    consumed = match.index + match[0].length;
  }
  if (consumed !== fieldPath.length || tokens.length === 0) {
    throw new Error(`unsupported executable field path: ${fieldPath}`);
  }
  return tokens;
}

export function resolveFieldPath(resource: JsonValue, fieldPath: string): JsonValue | undefined {
  if (fieldPath.includes(' + ')) {
    const values = fieldPath.split(' + ').map(part => resolveFieldPath(resource, part));
    if (values.every(value => value === undefined)) return '<both absent>';
    return values.map(value => value ?? '<absent>');
  }
  if (fieldPath.includes(',')) {
    return fieldPath.split(',').map(part => resolveFieldPath(resource, part) ?? '<absent>');
  }
  const filtered = /^(.*?)\[\??([A-Za-z0-9_.]+)=([^\]]+)\](?:\.(.*))?$/.exec(fieldPath);
  if (filtered) {
    const items = resolveFieldPath(resource, filtered[1]!);
    if (!Array.isArray(items)) return undefined;
    const expected = filtered[3] === 'true' ? true : filtered[3] === 'false' ? false : filtered[3];
    const matches = items.filter(item => resolveFieldPath(item, filtered[2]!) === expected);
    if (filtered[4] === 'length') return matches.length;
    if (!filtered[4]) return matches;
    const values = matches.map(item => resolveFieldPath(item, filtered[4]!) ?? '<absent>');
    return values.length === 1 ? values[0] : values;
  }
  const condition = /^(.*?)\[\??(?:@\.)?type(?:==)?=?["']?([^\]"']+)["']?\]\.(.+)$/.exec(fieldPath);
  if (condition) {
    const conditions = resolveFieldPath(resource, condition[1]!);
    if (!Array.isArray(conditions)) return undefined;
    const match = conditions.find(item => {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
      return item.type === condition[2];
    });
    return match === undefined ? undefined : resolveFieldPath(match, condition[3]!);
  }
  const namedItems = /^(.*?)\[metadata\.name=([^\]]+)\](?:\.(.*))?$/.exec(fieldPath);
  if (namedItems) {
    const collection = resolveFieldPath(resource, namedItems[1]!);
    if (!Array.isArray(collection)) return undefined;
    const filtered = collection.filter(
      item =>
        item !== null &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        item.metadata !== null &&
        typeof item.metadata === 'object' &&
        !Array.isArray(item.metadata) &&
        item.metadata.name === namedItems[2]
    );
    return namedItems[3] ? resolveFieldPath(filtered, namedItems[3]) : filtered;
  }
  const resolve = (
    value: JsonValue | undefined,
    tokens: Array<string | number>
  ): JsonValue | undefined => {
    const [token, ...remaining] = tokens;
    if (token === undefined) return value;
    if (token === '*' && Array.isArray(value)) {
      return value
        .map(item => resolve(item, remaining))
        .filter((item): item is JsonValue => item !== undefined);
    }
    if (token === 'length' && Array.isArray(value)) {
      return resolve(value.length, remaining);
    }
    if (typeof token === 'number') {
      value = Array.isArray(value) ? value[token] : undefined;
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const dottedKey = [token, ...remaining].join('.');
      if (value[token] === undefined && value[dottedKey] !== undefined) {
        return value[dottedKey];
      }
      value = value[token];
    } else {
      value = undefined;
    }
    return value === undefined ? undefined : resolve(value, remaining);
  };
  return resolve(resource, parseFieldPath(fieldPath));
}

export function resolveFactField(resource: JsonValue, fieldPath: string): JsonValue | undefined {
  if (!fieldPath.includes('#')) {
    const configMapJson = /^data\.([^.]+\.json)\.(.+)$/.exec(fieldPath);
    if (configMapJson) {
      const source = resolveFieldPath(resource, `data[${configMapJson[1]}]`);
      if (typeof source !== 'string') return undefined;
      return resolveFieldPath(JSON.parse(source) as JsonValue, configMapJson[2]!);
    }
    const value = resolveFieldPath(resource, fieldPath);
    if (fieldPath.endsWith('.b64') && typeof value === 'string') {
      const decoded = Buffer.from(value, 'base64');
      if (decoded.toString('base64') !== value.replace(/\s/g, '')) {
        throw new Error(`encoded ConfigMap field ${fieldPath} is not valid base64`);
      }
      return decoded.toString('utf8');
    }
    return value;
  }
  const encoded = /^data\.([^#]+)#(.+)$/.exec(fieldPath);
  if (!encoded || resource === null || typeof resource !== 'object' || Array.isArray(resource)) {
    throw new Error(`unsupported executable field path: ${fieldPath}`);
  }
  const data = resource.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`encoded field path has no ConfigMap data: ${fieldPath}`);
  }
  const keyPattern = encoded[1]!;
  const matchingKeys = Object.keys(data)
    .filter(key =>
      keyPattern.includes('*')
        ? new RegExp(
            `^${keyPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '.*')}$`
          ).test(key)
        : key === keyPattern
    )
    .sort();
  if (matchingKeys.length === 0) return undefined;
  const resolved = matchingKeys.map(key => {
    const source = data[key];
    if (typeof source !== 'string') {
      throw new Error(`encoded ConfigMap field data.${key} is not a string`);
    }
    const decoded = yaml.load(source) as JsonValue;
    return resolveFieldPath(decoded, encoded[2]!);
  });
  return matchingKeys.length === 1 ? resolved[0] : resolved.filter(value => value !== undefined);
}

export function serializeObservedValue(value: JsonValue | undefined): string {
  if (value === undefined) return '<absent>';
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return String(value);
  return JSON.stringify(value);
}

export function observedValueMatches(observed: string, expected: string): boolean {
  if (observed === expected) return true;
  if (
    observed === '<absent>' &&
    (expected === 'absent' ||
      expected === 'field absent' ||
      expected.startsWith('field absent for '))
  )
    return true;
  try {
    return (
      canonicalStringify(JSON.parse(observed) as JsonValue) ===
      canonicalStringify(JSON.parse(expected) as JsonValue)
    );
  } catch {
    return false;
  }
}

export function factValueMatches(observedValue: JsonValue | undefined, expected: string): boolean {
  if (
    (observedValue === undefined || observedValue === '<absent>') &&
    (expected === '[]' || expected === '0 ServiceAccounts')
  ) {
    return true;
  }
  if (
    observedValue !== null &&
    typeof observedValue === 'object' &&
    !Array.isArray(observedValue) &&
    Object.keys(observedValue).length === 0 &&
    expected === 'field absent'
  ) {
    return true;
  }
  if (
    observedValue !== null &&
    typeof observedValue === 'object' &&
    !Array.isArray(observedValue) &&
    expected === 'requests set; limits absent'
  ) {
    return observedValue.requests !== undefined && observedValue.limits === undefined;
  }
  if (
    typeof observedValue === 'string' &&
    expected === 'PEM private-key header and footer present'
  ) {
    return /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]+-----END (?:RSA |EC )?PRIVATE KEY-----/.test(
      observedValue
    );
  }
  if (Array.isArray(observedValue) && /^\[[A-Z0-9_,/-]+\]$/.test(expected)) {
    return observedValueMatches(
      serializeObservedValue(observedValue),
      JSON.stringify(expected.slice(1, -1).split(','))
    );
  }
  if (
    observedValue !== null &&
    typeof observedValue === 'object' &&
    !Array.isArray(observedValue) &&
    /(?:apiGroups=\[[^\]]*\]; )?resources=\[[^\]]*\]; verbs=\[[^\]]*\]/.test(expected)
  ) {
    const parseList = (name: string): string[] | undefined => {
      const match = new RegExp(`${name}=\\[([^\\]]*)\\]`).exec(expected);
      if (!match) return undefined;
      if (!match[1]) return [''];
      return match[1].split(',').map(value => value.replace(/^"|"$/g, ''));
    };
    const record = observedValue as Record<string, JsonValue>;
    return ['apiGroups', 'resources', 'verbs'].every(name => {
      const expectedValues = parseList(name);
      return (
        expectedValues === undefined ||
        observedValueMatches(serializeObservedValue(record[name]), JSON.stringify(expectedValues))
      );
    });
  }
  const alternatives = /^<one of: (.+)>$/.exec(expected);
  if (alternatives) {
    return alternatives[1]!.split(', ').some(option => factValueMatches(observedValue, option));
  }
  if (
    (expected === '<absent or 0>' || expected === '0 or <absent>') &&
    (observedValue === undefined || observedValue === '<absent>' || observedValue === 0)
  ) {
    return true;
  }
  if (typeof observedValue === 'string') {
    const dynamicStringMatches = (fragment: string): boolean => {
      if (fragment === 'two identical inode numbers') {
        const inodeLines = observedValue
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(line => /^\d+$/.test(line));
        return inodeLines.length >= 2 && inodeLines.at(-1) === inodeLines.at(-2);
      }
      if (fragment.startsWith('<sha256> ')) {
        const target = fragment.slice('<sha256> '.length);
        return new RegExp(`[a-f0-9]{64}\\s+${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(
          observedValue
        );
      }
      return false;
    };
    if (expected === 'two identical inode numbers') {
      const inodeLines = observedValue
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => /^\d+$/.test(line));
      return inodeLines.length >= 2 && inodeLines.at(-1) === inodeLines.at(-2);
    }
    if (expected.startsWith('<sha256> ')) {
      const target = expected.slice('<sha256> '.length);
      return new RegExp(`[a-f0-9]{64}\\s+${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(
        observedValue
      );
    }
    const fragments = expected.split('; ').filter(Boolean);
    if (
      fragments.length > 1 &&
      fragments.every(
        fragment => observedValue.includes(fragment) || dynamicStringMatches(fragment)
      )
    ) {
      return true;
    }
    if (observedValue.includes(expected)) return true;
  }
  if (Array.isArray(observedValue)) {
    if (/^\d+$/.test(expected) && observedValue.length === Number(expected)) return true;
    if (observedValue.every(item => typeof item === 'string')) {
      const values = observedValue as string[];
      if (values.includes(expected)) return true;
      const absent = /^([a-z0-9-]+) argument absent$/i.exec(expected);
      if (absent) {
        const flag = `--${absent[1]}`;
        return !values.some(value => value === flag || value.startsWith(`${flag}=`));
      }
      if (expected === 'etcd-certfile present; etcd-keyfile absent') {
        return (
          values.some(value => value.startsWith('--etcd-certfile=')) &&
          !values.some(value => value.startsWith('--etcd-keyfile='))
        );
      }
    }
    if (observedValue.every(Array.isArray)) {
      const summary = /^(\d+) of (\d+) contain (.+)$/.exec(expected);
      if (summary) {
        const commandLists = observedValue as JsonValue[][];
        const expectedCount = Number(summary[1]);
        const totalCount = Number(summary[2]);
        const argument = summary[3]!;
        return (
          commandLists.length === totalCount &&
          commandLists.filter(commands => commands.includes(argument)).length === expectedCount
        );
      }
    }
    if (expected.includes('; ')) {
      const expectedParts = expected.split('; ');
      if (expectedParts.length === observedValue.length) {
        return expectedParts.every((part, index) => {
          const expectedValue = part.includes('=') ? part.slice(part.indexOf('=') + 1) : part;
          return factValueMatches(observedValue[index], expectedValue);
        });
      }
    }
  }
  return observedValueMatches(serializeObservedValue(observedValue), expected);
}

async function snapshotFor(
  adapter: ClusterAdapter,
  namespace: string,
  resourceRef: string,
  cache: Map<string, JsonValue>
): Promise<JsonValue | undefined> {
  const cached = cache.get(resourceRef);
  if (cached) return cached;
  const selectedPod = /^pod\[label=([^=]+)=(.+)\]$/.exec(resourceRef);
  const prefixedPod = /^pod\/([^*]+)\*$/.exec(resourceRef);
  if (selectedPod || prefixedPod) {
    if (!adapter.listResourceSnapshots) {
      throw new Error('cluster adapter cannot validate label-selected Pod predicates');
    }
    const pods = await adapter.listResourceSnapshots(namespace, 'pod');
    const matching = pods.filter(pod => {
      if (prefixedPod) {
        const name = resolveFieldPath(pod, 'metadata.name');
        return typeof name === 'string' && name.startsWith(prefixedPod[1]!);
      }
      const labels = resolveFieldPath(pod, 'metadata.labels');
      return (
        labels !== null &&
        typeof labels === 'object' &&
        !Array.isArray(labels) &&
        labels[selectedPod![1]!] === selectedPod![2]
      );
    });
    if (matching.length === 0) throw new Error(`expected at least one ${resourceRef}`);
    const newest = matching.sort((left, right) => {
      const leftTime = resolveFieldPath(left, 'metadata.creationTimestamp');
      const rightTime = resolveFieldPath(right, 'metadata.creationTimestamp');
      return String(rightTime ?? '').localeCompare(String(leftTime ?? ''));
    })[0]!;
    cache.set(resourceRef, newest);
    return newest;
  }
  if (resourceRef.endsWith('/*')) {
    if (!adapter.listResourceSnapshots) {
      throw new Error('cluster adapter cannot validate resource inventory predicates');
    }
    const resource = resourceRef.slice(0, -2);
    const snapshot = { items: await adapter.listResourceSnapshots(namespace, resource) };
    cache.set(resourceRef, snapshot);
    return snapshot;
  }
  const target = await adapter.getResourceIdentity(namespace, resourceRef);
  if (!target) return undefined;
  const snapshot = await adapter.getResourceSnapshot(target);
  if (!snapshot) throw new Error(`resource ${resourceRef} could not be observed`);
  cache.set(resourceRef, snapshot);
  return snapshot;
}

async function observedFactValue(
  adapter: ClusterAdapter,
  namespace: string,
  fact: AcceptedFact,
  cache: Map<string, JsonValue>
): Promise<string> {
  if (fact.resource_ref.startsWith('metric/')) {
    throw new Error(`metric evidence adapter unavailable for ${fact.resource_ref}`);
  }
  if (fact.resource_ref.includes(' + ')) {
    const refs = fact.resource_ref.split(' + ');
    const paths = fact.field_path.split(' + ');
    const values: JsonValue[] = [];
    for (const ref of refs) {
      const related = await snapshotFor(adapter, namespace, ref, cache);
      if (related === undefined) values.push('<absent>');
      else
        for (const fieldPath of paths)
          values.push(resolveFactField(related, fieldPath) ?? '<absent>');
    }
    return factValueMatches(values, fact.observed_value)
      ? fact.observed_value
      : serializeObservedValue(values);
  }
  const snapshot = await snapshotFor(adapter, namespace, fact.resource_ref, cache);
  if (snapshot === undefined) return '<absent>';
  if (fact.observed_value === 'reference names an absent object') {
    if (!adapter.listResourceSnapshots) {
      throw new Error('cluster adapter cannot validate missing-reference predicates');
    }
    const value = resolveFactField(snapshot, fact.field_path);
    const referenceName =
      typeof value === 'string'
        ? value
        : value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value.name
        : undefined;
    const lowerPath = fact.field_path.toLowerCase();
    const resource = lowerPath.includes('configmap')
      ? 'configmap'
      : lowerPath.includes('persistentvolumeclaim')
      ? 'persistentvolumeclaim'
      : lowerPath.includes('secret')
      ? 'secret'
      : lowerPath.includes('cert-manager.io/issuer')
      ? 'issuer'
      : lowerPath.includes('konghq.com/plugins')
      ? 'kongplugin'
      : lowerPath.startsWith('subjects[')
      ? 'serviceaccount'
      : undefined;
    if (!resource || typeof referenceName !== 'string') {
      throw new Error(`unsupported missing-reference predicate: ${fact.field_path}`);
    }
    const targetNamespace =
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof value.namespace === 'string'
        ? value.namespace
        : namespace;
    const items = await adapter.listResourceSnapshots(targetNamespace, resource);
    return items.some(item => resolveFieldPath(item, 'metadata.name') === referenceName)
      ? referenceName
      : fact.observed_value;
  }
  if (
    fact.field_path === 'spec.selector + selected container ports' ||
    fact.field_path === 'spec.ports[0].targetPort + selected container ports'
  ) {
    if (!adapter.listResourceSnapshots) {
      throw new Error('cluster adapter cannot validate selected Pod port predicates');
    }
    const selector = resolveFactField(snapshot, 'spec.selector');
    const pods = await adapter.listResourceSnapshots(namespace, 'pod');
    const selected = pods.filter(pod => {
      const labels = resolveFieldPath(pod, 'metadata.labels');
      return (
        selector !== null &&
        typeof selector === 'object' &&
        !Array.isArray(selector) &&
        labels !== null &&
        typeof labels === 'object' &&
        !Array.isArray(labels) &&
        Object.entries(selector).every(([key, value]) => labels[key] === value)
      );
    });
    const ports = selected.flatMap(pod => {
      const containers = resolveFieldPath(pod, 'spec.containers');
      return Array.isArray(containers)
        ? containers.flatMap(container => {
            const containerPorts = resolveFieldPath(container, 'ports');
            return Array.isArray(containerPorts) ? containerPorts : [];
          })
        : [];
    });
    const targetPort = resolveFactField(snapshot, 'spec.ports[0].targetPort');
    const matched =
      fact.observed_value === 'selected Pod has no explicit container ports'
        ? ports.length === 0
        : fact.observed_value === 'selected Pod declares named container port http'
        ? ports.some(port => resolveFieldPath(port, 'name') === 'http')
        : fact.observed_value === 'numeric targetPort 8080 with selected container port 8080'
        ? targetPort === 8080 &&
          ports.some(port => resolveFieldPath(port, 'containerPort') === targetPort)
        : fact.observed_value === 'web resolving to selected container port 8080'
        ? targetPort === 'web' &&
          ports.some(
            port =>
              resolveFieldPath(port, 'name') === 'web' &&
              resolveFieldPath(port, 'containerPort') === 8080
          )
        : false;
    return matched
      ? fact.observed_value
      : serializeObservedValue([selector ?? targetPort ?? '<absent>', ports]);
  }
  if (fact.field_path.endsWith(' + logs')) {
    if (!adapter.getPodLogs) throw new Error('cluster adapter cannot validate Pod log predicates');
    const commandPath = fact.field_path.slice(0, -' + logs'.length);
    const command = resolveFactField(snapshot, commandPath);
    const podName = resolveFieldPath(snapshot, 'metadata.name');
    if (typeof podName !== 'string') throw new Error(`${fact.resource_ref} has no Pod name`);
    const logs = await adapter.getPodLogs(namespace, podName);
    const commandText =
      Array.isArray(command) && command.every(value => typeof value === 'string')
        ? command.join('\n')
        : serializeObservedValue(command);
    const combined = `${commandText}\n${logs}`;
    return factValueMatches(combined, fact.observed_value) ? fact.observed_value : combined;
  }
  if (fact.field_path === 'roleRef + referenced ClusterRole.rules[0]') {
    const roleName = resolveFactField(snapshot, 'roleRef.name');
    if (typeof roleName !== 'string') return '<absent>';
    const role = await snapshotFor(adapter, namespace, `clusterrole/${roleName}`, cache);
    const rule = role === undefined ? undefined : resolveFactField(role, 'rules[0]');
    return factValueMatches(rule, fact.observed_value)
      ? fact.observed_value
      : serializeObservedValue(rule);
  }
  if (fact.field_path === 'ServiceAccount inventory for metadata.name=accountless-namespace') {
    if (!adapter.listResourceSnapshots) {
      throw new Error('cluster adapter cannot validate ServiceAccount inventory predicates');
    }
    const items = await adapter.listResourceSnapshots('accountless-namespace', 'serviceaccount');
    return factValueMatches(items.length, fact.observed_value)
      ? fact.observed_value
      : String(items.length);
  }
  const inventoryRelation = /^(.*?) \+ (?:matching )?([A-Za-z]+)(?: selector)? inventory$/.exec(
    fact.field_path
  );
  if (inventoryRelation) {
    if (!adapter.listResourceSnapshots) {
      throw new Error('cluster adapter cannot validate matching inventory predicates');
    }
    const primary = resolveFactField(snapshot, inventoryRelation[1]!);
    const resourceByName: Record<string, string> = {
      Deployment: 'deployment',
      EndpointSlice: 'endpointslice',
      Namespace: 'namespace',
      PodDisruptionBudget: 'poddisruptionbudget',
      Pod: 'pod',
      ReplicaSet: 'replicaset',
      Role: 'role',
      Service: 'service',
      ServiceAccount: 'serviceaccount',
    };
    const resource = resourceByName[inventoryRelation[2]!];
    if (!resource) throw new Error(`unsupported matching inventory: ${inventoryRelation[2]}`);
    const items = await adapter.listResourceSnapshots(namespace, resource);
    const count = items.filter(item => {
      if (resource === 'namespace') {
        const labels = resolveFieldPath(item, 'metadata.labels');
        const selector =
          primary !== null && typeof primary === 'object' && !Array.isArray(primary)
            ? primary.matchLabels
            : undefined;
        return (
          labels !== null &&
          typeof labels === 'object' &&
          !Array.isArray(labels) &&
          selector !== null &&
          typeof selector === 'object' &&
          !Array.isArray(selector) &&
          Object.entries(selector).every(([key, value]) => labels[key] === value)
        );
      }
      if (resource === 'poddisruptionbudget') {
        const selector = resolveFieldPath(item, 'spec.selector.matchLabels');
        if (typeof primary === 'string')
          return resolveFieldPath(item, 'spec.selector.matchLabels.app') === primary;
        return canonicalStringify(selector ?? null) === canonicalStringify(primary ?? null);
      }
      if (resource === 'replicaset') {
        const owner = primary as Record<string, JsonValue> | undefined;
        return (
          resolveFieldPath(item, 'metadata.name') === owner?.name &&
          resolveFieldPath(item, 'metadata.uid') === owner?.uid
        );
      }
      if (resource === 'endpointslice') {
        const serviceName = resolveFieldPath(snapshot, 'metadata.name');
        if (resolveFieldPath(item, 'metadata.labels[kubernetes.io/service-name]') !== serviceName)
          return false;
        const endpoints = resolveFieldPath(item, 'endpoints');
        return (
          Array.isArray(endpoints) &&
          endpoints.some(endpoint => resolveFieldPath(endpoint, 'conditions.ready') !== false)
        );
      }
      const expectedName =
        typeof primary === 'string'
          ? primary
          : primary !== null && typeof primary === 'object' && !Array.isArray(primary)
          ? primary.name
          : undefined;
      return resolveFieldPath(item, 'metadata.name') === expectedName;
    }).length;
    const value: JsonValue = [primary ?? '<absent>', count];
    return factValueMatches(value, fact.observed_value)
      ? fact.observed_value
      : serializeObservedValue(value);
  }
  const crossResource = /^(.*?) \+ ([a-z]+\/[^.]+)\.(.+)$/.exec(fact.field_path);
  if (crossResource) {
    const primary = resolveFactField(snapshot, crossResource[1]!);
    const related = await snapshotFor(adapter, namespace, crossResource[2]!, cache);
    const secondary =
      related === undefined ? '<absent>' : resolveFactField(related, crossResource[3]!);
    const value: JsonValue = [primary ?? '<absent>', secondary ?? '<absent>'];
    return factValueMatches(value, fact.observed_value)
      ? fact.observed_value
      : serializeObservedValue(value);
  }
  if (fact.field_path === 'logs' || fact.field_path.startsWith('logs[')) {
    if (!adapter.getPodLogs) throw new Error('cluster adapter cannot validate Pod log predicates');
    const podName = resolveFieldPath(snapshot, 'metadata.name');
    if (typeof podName !== 'string') throw new Error(`${fact.resource_ref} has no Pod name`);
    const logs = await adapter.getPodLogs(namespace, podName);
    return factValueMatches(logs, fact.observed_value) ? fact.observed_value : logs;
  }
  const value = resolveFactField(snapshot, fact.field_path);
  if (!factValueMatches(value, fact.observed_value)) return serializeObservedValue(value);
  return fact.observed_value;
}

async function validateScenario(
  adapter: ClusterAdapter,
  namespace: string,
  scenario: LoadedScenario
): Promise<{ acceptedFactSet: number; observedFactCount: number }> {
  const cache = new Map<string, JsonValue>();
  const acceptedResults = await Promise.all(
    scenario.evaluatorPacket.accepted_fact_sets.map(async facts =>
      Promise.all(
        facts.map(async fact => ({
          fact,
          observed: await observedFactValue(adapter, namespace, fact, cache),
        }))
      )
    )
  );
  const acceptedFactSet = acceptedResults.findIndex(results =>
    results.every(({ fact, observed }) => observedValueMatches(observed, fact.observed_value))
  );
  if (acceptedFactSet < 0) {
    const details = acceptedResults
      .flat()
      .map(
        ({ fact, observed }) => `${fact.fact_id}: expected ${fact.observed_value}, got ${observed}`
      )
      .join('; ');
    throw new Error(`no accepted fact set matched: ${details}`);
  }
  for (const fact of scenario.evaluatorPacket.contradiction_facts) {
    const observed = await observedFactValue(adapter, namespace, fact, cache);
    if (observedValueMatches(observed, fact.observed_value)) {
      throw new Error(`contradiction ${fact.fact_id} matched ${fact.observed_value}`);
    }
  }
  return {
    acceptedFactSet: acceptedFactSet + 1,
    observedFactCount: acceptedResults[acceptedFactSet]!.length,
  };
}

function supportsBoundedConvergence(scenario: LoadedScenario): boolean {
  const resourceRefs = scenario.evaluatorPacket.accepted_fact_sets.flatMap(facts =>
    facts.map(fact => fact.resource_ref)
  );
  return resourceRefs.every(
    resourceRef =>
      !resourceRef.startsWith('metric/') &&
      !resourceRef.startsWith('node/') &&
      !resourceRef.startsWith('lease/')
  );
}

async function validateScenarioEventually(
  adapter: ClusterAdapter,
  namespace: string,
  scenario: LoadedScenario
): Promise<{ acceptedFactSet: number; observedFactCount: number }> {
  const attempts = supportsBoundedConvergence(scenario) ? 60 : 1;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await validateScenario(adapter, namespace, scenario);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  }
  throw lastError;
}

function parseOptions(args: string[]): ValidationOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith('--') || value === undefined) {
      throw new Error('arguments must be --profile, --start, --limit, or --output value pairs');
    }
    values.set(name, value);
  }
  const profile = values.get('--profile') ?? 'local-minikube';
  if (profile !== 'local-minikube' && profile !== 'aks') {
    throw new Error('--profile must be local-minikube or aks');
  }
  const start = Number(values.get('--start') ?? activeScenarioCount + 1);
  const limit = Number(values.get('--limit') ?? 1);
  if (!Number.isInteger(start) || start <= activeScenarioCount) {
    throw new Error(`--start must be an integer greater than ${activeScenarioCount}`);
  }
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
  return { profile, start, limit, output: values.get('--output') };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const orderedIds = orderedDraftScenarioIds();
  const offset = options.start - activeScenarioCount - 1;
  const selectedIds = orderedIds.slice(offset, offset + options.limit);
  if (selectedIds.length === 0) throw new Error(`no draft scenario exists at ${options.start}`);
  const adapter = createClusterAdapter(options.profile as ClusterProfileName, 'real');
  const results: ValidationResult[] = [];
  try {
    const preflight = await adapter.preflight();
    if (!preflight.supported)
      throw new Error(preflight.reason ?? `${options.profile} is unsupported`);
    for (const [selectionIndex, scenarioId] of selectedIds.entries()) {
      const portfolioIndex = options.start + selectionIndex;
      const scenario = loadScenario(scenarioId, draftRoot);
      if (sourceOnlyScenarioIds.has(scenarioId)) {
        results.push({
          portfolio_index: portfolioIndex,
          scenario_id: scenarioId,
          status: 'skipped',
          reason: 'source-manifest predicate is erased by API defaulting or namespace isolation',
        });
        console.log(`[${portfolioIndex}] ${scenarioId}: skipped (source-manifest predicate)`);
        continue;
      }
      if (!scenario.manifest.supported_cluster_profiles.includes(options.profile)) {
        results.push({
          portfolio_index: portfolioIndex,
          scenario_id: scenarioId,
          status: 'skipped',
          reason: `profile ${options.profile} is not supported`,
        });
        console.log(`[${portfolioIndex}] ${scenarioId}: skipped (${options.profile} unsupported)`);
        continue;
      }
      const namespace = `eval-draft-${createHash('sha256')
        .update(scenarioId)
        .digest('hex')
        .slice(0, 16)}`;
      try {
        await adapter.createNamespace(namespace);
        await adapter.applyManifest(
          namespace,
          path.join(scenario.directory, scenario.manifest.setup_manifest_path)
        );
        const validation = await validateScenarioEventually(adapter, namespace, scenario);
        results.push({
          portfolio_index: portfolioIndex,
          scenario_id: scenarioId,
          status: 'passed',
          accepted_fact_set: validation.acceptedFactSet,
          observed_fact_count: validation.observedFactCount,
        });
        console.log(`[${portfolioIndex}] ${scenarioId}: passed`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const unsupportedApi =
          /no matches for kind .* in version|ensure CRDs are installed first|doesn't have a resource type/i.test(
            reason
          );
        results.push({
          portfolio_index: portfolioIndex,
          scenario_id: scenarioId,
          status: unsupportedApi ? 'skipped' : 'failed',
          reason,
        });
        const log = unsupportedApi ? console.log : console.error;
        log(`[${portfolioIndex}] ${scenarioId}: ${unsupportedApi ? 'skipped: ' : ''}${reason}`);
      } finally {
        const manifestPath = path.join(scenario.directory, scenario.manifest.setup_manifest_path);
        try {
          await adapter.deleteManifest?.(namespace, manifestPath);
          await adapter.deleteNamespace(namespace);
        } catch (error) {
          const cleanupReason = `cleanup: ${
            error instanceof Error ? error.message : String(error)
          }`;
          const result = results.find(candidate => candidate.portfolio_index === portfolioIndex);
          if (result) {
            result.status = 'failed';
            result.reason = result.reason ? `${result.reason}; ${cleanupReason}` : cleanupReason;
          } else {
            results.push({
              portfolio_index: portfolioIndex,
              scenario_id: scenarioId,
              status: 'failed',
              reason: cleanupReason,
            });
          }
          console.error(`[${portfolioIndex}] ${scenarioId}: ${cleanupReason}`);
        }
      }
    }
  } finally {
    await adapter.dispose?.();
  }
  const report: ValidationReport = {
    schema_version: '1.0.0',
    profile: options.profile,
    start: options.start,
    limit: selectedIds.length,
    qualification_status_changed: false,
    results,
  };
  if (options.output) {
    const outputPath = path.resolve(options.output);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  }
  const passed = results.filter(result => result.status === 'passed').length;
  const failed = results.filter(result => result.status === 'failed').length;
  const skipped = results.filter(result => result.status === 'skipped').length;
  console.log(
    `draft validation: ${passed} passed, ${failed} failed, ${skipped} skipped; qualification remains pending`
  );
  if (failed > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
