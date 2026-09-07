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

  constructor(readonly profile: ClusterProfileName, private readonly runner: CommandRunner) {}

  async preflight(): Promise<PreflightResult> {
    for (const tool of ['kubectl', 'kwokctl', 'docker']) {
      if (!commandExists(tool, this.runner)) {
        return { supported: false, reason: `required tool "${tool}" is not on PATH` };
      }
    }
    const result = this.runner('kubectl', ['version', '--client']);
    if (result.status !== 0) {
      return { supported: false, reason: 'kubectl is installed but not runnable' };
    }
    return { supported: true };
  }

  async createNamespace(namespace: string): Promise<void> {
    const result = this.runner('kubectl', ['create', 'namespace', namespace]);
    if (result.status !== 0 && !/already exists/.test(result.stderr)) {
      throw new Error(`failed to create namespace ${namespace}: ${result.stderr}`);
    }
  }

  async applyManifest(namespace: string, manifestYamlPath: string): Promise<void> {
    const result = this.runner('kubectl', ['apply', '-n', namespace, '-f', manifestYamlPath]);
    if (result.status !== 0) {
      throw new Error(`kubectl apply failed for ${manifestYamlPath}: ${result.stderr}`);
    }
  }

  async getServiceSelector(namespace: string, name: string): Promise<ServiceSelectorObservation> {
    const result = this.runner('kubectl', ['get', 'service', name, '-n', namespace, '-o', 'json']);
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
    const list = runJson<KubectlList<KubectlPod>>(this.runner, [
      'get',
      'pods',
      '-n',
      namespace,
      '-l',
      selector,
    ]);
    return list.items.map(pod => ({
      name: pod.metadata.name,
      labels: pod.metadata.labels ?? {},
      phase: pod.status.phase ?? 'Unknown',
      resourceRequests: pod.spec.containers[0]?.resources?.requests,
    }));
  }

  async computeEndpoints(namespace: string, serviceName: string): Promise<EndpointsObservation> {
    const list = runJson<KubectlList<{ endpoints?: Array<{ addresses: string[] }> }>>(this.runner, [
      'get',
      'endpointslices',
      '-n',
      namespace,
      '-l',
      `kubernetes.io/service-name=${serviceName}`,
    ]);
    const addresses = list.items.flatMap(slice => slice.endpoints?.flatMap(e => e.addresses) ?? []);
    return { addresses };
  }

  async getPodResourceRequests(
    namespace: string,
    podName: string
  ): Promise<{ cpu: string; memory: string } | null> {
    const result = this.runner('kubectl', ['get', 'pod', podName, '-n', namespace, '-o', 'json']);
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
    >(this.runner, ['get', 'nodes']);
    return list.items.map(node => ({
      name: node.metadata.name,
      allocatable: node.status.allocatable ?? { cpu: '0', memory: '0' },
    }));
  }

  async getSchedulingObservation(
    namespace: string,
    podName: string
  ): Promise<SchedulingObservation> {
    const result = this.runner('kubectl', ['get', 'pod', podName, '-n', namespace, '-o', 'json']);
    if (result.status !== 0) {
      return { supported: true, condition: 'Unknown', reason: 'PodNotFound' };
    }
    const pod = JSON.parse(result.stdout) as KubectlPod;
    const scheduled = pod.status.conditions?.find(c => c.type === 'PodScheduled');
    return {
      supported: true,
      condition: scheduled?.status ?? 'Unknown',
      reason: scheduled?.reason,
      message: scheduled?.message,
    };
  }

  async deleteNamespace(namespace: string): Promise<void> {
    this.runner('kubectl', [
      'delete',
      'namespace',
      namespace,
      '--ignore-not-found',
      '--wait=false',
    ]);
  }
}
