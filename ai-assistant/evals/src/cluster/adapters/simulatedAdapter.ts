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
 * An in-memory, deterministic cluster world used as the default offline test
 * path.
 *
 * `computeEndpoints` performs a genuine (if simplified) implementation of the
 * Kubernetes EndpointSlice controller's selection rule — it matches the
 * applied Service's `spec.selector` against applied Pod labels within the
 * namespace and returns only Pods with `phase: Running` — rather than
 * returning a fixture-authored answer. This is why `endpointslice-controller`
 * is listed as a KWOK-proven mechanism in
 * `contracts/kwokCompatibility.ts`: the behavior is derived from the applied
 * objects, not hard-coded per scenario.
 *
 * `getSchedulingObservation` always reports `supported: false` here: no
 * matter how it's dressed up, a fixture reporting "the scheduler decided X"
 * without an actual scheduler is exactly the invalid substitution the
 * implementation-phases document warns against. Real scheduling proof
 * requires the real `KubectlClusterAdapter` and, until KWOK's scheduler
 * mechanism is independently proved, only the Minikube profile.
 */

import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import type { ClusterProfileName } from '../../contracts/evaluationContracts.js';
import type {
  ClusterAdapter,
  EndpointsObservation,
  NodeObservation,
  PodObservation,
  PreflightResult,
  SchedulingObservation,
  ServiceSelectorObservation,
} from '../clusterAdapter.js';

/** Minimal Kubernetes object shape retained by the in-memory world. */
interface K8sObject {
  /** Kubernetes API group and version, when declared by the fixture. */
  apiVersion?: string;
  /** Kubernetes resource kind. */
  kind: string;
  /** Resource identity, namespace, and labels. */
  metadata: {
    /** Kubernetes resource name. */
    name: string;
    /** Namespace assigned when the fixture is applied. */
    namespace?: string;
    /** Labels attached to the resource. */
    labels?: Record<string, string>;
  };
  /** Unstructured desired-state fields used by simulated observations. */
  spec?: Record<string, unknown>;
  /** Unstructured runtime-state fields supplied by the fixture. */
  status?: Record<string, unknown>;
}

/**
 * Checks whether labels satisfy every entry in an exact-match selector.
 *
 * @param labels - Labels attached to a candidate resource.
 * @param selector - Required label names and values.
 * @returns Whether every selector entry matches the resource labels.
 */
function matchesSelector(
  labels: Record<string, string>,
  selector: Record<string, string>
): boolean {
  return Object.entries(selector).every(([key, value]) => labels[key] === value);
}

/** Deterministic in-memory adapter for offline KWOK-compatible scenarios. */
export class SimulatedKwokAdapter implements ClusterAdapter {
  /** Marks observations as originating from deterministic simulation. */
  readonly mode = 'simulated' as const;
  /** Kubernetes fixtures currently retained by the simulated world. */
  private objects: K8sObject[] = [];

  /**
   * Creates an empty simulated cluster world for a profile.
   *
   * @param profile - Cluster profile represented by the adapter.
   */
  constructor(readonly profile: ClusterProfileName) {}

  /**
   * Reports that the dependency-free simulated world is available.
   *
   * @returns A supported preflight result.
   */
  async preflight(): Promise<PreflightResult> {
    return { supported: true };
  }

  /**
   * Accepts namespace setup without creating a standalone namespace object.
   *
   * @param _namespace - Trial namespace represented on subsequently applied objects.
   * @returns A Promise that resolves immediately.
   */
  async createNamespace(_namespace: string): Promise<void> {
    // The in-memory world has no namespace object to create; objects already
    // carry their namespace from the applied manifest.
  }

  /**
   * Loads Kubernetes fixtures into the in-memory trial namespace.
   *
   * @param namespace - Trial namespace assigned to loaded resources.
   * @param manifestYamlPath - Path to the multi-document Kubernetes YAML.
   * @returns A Promise that resolves after fixtures enter the simulated world.
   */
  async applyManifest(namespace: string, manifestYamlPath: string): Promise<void> {
    const text = readFileSync(manifestYamlPath, 'utf8');
    const docs = yaml.loadAll(text) as K8sObject[];
    for (const doc of docs) {
      if (!doc || !doc.kind) continue;
      doc.metadata.namespace = namespace;
      this.objects.push(doc);
    }
  }

  /**
   * Finds one retained resource by namespace, kind, and name.
   *
   * @param namespace - Namespace containing the resource.
   * @param kind - Kubernetes resource kind.
   * @param name - Resource name.
   * @returns The matching object, or undefined when absent.
   */
  private find(namespace: string, kind: string, name: string): K8sObject | undefined {
    return this.objects.find(
      o => o.kind === kind && o.metadata.namespace === namespace && o.metadata.name === name
    );
  }

