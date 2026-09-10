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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isBundleClosed, RunBundleWriter } from './bundleWriter.js';
import { readClosedBundle } from './bundleReader.js';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratchDir.js';
import { makeTrialResult as fakeTrialResult } from '../test-helpers/trialResult.js';
import { SCHEMA_VERSION } from '../contracts/evaluationContracts.js';
import type { ContractReferencesDocument } from './contractReferences.js';
import { archiveContractReferences } from './contractReferences.js';
import { loadScenario } from '../scenarios/loader.js';
import { sha256OfText } from '../canonicalJson.js';
import { loadSchema } from '../contracts/schemas.js';
import { assertValid } from '../contracts/validate.js';

function writeEmptyContractReferences(writer: RunBundleWriter): void {
  const document: ContractReferencesDocument = {
    schema_version: SCHEMA_VERSION,
    run_id: writer.runId,
    contracts: [],
  };
  writer.writeContractReferences(document);
}

test('isBundleClosed: false before manifest.json exists, true after close()', () => {
  const dir = makeScratchDir('bundle-closed');
  try {
    assert.equal(isBundleClosed(dir, 'run_1'), false);
    const writer = new RunBundleWriter(dir, 'run_1');
    writeEmptyContractReferences(writer);
    assert.equal(isBundleClosed(dir, 'run_1'), false);
    writer.close('scripted-reference', 'local-kwok');
    assert.equal(isBundleClosed(dir, 'run_1'), true);
  } finally {
    removeScratchDir(dir);
  }
});

test('RunBundleWriter creates private run and bundle directories', () => {
  const dir = makeScratchDir('bundle-private');
  try {
    const writer = new RunBundleWriter(dir, 'run_private');
    assert.equal(statSync(writer.runDir).mode & 0o777, 0o700);
    assert.equal(statSync(writer.bundleDir).mode & 0o777, 0o700);
  } finally {
    removeScratchDir(dir);
  }
});

test('trial result schema rejects omitted execution and lineage fields', () => {
  for (const field of ['execution_mode', 'supersedes_trial_id'] as const) {
    const result = fakeTrialResult();
    delete result[field];
    assert.throws(
      () => assertValid(loadSchema('trial-result'), result, 'trial result'),
      new RegExp(`must have required property '${field}'`)
    );
  }
});

test('trial result schema rejects incomplete stage and dimension records', () => {
  const missingStage = fakeTrialResult();
  missingStage.stage_status = {} as never;
  assert.throws(() => assertValid(loadSchema('trial-result'), missingStage, 'trial result'));

  const missingDimension = fakeTrialResult();
  missingDimension.dimensions.root_cause = {} as never;
  assert.throws(() => assertValid(loadSchema('trial-result'), missingDimension, 'trial result'));
});

