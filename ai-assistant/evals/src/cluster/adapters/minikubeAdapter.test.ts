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
import { createFakeCommandRunner } from '../commandRunner.js';
import { MinikubeAdapter } from './minikubeAdapter.js';
import { makeScratchDir, removeScratchDir } from '../../test-helpers/scratchDir.js';

class InspectableMinikubeAdapter extends MinikubeAdapter {
  get configuredKubeconfigPath(): string {
    return this.kubeconfigPath;
  }
}

test('MinikubeAdapter isolates default kubeconfigs between concurrent runs', () => {
  const { runner } = createFakeCommandRunner([]);
  const first = new InspectableMinikubeAdapter(runner);
  const second = new InspectableMinikubeAdapter(runner);

  assert.notEqual(first.configuredKubeconfigPath, second.configuredKubeconfigPath);
});

test('MinikubeAdapter reuses a running profile and exports an isolated kubeconfig', async () => {
  const directory = makeScratchDir('minikube-adapter');
  const kubeconfigPath = path.join(directory, 'kubeconfig');
  try {
    const { runner, calls } = createFakeCommandRunner([
      ...['kubectl', 'minikube', 'docker'].map(tool => ({
        match: ['which', tool],
        result: { status: 0, stdout: `/usr/local/bin/${tool}\n`, stderr: '' },
      })),
      {
        match: ['minikube', 'status'],
        result: {
          status: 0,
          stdout: JSON.stringify({ Host: 'Running', APIServer: 'Running' }),
          stderr: '',
        },
      },
      {
        match: ['kubectl', 'config', 'view'],
        result: {
          status: 0,
          stdout: JSON.stringify({
            apiVersion: 'v1',
            kind: 'Config',
            clusters: [{ name: 'cluster', cluster: { server: 'https://127.0.0.1:12345' } }],
            contexts: [
              { name: 'headlamp-ai-evals', context: { cluster: 'cluster', user: 'admin' } },
            ],
            users: [{ name: 'admin', user: { 'client-key-data': 'admin-key' } }],
          }),
          stderr: '',
        },
      },
      {
        match: ['kubectl', '--kubeconfig', kubeconfigPath, 'version'],
        result: { status: 0, stdout: 'ok', stderr: '' },
      },
      {
        match: ['kubectl', '--kubeconfig', kubeconfigPath, 'apply'],
        result: { status: 0, stdout: '', stderr: '' },
      },
      {
        match: ['kubectl', '--kubeconfig', kubeconfigPath, 'create', 'token'],
        result: { status: 0, stdout: 'short-lived-token', stderr: '' },
      },
      {
        match: ['kubectl', '--kubeconfig', kubeconfigPath, 'delete'],
        result: { status: 0, stdout: '', stderr: '' },
      },
      {
        match: ['kubectl', '--kubeconfig', kubeconfigPath, 'get', 'namespace'],
        result: { status: 1, stdout: '', stderr: 'NotFound' },
      },
    ]);
    const adapter = new MinikubeAdapter(runner, kubeconfigPath);
    assert.deepEqual(await adapter.preflight(), { supported: true });
    assert.equal(existsSync(kubeconfigPath), true);
    assert.equal(
      calls.some(call => call.command === 'minikube' && call.args[0] === 'start'),
      false
    );
    assert.deepEqual(
      await adapter.candidateEnvironment('trial-ns', ['pod_status'], 'headlamp-cli'),
      {}
    );
    const environment = await adapter.candidateEnvironment('trial-ns', ['pod_status'], 'k8sgpt');
    assert.equal(environment.KUBERNETES_NAMESPACE, 'trial-ns');
    assert.notEqual(environment.KUBECONFIG, kubeconfigPath);
    const candidateConfig = readFileSync(environment.KUBECONFIG!, 'utf8');
    assert.equal(candidateConfig.includes('admin-key'), false);
    assert.deepEqual(JSON.parse(candidateConfig).users, [
      { name: 'k8sgpt', user: { token: 'short-lived-token' } },
    ]);
    const access = JSON.parse(
      readFileSync(path.join(path.dirname(environment.KUBECONFIG!), 'access.json'), 'utf8')
    );
    for (const resource of access.items) {
      for (const rule of resource.rules ?? []) {
        assert.ok(rule.verbs.every((verb: string) => ['get', 'list'].includes(verb)));
        assert.equal(rule.resources.includes('secrets'), false);
        assert.equal(rule.resources.includes('*'), false);
      }
    }
    await adapter.deleteNamespace('trial-ns');
    assert.equal(existsSync(environment.KUBECONFIG!), false);
    assert.ok(calls.some(call => call.args.includes('clusterrole,clusterrolebinding')));
    await adapter.dispose();
    assert.equal(existsSync(kubeconfigPath), false);
  } finally {
    removeScratchDir(directory);
  }
});

