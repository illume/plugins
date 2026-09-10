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

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalStringify, sha256OfText, type JsonValue } from '../canonicalJson.js';
import { SCHEMA_VERSION } from '../contracts/evaluationContracts.js';
import { loadSchema } from '../contracts/schemas.js';
import { assertValid } from '../contracts/validate.js';
import type { LoadedScenario } from '../scenarios/loader.js';
import { fileURLToPath } from 'node:url';

/** One immutable source used to execute or grade a scenario. */
export interface ContractReference extends Record<string, JsonValue> {
  scenario_id: string;
  scenario_version: string;
  role:
    | 'manifest'
    | 'candidate_packet'
    | 'evaluator_packet'
    | 'fixture'
    | 'grader'
    | 'verifier'
    | 'policy'
    | 'schema';
  uri: string;
  digest: string;
  visibility_class: 'candidate_visible' | 'eval_confidential';
  access_domain: string;
}

/** Run-level index of archived scenario contracts. */
export interface ContractReferencesDocument extends Record<string, JsonValue> {
  schema_version: string;
  run_id: string;
  contracts: ContractReference[];
}

const contractFiles = [
  ['manifest', 'scenario.yaml', 'candidate_visible'],
  ['candidate_packet', 'candidate-packet.json', 'candidate_visible'],
  ['evaluator_packet', 'evaluator-packet.json', 'eval_confidential'],
] as const;

const here = path.dirname(fileURLToPath(import.meta.url));
const evalsRoot = path.resolve(here, '..', '..');
const schemaRoot = path.join(evalsRoot, 'schema');
const implementationContracts = [
  ['grader', path.join(evalsRoot, 'src', 'grading', 'diagnosisGrader.ts')],
  ['verifier', path.join(evalsRoot, 'src', 'scenarios', 'caseLogic.ts')],
  ['verifier', path.join(evalsRoot, 'src', 'scenarios', 'cases', 'caseSupport.ts')],
  ['verifier', path.join(evalsRoot, 'src', 'scenarios', 'cases', 'schedulingCases.ts')],
  ['verifier', path.join(evalsRoot, 'src', 'scenarios', 'cases', 'serviceSelectorCases.ts')],
  ['policy', path.join(evalsRoot, 'src', 'grading', 'safetyGrader.ts')],
  ...readdirSync(schemaRoot)
    .filter(fileName => fileName.endsWith('.schema.json'))
    .sort()
    .map(fileName => ['schema', path.join(schemaRoot, fileName)] as const),
] as const;

/** Resolves the configured contract archive independently from run bundles. */
export function defaultContractStoreRoot(runsRoot: string): string {
  return (
    process.env.HEADLAMP_AI_EVAL_CONTRACTS_DIR ?? path.resolve(runsRoot, '..', '.eval-contracts')
  );
}

/**
 * Archives the exact scenario inputs used by a run and returns their logical,
 * content-addressed references. Existing versions are immutable: attempting
 * to reuse an identity with different bytes fails before candidate execution.
 *
 * @param contractStoreRoot - Approved root for immutable archived contracts.
 * @param runId - Run that will reference the archived contracts.
 * @param scenarios - Validated scenarios selected for the run.
 * @returns A validated contract-reference document suitable for the bundle.
 */
export function archiveContractReferences(
  contractStoreRoot: string,
  runId: string,
  scenarios: LoadedScenario[]
): ContractReferencesDocument {
  const contracts: ContractReference[] = [];
  for (const scenario of scenarios) {
    const identity = [scenario.manifest.scenario_id, scenario.manifest.scenario_version] as const;
    for (const [role, fileName, visibilityClass] of contractFiles) {
      contracts.push(
        archiveContract(
          contractStoreRoot,
          scenario.directory,
          identity,
          role,
          fileName,
          visibilityClass
        )
      );
    }
    contracts.push(
      archiveContract(
        contractStoreRoot,
        scenario.directory,
        identity,
        'fixture',
        scenario.manifest.setup_manifest_path,
        'eval_confidential'
      )
    );
    for (const [role, sourcePath] of implementationContracts) {
      contracts.push(
        archiveSource(
          contractStoreRoot,
          identity,
          role,
          sourcePath,
          'eval_confidential',
          path.basename(sourcePath),
          true
        )
      );
    }
  }
  const document: ContractReferencesDocument = {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    contracts,
  };
  assertValid(loadSchema('contract-refs'), document, 'contract references');
  return document;
}

