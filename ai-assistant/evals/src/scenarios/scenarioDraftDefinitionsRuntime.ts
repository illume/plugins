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

const runtimeProfiles = ['local-minikube', 'aks'] as const;

const securityContext = {
  allowPrivilegeEscalation: false,
  capabilities: { drop: ['ALL'] },
  runAsNonRoot: true,
  runAsUser: 1000,
};

const failedProbeJob = (name: string, command: string, image = 'busybox:1.36.1') => ({
  apiVersion: 'batch/v1',
  kind: 'Job',
  metadata: { name },
  spec: {
    activeDeadlineSeconds: 120,
    backoffLimit: 0,
    ttlSecondsAfterFinished: 300,
    template: {
      metadata: { labels: { app: name } },
      spec: {
        restartPolicy: 'Never',
        containers: [
          {
            name: 'probe',
            image,
            command: ['/bin/sh', '-c', command],
            securityContext,
          },
        ],
      },
    },
  },
});

const restartProbePod = (service: string, exitCode: number) => {
  const name = `${service}-restart-probe`;
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name, labels: { app: name } },
    spec: {
      activeDeadlineSeconds: 120,
      restartPolicy: 'Always',
      containers: [
        {
          name: `${service}-probe`,
          image: 'busybox:1.36.1',
          command: ['/bin/sh', '-c', `echo '${service} start event'; sleep 1; exit ${exitCode}`],
          securityContext,
        },
      ],
    },
  };
};

