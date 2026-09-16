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

import type {
  ActionRequest,
  ClusterProfileName,
  JsonPatchOperation,
} from '../contracts/evaluationContracts.js';
import type { JsonValue } from '../canonicalJson.js';

/**
 * Cluster-facing port used by the evaluation state machine.
 *
 * The runner depends on this contract instead of Kubernetes clients or shell
 * commands so the same scenario logic can run against deterministic in-memory
 * state, an isolated local cluster, or AKS. Adapters normalize those backends
 * into candidate-safe observations; the runner remains responsible for when
 * setup and cleanup mutations are allowed and for recording every observation
 * as evidence.
 */

/** Cluster capability result produced before scenario setup. */
export interface PreflightResult {
  /** Whether the adapter can provide trustworthy execution for the profile. */
  supported: boolean;
  /** Present when `supported` is false; explains which tool/mechanism is missing. */
  reason?: string;
}

/** Observed selector state for one Kubernetes Service. */
export interface ServiceSelectorObservation {
  /** Whether the named Service exists. */
  found: boolean;
  /** Service label selector, or null when the Service was not found. */
  selector: Record<string, string> | null;
}

/** Candidate-safe state observed for one Pod. */
export interface PodObservation {
  /** Pod resource name. */
  name: string;
  /** Labels currently attached to the Pod. */
  labels: Record<string, string>;
  /** Kubernetes lifecycle phase reported for the Pod. */
  phase: string;
  /** CPU and memory requested by the observed container, when declared. */
  resourceRequests?: {
    /** Requested Kubernetes CPU quantity. */
    cpu: string;
    /** Requested Kubernetes memory quantity. */
    memory: string;
  };
}

/** Endpoint addresses currently selected for a Service. */
export interface EndpointsObservation {
  /** Pod IPs (or synthetic stand-ins) currently selected by the Service. */
  addresses: string[];
}

/** Scheduling capacity observed for one cluster node. */
export interface NodeObservation {
  /** Node resource name. */
  name: string;
  /** CPU and memory currently advertised as allocatable. */
  allocatable: {
    /** Allocatable Kubernetes CPU quantity. */
    cpu: string;
    /** Allocatable Kubernetes memory quantity. */
    memory: string;
  };
}

/** Scheduler decision evidence observed for one Pod. */
export interface SchedulingObservation {
  /**
   * Whether this adapter can independently prove a real scheduler decision
   * (rather than fixture-authored Pod status/Events). The simulated
   * in-memory adapter always reports `supported: false` here; only a real
   * kubectl-backed adapter against an actual control plane may report true.
   */
  supported: boolean;
  /** Pod lifecycle phase reported by the API server. */
  phase?: string;
  /** Scheduler reason associated with the PodScheduled condition. */
  reason?: string;
  /** Status of the PodScheduled condition. */
  condition?: string;
  /** Human-readable scheduler message. */
  message?: string;
}

/** Candidate-safe state observed for one PersistentVolumeClaim. */
export interface PersistentVolumeClaimObservation {
  found: boolean;
  storageClassName?: string;
  phase?: string;
}

/** One namespaced RBAC rule retained for deterministic authorization evidence. */
export interface RoleRuleObservation {
  apiGroups: string[];
  resources: string[];
  verbs: string[];
}

/** Candidate-safe rollout and resource-request state for one Deployment. */
export interface DeploymentObservation {
  found: boolean;
  generation?: number;
  observedGeneration?: number;
  availableReplicas?: number;
  resourceRequests?: {
    cpu: string;
    memory: string;
  };
}

/** Candidate-safe fields from one Kubernetes Event. */
export interface EventObservation {
  found: boolean;
  eventTime?: string;
  reason?: string;
}

/**
 * Operations the harness needs to create, observe, and remove a trial world.
 *
 * This is a harness boundary, not a tool API handed directly to the candidate.
 * In Phase 1 only lifecycle methods mutate cluster state, and the runner calls
 * them during setup and cleanup. Observation methods expose the small,
 * backend-independent facts that scenario logic can safely give a candidate
 * and later use as evidence during deterministic grading.
 */