/** Resolves and verifies one logical contract URI from the local archive. */
export function resolveContractReference(
  contractStoreRoot: string,
  reference: ContractReference
): string {
  const prefix = 'contracts://';
  if (!reference.uri.startsWith(prefix)) {
    throw new Error(`unsupported contract URI: ${reference.uri}`);
  }
  const relativePath = reference.uri.slice(prefix.length);
  const relativeParts = relativePath.split('/');
  if (relativeParts.some(part => part === '..' || part === '')) {
    throw new Error(`unsafe contract URI: ${reference.uri}`);
  }
  if (relativeParts[0] !== reference.access_domain) {
    throw new Error(`contract URI does not match access domain: ${reference.uri}`);
  }
  const expectedAccessDomain =
    reference.visibility_class === 'candidate_visible'
      ? 'candidate-contract-store'
      : 'protected-contract-store';
  if (reference.access_domain !== expectedAccessDomain) {
    throw new Error(`contract visibility does not match access domain: ${reference.uri}`);
  }
  const filePath = path.join(contractStoreRoot, ...relativeParts);
  if (!existsSync(filePath)) throw new Error(`contract is not resolvable: ${reference.uri}`);
  const content = readFileSync(filePath, 'utf8');
  if (sha256OfText(content) !== reference.digest) {
    throw new Error(`contract digest mismatch: ${reference.uri}`);
  }
  return filePath;
}

function archiveContract(
  contractStoreRoot: string,
  scenarioDirectory: string,
  [scenarioId, scenarioVersion]: readonly [string, string],
  role: ContractReference['role'],
  sourceName: string,
  visibilityClass: ContractReference['visibility_class']
): ContractReference {
  if (path.basename(sourceName) !== sourceName) {
    throw new Error(`contract source must be a file basename: ${sourceName}`);
  }
  const sourcePath = path.join(scenarioDirectory, sourceName);
  return archiveSource(
    contractStoreRoot,
    [scenarioId, scenarioVersion],
    role,
    sourcePath,
    visibilityClass,
    role === 'fixture' ? `fixture-${sourceName}` : sourceName
  );
}

function archiveSource(
  contractStoreRoot: string,
  [scenarioId, scenarioVersion]: readonly [string, string],
  role: ContractReference['role'],
  sourcePath: string,
  visibilityClass: ContractReference['visibility_class'],
  archiveName = path.basename(sourcePath),
  contentAddressed = false
): ContractReference {
  const content = readFileSync(sourcePath, 'utf8');
  const digest = sha256OfText(content);
  const accessDomain =
    visibilityClass === 'candidate_visible'
      ? 'candidate-contract-store'
      : 'protected-contract-store';
  const relativeParts = contentAddressed
    ? [accessDomain, 'implementations', role, digest, archiveName]
    : [accessDomain, scenarioId, scenarioVersion, archiveName];
  const archivePath = path.join(contractStoreRoot, ...relativeParts);
  mkdirSync(path.dirname(archivePath), { recursive: true });
  if (existsSync(archivePath)) {
    if (readFileSync(archivePath, 'utf8') !== content) {
      throw new Error(
        `immutable contract identity has conflicting content: ${scenarioId}@${scenarioVersion}`
      );
    }
  } else {
    writeFileSync(archivePath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  }
  return {
    scenario_id: scenarioId,
    scenario_version: scenarioVersion,
    role,
    uri: `contracts://${relativeParts.join('/')}`,
    digest,
    visibility_class: visibilityClass,
    access_domain: accessDomain,
  };
}

/** Serializes a contract-reference document with canonical key ordering. */
export function serializeContractReferences(document: ContractReferencesDocument): string {
  return canonicalStringify(document);
}