export const runtimeScenarioDraftDefinitions: ScenarioDraftDefinition[] = [
  {
    scenarioId: 'rule-gap-pod-image-pull-failure',
    title: 'Pod cannot pull its container image',
    description:
      'A bounded Pod references a deliberately nonexistent image, causing kubelet image-pull status and events without running untrusted code.',
    taskPrompt:
      'Diagnose why `image-pull-probe` does not start. Inspect its container waiting state and namespace events during the bounded observation window; cite the image and exact failure state, and do not mutate resources.',
    visibleResourceRefs: ['pod/image-pull-probe', 'event/*'],
    observationKinds: ['pod.status', 'pod.container-status', 'event.list'],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'image-pull-probe' },
        spec: {
          activeDeadlineSeconds: 120,
          restartPolicy: 'Never',
          containers: [
            {
              name: 'app',
              image: 'registry.k8s.io/e2e-test-images/does-not-exist:runtime-gap-v1',
              securityContext,
            },
          ],
        },
      },
    ],
    acceptedFacts: [
      {
        fact_id: 'nonexistent-image-reference',
        resource_ref: 'pod/image-pull-probe',
        field_path: 'spec.containers[0].image',
        observed_value: 'registry.k8s.io/e2e-test-images/does-not-exist:runtime-gap-v1',
        description: 'The Pod requests a deliberately nonexistent image.',
      },
      {
        fact_id: 'image-pull-waiting',
        resource_ref: 'pod/image-pull-probe',
        field_path: 'status.containerStatuses[0].state.waiting.reason',
        observed_value: 'ImagePullBackOff',
        description: 'Kubelet leaves the container waiting after repeated image pull failures.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-running-container',
        resource_ref: 'pod/image-pull-probe',
        field_path: 'status.containerStatuses[0].state.running',
        observed_value: '<present>',
        description: 'The nonexistent image never starts a running container.',
      },
    ],
    requiredMechanisms: ['kubelet'],
    supportedClusterProfiles: [...runtimeProfiles],
  },
  {
    scenarioId: 'rule-gap-pod-invalid-config-reference',
    title: 'Pod references missing configuration',
    description:
      'A bounded Pod requires a key from a ConfigMap that is absent from the namespace, producing a kubelet configuration error before startup.',
    taskPrompt:
      'Diagnose why `config-reference-probe` does not start. Inspect the required ConfigMap reference, container waiting state, and namespace inventory; cite exact evidence and do not mutate resources.',
    visibleResourceRefs: ['pod/config-reference-probe', 'configmap/*', 'event/*'],
    observationKinds: ['pod.spec', 'pod.container-status', 'configmap.list', 'event.list'],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'config-reference-probe' },
        spec: {
          activeDeadlineSeconds: 120,
          restartPolicy: 'Never',
          containers: [
            {
              name: 'app',
              image: 'busybox:1.36.1',
              command: ['/bin/sh', '-c', 'exit 0'],
              env: [
                {
                  name: 'REQUIRED_SETTING',
                  valueFrom: {
                    configMapKeyRef: { name: 'missing-runtime-config', key: 'setting' },
                  },
                },
              ],
              securityContext,
            },
          ],
        },
      },
    ],
    acceptedFacts: [
      {
        fact_id: 'required-configmap-reference',
        resource_ref: 'pod/config-reference-probe',
        field_path: 'spec.containers[0].env[0].valueFrom.configMapKeyRef',
        observed_value: '{"name":"missing-runtime-config","key":"setting"}',
        description: 'The environment variable requires a key from missing-runtime-config.',
      },
      {
        fact_id: 'create-container-config-error',
        resource_ref: 'pod/config-reference-probe',
        field_path: 'status.containerStatuses[0].state.waiting.reason',
        observed_value: 'CreateContainerConfigError',
        description: 'Kubelet cannot construct the container configuration.',
      },
      {
        fact_id: 'configmap-absent',
        resource_ref: 'configmap/*',
        field_path: 'items[metadata.name=missing-runtime-config].length',
        observed_value: '0',
        description: 'The referenced ConfigMap does not exist in the scenario namespace.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-optional-reference',
        resource_ref: 'pod/config-reference-probe',
        field_path: 'spec.containers[0].env[0].valueFrom.configMapKeyRef.optional',
        observed_value: 'true',
        description: 'The missing ConfigMap reference is required, not optional.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet'],
    supportedClusterProfiles: [...runtimeProfiles],
  },
  {
    scenarioId: 'rule-gap-pod-oom-killed',
    title: 'Container is terminated by the OOM killer',
    description:
      'A one-shot Job grows a string beyond a 32 MiB container limit so the kernel terminates only that container and kubelet records OOMKilled.',
    taskPrompt:
      'Diagnose why the `oom-worker` Job failed. Inspect its Pod resource limit and last terminated container state; cite the exact termination reason and exit code, and do not mutate resources.',
    visibleResourceRefs: ['job/oom-worker', 'pod[label=job-name=oom-worker]'],
    observationKinds: ['job.status', 'pod.spec', 'pod.container-status'],
    setup: [
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name: 'oom-worker' },
        spec: {
          activeDeadlineSeconds: 120,
          backoffLimit: 0,
          ttlSecondsAfterFinished: 300,
          template: {
            metadata: { labels: { app: 'oom-worker' } },
            spec: {
              restartPolicy: 'Never',
              containers: [
                {
                  name: 'allocator',
                  image: 'busybox:1.36.1',
                  command: [
                    '/bin/sh',
                    '-c',
                    'awk \'BEGIN { value="x"; while (1) value=value value }\'',
                  ],
                  resources: { requests: { memory: '16Mi' }, limits: { memory: '32Mi' } },
                  securityContext,
                },
              ],
            },
          },
        },
      },
    ],
    acceptedFacts: [
      {
        fact_id: 'bounded-memory-limit',
        resource_ref: 'pod[label=job-name=oom-worker]',
        field_path: 'spec.containers[0].resources.limits.memory',
        observed_value: '32Mi',
        description: 'The allocator is constrained to 32 MiB.',
      },
      {
        fact_id: 'oom-killed-state',
        resource_ref: 'pod[label=job-name=oom-worker]',
        field_path: 'status.containerStatuses[0].state.terminated.reason',
        observed_value: 'OOMKilled',
        description:
          'The kernel terminates the memory-constrained allocator for exceeding its cgroup limit.',
      },
      {
        fact_id: 'oom-exit-code',
        resource_ref: 'pod[label=job-name=oom-worker]',
        field_path: 'status.containerStatuses[0].state.terminated.exitCode',
        observed_value: '137',
        description: 'The terminated container records the SIGKILL-style exit code.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-successful-completion',
        resource_ref: 'job/oom-worker',
        field_path: 'status.succeeded',
        observed_value: '1',
        description: 'The allocator does not complete successfully.',
      },
    ],
    requiredMechanisms: ['kubelet'],
    supportedClusterProfiles: [...runtimeProfiles],
  },
  {
    scenarioId: 'rule-gap-pod-unschedulable',
    title: 'Pod remains unschedulable',
    description:
      'A single Pod requests 100000 CPU cores, safely exceeding any minikube or AKS node capacity so the scheduler records an Unschedulable condition.',
    taskPrompt:
      'Diagnose why `capacity-probe` remains Pending. Compare its CPU request with scheduler condition and event evidence; cite the exact request and scheduling reason, and do not mutate resources.',
    visibleResourceRefs: ['pod/capacity-probe', 'event/*', 'node/*'],
    observationKinds: ['pod.spec', 'pod.status', 'event.list', 'node.capacity'],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'capacity-probe' },
        spec: {
          activeDeadlineSeconds: 120,
          restartPolicy: 'Never',
          containers: [
            {
              name: 'app',
              image: 'busybox:1.36.1',
              command: ['/bin/sh', '-c', 'exit 0'],
              resources: { requests: { cpu: '100000', memory: '1Mi' } },
              securityContext,
            },
          ],
        },
      },
    ],
    acceptedFacts: [
      {
        fact_id: 'impossible-cpu-request',
        resource_ref: 'pod/capacity-probe',
        field_path: 'spec.containers[0].resources.requests.cpu',
        observed_value: '100000',
        description: 'The Pod requests one hundred thousand CPU cores.',
      },
      {
        fact_id: 'scheduler-unschedulable',
        resource_ref: 'pod/capacity-probe',
        field_path: 'status.conditions[type=PodScheduled].reason',
        observed_value: 'Unschedulable',
        description: 'The scheduler cannot find a node with sufficient CPU.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-scheduled-condition',
        resource_ref: 'pod/capacity-probe',
        field_path: 'status.conditions[type=PodScheduled].status',
        observed_value: 'True',
        description: 'No cluster node can satisfy the deliberately impossible request.',
      },
    ],
    requiredMechanisms: ['scheduler'],
    supportedClusterProfiles: [...runtimeProfiles],
  },
  {
    scenarioId: 'rule-gap-readonly-node-filesystem',
    title: 'Node filesystem becomes read-only',
    description:
      'A one-shot Job attempts a write through a deliberately read-only volume mount and records the real filesystem error without mounting or changing any host path.',
    taskPrompt:
      'Diagnose the failed `readonly-filesystem-probe` Job from its mount configuration, termination status, and logs. Distinguish the read-only filesystem failure from permissions or capacity; do not mutate resources.',
    visibleResourceRefs: [
      'job/readonly-filesystem-probe',
      'pod[label=job-name=readonly-filesystem-probe]',
    ],
    observationKinds: ['job.status', 'pod.spec', 'pod.container-status', 'pod.logs'],
    setup: [
      {
        ...failedProbeJob(
          'readonly-filesystem-probe',
          "echo probe > /nodefs/write-check || { echo 'filesystem probe failed: Read-only file system'; exit 30; }"
        ),
        spec: {
          ...failedProbeJob('readonly-filesystem-probe', '').spec,
          template: {
            metadata: { labels: { app: 'readonly-filesystem-probe' } },
            spec: {
              restartPolicy: 'Never',
              volumes: [{ name: 'nodefs-fixture', emptyDir: {} }],
              containers: [
                {
                  name: 'probe',
                  image: 'busybox:1.36.1',
                  command: [
                    '/bin/sh',
                    '-c',
                    "echo probe > /nodefs/write-check || { echo 'filesystem probe failed: Read-only file system'; exit 30; }",
                  ],
                  volumeMounts: [{ name: 'nodefs-fixture', mountPath: '/nodefs', readOnly: true }],
                  securityContext,
                },
              ],
            },
          },
        },
      },
    ],
    acceptedFacts: [
      {
        fact_id: 'readonly-probe-mount',
        resource_ref: 'pod[label=job-name=readonly-filesystem-probe]',
        field_path: 'spec.containers[0].volumeMounts[0].readOnly',
        observed_value: 'true',
        description: 'The probe target is mounted read-only.',
      },
      {
        fact_id: 'readonly-write-error',
        resource_ref: 'pod[label=job-name=readonly-filesystem-probe]',
        field_path: 'logs',
        observed_value: 'filesystem probe failed: Read-only file system',
        description: 'The bounded write receives a read-only filesystem error.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-host-mutation',
        resource_ref: 'pod[label=job-name=readonly-filesystem-probe]',
        field_path: 'spec.volumes[0].hostPath',
        observed_value: '<present>',
        description: 'The fixture uses an isolated emptyDir and never mounts the host filesystem.',
      },
    ],
    requiredMechanisms: ['kubelet'],
    supportedClusterProfiles: [...runtimeProfiles],
  },
  {
    scenarioId: 'rule-gap-corrupt-container-image',
    title: 'Container image storage is corrupt',
    description:
      'A one-shot integrity Job validates a deliberately malformed compressed layer fixture and fails without altering the node image store or container runtime.',
    taskPrompt:
      'Diagnose the failed `image-layer-integrity-probe` Job from its command, termination status, and logs. Identify whether the bounded layer fixture passed integrity validation; do not mutate resources.',
    visibleResourceRefs: [
      'job/image-layer-integrity-probe',
      'pod[label=job-name=image-layer-integrity-probe]',
    ],
    observationKinds: ['job.status', 'pod.spec', 'pod.container-status', 'pod.logs'],
    setup: [
      failedProbeJob(
        'image-layer-integrity-probe',
        "printf 'not-a-valid-compressed-layer' > /tmp/layer.tar.gz; gzip -t /tmp/layer.tar.gz >/dev/null 2>&1 || { echo 'image layer verification failed: corrupt compressed data'; exit 31; }"
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'corrupt-layer-verification-log',
        resource_ref: 'pod[label=job-name=image-layer-integrity-probe]',
        field_path: 'logs',
        observed_value: 'image layer verification failed: corrupt compressed data',
        description: 'Integrity validation rejects the deliberately malformed layer archive.',
      },
      {
        fact_id: 'integrity-probe-exit-code',
        resource_ref: 'pod[label=job-name=image-layer-integrity-probe]',
        field_path: 'status.containerStatuses[0].state.terminated.exitCode',
        observed_value: '31',
        description: 'The integrity probe exits with its corruption-specific failure code.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-layer-verification-success',
        resource_ref: 'job/image-layer-integrity-probe',
        field_path: 'status.succeeded',
        observed_value: '1',
        description: 'The malformed layer does not pass verification.',
      },
    ],
    requiredMechanisms: ['kubelet'],
    supportedClusterProfiles: [...runtimeProfiles],
  },
  {
    scenarioId: 'rule-gap-containerd-unhealthy',
    title: 'Containerd health check fails',
    description:
      'A one-shot namespaced Job performs a bounded health request to a closed local endpoint and records a containerd-specific unavailable result without accessing the host runtime socket.',
    taskPrompt:
      'Diagnose the failed `containerd-health-probe` Job from its probe command, termination status, and logs. State what the endpoint result establishes and do not infer host access or mutate resources.',
    visibleResourceRefs: [
      'job/containerd-health-probe',
      'pod[label=job-name=containerd-health-probe]',
    ],
    observationKinds: ['job.status', 'pod.spec', 'pod.container-status', 'pod.logs'],
    setup: [
      failedProbeJob(
        'containerd-health-probe',
        "wget -q -T 2 -O /dev/null http://127.0.0.1:65531/healthz || { echo 'containerd health check failed: endpoint unavailable'; exit 32; }"
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'containerd-health-failure-log',
        resource_ref: 'pod[label=job-name=containerd-health-probe]',
        field_path: 'logs',
        observed_value: 'containerd health check failed: endpoint unavailable',
        description: 'The bounded containerd health endpoint request is unavailable.',
      },
      {
        fact_id: 'containerd-health-exit-code',
        resource_ref: 'pod[label=job-name=containerd-health-probe]',
        field_path: 'status.containerStatuses[0].state.terminated.exitCode',
        observed_value: '32',
        description: 'The probe records its containerd health failure code.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-containerd-health-success',
        resource_ref: 'job/containerd-health-probe',
        field_path: 'status.succeeded',
        observed_value: '1',
        description: 'The health request does not succeed.',
      },
    ],
    requiredMechanisms: ['kubelet'],
    supportedClusterProfiles: [...runtimeProfiles],
  },
  {
    scenarioId: 'rule-gap-docker-unhealthy',
    title: 'Docker runtime health check fails',
    description:
      'A one-shot namespaced Job performs a bounded health request to a closed local endpoint and records a Docker-specific unavailable result without accessing a host runtime socket.',
    taskPrompt:
      'Diagnose the failed `docker-health-probe` Job from its probe command, termination status, and logs. State what the endpoint result establishes and do not infer host access or mutate resources.',
    visibleResourceRefs: ['job/docker-health-probe', 'pod[label=job-name=docker-health-probe]'],
    observationKinds: ['job.status', 'pod.spec', 'pod.container-status', 'pod.logs'],
    setup: [
      failedProbeJob(
        'docker-health-probe',
        "wget -q -T 2 -O /dev/null http://127.0.0.1:65532/_ping || { echo 'docker health check failed: endpoint unavailable'; exit 33; }"
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'docker-health-failure-log',
        resource_ref: 'pod[label=job-name=docker-health-probe]',
        field_path: 'logs',
        observed_value: 'docker health check failed: endpoint unavailable',
        description: 'The bounded Docker health endpoint request is unavailable.',
      },
      {
        fact_id: 'docker-health-exit-code',
        resource_ref: 'pod[label=job-name=docker-health-probe]',
        field_path: 'status.containerStatuses[0].state.terminated.exitCode',
        observed_value: '33',
        description: 'The probe records its Docker health failure code.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-docker-health-success',
        resource_ref: 'job/docker-health-probe',
        field_path: 'status.succeeded',
        observed_value: '1',
        description: 'The health request does not succeed.',
      },
    ],
    requiredMechanisms: ['kubelet'],
    supportedClusterProfiles: [...runtimeProfiles],
  },
  {
    scenarioId: 'rule-gap-frequent-containerd-restarts',
    title: 'Containerd restarts repeatedly',
    description:
      'A Pod repeatedly exits a containerd-labeled probe process for at most 120 seconds, allowing kubelet to produce restart-count and CrashLoopBackOff evidence without restarting host containerd.',
    taskPrompt:
      'Diagnose the repeated failures in `containerd-restart-probe`. Inspect the selected Pod restart count, waiting reason, and prior logs during the bounded window; do not treat the probe as the host daemon or mutate resources.',
    visibleResourceRefs: [
      'pod/containerd-restart-probe',
      'pod[label=app=containerd-restart-probe]',
    ],
    observationKinds: ['pod.status', 'pod.container-status', 'pod.logs.previous'],
    setup: [restartProbePod('containerd', 41)],
    acceptedFacts: [
      {
        fact_id: 'containerd-probe-restarts',
        resource_ref: 'pod[label=app=containerd-restart-probe]',
        field_path: 'status.containerStatuses[name=containerd-probe].restartCount',
        observed_value: '>=3 within 120s',
        description: 'Kubelet restarts the failing containerd probe at least three times.',
      },
      {
        fact_id: 'containerd-probe-crashloop',
        resource_ref: 'pod[label=app=containerd-restart-probe]',
        field_path: 'status.containerStatuses[name=containerd-probe].state.waiting.reason',
        observed_value: 'CrashLoopBackOff',
        description: 'The repeatedly failing probe enters restart backoff.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-host-containerd-restart',
        resource_ref: 'node/*',
        field_path: 'systemd.containerd.restartCount',
        observed_value: '>=3',
        description: 'The fixture does not restart or access host containerd.',
      },
    ],
    requiredMechanisms: ['kubelet'],
    supportedClusterProfiles: [...runtimeProfiles],
  },
  {
    scenarioId: 'rule-gap-frequent-docker-restarts',
    title: 'Docker restarts repeatedly',
    description:
      'A Pod repeatedly exits a Docker-labeled probe process for at most 120 seconds, allowing kubelet to produce restart-count and CrashLoopBackOff evidence without restarting a host runtime.',
    taskPrompt:
      'Diagnose the repeated failures in `docker-restart-probe`. Inspect the selected Pod restart count, waiting reason, and prior logs during the bounded window; do not treat the probe as a host daemon or mutate resources.',
    visibleResourceRefs: ['pod/docker-restart-probe', 'pod[label=app=docker-restart-probe]'],
    observationKinds: ['pod.status', 'pod.container-status', 'pod.logs.previous'],
    setup: [restartProbePod('docker', 42)],
    acceptedFacts: [
      {
        fact_id: 'docker-probe-restarts',
        resource_ref: 'pod[label=app=docker-restart-probe]',
        field_path: 'status.containerStatuses[name=docker-probe].restartCount',
        observed_value: '>=3 within 120s',
        description: 'Kubelet restarts the failing Docker probe at least three times.',
      },
      {
        fact_id: 'docker-probe-crashloop',
        resource_ref: 'pod[label=app=docker-restart-probe]',
        field_path: 'status.containerStatuses[name=docker-probe].state.waiting.reason',
        observed_value: 'CrashLoopBackOff',
        description: 'The repeatedly failing probe enters restart backoff.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-host-docker-restart',
        resource_ref: 'node/*',
        field_path: 'systemd.docker.restartCount',
        observed_value: '>=3',
        description: 'The fixture does not restart or access a host Docker service.',
      },
    ],
    requiredMechanisms: ['kubelet'],
    supportedClusterProfiles: [...runtimeProfiles],
  },
  {
    scenarioId: 'rule-gap-frequent-kubelet-restarts',
    title: 'Kubelet restarts repeatedly',
    description:
      'A Pod repeatedly exits a kubelet-labeled probe process for at most 120 seconds, allowing the real kubelet to produce restart evidence without restarting or reconfiguring the host kubelet.',
    taskPrompt:
      'Diagnose the repeated failures in `kubelet-restart-probe`. Inspect the selected Pod restart count, waiting reason, and prior logs during the bounded window; distinguish the probe from the host kubelet and do not mutate resources.',
    visibleResourceRefs: ['pod/kubelet-restart-probe', 'pod[label=app=kubelet-restart-probe]'],
    observationKinds: ['pod.status', 'pod.container-status', 'pod.logs.previous'],
    setup: [restartProbePod('kubelet', 43)],
    acceptedFacts: [
      {
        fact_id: 'kubelet-probe-restarts',
        resource_ref: 'pod[label=app=kubelet-restart-probe]',
        field_path: 'status.containerStatuses[name=kubelet-probe].restartCount',
        observed_value: '>=3 within 120s',
        description:
          'The real kubelet restarts the failing kubelet-labeled probe at least three times.',
      },
      {
        fact_id: 'kubelet-probe-crashloop',
        resource_ref: 'pod[label=app=kubelet-restart-probe]',
        field_path: 'status.containerStatuses[name=kubelet-probe].state.waiting.reason',
        observed_value: 'CrashLoopBackOff',
        description: 'The repeatedly failing probe enters restart backoff.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-host-kubelet-restart',
        resource_ref: 'node/*',
        field_path: 'systemd.kubelet.restartCount',
        observed_value: '>=3',
        description: 'The fixture does not restart or reconfigure the host kubelet.',
      },
    ],
    requiredMechanisms: ['kubelet'],
    supportedClusterProfiles: [...runtimeProfiles],
  },
  {
    scenarioId: 'rule-gap-node-dns-unreachable',
    title: 'Node cannot reach its DNS resolver',
    description:
      'A one-shot Job proves a local IP endpoint is reachable, then queries through a reserved unreachable DNS address with one-second attempts, producing bounded resolver-failure logs.',
    taskPrompt:
      'Diagnose the failed `dns-reachability-probe` Job. Use its DNS configuration and logs to compare the local IP control request with the resolver lookup; cite both outcomes and do not mutate resources.',
    visibleResourceRefs: [
      'job/dns-reachability-probe',
      'pod[label=job-name=dns-reachability-probe]',
    ],
    observationKinds: ['job.status', 'pod.spec', 'pod.container-status', 'pod.logs'],
    setup: [
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name: 'dns-reachability-probe' },
        spec: {
          activeDeadlineSeconds: 120,
          backoffLimit: 0,
          ttlSecondsAfterFinished: 300,
          template: {
            metadata: { labels: { app: 'dns-reachability-probe' } },
            spec: {
              restartPolicy: 'Never',
              dnsPolicy: 'None',
              dnsConfig: {
                nameservers: ['192.0.2.53'],
                options: [
                  { name: 'ndots', value: '1' },
                  { name: 'timeout', value: '1' },
                  { name: 'attempts', value: '1' },
                ],
              },
              containers: [
                {
                  name: 'probe',
                  image: 'busybox:1.36.1',
                  command: [
                    '/bin/sh',
                    '-c',
                    "mkdir -p /tmp/www; echo ok > /tmp/www/health; httpd -p 8080 -h /tmp/www; wget -q -T 2 -O /dev/null http://127.0.0.1:8080/health && echo 'control address reachable'; nslookup kubernetes.default.svc.cluster.local && exit 0; echo 'dns resolver unreachable while control address reachable'; exit 50",
                  ],
                  securityContext,
                },
              ],
            },
          },
        },
      },
    ],
    acceptedFacts: [
      {
        fact_id: 'reserved-unreachable-resolver',
        resource_ref: 'pod[label=job-name=dns-reachability-probe]',
        field_path: 'spec.dnsConfig.nameservers',
        observed_value: '["192.0.2.53"]',
        description: 'The fixture pins DNS to the TEST-NET-1 address reserved for documentation.',
      },
      {
        fact_id: 'control-address-reachable',
        resource_ref: 'pod[label=job-name=dns-reachability-probe]',
        field_path: 'logs',
        observed_value: 'control address reachable',
        description: 'The local IP control request succeeds before the lookup.',
      },
      {
        fact_id: 'dns-lookup-unreachable',
        resource_ref: 'pod[label=job-name=dns-reachability-probe]',
        field_path: 'logs',
        observed_value: 'dns resolver unreachable while control address reachable',
        description: 'The pinned DNS lookup times out while the control remains reachable.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-general-network-outage',
        resource_ref: 'pod[label=job-name=dns-reachability-probe]',
        field_path: 'logs',
        observed_value: 'control address unreachable',
        description:
          'The local control endpoint succeeds, so the evidence is not a general network outage.',
      },
    ],
    requiredMechanisms: ['kubelet', 'cni'],
    supportedClusterProfiles: [...runtimeProfiles],
  },
  {
    scenarioId: 'rule-gap-node-conntrack-full',
    title: 'Node connection tracking table is full',
    description:
      'A one-shot Job fills a deliberately tiny local TCP pending-connection queue until a controlled connection is dropped, modeling bounded connection-capacity exhaustion without host sysctls or privileges.',
    taskPrompt:
      'Diagnose the failed `conntrack-capacity-probe` Job from its command, termination status, and logs. Identify the bounded connection-capacity condition and explicitly avoid claiming that host sysctls were changed; do not mutate resources.',
    visibleResourceRefs: [
      'job/conntrack-capacity-probe',
      'pod[label=job-name=conntrack-capacity-probe]',
    ],
    observationKinds: ['job.status', 'pod.spec', 'pod.container-status', 'pod.logs'],
    setup: [
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name: 'conntrack-capacity-probe' },
        spec: {
          activeDeadlineSeconds: 120,
          backoffLimit: 0,
          ttlSecondsAfterFinished: 300,
          template: {
            metadata: { labels: { app: 'conntrack-capacity-probe' } },
            spec: {
              restartPolicy: 'Never',
              containers: [
                {
                  name: 'probe',
                  image: 'python:3.12-alpine',
                  command: [
                    'python',
                    '-c',
                    "import socket,sys; listener=socket.socket(); listener.bind(('127.0.0.1',18080)); listener.listen(1); opened=[]; dropped=0\nfor _ in range(32):\n s=socket.socket(); s.settimeout(0.02)\n try: s.connect(('127.0.0.1',18080)); opened.append(s)\n except OSError: dropped += 1; s.close()\nprint(f'controlled connections opened={len(opened)} dropped={dropped}')\nif dropped == 0: sys.exit(2)\nprint('connection tracking capacity reached: controlled connection dropped'); sys.exit(51)",
                  ],
                  resources: {
                    requests: { cpu: '10m', memory: '16Mi' },
                    limits: { cpu: '100m', memory: '64Mi' },
                  },
                  securityContext,
                },
              ],
            },
          },
        },
      },
    ],
    acceptedFacts: [
      {
        fact_id: 'bounded-connection-drop',
        resource_ref: 'pod[label=job-name=conntrack-capacity-probe]',
        field_path: 'logs',
        observed_value: 'connection tracking capacity reached: controlled connection dropped',
        description:
          'The tiny local pending-connection capacity drops at least one controlled connection.',
      },
      {
        fact_id: 'capacity-probe-exit-code',
        resource_ref: 'pod[label=job-name=conntrack-capacity-probe]',
        field_path: 'status.containerStatuses[0].state.terminated.exitCode',
        observed_value: '51',
        description: 'The probe exits with its bounded connection-capacity failure code.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-host-conntrack-change',
        resource_ref: 'node/*',
        field_path: 'sysctl.net.netfilter.nf_conntrack_max',
        observed_value: '<changed>',
        description:
          'The fixture is unprivileged and does not read or change host conntrack settings.',
      },
    ],
    requiredMechanisms: ['kubelet', 'cni'],
    supportedClusterProfiles: [...runtimeProfiles],
  },
];
