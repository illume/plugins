/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createFakeCommandRunner } from '../cluster/commandRunner.js';
import { loadScenario } from '../scenarios/loader.js';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratchDir.js';
import { HolmesGptAdapter, parseHolmesTelemetry } from './holmesGptAdapter.js';
import { createK8sGptCandidate, K8sGptAdapter } from './k8sGptAdapter.js';
import { qualifyReferenceAdapter } from './referenceQualification.js';

const image = `registry.example/reference@sha256:${'a'.repeat(64)}`;
const input = {
  packet: loadScenario('core-service-selector-fault-v1').candidatePacket,
  observations: [],
  evidence_digest: 'b'.repeat(64),
};
const healthyInput = {
  packet: loadScenario('core-pvc-storageclass-healthy-v1').candidatePacket,
  observations: [],
  evidence_digest: 'b'.repeat(64),
};
const healthySubmission = JSON.stringify({
  schema_version: '1.0.0',
  cause_facts: [],
  resource_refs: [],
  evidence_refs: [],
  alternative_dispositions: [],
  uncertainty: { is_uncertain: false },
  proposed_actions: [{ operation: 'no_action', description: 'K8sGPT reported no problems.' }],
});

test('concrete reference adapters require immutable image digests', () => {
  assert.throws(
    () => new HolmesGptAdapter({ image: 'registry.example/holmes:latest', kubeconfigPath: '/k' }),
    /pinned by sha256/
  );
});

test('HolmesGPT extracts direct and fenced machine-readable JSON results', () => {
  const adapter = new HolmesGptAdapter({ image, kubeconfigPath: '/k' });
  assert.equal(
    adapter.extractSubmission('{"schema_version":"1.0.0"}'),
    '{"schema_version":"1.0.0"}'
  );
  assert.equal(
    adapter.extractSubmission('```json\n{"schema_version":"1.0.0"}\n```'),
    '{"schema_version":"1.0.0"}'
  );
  assert.equal(adapter.extractSubmission('not JSON'), null);
});

test('HolmesGPT normalizes machine-readable usage telemetry', () => {
  assert.deepEqual(
    parseHolmesTelemetry(
      {
        prompt_tokens: 4_501,
        completion_tokens: 2,
        total_tokens: 4_503,
        cached_tokens: 4_224,
        cache_creation_tokens: null,
        reasoning_tokens: 0,
        num_llm_calls: 1,
      },
      'azure/gpt-4o'
    ),
    {
      token_usage: {
        input_tokens: 4_501,
        uncached_input_tokens: 277,
        output_tokens: 2,
        total_tokens: 4_503,
        request_count: 1,
        cache_read_input_tokens: 4_224,
        reasoning_output_tokens: 0,
      },
      model_invocations: [
        {
          provider: 'azure',
          model: 'gpt-4o',
          input_token_semantics: 'total_including_cache',
          input_tokens: 4_501,
          uncached_input_tokens: 277,
          output_tokens: 2,
          total_tokens: 4_503,
          cache_read_input_tokens: 4_224,
          reasoning_output_tokens: 0,
        },
      ],
    }
  );
  assert.deepEqual(
    parseHolmesTelemetry(
      {
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 11,
        num_llm_calls: 1,
      },
      'azure/gpt-4o'
    ),
    {}
  );
});

test('K8sGPT candidate uses only analyze --explain and leaves unavailable usage unreported', async () => {
  const directory = makeScratchDir('k8sgpt-explain');
  const kubeconfigPath = path.join(directory, 'kubeconfig');
  let mountedDirectory = '';
  try {
    writeFileSync(
      kubeconfigPath,
      JSON.stringify({ clusters: [{ cluster: { server: 'https://127.0.0.1:12345' } }] })
    );
    const fake = createFakeCommandRunner([
      {
        match: ['docker', 'run', '--rm'],
        result: {
          status: 0,
          stdout:
            '{"provider":"azureopenai","errors":null,"status":"ProblemDetected","problems":1,"results":[{"details":"Explained"}]}',
          stderr: '',
        },
      },
    ]);
    const candidate = createK8sGptCandidate({
      image,
      kubeconfigPath,
      runner: (command, args) => {
        mountedDirectory = args[args.indexOf('--volume') + 1]!.replace(/:\/eval:ro$/, '');
        assert.equal(statSync(mountedDirectory).mode & 0o777, 0o700);
        for (const filename of ['kubeconfig.json', 'k8sgpt.json']) {
          assert.equal(statSync(path.join(mountedDirectory, filename)).mode & 0o777, 0o600);
        }
        const config = JSON.parse(readFileSync(path.join(mountedDirectory, 'k8sgpt.json'), 'utf8'));
        assert.equal(config.ai.providers[0].password, 'test-key');
        assert.equal(args.includes('test-key'), false);
        assert.equal(
          args[args.indexOf('--user') + 1],
          `${process.getuid?.() ?? 65532}:${process.getgid?.() ?? 65532}`
        );
        assert.ok(args.includes('HOME=/tmp'));
        return fake.runner(command, args);
      },
      model: 'gpt-4o',
      deployment: 'gpt-4o',
      apiKey: 'test-key',
      apiBase: 'https://example.openai.azure.com',
      apiVersion: '2024-10-21',
    });
    const result = await candidate.invoke({
      ...healthyInput,
      environment: { KUBECONFIG: kubeconfigPath, KUBERNETES_NAMESPACE: 'trial-ns' },
    });

    assert.equal(result.status, 'ok');
    assert.equal(result.submission_text, null);
    assert.equal(result.token_usage, undefined);
    assert.equal(result.model_invocations, undefined);
    assert.deepEqual(result.tool_events, [
      { tool_name: 'k8sgpt.analyze.explain', mutating: false, status: 'success' },
    ]);
    const analyzeIndex = fake.calls[0]!.args.indexOf('analyze');
    assert.ok(analyzeIndex >= 0);
    assert.equal(fake.calls[0]!.args[analyzeIndex + 1], '--explain');
    assert.ok(fake.calls[0]!.args.includes('azureopenai'));
    assert.equal(existsSync(mountedDirectory), false);
  } finally {
    removeScratchDir(directory);
  }
});

