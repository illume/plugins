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
 * Shared Kubernetes operations for adapters that drive `kubectl` through an
 * injectable `CommandRunner`. Backend subclasses own preflight and disposal,
 * preventing one cluster type from inheriting another type's lifecycle.
 */

import type { ActionRequest, ClusterProfileName } from '../../contracts/evaluationContracts.js';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { CommandRunner } from '../commandRunner.js';
import type {
  ClusterAdapter,
  DeploymentObservation,
  EndpointsObservation,
  EventObservation,
  NodeObservation,
  PersistentVolumeClaimObservation,
  PodObservation,
  PreflightResult,
  RoleRuleObservation,
  SchedulingObservation,
  ServiceSelectorObservation,
} from '../clusterAdapter.js';

/** Subset of a kubectl Pod response used by evaluation observations. */
interface KubectlPod {
  /** Pod identity and labels. */
  metadata: {
    /** Pod resource name. */
    name: string;
    /** Labels attached to the Pod. */
    labels?: Record<string, string>;
  };
  /** Container resource configuration needed for request observations. */
  spec: {
    /** Containers declared by the Pod. */
    containers: Array<{
      /** Resource requirements declared by the container. */
      resources?: {
        /** CPU and memory requested by the container. */
        requests?: {
          /** Requested Kubernetes CPU quantity. */
          cpu: string;
          /** Requested Kubernetes memory quantity. */
          memory: string;
        };
      };
    }>;
  };
  /** Runtime phase, address, and scheduling conditions. */
  status: {
    /** Kubernetes lifecycle phase reported for the Pod. */
    phase?: string;
    /** Pod IP assigned by the cluster. */
    podIP?: string;
    /** Runtime conditions reported for the Pod. */
    conditions?: Array<{
      /** Kubernetes condition type. */
      type: string;
      /** Current condition status. */
      status: string;
      /** Machine-readable reason for the condition. */
      reason?: string;
      /** Human-readable detail associated with the condition. */
      message?: string;
    }>;
  };
}

/** Generic item envelope returned by kubectl list operations. */
interface KubectlList<T> {
  /** Resources returned by the list query. */
  items: T[];
}

/**
 * Runs a kubectl query and parses its JSON response.
 *
 * @param runner - Command boundary used to invoke kubectl.
 * @param args - Kubectl arguments before the output-format flags.
 * @returns The parsed kubectl response.
 */