test('MinikubeAdapter queries Prometheus through the trusted query sidecar', async () => {
  const directory = makeScratchDir('minikube-prometheus-query');
  const kubeconfigPath = path.join(directory, 'kubeconfig');
  try {
    const { runner, calls } = createFakeCommandRunner([
      {
        match: ['kubectl', '--kubeconfig', kubeconfigPath, 'exec'],
        result: {
          status: 0,
          stdout: JSON.stringify({
            status: 'success',
            data: {
              result: [{ metric: { job: 'kube-state-metrics' }, value: [123, '1'] }],
            },
          }),
          stderr: '',
        },
      },
    ]);
    const adapter = new MinikubeAdapter(runner, kubeconfigPath);
    assert.deepEqual(await adapter.queryPrometheus('up{job="kube-state-metrics"}'), [
      {
        labels: { job: 'kube-state-metrics' },
        timestamp: 123,
        value: 1,
      },
    ]);
    assert.ok(calls[0]?.args.includes('query=up{job="kube-state-metrics"}'));
  } finally {
    removeScratchDir(directory);
  }
});

test('MinikubeAdapter marks metrics ready only after all scrape jobs are up', async () => {
  const directory = makeScratchDir('minikube-prometheus-ready');
  const kubeconfigPath = path.join(directory, 'kubeconfig');
  try {
    const upResult = {
      status: 'success',
      data: {
        result: ['apiserver', 'cadvisor', 'kube-state-metrics', 'kubelet'].map(job => ({
          metric: { job },
          value: [123, '1'],
        })),
      },
    };
    const { runner, calls } = createFakeCommandRunner([
      {
        match: ['kubectl', '--kubeconfig', kubeconfigPath, 'apply', '-f'],
        result: { status: 0, stdout: 'created', stderr: '' },
      },
      {
        match: ['kubectl', '--kubeconfig', kubeconfigPath, 'rollout', 'status'],
        result: { status: 0, stdout: 'ready', stderr: '' },
      },
      {
        match: ['kubectl', '--kubeconfig', kubeconfigPath, 'exec'],
        result: { status: 0, stdout: JSON.stringify(upResult), stderr: '' },
      },
      {
        match: ['kubectl', '--kubeconfig', kubeconfigPath, 'delete', '-f'],
        result: { status: 0, stdout: 'deleted', stderr: '' },
      },
    ]);
    const adapter = new MinikubeAdapter(runner, kubeconfigPath);
    await adapter.ensureMetricsCollection();
    const initializedCallCount = calls.length;
    await adapter.ensureMetricsCollection();
    assert.equal(calls.length, initializedCallCount);
    await adapter.dispose();
  } finally {
    removeScratchDir(directory);
  }
});

test('MinikubeAdapter removes the complete metrics manifest after partial startup', async () => {
  const directory = makeScratchDir('minikube-prometheus-cleanup');
  const kubeconfigPath = path.join(directory, 'kubeconfig');
  try {
    const { runner, calls } = createFakeCommandRunner([
      {
        match: ['kubectl', '--kubeconfig', kubeconfigPath, 'apply', '-f'],
        result: { status: 0, stdout: 'created', stderr: '' },
      },
      {
        match: ['kubectl', '--kubeconfig', kubeconfigPath, 'rollout', 'status'],
        result: { status: 1, stdout: '', stderr: 'timed out' },
      },
      {
        match: ['kubectl', '--kubeconfig', kubeconfigPath, 'delete', '-f'],
        result: { status: 0, stdout: 'deleted', stderr: '' },
      },
    ]);
    const adapter = new MinikubeAdapter(runner, kubeconfigPath);
    await assert.rejects(() => adapter.ensureMetricsCollection(), /was not ready/);
    await adapter.dispose();
    const cleanup = calls.find(call => call.args.includes('delete') && call.args.includes('-f'));
    assert.ok(cleanup?.args.some(argument => argument.endsWith('minikube-metrics-stack.yaml')));
  } finally {
    removeScratchDir(directory);
  }
});
