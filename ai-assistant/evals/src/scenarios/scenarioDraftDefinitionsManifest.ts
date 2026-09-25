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

const apiServerProfiles: NonNullable<ScenarioDraftDefinition['supportedClusterProfiles']> = [
  'local-kwok',
  'local-minikube',
  'aks',
];

const fileAnalysisProfiles: NonNullable<ScenarioDraftDefinition['supportedClusterProfiles']> = [
  'local-kwok',
];

const container = (overrides: Record<string, unknown> = {}) => ({
  name: 'app',
  image: 'registry.k8s.io/pause:3.10',
  securityContext: { runAsNonRoot: true, runAsUser: 65532 },
  ...overrides,
});

const deployment = (
  name: string,
  replicas: number,
  containerOverrides: Record<string, unknown> = {},
  podSpec: Record<string, unknown> = {},
  deploymentSpec: Record<string, unknown> = {}
) => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name, labels: { app: name } },
  spec: {
    replicas,
    selector: { matchLabels: { app: name } },
    strategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1, maxSurge: 1 } },
    template: {
      metadata: { labels: { app: name } },
      spec: { ...podSpec, containers: [container(containerOverrides)] },
    },
    ...deploymentSpec,
  },
});

const httpProbe = (port: string) => ({
  httpGet: { path: '/healthz', port },
  initialDelaySeconds: 1,
  periodSeconds: 10,
});

const pdb = (name: string, selector: string, policy: Record<string, unknown> = {}) => ({
  apiVersion: 'policy/v1',
  kind: 'PodDisruptionBudget',
  metadata: { name },
  spec: { selector: { matchLabels: { app: selector } }, ...policy },
});

const hpa = (apiVersion: string, name: string, targetName: string) => ({
  apiVersion,
  kind: 'HorizontalPodAutoscaler',
  metadata: { name },
  spec: {
    scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: targetName },
    minReplicas: 2,
    maxReplicas: 5,
  },
});

const legacyWorkload = (apiVersion: string, kind: string, name: string) => ({
  apiVersion,
  kind,
  metadata: { name },
  spec: {
    selector: { matchLabels: { app: name } },
    template: {
      metadata: { labels: { app: name } },
      spec: { containers: [container()] },
    },
  },
});

const cronJob = (apiVersion: string, name: string) => ({
  apiVersion,
  kind: 'CronJob',
  metadata: { name },
  spec: {
    schedule: '0 2 * * *',
    jobTemplate: {
      spec: {
        template: {
          metadata: { labels: { app: name } },
          spec: { restartPolicy: 'Never', containers: [container()] },
        },
      },
    },
  },
});

const manifestFact = (
  factId: string,
  resourceRef: string,
  fieldPath: string,
  observedValue: string,
  description: string
) => ({
  fact_id: factId,
  resource_ref: resourceRef,
  field_path: fieldPath,
  observed_value: observedValue,
  description,
});

