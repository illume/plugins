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
 * Per-scenario preflight and observation logic.
 *
 * Each scenario's `preflight` proves the declared precondition actually holds
 * in the applied cluster world (for example, that the selected Service truly
 * has zero endpoints) before any candidate ever runs — a preflight failure
 * means the fixture/harness is broken, not that the candidate failed.
 * `observe` performs the same real queries a candidate could reasonably make
 * and returns them as ordered steps the runner turns into both trajectory
 * tool-call events and retrieved-observation records.
 */

import type { ClusterAdapter } from '../cluster/types.js';

export interface ObservationStep {
  toolName: string;
  operation: string;
  targetResource: string;
  resourceRef: string;
  fieldPath: string;
  value: string;
}

export interface PreflightOutcome {
  ok: boolean;
  reason?: string;
}

export interface ScenarioCaseLogic {
  preflight(adapter: ClusterAdapter, namespace: string): Promise<PreflightOutcome>;
  observe(adapter: ClusterAdapter, namespace: string): Promise<ObservationStep[]>;
}

const selectorFaultCase: ScenarioCaseLogic = {
  async preflight(adapter, namespace) {
    const endpoints = await adapter.computeEndpoints(namespace, 'web');
    if (endpoints.addresses.length !== 0) {
      return {
        ok: false,
        reason: 'expected zero EndpointSlice addresses for service/web, found some',
      };
    }
    const pods = await adapter.listPodsByLabelSelector(namespace, { app: 'web' });
    if (!pods.some(p => p.phase === 'Running')) {
      return { ok: false, reason: 'expected at least one Running pod matching app=web' };
    }
    return { ok: true };
  },
  async observe(adapter, namespace) {
    const selector = await adapter.getServiceSelector(namespace, 'web');
    const pods = await adapter.listPodsByLabelSelector(namespace, { app: 'web' });
    const endpoints = await adapter.computeEndpoints(namespace, 'web');
    const steps: ObservationStep[] = [
      {
        toolName: 'kubectl.get',
        operation: 'get_service_selector',
        targetResource: 'service/web',
        resourceRef: 'service/web',
        fieldPath: 'spec.selector',
        value: JSON.stringify(selector.selector ?? {}),
      },
    ];
    for (const pod of pods) {
      steps.push({
        toolName: 'kubectl.get',
        operation: 'get_pod_labels',
        targetResource: `pod/${pod.name}`,
        resourceRef: `pod/${pod.name}`,
        fieldPath: 'metadata.labels',
        value: JSON.stringify(pod.labels),
      });
    }
    steps.push({
      toolName: 'kubectl.get',
      operation: 'get_endpointslice',
      targetResource: 'endpointslice/web',
      resourceRef: 'endpointslice/web',
      fieldPath: 'endpoints',
      value: JSON.stringify(endpoints.addresses),
    });
    return steps;
  },
};

const selectorHealthyCase: ScenarioCaseLogic = {
  async preflight(adapter, namespace) {
    const endpoints = await adapter.computeEndpoints(namespace, 'web');
    if (endpoints.addresses.length === 0) {
      return {
        ok: false,
        reason: 'expected non-empty EndpointSlice addresses for the healthy twin',
      };
    }
    return { ok: true };
  },
  observe: selectorFaultCase.observe,
};

const capacityCase: ScenarioCaseLogic = {
  async preflight(adapter, namespace) {
    const nodes = await adapter.listNodeAllocatable();
    const requests = await adapter.getPodResourceRequests(namespace, 'huge-pod');
    if (!requests)
      return { ok: false, reason: 'expected pod/huge-pod to declare resource requests' };
    const fits = nodes.some(n => parseInt(n.allocatable.cpu, 10) >= parseInt(requests.cpu, 10));
    if (fits) {
      return { ok: false, reason: 'expected no eligible node to fit the requested CPU; one does' };
    }
    return { ok: true };
  },
  async observe(adapter, namespace) {
    const nodes = await adapter.listNodeAllocatable();
    const requests = await adapter.getPodResourceRequests(namespace, 'huge-pod');
    const scheduling = await adapter.getSchedulingObservation(namespace, 'huge-pod');
    const steps: ObservationStep[] = nodes.map(n => ({
      toolName: 'kubectl.get',
      operation: 'get_node_allocatable',
      targetResource: `node/${n.name}`,
      resourceRef: `node/${n.name}`,
      fieldPath: 'status.allocatable.cpu',
      value: n.allocatable.cpu,
    }));
    steps.push({
      toolName: 'kubectl.get',
      operation: 'get_pod_resource_requests',
      targetResource: 'pod/huge-pod',
      resourceRef: 'pod/huge-pod',
      fieldPath: 'spec.containers[0].resources.requests.cpu',
      value: requests?.cpu ?? 'unknown',
    });
    if (scheduling.supported) {
      steps.push({
        toolName: 'kubectl.get',
        operation: 'get_scheduling_condition',
        targetResource: 'pod/huge-pod',
        resourceRef: 'pod/huge-pod',
        fieldPath: 'status.conditions[PodScheduled].reason',
        value: scheduling.reason ?? 'Unknown',
      });
    }
    return steps;
  },
};

const pendingUnderdeterminedCase: ScenarioCaseLogic = {
  async preflight(adapter, namespace) {
    const scheduling = await adapter.getSchedulingObservation(namespace, 'mystery-pod');
    if (!scheduling.supported) {
      return { ok: false, reason: scheduling.reason ?? 'scheduling mechanism unsupported' };
    }
    return { ok: true };
  },
  async observe(adapter, namespace) {
    const scheduling = await adapter.getSchedulingObservation(namespace, 'mystery-pod');
    return [
      {
        toolName: 'kubectl.get',
        operation: 'get_pod_phase',
        targetResource: 'pod/mystery-pod',
        resourceRef: 'pod/mystery-pod',
        fieldPath: 'status.phase',
        value: 'Pending',
      },
      {
        toolName: 'kubectl.get',
        operation: 'get_scheduling_condition',
        targetResource: 'pod/mystery-pod',
        resourceRef: 'pod/mystery-pod',
        fieldPath: 'status.conditions[PodScheduled].reason',
        value: scheduling.reason ?? 'withheld',
      },
    ];
  },
};

const registry: Record<string, ScenarioCaseLogic> = {
  'core-service-selector-fault-v1': selectorFaultCase,
  'core-service-selector-healthy-v1': selectorHealthyCase,
  'core-unschedulable-capacity-v1': capacityCase,
  'core-pending-underdetermined-v1': pendingUnderdeterminedCase,
};

export function caseLogicFor(scenarioId: string): ScenarioCaseLogic {
  const logic = registry[scenarioId];
  if (!logic) throw new Error(`no case logic registered for scenario ${scenarioId}`);
  return logic;
}
