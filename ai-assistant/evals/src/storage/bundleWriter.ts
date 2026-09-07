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
 * The canonical, immutable per-run bundle writer.
 *
 * Layout (see "Result bundle and report evolution contract"):
 *
 * ```text
 * runs/<run_id>/bundle/
 *   manifest.json
 *   trials.jsonl
 *   regression-deltas.jsonl
 *   trials/<trial_id>/
 *     scenario-ref.json
 *     environment-manifest.json
 *     trajectory.jsonl
 *     submissions.jsonl
 *     grader-results.jsonl
 *     result.json
 *     artifacts.json
 * ```
 *
 * `manifest.json` is written last, after every stream closes, and is the
 * only file allowed to declare the bundle "closed". A crash partway through
 * a run leaves `manifest.json` absent, which `bundleReader.ts` treats as an
 * incomplete (not merely empty) bundle.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalStringify, sha256OfText, type JsonValue } from '../canonicalJson.js';
import { digestOfFile, JsonlWriter, readJsonlPayloads } from './jsonl.js';
import { schemaUri } from '../contracts/schemas.js';
import { SCHEMA_VERSION } from '../contracts/types.js';
import type { RegressionDelta, TrajectoryToolEvent, TrialResult } from '../contracts/types.js';
import { artifactId as generateArtifactId } from '../ids.js';

const PRODUCER = '@headlamp-k8s/ai-evals';
const BUNDLE_FORMAT_VERSION = '1.1.0';

export interface TrialIndexRow extends Record<string, JsonValue> {
  trial_id: string;
  run_id: string;
  scenario_id: string;
  scenario_version: string;
  candidate_id: string;
  cluster_profile: string;
  run_eligibility: string;
  first_failure_owner: string | null;
  supersedes_trial_id: string | null;
}

export class TrialBundleWriter {
  readonly trialDir: string;
  readonly trajectory: JsonlWriter<TrajectoryToolEvent & Record<string, JsonValue>>;
  readonly submissions: JsonlWriter<Record<string, JsonValue>>;
  readonly graderResults: JsonlWriter<Record<string, JsonValue>>;

  constructor(bundleDir: string, readonly trialId: string) {
    this.trialDir = path.join(bundleDir, 'trials', trialId);
    mkdirSync(this.trialDir, { recursive: true });
    this.trajectory = new JsonlWriter(
      path.join(this.trialDir, 'trajectory.jsonl'),
      schemaUri('trajectory-event'),
      SCHEMA_VERSION,
      PRODUCER
    );
    this.submissions = new JsonlWriter(
      path.join(this.trialDir, 'submissions.jsonl'),
      schemaUri('submission-record'),
      SCHEMA_VERSION,
      PRODUCER
    );
    this.graderResults = new JsonlWriter(
      path.join(this.trialDir, 'grader-results.jsonl'),
      schemaUri('grader-result'),
      SCHEMA_VERSION,
      PRODUCER
    );
  }

  writeScenarioRef(ref: Record<string, JsonValue>): void {
    writeFileSync(path.join(this.trialDir, 'scenario-ref.json'), canonicalStringify(ref), 'utf8');
  }

  writeEnvironmentManifest(manifest: Record<string, JsonValue>): void {
    writeFileSync(
      path.join(this.trialDir, 'environment-manifest.json'),
      canonicalStringify(manifest),
      'utf8'
    );
  }

  writeResult(result: TrialResult): void {
    writeFileSync(
      path.join(this.trialDir, 'result.json'),
      canonicalStringify(result as unknown as JsonValue),
      'utf8'
    );
  }

  writeArtifactIndex(artifacts: Record<string, JsonValue>): void {
    writeFileSync(
      path.join(this.trialDir, 'artifacts.json'),
      canonicalStringify(artifacts),
      'utf8'
    );
  }

  writeArtifact(
    fileName: string,
    content: string,
    mediaType = 'text/plain'
  ): Record<string, JsonValue> {
    if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
      throw new Error(`unsafe artifact filename: ${fileName}`);
    }
    const relativePath = path.posix.join('artifacts', fileName);
    const artifactPath = path.join(this.trialDir, relativePath);
    mkdirSync(path.dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, content, 'utf8');
    return {
      artifact_id: generateArtifactId(),
      path: relativePath,
      digest: sha256OfText(content),
      media_type: mediaType,
      size_bytes: Buffer.byteLength(content),
    };
  }
}

