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
import type { ClusterAdapter } from '../../cluster/clusterAdapter.js';

async function observeSelector(
  adapter: ClusterAdapter,
  namespace: string,
  summarizeEndpoints: boolean
): Promise<ObservationStep[]> {
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
  steps.push({
    toolName: 'kubectl.get',
    operation: 'list_pod_labels',
    targetResource: 'pods?labelSelector=app%3Dweb',
    resourceRef: 'pods',
    fieldPath: 'items',
    value: JSON.stringify(pods.map(pod => ({ name: pod.name, labels: pod.labels }))),
    durationNs: podsDuration,
    evidenceValues: pods.map(pod => ({
      resourceRef: `pod/${pod.name}`,
      fieldPath: 'metadata.labels',
      value: JSON.stringify(pod.labels),
    })),
  });
  steps.push({
    toolName: 'kubectl.get',
    operation: 'get_endpointslice',
    targetResource: 'endpointslice/web',
    resourceRef: 'endpointslice/web',
    fieldPath: summarizeEndpoints ? 'endpoints.count' : 'endpoints',
    value: summarizeEndpoints
      ? String(endpoints.addresses.length)
      : JSON.stringify(endpoints.addresses),
    durationNs: endpointsDuration,
  });
  return steps;
}

export const selectorFaultCase: ScenarioCaseLogic = {
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
    return pods.some(pod => pod.phase === 'Running')
      ? { ok: true }
      : { ok: false, reason: 'expected at least one Running pod matching app=web' };
  },
  async observe(adapter, namespace) {
    return observeSelector(adapter, namespace, false);
  },
};

export const selectorHealthyCase: ScenarioCaseLogic = {
  async preflight(adapter, namespace) {
    const endpoints = await eventually(
      adapter,
      () => adapter.computeEndpoints(namespace, 'web'),
      value => value.addresses.length > 0
    );
    return endpoints.addresses.length > 0
      ? { ok: true }
      : { ok: false, reason: 'expected non-empty EndpointSlice addresses for the healthy twin' };
  },
  async observe(adapter, namespace) {
    return observeSelector(adapter, namespace, true);
  },
};