test('a trial written through TrialBundleWriter round-trips through readClosedBundle', () => {
  const dir = makeScratchDir('bundle-roundtrip');
  try {
    const writer = new RunBundleWriter(dir, 'run_2');
    const contractStoreRoot = path.join(dir, 'contracts');
    writer.writeContractReferences(
      archiveContractReferences(contractStoreRoot, writer.runId, [
        loadScenario('core-service-selector-fault-v1'),
      ])
    );
    const trialWriter = writer.newTrial('trial_1');
    trialWriter.writeScenarioRef({ scenario_id: 'core-service-selector-fault-v1' });
    trialWriter.writeEnvironmentManifest({
      schema_version: SCHEMA_VERSION,
      trial_id: 'trial_1',
      cluster_profile: 'local-kwok',
      candidate: { id: 'scripted-reference', kind: 'scripted' },
      execution_mode: 'dry-run',
      observed_at: '2025-01-01T00:00:00.000Z',
    });
    trialWriter.trajectory.append({
      event_id: 'ev1',
      trial_id: 'trial_1',
      attempt_id: 'att1',
      sequence: 1,
      recorded_at: new Date().toISOString(),
      type: 'tool_call',
      tool_name: 'kubectl.get',
      operation: 'get_service_selector',
      target_resource: 'service/web',
      argument_digest: 'x',
      duration_ns: '100',
      status: 'success',
      result_digest: 'y',
      evidence_ids: ['ev1'],
      mutating: false,
    });
    const result = fakeTrialResult({ trial_id: 'trial_1', run_id: 'run_2' });
    trialWriter.writeResult(result);
    trialWriter.writeArtifactIndex({
      schema_version: SCHEMA_VERSION,
      trial_id: 'trial_1',
      artifacts: [],
    });
    writer.recordTrialIndex({
      trial_id: 'trial_1',
      run_id: 'run_2',
      scenario_id: 'core-service-selector-fault-v1',
      scenario_version: '1.0.0',
      candidate_id: 'scripted-reference',
      cluster_profile: 'local-kwok',
      run_eligibility: 'valid',
      first_failure_owner: null,
      supersedes_trial_id: null,
    });
    writer.close('scripted-reference', 'local-kwok');

    const bundle = readClosedBundle(dir, 'run_2', contractStoreRoot);
    assert.equal(bundle.trials.length, 1);
    assert.equal(bundle.trials[0]?.trial_id, 'trial_1');
    assert.equal(bundle.trials[0]?.dimensions.root_cause.outcome, 'pass');
    assert.equal(bundle.scenarioManifests[0]?.scenario_id, 'core-service-selector-fault-v1');
    assert.equal(bundle.scenarioManifests[0]?.provenance.owner, 'ai-assistant-evals-team');
    assert.ok(bundle.bundleDigest.length > 0);
  } finally {
    removeScratchDir(dir);
  }
});

test('readClosedBundle rejects a regression envelope with the wrong schema version', () => {
  const dir = makeScratchDir('bundle-regression-version');
  try {
    const writer = new RunBundleWriter(dir, 'run_version');
    writeEmptyContractReferences(writer);
    writer.recordRegressionDelta({
      schema_version: '2.0.0',
      record_id: 'delta-1',
      scenario_id: 'scenario-1',
      dimension: 'latency_ns',
      baseline_trial_id: 'baseline-1',
      candidate_trial_id: 'candidate-1',
      baseline_value: 10,
      candidate_value: 11,
      direction: 'regressed',
    });
    writer.close('candidate', 'local-kwok');

    const deltaPath = path.join(writer.bundleDir, 'regression-deltas.jsonl');
    const envelope = JSON.parse(readFileSync(deltaPath, 'utf8')) as { schema_version: string };
    envelope.schema_version = SCHEMA_VERSION;
    const tampered = `${JSON.stringify(envelope)}\n`;
    writeFileSync(deltaPath, tampered);

    const manifestPath = path.join(writer.bundleDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: Array<{ path: string; digest: string }>;
    };
    const entry = manifest.files.find(file => file.path === 'regression-deltas.jsonl');
    assert.ok(entry);
    entry.digest = sha256OfText(tampered);
    writeFileSync(manifestPath, JSON.stringify(manifest));

    assert.throws(
      () => readClosedBundle(dir, 'run_version'),
      /regression-deltas\.jsonl: unexpected schema version/
    );
  } finally {
    removeScratchDir(dir);
  }
});

test('close() throws if called twice on the same bundle', () => {
  const dir = makeScratchDir('bundle-double-close');
  try {
    const writer = new RunBundleWriter(dir, 'run_3');
    writeEmptyContractReferences(writer);
    writer.close('scripted-reference', 'local-kwok');
    assert.throws(() => writer.close('scripted-reference', 'local-kwok'), /already closed/);
  } finally {
    removeScratchDir(dir);
  }
});

