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

/**
 * Reads a closed canonical bundle back from disk. This is the "clean-room"
 * reader the report generator and `--check` publication verifier use: no
 * model/network access, no re-execution of any trial, only retained
 * immutable JSON/JSONL.
 *
 * Centralizing integrity checks here prevents each report or exporter from
 * inventing a weaker definition of a valid run. Once this reader accepts a
 * bundle, downstream code can aggregate typed evidence rather than reason
 * about partial writes, unsafe paths, stale identities, or broken hash chains.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { sha256OfJson, sha256OfText, type JsonValue } from '../canonicalJson.js';
import { readJsonl } from './jsonl.js';
import type {
  RegressionDelta,
  ScenarioManifest,
  TrialResult,
} from '../contracts/evaluationContracts.js';
import type { TrialIndexRow } from './bundleWriter.js';
import { loadSchema, schemaUri, type SchemaName } from '../contracts/schemas.js';
import { assertValid } from '../contracts/validate.js';
import {
  defaultContractStoreRoot,
  resolveContractReference,
  type ContractReference,
  type ContractReferencesDocument,
} from './contractReferences.js';

/** Validated canonical data loaded from an immutable closed run bundle. */
export interface ClosedBundle {
  /** Directory containing the bundle and its projections. */
  runDir: string;
  /** Directory containing the canonical bundle files. */
  bundleDir: string;
  /** Parsed and validated closing manifest. */
  manifest: Record<string, unknown>;
  /** SHA-256 digest of the closing manifest text. */
  bundleDigest: string;
  /** Validated run-level trial census rows. */
  trialIndex: TrialIndexRow[];
  /** Validated terminal trial results. */
  trials: TrialResult[];
  /** Validated baseline-to-candidate regression deltas. */
  regressionDeltas: RegressionDelta[];
  /** Validated references whose archived content passed digest verification. */
  contractReferences: ContractReference[];
  /** Validated scenario manifests loaded from the verified contract archive. */
  scenarioManifests: ScenarioManifest[];
}

/**
 * Reads a closed bundle without re-running a candidate and verifies its
 * trust boundary: closure marker, safe paths, declared SHA-256 digests,
 * JSONL chains, schemas, artifact digests, and cross-file trial identities.
 * The current unreleased format requires a complete inventory and rejects
 * undeclared files.
 *
 * @param runsRoot - Root directory containing run bundles.
 * @param runId - Stable identifier of the run to read.
 * @param contractStoreRoot - Root used to resolve archived contract URIs.
 * @returns The validated manifest, indexes, trials, and regression deltas.
 * @throws When the bundle is incomplete, corrupt, unsafe, schema-invalid, or internally inconsistent.
 */