  /**
   * Reads the selector from a retained Service fixture.
   *
   * @param namespace - Namespace containing the Service.
   * @param name - Service resource name.
   * @returns Whether the Service exists and its selector.
   */
  async getServiceSelector(namespace: string, name: string): Promise<ServiceSelectorObservation> {
    const svc = this.find(namespace, 'Service', name);
    if (!svc) return { found: false, selector: null };
    return { found: true, selector: (svc.spec?.selector as Record<string, string>) ?? {} };
  }

  /**
   * Lists retained Pods that satisfy an exact label selector.
   *
   * @param namespace - Namespace containing candidate Pods.
   * @param labelSelector - Labels every returned Pod must match.
   * @returns Candidate-safe observations for matching Pod fixtures.
   */
  async listPodsByLabelSelector(
    namespace: string,
    labelSelector: Record<string, string>
  ): Promise<PodObservation[]> {
    return this.objects
      .filter(o => o.kind === 'Pod' && o.metadata.namespace === namespace)
      .filter(o => matchesSelector(o.metadata.labels ?? {}, labelSelector))
      .map(o => this.toPodObservation(o));
  }

  /**
   * Projects a retained Pod fixture into candidate-safe observation fields.
   *
   * @param o - Pod object loaded from a scenario manifest.
   * @returns The normalized Pod observation.
   */
  private toPodObservation(o: K8sObject): PodObservation {
    const containers = (o.spec?.containers as Array<Record<string, unknown>>) ?? [];
    const requests = containers[0]?.resources as
      | { requests?: { cpu: string; memory: string } }
      | undefined;
    return {
      name: o.metadata.name,
      labels: o.metadata.labels ?? {},
      phase: (o.status?.phase as string) ?? 'Unknown',
      resourceRequests: requests?.requests,
    };
  }

  /**
   * Computes Service endpoints from selectors and running Pod fixtures.
   *
   * @param namespace - Namespace containing the Service and Pods.
   * @param serviceName - Service resource name.
   * @returns Addresses of running Pods selected by the Service.
   */
  async computeEndpoints(namespace: string, serviceName: string): Promise<EndpointsObservation> {
    const svc = this.find(namespace, 'Service', serviceName);
    if (!svc) return { addresses: [] };
    const selector = (svc.spec?.selector as Record<string, string>) ?? {};
    const addresses = this.objects
      .filter(o => o.kind === 'Pod' && o.metadata.namespace === namespace)
      .filter(o => matchesSelector(o.metadata.labels ?? {}, selector))
      .filter(o => (o.status?.phase as string) === 'Running')
      .map((o, i) => (o.status?.podIP as string) ?? `10.0.0.${i + 1}`);
    return { addresses };
  }

  /**
   * Reads declared CPU and memory requests from a retained Pod fixture.
   *
   * @param namespace - Namespace containing the Pod.
   * @param podName - Pod resource name.
   * @returns Declared requests, or null when unavailable.
   */
  async getPodResourceRequests(
    namespace: string,
    podName: string
  ): Promise<{ cpu: string; memory: string } | null> {
    const pod = this.find(namespace, 'Pod', podName);
    if (!pod) return null;
    return this.toPodObservation(pod).resourceRequests ?? null;
  }

  /**
   * Lists allocatable CPU and memory from retained Node fixtures.
   *
   * @returns Capacity observations for every simulated node.
   */
  async listNodeAllocatable(): Promise<NodeObservation[]> {
    return this.objects
      .filter(o => o.kind === 'Node')
      .map(o => ({
        name: o.metadata.name,
        allocatable: (o.status?.allocatable as { cpu: string; memory: string }) ?? {
          cpu: '0',
          memory: '0',
        },
      }));
  }

  /**
   * Declines to fabricate scheduler evidence from fixture-authored status.
   *
   * @param _namespace - Namespace containing the Pod under investigation.
   * @param _podName - Pod resource name under investigation.
   * @returns An unsupported disposition explaining the simulation limit.
   */
  async getSchedulingObservation(
    _namespace: string,
    _podName: string
  ): Promise<SchedulingObservation> {
    return {
      supported: false,
      reason:
        'The simulated adapter cannot independently prove a real scheduler decision; ' +
        'run this case with the real KubectlClusterAdapter against local-minikube or aks.',
    };
  }

  /**
   * Removes every retained object assigned to a trial namespace.
   *
   * @param namespace - Trial namespace to clear.
   * @returns A Promise that resolves after in-memory cleanup.
   */
  async deleteNamespace(namespace: string): Promise<void> {
    this.objects = this.objects.filter(o => o.metadata.namespace !== namespace);
  }
}
