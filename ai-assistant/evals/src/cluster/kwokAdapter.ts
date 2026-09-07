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
 * A real cluster adapter that drives `kubectl` (and, for cluster
 * provisioning, `kwokctl`) through an injectable `CommandRunner`. This is the
 * opt-in "real" counterpart to `SimulatedKwokAdapter`: identical interface,
 * but every observation is an actual `kubectl get -o json` call. Tests inject
 * `createFakeCommandRunner` with canned JSON so the argument construction and
 * response parsing are covered without a live cluster.
 */

import type { ClusterProfileName } from '../contracts/types.js';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandRunner } from './commandRunner.js';
import { commandExists } from './commandRunner.js';
import type {
  ClusterAdapter,
  EndpointsObservation,
  NodeObservation,
  PodObservation,
  PreflightResult,
  SchedulingObservation,
  ServiceSelectorObservation,
} from './types.js';

interface KubectlPod {
  metadata: { name: string; labels?: Record<string, string> };
  spec: { containers: Array<{ resources?: { requests?: { cpu: string; memory: string } } }> };
  status: {
    phase?: string;
    podIP?: string;
    conditions?: Array<{ type: string; status: string; reason?: string; message?: string }>;
  };
}

const kwokWorkerManifest = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'profiles',
  'kwokWorker.yaml'
);

interface KubectlList<T> {
  items: T[];
}

