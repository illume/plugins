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
import type { PreflightResult } from '../clusterAdapter.js';
import { commandExists, type CommandRunner } from '../commandRunner.js';
import { KubectlClusterAdapter } from './kubectlAdapter.js';

const profileName = 'headlamp-ai-evals';
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultKubeconfigDirectory = path.resolve(here, '..', '..', '..', '.private');

function createDefaultKubeconfigPath(): string {
  return path.join(
    defaultKubeconfigDirectory,
    `evals-minikube-${process.pid}-${randomUUID()}.kubeconfig`
  );
}

/** Real Kubernetes adapter backed by a dedicated local Minikube profile. */
export class MinikubeAdapter extends KubectlClusterAdapter {
  private readonly candidateDirectories = new Map<string, string>();

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
