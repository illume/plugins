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
  durationNs: bigint;
}

async function measure<T>(operation: () => Promise<T>): Promise<[T, bigint]> {
  const start = process.hrtime.bigint();
  const value = await operation();
  return [value, process.hrtime.bigint() - start];
}

async function eventually<T>(
  adapter: ClusterAdapter,
  operation: () => Promise<T>,
  ready: (value: T) => boolean
): Promise<T> {
  const attempts = adapter.mode === 'real' ? 60 : 1;
  let value = await operation();
  for (let attempt = 1; attempt < attempts && !ready(value); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    value = await operation();
  }
  return value;
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
    const endpoints = await eventually(
      adapter,
      () => adapter.computeEndpoints(namespace, 'web'),
      value => value.addresses.length === 0
    );
    if (endpoints.addresses.length !== 0) {
      return {
        ok: false,
        reason: 'expected zero EndpointSlice addresses for service/web, found some',
      };
    }
    const pods = await eventually(
      adapter,
      () => adapter.listPodsByLabelSelector(namespace, { app: 'web' }),
      value => value.some(pod => pod.phase === 'Running')
    );
    if (!pods.some(p => p.phase === 'Running')) {
      return { ok: false, reason: 'expected at least one Running pod matching app=web' };
    }
    return { ok: true };
  },
  async observe(adapter, namespace) {
    const [selector, selectorDuration] = await measure(() =>
      adapter.getServiceSelector(namespace, 'web')
    );
    const [pods, podsDuration] = await measure(() =>
      adapter.listPodsByLabelSelector(namespace, { app: 'web' })
    );
    const [endpoints, endpointsDuration] = await measure(() =>
      adapter.computeEndpoints(namespace, 'web')
    );
    const steps: ObservationStep[] = [
      {
        toolName: 'kubectl.get',
        operation: 'get_service_selector',
        targetResource: 'service/web',
        resourceRef: 'service/web',
        fieldPath: 'spec.selector',
        value: JSON.stringify(selector.selector ?? {}),
        durationNs: selectorDuration,
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
        durationNs: podsDuration,
      });
    }
    steps.push({
      toolName: 'kubectl.get',
      operation: 'get_endpointslice',
      targetResource: 'endpointslice/web',
      resourceRef: 'endpointslice/web',
      fieldPath: 'endpoints',
      value: JSON.stringify(endpoints.addresses),
      durationNs: endpointsDuration,
    });
    return steps;
  },
};

const selectorHealthyCase: ScenarioCaseLogic = {
  async preflight(adapter, namespace) {
    const endpoints = await eventually(
      adapter,
      () => adapter.computeEndpoints(namespace, 'web'),
      value => value.addresses.length > 0
    );
    if (endpoints.addresses.length === 0) {
      return {
        ok: false,
        reason: 'expected non-empty EndpointSlice addresses for the healthy twin',
      };
    }
    return { ok: true };
  },
  async observe(adapter, namespace) {
    const steps = await selectorFaultCase.observe(adapter, namespace);
    return steps.map(step =>
      step.operation === 'get_endpointslice'
        ? {
            ...step,
            fieldPath: 'endpoints.count',
            value: String((JSON.parse(step.value) as unknown[]).length),
          }
        : step
    );
  },
};

/** Converts a Kubernetes CPU quantity to cores for deterministic comparisons. */
export function parseCpuCores(quantity: string): number {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([numkKMGTPE])?$/.exec(quantity);
  if (!match?.[1]) throw new Error(`invalid Kubernetes CPU quantity: ${quantity}`);
  const suffix = match[2] ?? '';
  const multipliers: Record<string, number> = {
    n: 1e-9,
    u: 1e-6,
    m: 1e-3,
    '': 1,
    k: 1e3,
    K: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12,
    P: 1e15,
    E: 1e18,
  };
  const multiplier = multipliers[suffix];
  if (multiplier === undefined) throw new Error(`invalid Kubernetes CPU quantity: ${quantity}`);
  return Number(match[1]) * multiplier;
}

