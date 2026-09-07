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
import { SimulatedKwokAdapter } from '../cluster/simulated-adapter.js';
import { AksStubAdapter } from '../cluster/aks-stub-adapter.js';
import { createScriptedCandidate } from '../candidates/scripted.js';
import { loadScenario } from '../scenarios/loader.js';
import { runTrial } from './trial-runner.js';
import { RunBundleWriter } from '../storage/bundle-writer.js';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratch-dir.js';

test('runTrial: a reference candidate on the fault scenario passes root_cause and safety', async () => {
  const dir = makeScratchDir('trial-reference');
  try {
    const scenario = loadScenario('core-service-selector-fault-v1');
    const adapter = new SimulatedKwokAdapter('local-kwok');
    const bundleWriter = new RunBundleWriter(dir, 'run_1');
    const result = await runTrial({
      runId: 'run_1',
      trialId: 'trial_1',
      scenario,
      clusterAdapter: adapter,
      clusterPreflight: await adapter.preflight(),
      candidateAdapter: createScriptedCandidate('reference', scenario.evaluatorPacket),
      bundleWriter,
    });
    assert.equal(result.run_eligibility, 'valid');
    assert.equal(result.stage_status.setup, 'ok');
    assert.equal(result.stage_status.cleanup, 'ok');
    assert.equal(result.dimensions.root_cause.outcome, 'pass');
    assert.equal(result.root_cause_found, true);
    assert.equal(result.safety_outcome, 'pass');
    assert.equal(result.submission_status, 'valid');
    assert.equal(result.lifecycle_validity, 'clean');
    assert.ok(result.tool_summary.attempted > 0);
  } finally {
    removeScratchDir(dir);
  }
});

test('runTrial: a wrong candidate fails root_cause but still passes safety', async () => {
  const dir = makeScratchDir('trial-wrong');
  try {
    const scenario = loadScenario('core-service-selector-fault-v1');
    const adapter = new SimulatedKwokAdapter('local-kwok');
    const bundleWriter = new RunBundleWriter(dir, 'run_2');
    const result = await runTrial({
      runId: 'run_2',
      trialId: 'trial_1',
      scenario,
      clusterAdapter: adapter,
      clusterPreflight: await adapter.preflight(),
      candidateAdapter: createScriptedCandidate('wrong', scenario.evaluatorPacket),
      bundleWriter,
    });
    assert.equal(result.dimensions.root_cause.outcome, 'fail');
    assert.equal(result.root_cause_found, false);
    assert.equal(result.safety_outcome, 'pass');
  } finally {
    removeScratchDir(dir);
  }
});

test('runTrial: an unavailable candidate is marked invalid with candidate as first_failure_owner', async () => {
  const dir = makeScratchDir('trial-unavailable');
  try {
    const scenario = loadScenario('core-service-selector-fault-v1');
    const adapter = new SimulatedKwokAdapter('local-kwok');
    const bundleWriter = new RunBundleWriter(dir, 'run_3');
    const result = await runTrial({
      runId: 'run_3',
      trialId: 'trial_1',
      scenario,
      clusterAdapter: adapter,
      clusterPreflight: await adapter.preflight(),
      candidateAdapter: createScriptedCandidate('unavailable', scenario.evaluatorPacket),
      bundleWriter,
    });
    assert.equal(result.run_eligibility, 'invalid');
    assert.equal(result.first_failure_owner, 'candidate');
  } finally {
    removeScratchDir(dir);
  }
});

test('runTrial: a malformed submission is graded no_result, never silently passed or failed', async () => {
  const dir = makeScratchDir('trial-malformed');
  try {
    const scenario = loadScenario('core-service-selector-fault-v1');
    const adapter = new SimulatedKwokAdapter('local-kwok');
    const bundleWriter = new RunBundleWriter(dir, 'run_4');
    const result = await runTrial({
      runId: 'run_4',
      trialId: 'trial_1',
      scenario,
      clusterAdapter: adapter,
      clusterPreflight: await adapter.preflight(),
      candidateAdapter: createScriptedCandidate('malformed', scenario.evaluatorPacket),
      bundleWriter,
    });
    assert.equal(result.submission_status, 'malformed');
    assert.equal(result.dimensions.root_cause.outcome, 'no_result');
    assert.equal(result.root_cause_found, null);
  } finally {
    removeScratchDir(dir);
  }
});

test('runTrial: an unsupported cluster preflight (e.g. AKS without credentials) never runs setup or the candidate', async () => {
  const dir = makeScratchDir('trial-aks-unsupported');
  try {
    const scenario = loadScenario('core-unschedulable-capacity-v1');
    const adapter = new AksStubAdapter(['SOME_MISSING_ENV_VAR']);
    const bundleWriter = new RunBundleWriter(dir, 'run_5');
    const result = await runTrial({
      runId: 'run_5',
      trialId: 'trial_1',
      scenario,
      clusterAdapter: adapter,
      clusterPreflight: await adapter.preflight(),
      candidateAdapter: createScriptedCandidate('reference', scenario.evaluatorPacket),
      bundleWriter,
    });
    assert.equal(result.run_eligibility, 'invalid');
    assert.equal(result.stage_status.setup, 'unsupported');
    assert.equal(result.stage_status.candidate, 'skipped');
    assert.equal(result.first_failure_owner, 'setup');
  } finally {
    removeScratchDir(dir);
  }
});

test('runTrial: the healthy twin reference candidate does not overdiagnose', async () => {
  const dir = makeScratchDir('trial-healthy');
  try {
    const scenario = loadScenario('core-service-selector-healthy-v1');
    const adapter = new SimulatedKwokAdapter('local-kwok');
    const bundleWriter = new RunBundleWriter(dir, 'run_6');
    const result = await runTrial({
      runId: 'run_6',
      trialId: 'trial_1',
      scenario,
      clusterAdapter: adapter,
      clusterPreflight: await adapter.preflight(),
      candidateAdapter: createScriptedCandidate('reference', scenario.evaluatorPacket),
      bundleWriter,
    });
    assert.equal(result.dimensions.root_cause.outcome, 'pass');

    const wrongResult = await runTrial({
      runId: 'run_6',
      trialId: 'trial_2',
      scenario,
      clusterAdapter: adapter,
      clusterPreflight: await adapter.preflight(),
      candidateAdapter: createScriptedCandidate('wrong', scenario.evaluatorPacket),
      bundleWriter,
    });
    assert.equal(wrongResult.dimensions.root_cause.outcome, 'fail');
  } finally {
    removeScratchDir(dir);
  }
});
