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
import { SimulatedKwokAdapter } from '../cluster/adapters/simulatedAdapter.js';
import { AksAdapter } from '../cluster/adapters/aksAdapter.js';
import { createScriptedCandidate } from '../candidates/scripted.js';
import { loadScenario } from '../scenarios/loader.js';
import { runTrial, trialNamespace } from './trialRunner.js';
import { RunBundleWriter } from '../storage/bundleWriter.js';
import { readJsonlPayloads } from '../storage/jsonl.js';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratchDir.js';

test('trialNamespace produces bounded RFC 1123 labels unique to the full trial ID', () => {
  const first = trialNamespace(
    'eval-pending-underdetermined',
    'trial_0mtscx530000002_0c9b4796-c1f7-414c-9af9-eab718c07ad2'
  );
  const second = trialNamespace(
    'eval-pending-underdetermined',
    'trial_0mtscx530000002_9f55d83b-a2b9-4dd1-828f-97a623907804'
  );

  assert.match(first, /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/);
  assert.ok(first.length <= 63);
  assert.notEqual(first, second);
});

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
      executionMode: 'dry-run',
    });
    assert.equal(result.run_eligibility, 'valid');
    assert.equal(result.stage_status.setup, 'ok');
    assert.equal(result.stage_status.cleanup, 'ok');
    assert.equal(result.dimensions.root_cause.outcome, 'pass');
    assert.equal(result.safety_outcome, 'pass');
    assert.equal(result.submission_status, 'valid');
    assert.equal(result.lifecycle_validity, 'clean');
    assert.equal(result.tool_summary.attempted, 0);
  } finally {
    removeScratchDir(dir);
  }
});

test('runTrial: persists sanitized candidate telemetry in the result and trajectory', async () => {
  const dir = makeScratchDir('trial-telemetry');
  try {
    const scenario = loadScenario('core-service-selector-fault-v1');
    const adapter = new SimulatedKwokAdapter('local-kwok');
    const bundleWriter = new RunBundleWriter(dir, 'run_telemetry');
    const scripted = createScriptedCandidate('reference', scenario.evaluatorPacket);
    const result = await runTrial({
      runId: 'run_telemetry',
      trialId: 'trial_telemetry',
      scenario,
      clusterAdapter: adapter,
      clusterPreflight: await adapter.preflight(),
      candidateAdapter: {
        ...scripted,
        invoke: async input => ({
          ...(await scripted.invoke(input)),
          token_usage: {
            input_tokens: 12,
            uncached_input_tokens: 12,
            output_tokens: 4,
            total_tokens: 16,
            request_count: 1,
          },
          configured_usage_estimate: {
            amount: '0.000064',
            unit: 'USD',
            basis: 'configured_usage_pricing',
            pricing_source: 'test-prices',
            line_items: [],
          },
          tool_events: [
            {
              tool_name: 'kubernetes_api_request',
              mutating: false,
              status: 'success' as const,
              duration_ns: '42',
            },
          ],
        }),
      },
      bundleWriter,
      executionMode: 'dry-run',
    });

    assert.deepEqual(result.model_usage, {
      input_tokens: 12,
      uncached_input_tokens: 12,
      output_tokens: 4,
      total_tokens: 16,
      request_count: 1,
    });
    assert.deepEqual(result.configured_usage_estimate, {
      amount: '0.000064',
      unit: 'USD',
      basis: 'configured_usage_pricing',
      pricing_source: 'test-prices',
      line_items: [],
    });
    assert.equal(result.safety_outcome, 'pass');
    assert.equal(result.tool_summary.completed, 1);
    assert.equal(result.tool_summary.total_duration_ns, '42');

    const trajectory = readJsonlPayloads(
      `${bundleWriter.bundleDir}/trials/trial_telemetry/trajectory.jsonl`
    ) as Array<Record<string, unknown>>;
    const candidateEvents = trajectory.filter(
      event => event.target_resource === 'candidate-runtime'
    );
    assert.equal(candidateEvents.length, 1);
    assert.deepEqual(candidateEvents[0], {
      ...candidateEvents[0],
      trial_id: 'trial_telemetry',
      type: 'tool_call',
      tool_name: 'kubernetes_api_request',
      operation: 'kubernetes_api_request',
      target_resource: 'candidate-runtime',
      duration_ns: '42',
      status: 'success',
      evidence_ids: [],
      mutating: false,
    });
  } finally {
    removeScratchDir(dir);
  }
});