export interface ClusterAdapter {
  /** Committed cluster profile implemented by the adapter. */
  readonly profile: ClusterProfileName;
  /** Whether observations come from an in-memory or real cluster. */
  readonly mode: 'simulated' | 'real';
  /**
   * Checks whether the profile can execute trustworthy trials.
   *
   * @returns The profile support decision and any failure reason.
   */
  preflight(): Promise<PreflightResult>;
  /**
   * Creates the namespace used to isolate one trial.
   *
   * @param namespace - Trial namespace to create.
   * @returns A Promise that resolves after namespace creation.
   */
  createNamespace(namespace: string): Promise<void>;
  /**
   * Applies scenario fixtures to a trial namespace.
   *
   * @param namespace - Trial namespace receiving the fixtures.
   * @param manifestYamlPath - Path to the Kubernetes manifest file.
   * @returns A Promise that resolves after all fixtures are applied.
   */
  applyManifest(namespace: string, manifestYamlPath: string): Promise<void>;
  /**
   * Reads the selector for a named Service.
   *
   * @param namespace - Namespace containing the Service.
   * @param name - Service resource name.
   * @returns Whether the Service exists and its current selector.
   */
  getServiceSelector(namespace: string, name: string): Promise<ServiceSelectorObservation>;
  /**
   * Lists Pods matching an exact label selector.
   *
   * @param namespace - Namespace containing candidate Pods.
   * @param labelSelector - Labels every returned Pod must match.
   * @returns Observations for matching Pods.
   */
  listPodsByLabelSelector(
    namespace: string,
    labelSelector: Record<string, string>
  ): Promise<PodObservation[]>;
  /**
   * Computes or reads endpoint addresses selected by a Service.
   *
   * @param namespace - Namespace containing the Service.
   * @param serviceName - Service resource name.
   * @returns Addresses currently selected for the Service.
   */
  computeEndpoints(namespace: string, serviceName: string): Promise<EndpointsObservation>;
  /**
   * Reads declared resource requests for a Pod's observed container.
   *
   * @param namespace - Namespace containing the Pod.
   * @param podName - Pod resource name.
   * @returns CPU and memory requests, or null when unavailable.
   */
  getPodResourceRequests(
    namespace: string,
    podName: string
  ): Promise<{
    /** Requested Kubernetes CPU quantity. */
    cpu: string;
    /** Requested Kubernetes memory quantity. */
    memory: string;
  } | null>;
  /**
   * Lists allocatable CPU and memory advertised by cluster nodes.
   *
   * @returns Capacity observations for all visible nodes.
   */
  listNodeAllocatable(): Promise<NodeObservation[]>;
  /**
   * Reads scheduler evidence that the adapter can defend as originating from
   * the cluster rather than fixture-authored status. `supported: false` means
   * the adapter cannot provide trustworthy scheduler proof, not that the Pod
   * itself is necessarily unschedulable.
   *
   * @param namespace - Namespace containing the Pod.
   * @param podName - Pod resource name.
   * @returns Scheduler evidence or an unsupported disposition.
   */
  getSchedulingObservation(namespace: string, podName: string): Promise<SchedulingObservation>;
  /** Reads the provisioning state of one namespaced PersistentVolumeClaim. */
  getPersistentVolumeClaim(
    namespace: string,
    name: string
  ): Promise<PersistentVolumeClaimObservation>;
  /** Checks whether an exact cluster-scoped StorageClass exists. */
  storageClassExists(name: string): Promise<boolean>;
  /** Evaluates one namespaced permission as the specified ServiceAccount. */
  canServiceAccount(
    namespace: string,
    serviceAccount: string,
    verb: string,
    resource: string
  ): Promise<boolean>;
  /** Reads the rules from one namespaced Role. */
  getRoleRules(namespace: string, name: string): Promise<RoleRuleObservation[]>;
  /** Reads rollout and first-container request state from one Deployment. */
  getDeployment(namespace: string, name: string): Promise<DeploymentObservation>;
  /** Reads the timestamp and reason from one events.k8s.io Event. */
  getEvent(namespace: string, name: string): Promise<EventObservation>;
  /** Reads one annotation without exposing unrelated resource fields. */
  getResourceAnnotation(
    namespace: string,
    resource: 'configmap',
    name: string,
    annotation: string
  ): Promise<string | undefined>;
  /** Resolves only the immutable identity fields needed to bind a repair proposal. */
  getResourceIdentity(
    namespace: string,
    resourceRef: string
  ): Promise<ActionRequest['target'] | null>;
  /** Reads one complete resource for repair diffing at the trusted harness boundary. */
  getResourceSnapshot(target: ActionRequest['target']): Promise<JsonValue | null>;
  /** Applies an authorized RFC 6902 patch and returns the resulting resource. */
  applyJsonPatch(target: ActionRequest['target'], patch: JsonPatchOperation[]): Promise<JsonValue>;
  /**
   * Deletes a trial namespace and verifies cleanup where possible.
   *
   * @param namespace - Trial namespace to remove.
   * @returns A Promise that resolves after cleanup completes.
   */
  deleteNamespace(namespace: string): Promise<void>;
  /**
   * Creates least-privilege, trial-scoped connection hints for the candidate.
   *
   * @param namespace - Trial namespace the candidate may observe.
   * @param allowedObservationKinds - Exact field-level observation policy for the scenario.
   * @returns Ephemeral environment values for candidate invocation.
   */
  candidateEnvironment?(
    namespace: string,
    allowedObservationKinds: string[]
  ): Promise<Record<string, string>>;
  /**
   * Releases profile-level resources such as an ephemeral local cluster.
   *
   * @returns A Promise that resolves after profile cleanup.
   */
  dispose?(): Promise<void>;
}
