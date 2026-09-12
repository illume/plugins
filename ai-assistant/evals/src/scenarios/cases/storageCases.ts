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

const missingStorageClass = 'headlamp-eval-archive-missing-v1';

export const missingStorageClassCase: ScenarioCaseLogic = {
  async preflight(adapter, namespace) {
    const claim = await eventually(
      adapter,
      () => adapter.getPersistentVolumeClaim(namespace, 'archive'),
      value => value.phase === 'Pending'
    );
    if (
      !claim.found ||
      claim.phase !== 'Pending' ||
      claim.storageClassName !== missingStorageClass
    ) {
      return { ok: false, reason: 'expected archive PVC to remain Pending on the missing class' };
    }
    return (await adapter.storageClassExists(missingStorageClass))
      ? { ok: false, reason: `expected StorageClass ${missingStorageClass} to be absent` }
      : { ok: true };
  },
  async observe(adapter, namespace) {
    const [claim, claimDuration] = await measure(() =>
      adapter.getPersistentVolumeClaim(namespace, 'archive')
    );
    const [classExists, classDuration] = await measure(() =>
      adapter.storageClassExists(missingStorageClass)
    );
    return [
      {
        toolName: 'kubectl.get',
        operation: 'get_pvc',
        targetResource: 'persistentvolumeclaim/archive',
        resourceRef: 'persistentvolumeclaim/archive',
        fieldPath: 'spec.storageClassName',
        value: claim.storageClassName ?? 'unknown',
        durationNs: claimDuration,
        evidenceValues: [
          {
            resourceRef: 'persistentvolumeclaim/archive',
            fieldPath: 'spec.storageClassName',
            value: claim.storageClassName ?? 'unknown',
          },
          {
            resourceRef: 'persistentvolumeclaim/archive',
            fieldPath: 'status.phase',
            value: claim.phase ?? 'Unknown',
          },
        ],
      },
      {
        toolName: 'kubectl.get',
        operation: 'get_storageclass',
        targetResource: `storageclass/${missingStorageClass}`,
        resourceRef: `storageclass/${missingStorageClass}`,
        fieldPath: 'exists',
        value: String(classExists),
        durationNs: classDuration,
      },
    ];
  },
};

export const healthyStorageClassCase: ScenarioCaseLogic = {
  async preflight(adapter, namespace) {
    const claim = await eventually(
      adapter,
      () => adapter.getPersistentVolumeClaim(namespace, 'archive'),
      value => value.phase === 'Bound'
    );
    return claim.found && claim.phase === 'Bound'
      ? { ok: true }
      : { ok: false, reason: 'expected archive PVC to become Bound' };
  },
  async observe(adapter, namespace) {
    const [claim, durationNs] = await measure(() =>
      adapter.getPersistentVolumeClaim(namespace, 'archive')
    );
    return [
      {
        toolName: 'kubectl.get',
        operation: 'get_pvc',
        targetResource: 'persistentvolumeclaim/archive',
        resourceRef: 'persistentvolumeclaim/archive',
        fieldPath: 'status.phase',
        value: claim.phase ?? 'Unknown',
        durationNs,
        evidenceValues: [
          {
            resourceRef: 'persistentvolumeclaim/archive',
            fieldPath: 'status.phase',
            value: claim.phase ?? 'Unknown',
          },
          {
            resourceRef: 'persistentvolumeclaim/archive',
            fieldPath: 'spec.storageClassName',
            value: claim.storageClassName ?? 'unknown',
          },
        ],
      },
    ];
  },
};
