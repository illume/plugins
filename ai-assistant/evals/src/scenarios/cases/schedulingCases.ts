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

import {
  eventually,
  measure,
  type ObservationStep,
  type ScenarioCaseLogic,
} from './caseSupport.js';

/** Converts a Kubernetes CPU quantity to cores for deterministic comparisons. */
export function parseCpuCores(quantity: string): number {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)([numkKMGTPE])?$/.exec(quantity);
  if (!match?.[1]) throw new Error(`invalid Kubernetes CPU quantity: ${quantity}`);
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
  const multiplier = multipliers[match[2] ?? ''];
  if (multiplier === undefined) throw new Error(`invalid Kubernetes CPU quantity: ${quantity}`);
  return Number(match[1]) * multiplier;
}

export const capacityCase: ScenarioCaseLogic = {
  async preflight(adapter, namespace) {
    const nodes = await adapter.listNodeAllocatable();
    const requests = await adapter.getPodResourceRequests(namespace, 'huge-pod');
    if (!requests)
      return { ok: false, reason: 'expected pod/huge-pod to declare resource requests' };
    if (nodes.some(node => parseCpuCores(node.allocatable.cpu) >= parseCpuCores(requests.cpu))) {
      return { ok: false, reason: 'expected no eligible node to fit the requested CPU; one does' };
    }
    const scheduling = await eventually(
      adapter,
      () => adapter.getSchedulingObservation(namespace, 'huge-pod'),
      value => value.condition === 'False' && value.reason === 'Unschedulable'
    );
    return scheduling.supported &&
      scheduling.condition === 'False' &&
      scheduling.reason === 'Unschedulable'
      ? { ok: true }
      : { ok: false, reason: 'real scheduler did not report the Pod as Unschedulable' };
  },
  async observe(adapter, namespace) {
    const [nodes, nodesDuration] = await measure(() => adapter.listNodeAllocatable());
    const [requests, requestsDuration] = await measure(() =>
      adapter.getPodResourceRequests(namespace, 'huge-pod')
    );
    const [scheduling, schedulingDuration] = await measure(() =>
      adapter.getSchedulingObservation(namespace, 'huge-pod')
    );
    const steps: ObservationStep[] = [
      {
        toolName: 'kubectl.get',
        operation: 'list_node_allocatable',
        targetResource: 'nodes',
        resourceRef: 'nodes',
        fieldPath: 'items',
        value: JSON.stringify(nodes.map(node => ({ name: node.name, cpu: node.allocatable.cpu }))),
        durationNs: nodesDuration,
        evidenceValues: nodes.map(node => ({
          resourceRef: `node/${node.name}`,
          fieldPath: 'status.allocatable.cpu',
          value: node.allocatable.cpu,
        })),
      },
    ];
    steps.push({
      toolName: 'kubectl.get',
      operation: 'get_pod_resource_requests',
      targetResource: 'pod/huge-pod',
      resourceRef: 'pod/huge-pod',
      fieldPath: 'spec.containers[0].resources.requests.cpu',
      value: requests ? String(parseCpuCores(requests.cpu)) : 'unknown',
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

export const pendingUnderdeterminedCase: ScenarioCaseLogic = {
  async preflight(adapter, namespace) {
    const scheduling = await eventually(
      adapter,
      () => adapter.getSchedulingObservation(namespace, 'mystery-pod'),
      value => value.phase === 'Pending' && value.condition === 'False'
    );
    if (!scheduling.supported) {
      return { ok: false, reason: scheduling.reason ?? 'scheduling mechanism unsupported' };
    }
    return scheduling.phase === 'Pending' && scheduling.condition === 'False'
      ? { ok: true }
      : { ok: false, reason: 'expected mystery-pod to be observably unscheduled and Pending' };
  },
  async observe(adapter, namespace) {
    const [scheduling, durationNs] = await measure(() =>
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
        durationNs,
      },
    ];
  },
};

export const capacityRepairCase: ScenarioCaseLogic = {
  async preflight(adapter, namespace) {
    const deployment = await adapter.getDeployment(namespace, 'cpu-hog');
    const requests = deployment.resourceRequests;
    if (!requests || requests.cpu !== '1M') {
      return { ok: false, reason: 'expected deployment/cpu-hog to request 1M CPU' };
    }
    const nodes = await adapter.listNodeAllocatable();
    if (nodes.some(node => parseCpuCores(node.allocatable.cpu) >= parseCpuCores(requests.cpu))) {
      return { ok: false, reason: 'expected the reviewed CPU request to exceed every node' };
    }
    const pods = await eventually(
      adapter,
      () => adapter.listPodsByLabelSelector(namespace, { app: 'cpu-hog' }),
      value => value.length > 0
    );
    const pod = pods[0];
    if (!pod) return { ok: false, reason: 'deployment/cpu-hog did not create a Pod' };
    const scheduling = await eventually(
      adapter,
      () => adapter.getSchedulingObservation(namespace, pod.name),
      value => value.condition === 'False' && value.reason === 'Unschedulable'
    );
    return scheduling.condition === 'False' && scheduling.reason === 'Unschedulable'
      ? { ok: true }
      : { ok: false, reason: 'real scheduler did not reject the infeasible Deployment Pod' };
  },
  async observe(adapter, namespace) {
    const [deployment, deploymentDuration] = await measure(() =>
      adapter.getDeployment(namespace, 'cpu-hog')
    );
    const [nodes, nodesDuration] = await measure(() => adapter.listNodeAllocatable());
    const pods = await adapter.listPodsByLabelSelector(namespace, { app: 'cpu-hog' });
    const pod = pods[0];
    if (!pod) throw new Error('deployment/cpu-hog has no observable Pod');
    const [scheduling, schedulingDuration] = await measure(() =>
      adapter.getSchedulingObservation(namespace, pod.name)
    );
    return [
      {
        toolName: 'kubectl.get',
        operation: 'get_deployment_resource_requests',
        targetResource: 'deployment/cpu-hog',
        resourceRef: 'deployment/cpu-hog',
        fieldPath: 'spec.template.spec.containers[0].resources.requests.cpu',
        value: deployment.resourceRequests?.cpu ?? 'unknown',
        durationNs: deploymentDuration,
      },
      {
        toolName: 'kubectl.get',
        operation: 'list_node_allocatable',
        targetResource: 'nodes',
        resourceRef: 'nodes',
        fieldPath: 'items',
        value: JSON.stringify(nodes.map(node => ({ name: node.name, cpu: node.allocatable.cpu }))),
        durationNs: nodesDuration,
        evidenceValues: nodes.map(node => ({
          resourceRef: `node/${node.name}`,
          fieldPath: 'status.allocatable.cpu',
          value: node.allocatable.cpu,
        })),
      },
      {
        toolName: 'kubectl.get',
        operation: 'get_scheduling_condition',
        targetResource: `pod/${pod.name}`,
        resourceRef: 'pod/cpu-hog',
        fieldPath: 'status.conditions.PodScheduled.reason',
        value: scheduling.reason ?? 'Unknown',
        durationNs: schedulingDuration,
      },
    ];
  },
};