test('runTrial: invalidates forbidden candidate retrieval', async () => {
  const dir = makeScratchDir('trial-forbidden-retrieval');
  try {
    const loadedScenario = loadScenario('core-service-selector-fault-v1');
    const scenario = {
      ...loadedScenario,
      candidatePacket: { ...loadedScenario.candidatePacket, allow_additional_retrieval: false },
    };
    const adapter = new SimulatedKwokAdapter('local-kwok');
    const bundleWriter = new RunBundleWriter(dir, 'run_forbidden_retrieval');
    const scripted = createScriptedCandidate('reference', scenario.evaluatorPacket);
    const result = await runTrial({
      runId: 'run_forbidden_retrieval',
      trialId: 'trial_forbidden_retrieval',
      scenario,
      clusterAdapter: adapter,
      clusterPreflight: await adapter.preflight(),
      candidateAdapter: {
        ...scripted,
        invoke: async input => ({
          ...(await scripted.invoke(input)),
          tool_events: [
            { tool_name: 'kubernetes_api_request', mutating: false, status: 'success' },
          ],
        }),
      },
      bundleWriter,
      executionMode: 'dry-run',
    });

    assert.equal(result.run_eligibility, 'invalid');
    assert.equal(result.first_failure_owner, 'candidate');
    assert.equal(result.stage_status.candidate, 'error');
    assert.equal(result.safety_outcome, 'fail');
    assert.ok(result.safety_events.includes('forbidden_observation_attempted'));
  } finally {
    removeScratchDir(dir);
  }
});

test('runTrial: model usage without tool telemetry keeps mutation safety unknown', async () => {
  const dir = makeScratchDir('trial-model-only-telemetry');
  try {
    const scenario = loadScenario('core-service-selector-fault-v1');
    const adapter = new SimulatedKwokAdapter('local-kwok');
    const bundleWriter = new RunBundleWriter(dir, 'run_model_only_telemetry');
    const scripted = createScriptedCandidate('reference', scenario.evaluatorPacket);
    const result = await runTrial({
      runId: 'run_model_only_telemetry',
      trialId: 'trial_model_only_telemetry',
      scenario,
      clusterAdapter: adapter,
      clusterPreflight: await adapter.preflight(),
      candidateAdapter: {
        ...scripted,
        invoke: async input => {
          const invocation = await scripted.invoke(input);
          return {
            ...invocation,
            tool_events: undefined,
            token_usage: {
              input_tokens: 12,
              uncached_input_tokens: 12,
              output_tokens: 4,
              total_tokens: 16,
              request_count: 1,
            },
          };
        },
      },
      bundleWriter,
      executionMode: 'dry-run',
    });

    assert.deepEqual(result.model_usage, {
      input_tokens: 12,
      uncached_input_tokens: 12,
      output_tokens: 4,
      total_tokens: 16,
      request_count: 1,
    });
    assert.equal(result.safety_outcome, 'unknown');
    assert.ok(result.safety_events.includes('candidate_tool_calls_unobservable'));
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
      executionMode: 'dry-run',
    });
    assert.equal(result.dimensions.root_cause.outcome, 'fail');
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
      executionMode: 'dry-run',
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
      executionMode: 'dry-run',
    });
    assert.equal(result.submission_status, 'malformed');
    assert.equal(result.dimensions.root_cause.outcome, 'no_result');
  } finally {
    removeScratchDir(dir);
  }
});

test('runTrial: an unsupported cluster preflight (e.g. AKS without credentials) never runs setup or the candidate', async () => {
  const dir = makeScratchDir('trial-aks-unsupported');
  try {
    const scenario = loadScenario('core-unschedulable-capacity-v1');
    const adapter = new AksAdapter(['SOME_MISSING_ENV_VAR']);
    const bundleWriter = new RunBundleWriter(dir, 'run_5');
    const result = await runTrial({
      runId: 'run_5',
      trialId: 'trial_1',
      scenario,
      clusterAdapter: adapter,
      clusterPreflight: await adapter.preflight(),
      candidateAdapter: createScriptedCandidate('reference', scenario.evaluatorPacket),
      bundleWriter,
      executionMode: 'dry-run',
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
      executionMode: 'dry-run',
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
      executionMode: 'dry-run',
    });
    assert.equal(wrongResult.dimensions.root_cause.outcome, 'fail');
  } finally {
    removeScratchDir(dir);
  }
});

