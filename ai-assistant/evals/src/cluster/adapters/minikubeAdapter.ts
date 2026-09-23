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

import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { PreflightResult, PrometheusSample } from '../clusterAdapter.js';
import { commandExists, type CommandRunner } from '../commandRunner.js';
import { KubectlClusterAdapter } from './kubectlAdapter.js';

const profileName = 'headlamp-ai-evals';
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultKubeconfigDirectory = path.resolve(here, '..', '..', '..', '.private');
const metricsManifest = path.resolve(
  here,
  '..',
  '..',
  '..',
  'fixtures',
  'minikube-metrics-stack.yaml'
);
const metricsNamespace = 'headlamp-evals-metrics';

function createDefaultKubeconfigPath(): string {
  return path.join(
    defaultKubeconfigDirectory,
    `evals-minikube-${process.pid}-${randomUUID()}.kubeconfig`
  );
}

/** Real Kubernetes adapter backed by a dedicated local Minikube profile. */
export class MinikubeAdapter extends KubectlClusterAdapter {
  private readonly candidateDirectories = new Map<string, string>();
  private metricsInstalled = false;
  private metricsReady = false;

  constructor(runner: CommandRunner, kubeconfigPath = createDefaultKubeconfigPath()) {
    super('local-minikube', runner, { clusterName: profileName, kubeconfigPath });
  }

  /** Starts or reuses the named profile and exports an isolated kubeconfig. */
  override async preflight(): Promise<PreflightResult> {
    for (const tool of ['kubectl', 'minikube', 'docker']) {
      if (!commandExists(tool, this.runner)) {
        return { supported: false, reason: `required tool "${tool}" is not on PATH` };
      }
    }
    const status = this.runner('minikube', ['status', '--profile', profileName, '--output=json']);
    if (status.status !== 0 || !isRunning(status.stdout)) {
      const start = this.runner('minikube', ['start', '--profile', profileName, '--driver=docker']);
      if (start.status !== 0) {
        return {
          supported: false,
          reason: `failed to start Minikube profile ${profileName}: ${start.stderr}`,
        };
      }
    }
    const exported = this.runner('kubectl', [
      'config',
      'view',
      '--raw',
      '--flatten',
      '--minify',
      '--context',
      profileName,
      '-o',
      'json',
    ]);
    if (exported.status !== 0) {
      return {
        supported: false,
        reason: `failed to export Minikube kubeconfig: ${exported.stderr}`,
      };
    }
    const config = JSON.parse(exported.stdout) as Record<string, unknown>;
    config['current-context'] = profileName;
    mkdirSync(path.dirname(this.kubeconfigPath), { recursive: true });
    writeFileSync(this.kubeconfigPath, JSON.stringify(config), {
      encoding: 'utf8',
      mode: 0o600,
    });
    const version = this.runner('kubectl', this.kubectl(['version']));
    return version.status === 0
      ? { supported: true }
      : { supported: false, reason: 'Minikube is not reachable with the isolated kubeconfig' };
  }

