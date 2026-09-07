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
 * Exercises `KubectlKwokAdapter`'s command construction and JSON parsing
 * using a fake `CommandRunner` — the "dry-run/testability" boundary the real
 * adapter is built around. No real `kubectl`/`kwokctl` binary is required.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeCommandRunner } from './commandRunner.js';
import { KubectlKwokAdapter } from './kwokAdapter.js';

const isolation = { clusterName: 'test-evals', kubeconfigPath: '/tmp/test-kubeconfig' };
const kube = ['kubectl', '--kubeconfig', isolation.kubeconfigPath];

test('preflight: reports unsupported with a specific reason when a tool is missing', async () => {
  const { runner } = createFakeCommandRunner([
    { match: ['which', 'kubectl'], result: { status: 0, stdout: '/usr/bin/kubectl', stderr: '' } },
    { match: ['which', 'kwokctl'], result: { status: 1, stdout: '', stderr: '' } },
  ]);
  const adapter = new KubectlKwokAdapter('local-kwok', runner, isolation);
  const preflight = await adapter.preflight();
  assert.equal(preflight.supported, false);
  assert.match(preflight.reason ?? '', /kwokctl/);
});

test('preflight: supported when every tool resolves and kubectl responds', async () => {
  const { runner } = createFakeCommandRunner([
    { match: ['which', 'kubectl'], result: { status: 0, stdout: '/usr/bin/kubectl', stderr: '' } },
    { match: ['which', 'kwokctl'], result: { status: 0, stdout: '/usr/bin/kwokctl', stderr: '' } },
    { match: ['which', 'docker'], result: { status: 0, stdout: '/usr/bin/docker', stderr: '' } },
    {
      match: [
        'kwokctl',
        'create',
        'cluster',
        '--name',
        isolation.clusterName,
        '--runtime',
        'docker',
        '--kubeconfig',
        isolation.kubeconfigPath,
      ],
      result: { status: 0, stdout: '', stderr: '' },
    },
    {
      match: [...kube, 'version'],
      result: { status: 0, stdout: 'v1.30', stderr: '' },
    },
    {
      match: [...kube, 'apply', '-f'],
      result: { status: 0, stdout: 'node/kwok-worker configured', stderr: '' },
    },
    {
      match: [...kube, 'wait', 'node/kwok-worker'],
      result: { status: 0, stdout: 'condition met', stderr: '' },
    },
  ]);
  const adapter = new KubectlKwokAdapter('local-kwok', runner, isolation);
  const preflight = await adapter.preflight();
  assert.equal(preflight.supported, true);
});

test('getServiceSelector: parses the selector from kubectl JSON output', async () => {
  const { runner, calls } = createFakeCommandRunner([
    {
      match: [...kube, 'get', 'service', 'web', '-n', 'ns1', '-o', 'json'],
      result: {
        status: 0,
        stdout: JSON.stringify({ spec: { selector: { app: 'web' } } }),
        stderr: '',
      },
    },
  ]);
  const adapter = new KubectlKwokAdapter('local-kwok', runner, isolation);
  const observation = await adapter.getServiceSelector('ns1', 'web');
  assert.deepEqual(observation, { found: true, selector: { app: 'web' } });
  assert.equal(calls.length, 1);
});

test('getServiceSelector: reports not found without throwing when kubectl exits non-zero', async () => {
  const { runner } = createFakeCommandRunner([
    {
      match: [...kube, 'get', 'service', 'missing', '-n', 'ns1', '-o', 'json'],
      result: { status: 1, stdout: '', stderr: 'not found' },
    },
  ]);
  const adapter = new KubectlKwokAdapter('local-kwok', runner, isolation);
  const observation = await adapter.getServiceSelector('ns1', 'missing');
  assert.deepEqual(observation, { found: false, selector: null });
});

