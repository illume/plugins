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
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isBundleClosed, RunBundleWriter } from './bundle-writer.js';
import { readClosedBundle } from './bundle-reader.js';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratch-dir.js';
import { SCHEMA_VERSION } from '../contracts/types.js';
import type { TrialResult } from '../contracts/types.js';

function fakeTrialResult(overrides: Partial<TrialResult> = {}): TrialResult {
  return {
    schema_version: SCHEMA_VERSION,
    trial_id: 'trial_x',
    run_id: 'run_x',
    scenario_id: 'core-service-selector-fault-v1',
    scenario_version: '1.0.0',
    candidate_id: 'scripted-reference',
    candidate_kind: 'scripted',
    cluster_profile: 'local-kwok',
    run_eligibility: 'valid',
    stage_status: { setup: 'ok', candidate: 'ok', grader: 'ok', verifier: 'ok', cleanup: 'ok' },
    dimensions: {
      root_cause: { applicable: true, outcome: 'pass', grader_result_ids: [] },
      recommended_fix: { applicable: true, outcome: 'pass', grader_result_ids: [] },
    },
    root_cause_found: true,
    recommended_fix_correct: true,
    safety_outcome: 'pass',
    safety_events: [],
    lifecycle_validity: 'clean',
    timing: { time_to_diagnosis_ns: '1000', time_to_resolution_ns: null },
    tool_summary: {
      attempted: 1,
      completed: 1,
      failed: 0,
      denied: 0,
      unique_tools: 1,
      total_duration_ns: '1000',
    },
    submission_status: 'valid',
    unscored_novel_strategy: false,
    recorded_at: new Date().toISOString(),
    ...overrides,
  };
}

test('isBundleClosed: false before manifest.json exists, true after close()', () => {
  const dir = makeScratchDir('bundle-closed');
  try {
    assert.equal(isBundleClosed(dir, 'run_1'), false);
    const writer = new RunBundleWriter(dir, 'run_1');
    assert.equal(isBundleClosed(dir, 'run_1'), false);
    writer.close('scripted-reference', 'local-kwok');
    assert.equal(isBundleClosed(dir, 'run_1'), true);
  } finally {
    removeScratchDir(dir);
  }
});

test('a trial written through TrialBundleWriter round-trips through readClosedBundle', () => {
  const dir = makeScratchDir('bundle-roundtrip');
  try {
    const writer = new RunBundleWriter(dir, 'run_2');
    const trialWriter = writer.newTrial('trial_1');
    trialWriter.writeScenarioRef({ scenario_id: 'core-service-selector-fault-v1' });
    trialWriter.writeEnvironmentManifest({ trial_id: 'trial_1' });
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

    const bundle = readClosedBundle(dir, 'run_2');
    assert.equal(bundle.trials.length, 1);
    assert.equal(bundle.trials[0]?.trial_id, 'trial_1');
    assert.equal(bundle.trials[0]?.dimensions.root_cause.outcome, 'pass');
    assert.ok(bundle.bundleDigest.length > 0);
  } finally {
    removeScratchDir(dir);
  }
});

test('close() throws if called twice on the same bundle', () => {
  const dir = makeScratchDir('bundle-double-close');
  try {
    const writer = new RunBundleWriter(dir, 'run_3');
    writer.close('scripted-reference', 'local-kwok');
    assert.throws(() => writer.close('scripted-reference', 'local-kwok'), /already closed/);
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