  override async candidateEnvironment(
    namespace: string,
    _allowedObservationKinds: string[],
    candidateId: string
  ): Promise<Record<string, string>> {
    if (candidateId !== 'k8sgpt') return {};
    if (this.candidateDirectories.has(namespace)) {
      throw new Error('K8sGPT credentials already issued for this trial');
    }
    const config = JSON.parse(readFileSync(this.kubeconfigPath, 'utf8'));
    const context = config.contexts?.find(
      (entry: { name: string }) => entry.name === config['current-context']
    );
    const cluster = config.clusters?.find(
      (entry: { name: string }) => entry.name === context?.context?.cluster
    );
    if (!cluster) throw new Error('Minikube kubeconfig has no active cluster');
    const directory = mkdtempSync(path.join(path.dirname(this.kubeconfigPath), 'k8sgpt-'));
    this.candidateDirectories.set(namespace, directory);
    const name = `k8sgpt-${namespace}`;
    const subject = { kind: 'ServiceAccount', name: 'k8sgpt', namespace };
    const rbacVersion = 'rbac.authorization.k8s.io/v1';
    const manifestPath = path.join(directory, 'access.json');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        apiVersion: 'v1',
        kind: 'List',
        items: [
          {
            apiVersion: 'v1',
            kind: 'ServiceAccount',
            metadata: { name: 'k8sgpt', namespace },
            automountServiceAccountToken: false,
          },
          {
            apiVersion: rbacVersion,
            kind: 'Role',
            metadata: { name: 'k8sgpt', namespace },
            rules: [
              {
                apiGroups: [''],
                resources: ['pods', 'services', 'endpoints', 'events', 'persistentvolumeclaims'],
                verbs: ['get', 'list'],
              },
              {
                apiGroups: ['apps'],
                resources: ['deployments', 'replicasets'],
                verbs: ['get', 'list'],
              },
            ],
          },
          {
            apiVersion: rbacVersion,
            kind: 'RoleBinding',
            metadata: { name: 'k8sgpt', namespace },
            subjects: [subject],
            roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: 'k8sgpt' },
          },
          {
            apiVersion: rbacVersion,
            kind: 'ClusterRole',
            metadata: { name },
            rules: [
              {
                apiGroups: ['storage.k8s.io'],
                resources: ['storageclasses'],
                verbs: ['get', 'list'],
              },
              {
                apiGroups: [''],
                resources: ['namespaces'],
                resourceNames: [namespace],
                verbs: ['get'],
              },
            ],
          },
          {
            apiVersion: rbacVersion,
            kind: 'ClusterRoleBinding',
            metadata: { name },
            subjects: [subject],
            roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name },
          },
        ],
      }),
      { mode: 0o600 }
    );
    const applied = this.runner('kubectl', this.kubectl(['apply', '-f', manifestPath]));
    if (applied.status !== 0) throw new Error('failed to provision K8sGPT read-only access');
    const token = this.runner(
      'kubectl',
      this.kubectl(['create', 'token', 'k8sgpt', '-n', namespace, '--duration=10m'])
    );
    if (token.status !== 0 || !token.stdout.trim()) {
      throw new Error('failed to issue K8sGPT short-lived credential');
    }
    const candidatePath = path.join(directory, 'kubeconfig.json');
    writeFileSync(
      candidatePath,
      JSON.stringify({
        apiVersion: 'v1',
        kind: 'Config',
        'current-context': 'k8sgpt',
        clusters: [cluster],
        contexts: [
          { name: 'k8sgpt', context: { cluster: cluster.name, user: 'k8sgpt', namespace } },
        ],
        users: [{ name: 'k8sgpt', user: { token: token.stdout.trim() } }],
      }),
      { mode: 0o600 }
    );
    return { KUBECONFIG: candidatePath, KUBERNETES_NAMESPACE: namespace };
  }

  async ensureMetricsCollection(): Promise<void> {
    if (this.metricsReady) return;
    if (!this.metricsInstalled) {
      const apply = this.runner('kubectl', this.kubectl(['apply', '-f', metricsManifest]));
      if (apply.status !== 0) {
        throw new Error(`failed to install metrics collection: ${apply.stderr || apply.stdout}`);
      }
      this.metricsInstalled = true;
    }
    for (const deployment of ['kube-state-metrics', 'prometheus']) {
      const rollout = this.runner(
        'kubectl',
        this.kubectl([
          'rollout',
          'status',
          `deployment/${deployment}`,
          '-n',
          metricsNamespace,
          '--timeout=240s',
        ])
      );
      if (rollout.status !== 0) {
        throw new Error(
          `metrics deployment ${deployment} was not ready: ${rollout.stderr || rollout.stdout}`
        );
      }
    }
    for (let attempt = 0; attempt < 24; attempt++) {
      const samples = await this.queryPrometheus(
        'up{job=~"apiserver|cadvisor|kube-state-metrics|kubelet"}'
      );
      if (
        new Set(samples.filter(sample => sample.value === 1).map(sample => sample.labels.job))
          .size === 4
      ) {
        this.metricsReady = true;
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 2_500));
    }
    throw new Error(
      'metrics collection did not observe API server, kubelet, cAdvisor, and kube-state-metrics'
    );
  }

  async queryPrometheus(expression: string): Promise<PrometheusSample[]> {
    const result = this.runner(
      'kubectl',
      this.kubectl([
        'exec',
        '-n',
        metricsNamespace,
        'deployment/prometheus',
        '-c',
        'query',
        '--',
        'curl',
        '--fail',
        '--silent',
        '--get',
        '--data-urlencode',
        `query=${expression}`,
        'http://127.0.0.1:9090/api/v1/query',
      ])
    );
    if (result.status !== 0) {
      throw new Error(`Prometheus query failed: ${result.stderr || result.stdout}`);
    }
    const response = JSON.parse(result.stdout) as {
      status: string;
      error?: string;
      data?: { result?: Array<{ metric?: Record<string, string>; value?: [number, string] }> };
    };
    if (response.status !== 'success') throw new Error(response.error ?? 'Prometheus query failed');
    return (response.data?.result ?? []).map(sample => ({
      labels: sample.metric ?? {},
      timestamp: sample.value?.[0] ?? 0,
      value: Number(sample.value?.[1] ?? 'NaN'),
    }));
  }

  override async deleteNamespace(namespace: string): Promise<void> {
    try {
      if (this.candidateDirectories.has(namespace)) {
        const removed = this.runner(
          'kubectl',
          this.kubectl([
            'delete',
            'clusterrole,clusterrolebinding',
            `k8sgpt-${namespace}`,
            '--ignore-not-found',
          ])
        );
        if (removed.status !== 0) throw new Error('failed to remove K8sGPT read-only access');
      }
    } finally {
      try {
        await super.deleteNamespace(namespace);
      } finally {
        const directory = this.candidateDirectories.get(namespace);
        if (directory) rmSync(directory, { recursive: true, force: true });
        this.candidateDirectories.delete(namespace);
      }
    }
  }

  /** Removes only the exported kubeconfig; the reusable named profile remains. */
  override async dispose(): Promise<void> {
    for (const directory of this.candidateDirectories.values()) {
      rmSync(directory, { recursive: true, force: true });
    }
    if (this.metricsInstalled) {
      this.runner(
        'kubectl',
        this.kubectl([
          'delete',
          '-f',
          metricsManifest,
          '--ignore-not-found',
          '--wait=true',
          '--timeout=120s',
        ])
      );
      this.metricsInstalled = false;
      this.metricsReady = false;
    }
    rmSync(this.kubeconfigPath, { force: true });
  }
}

function isRunning(output: string): boolean {
  try {
    const status = JSON.parse(output) as { Host?: string; APIServer?: string };
    return status.Host === 'Running' && status.APIServer === 'Running';
  } catch {
    return false;
  }
}