test('listPodsByLabelSelector: builds a comma-joined selector and maps kubectl JSON list items', async () => {
  const { runner } = createFakeCommandRunner([
    {
      match: [...kube, 'get', 'pods', '-n', 'ns1', '-l', 'app=web,tier=backend', '-o', 'json'],
      result: {
        status: 0,
        stdout: JSON.stringify({
          items: [
            {
              metadata: { name: 'web-1', labels: { app: 'web' } },
              spec: { containers: [{ resources: { requests: { cpu: '1', memory: '1Gi' } } }] },
              status: { phase: 'Running' },
            },
          ],
        }),
        stderr: '',
      },
    },
  ]);
  const adapter = new KubectlKwokAdapter('local-kwok', runner, isolation);
  const pods = await adapter.listPodsByLabelSelector('ns1', { app: 'web', tier: 'backend' });
  assert.equal(pods.length, 1);
  assert.equal(pods[0]?.name, 'web-1');
  assert.equal(pods[0]?.phase, 'Running');
});

test('computeEndpoints: flattens addresses across every returned EndpointSlice', async () => {
  const { runner } = createFakeCommandRunner([
    {
      match: [
        ...kube,
        'get',
        'endpointslices',
        '-n',
        'ns1',
        '-l',
        'kubernetes.io/service-name=web',
        '-o',
        'json',
      ],
      result: {
        status: 0,
        stdout: JSON.stringify({
          items: [{ endpoints: [{ addresses: ['10.0.0.1'] }, { addresses: ['10.0.0.2'] }] }],
        }),
        stderr: '',
      },
    },
  ]);
  const adapter = new KubectlKwokAdapter('local-kwok', runner, isolation);
  const endpoints = await adapter.computeEndpoints('ns1', 'web');
  assert.deepEqual(endpoints.addresses, ['10.0.0.1', '10.0.0.2']);
});

test('getSchedulingObservation: parses the real PodScheduled condition', async () => {
  const { runner } = createFakeCommandRunner([
    {
      match: [...kube, 'get', 'pod', 'huge-pod', '-n', 'ns1', '-o', 'json'],
      result: {
        status: 0,
        stdout: JSON.stringify({
          metadata: { name: 'huge-pod' },
          spec: { containers: [] },
          status: {
            conditions: [
              {
                type: 'PodScheduled',
                status: 'False',
                reason: 'Unschedulable',
                message: 'insufficient cpu',
              },
            ],
          },
        }),
        stderr: '',
      },
    },
  ]);
  const adapter = new KubectlKwokAdapter('local-kwok', runner, isolation);
  const observation = await adapter.getSchedulingObservation('ns1', 'huge-pod');
  assert.equal(observation.supported, true);
  assert.equal(observation.condition, 'False');
  assert.equal(observation.reason, 'Unschedulable');
});

test('applyManifest and deleteNamespace issue the expected kubectl commands', async () => {
  const { runner, calls } = createFakeCommandRunner([
    {
      match: [...kube, 'apply', '-n', 'ns1', '-f', '/scenario/setup.yaml'],
      result: { status: 0, stdout: '', stderr: '' },
    },
    {
      match: [
        ...kube,
        'delete',
        'namespace',
        'ns1',
        '--ignore-not-found',
        '--wait=true',
        '--timeout=120s',
      ],
      result: { status: 0, stdout: '', stderr: '' },
    },
    {
      match: [...kube, 'get', 'namespace', 'ns1'],
      result: { status: 1, stdout: '', stderr: 'not found' },
    },
  ]);
  const adapter = new KubectlKwokAdapter('local-kwok', runner, isolation);
  await adapter.applyManifest('ns1', '/scenario/setup.yaml');
  await adapter.deleteNamespace('ns1');
  assert.equal(calls.length, 3);
  assert.ok(
    calls
      .filter(call => call.command === 'kubectl')
      .every(call => call.args[0] === '--kubeconfig' && call.args[1] === isolation.kubeconfigPath)
  );
});

test('deleteNamespace reports cleanup failure instead of silently succeeding', async () => {
  const { runner } = createFakeCommandRunner([
    {
      match: [
        ...kube,
        'delete',
        'namespace',
        'ns1',
        '--ignore-not-found',
        '--wait=true',
        '--timeout=120s',
      ],
      result: { status: 1, stdout: '', stderr: 'timed out' },
    },
  ]);
  const adapter = new KubectlKwokAdapter('local-kwok', runner, isolation);
  await assert.rejects(() => adapter.deleteNamespace('ns1'), /timed out/);
});
