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

import { eventually, measure, type ScenarioCaseLogic } from './caseSupport.js';

export const staleEventHealthyCase: ScenarioCaseLogic = {
  async preflight(adapter, namespace) {
    const deployment = await eventually(
      adapter,
      () => adapter.getDeployment(namespace, 'web'),
      value =>
        value.generation !== undefined &&
        value.observedGeneration === value.generation &&
        value.availableReplicas === 1
    );
    const event = await adapter.getEvent(namespace, 'web-old-failure');
    return deployment.observedGeneration === deployment.generation &&
      deployment.availableReplicas === 1 &&
      event.eventTime === '2025-01-01T00:00:00Z'
      ? { ok: true }
      : { ok: false, reason: 'current rollout and stale Event did not reach the qualified state' };
  },
  async observe(adapter, namespace) {
    const [deployment, deploymentDuration] = await measure(() =>
      adapter.getDeployment(namespace, 'web')
    );
    const [event, eventDuration] = await measure(() =>
      adapter.getEvent(namespace, 'web-old-failure')
    );
    return [
      {
        toolName: 'kubectl.get',
        operation: 'get_deployment_status',
        targetResource: 'deployment/web',
        resourceRef: 'deployment/web',
        fieldPath: 'status.observedGeneration',
        value: String(deployment.observedGeneration ?? 'unknown'),
        durationNs: deploymentDuration,
        evidenceValues: [
          {
            resourceRef: 'deployment/web',
            fieldPath: 'metadata.generation',
            value: String(deployment.generation ?? 'unknown'),
          },
          {
            resourceRef: 'deployment/web',
            fieldPath: 'status.observedGeneration',
            value: String(deployment.observedGeneration ?? 'unknown'),
          },
          {
            resourceRef: 'deployment/web',
            fieldPath: 'status.availableReplicas',
            value: String(deployment.availableReplicas ?? 0),
          },
        ],
      },
      {
        toolName: 'kubectl.get',
        operation: 'get_event',
        targetResource: 'event/web-old-failure',
        resourceRef: 'event/web-old-failure',
        fieldPath: 'eventTime',
        value: event.eventTime ?? 'unknown',
        durationNs: eventDuration,
        evidenceValues: [
          {
            resourceRef: 'event/web-old-failure',
            fieldPath: 'eventTime',
            value: event.eventTime ?? 'unknown',
          },
          {
            resourceRef: 'event/web-old-failure',
            fieldPath: 'reason',
            value: event.reason ?? 'unknown',
          },
        ],
      },
    ];
  },
};
