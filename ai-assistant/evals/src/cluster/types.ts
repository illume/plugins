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

import type { ClusterProfileName } from '../contracts/types.js';

export interface PreflightResult {
  supported: boolean;
  /** Present when `supported` is false; explains which tool/mechanism is missing. */
  reason?: string;
}

export interface ServiceSelectorObservation {
  found: boolean;
  selector: Record<string, string> | null;
}

export interface PodObservation {
  name: string;
  labels: Record<string, string>;
  phase: string;
  resourceRequests?: { cpu: string; memory: string };
}

export interface EndpointsObservation {
  /** Pod IPs (or synthetic stand-ins) currently selected by the Service. */
  addresses: string[];
}

export interface NodeObservation {
  name: string;
  allocatable: { cpu: string; memory: string };
}

export interface SchedulingObservation {
  /**
   * Whether this adapter can independently prove a real scheduler decision
   * (rather than fixture-authored Pod status/Events). The simulated
   * in-memory adapter always reports `supported: false` here; only a real
   * kubectl-backed adapter against an actual control plane may report true.
   */
  supported: boolean;
  reason?: string;
  condition?: string;
  message?: string;
}

/**
 * A cluster world an eval trial can observe and mutate (Phase 1 is read-only,
 * so only `applyManifest`/`createNamespace`/`deleteNamespace` mutate, and only
 * during setup/cleanup — never from candidate-attributed calls).
 */
export interface ClusterAdapter {
  readonly profile: ClusterProfileName;
  readonly mode: 'simulated' | 'real';
  preflight(): Promise<PreflightResult>;
  createNamespace(namespace: string): Promise<void>;
  applyManifest(namespace: string, manifestYamlPath: string): Promise<void>;
  getServiceSelector(namespace: string, name: string): Promise<ServiceSelectorObservation>;
  listPodsByLabelSelector(
    namespace: string,
    labelSelector: Record<string, string>
  ): Promise<PodObservation[]>;
  computeEndpoints(namespace: string, serviceName: string): Promise<EndpointsObservation>;
  getPodResourceRequests(
    namespace: string,
    podName: string
  ): Promise<{ cpu: string; memory: string } | null>;
  listNodeAllocatable(): Promise<NodeObservation[]>;
  getSchedulingObservation(namespace: string, podName: string): Promise<SchedulingObservation>;
  deleteNamespace(namespace: string): Promise<void>;
}
