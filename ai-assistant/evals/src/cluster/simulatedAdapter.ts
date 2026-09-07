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
import type { ClusterProfileName } from '../contracts/types.js';
import type {
  ClusterAdapter,
  EndpointsObservation,
  NodeObservation,
  PodObservation,
  PreflightResult,
  SchedulingObservation,
  ServiceSelectorObservation,
} from './types.js';

interface K8sObject {
  apiVersion?: string;
  kind: string;
  metadata: { name: string; namespace?: string; labels?: Record<string, string> };
  spec?: Record<string, unknown>;
  status?: Record<string, unknown>;
}

function matchesSelector(
  labels: Record<string, string>,
  selector: Record<string, string>
): boolean {
  return Object.entries(selector).every(([key, value]) => labels[key] === value);
}

export class SimulatedKwokAdapter implements ClusterAdapter {
  readonly mode = 'simulated' as const;
  private objects: K8sObject[] = [];

  constructor(readonly profile: ClusterProfileName) {}

  async preflight(): Promise<PreflightResult> {
    return { supported: true };
  }

  async createNamespace(_namespace: string): Promise<void> {
    // The in-memory world has no namespace object to create; objects already
    // carry their namespace from the applied manifest.
  }

  async applyManifest(namespace: string, manifestYamlPath: string): Promise<void> {
    const text = readFileSync(manifestYamlPath, 'utf8');
    const docs = yaml.loadAll(text) as K8sObject[];
    for (const doc of docs) {
      if (!doc || !doc.kind) continue;
      doc.metadata.namespace = namespace;
      this.objects.push(doc);
    }
  }

  private find(namespace: string, kind: string, name: string): K8sObject | undefined {
    return this.objects.find(
      o => o.kind === kind && o.metadata.namespace === namespace && o.metadata.name === name
    );
  }

  async getServiceSelector(namespace: string, name: string): Promise<ServiceSelectorObservation> {
    const svc = this.find(namespace, 'Service', name);
    if (!svc) return { found: false, selector: null };
    return { found: true, selector: (svc.spec?.selector as Record<string, string>) ?? {} };
  }

  async listPodsByLabelSelector(
    namespace: string,
    labelSelector: Record<string, string>
  ): Promise<PodObservation[]> {
    return this.objects
      .filter(o => o.kind === 'Pod' && o.metadata.namespace === namespace)
      .filter(o => matchesSelector(o.metadata.labels ?? {}, labelSelector))
      .map(o => this.toPodObservation(o));
  }

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

  async getPodResourceRequests(
    namespace: string,
    podName: string
  ): Promise<{ cpu: string; memory: string } | null> {
    const pod = this.find(namespace, 'Pod', podName);
    if (!pod) return null;
    return this.toPodObservation(pod).resourceRequests ?? null;
  }

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

  async deleteNamespace(namespace: string): Promise<void> {
    this.objects = this.objects.filter(o => o.metadata.namespace !== namespace);
  }
}
