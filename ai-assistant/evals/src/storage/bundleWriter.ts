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
 * The bundle is the durable evidence layer, not merely report input. It keeps
 * candidate output, tool trajectory, grader decisions, environment identity,
 * and terminal results together so a report can be audited or regenerated
 * without contacting a model or cluster. Reports and destination-specific
 * exports are intentionally stored outside `bundle/` because they are
 * replaceable views of this evidence.
 *
 * Layout (see "Result bundle and report evolution contract"):
 *
 * ```text
 * runs/<run_id>/bundle/
 *   manifest.json
 *   contract-refs.json
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
 * Hashes make accidental or post-run changes detectable; they provide
 * integrity evidence, not signer identity or cryptographic attestation.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { canonicalStringify, sha256OfText, type JsonValue } from '../canonicalJson.js';
import { digestOfFile, JsonlWriter } from './jsonl.js';
import { schemaUri } from '../contracts/schemas.js';
import {
  REGRESSION_DELTA_SCHEMA_VERSION,
  SCHEMA_VERSION,
} from '../contracts/evaluationContracts.js';
import type {
  RegressionDelta,
  TrajectoryToolEvent,
  TrialResult,
} from '../contracts/evaluationContracts.js';
import { artifactId as generateArtifactId } from '../ids.js';
import type { ContractReferencesDocument } from './contractReferences.js';
import { serializeContractReferences } from './contractReferences.js';
import type { CandidateIdentity } from '../candidates/candidateAdapter.js';

const PRODUCER = '@headlamp-k8s/ai-evals';
const BUNDLE_FORMAT_VERSION = '1.0.0';

/** Run-level census row indexing one terminal trial result. */
export interface TrialIndexRow extends Record<string, JsonValue> {
  /** Stable identifier of the indexed trial. */
  trial_id: string;
  /** Stable identifier of the owning run. */
  run_id: string;
  /** Stable identifier of the evaluated scenario. */
  scenario_id: string;
  /** Version of the evaluated scenario. */
  scenario_version: string;
  /** Identifier of the candidate configuration. */
  candidate_id: string;
  /** Cluster profile used by the trial. */
  cluster_profile: string;
  /** Whether the trial qualifies for candidate-quality aggregation. */
  run_eligibility: string;
  /** Component responsible for the first failure, when any. */
  first_failure_owner: string | null;
  /** Prior trial replaced by this trial, when rerun. */
  supersedes_trial_id: string | null;
}

/** Writer for the immutable files and streams belonging to one trial. */
export class TrialBundleWriter {
  readonly trialDir: string;
  readonly trajectory: JsonlWriter<TrajectoryToolEvent & Record<string, JsonValue>>;
  readonly submissions: JsonlWriter<Record<string, JsonValue>>;
  readonly graderResults: JsonlWriter<Record<string, JsonValue>>;

  /**
   * Creates the directory and append-only streams for one trial.
   *
   * @param bundleDir - Canonical bundle directory that owns the trial.
   * @param trialId - Stable identifier assigned to the trial.
   */
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

  /**
   * Writes the scenario identity and candidate-view digest.
   *
   * @param ref - Scenario reference data to persist.
   */
  writeScenarioRef(ref: Record<string, JsonValue>): void {
    writeFileSync(path.join(this.trialDir, 'scenario-ref.json'), canonicalStringify(ref), 'utf8');
  }

  /**
   * Writes the trial environment manifest.
   *
   * @param manifest - Environment identity and execution metadata.
   */
  writeEnvironmentManifest(manifest: Record<string, JsonValue>): void {
    writeFileSync(
      path.join(this.trialDir, 'environment-manifest.json'),
      canonicalStringify(manifest),
      'utf8'
    );
  }

  /**
   * Writes the terminal canonical trial result.
   *
   * @param result - Complete terminal trial result.
   */
  writeResult(result: TrialResult): void {
    writeFileSync(
      path.join(this.trialDir, 'result.json'),
      canonicalStringify(result as unknown as JsonValue),
      'utf8'
    );
  }

  /**
   * Writes the retained-artifact index for the trial.
   *
   * @param artifacts - Artifact index document to persist.
   */
  writeArtifactIndex(artifacts: Record<string, JsonValue>): void {
    writeFileSync(
      path.join(this.trialDir, 'artifacts.json'),
      canonicalStringify(artifacts),
      'utf8'
    );
  }

  /**
   * Writes one safely named UTF-8 artifact and builds its index entry.
   *
   * @param fileName - Basename allowed beneath the trial artifact directory.
   * @param content - UTF-8 artifact content.
   * @param mediaType - Media type recorded in the artifact index entry.
   * @returns The artifact identity, path, digest, media type, and size.
   */
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

/** Writer that owns one run's trial streams and atomic closing manifest. */
export class RunBundleWriter {
  readonly runDir: string;
  readonly bundleDir: string;
  private readonly trialsIndex: JsonlWriter<TrialIndexRow>;
  private readonly regressionDeltas: JsonlWriter<RegressionDelta & Record<string, JsonValue>>;
  private readonly candidateIdentities = new Map<string, CandidateIdentity>();
  private closed = false;

  /**
   * Creates a new run directory and its run-level JSONL streams.
   *
   * @param runsRoot - Root directory where run bundles are stored.
   * @param runId - Stable identifier assigned to the new run.
   */
  constructor(runsRoot: string, readonly runId: string) {
    this.runDir = path.join(runsRoot, runId);
    this.bundleDir = path.join(this.runDir, 'bundle');
    if (existsSync(this.runDir)) {
      throw new Error(`run directory already exists: ${this.runDir}`);
    }
    mkdirSync(this.bundleDir, { recursive: true, mode: 0o700 });
    this.trialsIndex = new JsonlWriter(
      path.join(this.bundleDir, 'trials.jsonl'),
      schemaUri('trial-index'),
      SCHEMA_VERSION,
      PRODUCER
    );
    this.regressionDeltas = new JsonlWriter(
      path.join(this.bundleDir, 'regression-deltas.jsonl'),
      schemaUri('regression-delta'),
      REGRESSION_DELTA_SCHEMA_VERSION,
      PRODUCER
    );
  }

  /**
   * Creates a writer for one trial in this run bundle.
   *
   * @param trialId - Stable identifier assigned to the trial.
   * @returns A writer for the trial's files and streams.
   */
  newTrial(trialId: string): TrialBundleWriter {
    return new TrialBundleWriter(this.bundleDir, trialId);
  }

  /**
   * Appends a terminal trial census row to the run index.
   *
   * @param row - Trial index row to append.
   */
  recordTrialIndex(row: TrialIndexRow): void {
    this.trialsIndex.append(row);
  }

  /**
   * Appends a baseline-to-candidate regression delta.
   *
   * @param delta - Regression delta to append.
   */
  recordRegressionDelta(delta: RegressionDelta): void {
    this.regressionDeltas.append(delta as unknown as RegressionDelta & Record<string, JsonValue>);
  }

  /** Registers one resolved candidate configuration for the closing manifest. */
  registerCandidateIdentity(identity: CandidateIdentity): void {
    this.candidateIdentities.set(identity.configuration_digest, identity);
  }

  /** Writes the immutable index of content-addressed scenario contracts. */
  writeContractReferences(document: ContractReferencesDocument): void {
    if (document.run_id !== this.runId) {
      throw new Error(
        `contract references belong to run ${document.run_id}, expected ${this.runId}`
      );
    }
    const filePath = path.join(this.bundleDir, 'contract-refs.json');
    writeFileSync(filePath, serializeContractReferences(document), {
      encoding: 'utf8',
      flag: 'wx',
    });
  }

  /**
   * Writes `bundle/manifest.json`, the only file allowed to declare the
   * bundle closed. Must be called exactly once, after every trial has been
   * fully written.
   *
   * @param candidateId - Candidate label represented by the completed run.
   * @param clusterProfile - Cluster profile used by the run.
   */
  close(candidateId: string, clusterProfile: string): void {
    if (this.closed) throw new Error(`bundle for run ${this.runId} is already closed`);
    if (!existsSync(path.join(this.bundleDir, 'contract-refs.json'))) {
      throw new Error(`bundle for run ${this.runId} has no contract-refs.json`);
    }
    const files = listFiles(this.bundleDir)
      .filter(relativePath => relativePath !== 'manifest.json')
      .sort()
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
      candidate_configurations: [...this.candidateIdentities.values()].sort((left, right) =>
        left.configuration_digest.localeCompare(right.configuration_digest)
      ),
      cluster_profile: clusterProfile,
      files,
      supported_files: [
        'contract-refs.json',
        'trials.jsonl',
        'regression-deltas.jsonl',
        'trials/<trial_id>/*',
      ],
      unsupported_files: [
        'comparisons.jsonl',
        'relation-results.jsonl',
        'integrity-checkpoints.jsonl',
      ],
      closed: true,
    };
    writeAtomicManifest(
      path.join(this.bundleDir, 'manifest.json'),
      canonicalStringify(manifest as unknown as JsonValue)
    );
    this.closed = true;
  }
}

/**
 * Durably writes a closing manifest through a same-directory atomic rename.
 *
 * @param manifestPath - Final path of the closing manifest.
 * @param content - Canonical manifest JSON to write.
 */
function writeAtomicManifest(manifestPath: string, content: string): void {
  const temporaryPath = `${manifestPath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, content, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, manifestPath);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
    throw error;
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
  const directory = path.join(root, relative);
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const child = relative ? path.join(relative, entry.name) : entry.name;
    return entry.isDirectory()
      ? listFiles(root, child)
      : [child.split(path.sep).join(path.posix.sep)];
  });
}

/**
 * Determines whether a run bundle has a manifest marked closed.
 *
 * @param runsRoot - Root directory containing run bundles.
 * @param runId - Stable identifier of the run to inspect.
 * @returns `true` when the run has a closing manifest marked closed.
 */
export function isBundleClosed(runsRoot: string, runId: string): boolean {
  const manifestPath = path.join(runsRoot, runId, 'bundle', 'manifest.json');
  if (!existsSync(manifestPath)) return false;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { closed?: boolean };
  return manifest.closed === true;
}
