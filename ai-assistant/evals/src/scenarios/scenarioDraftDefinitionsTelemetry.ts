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

import type { ScenarioDraftDefinition } from './scenarioDraftDefinition.js';
import { fixtureCsrRequest } from './scenarioFixtureCrypto.js';

const busyboxImage = 'registry.k8s.io/e2e-test-images/busybox:1.29-4';
const pauseImage = 'registry.k8s.io/pause:3.10';

const fact = (
  fact_id: string,
  resource_ref: string,
  field_path: string,
  observed_value: string,
  description: string
) => ({ fact_id, resource_ref, field_path, observed_value, description });

const liveDefinition = (
  definition: Omit<ScenarioDraftDefinition, 'supportedClusterProfiles'>
): ScenarioDraftDefinition => ({
  ...definition,
  supportedClusterProfiles: ['local-minikube', 'aks'],
});

const syntheticNode = (
  name: string,
  readyStatus: 'False' | 'Unknown',
  readyReason: string,
  memoryPressure = false
) => ({
  apiVersion: 'v1',
  kind: 'Node',
  metadata: {
    name,
    labels: { 'scenario-eval.example/synthetic-node': 'true' },
  },
  spec: {
    unschedulable: true,
    taints: [{ key: 'scenario-eval.example/synthetic-node', effect: 'NoSchedule' }],
  },
  status: {
    capacity: { cpu: '1', memory: '1Gi', pods: '10' },
    allocatable: { cpu: '1', memory: '1Gi', pods: '10' },
    conditions: [
      {
        type: 'MemoryPressure',
        status: memoryPressure ? 'True' : 'False',
        reason: memoryPressure ? 'KubeletHasInsufficientMemory' : 'KubeletHasSufficientMemory',
        lastHeartbeatTime: '2026-09-20T00:00:00Z',
        lastTransitionTime: '2026-09-20T00:00:00Z',
      },
      {
        type: 'DiskPressure',
        status: 'False',
        reason: 'KubeletHasNoDiskPressure',
        lastHeartbeatTime: '2026-09-20T00:00:00Z',
        lastTransitionTime: '2026-09-20T00:00:00Z',
      },
      {
        type: 'PIDPressure',
        status: 'False',
        reason: 'KubeletHasSufficientPID',
        lastHeartbeatTime: '2026-09-20T00:00:00Z',
        lastTransitionTime: '2026-09-20T00:00:00Z',
      },
      {
        type: 'Ready',
        status: readyStatus,
        reason: readyReason,
        message: 'The isolated synthetic node has no serving kubelet heartbeat.',
        lastHeartbeatTime: '2026-09-20T00:00:00Z',
        lastTransitionTime: '2026-09-20T00:00:00Z',
      },
    ],
  },
});

const persistentVolumeClaim = (name: string, storage = '64Mi') => ({
  apiVersion: 'v1',
  kind: 'PersistentVolumeClaim',
  metadata: { name },
  spec: {
    accessModes: ['ReadWriteOnce'],
    resources: { requests: { storage } },
  },
});