export function readClosedBundle(
  runsRoot: string,
  runId: string,
  contractStoreRoot = defaultContractStoreRoot(runsRoot)
): ClosedBundle {
  const runDir = path.join(runsRoot, runId);
  const bundleDir = path.join(runDir, 'bundle');
  const manifestPath = path.join(bundleDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`run ${runId} has no bundle/manifest.json — the bundle was never closed`);
  }
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  if (manifest.closed !== true) {
    throw new Error(`run ${runId} bundle/manifest.json exists but is not marked closed`);
  }

  assertValid(loadSchema('bundle-manifest'), manifest, 'bundle manifest');
  const declaredFiles = manifest.files as Array<{ path: string; digest: string }>;
  const declaredPaths = new Set<string>();
  for (const file of declaredFiles) {
    if (
      typeof file.path !== 'string' ||
      file.path.startsWith('/') ||
      file.path.split('/').includes('..')
    ) {
      throw new Error(`bundle manifest contains unsafe path: ${String(file.path)}`);
    }
    if (declaredPaths.has(file.path)) {
      throw new Error(`bundle manifest declares duplicate path: ${file.path}`);
    }
    declaredPaths.add(file.path);
    const filePath = path.join(bundleDir, file.path);
    if (!existsSync(filePath)) throw new Error(`bundle manifest file is missing: ${file.path}`);
    if (sha256OfText(readFileSync(filePath, 'utf8')) !== file.digest) {
      throw new Error(`bundle manifest digest mismatch: ${file.path}`);
    }
  }
  const actualPaths = listFiles(bundleDir).filter(file => file !== 'manifest.json');
  for (const actualPath of actualPaths) {
    if (!declaredPaths.has(actualPath)) {
      throw new Error(`bundle contains undeclared file: ${actualPath}`);
    }
  }

  const contractReferencesPath = path.join(bundleDir, 'contract-refs.json');
  if (!existsSync(contractReferencesPath)) {
    throw new Error('bundle is missing required contract-refs.json');
  }
  const contractReferences = JSON.parse(
    readFileSync(contractReferencesPath, 'utf8')
  ) as ContractReferencesDocument;
  assertValid(loadSchema('contract-refs'), contractReferences, 'contract references');
  if (contractReferences.run_id !== runId) {
    throw new Error('contract references run identity does not match the bundle');
  }
  const scenarioManifests: ScenarioManifest[] = [];
  for (const reference of contractReferences.contracts) {
    const contractPath = resolveContractReference(contractStoreRoot, reference);
    if (reference.role !== 'manifest') continue;
    const scenarioManifest = yaml.load(readFileSync(contractPath, 'utf8')) as ScenarioManifest;
    assertValid(
      loadSchema('scenario'),
      scenarioManifest,
      `archived scenario ${reference.scenario_id}`
    );
    if (
      scenarioManifest.scenario_id !== reference.scenario_id ||
      scenarioManifest.scenario_version !== reference.scenario_version
    ) {
      throw new Error(`archived scenario identity does not match ${reference.uri}`);
    }
    scenarioManifests.push(scenarioManifest);
  }

  const trialIndex = validateJsonl<TrialIndexRow>(
    path.join(bundleDir, 'trials.jsonl'),
    'trial-index'
  );
  verifyTrialContractReferences(trialIndex, contractReferences.contracts);
  const trials = trialIndex.map(row => {
    const trialDir = path.join(bundleDir, 'trials', row.trial_id);
    const requiredFiles = [
      'scenario-ref.json',
      'environment-manifest.json',
      'trajectory.jsonl',
      'submissions.jsonl',
      'grader-results.jsonl',
      'result.json',
      'artifacts.json',
    ];
    for (const required of requiredFiles) {
      if (!existsSync(path.join(trialDir, required))) {
        throw new Error(`trial ${row.trial_id} is missing required file ${required}`);
      }
    }
    if (existsSync(path.join(trialDir, 'environment-manifest.json'))) {
      assertValid(
        loadSchema('environment-manifest'),
        JSON.parse(readFileSync(path.join(trialDir, 'environment-manifest.json'), 'utf8')),
        `trial ${row.trial_id} environment manifest`
      );
    }
    const trajectory = existsSync(path.join(trialDir, 'trajectory.jsonl'))
      ? validateJsonl<Record<string, JsonValue>>(
          path.join(trialDir, 'trajectory.jsonl'),
          'trajectory-event'
        )
      : [];
    const submissions = existsSync(path.join(trialDir, 'submissions.jsonl'))
      ? validateJsonl<Record<string, JsonValue>>(
          path.join(trialDir, 'submissions.jsonl'),
          'submission-record'
        )
      : [];
    const graderResults = existsSync(path.join(trialDir, 'grader-results.jsonl'))
      ? validateJsonl<Record<string, JsonValue>>(
          path.join(trialDir, 'grader-results.jsonl'),
          'grader-result'
        )
      : [];
    if (existsSync(path.join(trialDir, 'artifacts.json'))) {
      const artifactIndex = JSON.parse(
        readFileSync(path.join(trialDir, 'artifacts.json'), 'utf8')
      ) as {
        artifacts?: Array<{ path?: string; digest?: string }>;
      };
      assertValid(
        loadSchema('artifact-index'),
        artifactIndex,
        `trial ${row.trial_id} artifact index`
      );
      for (const artifact of artifactIndex.artifacts ?? []) {
        if (
          typeof artifact.path !== 'string' ||
          artifact.path.startsWith('/') ||
          artifact.path.split('/').includes('..')
        ) {
          throw new Error(`trial ${row.trial_id} contains an unsafe artifact path`);
        }
        const artifactPath = path.join(trialDir, artifact.path);
        if (
          !existsSync(artifactPath) ||
          sha256OfText(readFileSync(artifactPath, 'utf8')) !== artifact.digest
        ) {
          throw new Error(`trial ${row.trial_id} artifact digest mismatch: ${artifact.path}`);
        }
      }
    }
    const result = JSON.parse(
      readFileSync(path.join(trialDir, 'result.json'), 'utf8')
    ) as TrialResult;
    assertValid(loadSchema('trial-result'), result, `trial ${row.trial_id} result`);
    if (result.trial_id !== row.trial_id || result.run_id !== row.run_id) {
      throw new Error(`trial ${row.trial_id} result identity does not match its index row`);
    }
    verifyTrialReferences(result, trajectory, submissions, graderResults);
    return result;
  });
  const regressionDeltas = validateJsonl<RegressionDelta & Record<string, JsonValue>>(
    path.join(bundleDir, 'regression-deltas.jsonl'),
    'regression-delta'
  ) as unknown as RegressionDelta[];

  return {
    runDir,
    bundleDir,
    manifest,
    bundleDigest: sha256OfText(manifestText),
    trialIndex,
    trials,
    regressionDeltas,
    contractReferences: contractReferences.contracts,
    scenarioManifests,
  };
}

