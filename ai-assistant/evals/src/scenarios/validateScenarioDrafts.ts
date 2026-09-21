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
      value = value[token];
    } else {
      value = undefined;
    }
    return value === undefined ? undefined : resolve(value, remaining);
  };
  return resolve(resource, parseFieldPath(fieldPath));
}

export function serializeObservedValue(value: JsonValue | undefined): string {
  if (value === undefined) return '<absent>';
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return String(value);
  return JSON.stringify(value);
}

export function observedValueMatches(observed: string, expected: string): boolean {
  if (observed === expected) return true;
  if (observed === '<absent>' && expected === 'absent') return true;
  try {
    return (
      canonicalStringify(JSON.parse(observed) as JsonValue) ===
      canonicalStringify(JSON.parse(expected) as JsonValue)
    );
  } catch {
    return false;
  }
}

async function snapshotFor(
  adapter: ClusterAdapter,
  namespace: string,
  resourceRef: string,
  cache: Map<string, JsonValue>
): Promise<JsonValue | undefined> {
  const cached = cache.get(resourceRef);
  if (cached) return cached;
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
  const snapshot = await snapshotFor(adapter, namespace, fact.resource_ref, cache);
  if (snapshot === undefined) return '<absent>';
  return serializeObservedValue(resolveFieldPath(snapshot, fact.field_path));
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
        const validation = await validateScenario(adapter, namespace, scenario);
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
        results.push({
          portfolio_index: portfolioIndex,
          scenario_id: scenarioId,
          status: 'failed',
          reason,
        });
        console.error(`[${portfolioIndex}] ${scenarioId}: ${reason}`);
      } finally {
        try {
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
