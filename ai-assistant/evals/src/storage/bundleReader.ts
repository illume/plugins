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
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { sha256OfJson, sha256OfText, type JsonValue } from '../canonicalJson.js';
import { readJsonl } from './jsonl.js';
import type { RegressionDelta, TrialResult } from '../contracts/types.js';
import type { TrialIndexRow } from './bundleWriter.js';
import { loadSchema, schemaUri, type SchemaName } from '../contracts/schemas.js';
import { assertValid } from '../contracts/validate.js';

export interface ClosedBundle {
  runDir: string;
  bundleDir: string;
  manifest: Record<string, unknown>;
  bundleDigest: string;
  trialIndex: TrialIndexRow[];
  trials: TrialResult[];
  regressionDeltas: RegressionDelta[];
}

/** Reads and validates a closed bundle; throws if `manifest.json` is absent or not closed. */
export function readClosedBundle(runsRoot: string, runId: string): ClosedBundle {
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

  const completeInventory = manifest.bundle_format_version !== '1.0.0';
  if (completeInventory) {
    assertValid(loadSchema('bundle-manifest'), manifest, 'bundle manifest');
  } else if (!Array.isArray(manifest.files)) {
    throw new Error('legacy bundle manifest has no files array');
  }
  const declaredFiles = manifest.files as Array<{ path: string; digest: string | null }>;
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
    if (file.digest === null && !existsSync(filePath) && !completeInventory) continue;
    if (!existsSync(filePath)) throw new Error(`bundle manifest file is missing: ${file.path}`);
    if (sha256OfText(readFileSync(filePath, 'utf8')) !== file.digest) {
      throw new Error(`bundle manifest digest mismatch: ${file.path}`);
    }
  }
  if (completeInventory) {
    const actualPaths = listFiles(bundleDir).filter(file => file !== 'manifest.json');
    for (const actualPath of actualPaths) {
      if (!declaredPaths.has(actualPath)) {
        throw new Error(`bundle contains undeclared file: ${actualPath}`);
      }
    }
  }

  const trialIndex = validateJsonl<TrialIndexRow>(
    path.join(bundleDir, 'trials.jsonl'),
    'trial-index'
  );
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
    for (const required of completeInventory ? requiredFiles : ['result.json']) {
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
          'submission-record',
          completeInventory ? undefined : ['diagnosis-submission']
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
  };
}

function validateJsonl<T extends JsonValue>(
  filePath: string,
  schemaName: SchemaName,
  legacySchemaNames: SchemaName[] = []
): T[] {
  const records = readJsonl<T>(filePath);
  let previousDigest: string | null = null;
  records.forEach((record, index) => {
    if (record.sequence !== index + 1) throw new Error(`${filePath}: invalid record sequence`);
    if (
      record.schema_uri !== schemaUri(schemaName) &&
      !legacySchemaNames.some(name => record.schema_uri === schemaUri(name))
    ) {
      throw new Error(`${filePath}: unexpected schema URI`);
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

function listFiles(root: string, relative = ''): string[] {
  return readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    return entry.isDirectory()
      ? listFiles(root, child)
      : [child.split(path.sep).join(path.posix.sep)];
  });
}