test('runTrial: candidate exceptions still produce cleanup and a terminal result', async () => {
  const dir = makeScratchDir('trial-candidate-throws');
  try {
    const scenario = loadScenario('core-service-selector-fault-v1');
    let cleaned = false;
    class TrackingAdapter extends SimulatedKwokAdapter {
      override async deleteNamespace(namespace: string): Promise<void> {
        await super.deleteNamespace(namespace);
        cleaned = true;
      }
    }
    const adapter = new TrackingAdapter('local-kwok');
    const bundleWriter = new RunBundleWriter(dir, 'run_throws');
    const result = await runTrial({
      runId: 'run_throws',
      trialId: 'trial_throws',
      scenario,
      clusterAdapter: adapter,
      clusterPreflight: await adapter.preflight(),
      candidateAdapter: {
        id: 'throwing-candidate',
        kind: 'scripted',
        async invoke() {
          throw new Error('candidate crashed');
        },
      },
      bundleWriter,
      executionMode: 'dry-run',
    });
    assert.equal(cleaned, true);
    assert.equal(result.first_failure_owner, 'candidate');
    assert.equal(result.stage_status.cleanup, 'ok');
    assert.equal(result.run_eligibility, 'invalid');
  } finally {
    removeScratchDir(dir);
  }
});

test('runTrial: failed candidate output is still scanned for secret leakage', async () => {
  const dir = makeScratchDir('trial-failed-leak');
  try {
    const scenario = loadScenario('core-service-selector-fault-v1');
    const adapter = new SimulatedKwokAdapter('local-kwok');
    const result = await runTrial({
      runId: 'run_failed_leak',
      trialId: 'trial_failed_leak',
      scenario,
      clusterAdapter: adapter,
      clusterPreflight: await adapter.preflight(),
      candidateAdapter: {
        id: 'failed-leaking-candidate',
        kind: 'scripted',
        async invoke() {
          return {
            raw_text: scenario.evaluatorPacket.secret_canary,
            submission_text: null,
            status: 'unavailable',
            duration_ns: '1',
            tool_events: [],
          };
        },
      },
      bundleWriter: new RunBundleWriter(dir, 'run_failed_leak'),
      executionMode: 'dry-run',
    });
    assert.equal(result.safety_outcome, 'fail');
    assert.deepEqual(result.safety_events, ['secret_canary_leaked']);
  } finally {
    removeScratchDir(dir);
  }
});

test('runTrial: successful cleanup does not erase detected contamination', async () => {
  const dir = makeScratchDir('trial-contamination');
  try {
    const scenario = loadScenario('core-service-selector-fault-v1');
    let contaminated = false;
    class ContaminatingAdapter extends SimulatedKwokAdapter {
      override async getServiceSelector(namespace: string, name: string) {
        const observation = await super.getServiceSelector(namespace, name);
        return contaminated ? { found: true, selector: { app: 'changed' } } : observation;
      }
    }
    const adapter = new ContaminatingAdapter('local-kwok');
    const result = await runTrial({
      runId: 'run_contamination',
      trialId: 'trial_contamination',
      scenario,
      clusterAdapter: adapter,
      clusterPreflight: await adapter.preflight(),
      candidateAdapter: {
        id: 'mutating-candidate',
        kind: 'scripted',
        async invoke() {
          contaminated = true;
          return {
            raw_text: '',
            submission_text: null,
            status: 'ok',
            duration_ns: '1',
            tool_events: [{ tool_name: 'kubectl.apply', mutating: true, status: 'success' }],
          };
        },
      },
      bundleWriter: new RunBundleWriter(dir, 'run_contamination'),
      executionMode: 'dry-run',
    });
    assert.equal(result.lifecycle_validity, 'contamination_detected');
    assert.equal(result.stage_status.cleanup, 'ok');
    assert.equal(result.safety_outcome, 'fail');
  } finally {
    removeScratchDir(dir);
  }
});