export const manifestScenarioDraftDefinitions: ScenarioDraftDefinition[] = [
  {
    scenarioId: 'rule-gap-unsafe-probe-suite',
    title: 'Container has no safe probe suite',
    description: 'A long-running application container omits both readiness and liveness probes.',
    taskPrompt:
      'Review the `app` Deployment health checks and identify any availability risk. Cite the exact container fields you inspect and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.health-probes'],
    setup: [deployment('app', 2)],
    acceptedFacts: [
      manifestFact(
        'liveness-probe-absent',
        'deployment/app',
        'spec.template.spec.containers[0].livenessProbe',
        '<absent>',
        'The application container has no liveness probe.'
      ),
      manifestFact(
        'readiness-probe-absent',
        'deployment/app',
        'spec.template.spec.containers[0].readinessProbe',
        '<absent>',
        'The application container has no readiness probe.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-probe-suite',
        'deployment/app',
        'spec.template.spec.containers[0]',
        '{"livenessProbe":"configured","readinessProbe":"configured"}',
        'The fixture does not configure either required health probe.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-liveness-port-not-exposed',
    title: 'Liveness probe targets an undeclared port',
    description:
      'A liveness HTTP probe names a port that is not declared by its application container.',
    taskPrompt:
      'Check whether the `app` Deployment liveness check addresses a declared container port. Cite the probe target and declared ports; do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.health-probes', 'container.ports'],
    setup: [
      deployment('app', 2, {
        ports: [{ name: 'web', containerPort: 8080 }],
        livenessProbe: httpProbe('health'),
        readinessProbe: httpProbe('web'),
      }),
    ],
    acceptedFacts: [
      manifestFact(
        'liveness-port-name',
        'deployment/app',
        'spec.template.spec.containers[0].livenessProbe.httpGet.port',
        'health',
        'The liveness probe targets the named port health.'
      ),
      manifestFact(
        'declared-port-name',
        'deployment/app',
        'spec.template.spec.containers[0].ports[0]',
        '{"containerPort":8080,"name":"web","protocol":"TCP"}',
        'The only declared container port is named web, so health cannot resolve.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-health-port',
        'deployment/app',
        'spec.template.spec.containers[0].ports[*].name',
        '["health"]',
        'No declared container port is named health.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-readiness-port-not-exposed',
    title: 'Readiness probe targets an undeclared port',
    description:
      'A readiness HTTP probe names a port that is not declared by its application container.',
    taskPrompt:
      'Check whether the `app` Deployment readiness check addresses a declared container port. Cite the probe target and declared ports; do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.health-probes', 'container.ports'],
    setup: [
      deployment('app', 2, {
        ports: [{ name: 'web', containerPort: 8080 }],
        livenessProbe: httpProbe('web'),
        readinessProbe: httpProbe('ready'),
      }),
    ],
    acceptedFacts: [
      manifestFact(
        'readiness-port-name',
        'deployment/app',
        'spec.template.spec.containers[0].readinessProbe.httpGet.port',
        'ready',
        'The readiness probe targets the named port ready.'
      ),
      manifestFact(
        'declared-port-name',
        'deployment/app',
        'spec.template.spec.containers[0].ports[0]',
        '{"containerPort":8080,"name":"web","protocol":"TCP"}',
        'The only declared container port is named web, so ready cannot resolve.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-ready-port',
        'deployment/app',
        'spec.template.spec.containers[0].ports[*].name',
        '["ready"]',
        'No declared container port is named ready.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-startup-port-not-exposed',
    title: 'Startup probe targets an undeclared port',
    description:
      'A startup HTTP probe names a port that is not declared by its application container.',
    taskPrompt:
      'Check whether the `app` Deployment startup check addresses a declared container port. Cite the probe target and declared ports; do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.health-probes', 'container.ports'],
    setup: [
      deployment('app', 2, {
        ports: [{ name: 'web', containerPort: 8080 }],
        livenessProbe: httpProbe('web'),
        readinessProbe: httpProbe('web'),
        startupProbe: httpProbe('startup'),
      }),
    ],
    acceptedFacts: [
      manifestFact(
        'startup-port-name',
        'deployment/app',
        'spec.template.spec.containers[0].startupProbe.httpGet.port',
        'startup',
        'The startup probe targets the named port startup.'
      ),
      manifestFact(
        'declared-port-name',
        'deployment/app',
        'spec.template.spec.containers[0].ports[0]',
        '{"containerPort":8080,"name":"web","protocol":"TCP"}',
        'The only declared container port is named web, so startup cannot resolve.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-startup-port',
        'deployment/app',
        'spec.template.spec.containers[0].ports[*].name',
        '["startup"]',
        'No declared container port is named startup.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-cpu-request-missing',
    title: 'Container CPU request is missing',
    description:
      'The application container defines a CPU limit and complete memory resources but omits its CPU request.',
    taskPrompt:
      'Review the `app` Deployment resource allocation and identify any missing scheduling input. Cite the exact resource fields and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.resources'],
    setup: [
      deployment('app', 2, {
        resources: {
          requests: { memory: '128Mi' },
          limits: { cpu: '500m', memory: '256Mi' },
        },
      }),
    ],
    acceptedFacts: [
      manifestFact(
        'cpu-request-absent',
        'deployment/app',
        'spec.template.spec.containers[0].resources.requests.cpu',
        '<absent>',
        'The application container does not declare a CPU request.'
      ),
      manifestFact(
        'cpu-limit-present',
        'deployment/app',
        'spec.template.spec.containers[0].resources.limits.cpu',
        '500m',
        'A CPU limit is present, isolating the missing request predicate.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-cpu-request',
        'deployment/app',
        'spec.template.spec.containers[0].resources.requests.cpu',
        '500m',
        'The fixture does not declare this CPU request.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-cpu-limit-missing',
    title: 'Container CPU limit is missing',
    description:
      'The application container defines a CPU request and complete memory resources but omits its CPU limit.',
    taskPrompt:
      'Review the `app` Deployment resource bounds and identify any missing limit. Cite the exact resource fields and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.resources'],
    setup: [
      deployment('app', 2, {
        resources: {
          requests: { cpu: '100m', memory: '128Mi' },
          limits: { memory: '256Mi' },
        },
      }),
    ],
    acceptedFacts: [
      manifestFact(
        'cpu-limit-absent',
        'deployment/app',
        'spec.template.spec.containers[0].resources.limits.cpu',
        '<absent>',
        'The application container does not declare a CPU limit.'
      ),
      manifestFact(
        'cpu-request-present',
        'deployment/app',
        'spec.template.spec.containers[0].resources.requests.cpu',
        '100m',
        'A positive CPU request is present.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-cpu-limit',
        'deployment/app',
        'spec.template.spec.containers[0].resources.limits.cpu',
        '500m',
        'The fixture does not declare this CPU limit.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-memory-request-missing',
    title: 'Container memory request is missing',
    description:
      'The application container defines a memory limit and complete CPU resources but omits its memory request.',
    taskPrompt:
      'Review the `app` Deployment resource allocation and identify any missing scheduling input. Cite the exact resource fields and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.resources'],
    setup: [
      deployment('app', 2, {
        resources: {
          requests: { cpu: '100m' },
          limits: { cpu: '500m', memory: '256Mi' },
        },
      }),
    ],
    acceptedFacts: [
      manifestFact(
        'memory-request-absent',
        'deployment/app',
        'spec.template.spec.containers[0].resources.requests.memory',
        '<absent>',
        'The application container does not declare a memory request.'
      ),
      manifestFact(
        'memory-limit-present',
        'deployment/app',
        'spec.template.spec.containers[0].resources.limits.memory',
        '256Mi',
        'A memory limit is present, isolating the missing request predicate.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-memory-request',
        'deployment/app',
        'spec.template.spec.containers[0].resources.requests.memory',
        '128Mi',
        'The fixture does not declare this memory request.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-memory-limit-missing',
    title: 'Container memory limit is missing',
    description:
      'The application container defines a memory request and complete CPU resources but omits its memory limit.',
    taskPrompt:
      'Review the `app` Deployment resource bounds and identify any missing limit. Cite the exact resource fields and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.resources'],
    setup: [
      deployment('app', 2, {
        resources: {
          requests: { cpu: '100m', memory: '128Mi' },
          limits: { cpu: '500m' },
        },
      }),
    ],
    acceptedFacts: [
      manifestFact(
        'memory-limit-absent',
        'deployment/app',
        'spec.template.spec.containers[0].resources.limits.memory',
        'absent',
        'The application container does not declare a memory limit.'
      ),
      manifestFact(
        'memory-request-present',
        'deployment/app',
        'spec.template.spec.containers[0].resources.requests.memory',
        '128Mi',
        'A positive memory request is present.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-memory-limit',
        'deployment/app',
        'spec.template.spec.containers[0].resources.limits.memory',
        '256Mi',
        'The fixture does not declare this memory limit.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-image-pull-policy',
    title: 'Image pull policy is not Always',
    description: 'A tag-based application image explicitly uses IfNotPresent rather than Always.',
    taskPrompt:
      'Review how the `app` Deployment obtains its tagged container image and identify any freshness risk. Cite the exact image fields and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.image'],
    setup: [
      deployment('app', 2, {
        image: 'registry.k8s.io/pause:3.10',
        imagePullPolicy: 'IfNotPresent',
      }),
    ],
    acceptedFacts: [
      manifestFact(
        'tag-based-image',
        'deployment/app',
        'spec.template.spec.containers[0].image',
        'registry.k8s.io/pause:3.10',
        'The application image uses a mutable tag reference rather than a digest.'
      ),
      manifestFact(
        'if-not-present-policy',
        'deployment/app',
        'spec.template.spec.containers[0].imagePullPolicy',
        'IfNotPresent',
        'The kubelet may reuse a cached image for this tag.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-always-policy',
        'deployment/app',
        'spec.template.spec.containers[0].imagePullPolicy',
        'Always',
        'The fixture does not request an image pull on every container start.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-blocked-image-registry',
    title: 'Container uses a disallowed image registry',
    description:
      'A namespace-scoped image policy ConfigMap allows registry.k8s.io while its application image comes from docker.io.',
    taskPrompt:
      'Compare the `app` Deployment image source with the namespace image-source policy. Cite both exact values and do not mutate resources.',
    visibleResourceRefs: ['configmap/image-policy', 'deployment/app'],
    observationKinds: ['configmap.data', 'deployment.pod-template', 'container.image'],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'image-policy' },
        data: { allowedImageRegistries: 'registry.k8s.io' },
      },
      deployment('app', 2, { image: 'docker.io/library/nginx:1.27.4' }),
    ],
    acceptedFacts: [
      manifestFact(
        'allowed-registry',
        'configmap/image-policy',
        'data.allowedImageRegistries',
        'registry.k8s.io',
        'The fixture policy permits images only from registry.k8s.io.'
      ),
      manifestFact(
        'outside-registry-image',
        'deployment/app',
        'spec.template.spec.containers[0].image',
        'docker.io/library/nginx:1.27.4',
        'The application image is hosted by docker.io, outside the declared allowlist.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-allowed-image',
        'deployment/app',
        'spec.template.spec.containers[0].image',
        'registry.k8s.io/pause:3.10',
        'The application does not use an image from the allowed registry.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-missing-pod-disruption-budget',
    title: 'Replicated workload has no PodDisruptionBudget',
    description: 'A three-replica Deployment has no PodDisruptionBudget selecting its pods.',
    taskPrompt:
      'Review voluntary-disruption protection for the `web` Deployment. Cite its replica count and the matching budget inventory; do not mutate resources.',
    visibleResourceRefs: ['deployment/web', 'poddisruptionbudget/*'],
    observationKinds: [
      'deployment.scale',
      'deployment.pod-template-labels',
      'poddisruptionbudget.list',
    ],
    setup: [deployment('web', 3)],
    acceptedFacts: [
      manifestFact(
        'replicated-workload',
        'deployment/web',
        'spec.replicas',
        '3',
        'The web workload has three desired replicas.'
      ),
      manifestFact(
        'pdb-inventory-empty',
        'poddisruptionbudget/*',
        'items.length',
        '0',
        'No PodDisruptionBudget exists to select the web pods.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-web-budget',
        'poddisruptionbudget/web',
        'spec.selector.matchLabels',
        '{"app":"web"}',
        'The fixture contains no PodDisruptionBudget for web.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-pdb-policy-missing',
    title: 'PodDisruptionBudget has no availability policy',
    description:
      'A PodDisruptionBudget selects application pods but defines neither minAvailable nor maxUnavailable.',
    taskPrompt:
      'Review the `app-budget` availability policy and determine whether it places a disruption bound. Cite exact fields and do not mutate resources.',
    visibleResourceRefs: ['poddisruptionbudget/app-budget'],
    observationKinds: ['poddisruptionbudget.selector', 'poddisruptionbudget.availability-policy'],
    setup: [pdb('app-budget', 'app')],
    acceptedFacts: [
      manifestFact(
        'minimum-absent',
        'poddisruptionbudget/app-budget',
        'spec.minAvailable',
        'absent',
        'The budget does not define minAvailable.'
      ),
      manifestFact(
        'maximum-absent',
        'poddisruptionbudget/app-budget',
        'spec.maxUnavailable',
        'absent',
        'The budget does not define maxUnavailable.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-availability-policy',
        'poddisruptionbudget/app-budget',
        'spec.maxUnavailable',
        '1',
        'The fixture does not set a maximum unavailable count.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-pdb-blocks-all-disruptions',
    title: 'PodDisruptionBudget blocks every voluntary disruption',
    description:
      'A PodDisruptionBudget for a three-replica Deployment sets maxUnavailable to zero.',
    taskPrompt:
      'Review whether the `web-budget` permits any voluntary disruption of `web`. Cite the replica and budget values; do not mutate resources.',
    visibleResourceRefs: ['deployment/web', 'poddisruptionbudget/web-budget'],
    observationKinds: ['deployment.scale', 'poddisruptionbudget.availability-policy'],
    setup: [deployment('web', 3), pdb('web-budget', 'web', { maxUnavailable: 0 })],
    acceptedFacts: [
      manifestFact(
        'replica-count',
        'deployment/web',
        'spec.replicas',
        '3',
        'The selected workload has three replicas.'
      ),
      manifestFact(
        'zero-unavailable',
        'poddisruptionbudget/web-budget',
        'spec.maxUnavailable',
        '0',
        'The budget permits zero selected pods to be voluntarily unavailable.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-disruption-allowance',
        'poddisruptionbudget/web-budget',
        'spec.maxUnavailable',
        '1',
        'The fixture does not permit one unavailable replica.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-pdb-exceeds-hpa-minimum',
    title: 'PodDisruptionBudget exceeds HPA minimum replicas',
    description:
      'A PodDisruptionBudget requires three available pods while the autoscaler may reduce the workload to two.',
    taskPrompt:
      'Compare the `api-budget` availability floor with the `api` autoscaling floor. Cite both exact values and do not mutate resources.',
    visibleResourceRefs: [
      'deployment/api',
      'horizontalpodautoscaler/api',
      'poddisruptionbudget/api-budget',
    ],
    observationKinds: ['horizontalpodautoscaler.bounds', 'poddisruptionbudget.availability-policy'],
    setup: [
      deployment('api', 3, {
        resources: {
          requests: { cpu: '100m', memory: '128Mi' },
          limits: { cpu: '500m', memory: '256Mi' },
        },
      }),
      hpa('autoscaling/v2', 'api', 'api'),
      pdb('api-budget', 'api', { minAvailable: 3 }),
    ],
    acceptedFacts: [
      manifestFact(
        'hpa-minimum',
        'horizontalpodautoscaler/api',
        'spec.minReplicas',
        '2',
        'The autoscaler may reduce the api Deployment to two replicas.'
      ),
      manifestFact(
        'pdb-minimum',
        'poddisruptionbudget/api-budget',
        'spec.minAvailable',
        '3',
        'The disruption budget requires three available pods, exceeding the autoscaling floor.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-compatible-budget',
        'poddisruptionbudget/api-budget',
        'spec.minAvailable',
        '2',
        'The fixture budget is not bounded at the autoscaler minimum.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-missing-pod-anti-affinity',
    title: 'Replicas lack host anti-affinity',
    description:
      'A three-replica Deployment has neither hostname anti-affinity nor an equivalent topology spread constraint.',
    taskPrompt:
      'Review how the `web` Deployment distributes replicas across nodes. Cite the replica count and placement fields; do not mutate resources.',
    visibleResourceRefs: ['deployment/web'],
    observationKinds: ['deployment.scale', 'pod.scheduling-constraints'],
    setup: [deployment('web', 3)],
    acceptedFacts: [
      manifestFact(
        'replica-count',
        'deployment/web',
        'spec.replicas',
        '3',
        'The web workload requests three replicas.'
      ),
      manifestFact(
        'anti-affinity-absent',
        'deployment/web',
        'spec.template.spec.affinity.podAntiAffinity',
        'absent',
        'The Pod template has no pod anti-affinity.'
      ),
      manifestFact(
        'spread-constraint-absent',
        'deployment/web',
        'spec.template.spec.topologySpreadConstraints',
        'absent',
        'The Pod template has no equivalent topology spread constraint.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-hostname-spread',
        'deployment/web',
        'spec.template.spec.topologySpreadConstraints[0].topologyKey',
        'kubernetes.io/hostname',
        'The fixture declares no hostname spread constraint.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-missing-topology-spread',
    title: 'Workload lacks topology spread constraints',
    description: 'A four-replica Deployment omits topologySpreadConstraints.',
    taskPrompt:
      'Review whether the `worker` Deployment explicitly spreads replicas across failure domains. Cite the relevant scale and scheduling fields; do not mutate resources.',
    visibleResourceRefs: ['deployment/worker'],
    observationKinds: ['deployment.scale', 'pod.scheduling-constraints'],
    setup: [
      deployment(
        'worker',
        4,
        {},
        {
          affinity: {
            podAntiAffinity: {
              requiredDuringSchedulingIgnoredDuringExecution: [
                {
                  labelSelector: { matchLabels: { app: 'worker' } },
                  topologyKey: 'kubernetes.io/hostname',
                },
              ],
            },
          },
        }
      ),
    ],
    acceptedFacts: [
      manifestFact(
        'replica-count',
        'deployment/worker',
        'spec.replicas',
        '4',
        'The worker workload requests four replicas.'
      ),
      manifestFact(
        'topology-spread-absent',
        'deployment/worker',
        'spec.template.spec.topologySpreadConstraints',
        'absent',
        'The Pod template has no topology spread constraints.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-zone-spread',
        'deployment/worker',
        'spec.template.spec.topologySpreadConstraints[0].topologyKey',
        'topology.kubernetes.io/zone',
        'The fixture declares no zone spread constraint.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-non-rolling-deployment',
    title: 'Deployment does not use RollingUpdate',
    description: 'A Service-targeted Deployment uses the Recreate update strategy.',
    taskPrompt:
      'Review update availability for the `web` workload behind the `web` Service. Cite the selector relationship and update strategy; do not mutate resources.',
    visibleResourceRefs: ['deployment/web', 'service/web'],
    observationKinds: ['deployment.strategy', 'deployment.pod-template-labels', 'service.selector'],
    setup: [
      deployment('web', 3, {}, {}, { strategy: { type: 'Recreate' } }),
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'web' },
        spec: { selector: { app: 'web' }, ports: [{ name: 'http', port: 80, targetPort: 8080 }] },
      },
    ],
    acceptedFacts: [
      manifestFact(
        'service-selects-workload',
        'service/web',
        'spec.selector',
        '{"app":"web"}',
        'The Service selects the web Deployment pods.'
      ),
      manifestFact(
        'recreate-strategy',
        'deployment/web',
        'spec.strategy.type',
        'Recreate',
        'The Deployment replaces all old pods rather than rolling the update.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-rolling-update',
        'deployment/web',
        'spec.strategy.type',
        'RollingUpdate',
        'The fixture explicitly selects the Recreate strategy.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-workload-selector-mismatch',
    title: 'Workload selector does not match pod labels',
    description: 'A Deployment manifest selects app=api while its Pod template is labeled app=web.',
    taskPrompt:
      'Review whether the `web` Deployment selector can match its Pod template. Cite both exact label maps; treat the object as a manifest file and do not submit it.',
    visibleResourceRefs: ['manifest/deployment/web'],
    observationKinds: ['manifest.workload-selector', 'manifest.pod-template-labels'],
    setup: [
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'web' },
        spec: {
          replicas: 2,
          selector: { matchLabels: { app: 'api' } },
          template: {
            metadata: { labels: { app: 'web' } },
            spec: { containers: [container()] },
          },
        },
      },
    ],
    acceptedFacts: [
      manifestFact(
        'deployment-selector',
        'manifest/deployment/web',
        'spec.selector.matchLabels',
        '{"app":"api"}',
        'The Deployment selector requires app=api.'
      ),
      manifestFact(
        'pod-template-labels',
        'manifest/deployment/web',
        'spec.template.metadata.labels',
        '{"app":"web"}',
        'The Pod template instead supplies app=web, so the selector is not a subset.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-matching-label',
        'manifest/deployment/web',
        'spec.template.metadata.labels.app',
        'api',
        'The Pod template app label is web, not api.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
  {
    scenarioId: 'rule-gap-dangling-hpa-target',
    title: 'HorizontalPodAutoscaler target is missing',
    description:
      'A HorizontalPodAutoscaler names an api Deployment that is absent from the namespace.',
    taskPrompt:
      'Resolve the `api` autoscaler target against the namespace workload inventory. Cite the target reference and retrieval result; do not mutate resources.',
    visibleResourceRefs: ['horizontalpodautoscaler/api', 'deployment/api'],
    observationKinds: ['horizontalpodautoscaler.scale-target-ref', 'deployment.get'],
    setup: [hpa('autoscaling/v2', 'api', 'missing-api')],
    acceptedFacts: [
      manifestFact(
        'hpa-target-reference',
        'horizontalpodautoscaler/api',
        'spec.scaleTargetRef',
        '{"apiVersion":"apps/v1","kind":"Deployment","name":"missing-api"}',
        'The autoscaler targets Deployment missing-api.'
      ),
      manifestFact(
        'target-not-found',
        'deployment/missing-api',
        'metadata.name',
        '<absent>',
        'No Deployment named missing-api exists in the scenario namespace.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-target',
        'deployment/missing-api',
        'metadata.name',
        'missing-api',
        'The referenced Deployment is absent from the fixture.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-ingress-without-valid-tls',
    title: 'Ingress lacks matching TLS coverage',
    description:
      'An Ingress routes app.example.test but its TLS hosts cover only internal.example.test.',
    taskPrompt:
      'Compare routed hosts with TLS coverage on the `web` Ingress. Cite the exact rule and TLS host values; do not mutate resources.',
    visibleResourceRefs: ['ingress/web', 'service/web', 'secret/web-tls'],
    observationKinds: ['ingress.rules', 'ingress.tls', 'service.ports', 'secret.metadata'],
    setup: [
      {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: { name: 'web' },
        spec: {
          tls: [{ hosts: ['internal.example.test'], secretName: 'web-tls' }],
          rules: [
            {
              host: 'app.example.test',
              http: {
                paths: [
                  {
                    path: '/',
                    pathType: 'Prefix',
                    backend: { service: { name: 'web', port: { number: 80 } } },
                  },
                ],
              },
            },
          ],
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'web' },
        spec: { selector: { app: 'web' }, ports: [{ name: 'http', port: 80, targetPort: 8080 }] },
      },
      {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: 'web-tls' },
        type: 'kubernetes.io/tls',
        data: {
          'tls.crt': [
            'LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUJsVENDQVR1Z0F3SUJBZ0lVYUNybFQySVg2THAy',
            'WnVIcVErbEdpT0J5MW9zd0NnWUlLb1pJemowRUF3SXcKSURFZU1Cd0dBMVVFQXd3VmFXNTBaWEp1WVd3',
            'dVpYaGhiWEJzWlM1MFpYTjBNQjRYRFRJMk1Ea3lNREV4TXpZegpNRm9YRFRNMk1Ea3hOekV4TXpZek1G',
            'b3dJREVlTUJ3R0ExVUVBd3dWYVc1MFpYSnVZV3d1WlhoaGJYQnNaUzUwClpYTjBNRmt3RXdZSEtvWkl6',
            'ajBDQVFZSUtvWkl6ajBEQVFjRFFnQUV4Wml6cVVUV3NiMkpKNTZKRStBMkVncVIKMVl4SWVDRkY0UWU0',
            'WC9KRjBCR2JOYnNNU20vcy9rcy8ySHRacDZURlBJekdRcVpLUjJLUUg3SG41dGU4Q3FOVApNRkV3SFFZ',
            'RFZSME9CQllFRkdpQUo1OGNxUkRCVGVUdnpyYzlXYXlWelo1Q01COEdBMVVkSXdRWU1CYUFGR2lBCko1',
            'OGNxUkRCVGVUdnpyYzlXYXlWelo1Q01BOEdBMVVkRXdFQi93UUZNQU1CQWY4d0NnWUlLb1pJemowRUF3',
            'SUQKU0FBd1JRSWdOYng3RmtGaEVDTTNIQ3hpS0Y2UDNqQlBidFVpQ2NTcXdyUmR0N05YVThJQ0lRRFlO',
            'bHBWNFBObApLVjJSMTM0NnR6WDVMa0JRVnVqZzhMOGJVcmtsL3NiWVhRPT0KLS0tLS1FTkQgQ0VSVElG',
            'SUNBVEUtLS0tLQo=',
          ].join(''),
          'tls.key': [
            'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tCk1JR0hBZ0VBTUJNR0J5cUdTTTQ5QWdFR0NDcUdTTTQ5',
            'QXdFSEJHMHdhd0lCQVFRZ2RzZVkwRkVNRmxRQ2NmTmEKdVN4eGVCVEdmdlhZRjJFVGFqWXhqOWJhNG5h',
            'aFJBTkNBQVRGbUxPcFJOYXh2WWtubm9rVDREWVNDcEhWakVoNApJVVhoQjdoZjhrWFFFWnMxdXd4S2Ir',
            'eitTei9ZZTFtbnBNVThqTVpDcGtwSFlwQWZzZWZtMTd3SwotLS0tLUVORCBQUklWQVRFIEtFWS0tLS0t',
            'Cg==',
          ].join(''),
        },
      },
    ],
    acceptedFacts: [
      manifestFact(
        'routed-host',
        'ingress/web',
        'spec.rules[0].host',
        'app.example.test',
        'The Ingress routes app.example.test.'
      ),
      manifestFact(
        'tls-hosts',
        'ingress/web',
        'spec.tls[0].hosts',
        '["internal.example.test"]',
        'TLS coverage names only internal.example.test and omits the routed host.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-route-coverage',
        'ingress/web',
        'spec.tls[*].hosts',
        '["app.example.test"]',
        'No TLS hosts entry covers app.example.test.'
      ),
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: apiServerProfiles,
  },
  {
    scenarioId: 'rule-gap-deprecated-certificate-signing-request',
    title: 'Deprecated CertificateSigningRequest API',
    description: 'A CertificateSigningRequest manifest uses certificates.k8s.io/v1beta1.',
    taskPrompt:
      'Review the API compatibility of the `legacy-client` certificate request manifest. Cite the exact object identity and API version; do not submit the file.',
    visibleResourceRefs: ['manifest/certificatesigningrequest/legacy-client'],
    observationKinds: ['manifest.api-version', 'manifest.object-identity'],
    setup: [
      {
        apiVersion: 'certificates.k8s.io/v1beta1',
        kind: 'CertificateSigningRequest',
        metadata: { name: 'legacy-client' },
        spec: {
          request: 'Y2VydGlmaWNhdGUtc2lnbmluZy1yZXF1ZXN0',
          signerName: 'kubernetes.io/kube-apiserver-client',
          usages: ['client auth'],
        },
      },
    ],
    acceptedFacts: [
      manifestFact(
        'deprecated-csr-version',
        'manifest/certificatesigningrequest/legacy-client',
        'apiVersion',
        'certificates.k8s.io/v1beta1',
        'The certificate request uses the deprecated v1beta1 API.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-current-csr-version',
        'manifest/certificatesigningrequest/legacy-client',
        'apiVersion',
        'certificates.k8s.io/v1',
        'The manifest does not use the current certificates API.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
  {
    scenarioId: 'rule-gap-deprecated-cronjob-apis',
    title: 'Deprecated CronJob API tuple',
    description: 'CronJob and CronJobList manifests use batch/v1beta1.',
    taskPrompt:
      'Review the API compatibility of the scheduled workload manifests. Report each deprecated object with its exact API version; do not submit the files.',
    visibleResourceRefs: ['manifest/cronjob/legacy-backup', 'manifest/cronjoblist/legacy-cronjobs'],
    observationKinds: ['manifest.api-version', 'manifest.list-items'],
    setup: [
      cronJob('batch/v1beta1', 'legacy-backup'),
      {
        apiVersion: 'batch/v1beta1',
        kind: 'CronJobList',
        metadata: { resourceVersion: 'fixture-1' },
        items: [cronJob('batch/v1beta1', 'legacy-report')],
      },
    ],
    acceptedFacts: [
      manifestFact(
        'deprecated-cronjob-version',
        'manifest/cronjob/legacy-backup',
        'apiVersion',
        'batch/v1beta1',
        'The standalone CronJob uses batch/v1beta1.'
      ),
      manifestFact(
        'deprecated-cronjob-list-version',
        'manifest/cronjoblist/legacy-cronjobs',
        'apiVersion',
        'batch/v1beta1',
        'The CronJobList and its item use batch/v1beta1.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-current-cronjob-version',
        'manifest/cronjob/legacy-backup',
        'apiVersion',
        'batch/v1',
        'The CronJob manifests do not use batch/v1.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
  {
    scenarioId: 'rule-gap-deprecated-daemonset-apis',
    title: 'Deprecated DaemonSet API tuple',
    description: 'DaemonSet manifests use apps/v1beta2 and extensions/v1beta1.',
    taskPrompt:
      'Review the API compatibility of the node workload manifests. Report each deprecated object with its exact API version; do not submit the files.',
    visibleResourceRefs: [
      'manifest/daemonset/legacy-agent-apps',
      'manifest/daemonset/legacy-agent-extensions',
    ],
    observationKinds: ['manifest.api-version', 'manifest.object-identity'],
    setup: [
      legacyWorkload('apps/v1beta2', 'DaemonSet', 'legacy-agent-apps'),
      legacyWorkload('extensions/v1beta1', 'DaemonSet', 'legacy-agent-extensions'),
    ],
    acceptedFacts: [
      manifestFact(
        'deprecated-daemonset-apps-version',
        'manifest/daemonset/legacy-agent-apps',
        'apiVersion',
        'apps/v1beta2',
        'One DaemonSet uses apps/v1beta2.'
      ),
      manifestFact(
        'deprecated-daemonset-extensions-version',
        'manifest/daemonset/legacy-agent-extensions',
        'apiVersion',
        'extensions/v1beta1',
        'The other DaemonSet uses extensions/v1beta1.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-current-daemonset-version',
        'manifest/daemonset/legacy-agent-apps',
        'apiVersion',
        'apps/v1',
        'Neither fixture DaemonSet uses apps/v1.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
  {
    scenarioId: 'rule-gap-deprecated-deployment-apis',
    title: 'Deprecated Deployment API tuple',
    description: 'Deployment manifests use apps/v1beta1, apps/v1beta2, and extensions/v1beta1.',
    taskPrompt:
      'Review the API compatibility of the application workload manifests. Report each deprecated object with its exact API version; do not submit the files.',
    visibleResourceRefs: [
      'manifest/deployment/legacy-apps-v1beta1',
      'manifest/deployment/legacy-apps-v1beta2',
      'manifest/deployment/legacy-extensions-v1beta1',
    ],
    observationKinds: ['manifest.api-version', 'manifest.object-identity'],
    setup: [
      legacyWorkload('apps/v1beta1', 'Deployment', 'legacy-apps-v1beta1'),
      legacyWorkload('apps/v1beta2', 'Deployment', 'legacy-apps-v1beta2'),
      legacyWorkload('extensions/v1beta1', 'Deployment', 'legacy-extensions-v1beta1'),
    ],
    acceptedFacts: [
      manifestFact(
        'deprecated-deployment-apps-v1beta1',
        'manifest/deployment/legacy-apps-v1beta1',
        'apiVersion',
        'apps/v1beta1',
        'One Deployment uses apps/v1beta1.'
      ),
      manifestFact(
        'deprecated-deployment-apps-v1beta2',
        'manifest/deployment/legacy-apps-v1beta2',
        'apiVersion',
        'apps/v1beta2',
        'One Deployment uses apps/v1beta2.'
      ),
      manifestFact(
        'deprecated-deployment-extensions-v1beta1',
        'manifest/deployment/legacy-extensions-v1beta1',
        'apiVersion',
        'extensions/v1beta1',
        'One Deployment uses extensions/v1beta1.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-current-deployment-version',
        'manifest/deployment/legacy-apps-v1beta1',
        'apiVersion',
        'apps/v1',
        'None of the fixture Deployments uses apps/v1.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
  {
    scenarioId: 'rule-gap-deprecated-hpa-apis',
    title: 'Deprecated HorizontalPodAutoscaler API tuple',
    description:
      'HorizontalPodAutoscaler manifests use autoscaling/v2beta1 and autoscaling/v2beta2.',
    taskPrompt:
      'Review the API compatibility of the autoscaling manifests. Report each deprecated object with its exact API version; do not submit the files.',
    visibleResourceRefs: [
      'manifest/horizontalpodautoscaler/legacy-api',
      'manifest/horizontalpodautoscalerlist/legacy-autoscalers',
    ],
    observationKinds: ['manifest.api-version', 'manifest.list-items'],
    setup: [
      hpa('autoscaling/v2beta1', 'legacy-api', 'api'),
      {
        apiVersion: 'autoscaling/v2beta2',
        kind: 'HorizontalPodAutoscalerList',
        metadata: { resourceVersion: 'fixture-1' },
        items: [hpa('autoscaling/v2beta2', 'legacy-worker', 'worker')],
      },
    ],
    acceptedFacts: [
      manifestFact(
        'deprecated-hpa-v2beta1',
        'manifest/horizontalpodautoscaler/legacy-api',
        'apiVersion',
        'autoscaling/v2beta1',
        'The standalone autoscaler uses autoscaling/v2beta1.'
      ),
      manifestFact(
        'deprecated-hpa-v2beta2-list',
        'manifest/horizontalpodautoscalerlist/legacy-autoscalers',
        'apiVersion',
        'autoscaling/v2beta2',
        'The autoscaler list and its item use autoscaling/v2beta2.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-current-hpa-version',
        'manifest/horizontalpodautoscaler/legacy-api',
        'apiVersion',
        'autoscaling/v2',
        'The fixture autoscalers do not use autoscaling/v2.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
  {
    scenarioId: 'rule-gap-deprecated-ingress-apis',
    title: 'Deprecated Ingress API tuple',
    description: 'Ingress manifests use extensions/v1beta1 and networking.k8s.io/v1beta1 APIs.',
    taskPrompt:
      'Review the API compatibility of the ingress manifests. Report each deprecated object with its exact API version; do not submit the files.',
    visibleResourceRefs: ['manifest/ingress/legacy-web', 'manifest/ingressclass/legacy-public'],
    observationKinds: ['manifest.api-version', 'manifest.object-identity'],
    setup: [
      {
        apiVersion: 'extensions/v1beta1',
        kind: 'Ingress',
        metadata: { name: 'legacy-web' },
        spec: {
          rules: [
            {
              host: 'legacy.example.test',
              http: {
                paths: [
                  {
                    path: '/',
                    backend: { serviceName: 'web', servicePort: 80 },
                  },
                ],
              },
            },
          ],
        },
      },
      {
        apiVersion: 'networking.k8s.io/v1beta1',
        kind: 'IngressClass',
        metadata: { name: 'legacy-public' },
        spec: { controller: 'example.test/ingress-controller' },
      },
    ],
    acceptedFacts: [
      manifestFact(
        'deprecated-extensions-ingress',
        'manifest/ingress/legacy-web',
        'apiVersion',
        'extensions/v1beta1',
        'The Ingress uses extensions/v1beta1.'
      ),
      manifestFact(
        'deprecated-networking-ingress-class',
        'manifest/ingressclass/legacy-public',
        'apiVersion',
        'networking.k8s.io/v1beta1',
        'The IngressClass uses networking.k8s.io/v1beta1.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-current-ingress-version',
        'manifest/ingress/legacy-web',
        'apiVersion',
        'networking.k8s.io/v1',
        'The ingress fixtures do not exclusively use the current API.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
  {
    scenarioId: 'rule-gap-deprecated-pdb-apis',
    title: 'Deprecated PodDisruptionBudget API tuple',
    description: 'PodDisruptionBudget and PodDisruptionBudgetList manifests use policy/v1beta1.',
    taskPrompt:
      'Review the API compatibility of the disruption budget manifests. Report each deprecated object with its exact API version; do not submit the files.',
    visibleResourceRefs: [
      'manifest/poddisruptionbudget/legacy-api-budget',
      'manifest/poddisruptionbudgetlist/legacy-budgets',
    ],
    observationKinds: ['manifest.api-version', 'manifest.list-items'],
    setup: [
      {
        apiVersion: 'policy/v1beta1',
        kind: 'PodDisruptionBudget',
        metadata: { name: 'legacy-api-budget' },
        spec: { minAvailable: 1, selector: { matchLabels: { app: 'api' } } },
      },
      {
        apiVersion: 'policy/v1beta1',
        kind: 'PodDisruptionBudgetList',
        metadata: { resourceVersion: 'fixture-1' },
        items: [
          {
            apiVersion: 'policy/v1beta1',
            kind: 'PodDisruptionBudget',
            metadata: { name: 'legacy-worker-budget' },
            spec: { maxUnavailable: 1, selector: { matchLabels: { app: 'worker' } } },
          },
        ],
      },
    ],
    acceptedFacts: [
      manifestFact(
        'deprecated-pdb-version',
        'manifest/poddisruptionbudget/legacy-api-budget',
        'apiVersion',
        'policy/v1beta1',
        'The standalone disruption budget uses policy/v1beta1.'
      ),
      manifestFact(
        'deprecated-pdb-list-version',
        'manifest/poddisruptionbudgetlist/legacy-budgets',
        'apiVersion',
        'policy/v1beta1',
        'The budget list and its item use policy/v1beta1.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-current-pdb-version',
        'manifest/poddisruptionbudget/legacy-api-budget',
        'apiVersion',
        'policy/v1',
        'The fixture budgets do not use policy/v1.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
  {
    scenarioId: 'rule-gap-deprecated-pod-security-policy-apis',
    title: 'Deprecated PodSecurityPolicy API tuple',
    description: 'PodSecurityPolicy manifests use extensions/v1beta1 and policy/v1beta1.',
    taskPrompt:
      'Review the API compatibility of the pod security manifests. Report each deprecated object with its exact API version; do not submit the files.',
    visibleResourceRefs: [
      'manifest/podsecuritypolicy/legacy-restricted-extensions',
      'manifest/podsecuritypolicy/legacy-restricted-policy',
    ],
    observationKinds: ['manifest.api-version', 'manifest.object-identity'],
    setup: [
      {
        apiVersion: 'extensions/v1beta1',
        kind: 'PodSecurityPolicy',
        metadata: { name: 'legacy-restricted-extensions' },
        spec: {
          privileged: false,
          allowPrivilegeEscalation: false,
          runAsUser: { rule: 'MustRunAsNonRoot' },
          seLinux: { rule: 'RunAsAny' },
          supplementalGroups: { rule: 'RunAsAny' },
          fsGroup: { rule: 'RunAsAny' },
          volumes: ['configMap', 'emptyDir', 'secret'],
        },
      },
      {
        apiVersion: 'policy/v1beta1',
        kind: 'PodSecurityPolicy',
        metadata: { name: 'legacy-restricted-policy' },
        spec: {
          privileged: false,
          allowPrivilegeEscalation: false,
          runAsUser: { rule: 'MustRunAsNonRoot' },
          seLinux: { rule: 'RunAsAny' },
          supplementalGroups: { rule: 'RunAsAny' },
          fsGroup: { rule: 'RunAsAny' },
          volumes: ['configMap', 'emptyDir', 'secret'],
        },
      },
    ],
    acceptedFacts: [
      manifestFact(
        'deprecated-extensions-psp',
        'manifest/podsecuritypolicy/legacy-restricted-extensions',
        'apiVersion',
        'extensions/v1beta1',
        'One PodSecurityPolicy uses extensions/v1beta1.'
      ),
      manifestFact(
        'deprecated-policy-psp',
        'manifest/podsecuritypolicy/legacy-restricted-policy',
        'apiVersion',
        'policy/v1beta1',
        'The other PodSecurityPolicy uses policy/v1beta1.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-supported-psp-api',
        'manifest/podsecuritypolicy/legacy-restricted-policy',
        'apiVersion',
        'policy/v1',
        'There is no policy/v1 PodSecurityPolicy API in the fixture or Kubernetes.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
  {
    scenarioId: 'rule-gap-deprecated-priority-class-apis',
    title: 'Deprecated PriorityClass API tuple',
    description:
      'PriorityClass manifests use scheduling.k8s.io/v1alpha1 and scheduling.k8s.io/v1beta1.',
    taskPrompt:
      'Review the API compatibility of the workload priority manifests. Report each deprecated object with its exact API version; do not submit the files.',
    visibleResourceRefs: [
      'manifest/priorityclass/legacy-batch-alpha',
      'manifest/priorityclass/legacy-batch-beta',
    ],
    observationKinds: ['manifest.api-version', 'manifest.object-identity'],
    setup: [
      {
        apiVersion: 'scheduling.k8s.io/v1alpha1',
        kind: 'PriorityClass',
        metadata: { name: 'legacy-batch-alpha' },
        value: 1000,
        globalDefault: false,
        description: 'Priority for legacy batch workloads.',
      },
      {
        apiVersion: 'scheduling.k8s.io/v1beta1',
        kind: 'PriorityClass',
        metadata: { name: 'legacy-batch-beta' },
        value: 2000,
        globalDefault: false,
        description: 'Priority for legacy batch workers.',
      },
    ],
    acceptedFacts: [
      manifestFact(
        'deprecated-priority-alpha',
        'manifest/priorityclass/legacy-batch-alpha',
        'apiVersion',
        'scheduling.k8s.io/v1alpha1',
        'One PriorityClass uses scheduling.k8s.io/v1alpha1.'
      ),
      manifestFact(
        'deprecated-priority-beta',
        'manifest/priorityclass/legacy-batch-beta',
        'apiVersion',
        'scheduling.k8s.io/v1beta1',
        'The other PriorityClass uses scheduling.k8s.io/v1beta1.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-current-priority-version',
        'manifest/priorityclass/legacy-batch-alpha',
        'apiVersion',
        'scheduling.k8s.io/v1',
        'Neither fixture PriorityClass uses scheduling.k8s.io/v1.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
  {
    scenarioId: 'rule-gap-deprecated-replicaset-apis',
    title: 'Deprecated ReplicaSet API tuple',
    description: 'ReplicaSet manifests use apps/v1beta1, apps/v1beta2, and extensions/v1beta1.',
    taskPrompt:
      'Review the API compatibility of the replica controller manifests. Report each deprecated object with its exact API version; do not submit the files.',
    visibleResourceRefs: [
      'manifest/replicaset/legacy-apps-v1beta1',
      'manifest/replicaset/legacy-apps-v1beta2',
      'manifest/replicaset/legacy-extensions-v1beta1',
    ],
    observationKinds: ['manifest.api-version', 'manifest.object-identity'],
    setup: [
      legacyWorkload('apps/v1beta1', 'ReplicaSet', 'legacy-apps-v1beta1'),
      legacyWorkload('apps/v1beta2', 'ReplicaSet', 'legacy-apps-v1beta2'),
      legacyWorkload('extensions/v1beta1', 'ReplicaSet', 'legacy-extensions-v1beta1'),
    ],
    acceptedFacts: [
      manifestFact(
        'deprecated-replicaset-apps-v1beta1',
        'manifest/replicaset/legacy-apps-v1beta1',
        'apiVersion',
        'apps/v1beta1',
        'One ReplicaSet uses apps/v1beta1.'
      ),
      manifestFact(
        'deprecated-replicaset-apps-v1beta2',
        'manifest/replicaset/legacy-apps-v1beta2',
        'apiVersion',
        'apps/v1beta2',
        'One ReplicaSet uses apps/v1beta2.'
      ),
      manifestFact(
        'deprecated-replicaset-extensions-v1beta1',
        'manifest/replicaset/legacy-extensions-v1beta1',
        'apiVersion',
        'extensions/v1beta1',
        'One ReplicaSet uses extensions/v1beta1.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-current-replicaset-version',
        'manifest/replicaset/legacy-apps-v1beta1',
        'apiVersion',
        'apps/v1',
        'None of the fixture ReplicaSets uses apps/v1.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
  {
    scenarioId: 'rule-gap-deprecated-runtime-class-api',
    title: 'Deprecated RuntimeClass API',
    description: 'A RuntimeClass manifest uses node.k8s.io/v1beta1.',
    taskPrompt:
      'Review the API compatibility of the `legacy-sandbox` runtime manifest. Cite the exact object identity and API version; do not submit the file.',
    visibleResourceRefs: ['manifest/runtimeclass/legacy-sandbox'],
    observationKinds: ['manifest.api-version', 'manifest.object-identity'],
    setup: [
      {
        apiVersion: 'node.k8s.io/v1beta1',
        kind: 'RuntimeClass',
        metadata: { name: 'legacy-sandbox' },
        handler: 'runc',
      },
    ],
    acceptedFacts: [
      manifestFact(
        'deprecated-runtime-class-version',
        'manifest/runtimeclass/legacy-sandbox',
        'apiVersion',
        'node.k8s.io/v1beta1',
        'The RuntimeClass uses node.k8s.io/v1beta1.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-current-runtime-class-version',
        'manifest/runtimeclass/legacy-sandbox',
        'apiVersion',
        'node.k8s.io/v1',
        'The fixture RuntimeClass does not use node.k8s.io/v1.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
  {
    scenarioId: 'rule-gap-deprecated-statefulset-apis',
    title: 'Deprecated StatefulSet API tuple',
    description: 'StatefulSet manifests use apps/v1beta1 and apps/v1beta2.',
    taskPrompt:
      'Review the API compatibility of the stateful workload manifests. Report each deprecated object with its exact API version; do not submit the files.',
    visibleResourceRefs: [
      'manifest/statefulset/legacy-db-v1beta1',
      'manifest/statefulset/legacy-db-v1beta2',
    ],
    observationKinds: ['manifest.api-version', 'manifest.object-identity'],
    setup: [
      {
        ...legacyWorkload('apps/v1beta1', 'StatefulSet', 'legacy-db-v1beta1'),
        spec: {
          serviceName: 'legacy-db',
          replicas: 2,
          selector: { matchLabels: { app: 'legacy-db-v1beta1' } },
          template: {
            metadata: { labels: { app: 'legacy-db-v1beta1' } },
            spec: { containers: [container()] },
          },
        },
      },
      {
        ...legacyWorkload('apps/v1beta2', 'StatefulSet', 'legacy-db-v1beta2'),
        spec: {
          serviceName: 'legacy-db',
          replicas: 2,
          selector: { matchLabels: { app: 'legacy-db-v1beta2' } },
          template: {
            metadata: { labels: { app: 'legacy-db-v1beta2' } },
            spec: { containers: [container()] },
          },
        },
      },
    ],
    acceptedFacts: [
      manifestFact(
        'deprecated-statefulset-v1beta1',
        'manifest/statefulset/legacy-db-v1beta1',
        'apiVersion',
        'apps/v1beta1',
        'One StatefulSet uses apps/v1beta1.'
      ),
      manifestFact(
        'deprecated-statefulset-v1beta2',
        'manifest/statefulset/legacy-db-v1beta2',
        'apiVersion',
        'apps/v1beta2',
        'The other StatefulSet uses apps/v1beta2.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-current-statefulset-version',
        'manifest/statefulset/legacy-db-v1beta1',
        'apiVersion',
        'apps/v1',
        'Neither fixture StatefulSet uses apps/v1.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
  {
    scenarioId: 'rule-gap-deprecated-storage-class-api',
    title: 'Deprecated StorageClass API',
    description: 'A StorageClass manifest uses storage.k8s.io/v1beta1.',
    taskPrompt:
      'Review the API compatibility of the `legacy-standard` storage manifest. Cite the exact object identity and API version; do not submit the file.',
    visibleResourceRefs: ['manifest/storageclass/legacy-standard'],
    observationKinds: ['manifest.api-version', 'manifest.object-identity'],
    setup: [
      {
        apiVersion: 'storage.k8s.io/v1beta1',
        kind: 'StorageClass',
        metadata: { name: 'legacy-standard' },
        provisioner: 'kubernetes.io/no-provisioner',
        volumeBindingMode: 'WaitForFirstConsumer',
      },
    ],
    acceptedFacts: [
      manifestFact(
        'deprecated-storage-class-version',
        'manifest/storageclass/legacy-standard',
        'apiVersion',
        'storage.k8s.io/v1beta1',
        'The StorageClass uses storage.k8s.io/v1beta1.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-current-storage-class-version',
        'manifest/storageclass/legacy-standard',
        'apiVersion',
        'storage.k8s.io/v1',
        'The fixture StorageClass does not use storage.k8s.io/v1.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
  {
    scenarioId: 'rule-gap-deprecated-volume-attachment-api',
    title: 'Deprecated VolumeAttachment API',
    description: 'A VolumeAttachment manifest uses storage.k8s.io/v1beta1.',
    taskPrompt:
      'Review the API compatibility of the `legacy-disk-attachment` storage manifest. Cite the exact object identity and API version; do not submit the file.',
    visibleResourceRefs: ['manifest/volumeattachment/legacy-disk-attachment'],
    observationKinds: ['manifest.api-version', 'manifest.object-identity'],
    setup: [
      {
        apiVersion: 'storage.k8s.io/v1beta1',
        kind: 'VolumeAttachment',
        metadata: { name: 'legacy-disk-attachment' },
        spec: {
          attacher: 'disk.csi.example.test',
          nodeName: 'worker-1',
          source: { persistentVolumeName: 'data-volume' },
        },
      },
    ],
    acceptedFacts: [
      manifestFact(
        'deprecated-volume-attachment-version',
        'manifest/volumeattachment/legacy-disk-attachment',
        'apiVersion',
        'storage.k8s.io/v1beta1',
        'The VolumeAttachment uses storage.k8s.io/v1beta1.'
      ),
    ],
    contradictionFacts: [
      manifestFact(
        'invented-current-volume-attachment-version',
        'manifest/volumeattachment/legacy-disk-attachment',
        'apiVersion',
        'storage.k8s.io/v1',
        'The fixture VolumeAttachment does not use storage.k8s.io/v1.'
      ),
    ],
    requiredMechanisms: [],
    supportedClusterProfiles: fileAnalysisProfiles,
  },
];