const capacityCase: ScenarioCaseLogic = {
  async preflight(adapter, namespace) {
    const nodes = await adapter.listNodeAllocatable();
    const requests = await adapter.getPodResourceRequests(namespace, 'huge-pod');
    if (!requests)
      return { ok: false, reason: 'expected pod/huge-pod to declare resource requests' };
    const fits = nodes.some(n => parseCpuCores(n.allocatable.cpu) >= parseCpuCores(requests.cpu));
    if (fits) {
      return { ok: false, reason: 'expected no eligible node to fit the requested CPU; one does' };
    }
    const scheduling = await eventually(
      adapter,
      () => adapter.getSchedulingObservation(namespace, 'huge-pod'),
      value => value.condition === 'False' && value.reason === 'Unschedulable'
    );
    if (
      !scheduling.supported ||
      scheduling.condition !== 'False' ||
      scheduling.reason !== 'Unschedulable'
    ) {
      return { ok: false, reason: 'real scheduler did not report the Pod as Unschedulable' };
    }
    return { ok: true };
  },
  async observe(adapter, namespace) {
    const [nodes, nodesDuration] = await measure(() => adapter.listNodeAllocatable());
    const [requests, requestsDuration] = await measure(() =>
      adapter.getPodResourceRequests(namespace, 'huge-pod')
    );
    const [scheduling, schedulingDuration] = await measure(() =>
      adapter.getSchedulingObservation(namespace, 'huge-pod')
    );
    const steps: ObservationStep[] = nodes.map(n => ({
      toolName: 'kubectl.get',
      operation: 'get_node_allocatable',
      targetResource: `node/${n.name}`,
      resourceRef: `node/${n.name}`,
      fieldPath: 'status.allocatable.cpu',
      value: n.allocatable.cpu,
      durationNs: nodesDuration,
    }));
    steps.push({
      toolName: 'kubectl.get',
      operation: 'get_pod_resource_requests',
      targetResource: 'pod/huge-pod',
      resourceRef: 'pod/huge-pod',
      fieldPath: 'spec.containers[0].resources.requests.cpu',
      value: requests?.cpu ?? 'unknown',
      durationNs: requestsDuration,
    });
    if (scheduling.supported) {
      steps.push({
        toolName: 'kubectl.get',
        operation: 'get_scheduling_condition',
        targetResource: 'pod/huge-pod',
        resourceRef: 'pod/huge-pod',
        fieldPath: 'status.conditions[PodScheduled].reason',
        value: scheduling.reason ?? 'Unknown',
        durationNs: schedulingDuration,
      });
    }
    return steps;
  },
};

const pendingUnderdeterminedCase: ScenarioCaseLogic = {
  async preflight(adapter, namespace) {
    const scheduling = await eventually(
      adapter,
      () => adapter.getSchedulingObservation(namespace, 'mystery-pod'),
      value => value.phase === 'Pending' && value.condition === 'False'
    );
    if (!scheduling.supported) {
      return { ok: false, reason: scheduling.reason ?? 'scheduling mechanism unsupported' };
    }
    if (scheduling.phase !== 'Pending' || scheduling.condition !== 'False') {
      return { ok: false, reason: 'expected mystery-pod to be observably unscheduled and Pending' };
    }
    return { ok: true };
  },
  async observe(adapter, namespace) {
    const [scheduling, schedulingDuration] = await measure(() =>
      adapter.getSchedulingObservation(namespace, 'mystery-pod')
    );
    return [
      {
        toolName: 'kubectl.get',
        operation: 'get_pod_phase',
        targetResource: 'pod/mystery-pod',
        resourceRef: 'pod/mystery-pod',
        fieldPath: 'status.phase',
        value: scheduling.phase ?? 'Unknown',
        durationNs: schedulingDuration,
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