export const telemetryScenarioDraftDefinitions: ScenarioDraftDefinition[] = [
  liveDefinition({
    scenarioId: 'rule-gap-pod-crash-loop',
    title: 'Pod repeatedly crashes and backs off',
    description:
      'A restarting container exits immediately, allowing kubelet status and restart telemetry to establish a sustained CrashLoopBackOff.',
    taskPrompt:
      'Diagnose why Pod `crash-loop` cannot remain available. Correlate its current waiting reason, last termination, restart-count change, and recent Events over the observation window. Do not mutate resources.',
    visibleResourceRefs: [
      'pod/crash-loop',
      'event/*?involvedObject.kind=Pod&involvedObject.name=crash-loop',
      'metric/kube_pod_container_status_restarts_total{pod="crash-loop",container="app"}',
    ],
    observationKinds: ['pod.status', 'pod.events', 'container.logs.previous', 'metric.range'],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'crash-loop', labels: { app: 'crash-loop' } },
        spec: {
          restartPolicy: 'Always',
          containers: [
            {
              name: 'app',
              image: busyboxImage,
              command: ['/bin/sh', '-c', 'echo intentional-crash >&2; exit 42'],
            },
          ],
        },
      },
    ],
    acceptedFacts: [
      fact(
        'crash-loop-waiting-reason',
        'pod/crash-loop',
        'status.containerStatuses[?(@.name=="app")].state.waiting.reason',
        'CrashLoopBackOff',
        'Kubelet is backing off repeated restarts of the application container.'
      ),
      fact(
        'crash-loop-last-exit',
        'pod/crash-loop',
        'status.containerStatuses[?(@.name=="app")].lastState.terminated.exitCode',
        '42',
        'The previous application process exited with the fixture failure code.'
      ),
      fact(
        'crash-loop-restarts-increase',
        'metric/kube_pod_container_status_restarts_total{pod="crash-loop",container="app"}',
        'increase[10m]',
        '> 0',
        'The native restart counter increases during the bounded observation window.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-stable-running-container',
        'pod/crash-loop',
        'status.containerStatuses[?(@.name=="app")].state.running',
        '<present continuously for 10m>',
        'The container does not remain Running through the observation window.'
      ),
      fact(
        'invented-zero-restarts',
        'metric/kube_pod_container_status_restarts_total{pod="crash-loop",container="app"}',
        'increase[10m]',
        '0',
        'The restart counter is not stable.'
      ),
    ],
    requiredMechanisms: ['api-server', 'kubelet'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-pod-containers-not-ready',
    title: 'Pod containers remain not ready',
    description:
      'A running container has a readiness probe against an unopened port, keeping Pod readiness false while kubelet continues probing it.',
    taskPrompt:
      'Diagnose why Pod `not-ready` remains unavailable even though its container is running. Correlate Pod conditions, container readiness, probe Events, and readiness telemetry for at least five minutes. Do not mutate resources.',
    visibleResourceRefs: [
      'pod/not-ready',
      'event/*?involvedObject.kind=Pod&involvedObject.name=not-ready',
      'metric/kube_pod_status_ready{pod="not-ready",condition="true"}',
    ],
    observationKinds: ['pod.spec', 'pod.status', 'pod.events', 'metric.range'],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'not-ready', labels: { app: 'not-ready' } },
        spec: {
          containers: [
            {
              name: 'app',
              image: pauseImage,
              readinessProbe: {
                httpGet: { path: '/ready', port: 18080 },
                periodSeconds: 2,
                failureThreshold: 1,
              },
            },
          ],
        },
      },
    ],
    acceptedFacts: [
      fact(
        'pod-ready-condition-false',
        'pod/not-ready',
        'status.conditions[?(@.type=="Ready")].status',
        'False',
        'The Pod Ready condition is false.'
      ),
      fact(
        'container-ready-false',
        'pod/not-ready',
        'status.containerStatuses[?(@.name=="app")].ready',
        'false',
        'The application container remains not ready.'
      ),
      fact(
        'readiness-signal-absent',
        'metric/kube_pod_status_ready{pod="not-ready",condition="true"}',
        'max_over_time[5m]',
        '0',
        'Native readiness telemetry never reports the Pod ready during the window.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-container-crash',
        'pod/not-ready',
        'status.containerStatuses[?(@.name=="app")].state.waiting.reason',
        'CrashLoopBackOff',
        'The container is running; its failing readiness probe is the fault.'
      ),
      fact(
        'invented-ready-condition',
        'pod/not-ready',
        'status.conditions[?(@.type=="Ready")].status',
        'True',
        'The Pod does not become Ready.'
      ),
    ],
    requiredMechanisms: ['api-server', 'kubelet'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-pod-evicted',
    title: 'Pod is evicted under local storage pressure',
    description:
      'A writer exceeds its container ephemeral-storage limit, causing kubelet to evict the Pod and publish the native terminal status and eviction telemetry.',
    taskPrompt:
      'Diagnose why Pod `storage-pressure` terminated. Correlate its resource limit, terminal reason and message, eviction Event, and native eviction-status telemetry. Distinguish eviction from an application crash and do not mutate resources.',
    visibleResourceRefs: [
      'pod/storage-pressure',
      'event/*?involvedObject.kind=Pod&involvedObject.name=storage-pressure',
      'metric/kube_pod_status_reason{pod="storage-pressure",reason="Evicted"}',
    ],
    observationKinds: ['pod.spec', 'pod.status', 'pod.events', 'metric.range'],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'storage-pressure', labels: { app: 'storage-pressure' } },
        spec: {
          restartPolicy: 'Never',
          containers: [
            {
              name: 'writer',
              image: busyboxImage,
              command: [
                '/bin/sh',
                '-c',
                'dd if=/dev/zero of=/scratch/fill bs=1M count=32; sleep 3600',
              ],
              resources: {
                requests: { 'ephemeral-storage': '1Mi' },
                limits: { 'ephemeral-storage': '4Mi' },
              },
              volumeMounts: [{ name: 'scratch', mountPath: '/scratch' }],
            },
          ],
          volumes: [{ name: 'scratch', emptyDir: {} }],
        },
      },
    ],
    acceptedFacts: [
      fact(
        'pod-evicted',
        'pod/storage-pressure',
        'status.reason',
        'Evicted',
        'Kubelet terminated the Pod through eviction.'
      ),
      fact(
        'ephemeral-storage-limit-exceeded',
        'pod/storage-pressure',
        'status.message',
        '<contains: ephemeral local storage>',
        'The terminal message attributes eviction to local ephemeral-storage usage.'
      ),
      fact(
        'evicted-status-sustained',
        'metric/kube_pod_status_reason{pod="storage-pressure",reason="Evicted"}',
        'max_over_time[2m]',
        '1',
        'Native Pod status telemetry records the Evicted reason in the same observation window.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-oom-kill',
        'pod/storage-pressure',
        'status.containerStatuses[?(@.name=="writer")].lastState.terminated.reason',
        'OOMKilled',
        'The fixture exceeds ephemeral storage, not memory.'
      ),
      fact(
        'invented-success',
        'pod/storage-pressure',
        'status.phase',
        'Succeeded',
        'The writer does not complete successfully.'
      ),
    ],
    requiredMechanisms: ['api-server', 'scheduler', 'kubelet'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-node-not-ready',
    title: 'Node remains NotReady',
    description:
      'An isolated synthetic Node advertises a failed Ready condition and cannot host workloads, without disturbing a real worker node.',
    taskPrompt:
      'Diagnose why synthetic Node `telemetry-not-ready` is unavailable. Correlate its Ready condition, heartbeat age, scheduling taint, and native node-status telemetry. Do not diagnose any real worker and do not mutate resources.',
    visibleResourceRefs: [
      'node/telemetry-not-ready',
      'lease/telemetry-not-ready',
      'metric/kube_node_status_condition{node="telemetry-not-ready",condition="Ready",status="false"}',
    ],
    observationKinds: ['node.spec', 'node.status', 'lease.status', 'metric.range'],
    setup: [syntheticNode('telemetry-not-ready', 'False', 'KubeletNotReady')],
    acceptedFacts: [
      fact(
        'node-ready-false',
        'node/telemetry-not-ready',
        'status.conditions[?(@.type=="Ready")].status',
        'False',
        'The synthetic Node explicitly reports Ready=False.'
      ),
      fact(
        'node-not-ready-metric',
        'metric/kube_node_status_condition{node="telemetry-not-ready",condition="Ready",status="false"}',
        'min_over_time[10m]',
        '1',
        'Native node-condition telemetry remains in the NotReady state for the window.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-node-ready',
        'node/telemetry-not-ready',
        'status.conditions[?(@.type=="Ready")].status',
        'True',
        'The synthetic Node does not report Ready=True.'
      ),
      fact(
        'invented-workload-pressure',
        'node/telemetry-not-ready',
        'status.conditions[?(@.type=="MemoryPressure")].status',
        'True',
        'The fixture reports no memory pressure; readiness itself is the fault.'
      ),
    ],
    requiredMechanisms: ['api-server', 'kubelet', 'operator-reconciliation'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-node-unreachable',
    title: 'Node is unreachable',
    description:
      'An isolated synthetic Node has no serving kubelet or Lease renewal, allowing node lifecycle reconciliation to expose an Unknown Ready condition safely.',
    taskPrompt:
      'Diagnose why synthetic Node `telemetry-unreachable` is unreachable. Correlate Ready status and reason, missing Lease renewal, heartbeat age, and native node telemetry. Distinguish unreachable from explicit Ready=False and do not mutate resources.',
    visibleResourceRefs: [
      'node/telemetry-unreachable',
      'lease/telemetry-unreachable',
      'metric/kube_node_status_condition{node="telemetry-unreachable",condition="Ready",status="unknown"}',
    ],
    observationKinds: ['node.status', 'lease.status', 'metric.range'],
    setup: [syntheticNode('telemetry-unreachable', 'Unknown', 'NodeStatusUnknown')],
    acceptedFacts: [
      fact(
        'node-ready-unknown',
        'node/telemetry-unreachable',
        'status.conditions[?(@.type=="Ready")].status',
        'Unknown',
        'The control plane cannot establish a current Ready state for the synthetic Node.'
      ),
      fact(
        'node-status-unknown-reason',
        'node/telemetry-unreachable',
        'status.conditions[?(@.type=="Ready")].reason',
        'NodeStatusUnknown',
        'The Ready reason identifies lost node status updates.'
      ),
      fact(
        'node-lease-not-renewed',
        'lease/telemetry-unreachable',
        'spec.renewTime',
        '<absent or older than node-monitor-grace-period>',
        'No current kubelet Lease supports reachability.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-node-ready-false',
        'node/telemetry-unreachable',
        'status.conditions[?(@.type=="Ready")].status',
        'False',
        'The fault is an Unknown status caused by lost contact, not an explicit NotReady report.'
      ),
      fact(
        'invented-current-lease',
        'lease/telemetry-unreachable',
        'spec.renewTime',
        '<within node-monitor-grace-period>',
        'The synthetic Node has no current Lease renewal.'
      ),
    ],
    requiredMechanisms: ['api-server', 'kubelet', 'operator-reconciliation'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-node-pressure',
    title: 'Node reports sustained resource pressure',
    description:
      'An isolated synthetic Node reports MemoryPressure without consuming resources on a real worker, producing native condition telemetry over a bounded window.',
    taskPrompt:
      'Diagnose the sustained pressure condition on synthetic Node `telemetry-pressure`. Identify the exact pressure type and correlate its condition transition with native node-condition telemetry. Do not attribute unrelated disk or PID pressure and do not mutate resources.',
    visibleResourceRefs: [
      'node/telemetry-pressure',
      'metric/kube_node_status_condition{node="telemetry-pressure",condition="MemoryPressure",status="true"}',
    ],
    observationKinds: ['node.status', 'metric.range'],
    setup: [syntheticNode('telemetry-pressure', 'False', 'KubeletNotReady', true)],
    acceptedFacts: [
      fact(
        'memory-pressure-true',
        'node/telemetry-pressure',
        'status.conditions[?(@.type=="MemoryPressure")].status',
        'True',
        'The synthetic Node reports active memory pressure.'
      ),
      fact(
        'memory-pressure-sustained',
        'metric/kube_node_status_condition{node="telemetry-pressure",condition="MemoryPressure",status="true"}',
        'min_over_time[10m]',
        '1',
        'Native condition telemetry remains asserted throughout the window.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-disk-pressure',
        'node/telemetry-pressure',
        'status.conditions[?(@.type=="DiskPressure")].status',
        'True',
        'DiskPressure is false in the fixture.'
      ),
      fact(
        'invented-memory-pressure-clear',
        'node/telemetry-pressure',
        'status.conditions[?(@.type=="MemoryPressure")].status',
        'False',
        'MemoryPressure is the asserted condition.'
      ),
    ],
    requiredMechanisms: ['api-server', 'kubelet'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-kubelet-unhealthy',
    title: 'Kubelet health check fails',
    description:
      'An isolated synthetic Node has no kubelet endpoint or heartbeat, producing a down scrape target and unreachable node status without stopping a real kubelet.',
    taskPrompt:
      'Diagnose the node-agent failure for synthetic Node `telemetry-kubelet-down`. Correlate the kubelet health endpoint result, scrape availability, Node Ready reason, and Lease freshness. Do not mutate resources.',
    visibleResourceRefs: [
      'node/telemetry-kubelet-down',
      'lease/telemetry-kubelet-down',
      'metric/up{job="kubelet",node="telemetry-kubelet-down"}',
    ],
    observationKinds: ['node.status', 'lease.status', 'kubelet.health', 'metric.range'],
    setup: [syntheticNode('telemetry-kubelet-down', 'Unknown', 'NodeStatusUnknown')],
    acceptedFacts: [
      fact(
        'kubelet-target-down',
        'metric/up{job="kubelet",node="telemetry-kubelet-down"}',
        'max_over_time[15m]',
        '0',
        'The native kubelet scrape target is continuously unavailable.'
      ),
      fact(
        'kubelet-health-fails',
        'node/telemetry-kubelet-down',
        'proxy/healthz',
        '<connection failure>',
        'The synthetic Node has no serving kubelet health endpoint.'
      ),
      fact(
        'kubelet-node-status-unknown',
        'node/telemetry-kubelet-down',
        'status.conditions[?(@.type=="Ready")].reason',
        'NodeStatusUnknown',
        'Missing kubelet status updates make the Node unreachable.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-kubelet-up',
        'metric/up{job="kubelet",node="telemetry-kubelet-down"}',
        'min_over_time[15m]',
        '1',
        'The kubelet target is not healthy during the window.'
      ),
      fact(
        'invented-current-kubelet-lease',
        'lease/telemetry-kubelet-down',
        'spec.renewTime',
        '<within node-monitor-grace-period>',
        'No kubelet renews the synthetic Node Lease.'
      ),
    ],
    requiredMechanisms: ['api-server', 'kubelet', 'operator-reconciliation'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-persistent-volume-phase-errors',
    title: 'PersistentVolume enters an error phase',
    description:
      'A dedicated CSI PersistentVolume carries a terminal Failed phase, providing native object status and volume-state telemetry without using a surveyed diagnostic tool.',
    taskPrompt:
      'Diagnose the storage lifecycle failure for PersistentVolume `telemetry-failed-pv`. Correlate its phase, status message, claim reference, and native volume-phase telemetry. Distinguish the failure from a healthy Bound volume and do not mutate resources.',
    visibleResourceRefs: [
      'persistentvolume/telemetry-failed-pv',
      'persistentvolumeclaim/telemetry-failed-claim',
      'metric/kube_persistentvolume_status_phase{persistentvolume="telemetry-failed-pv",phase="Failed"}',
    ],
    observationKinds: [
      'persistentvolume.spec',
      'persistentvolume.status',
      'pvc.status',
      'metric.range',
    ],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolume',
        metadata: { name: 'telemetry-failed-pv' },
        spec: {
          capacity: { storage: '1Gi' },
          accessModes: ['ReadWriteOnce'],
          persistentVolumeReclaimPolicy: 'Retain',
          storageClassName: 'telemetry-failed-csi',
          claimRef: { name: 'telemetry-failed-claim' },
          csi: {
            driver: 'missing.telemetry.storage.example',
            volumeHandle: 'telemetry-failed-volume',
          },
        },
        status: {
          phase: 'Failed',
          reason: 'VolumePluginUnavailable',
          message: 'CSI driver missing.telemetry.storage.example is unavailable',
        },
      },
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'telemetry-failed-claim' },
        spec: {
          accessModes: ['ReadWriteOnce'],
          storageClassName: 'telemetry-failed-csi',
          volumeName: 'telemetry-failed-pv',
          resources: { requests: { storage: '1Gi' } },
        },
      },
    ],
    acceptedFacts: [
      fact(
        'persistent-volume-failed',
        'persistentvolume/telemetry-failed-pv',
        'status.phase',
        'Failed',
        'The PersistentVolume is in the terminal Failed phase.'
      ),
      fact(
        'persistent-volume-driver-unavailable',
        'persistentvolume/telemetry-failed-pv',
        'status.reason',
        'VolumePluginUnavailable',
        'The volume status identifies its unavailable CSI implementation.'
      ),
      fact(
        'persistent-volume-failed-metric',
        'metric/kube_persistentvolume_status_phase{persistentvolume="telemetry-failed-pv",phase="Failed"}',
        'min_over_time[5m]',
        '1',
        'Native volume-phase telemetry remains Failed through the window.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-persistent-volume-bound',
        'persistentvolume/telemetry-failed-pv',
        'status.phase',
        'Bound',
        'The fixture volume is not healthy and Bound.'
      ),
      fact(
        'invented-working-csi-driver',
        'persistentvolume/telemetry-failed-pv',
        'spec.csi.driver',
        '<registered CSI driver>',
        'The specified CSI driver is intentionally absent.'
      ),
    ],
    requiredMechanisms: ['api-server', 'csi', 'operator-reconciliation'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-persistent-volume-claim-phase-errors',
    title: 'PersistentVolumeClaim remains Pending',
    description:
      'A Pod requires a claim whose StorageClass has no provisioner, causing the native volume binder and scheduler to keep the claim and consumer Pending.',
    taskPrompt:
      'Diagnose why Pod `pending-claim-consumer` cannot start and PersistentVolumeClaim `pending-claim` does not bind. Correlate the claim phase, StorageClass lookup, Pod scheduling status, and Events. Do not mutate resources.',
    visibleResourceRefs: [
      'persistentvolumeclaim/pending-claim',
      'storageclass/telemetry-missing-provisioner',
      'pod/pending-claim-consumer',
      'event/*?involvedObject.name=pending-claim',
    ],
    observationKinds: [
      'pvc.spec',
      'pvc.status',
      'storageclass.get',
      'pod.status',
      'resource.events',
    ],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'pending-claim' },
        spec: {
          storageClassName: 'telemetry-missing-provisioner',
          accessModes: ['ReadWriteOnce'],
          resources: { requests: { storage: '1Gi' } },
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'pending-claim-consumer' },
        spec: {
          containers: [
            {
              name: 'app',
              image: pauseImage,
              volumeMounts: [{ name: 'data', mountPath: '/data' }],
            },
          ],
          volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'pending-claim' } }],
        },
      },
    ],
    acceptedFacts: [
      fact(
        'claim-pending',
        'persistentvolumeclaim/pending-claim',
        'status.phase',
        'Pending',
        'The required claim does not reach Bound.'
      ),
      fact(
        'claim-storage-class-absent',
        'storageclass/telemetry-missing-provisioner',
        'metadata.name',
        '<not found>',
        'The claim names a StorageClass that does not exist.'
      ),
      fact(
        'consumer-unschedulable',
        'pod/pending-claim-consumer',
        'status.conditions[?(@.type=="PodScheduled")].reason',
        'Unschedulable',
        'The scheduler cannot place a Pod with an unbound immediate claim.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-claim-bound',
        'persistentvolumeclaim/pending-claim',
        'status.phase',
        'Bound',
        'No volume binds to the claim.'
      ),
      fact(
        'invented-consumer-running',
        'pod/pending-claim-consumer',
        'status.phase',
        'Running',
        'The consumer cannot start while its claim is unbound.'
      ),
    ],
    requiredMechanisms: ['api-server', 'scheduler', 'csi', 'operator-reconciliation'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-persistent-volume-filling-up',
    title: 'PersistentVolume is filling up',
    description:
      'A bounded writer fills most of a dynamically provisioned claim, driving kubelet volume-capacity telemetry toward exhaustion without touching unrelated storage.',
    taskPrompt:
      'Assess capacity risk for PersistentVolumeClaim `bytes-filling`. Correlate claim binding, filesystem capacity and available-byte trends, and the writer Pod. Report whether predicted free bytes cross the exhaustion threshold; do not mutate resources.',
    visibleResourceRefs: [
      'persistentvolumeclaim/bytes-filling',
      'pod/bytes-filler',
      'metric/kubelet_volume_stats_available_bytes{persistentvolumeclaim="bytes-filling"}',
      'metric/kubelet_volume_stats_capacity_bytes{persistentvolumeclaim="bytes-filling"}',
    ],
    observationKinds: [
      'pvc.status',
      'pod.status',
      'pod.logs',
      'metric.range',
      'metric.predict_linear',
    ],
    setup: [
      persistentVolumeClaim('bytes-filling'),
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'bytes-filler' },
        spec: {
          restartPolicy: 'Never',
          containers: [
            {
              name: 'writer',
              image: busyboxImage,
              command: [
                '/bin/sh',
                '-c',
                'dd if=/dev/zero of=/data/fill bs=1M count=60 conv=fsync; sleep 3600',
              ],
              volumeMounts: [{ name: 'data', mountPath: '/data' }],
            },
          ],
          volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'bytes-filling' } }],
        },
      },
    ],
    acceptedFacts: [
      fact(
        'bytes-claim-bound',
        'persistentvolumeclaim/bytes-filling',
        'status.phase',
        'Bound',
        'The measured claim is attached and available to the writer.'
      ),
      fact(
        'volume-free-bytes-low',
        'metric/kubelet_volume_stats_available_bytes{persistentvolumeclaim="bytes-filling"}',
        'latest / kubelet_volume_stats_capacity_bytes',
        '< 0.10',
        'Less than ten percent of measured volume capacity remains available.'
      ),
      fact(
        'volume-free-bytes-exhaustion-predicted',
        'metric/kubelet_volume_stats_available_bytes{persistentvolumeclaim="bytes-filling"}',
        'predict_linear[6h,4d]',
        '< 0',
        'The native available-byte trend predicts exhaustion within four days.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-volume-capacity-healthy',
        'metric/kubelet_volume_stats_available_bytes{persistentvolumeclaim="bytes-filling"}',
        'latest / kubelet_volume_stats_capacity_bytes',
        '> 0.20',
        'The measured free-capacity ratio is not healthy.'
      ),
      fact(
        'invented-claim-pending',
        'persistentvolumeclaim/bytes-filling',
        'status.phase',
        'Pending',
        'The capacity signal comes from a Bound mounted claim.'
      ),
    ],
    requiredMechanisms: ['api-server', 'scheduler', 'kubelet', 'csi'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-persistent-volume-inodes-filling-up',
    title: 'PersistentVolume inodes are filling up',
    description:
      'A bounded writer creates many small files on a dynamically provisioned claim, driving native kubelet inode telemetry toward exhaustion.',
    taskPrompt:
      'Assess inode exhaustion risk for PersistentVolumeClaim `inodes-filling`. Correlate claim binding, free and total inode trends, and the file-writer Pod. Distinguish inode pressure from byte-capacity pressure and do not mutate resources.',
    visibleResourceRefs: [
      'persistentvolumeclaim/inodes-filling',
      'pod/inode-filler',
      'metric/kubelet_volume_stats_inodes_free{persistentvolumeclaim="inodes-filling"}',
      'metric/kubelet_volume_stats_inodes{persistentvolumeclaim="inodes-filling"}',
    ],
    observationKinds: [
      'pvc.status',
      'pod.status',
      'pod.logs',
      'metric.range',
      'metric.predict_linear',
    ],
    setup: [
      persistentVolumeClaim('inodes-filling', '128Mi'),
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'inode-filler' },
        spec: {
          restartPolicy: 'Never',
          containers: [
            {
              name: 'writer',
              image: busyboxImage,
              command: [
                '/bin/sh',
                '-c',
                'i=0; while [ "$i" -lt 50000 ]; do : > "/data/file-$i" || break; i=$((i+1)); done; echo "created=$i"; sleep 3600',
              ],
              volumeMounts: [{ name: 'data', mountPath: '/data' }],
            },
          ],
          volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'inodes-filling' } }],
        },
      },
    ],
    acceptedFacts: [
      fact(
        'inode-claim-bound',
        'persistentvolumeclaim/inodes-filling',
        'status.phase',
        'Bound',
        'The measured claim is attached and mounted by the writer.'
      ),
      fact(
        'volume-free-inodes-low',
        'metric/kubelet_volume_stats_inodes_free{persistentvolumeclaim="inodes-filling"}',
        'latest / kubelet_volume_stats_inodes',
        '< 0.10',
        'Less than ten percent of measured volume inodes remain free.'
      ),
      fact(
        'volume-inode-exhaustion-predicted',
        'metric/kubelet_volume_stats_inodes_free{persistentvolumeclaim="inodes-filling"}',
        'predict_linear[6h,4d]',
        '< 0',
        'The free-inode trend predicts exhaustion within four days.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-inode-capacity-healthy',
        'metric/kubelet_volume_stats_inodes_free{persistentvolumeclaim="inodes-filling"}',
        'latest / kubelet_volume_stats_inodes',
        '> 0.20',
        'The measured free-inode ratio is not healthy.'
      ),
      fact(
        'invented-byte-exhaustion',
        'metric/kubelet_volume_stats_available_bytes{persistentvolumeclaim="inodes-filling"}',
        'latest / kubelet_volume_stats_capacity_bytes',
        '< 0.10',
        'The fixture consumes inodes with empty files rather than filling volume bytes.'
      ),
    ],
    requiredMechanisms: ['api-server', 'scheduler', 'kubelet', 'csi'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-job-failed',
    title: 'Job has failed',
    description:
      'A one-attempt Job exits with a deterministic nonzero code, allowing the Job controller to publish Failed status and native job telemetry.',
    taskPrompt:
      'Diagnose why Job `failing-job` terminated unsuccessfully. Correlate the Job condition and failed count with its Pod exit code, logs, Events, and native job-status telemetry. Do not mutate resources.',
    visibleResourceRefs: [
      'job/failing-job',
      'pod/*?job-name=failing-job',
      'event/*?involvedObject.name=failing-job',
      'metric/kube_job_status_failed{job_name="failing-job"}',
    ],
    observationKinds: [
      'job.spec',
      'job.status',
      'pod.status',
      'pod.logs',
      'resource.events',
      'metric.range',
    ],
    setup: [
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name: 'failing-job' },
        spec: {
          backoffLimit: 0,
          template: {
            metadata: { labels: { job: 'failing-job' } },
            spec: {
              restartPolicy: 'Never',
              containers: [
                {
                  name: 'job',
                  image: busyboxImage,
                  command: ['/bin/sh', '-c', 'echo deterministic-job-failure >&2; exit 17'],
                },
              ],
            },
          },
        },
      },
    ],
    acceptedFacts: [
      fact(
        'job-failed-condition',
        'job/failing-job',
        'status.conditions[?(@.type=="Failed")].status',
        'True',
        'The Job controller records a terminal Failed condition.'
      ),
      fact(
        'job-pod-exit-code',
        'pod/*?job-name=failing-job',
        'status.containerStatuses[?(@.name=="job")].state.terminated.exitCode',
        '17',
        'The only Job attempt exits with the fixture failure code.'
      ),
      fact(
        'job-failure-metric',
        'metric/kube_job_status_failed{job_name="failing-job"}',
        'latest',
        '1',
        'Native job telemetry records one failed attempt.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-job-complete',
        'job/failing-job',
        'status.conditions[?(@.type=="Complete")].status',
        'True',
        'The Job never completes successfully.'
      ),
      fact(
        'invented-job-zero-exit',
        'pod/*?job-name=failing-job',
        'status.containerStatuses[?(@.name=="job")].state.terminated.exitCode',
        '0',
        'The Job process exits with code 17.'
      ),
    ],
    requiredMechanisms: ['api-server', 'scheduler', 'kubelet', 'operator-reconciliation'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-job-not-completed',
    title: 'Job misses its completion deadline',
    description:
      'A Job remains active in a long-running process beyond the bounded completion window, producing native start-time, active-count, and completion telemetry.',
    taskPrompt:
      'Determine why Job `stalled-job` has not completed within ten minutes. Correlate its start time, active and succeeded counts, Pod state and logs, and job-status telemetry. Distinguish a still-running deadline miss from a failed Job and do not mutate resources.',
    visibleResourceRefs: [
      'job/stalled-job',
      'pod/*?job-name=stalled-job',
      'metric/kube_job_status_start_time{job_name="stalled-job"}',
      'metric/kube_job_status_active{job_name="stalled-job"}',
      'metric/kube_job_status_succeeded{job_name="stalled-job"}',
    ],
    observationKinds: ['job.spec', 'job.status', 'pod.status', 'pod.logs', 'metric.range'],
    setup: [
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name: 'stalled-job' },
        spec: {
          activeDeadlineSeconds: 1800,
          backoffLimit: 0,
          template: {
            metadata: { labels: { job: 'stalled-job' } },
            spec: {
              restartPolicy: 'Never',
              containers: [
                {
                  name: 'job',
                  image: busyboxImage,
                  command: ['/bin/sh', '-c', 'echo job-started; sleep 3600'],
                },
              ],
            },
          },
        },
      },
    ],
    acceptedFacts: [
      fact(
        'job-remains-active',
        'job/stalled-job',
        'status.active',
        '1',
        'The Job still has an active Pod after the expected completion window.'
      ),
      fact(
        'job-has-no-successes',
        'job/stalled-job',
        'status.succeeded',
        '0 or <absent>',
        'No Job completion has been recorded.'
      ),
      fact(
        'job-age-exceeds-window',
        'metric/kube_job_status_start_time{job_name="stalled-job"}',
        'time() - latest',
        '> 600',
        'The active Job has run for more than the stated ten-minute completion window.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-job-failed',
        'job/stalled-job',
        'status.conditions[?(@.type=="Failed")].status',
        'True',
        'The Job remains active during the scored window rather than failing.'
      ),
      fact(
        'invented-job-succeeded',
        'metric/kube_job_status_succeeded{job_name="stalled-job"}',
        'latest',
        '1',
        'Native telemetry records no successful completion.'
      ),
    ],
    requiredMechanisms: ['api-server', 'scheduler', 'kubelet', 'operator-reconciliation'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-api-error-budget-burn',
    title: 'API server error budget burns too quickly',
    description:
      'An unavailable aggregated API backend and a bounded request generator produce real API server 503 responses for an isolated API group.',
    taskPrompt:
      'Diagnose the fast API availability burn caused by requests to `v1alpha1.burn.telemetry.example`. Correlate APIService availability, Service endpoints, request status codes, and short- and long-window API error ratios. Do not mutate resources.',
    visibleResourceRefs: [
      'apiservice/v1alpha1.burn.telemetry.example',
      'service/burn-api-backend',
      'endpointslice/*?kubernetes.io/service-name=burn-api-backend',
      'deployment/api-error-generator',
      'metric/apiserver_request_total{group="burn.telemetry.example"}',
    ],
    observationKinds: [
      'apiservice.status',
      'service.spec',
      'endpointslice.list',
      'pod.logs',
      'metric.range',
      'metric.ratio',
    ],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'burn-api-backend' },
        spec: {
          selector: { app: 'intentionally-absent-api-backend' },
          ports: [{ name: 'https', port: 443, targetPort: 8443 }],
        },
      },
      {
        apiVersion: 'apiregistration.k8s.io/v1',
        kind: 'APIService',
        metadata: { name: 'v1alpha1.burn.telemetry.example' },
        spec: {
          group: 'burn.telemetry.example',
          version: 'v1alpha1',
          groupPriorityMinimum: 100,
          versionPriority: 100,
          insecureSkipTLSVerify: true,
          service: {
            namespace: '__EVAL_NAMESPACE__',
            name: 'burn-api-backend',
            port: 443,
          },
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'api-error-generator' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'api-error-generator' } },
          template: {
            metadata: { labels: { app: 'api-error-generator' } },
            spec: {
              containers: [
                {
                  name: 'requester',
                  image: busyboxImage,
                  command: [
                    '/bin/sh',
                    '-c',
                    'TOKEN=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token); while true; do wget -q -O /dev/null --no-check-certificate --header="Authorization: Bearer $TOKEN" https://kubernetes.default.svc/apis/burn.telemetry.example/v1alpha1 || true; sleep 1; done',
                  ],
                },
              ],
            },
          },
        },
      },
    ],
    acceptedFacts: [
      fact(
        'aggregated-api-unavailable',
        'apiservice/v1alpha1.burn.telemetry.example',
        'status.conditions[?(@.type=="Available")].status',
        'False',
        'The aggregated API backend is unavailable.'
      ),
      fact(
        'aggregated-api-has-no-endpoints',
        'endpointslice/*?kubernetes.io/service-name=burn-api-backend',
        'endpoints[*].conditions.ready',
        '<no ready endpoints>',
        'The APIService backend Service has no ready endpoint.'
      ),
      fact(
        'api-fast-burn',
        'metric/apiserver_request_total{group="burn.telemetry.example"}',
        '5xx_ratio[5m] and 5xx_ratio[1h]',
        '> fast-burn thresholds',
        'Native API server request metrics exceed both fast-burn windows for the isolated group.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-aggregated-api-available',
        'apiservice/v1alpha1.burn.telemetry.example',
        'status.conditions[?(@.type=="Available")].status',
        'True',
        'The APIService has no serving backend.'
      ),
      fact(
        'invented-api-errors-below-budget',
        'metric/apiserver_request_total{group="burn.telemetry.example"}',
        '5xx_ratio[5m] and 5xx_ratio[1h]',
        '< fast-burn thresholds',
        'The bounded request stream produces sustained 503 responses.'
      ),
    ],
    requiredMechanisms: [
      'api-server',
      'endpointslice-controller',
      'cni',
      'operator-reconciliation',
    ],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-cluster-certificate-expiration',
    title: 'Cluster certificate near expiration',
    description:
      'A real Kubernetes client CertificateSigningRequest asks the cluster signer for a ten-minute certificate, creating a concrete short-lifetime certificate subject for native certificate telemetry.',
    taskPrompt:
      'Assess expiration risk for CertificateSigningRequest `telemetry-expiring-client` and the issued client certificate. Correlate the requested lifetime, signer, issuance status, and minimum native certificate lifetime. Do not approve, renew, or mutate the request.',
    visibleResourceRefs: [
      'certificatesigningrequest/telemetry-expiring-client',
      'metric/apiserver_client_certificate_expiration_seconds',
    ],
    observationKinds: ['csr.spec', 'csr.status', 'certificate.parse', 'metric.range'],
    setup: [
      {
        apiVersion: 'certificates.k8s.io/v1',
        kind: 'CertificateSigningRequest',
        metadata: { name: 'telemetry-expiring-client' },
        spec: {
          request: fixtureCsrRequest,
          signerName: 'kubernetes.io/kube-apiserver-client',
          expirationSeconds: 600,
          usages: ['client auth'],
        },
        status: {
          conditions: [
            {
              type: 'Approved',
              status: 'True',
              reason: 'FixtureCertificateApproved',
              message: 'Issue the bounded short-lived client certificate.',
            },
          ],
        },
      },
    ],
    acceptedFacts: [
      fact(
        'certificate-lifetime-request',
        'certificatesigningrequest/telemetry-expiring-client',
        'spec.expirationSeconds',
        '600',
        'The CSR requests a ten-minute client certificate lifetime.'
      ),
      fact(
        'certificate-client-signer',
        'certificatesigningrequest/telemetry-expiring-client',
        'spec.signerName',
        'kubernetes.io/kube-apiserver-client',
        'The request targets the Kubernetes API client certificate signer.'
      ),
      fact(
        'certificate-warning-horizon-crossed',
        'metric/apiserver_client_certificate_expiration_seconds',
        'minimum_over_time[5m]',
        '< 604800',
        'Native certificate telemetry places the issued certificate inside the seven-day warning horizon.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-long-certificate-lifetime',
        'certificatesigningrequest/telemetry-expiring-client',
        'spec.expirationSeconds',
        '31536000',
        'The request is for ten minutes, not one year.'
      ),
      fact(
        'invented-server-certificate',
        'certificatesigningrequest/telemetry-expiring-client',
        'spec.usages',
        '["server auth"]',
        'The fixture requests client authentication only.'
      ),
    ],
    requiredMechanisms: ['api-server', 'kubelet'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-daemonset-rollout-failure',
    title: 'DaemonSet rollout cannot converge',
    description:
      'A DaemonSet requests more CPU than any ordinary node can provide, causing controller-created Pods to remain unschedulable and rollout telemetry not to converge.',
    taskPrompt:
      'Diagnose why DaemonSet `unschedulable-agent` cannot converge. Correlate desired, current, ready, and unavailable counts with its Pod scheduling conditions, Events, and native DaemonSet telemetry. Do not mutate resources.',
    visibleResourceRefs: [
      'daemonset/unschedulable-agent',
      'pod/*?app=unschedulable-agent',
      'event/*?involvedObject.kind=Pod',
      'metric/kube_daemonset_status_number_unavailable{daemonset="unschedulable-agent"}',
    ],
    observationKinds: [
      'daemonset.spec',
      'daemonset.status',
      'pod.status',
      'pod.events',
      'metric.range',
    ],
    setup: [
      {
        apiVersion: 'apps/v1',
        kind: 'DaemonSet',
        metadata: { name: 'unschedulable-agent' },
        spec: {
          selector: { matchLabels: { app: 'unschedulable-agent' } },
          template: {
            metadata: { labels: { app: 'unschedulable-agent' } },
            spec: {
              containers: [
                {
                  name: 'agent',
                  image: pauseImage,
                  resources: { requests: { cpu: '100000', memory: '1Ti' } },
                },
              ],
            },
          },
        },
      },
    ],
    acceptedFacts: [
      fact(
        'daemonset-rollout-unavailable',
        'daemonset/unschedulable-agent',
        'status.numberUnavailable',
        '> 0',
        'At least one desired DaemonSet Pod remains unavailable.'
      ),
      fact(
        'daemonset-pods-unschedulable',
        'pod/*?app=unschedulable-agent',
        'status.conditions[?(@.type=="PodScheduled")].reason',
        'Unschedulable',
        'Scheduler status establishes that the rollout Pods cannot be placed.'
      ),
      fact(
        'daemonset-unavailable-sustained',
        'metric/kube_daemonset_status_number_unavailable{daemonset="unschedulable-agent"}',
        'min_over_time[15m]',
        '> 0',
        'Native DaemonSet telemetry remains unavailable for the bounded window.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-daemonset-converged',
        'daemonset/unschedulable-agent',
        'status.numberReady',
        '= status.desiredNumberScheduled',
        'Ready Pods do not converge to the desired count.'
      ),
      fact(
        'invented-image-pull-failure',
        'pod/*?app=unschedulable-agent',
        'status.containerStatuses[0].state.waiting.reason',
        'ImagePullBackOff',
        'The Pods cannot schedule; image pulling is not reached.'
      ),
    ],
    requiredMechanisms: ['api-server', 'scheduler', 'kubelet', 'operator-reconciliation'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-statefulset-rollout-failure',
    title: 'StatefulSet rollout cannot converge',
    description:
      'A StatefulSet creates running Pods whose readiness probes target an unopened port, preventing ready replicas and rollout telemetry from converging.',
    taskPrompt:
      'Diagnose why StatefulSet `not-ready-db` cannot converge. Correlate observed generation, desired, current, updated, and ready replicas with Pod readiness failures and native StatefulSet telemetry. Do not mutate resources.',
    visibleResourceRefs: [
      'statefulset/not-ready-db',
      'service/not-ready-db',
      'pod/*?app=not-ready-db',
      'metric/kube_statefulset_status_replicas_ready{statefulset="not-ready-db"}',
    ],
    observationKinds: [
      'statefulset.spec',
      'statefulset.status',
      'pod.status',
      'pod.events',
      'metric.range',
    ],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'not-ready-db' },
        spec: {
          clusterIP: 'None',
          selector: { app: 'not-ready-db' },
          ports: [{ name: 'db', port: 5432 }],
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'StatefulSet',
        metadata: { name: 'not-ready-db' },
        spec: {
          serviceName: 'not-ready-db',
          replicas: 2,
          selector: { matchLabels: { app: 'not-ready-db' } },
          template: {
            metadata: { labels: { app: 'not-ready-db' } },
            spec: {
              containers: [
                {
                  name: 'db',
                  image: pauseImage,
                  readinessProbe: {
                    tcpSocket: { port: 5432 },
                    periodSeconds: 2,
                    failureThreshold: 1,
                  },
                },
              ],
            },
          },
        },
      },
    ],
    acceptedFacts: [
      fact(
        'statefulset-ready-replicas-zero',
        'statefulset/not-ready-db',
        'status.readyReplicas',
        '0 or <absent>',
        'No StatefulSet replica reaches Ready.'
      ),
      fact(
        'statefulset-pods-not-ready',
        'pod/*?app=not-ready-db',
        'status.conditions[?(@.type=="Ready")].status',
        'False',
        'The controller-created Pods fail their readiness probes.'
      ),
      fact(
        'statefulset-ready-mismatch-sustained',
        'metric/kube_statefulset_status_replicas_ready{statefulset="not-ready-db"}',
        'max_over_time[15m]',
        '< kube_statefulset_replicas',
        'Native StatefulSet telemetry does not converge to the desired replica count.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-statefulset-converged',
        'statefulset/not-ready-db',
        'status.readyReplicas',
        '2',
        'The two desired replicas do not become ready.'
      ),
      fact(
        'invented-statefulset-unschedulable',
        'pod/*?app=not-ready-db',
        'status.conditions[?(@.type=="PodScheduled")].status',
        'False',
        'The Pods schedule and run; readiness prevents convergence.'
      ),
    ],
    requiredMechanisms: ['api-server', 'scheduler', 'kubelet', 'operator-reconciliation'],
  }),
  liveDefinition({
    scenarioId: 'rule-gap-cluster-resource-overcommit',
    title: 'Cluster CPU and memory requests are overcommitted',
    description:
      'Two isolated Pods request deliberately impossible CPU and memory quantities, making aggregate requested resources exceed allocatable capacity while remaining unscheduled.',
    taskPrompt:
      'Assess CPU and memory request overcommit caused by Pods `overcommit-a` and `overcommit-b`. Compare aggregate nonterminal Pod requests with schedulable Node allocatable resources and correlate pending status and scheduler Events. Do not mutate resources.',
    visibleResourceRefs: [
      'pod/overcommit-a',
      'pod/overcommit-b',
      'node/*',
      'metric/kube_pod_container_resource_requests',
      'metric/kube_node_status_allocatable',
    ],
    observationKinds: [
      'pod.spec',
      'pod.status',
      'pod.events',
      'node.status',
      'metric.range',
      'metric.aggregate',
    ],
    setup: ['overcommit-a', 'overcommit-b'].map(name => ({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name, labels: { app: 'resource-overcommit' } },
      spec: {
        containers: [
          {
            name: 'app',
            image: pauseImage,
            resources: { requests: { cpu: '100000', memory: '1Ti' } },
          },
        ],
      },
    })),
    acceptedFacts: [
      fact(
        'cluster-cpu-requests-over-allocatable',
        'metric/kube_pod_container_resource_requests',
        'sum(cpu for nonterminal pods) / sum(kube_node_status_allocatable{resource="cpu"})',
        '> 1',
        'Aggregate requested CPU exceeds cluster allocatable CPU.'
      ),
      fact(
        'cluster-memory-requests-over-allocatable',
        'metric/kube_pod_container_resource_requests',
        'sum(memory for nonterminal pods) / sum(kube_node_status_allocatable{resource="memory"})',
        '> 1',
        'Aggregate requested memory exceeds cluster allocatable memory.'
      ),
      fact(
        'overcommit-pods-unschedulable',
        'pod/*?app=resource-overcommit',
        'status.conditions[?(@.type=="PodScheduled")].reason',
        'Unschedulable',
        'The scheduler cannot place either oversized request.'
      ),
    ],
    contradictionFacts: [
      fact(
        'invented-cpu-headroom',
        'metric/kube_pod_container_resource_requests',
        'sum(cpu for nonterminal pods) / sum(kube_node_status_allocatable{resource="cpu"})',
        '<= 1',
        'The fixture requests far more CPU than the cluster advertises.'
      ),
      fact(
        'invented-memory-headroom',
        'metric/kube_pod_container_resource_requests',
        'sum(memory for nonterminal pods) / sum(kube_node_status_allocatable{resource="memory"})',
        '<= 1',
        'The fixture requests far more memory than the cluster advertises.'
      ),
    ],
    requiredMechanisms: ['api-server', 'scheduler'],
  }),
];