for (const Adapter of [HolmesGptAdapter, K8sGptAdapter]) {
  test(`${Adapter.name} qualification distinguishes transport health from submission parity`, async () => {
    const fake = createFakeCommandRunner([
      {
        match: ['docker', 'image', 'inspect', image],
        result: { status: 0, stdout: '[]', stderr: '' },
      },
      {
        match: ['docker', 'run', '--rm'],
        result: { status: 0, stdout: 'version', stderr: '' },
      },
    ]);
    const adapter = new Adapter({
      image,
      kubeconfigPath: '/tmp/eval-kubeconfig',
      runner: fake.runner,
    });
    const disposition = await qualifyReferenceAdapter(
      adapter,
      Adapter === K8sGptAdapter ? healthyInput : input,
      Adapter === K8sGptAdapter
        ? {
            native_output: '{"problems":0,"results":null}',
            expected_submission: healthySubmission,
          }
        : {
            native_output: `Result\n\n\`\`\`json\n${healthySubmission}\n\`\`\``,
            expected_submission: healthySubmission,
          }
    );

    assert.equal(disposition.status, Adapter === K8sGptAdapter ? 'ineligible' : 'eligible');
    assert.equal(disposition.stages.startup, 'passed');
    assert.equal(disposition.stages.health, 'passed');
    assert.equal(disposition.stages.cleanup, 'passed');
    if (Adapter === K8sGptAdapter) {
      assert.equal(disposition.stages.fixed_submission_parity, 'failed');
      assert.deepEqual(disposition.reasons, ['adapter returned no structured submission']);
    }
    const expectedPrefix = [
      'run',
      '--rm',
      '--network=none',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=16m',
      ...(Adapter === K8sGptAdapter
        ? ['--tmpfs', '/home/nonroot/.config:rw,noexec,nosuid,size=16m']
        : []),
      '--volume',
      '/tmp/eval-kubeconfig:/root/.kube/config:ro',
      image,
    ];
    assert.deepEqual(fake.calls[1]?.args.slice(0, expectedPrefix.length), expectedPrefix);
  });
}

test('K8sGPT validates native output and cleans private mounts after failures', async () => {
  const healthy = {
    provider: 'azureopenai',
    errors: null,
    status: 'OK',
    problems: 0,
    results: null,
  };
  const cases = [
    { stdout: JSON.stringify(healthy), status: 0, expected: 'ok' },
    { stdout: JSON.stringify({ ...healthy, results: [] }), status: 0, expected: 'ok' },
    {
      stdout: JSON.stringify({ ...healthy, errors: ['namespace not found'] }),
      status: 0,
      expected: 'unavailable',
    },
    {
      stdout: JSON.stringify({
        ...healthy,
        status: 'ProblemDetected',
        problems: 1,
        results: [{ details: '' }],
      }),
      status: 0,
      expected: 'unavailable',
    },
    { stdout: JSON.stringify({ ...healthy, problems: -1 }), status: 0, expected: 'unavailable' },
    { stdout: JSON.stringify({ ...healthy, provider: '' }), status: 0, expected: 'unavailable' },
    { stdout: 'not JSON', status: 0, expected: 'unavailable' },
    { stdout: 'null', status: 0, expected: 'unavailable' },
    { stdout: JSON.stringify(healthy), status: 1, expected: 'unavailable' },
    { stdout: '', status: -1, expected: 'throw' },
  ];
  const directory = makeScratchDir('k8sgpt-output');
  const kubeconfigPath = path.join(directory, 'kubeconfig');
  try {
    writeFileSync(kubeconfigPath, JSON.stringify({ clusters: [] }));
    for (const sample of cases) {
      let mount = '';
      const candidate = createK8sGptCandidate({
        image,
        kubeconfigPath,
        model: 'gpt-4o',
        deployment: 'gpt-4o',
        apiKey: 'test-key',
        apiBase: 'https://example.openai.azure.com',
        apiVersion: '2024-10-21',
        runner: (_command, args) => {
          mount = args[args.indexOf('--volume') + 1]!.replace(/:\/eval:ro$/, '');
          if (sample.status === -1) throw new Error('container launch failed');
          return { stdout: sample.stdout, status: sample.status, stderr: '' };
        },
      });
      const invocation = candidate.invoke({
        ...healthyInput,
        environment: { KUBECONFIG: kubeconfigPath, KUBERNETES_NAMESPACE: 'trial-ns' },
      });
      if (sample.expected === 'throw') {
        await assert.rejects(invocation, /container launch failed/);
      } else {
        const result = await invocation;
        assert.equal(result.status, sample.expected, sample.stdout);
        assert.equal(result.submission_text, null);
        assert.equal(result.token_usage, undefined);
      }
      assert.notEqual(mount, '');
      assert.equal(existsSync(mount), false);
    }
  } finally {
    removeScratchDir(directory);
  }
});