function runJson<T>(runner: CommandRunner, args: string[]): T {
  const result = runner('kubectl', [...args, '-o', 'json']);
  if (result.status !== 0) {
    throw new Error(`kubectl ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as T;
}

export class KubectlKwokAdapter implements ClusterAdapter {
  readonly mode = 'real' as const;
  private readonly clusterName: string;
  private readonly kubeconfigPath: string;
  private clusterCreated = false;
  private readonly candidateKubeconfigs = new Map<string, string>();

  constructor(
    readonly profile: ClusterProfileName,
    protected readonly runner: CommandRunner,
    isolation?: { clusterName: string; kubeconfigPath: string }
  ) {
    this.clusterName = isolation?.clusterName ?? `headlamp-evals-${process.pid}`;
    this.kubeconfigPath =
      isolation?.kubeconfigPath ?? path.join(tmpdir(), `${this.clusterName}.kubeconfig`);
  }

  protected kubectl(args: string[]): string[] {
    return ['--kubeconfig', this.kubeconfigPath, ...args];
  }

  async candidateEnvironment(namespace: string): Promise<Record<string, string>> {
    const serviceAccount = 'headlamp-eval-candidate';
    const role = 'headlamp-eval-readonly';
    const run = (args: string[], purpose: string) => {
      const result = this.runner('kubectl', this.kubectl(args));
      if (result.status !== 0) {
        throw new Error(`${purpose} failed: ${result.stderr || result.stdout}`);
      }
      return result.stdout.trim();
    };
    run(['create', 'serviceaccount', serviceAccount, '-n', namespace], 'candidate service account');
    run(
      [
        'create',
        'role',
        role,
        '-n',
        namespace,
        '--verb=get,list,watch',
        '--resource=pods,pods/log,services,endpointslices.discovery.k8s.io,events',
      ],
      'candidate read-only role'
    );
    run(
      [
        'create',
        'rolebinding',
        role,
        '-n',
        namespace,
        `--role=${role}`,
        `--serviceaccount=${namespace}:${serviceAccount}`,
      ],
      'candidate role binding'
    );
    const token = run(
      ['create', 'token', serviceAccount, '-n', namespace, '--duration=15m'],
      'candidate token'
    );
    const adminConfig = JSON.parse(
      run(['config', 'view', '--raw', '--minify', '-o', 'json'], 'read cluster connection')
    ) as {
      clusters?: Array<{ cluster: { server: string; 'certificate-authority-data'?: string } }>;
    };
    const cluster = adminConfig.clusters?.[0]?.cluster;
    if (!cluster?.server) throw new Error('active kubeconfig has no cluster server');
    const candidatePath = path.join(
      tmpdir(),
      `${this.clusterName}-${namespace}-candidate.kubeconfig`
    );
    writeFileSync(
      candidatePath,
      JSON.stringify({
        apiVersion: 'v1',
        kind: 'Config',
        clusters: [{ name: 'trial', cluster }],
        users: [{ name: 'candidate', user: { token } }],
        contexts: [
          {
            name: 'trial',
            context: { cluster: 'trial', user: 'candidate', namespace },
          },
        ],
        'current-context': 'trial',
      }),
      { encoding: 'utf8', mode: 0o600 }
    );
    this.candidateKubeconfigs.set(namespace, candidatePath);
    return { KUBECONFIG: candidatePath };
  }

  async preflight(): Promise<PreflightResult> {
    for (const tool of ['kubectl', 'kwokctl', 'docker']) {
      if (!commandExists(tool, this.runner)) {
        return { supported: false, reason: `required tool "${tool}" is not on PATH` };
      }
    }
    const create = this.runner('kwokctl', [
      'create',
      'cluster',
      '--name',
      this.clusterName,
      '--runtime',
      'docker',
      '--kubeconfig',
      this.kubeconfigPath,
    ]);
    if (create.status !== 0) {
      return {
        supported: false,
        reason: `failed to create isolated KWOK cluster: ${create.stderr}`,
      };
    }
    this.clusterCreated = true;
    const result = this.runner('kubectl', this.kubectl(['version']));
    if (result.status !== 0) {
      await this.dispose();
      return { supported: false, reason: 'isolated KWOK cluster is not reachable with kubectl' };
    }
    const applyWorker = this.runner('kubectl', this.kubectl(['apply', '-f', kwokWorkerManifest]));
    const waitWorker = this.runner(
      'kubectl',
      this.kubectl(['wait', 'node/kwok-worker', '--for=condition=Ready', '--timeout=120s'])
    );
    if (applyWorker.status !== 0 || waitWorker.status !== 0) {
      await this.dispose();
      return {
        supported: false,
        reason: `failed to prepare KWOK worker: ${
          applyWorker.stderr || waitWorker.stderr || applyWorker.stdout || waitWorker.stdout
        }`,
      };
    }
    return { supported: true };
  }

  async createNamespace(namespace: string): Promise<void> {
    const result = this.runner('kubectl', this.kubectl(['create', 'namespace', namespace]));
    if (result.status !== 0 && !/already exists/.test(result.stderr)) {
      throw new Error(`failed to create namespace ${namespace}: ${result.stderr}`);
    }
  }

  async applyManifest(namespace: string, manifestYamlPath: string): Promise<void> {
    const result = this.runner(
      'kubectl',
      this.kubectl(['apply', '-n', namespace, '-f', manifestYamlPath])
    );
    if (result.status !== 0) {
      throw new Error(`kubectl apply failed for ${manifestYamlPath}: ${result.stderr}`);
    }
  }

  async getServiceSelector(namespace: string, name: string): Promise<ServiceSelectorObservation> {
    const result = this.runner(
      'kubectl',
      this.kubectl(['get', 'service', name, '-n', namespace, '-o', 'json'])
    );
    if (result.status !== 0) {
      return { found: false, selector: null };
    }
    const svc = JSON.parse(result.stdout) as { spec?: { selector?: Record<string, string> } };
    return { found: true, selector: svc.spec?.selector ?? {} };
  }

  async listPodsByLabelSelector(
    namespace: string,
    labelSelector: Record<string, string>
  ): Promise<PodObservation[]> {
    const selector = Object.entries(labelSelector)
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    const list = runJson<KubectlList<KubectlPod>>(
      this.runner,
      this.kubectl(['get', 'pods', '-n', namespace, '-l', selector])
    );
    return list.items.map(pod => ({
      name: pod.metadata.name,
      labels: pod.metadata.labels ?? {},
      phase: pod.status.phase ?? 'Unknown',
      resourceRequests: pod.spec.containers[0]?.resources?.requests,
    }));
  }

  async computeEndpoints(namespace: string, serviceName: string): Promise<EndpointsObservation> {
    const list = runJson<KubectlList<{ endpoints?: Array<{ addresses: string[] }> }>>(
      this.runner,
      this.kubectl([
        'get',
        'endpointslices',
        '-n',
        namespace,
        '-l',
        `kubernetes.io/service-name=${serviceName}`,
      ])
    );
    const addresses = list.items.flatMap(slice => slice.endpoints?.flatMap(e => e.addresses) ?? []);
    return { addresses };
  }

  async getPodResourceRequests(
    namespace: string,
    podName: string
  ): Promise<{ cpu: string; memory: string } | null> {
    const result = this.runner(
      'kubectl',
      this.kubectl(['get', 'pod', podName, '-n', namespace, '-o', 'json'])
    );
    if (result.status !== 0) return null;
    const pod = JSON.parse(result.stdout) as KubectlPod;
    return pod.spec.containers[0]?.resources?.requests ?? null;
  }

  async listNodeAllocatable(): Promise<NodeObservation[]> {
    const list = runJson<
      KubectlList<{
        metadata: { name: string };
        status: { allocatable?: { cpu: string; memory: string } };
      }>
    >(this.runner, this.kubectl(['get', 'nodes']));
    return list.items.map(node => ({
      name: node.metadata.name,
      allocatable: node.status.allocatable ?? { cpu: '0', memory: '0' },
    }));
  }

  async getSchedulingObservation(
    namespace: string,
    podName: string
  ): Promise<SchedulingObservation> {
    const result = this.runner(
      'kubectl',
      this.kubectl(['get', 'pod', podName, '-n', namespace, '-o', 'json'])
    );
    if (result.status !== 0) {
      return { supported: true, condition: 'Unknown', reason: 'PodNotFound' };
    }
    const pod = JSON.parse(result.stdout) as KubectlPod;
    const scheduled = pod.status.conditions?.find(c => c.type === 'PodScheduled');
    return {
      supported: true,
      phase: pod.status.phase ?? 'Unknown',
      condition: scheduled?.status ?? 'Unknown',
      reason: scheduled?.reason,
      message: scheduled?.message,
    };
  }

  async deleteNamespace(namespace: string): Promise<void> {
    try {
      const result = this.runner(
        'kubectl',
        this.kubectl([
          'delete',
          'namespace',
          namespace,
          '--ignore-not-found',
          '--wait=true',
          '--timeout=120s',
        ])
      );
      if (result.status !== 0) {
        throw new Error(
          `failed to delete namespace ${namespace}: ${result.stderr || result.stdout}`
        );
      }
      const verify = this.runner('kubectl', this.kubectl(['get', 'namespace', namespace]));
      if (verify.status === 0) {
        throw new Error(`namespace ${namespace} still exists after cleanup`);
      }
    } finally {
      const candidatePath = this.candidateKubeconfigs.get(namespace);
      if (candidatePath) rmSync(candidatePath, { force: true });
      this.candidateKubeconfigs.delete(namespace);
    }
  }

  async dispose(): Promise<void> {
    if (!this.clusterCreated) return;
    const result = this.runner('kwokctl', ['delete', 'cluster', '--name', this.clusterName]);
    if (result.status !== 0) {
      throw new Error(`failed to delete KWOK cluster ${this.clusterName}: ${result.stderr}`);
    }
    this.clusterCreated = false;
    rmSync(this.kubeconfigPath, { force: true });
  }
}