function runJson<T>(runner: CommandRunner, args: string[]): T {
  const result = runner('kubectl', [...args, '-o', 'json']);
  if (result.status !== 0) {
    throw new Error(`kubectl ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as T;
}

/** Common operations for real kubectl-backed cluster adapters. */
export abstract class KubectlClusterAdapter implements ClusterAdapter {
  /** Marks observations as originating from real command execution. */
  readonly mode = 'real' as const;
  /** Stable name of the isolated or caller-provided cluster. */
  protected readonly clusterName: string;
  /** Kubeconfig used for every kubectl operation. */
  protected readonly kubeconfigPath: string;
  /**
   * Creates a kubectl adapter for a profile and cluster isolation context.
   *
   * @param profile - Cluster profile represented by this adapter.
   * @param runner - Injectable command boundary for kubectl and kwokctl.
   * @param isolation - Optional caller-provided cluster name and kubeconfig path.
   */
  constructor(
    readonly profile: ClusterProfileName,
    protected readonly runner: CommandRunner,
    isolation?: { clusterName: string; kubeconfigPath: string }
  ) {
    this.clusterName = isolation?.clusterName ?? `headlamp-evals-${process.pid}`;
    this.kubeconfigPath =
      isolation?.kubeconfigPath ?? path.join(tmpdir(), `${this.clusterName}.kubeconfig`);
  }

  /**
   * Prefixes kubectl arguments with the adapter's isolated kubeconfig.
   *
   * @param args - Operation-specific kubectl arguments.
   * @returns Arguments pinned to this adapter's kubeconfig.
   */
  protected kubectl(args: string[]): string[] {
    return ['--kubeconfig', this.kubeconfigPath, ...args];
  }

  /**
   * Keeps field-level scenario policies at the harness boundary.
   *
   * Kubernetes RBAC authorizes whole resources, so a raw kubeconfig could expose
   * fields outside `allowedObservationKinds`. Candidates receive only the
   * observations supplied by the harness until a field-filtering tool boundary
   * is available.
   */
  async candidateEnvironment(
    _namespace: string,
    _allowedObservationKinds: string[]
  ): Promise<Record<string, string>> {
    return {};
  }

  /** Verifies and prepares the concrete backend before trials run. */
  abstract preflight(): Promise<PreflightResult>;

  /**
   * Creates a namespace for one isolated evaluation trial.
   *
   * @param namespace - Trial namespace to create.
   * @returns A Promise that resolves after namespace creation.
   */
  async createNamespace(namespace: string): Promise<void> {
    const result = this.runner('kubectl', this.kubectl(['create', 'namespace', namespace]));
    if (result.status !== 0 && !/already exists/.test(result.stderr)) {
      throw new Error(`failed to create namespace ${namespace}: ${result.stderr}`);
    }
  }

  /**
   * Applies scenario fixtures to a trial namespace with kubectl.
   *
   * @param namespace - Trial namespace receiving the fixtures.
   * @param manifestYamlPath - Path to the Kubernetes manifest file.
   * @returns A Promise that resolves after kubectl applies the manifest.
   */
  async applyManifest(namespace: string, manifestYamlPath: string): Promise<void> {
    const result = this.runner(
      'kubectl',
      this.kubectl(['apply', '-n', namespace, '-f', manifestYamlPath])
    );
    if (result.status !== 0) {
      throw new Error(`kubectl apply failed for ${manifestYamlPath}: ${result.stderr}`);
    }
  }

  /**
   * Reads the selector from a named Service.
   *
   * @param namespace - Namespace containing the Service.
   * @param name - Service resource name.
   * @returns Whether the Service exists and its current selector.
   */
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

  /**
   * Lists Pods matching an exact label selector through kubectl.
   *
   * @param namespace - Namespace containing candidate Pods.
   * @param labelSelector - Labels every returned Pod must match.
   * @returns Candidate-safe observations for matching Pods.
   */
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

  /**
   * Reads endpoint addresses from the Service's EndpointSlices.
   *
   * @param namespace - Namespace containing the Service.
   * @param serviceName - Service resource name.
   * @returns Addresses currently selected for the Service.
   */
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

  /**
   * Reads declared CPU and memory requests for a Pod's first container.
   *
   * @param namespace - Namespace containing the Pod.
   * @param podName - Pod resource name.
   * @returns Declared requests, or null when the Pod or requests are unavailable.
   */
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

  /**
   * Lists allocatable CPU and memory reported by cluster nodes.
   *
   * @returns Capacity observations for every visible node.
   */
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

  /**
   * Reads Pod phase and PodScheduled condition evidence from the API server.
   *
   * @param namespace - Namespace containing the Pod.
   * @param podName - Pod resource name.
   * @returns Scheduler evidence derived from the Pod status.
   */
  async getSchedulingObservation(
    namespace: string,
    podName: string
  ): Promise<SchedulingObservation> {
    const result = this.runner(
      'kubectl',
      this.kubectl(['get', 'pod', podName, '-n', namespace, '-o', 'json'])
    );
    if (result.status !== 0) {
      throw new Error(
        `failed to observe scheduling for pod/${podName}: ${result.stderr || result.stdout}`
      );
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

  async getPersistentVolumeClaim(
    namespace: string,
    name: string
  ): Promise<PersistentVolumeClaimObservation> {
    const result = this.runner(
      'kubectl',
      this.kubectl(['get', 'persistentvolumeclaim', name, '-n', namespace, '-o', 'json'])
    );
    if (result.status !== 0) return { found: false };
    const claim = JSON.parse(result.stdout) as {
      spec?: { storageClassName?: string };
      status?: { phase?: string };
    };
    return {
      found: true,
      storageClassName: claim.spec?.storageClassName,
      phase: claim.status?.phase,
    };
  }

  async storageClassExists(name: string): Promise<boolean> {
    const result = this.runner(
      'kubectl',
      this.kubectl(['get', 'storageclass', name, '-o', 'name'])
    );
    if (result.status === 0) return true;
    if (/\bnotfound\b|\bnot found\b/i.test(`${result.stderr}\n${result.stdout}`)) return false;
    throw new Error(`failed to check storageclass/${name}: ${result.stderr || result.stdout}`);
  }

  async canServiceAccount(
    namespace: string,
    serviceAccount: string,
    verb: string,
    resource: string
  ): Promise<boolean> {
    const result = this.runner(
      'kubectl',
      this.kubectl([
        'auth',
        'can-i',
        verb,
        resource,
        '-n',
        namespace,
        '--as',
        `system:serviceaccount:${namespace}:${serviceAccount}`,
      ])
    );
    const decision = result.stdout.trim();
    if (decision === 'yes') return true;
    if (decision === 'no') return false;
    throw new Error(
      `failed to authorize serviceaccount/${serviceAccount}: ${result.stderr || result.stdout}`
    );
  }

  async getRoleRules(namespace: string, name: string): Promise<RoleRuleObservation[]> {
    const role = runJson<{ rules?: RoleRuleObservation[] }>(
      this.runner,
      this.kubectl(['get', 'role', name, '-n', namespace])
    );
    return (role.rules ?? []).map(rule => ({
      apiGroups: rule.apiGroups ?? [],
      resources: rule.resources ?? [],
      verbs: rule.verbs ?? [],
    }));
  }

  async getDeployment(namespace: string, name: string): Promise<DeploymentObservation> {
    const result = this.runner(
      'kubectl',
      this.kubectl(['get', 'deployment', name, '-n', namespace, '-o', 'json'])
    );
    if (result.status !== 0) return { found: false };
    const deployment = JSON.parse(result.stdout) as {
      metadata?: { generation?: number };
      spec?: {
        template?: {
          spec?: {
            containers?: Array<{
              resources?: { requests?: { cpu: string; memory: string } };
            }>;
          };
        };
      };
      status?: { observedGeneration?: number; availableReplicas?: number };
    };
    return {
      found: true,
      generation: deployment.metadata?.generation,
      observedGeneration: deployment.status?.observedGeneration,
      availableReplicas: deployment.status?.availableReplicas ?? 0,
      resourceRequests: deployment.spec?.template?.spec?.containers?.[0]?.resources?.requests,
    };
  }

  async getEvent(namespace: string, name: string): Promise<EventObservation> {
    const result = this.runner(
      'kubectl',
      this.kubectl(['get', 'events.events.k8s.io', name, '-n', namespace, '-o', 'json'])
    );
    if (result.status !== 0) return { found: false };
    const event = JSON.parse(result.stdout) as { eventTime?: string; reason?: string };
    return { found: true, eventTime: event.eventTime, reason: event.reason };
  }

  async getResourceAnnotation(
    namespace: string,
    resource: 'configmap',
    name: string,
    annotation: string
  ): Promise<string | undefined> {
    const result = this.runner(
      'kubectl',
      this.kubectl(['get', resource, name, '-n', namespace, '-o', 'json'])
    );
    if (result.status !== 0) return undefined;
    const object = JSON.parse(result.stdout) as {
      metadata?: { annotations?: Record<string, string> };
    };
    return object.metadata?.annotations?.[annotation];
  }

  async getResourceIdentity(
    namespace: string,
    resourceRef: string
  ): Promise<ActionRequest['target'] | null> {
    const [resource, name, extra] = resourceRef.split('/');
    if (!resource || !name || extra) throw new Error(`invalid resource ref: ${resourceRef}`);
    const result = this.runner(
      'kubectl',
      this.kubectl(['get', resource, name, '-n', namespace, '-o', 'json'])
    );
    if (result.status !== 0) return null;
    const object = JSON.parse(result.stdout) as {
      apiVersion: string;
      kind: string;
      metadata: { namespace?: string; name: string; uid: string };
    };
    return {
      api_version: object.apiVersion,
      kind: object.kind,
      namespace: object.metadata.namespace ?? namespace,
      name: object.metadata.name,
      uid: object.metadata.uid,
    };
  }

  /**
   * Deletes a trial namespace and its candidate kubeconfig.
   *
   * @param namespace - Trial namespace to remove.
   * @returns A Promise that resolves after deletion is verified and local credentials are removed.
   */
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
    }
  }

  /** Releases resources owned by the concrete backend. */
  abstract dispose(): Promise<void>;
}