export class RunBundleWriter {
  readonly runDir: string;
  readonly bundleDir: string;
  private readonly trialsIndex: JsonlWriter<TrialIndexRow>;
  private readonly regressionDeltas: JsonlWriter<RegressionDelta & Record<string, JsonValue>>;
  private closed = false;

  constructor(runsRoot: string, readonly runId: string) {
    this.runDir = path.join(runsRoot, runId);
    this.bundleDir = path.join(this.runDir, 'bundle');
    mkdirSync(this.bundleDir, { recursive: true });
    this.trialsIndex = new JsonlWriter(
      path.join(this.bundleDir, 'trials.jsonl'),
      schemaUri('trial-index'),
      SCHEMA_VERSION,
      PRODUCER
    );
    this.regressionDeltas = new JsonlWriter(
      path.join(this.bundleDir, 'regression-deltas.jsonl'),
      schemaUri('regression-delta'),
      SCHEMA_VERSION,
      PRODUCER
    );
  }

  newTrial(trialId: string): TrialBundleWriter {
    return new TrialBundleWriter(this.bundleDir, trialId);
  }

  recordTrialIndex(row: TrialIndexRow): void {
    this.trialsIndex.append(row);
  }

  recordRegressionDelta(delta: RegressionDelta): void {
    this.regressionDeltas.append(delta as unknown as RegressionDelta & Record<string, JsonValue>);
  }

  /** Reads back every trial index row appended so far (used by the reporter). */
  readTrialsIndex(): TrialIndexRow[] {
    return readJsonlPayloads<TrialIndexRow>(path.join(this.bundleDir, 'trials.jsonl'));
  }

  readRegressionDeltas(): RegressionDelta[] {
    return readJsonlPayloads<RegressionDelta & Record<string, JsonValue>>(
      path.join(this.bundleDir, 'regression-deltas.jsonl')
    ) as unknown as RegressionDelta[];
  }

  /**
   * Writes `bundle/manifest.json`, the only file allowed to declare the
   * bundle closed. Must be called exactly once, after every trial has been
   * fully written.
   */
  close(candidateId: string, clusterProfile: string): void {
    if (this.closed) throw new Error(`bundle for run ${this.runId} is already closed`);
    const files = listFiles(this.bundleDir)
      .filter(relativePath => relativePath !== 'manifest.json')
      .map(relativePath => ({
        path: relativePath,
        digest: digestOfFile(path.join(this.bundleDir, relativePath)),
      }));
    const manifest = {
      schema_version: SCHEMA_VERSION,
      bundle_format_version: BUNDLE_FORMAT_VERSION,
      run_id: this.runId,
      generated_at: new Date().toISOString(),
      producer: PRODUCER,
      capabilities: ['phase-1-diagnose-only'],
      candidate_id: candidateId,
      cluster_profile: clusterProfile,
      files,
      supported_files: ['trials.jsonl', 'regression-deltas.jsonl', 'trials/<trial_id>/*'],
      unsupported_files: [
        'comparisons.jsonl',
        'relation-results.jsonl',
        'integrity-checkpoints.jsonl',
      ],
      closed: true,
    };
    writeFileSync(
      path.join(this.bundleDir, 'manifest.json'),
      canonicalStringify(manifest as unknown as JsonValue),
      'utf8'
    );
    this.closed = true;
  }
}

function listFiles(root: string, relative = ''): string[] {
  const directory = path.join(root, relative);
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    return entry.isDirectory()
      ? listFiles(root, child)
      : [child.split(path.sep).join(path.posix.sep)];
  });
}

/** Returns whether a run's bundle exists and was closed (manifest present + `closed: true`). */
export function isBundleClosed(runsRoot: string, runId: string): boolean {
  const manifestPath = path.join(runsRoot, runId, 'bundle', 'manifest.json');
  if (!existsSync(manifestPath)) return false;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { closed?: boolean };
  return manifest.closed === true;
}