/** Ensures every assigned trial can resolve all Phase 1 scenario inputs. */
function verifyTrialContractReferences(
  trialIndex: TrialIndexRow[],
  references: ContractReference[]
): void {
  const requiredRoles = [
    'manifest',
    'candidate_packet',
    'evaluator_packet',
    'fixture',
    'grader',
    'verifier',
    'policy',
    'schema',
  ] as const;
  for (const trial of trialIndex) {
    const matching = references.filter(
      reference =>
        reference.scenario_id === trial.scenario_id &&
        reference.scenario_version === trial.scenario_version
    );
    for (const role of requiredRoles) {
      if (!matching.some(reference => reference.role === role)) {
        throw new Error(
          `trial ${trial.trial_id} has no ${role} contract for ` +
            `${trial.scenario_id}@${trial.scenario_version}`
        );
      }
    }
  }
}

/**
 * Validates a JSONL stream's schema identity, sequence, payloads, and hash chain.
 *
 * @param filePath - JSONL stream file to validate.
 * @param schemaName - Current schema expected for every payload.
 * @returns Validated payloads in stream order.
 */
function validateJsonl<T extends JsonValue>(filePath: string, schemaName: SchemaName): T[] {
  const records = readJsonl<T>(filePath);
  const schemaVersion = loadSchema(schemaName).schema_version;
  if (typeof schemaVersion !== 'string') {
    throw new Error(`${filePath}: schema has no contract version`);
  }
  let previousDigest: string | null = null;
  records.forEach((record, index) => {
    if (record.sequence !== index + 1) throw new Error(`${filePath}: invalid record sequence`);
    if (record.schema_uri !== schemaUri(schemaName)) {
      throw new Error(`${filePath}: unexpected schema URI`);
    }
    if (record.schema_version !== schemaVersion) {
      throw new Error(`${filePath}: unexpected schema version`);
    }

    if (record.payload_digest !== sha256OfJson(record.payload)) {
      throw new Error(`${filePath}: payload digest mismatch at sequence ${record.sequence}`);
    }
    if (record.previous_record_digest !== previousDigest) {
      throw new Error(`${filePath}: broken hash chain at sequence ${record.sequence}`);
    }
    assertValid(loadSchema(schemaName), record.payload, `${filePath} payload ${record.sequence}`);
    previousDigest = record.payload_digest;
  });
  return records.map(record => record.payload);
}

/**
 * Verifies trial identity and references across retained per-trial streams.
 *
 * @param result - Terminal trial result containing evidence and grader references.
 * @param trajectory - Trajectory records providing evidence identifiers.
 * @param submissions - Submission records that must share the trial identity.
 * @param graderResults - Grader records providing grader-result identifiers.
 */
function verifyTrialReferences(
  result: TrialResult,
  trajectory: Array<Record<string, JsonValue>>,
  submissions: Array<Record<string, JsonValue>>,
  graderResults: Array<Record<string, JsonValue>>
): void {
  const evidenceIds = new Set(
    trajectory.flatMap(event =>
      Array.isArray(event.evidence_ids)
        ? event.evidence_ids.filter((id): id is string => typeof id === 'string')
        : []
    )
  );
  const graderIds = new Set(
    graderResults
      .map(record => record.grader_result_id)
      .filter((id): id is string => typeof id === 'string')
  );
  for (const dimension of Object.values(result.dimensions)) {
    for (const evidenceId of dimension.evidence_ids ?? []) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`trial ${result.trial_id} references missing evidence ${evidenceId}`);
      }
    }
    for (const graderId of dimension.grader_result_ids) {
      if (!graderIds.has(graderId)) {
        throw new Error(`trial ${result.trial_id} references missing grader result ${graderId}`);
      }
    }
  }
  for (const record of [...trajectory, ...submissions]) {
    if (record.trial_id !== result.trial_id) {
      throw new Error(`trial ${result.trial_id} contains a record for another trial`);
    }
  }
}

/**
 * Recursively lists bundle files using portable POSIX-relative paths.
 *
 * @param root - Directory whose files are enumerated.
 * @param relative - Relative subdirectory visited by recursion.
 * @returns Relative paths for every file beneath the root.
 */
function listFiles(root: string, relative = ''): string[] {
  return readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    return entry.isDirectory()
      ? listFiles(root, child)
      : [child.split(path.sep).join(path.posix.sep)];
  });
}