test('constructor refuses to reopen an existing run directory', () => {
  const dir = makeScratchDir('bundle-existing');
  try {
    mkdirSync(path.join(dir, 'run_existing'));
    assert.throws(() => new RunBundleWriter(dir, 'run_existing'), /run directory already exists/);
  } finally {
    removeScratchDir(dir);
  }
});

test('close() atomically writes a sorted manifest and declares contract refs supported', () => {
  const dir = makeScratchDir('bundle-manifest');
  try {
    const writer = new RunBundleWriter(dir, 'run_manifest');
    writeEmptyContractReferences(writer);
    writer.close('scripted-reference', 'local-kwok');
    const manifest = JSON.parse(
      readFileSync(path.join(writer.bundleDir, 'manifest.json'), 'utf8')
    ) as {
      files: Array<{ path: string }>;
      unsupported_files: string[];
    };
    assert.deepEqual(
      manifest.files.map(file => file.path),
      manifest.files.map(file => file.path).sort()
    );
    assert.equal(manifest.unsupported_files.includes('contract-refs.json'), false);
    assert.ok(existsSync(path.join(writer.bundleDir, 'contract-refs.json')));
    assert.deepEqual(
      readdirSync(writer.bundleDir).filter(name => name.includes('manifest.json.')),
      []
    );
  } finally {
    removeScratchDir(dir);
  }
});

test('readClosedBundle rejects a file changed after the manifest was written', () => {
  const dir = makeScratchDir('bundle-tamper');
  try {
    const writer = new RunBundleWriter(dir, 'run_tamper');
    writeEmptyContractReferences(writer);
    writer.close('scripted-reference', 'local-kwok');
    writeFileSync(path.join(writer.bundleDir, 'trials.jsonl'), 'tampered\n', 'utf8');
    assert.throws(() => readClosedBundle(dir, 'run_tamper'), /digest mismatch/);
  } finally {
    removeScratchDir(dir);
  }
});

test('readClosedBundle throws when manifest.json is absent (crash mid-run, never truncated silently)', () => {
  const dir = makeScratchDir('bundle-incomplete');
  try {
    new RunBundleWriter(dir, 'run_4'); // never closed
    assert.throws(() => readClosedBundle(dir, 'run_4'), /never closed/);
  } finally {
    removeScratchDir(dir);
  }
});

test('two identical bundles produce byte-identical trials.jsonl payload content', () => {
  const dirA = makeScratchDir('bundle-det-a');
  const dirB = makeScratchDir('bundle-det-b');
  try {
    for (const [dir, runId] of [
      [dirA, 'run_a'],
      [dirB, 'run_b'],
    ] as const) {
      const writer = new RunBundleWriter(dir, runId);
      writeEmptyContractReferences(writer);
      writer.recordTrialIndex({
        trial_id: 'trial_fixed',
        run_id: runId,
        scenario_id: 's1',
        scenario_version: '1.0.0',
        candidate_id: 'scripted-reference',
        cluster_profile: 'local-kwok',
        run_eligibility: 'valid',
        first_failure_owner: null,
        supersedes_trial_id: null,
      });
      writer.close('scripted-reference', 'local-kwok');
    }
    const textA = readFileSync(path.join(dirA, 'run_a', 'bundle', 'trials.jsonl'), 'utf8');
    const textB = readFileSync(path.join(dirB, 'run_b', 'bundle', 'trials.jsonl'), 'utf8');
    // Only record_id/recorded_at differ between independent runs; the payload
    // (everything the report reads) must be identical for identical input.
    const payloadA = JSON.parse(textA.trim()).payload;
    const payloadB = JSON.parse(textB.trim()).payload;
    payloadA.run_id = 'shared';
    payloadB.run_id = 'shared';
    assert.deepEqual(payloadA, payloadB);
    assert.ok(existsSync(path.join(dirA, 'run_a', 'bundle', 'manifest.json')));
  } finally {
    removeScratchDir(dirA);
    removeScratchDir(dirB);
  }
});
