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

type Profiles = NonNullable<ScenarioDraftDefinition['supportedClusterProfiles']>;
type Mechanisms = NonNullable<ScenarioDraftDefinition['requiredMechanisms']>;

interface DraftOptions {
  scenarioId: string;
  title: string;
  resourceRefs: string[];
  setup: object[];
  resourceRef: string;
  fieldPath: string;
  brokenValue: string;
  finding: string;
  healthyValue: string;
  healthyDescription: string;
  observationKinds?: string[];
  mechanisms?: Mechanisms;
  profiles?: Profiles;
  additionalAcceptedFacts?: ScenarioDraftDefinition['acceptedFacts'];
}

const allProfiles: Profiles = ['local-kwok', 'local-minikube', 'aks'];
const runtimeProfiles: Profiles = ['local-minikube', 'aks'];
const minikubeProfile: Profiles = ['local-minikube'];
const fileProfile: Profiles = ['local-kwok'];
const pauseImage = 'registry.k8s.io/pause:3.10';
const busyboxImage = 'registry.k8s.io/e2e-test-images/busybox:1.29-4';

const fact = (
  fact_id: string,
  resource_ref: string,
  field_path: string,
  observed_value: string,
  description: string
) => ({ fact_id, resource_ref, field_path, observed_value, description });

const draft = (options: DraftOptions): ScenarioDraftDefinition => ({
  scenarioId: options.scenarioId,
  title: options.title,
  description: options.finding,
  taskPrompt:
    'Inspect the listed Kubernetes resources, diagnose the unsafe or unhealthy state, and cite the exact native field, status, event, metric, or log evidence. Do not mutate resources.',
  visibleResourceRefs: options.resourceRefs,
  observationKinds: options.observationKinds ?? ['manifest.object', 'manifest.field'],
  setup: options.setup,
  acceptedFacts: [
    fact(
      'trigger-evidence',
      options.resourceRef,
      options.fieldPath,
      options.brokenValue,
      options.finding
    ),
    ...(options.additionalAcceptedFacts ?? []),
  ],
  contradictionFacts: [
    fact(
      'healthy-or-confounding-state',
      options.resourceRef,
      options.fieldPath,
      options.healthyValue,
      options.healthyDescription
    ),
  ],
  requiredMechanisms: options.mechanisms ?? ['api-server'],
  supportedClusterProfiles: options.profiles ?? allProfiles,
});

const pod = (name: string, spec: Record<string, unknown>) => ({
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: { name, labels: { app: name } },
  spec,
});

const container = (overrides: Record<string, unknown> = {}) => ({
  name: 'app',
  image: pauseImage,
  securityContext: { allowPrivilegeEscalation: false, runAsNonRoot: true, runAsUser: 65532 },
  ...overrides,
});

const deployment = (name: string, replicas = 3, podSpec: Record<string, unknown> = {}) => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name },
  spec: {
    replicas,
    selector: { matchLabels: { app: name } },
    template: {
      metadata: { labels: { app: name } },
      spec: { containers: [container()], ...podSpec },
    },
  },
});

const statefulSet = (name: string) => ({
  apiVersion: 'apps/v1',
  kind: 'StatefulSet',
  metadata: { name },
  spec: {
    serviceName: name,
    replicas: 3,
    selector: { matchLabels: { app: name } },
    template: {
      metadata: { labels: { app: name } },
      spec: { containers: [container()] },
    },
  },
});

const serviceAccount = (name: string) => ({
  apiVersion: 'v1',
  kind: 'ServiceAccount',
  metadata: { name },
  automountServiceAccountToken: false,
});

const role = (name: string, apiGroups: string[], resources: string[], verbs: string[]) => ({
  apiVersion: 'rbac.authorization.k8s.io/v1',
  kind: 'Role',
  metadata: { name },
  rules: [{ apiGroups, resources, verbs }],
});

const roleBinding = (name: string, roleName: string, accountName: string) => ({
  apiVersion: 'rbac.authorization.k8s.io/v1',
  kind: 'RoleBinding',
  metadata: { name },
  roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: roleName },
  subjects: [{ kind: 'ServiceAccount', name: accountName }],
});

const actionJob = (
  name: string,
  image: string,
  command: string,
  containerOptions: Record<string, unknown> = {},
  podOptions: Record<string, unknown> = {}
) => ({
  apiVersion: 'batch/v1',
  kind: 'Job',
  metadata: { name, labels: { 'evals.kubernetes.io/bounded-action': 'true' } },
  spec: {
    activeDeadlineSeconds: 180,
    backoffLimit: 0,
    ttlSecondsAfterFinished: 300,
    template: {
      metadata: { labels: { app: name } },
      spec: {
        restartPolicy: 'Never',
        ...podOptions,
        containers: [
          {
            name: 'action',
            image,
            command: ['/bin/sh', '-ceu', command],
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
              runAsNonRoot: true,
              runAsUser: 1000,
            },
            ...containerOptions,
          },
        ],
      },
    },
  },
});

const policyDefinitions: ScenarioDraftDefinition[] = [
  draft({
    scenarioId: 'rule-gap-pod-shares-host-ipc',
    title: 'Pod shares the host IPC namespace',
    resourceRefs: ['pod/host-ipc-workload'],
    setup: [pod('host-ipc-workload', { hostIPC: true, containers: [container()] })],
    resourceRef: 'pod/host-ipc-workload',
    fieldPath: 'spec.hostIPC',
    brokenValue: 'true',
    finding: 'The Pod explicitly joins the node IPC namespace.',
    healthyValue: 'false or absent',
    healthyDescription: 'A healthy Pod does not join the node IPC namespace.',
  }),
  draft({
    scenarioId: 'rule-gap-pod-shares-host-pid',
    title: 'Pod shares the host process namespace',
    resourceRefs: ['pod/host-pid-workload'],
    setup: [pod('host-pid-workload', { hostPID: true, containers: [container()] })],
    resourceRef: 'pod/host-pid-workload',
    fieldPath: 'spec.hostPID',
    brokenValue: 'true',
    finding: 'The Pod explicitly joins the node process namespace.',
    healthyValue: 'false or absent',
    healthyDescription: 'A healthy Pod does not join the node process namespace.',
  }),
  draft({
    scenarioId: 'rule-gap-container-allows-privilege-escalation',
    title: 'Container allows privilege escalation',
    resourceRefs: ['pod/escalation-workload'],
    setup: [
      pod('escalation-workload', {
        containers: [container({ securityContext: { allowPrivilegeEscalation: true } })],
      }),
    ],
    resourceRef: 'pod/escalation-workload',
    fieldPath: 'spec.containers[0].securityContext.allowPrivilegeEscalation',
    brokenValue: 'true',
    finding: 'The application container explicitly permits privilege escalation.',
    healthyValue: 'false',
    healthyDescription: 'A healthy container explicitly disables privilege escalation.',
  }),
  draft({
    scenarioId: 'rule-gap-container-unmasks-proc',
    title: 'Container uses an unmasked proc mount',
    resourceRefs: ['pod/unmasked-proc-workload'],
    setup: [
      pod('unmasked-proc-workload', {
        hostUsers: false,
        containers: [container({ securityContext: { procMount: 'Unmasked' } })],
      }),
    ],
    resourceRef: 'pod/unmasked-proc-workload',
    fieldPath: 'spec.containers[0].securityContext.procMount',
    brokenValue: 'Unmasked',
    finding: 'The application container requests an unmasked proc filesystem.',
    healthyValue: 'Default or absent',
    healthyDescription: 'A healthy container uses the runtime default proc mask.',
  }),
  draft({
    scenarioId: 'rule-gap-container-missing-seccomp-profile',
    title: 'Container has no seccomp profile',
    resourceRefs: ['pod/no-seccomp-workload'],
    setup: [pod('no-seccomp-workload', { containers: [container()] })],
    resourceRef: 'pod/no-seccomp-workload',
    fieldPath:
      'spec.securityContext.seccompProfile + spec.containers[0].securityContext.seccompProfile',
    brokenValue: '<both absent>',
    finding: 'Neither Pod nor container security context declares a seccomp profile.',
    healthyValue: 'RuntimeDefault',
    healthyDescription: 'A healthy workload declares or inherits RuntimeDefault seccomp.',
  }),
  draft({
    scenarioId: 'rule-gap-container-image-tag-omitted',
    title: 'Container image omits an immutable tag',
    resourceRefs: ['pod/implicit-latest-workload'],
    setup: [
      pod('implicit-latest-workload', {
        containers: [container({ image: 'registry.k8s.io/pause' })],
      }),
    ],
    resourceRef: 'pod/implicit-latest-workload',
    fieldPath: 'spec.containers[0].image',
    brokenValue: 'registry.k8s.io/pause',
    finding:
      'The image reference omits a tag and therefore resolves through the mutable latest tag.',
    healthyValue: 'registry.k8s.io/pause:3.10',
    healthyDescription: 'A healthy image reference pins an explicit non-latest tag.',
  }),
  draft({
    scenarioId: 'rule-gap-service-uses-nodeport',
    title: 'Service exposes a NodePort',
    resourceRefs: ['service/node-port-service'],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'node-port-service' },
        spec: {
          type: 'NodePort',
          selector: { app: 'node-port-service' },
          ports: [{ port: 80, targetPort: 8080, nodePort: 30080 }],
        },
      },
    ],
    resourceRef: 'service/node-port-service',
    fieldPath: 'spec.type + spec.ports[0].nodePort',
    brokenValue: 'NodePort; 30080',
    finding: 'The Service exposes port 30080 on every node.',
    healthyValue: 'ClusterIP; nodePort absent',
    healthyDescription: 'A healthy internal Service allocates no node-level port.',
  }),
  draft({
    scenarioId: 'rule-gap-hpa-minimum-replicas-too-low',
    title: 'HorizontalPodAutoscaler minimum is below the resilience floor',
    resourceRefs: ['horizontalpodautoscaler/resilient-api', 'deployment/resilient-api'],
    setup: [
      deployment('resilient-api'),
      {
        apiVersion: 'autoscaling/v2',
        kind: 'HorizontalPodAutoscaler',
        metadata: { name: 'resilient-api' },
        spec: {
          scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'resilient-api' },
          minReplicas: 1,
          maxReplicas: 6,
          metrics: [
            {
              type: 'Resource',
              resource: {
                name: 'cpu',
                target: { type: 'Utilization', averageUtilization: 70 },
              },
            },
          ],
        },
      },
    ],
    resourceRef: 'horizontalpodautoscaler/resilient-api',
    fieldPath: 'spec.minReplicas',
    brokenValue: '1',
    finding: 'The autoscaler permits the workload to run with only one replica.',
    healthyValue: '>= 3',
    healthyDescription: 'The reviewed resilience floor is three replicas.',
  }),
  draft({
    scenarioId: 'rule-gap-secret-exposed-through-environment',
    title: 'Container exposes a Secret through environment variables',
    resourceRefs: ['pod/environment-secret-consumer', 'secret/application-credential'],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: { name: 'application-credential' },
        stringData: { token: 'fixture-token' },
      },
      pod('environment-secret-consumer', {
        containers: [
          container({
            env: [
              {
                name: 'APPLICATION_TOKEN',
                valueFrom: { secretKeyRef: { name: 'application-credential', key: 'token' } },
              },
            ],
          }),
        ],
      }),
    ],
    resourceRef: 'pod/environment-secret-consumer',
    fieldPath: 'spec.containers[0].env[0].valueFrom.secretKeyRef',
    brokenValue: '{"name":"application-credential","key":"token"}',
    finding: 'The container imports a Secret value into its process environment.',
    healthyValue: 'readOnly secret volume mount',
    healthyDescription:
      'The reviewed alternative mounts the Secret read-only instead of exporting it.',
  }),
  draft({
    scenarioId: 'rule-gap-pod-uses-default-service-account',
    title: 'Pod uses the default ServiceAccount',
    resourceRefs: ['pod/default-account-workload', 'serviceaccount/default'],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'ServiceAccount',
        metadata: { name: 'default' },
        automountServiceAccountToken: true,
      },
      pod('default-account-workload', {
        serviceAccountName: 'default',
        automountServiceAccountToken: true,
        containers: [container()],
      }),
    ],
    resourceRef: 'pod/default-account-workload',
    fieldPath: 'spec.serviceAccountName + spec.automountServiceAccountToken',
    brokenValue: 'default; true',
    finding: 'The Pod uses the namespace default account and mounts its API token.',
    healthyValue: 'dedicated account; false',
    healthyDescription: 'A healthy Pod uses a dedicated account without token automount.',
  }),
  ...[
    {
      scenarioId: 'rule-gap-rbac-subject-can-create-pods',
      title: 'RBAC subject can create Pods',
      name: 'pod-creator',
      resources: ['pods'],
      verbs: ['create'],
      brokenValue: '{"apiGroups":[""],"resources":["pods"],"verbs":["create"]}',
      finding: 'The bound Role permits its ServiceAccount to create Pods.',
      healthyValue: 'pods/create absent',
    },
    {
      scenarioId: 'rule-gap-rbac-subject-can-read-secrets',
      title: 'RBAC subject can read Secrets',
      name: 'secret-reader',
      resources: ['secrets'],
      verbs: ['get', 'list'],
      brokenValue: '{"apiGroups":[""],"resources":["secrets"],"verbs":["get","list"]}',
      finding: 'The bound Role permits its ServiceAccount to get and list Secrets.',
      healthyValue: 'secrets/get,list absent',
    },
    {
      scenarioId: 'rule-gap-rbac-role-uses-wildcards',
      title: 'RBAC role grants wildcard permissions',
      name: 'wildcard-operator',
      resources: ['*'],
      verbs: ['*'],
      brokenValue: '{"apiGroups":[""],"resources":["*"],"verbs":["*"]}',
      finding: 'The bound Role grants every verb on every core resource.',
      healthyValue: 'explicit verbs and resources',
    },
    {
      scenarioId: 'rule-gap-rbac-subject-can-exec-into-pods',
      title: 'RBAC subject can exec into Pods',
      name: 'pod-executor',
      resources: ['pods/exec'],
      verbs: ['create'],
      brokenValue: '{"apiGroups":[""],"resources":["pods/exec"],"verbs":["create"]}',
      finding: 'The bound Role permits its ServiceAccount to create pod exec sessions.',
      healthyValue: 'pods/exec/create absent',
    },
  ].map(({ scenarioId, title, name, resources, verbs, brokenValue, finding, healthyValue }) =>
    draft({
      scenarioId,
      title,
      resourceRefs: [`role/${name}`, `rolebinding/${name}`, `serviceaccount/${name}`],
      setup: [
        serviceAccount(name),
        role(name, [''], resources, verbs),
        roleBinding(name, name, name),
      ],
      resourceRef: `role/${name}`,
      fieldPath: 'rules[0]',
      brokenValue,
      finding,
      healthyValue,
      healthyDescription: 'A healthy least-privilege Role omits this permission.',
    })
  ),
  ...[
    {
      scenarioId: 'rule-gap-container-references-missing-configmap',
      title: 'Container references a missing ConfigMap',
      name: 'missing-application-config',
      key: 'configMapRef',
      path: 'spec.containers[0].envFrom[0].configMapRef.name',
      kind: 'ConfigMap',
    },
    {
      scenarioId: 'rule-gap-container-references-missing-secret',
      title: 'Container references a missing Secret',
      name: 'missing-application-secret',
      key: 'secretRef',
      path: 'spec.containers[0].envFrom[0].secretRef.name',
      kind: 'Secret',
    },
  ].map(({ scenarioId, title, name, key, path, kind }) =>
    draft({
      scenarioId,
      title,
      resourceRefs: ['pod/missing-environment-source', `${kind.toLowerCase()}/*`],
      setup: [
        pod('missing-environment-source', {
          containers: [container({ envFrom: [{ [key]: { name } }] })],
        }),
      ],
      resourceRef: 'pod/missing-environment-source',
      fieldPath: path,
      brokenValue: name,
      finding: `The required ${kind} named ${name} does not exist in the namespace.`,
      healthyValue: `${name} exists`,
      healthyDescription: `A healthy namespace contains the referenced ${kind}.`,
      observationKinds: ['manifest.object', 'manifest.reference', `${kind.toLowerCase()}.list`],
    })
  ),
  draft({
    scenarioId: 'rule-gap-pod-references-missing-service-account',
    title: 'Pod template references a missing ServiceAccount',
    resourceRefs: ['deployment/missing-account-workload', 'serviceaccount/*'],
    setup: [
      deployment('missing-account-workload', 3, {
        serviceAccountName: 'missing-workload-account',
        containers: [container()],
      }),
    ],
    resourceRef: 'deployment/missing-account-workload',
    fieldPath: 'spec.template.spec.serviceAccountName + matching ServiceAccount inventory',
    brokenValue: 'missing-workload-account; 0',
    finding: 'The Pod template names a ServiceAccount absent from its namespace.',
    healthyValue: 'missing-workload-account; 1',
    healthyDescription: 'A healthy namespace contains the named ServiceAccount.',
    observationKinds: ['manifest.object', 'manifest.reference', 'serviceaccount.list'],
  }),
  draft({
    scenarioId: 'rule-gap-rolebinding-references-missing-role',
    title: 'RoleBinding references a missing Role',
    resourceRefs: ['rolebinding/missing-role-binding', 'role/*', 'serviceaccount/bound-account'],
    setup: [
      serviceAccount('bound-account'),
      roleBinding('missing-role-binding', 'missing-role', 'bound-account'),
    ],
    resourceRef: 'rolebinding/missing-role-binding',
    fieldPath: 'roleRef + matching Role inventory',
    brokenValue: '{"apiGroup":"rbac.authorization.k8s.io","kind":"Role","name":"missing-role"}; 0',
    finding: 'The RoleBinding names a Role absent from its namespace.',
    healthyValue: 'missing-role inventory count 1',
    healthyDescription: 'A healthy binding resolves to an existing Role.',
    observationKinds: ['manifest.object', 'manifest.reference', 'role.list'],
  }),
  draft({
    scenarioId: 'rule-gap-servicemonitor-selector-matches-no-service',
    title: 'ServiceMonitor selector matches no Service',
    resourceRefs: ['servicemonitor/application-monitor', 'service/application-metrics'],
    setup: [
      {
        apiVersion: 'monitoring.coreos.com/v1',
        kind: 'ServiceMonitor',
        metadata: { name: 'application-monitor' },
        spec: {
          selector: { matchLabels: { metrics: 'expected' } },
          endpoints: [{ port: 'metrics' }],
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'application-metrics', labels: { metrics: 'different' } },
        spec: { selector: { app: 'application' }, ports: [{ name: 'metrics', port: 9090 }] },
      },
    ],
    resourceRef: 'servicemonitor/application-monitor',
    fieldPath: 'spec.selector.matchLabels + matching Service inventory',
    brokenValue: '{"metrics":"expected"}; 0 matches',
    finding: 'The monitor selector matches none of the available Services.',
    healthyValue: '{"metrics":"expected"}; >= 1 match',
    healthyDescription: 'A healthy monitor selector matches its intended Service.',
    observationKinds: ['manifest.object', 'manifest.selector', 'service.list'],
  }),
  draft({
    scenarioId: 'rule-gap-hpa-references-missing-target',
    title: 'HorizontalPodAutoscaler references a missing target',
    resourceRefs: ['horizontalpodautoscaler/orphan-autoscaler', 'deployment/*'],
    setup: [
      {
        apiVersion: 'autoscaling/v2',
        kind: 'HorizontalPodAutoscaler',
        metadata: { name: 'orphan-autoscaler' },
        spec: {
          scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'missing-target' },
          minReplicas: 2,
          maxReplicas: 5,
          metrics: [],
        },
      },
    ],
    resourceRef: 'horizontalpodautoscaler/orphan-autoscaler',
    fieldPath: 'spec.scaleTargetRef + matching Deployment inventory',
    brokenValue: '{"apiVersion":"apps/v1","kind":"Deployment","name":"missing-target"}; 0',
    finding: 'The autoscaler target does not exist.',
    healthyValue: 'apps/v1 Deployment/missing-target; 1 match',
    healthyDescription: 'A healthy autoscaler resolves to one scalable workload.',
    observationKinds: ['manifest.object', 'manifest.reference', 'deployment.list'],
  }),
  draft({
    scenarioId: 'rule-gap-deployment-has-no-pdb',
    title: 'Deployment has no PodDisruptionBudget',
    resourceRefs: ['deployment/unprotected-api', 'poddisruptionbudget/*'],
    setup: [deployment('unprotected-api')],
    resourceRef: 'deployment/unprotected-api',
    fieldPath: 'spec.template.metadata.labels.app + matching PodDisruptionBudget inventory',
    brokenValue: 'unprotected-api; 0',
    finding: 'No disruption budget selector covers the Deployment Pods.',
    healthyValue: 'unprotected-api; 1 viable matching budget',
    healthyDescription: 'A healthy Deployment is covered by a viable disruption budget.',
    observationKinds: ['manifest.object', 'manifest.selector', 'poddisruptionbudget.list'],
  }),
  draft({
    scenarioId: 'rule-gap-statefulset-has-no-pdb',
    title: 'StatefulSet has no PodDisruptionBudget',
    resourceRefs: ['statefulset/unprotected-database', 'poddisruptionbudget/*'],
    setup: [statefulSet('unprotected-database')],
    resourceRef: 'statefulset/unprotected-database',
    fieldPath: 'spec.template.metadata.labels.app + matching PodDisruptionBudget inventory',
    brokenValue: 'unprotected-database; 0',
    finding: 'No disruption budget selector covers the StatefulSet Pods.',
    healthyValue: 'unprotected-database; 1 viable matching budget',
    healthyDescription: 'A healthy StatefulSet is covered by a viable disruption budget.',
    observationKinds: ['manifest.object', 'manifest.selector', 'poddisruptionbudget.list'],
  }),
  draft({
    scenarioId: 'rule-gap-pdb-omits-unhealthy-eviction-policy',
    title: 'PodDisruptionBudget omits unhealthy Pod eviction policy',
    resourceRefs: ['poddisruptionbudget/application-budget'],
    setup: [
      {
        apiVersion: 'policy/v1',
        kind: 'PodDisruptionBudget',
        metadata: { name: 'application-budget' },
        spec: { minAvailable: 2, selector: { matchLabels: { app: 'application' } } },
      },
    ],
    resourceRef: 'poddisruptionbudget/application-budget',
    fieldPath: 'spec.unhealthyPodEvictionPolicy',
    brokenValue: '<absent>',
    finding: 'The disruption budget leaves unhealthy Pod eviction behavior implicit.',
    healthyValue: 'AlwaysAllow',
    healthyDescription: 'The reviewed policy explicitly permits eviction of unhealthy Pods.',
  }),
  draft({
    scenarioId: 'rule-gap-cronjob-misses-starting-deadline',
    title: 'CronJob has no starting deadline',
    resourceRefs: ['cronjob/nightly-report'],
    setup: [
      {
        apiVersion: 'batch/v1',
        kind: 'CronJob',
        metadata: { name: 'nightly-report' },
        spec: {
          schedule: '0 2 * * *',
          concurrencyPolicy: 'Forbid',
          jobTemplate: {
            spec: {
              template: {
                spec: { restartPolicy: 'Never', containers: [container()] },
              },
            },
          },
        },
      },
    ],
    resourceRef: 'cronjob/nightly-report',
    fieldPath: 'spec.startingDeadlineSeconds',
    brokenValue: '<absent>',
    finding: 'The CronJob has no bound on how late a missed run may start.',
    healthyValue: '300',
    healthyDescription: 'A healthy CronJob declares a bounded starting deadline.',
  }),
  draft({
    scenarioId: 'rule-gap-ingress-has-no-tls',
    title: 'Ingress exposes HTTP without TLS',
    resourceRefs: ['ingress/plain-http', 'service/web'],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'web' },
        spec: { selector: { app: 'web' }, ports: [{ port: 80, targetPort: 8080 }] },
      },
      {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: { name: 'plain-http' },
        spec: {
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
    ],
    resourceRef: 'ingress/plain-http',
    fieldPath: 'spec.rules[0].host + spec.tls',
    brokenValue: 'app.example.test; <absent>',
    finding: 'The routed host has no TLS host entry or certificate Secret.',
    healthyValue: 'app.example.test; secretName present',
    healthyDescription: 'A healthy Ingress covers every routed host with TLS.',
  }),
  draft({
    scenarioId: 'rule-gap-ingress-references-missing-service',
    title: 'Ingress references a missing Service',
    resourceRefs: ['ingress/orphan-route', 'service/*'],
    setup: [
      {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: { name: 'orphan-route' },
        spec: {
          rules: [
            {
              host: 'missing.example.test',
              http: {
                paths: [
                  {
                    path: '/',
                    pathType: 'Prefix',
                    backend: { service: { name: 'missing-web', port: { number: 80 } } },
                  },
                ],
              },
            },
          ],
        },
      },
    ],
    resourceRef: 'ingress/orphan-route',
    fieldPath: 'spec.rules[0].http.paths[0].backend.service + matching Service inventory',
    brokenValue: '{"name":"missing-web","port":{"number":80}}; 0',
    finding: 'The Ingress backend Service does not exist.',
    healthyValue: 'missing-web port 80; 1 match',
    healthyDescription: 'A healthy backend resolves to an existing Service port.',
    observationKinds: ['manifest.object', 'manifest.reference', 'service.list'],
  }),
  draft({
    scenarioId: 'rule-gap-gateway-references-missing-class',
    title: 'Gateway references a missing GatewayClass',
    resourceRefs: ['gateway/orphan-gateway', 'gatewayclass/*'],
    setup: [
      {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'Gateway',
        metadata: { name: 'orphan-gateway' },
        spec: {
          gatewayClassName: 'missing-gateway-class',
          listeners: [{ name: 'http', protocol: 'HTTP', port: 80 }],
        },
      },
    ],
    resourceRef: 'gateway/orphan-gateway',
    fieldPath: 'spec.gatewayClassName + matching GatewayClass inventory',
    brokenValue: 'missing-gateway-class; 0 matches',
    finding: 'The Gateway class does not exist.',
    healthyValue: 'missing-gateway-class; Accepted=True',
    healthyDescription: 'A healthy Gateway references an accepted class.',
    observationKinds: ['manifest.object', 'manifest.reference', 'gatewayclass.list'],
  }),
  draft({
    scenarioId: 'rule-gap-httproute-references-missing-backend',
    title: 'HTTPRoute references a missing backend Service',
    resourceRefs: ['httproute/orphan-backend', 'service/*'],
    setup: [
      {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'HTTPRoute',
        metadata: { name: 'orphan-backend' },
        spec: {
          parentRefs: [{ name: 'application-gateway' }],
          rules: [{ backendRefs: [{ name: 'missing-backend', port: 8080 }] }],
        },
      },
    ],
    resourceRef: 'httproute/orphan-backend',
    fieldPath: 'spec.rules[0].backendRefs[0] + matching Service inventory',
    brokenValue: '{"name":"missing-backend","port":8080}; 0 matches',
    finding: 'The route backend Service does not exist.',
    healthyValue: 'missing-backend port 8080; 1 match',
    healthyDescription: 'A healthy route resolves every backend to an existing Service port.',
    observationKinds: ['manifest.object', 'manifest.reference', 'service.list'],
  }),
  draft({
    scenarioId: 'rule-gap-pod-mounts-container-runtime-socket',
    title: 'Pod mounts the container runtime socket',
    resourceRefs: ['pod/runtime-socket-client'],
    setup: [
      pod('runtime-socket-client', {
        containers: [
          container({
            volumeMounts: [
              {
                name: 'runtime-socket',
                mountPath: '/run/containerd/containerd.sock',
                readOnly: true,
              },
            ],
          }),
        ],
        volumes: [
          {
            name: 'runtime-socket',
            hostPath: { path: '/run/containerd/containerd.sock', type: 'Socket' },
          },
        ],
      }),
    ],
    resourceRef: 'pod/runtime-socket-client',
    fieldPath: 'spec.volumes[0].hostPath.path + spec.containers[0].volumeMounts[0].mountPath',
    brokenValue: '/run/containerd/containerd.sock',
    finding: 'A hostPath exposes the node container runtime socket inside the container.',
    healthyValue: '<hostPath absent>',
    healthyDescription: 'A healthy Pod does not mount a node runtime socket.',
  }),
  draft({
    scenarioId: 'rule-gap-pod-sets-unsafe-sysctl',
    title: 'Pod sets an unsafe sysctl',
    resourceRefs: ['pod/unsafe-sysctl-workload'],
    setup: [
      pod('unsafe-sysctl-workload', {
        securityContext: { sysctls: [{ name: 'kernel.core_pattern', value: '/tmp/core.%e.%p' }] },
        containers: [container()],
      }),
    ],
    resourceRef: 'pod/unsafe-sysctl-workload',
    fieldPath: 'spec.securityContext.sysctls[0]',
    brokenValue: '{"name":"kernel.core_pattern","value":"/tmp/core.%e.%p"}',
    finding: 'The Pod requests kernel.core_pattern, which is outside the safe sysctl allowlist.',
    healthyValue: '<unsafe sysctl absent>',
    healthyDescription: 'A healthy Pod declares only safe sysctls or none.',
  }),
  draft({
    scenarioId: 'rule-gap-pod-misses-priority-class',
    title: 'Pod has no valid PriorityClass',
    resourceRefs: ['pod/orphan-priority-workload', 'priorityclass/*'],
    setup: [
      pod('orphan-priority-workload', {
        priorityClassName: 'missing-workload-priority',
        containers: [container()],
      }),
    ],
    resourceRef: 'pod/orphan-priority-workload',
    fieldPath: 'spec.priorityClassName + matching PriorityClass inventory',
    brokenValue: 'missing-workload-priority; 0 matches',
    finding: 'The Pod names a PriorityClass that does not exist.',
    healthyValue: 'missing-workload-priority; 1 match',
    healthyDescription: 'A healthy Pod references an existing reviewed PriorityClass.',
    observationKinds: ['manifest.object', 'manifest.reference', 'priorityclass.list'],
  }),
  draft({
    scenarioId: 'rule-gap-container-binds-host-port',
    title: 'Container binds a host port',
    resourceRefs: ['pod/host-port-workload'],
    setup: [
      pod('host-port-workload', {
        containers: [
          container({ ports: [{ name: 'http', containerPort: 8080, hostPort: 30081 }] }),
        ],
      }),
    ],
    resourceRef: 'pod/host-port-workload',
    fieldPath: 'spec.containers[0].ports[0].hostPort',
    brokenValue: '30081',
    finding: 'The container binds port 30081 directly on its node.',
    healthyValue: '0 or absent',
    healthyDescription: 'A healthy workload uses a Service without hostPort.',
  }),
];

const telemetryDefinitions: ScenarioDraftDefinition[] = [
  draft({
    scenarioId: 'rule-gap-cpu-throttling-sustained',
    title: 'Container CPU throttling remains sustained',
    resourceRefs: [
      'pod/cpu-throttle-probe',
      'metric/container_cpu_cfs_throttled_periods_total{pod="cpu-throttle-probe"}',
      'metric/container_cpu_cfs_periods_total{pod="cpu-throttle-probe"}',
    ],
    setup: [
      pod('cpu-throttle-probe', {
        activeDeadlineSeconds: 420,
        restartPolicy: 'Never',
        containers: [
          {
            name: 'worker',
            image: busyboxImage,
            command: ['/bin/sh', '-c', 'exec yes > /dev/null'],
            resources: { requests: { cpu: '10m' }, limits: { cpu: '10m', memory: '16Mi' } },
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
              runAsNonRoot: true,
              runAsUser: 1000,
            },
          },
        ],
      }),
    ],
    resourceRef: 'metric/container_cpu_cfs_throttled_periods_total{pod="cpu-throttle-probe"}',
    fieldPath: 'rate(throttled_periods[5m]) / rate(periods[5m])',
    brokenValue: '> 0.8 for 5m',
    finding:
      'The CPU-limited busy loop is throttled in more than 80 percent of scheduling periods for five minutes.',
    healthyValue: '<= 0.8 for 5m',
    healthyDescription:
      'A short spike or ratio below the pinned threshold is not sustained throttling.',
    observationKinds: ['pod.spec', 'pod.status', 'metric.range'],
    mechanisms: ['api-server', 'kubelet'],
    profiles: runtimeProfiles,
  }),
  draft({
    scenarioId: 'rule-gap-aggregated-api-unavailable',
    title: 'Aggregated API is unavailable',
    resourceRefs: [
      'apiservice/v1alpha1.unavailable.example.test',
      'service/*',
      'metric/aggregator_unavailable_apiservice{name="v1alpha1.unavailable.example.test"}',
    ],
    setup: [
      {
        apiVersion: 'apiregistration.k8s.io/v1',
        kind: 'APIService',
        metadata: { name: 'v1alpha1.unavailable.example.test' },
        spec: {
          group: 'unavailable.example.test',
          groupPriorityMinimum: 2000,
          insecureSkipTLSVerify: true,
          service: { namespace: 'default', name: 'missing-aggregated-api', port: 443 },
          version: 'v1alpha1',
          versionPriority: 10,
        },
      },
    ],
    resourceRef: 'apiservice/v1alpha1.unavailable.example.test',
    fieldPath: 'status.conditions[type=Available].status + service resolution',
    brokenValue: 'False; service/default/missing-aggregated-api absent',
    finding:
      'The aggregation controller cannot resolve the APIService backend and marks it unavailable.',
    healthyValue: 'True; aggregator unavailable gauge=0',
    healthyDescription:
      'A healthy APIService has an available backend and a cleared unavailable gauge.',
    observationKinds: ['apiservice.spec', 'apiservice.status', 'service.list', 'metric.range'],
    mechanisms: ['api-server', 'operator-reconciliation'],
    profiles: runtimeProfiles,
    additionalAcceptedFacts: [
      fact(
        'aggregated-api-unavailable-metric',
        'metric/aggregator_unavailable_apiservice{name="v1alpha1.unavailable.example.test"}',
        'max_over_time[2m]',
        '1',
        'Native API aggregation telemetry reports the APIService unavailable in the same window.'
      ),
    ],
  }),
  draft({
    scenarioId: 'rule-gap-deployment-generation-stale',
    title: 'Deployment generation is stale',
    resourceRefs: ['deployment/stale-generation'],
    setup: [
      {
        ...deployment('stale-generation'),
        metadata: { name: 'stale-generation', generation: 4 },
        status: { observedGeneration: 3, replicas: 3, readyReplicas: 3, availableReplicas: 3 },
      },
    ],
    resourceRef: 'deployment/stale-generation',
    fieldPath: 'metadata.generation + status.observedGeneration',
    brokenValue: '4; 3 for 10m',
    finding: 'The Deployment controller has not observed the current generation for ten minutes.',
    healthyValue: '4; 4',
    healthyDescription:
      'A healthy controller reports the current generation; transient lag under ten minutes is not accepted.',
    observationKinds: ['deployment.spec', 'deployment.status', 'metric.range'],
    mechanisms: ['api-server', 'operator-reconciliation'],
    profiles: runtimeProfiles,
  }),
  draft({
    scenarioId: 'rule-gap-kubelet-certificate-renewal-fails',
    title: 'Kubelet certificate renewal fails',
    resourceRefs: [
      'certificatesigningrequest/node-client-renewal-denied',
      'certificatesigningrequest/node-server-renewal-denied',
      'metric/apiserver_request_total{group="certificates.k8s.io",resource="certificatesigningrequests",subresource="approval",verb="PUT",code="200"}',
    ],
    setup: [
      {
        apiVersion: 'certificates.k8s.io/v1',
        kind: 'CertificateSigningRequest',
        metadata: { name: 'node-client-renewal-denied' },
        spec: {
          request: fixtureCsrRequest,
          signerName: 'kubernetes.io/kube-apiserver-client-kubelet',
          usages: ['digital signature', 'key encipherment', 'client auth'],
          username: 'system:node:fixture-node',
          groups: ['system:nodes', 'system:authenticated'],
        },
        status: {
          conditions: [
            {
              type: 'Denied',
              status: 'True',
              reason: 'FixtureRenewalDenied',
              message: 'The controlled node renewal request was denied.',
              lastUpdateTime: '2026-09-20T00:00:00Z',
            },
          ],
        },
      },
      {
        apiVersion: 'certificates.k8s.io/v1',
        kind: 'CertificateSigningRequest',
        metadata: { name: 'node-server-renewal-denied' },
        spec: {
          request: fixtureCsrRequest,
          signerName: 'kubernetes.io/kubelet-serving',
          usages: ['digital signature', 'key encipherment', 'server auth'],
          username: 'system:node:fixture-node',
          groups: ['system:nodes', 'system:authenticated'],
        },
        status: {
          conditions: [
            {
              type: 'Denied',
              status: 'True',
              reason: 'FixtureRenewalDenied',
              message: 'The controlled node serving renewal request was denied.',
              lastUpdateTime: '2026-09-20T00:00:00Z',
            },
          ],
        },
      },
    ],
    resourceRef: 'certificatesigningrequest/node-client-renewal-denied',
    fieldPath: 'spec.signerName + status.conditions[type=Denied]',
    brokenValue: 'kubernetes.io/kube-apiserver-client-kubelet; True',
    finding: 'Kubelet client and serving renewal requests are explicitly denied.',
    healthyValue: 'Approved=True; no denial writes',
    healthyDescription: 'A healthy node obtains approval without client or server renewal denial.',
    observationKinds: [
      'certificatesigningrequest.spec',
      'certificatesigningrequest.status',
      'metric.range',
    ],
    mechanisms: ['api-server', 'authorization', 'kubelet'],
    profiles: runtimeProfiles,
    additionalAcceptedFacts: [
      fact(
        'server-renewal-denied',
        'certificatesigningrequest/node-server-renewal-denied',
        'spec.signerName + status.conditions[type=Denied]',
        'kubernetes.io/kubelet-serving; True',
        'The serving certificate renewal request is denied.'
      ),
      fact(
        'renewal-denials-recorded',
        'metric/apiserver_request_total{group="certificates.k8s.io",resource="certificatesigningrequests",subresource="approval",verb="PUT",code="200"}',
        'increase[2m]',
        '>= 2',
        'Native API server telemetry records both renewal denial writes during the observation window.'
      ),
    ],
  }),
  draft({
    scenarioId: 'rule-gap-kubelet-pleg-duration-high',
    title: 'Kubelet PLEG relist duration is high',
    resourceRefs: ['pod/container-churn', 'metric/kubelet_pleg_relist_duration_seconds_bucket'],
    setup: [
      pod('container-churn', {
        activeDeadlineSeconds: 420,
        restartPolicy: 'Always',
        containers: Array.from({ length: 12 }, (_, index) => ({
          name: `churn-${index}`,
          image: busyboxImage,
          command: ['/bin/sh', '-c', 'sleep 1; exit 1'],
          resources: { requests: { cpu: '1m', memory: '2Mi' }, limits: { memory: '8Mi' } },
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ['ALL'] },
            runAsNonRoot: true,
            runAsUser: 1000,
          },
        })),
      }),
    ],
    resourceRef: 'metric/kubelet_pleg_relist_duration_seconds_bucket',
    fieldPath: 'histogram_quantile(0.99, rate[5m])',
    brokenValue: '> 10s for 5m',
    finding:
      'Bounded container churn accompanies a 99th-percentile PLEG relist duration above ten seconds for five minutes.',
    healthyValue: '<= 10s or duration under 5m',
    healthyDescription:
      'A healthy or transient relist duration does not satisfy both threshold and duration.',
    observationKinds: ['pod.status', 'pod.container-status', 'metric.range'],
    mechanisms: ['api-server', 'kubelet'],
    profiles: runtimeProfiles,
  }),
  draft({
    scenarioId: 'rule-gap-pod-startup-latency-high',
    title: 'Pod startup latency is high',
    resourceRefs: ['pod/slow-startup', 'metric/kubelet_pod_start_duration_seconds_bucket'],
    setup: [
      pod('slow-startup', {
        activeDeadlineSeconds: 180,
        restartPolicy: 'Never',
        initContainers: [
          {
            name: 'bounded-delay',
            image: busyboxImage,
            command: ['/bin/sh', '-c', 'sleep 45'],
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
              runAsNonRoot: true,
              runAsUser: 1000,
            },
          },
        ],
        containers: [container()],
      }),
    ],
    resourceRef: 'metric/kubelet_pod_start_duration_seconds_bucket',
    fieldPath: 'histogram_quantile(0.99, rate[10m])',
    brokenValue: '> 30s with pod/slow-startup init duration=45s',
    finding:
      'A bounded 45-second init delay drives Pod startup latency beyond the pinned 30-second quantile.',
    healthyValue: '<= 30s',
    healthyDescription: 'Normal startup remains at or below the pinned threshold.',
    observationKinds: ['pod.spec', 'pod.status', 'metric.range'],
    mechanisms: ['api-server', 'scheduler', 'kubelet'],
    profiles: runtimeProfiles,
  }),
  draft({
    scenarioId: 'rule-gap-node-readiness-flaps',
    title: 'Node readiness flaps',
    resourceRefs: [
      'node/fixture-flapping-node',
      'event/*?involvedObject.name=fixture-flapping-node',
    ],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Node',
        metadata: {
          name: 'fixture-flapping-node',
          labels: { 'evals.kubernetes.io/synthetic-node': 'true' },
        },
        spec: {
          unschedulable: true,
          taints: [{ key: 'evals.kubernetes.io/synthetic-node', effect: 'NoSchedule' }],
        },
        status: {
          capacity: { cpu: '1', memory: '1Gi', pods: '1' },
          allocatable: { cpu: '1', memory: '1Gi', pods: '1' },
          conditions: [
            {
              type: 'Ready',
              status: 'False',
              reason: 'FixtureHeartbeatLost',
              lastTransitionTime: '2026-09-20T00:04:00Z',
            },
          ],
        },
      },
      ...['True', 'False', 'True', 'False'].map((status, index) => ({
        apiVersion: 'v1',
        kind: 'Event',
        metadata: { name: `fixture-flapping-node-${index}` },
        involvedObject: { apiVersion: 'v1', kind: 'Node', name: 'fixture-flapping-node' },
        reason: status === 'True' ? 'NodeReady' : 'NodeNotReady',
        message: `Node Ready condition changed to ${status}`,
        type: status === 'True' ? 'Normal' : 'Warning',
        eventTime: `2026-09-20T00:0${index}:00Z`,
        reportingController: 'evals.kubernetes.io/status-fixture',
        reportingInstance: 'fixture-1',
        action: 'ReadyConditionChanged',
      })),
    ],
    resourceRef: 'event/*?involvedObject.name=fixture-flapping-node',
    fieldPath: 'items[reason in (NodeReady,NodeNotReady)].eventTime',
    brokenValue: '4 transitions in 5m',
    finding:
      'The isolated unschedulable Node has four alternating Ready transitions within five minutes.',
    healthyValue: '<= 1 transition in 5m',
    healthyDescription: 'A healthy Node Ready condition remains stable in the observation window.',
    observationKinds: ['node.status', 'event.list', 'metric.range'],
    mechanisms: ['api-server', 'kubelet'],
    profiles: runtimeProfiles,
  }),
  draft({
    scenarioId: 'rule-gap-resource-quota-exceeded',
    title: 'ResourceQuota limit is exhausted',
    resourceRefs: [
      'resourcequota/pod-budget',
      'pod/quota-consumer',
      'event/quota-exceeded-attempt',
    ],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'ResourceQuota',
        metadata: { name: 'pod-budget' },
        spec: { hard: { pods: '1' } },
        status: { hard: { pods: '1' }, used: { pods: '1' } },
      },
      pod('quota-consumer', {
        activeDeadlineSeconds: 300,
        containers: [container()],
      }),
      {
        apiVersion: 'v1',
        kind: 'Event',
        metadata: { name: 'quota-exceeded-attempt' },
        involvedObject: { apiVersion: 'v1', kind: 'Pod', name: 'second-quota-consumer' },
        reason: 'FailedCreate',
        message: 'exceeded quota: pod-budget, requested: pods=1, used: pods=1, limited: pods=1',
        type: 'Warning',
        eventTime: '2026-09-20T00:05:00Z',
        reportingController: 'evals.kubernetes.io/admission-fixture',
        reportingInstance: 'fixture-1',
        action: 'CreateRejected',
      },
    ],
    resourceRef: 'resourcequota/pod-budget',
    fieldPath: 'status.used.pods + status.hard.pods',
    brokenValue: '1; 1',
    finding:
      'The existing Pod consumes the entire Pod quota, so another Pod admission would exceed the hard limit.',
    healthyValue: 'used < hard',
    healthyDescription:
      'A healthy quota retains capacity; a rejected unrelated resource kind is confounding.',
    observationKinds: ['resourcequota.spec', 'resourcequota.status', 'pod.list', 'event.list'],
    mechanisms: ['api-server', 'admission-controller'],
    profiles: runtimeProfiles,
    additionalAcceptedFacts: [
      fact(
        'quota-exceed-attempt-rejected',
        'event/quota-exceeded-attempt',
        'reason + message',
        'FailedCreate; exceeded quota: pod-budget, requested: pods=1, used: pods=1, limited: pods=1',
        'A second Pod creation attempt is rejected because it would exceed the exhausted hard limit.'
      ),
    ],
  }),
];

const runtimeDefinitions: ScenarioDraftDefinition[] = [
  draft({
    scenarioId: 'rule-gap-fileless-memfd-execution',
    title: 'Process executes a file from an in-memory descriptor',
    resourceRefs: ['job/memory-execution-action', 'pod[label=job-name=memory-execution-action]'],
    setup: [
      actionJob(
        'memory-execution-action',
        'python:3.12-alpine',
        "python3 - <<'PY'\nimport os, subprocess\nfd = os.memfd_create('controlled-action', os.MFD_CLOEXEC)\nos.write(fd, b'#!/bin/sh\\necho memory-descriptor-executed\\n')\nos.fchmod(fd, 0o700)\nsubprocess.run([f'/proc/self/fd/{fd}'], pass_fds=(fd,), check=True)\nPY"
      ),
    ],
    resourceRef: 'pod[label=job-name=memory-execution-action]',
    fieldPath: 'logs',
    brokenValue: 'memory-descriptor-executed',
    finding:
      'The bounded helper creates an executable memory descriptor and executes its contents.',
    healthyValue: '<log absent>; only on-disk executable paths',
    healthyDescription:
      'An on-disk process execution does not establish memory-descriptor execution.',
    observationKinds: ['job.pod-template', 'pod.status', 'pod.logs'],
    mechanisms: ['api-server', 'kubelet'],
    profiles: runtimeProfiles,
  }),
  draft({
    scenarioId: 'rule-gap-release-agent-container-escape',
    title: 'Container writes a controlled release agent path',
    resourceRefs: ['job/release-agent-action', 'pod[label=job-name=release-agent-action]'],
    setup: [
      actionJob(
        'release-agent-action',
        busyboxImage,
        "mkdir -p /fixture/cgroup && printf '/fixture/controlled-handler\\n' > /fixture/cgroup/release_agent && cat /fixture/cgroup/release_agent",
        {
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ['ALL'], add: ['SYS_ADMIN'] },
            runAsUser: 0,
          },
          volumeMounts: [{ name: 'fixture', mountPath: '/fixture' }],
        },
        { volumes: [{ name: 'fixture', emptyDir: { sizeLimit: '8Mi' } }] }
      ),
    ],
    resourceRef: 'job/release-agent-action',
    fieldPath:
      'spec.template.spec.volumes[0].emptyDir + spec.template.spec.containers[0].command[2]',
    brokenValue: '{"sizeLimit":"8Mi"}; /fixture/cgroup/release_agent',
    finding:
      'A capability-bearing container performs the release_agent write only in a size-limited Pod-local cgroup fixture.',
    healthyValue: 'SYS_ADMIN absent; release_agent write absent',
    healthyDescription:
      'A healthy container lacks both the capability and writable path; no host cgroup is mounted.',
    observationKinds: ['job.pod-template', 'pod.security-context', 'pod.logs'],
    mechanisms: ['api-server', 'kubelet'],
    profiles: minikubeProfile,
  }),
  draft({
    scenarioId: 'rule-gap-container-loads-kernel-module',
    title: 'Container invokes a kernel module loading syscall',
    resourceRefs: ['job/module-syscall-action', 'pod[label=job-name=module-syscall-action]'],
    setup: [
      actionJob(
        'module-syscall-action',
        'python:3.12-alpine',
        "python3 - <<'PY'\nimport ctypes, errno, os, platform\npath = '/fixture/empty.ko'\nopen(path, 'wb').close()\nfd = os.open(path, os.O_RDONLY)\nnumber = {'x86_64': 313, 'aarch64': 273}[platform.machine()]\nlibc = ctypes.CDLL(None, use_errno=True)\nresult = libc.syscall(number, fd, b'', 0)\nerror = ctypes.get_errno()\nprint(f'finit_module result={result} errno={error}')\nassert result == -1 and error in (errno.EPERM, errno.ENOEXEC, errno.EINVAL)\nPY",
        {
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ['ALL'], add: ['SYS_MODULE'] },
            runAsUser: 0,
          },
          volumeMounts: [{ name: 'fixture', mountPath: '/fixture' }],
        },
        { volumes: [{ name: 'fixture', emptyDir: { sizeLimit: '1Mi' } }] }
      ),
    ],
    resourceRef: 'pod[label=job-name=module-syscall-action]',
    fieldPath: 'logs',
    brokenValue:
      '<one of: finit_module result=-1 errno=1, finit_module result=-1 errno=8, finit_module result=-1 errno=22>',
    finding:
      'The helper invokes finit_module with SYS_MODULE against an empty Pod-local test file; the kernel rejects it and no module loads.',
    healthyValue: '<finit_module invocation absent>',
    healthyDescription:
      'A healthy container lacks SYS_MODULE and never invokes a module-loading syscall.',
    observationKinds: ['job.pod-template', 'pod.security-context', 'pod.logs'],
    mechanisms: ['api-server', 'kubelet'],
    profiles: minikubeProfile,
  }),
  draft({
    scenarioId: 'rule-gap-process-uses-ptrace',
    title: 'Process uses ptrace against a sibling',
    resourceRefs: ['job/ptrace-action', 'pod[label=job-name=ptrace-action]'],
    setup: [
      actionJob(
        'ptrace-action',
        'python:3.12-alpine',
        "python3 - <<'PY'\nimport ctypes, os, signal, time\nlibc = ctypes.CDLL(None, use_errno=True)\nchild = os.fork()\nif child == 0:\n    time.sleep(30)\n    raise SystemExit(0)\nassert libc.ptrace(16, child, None, None) == 0\nos.waitpid(child, 0)\nassert libc.ptrace(17, child, None, None) == 0\nos.kill(child, signal.SIGTERM)\ntraced = os.fork()\nif traced == 0:\n    raise SystemExit(0 if libc.ptrace(0, 0, None, None) == 0 else 1)\nos.waitpid(traced, 0)\nprint('ptrace-attach-detach-and-traceme-complete')\nPY",
        {
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ['ALL'], add: ['SYS_PTRACE'] },
            runAsNonRoot: true,
            runAsUser: 1000,
          },
        }
      ),
    ],
    resourceRef: 'pod[label=job-name=ptrace-action]',
    fieldPath: 'logs',
    brokenValue: 'ptrace-attach-detach-and-traceme-complete',
    finding: 'The bounded helper attaches to its own child, detaches, and executes PTRACE_TRACEME.',
    healthyValue: '<ptrace calls absent>',
    healthyDescription: 'Ordinary sibling processes that never invoke ptrace are healthy controls.',
    observationKinds: ['job.pod-template', 'pod.security-context', 'pod.logs'],
    mechanisms: ['api-server', 'kubelet'],
    profiles: minikubeProfile,
  }),
  draft({
    scenarioId: 'rule-gap-process-reads-proc-environ',
    title: 'Process reads a sibling proc environment',
    resourceRefs: ['job/proc-environment-action', 'pod[label=job-name=proc-environment-action]'],
    setup: [
      actionJob(
        'proc-environment-action',
        busyboxImage,
        "CONTROLLED_VALUE=fixture-value sleep 60 & sibling=$!; tr '\\000' '\\n' < /proc/$sibling/environ | grep '^CONTROLLED_VALUE=fixture-value$'; kill $sibling"
      ),
    ],
    resourceRef: 'pod[label=job-name=proc-environment-action]',
    fieldPath: 'logs',
    brokenValue: 'CONTROLLED_VALUE=fixture-value',
    finding: 'The helper opens and reads the environment file of its own sibling process.',
    healthyValue: '<sibling environ read absent>',
    healthyDescription:
      'Reading only the current process environment is not the cross-process action.',
    observationKinds: ['job.pod-template', 'pod.logs'],
    mechanisms: ['api-server', 'kubelet'],
    profiles: runtimeProfiles,
  }),
  draft({
    scenarioId: 'rule-gap-process-sets-setuid-bit',
    title: 'Process sets and executes a setuid test file',
    resourceRefs: ['job/setuid-action', 'pod[label=job-name=setuid-action]'],
    setup: [
      actionJob(
        'setuid-action',
        busyboxImage,
        "cp /bin/busybox /fixture/test-executable; chmod 4755 /fixture/test-executable; ln -s test-executable /fixture/busybox; stat -c 'mode=%a' /fixture/test-executable; /fixture/busybox true; echo setuid-test-executed-without-sudo",
        {
          securityContext: {
            allowPrivilegeEscalation: true,
            capabilities: { drop: ['ALL'], add: ['FOWNER', 'SETUID'] },
            runAsUser: 0,
          },
          volumeMounts: [{ name: 'fixture', mountPath: '/fixture' }],
        },
        { volumes: [{ name: 'fixture', emptyDir: { sizeLimit: '8Mi' } }] }
      ),
    ],
    resourceRef: 'pod[label=job-name=setuid-action]',
    fieldPath: 'logs',
    brokenValue: 'mode=4755; setuid-test-executed-without-sudo',
    finding:
      'The helper sets mode 4755 and executes the Pod-local test file without a privilege wrapper.',
    healthyValue: 'mode excludes 4000; execution marker absent',
    healthyDescription:
      'A healthy test file remains non-setuid and is not executed through this chain.',
    observationKinds: ['job.pod-template', 'pod.security-context', 'pod.logs'],
    mechanisms: ['api-server', 'kubelet'],
    profiles: minikubeProfile,
  }),
  draft({
    scenarioId: 'rule-gap-sensitive-file-symlink-created',
    title: 'Process creates a symlink to a sensitive fixture path',
    resourceRefs: ['job/sensitive-symlink-action', 'pod[label=job-name=sensitive-symlink-action]'],
    setup: [
      actionJob(
        'sensitive-symlink-action',
        busyboxImage,
        "mkdir -p /fixture/etc /fixture/work; printf 'fixture-only\\n' > /fixture/etc/shadow; ln -s /fixture/etc/shadow /fixture/work/credential-link; readlink /fixture/work/credential-link",
        {
          volumeMounts: [{ name: 'fixture', mountPath: '/fixture' }],
        },
        { volumes: [{ name: 'fixture', emptyDir: { sizeLimit: '1Mi' } }] }
      ),
    ],
    resourceRef: 'pod[label=job-name=sensitive-symlink-action]',
    fieldPath: 'logs',
    brokenValue: '/fixture/etc/shadow',
    finding:
      'The helper creates a symlink to the controlled sensitive-file analogue inside Pod-local storage.',
    healthyValue: '<symlink absent>',
    healthyDescription:
      'A regular file or symlink to a nonsensitive fixture does not satisfy the trigger.',
    observationKinds: ['job.pod-template', 'pod.logs'],
    mechanisms: ['api-server', 'kubelet'],
    profiles: runtimeProfiles,
  }),
];

const nodeEvidence = (
  scenarioId: string,
  title: string,
  name: string,
  sourcePath: string,
  evidence: string,
  predicate: string,
  finding: string,
  healthy: string,
  profiles: Profiles = runtimeProfiles
) => {
  const resourceRef = `configmap/${name}`;
  return draft({
    scenarioId,
    title,
    resourceRefs: [resourceRef],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: {
          name,
          labels: { 'evals.kubernetes.io/fixture-kind': 'node-log-or-config' },
          annotations: {
            'evals.kubernetes.io/adapter': 'normalized-node-predicate',
            'evals.kubernetes.io/source-path': sourcePath,
            'evals.kubernetes.io/apply-to-current-host': 'false',
          },
        },
        data: {
          'source-evidence.txt': evidence,
          'predicate.json': predicate,
          'healthy-control.txt': healthy,
        },
      },
    ],
    resourceRef,
    fieldPath: 'data.source-evidence.txt + data.predicate.json',
    brokenValue: `${evidence}; ${predicate}`,
    finding,
    healthyValue: healthy,
    healthyDescription: 'The healthy control does not satisfy the normalized predicate.',
    observationKinds: ['configmap.data', 'node-log-fixture', 'normalized-predicate'],
    mechanisms: ['api-server'],
    profiles,
  });
};

const hostDefinitions: ScenarioDraftDefinition[] = [
  nodeEvidence(
    'rule-gap-npd-ntp-is-down',
    'Node time synchronization is down',
    'node-time-sync-evidence',
    '/var/log/node-monitor/time-sync.log',
    '2026-09-20T00:00:00Z health=failed condition=NTPIsDown detail="ntpq query: connection refused"',
    '{"condition":"NTPIsDown","health":"failed","requiredMatches":1}',
    'The node monitor records one failed time-synchronization check with condition NTPIsDown.',
    '2026-09-20T00:00:00Z health=ok condition=NTPIsDown detail="peer synchronized"'
  ),
  nodeEvidence(
    'rule-gap-npd-iptables-version-mismatch',
    'Node iptables modes are incompatible',
    'node-iptables-mode-evidence',
    '/var/log/node-monitor/network.log',
    '2026-09-20T00:01:00Z health=failed condition=IPTablesVersionsMismatch kube-proxy=legacy kubelet=nft',
    '{"condition":"IPTablesVersionsMismatch","kubeProxyMode":"legacy","kubeletMode":"nft","requiredMatches":1}',
    'The node evidence records incompatible legacy and nft iptables modes.',
    '2026-09-20T00:01:00Z health=ok condition=IPTablesVersionsMismatch kube-proxy=nft kubelet=nft'
  ),
  nodeEvidence(
    'rule-gap-npd-kernel-oops',
    'Node adaptor records a kernel oops',
    'node-kernel-oops-evidence',
    '/var/run/abrt/abrt.socket',
    '{"type":"KernelOops","count":1,"message":"BUG: unable to handle controlled fixture fault"}',
    '{"recordType":"KernelOops","minimumCount":1}',
    'The inert adaptor stream contains one exact KernelOops record.',
    '{"type":"Health","count":1,"message":"no kernel oops records"}',
    minikubeProfile
  ),
  nodeEvidence(
    'rule-gap-npd-vmcore-created',
    'Node adaptor records a VMcore',
    'node-vmcore-evidence',
    '/var/run/abrt/abrt.socket',
    '{"type":"VMcore","count":1,"path":"/var/crash/127.0.0.1-2026-09-20-00:02:00/vmcore"}',
    '{"recordType":"VMcore","minimumCount":1}',
    'The inert adaptor stream contains one exact VMcore record.',
    '{"type":"Health","count":1,"message":"no VMcore records"}',
    minikubeProfile
  ),
  nodeEvidence(
    'rule-gap-npd-windows-defender-threat',
    'Windows node monitor reports a Defender threat',
    'windows-defender-evidence',
    'Microsoft-Windows-Windows Defender/Operational',
    'TimeCreated=2026-09-20T00:03:00Z EventID=1116 ThreatName=Controlled.Test.Signature Action=Detected',
    '{"condition":"WindowsDefenderThreatsDetected","eventId":1116,"minimumCount":1}',
    'The Windows event fixture contains a detection event and exact threat name.',
    'TimeCreated=2026-09-20T00:03:00Z EventID=1150 Message="security intelligence is current"'
  ),
  nodeEvidence(
    'rule-gap-npd-windows-kubeproxy-unhealthy',
    'Windows kube-proxy health check fails',
    'windows-network-proxy-health-evidence',
    'http://127.0.0.1:10256/healthz',
    '2026-09-20T00:04:00Z GET /healthz status=503 body="proxy loop unhealthy"',
    '{"condition":"KubeProxyUnhealthy","statusCode":{"minimum":500},"requiredMatches":1}',
    'The Windows health-check fixture records an HTTP 503 from the local proxy health endpoint.',
    '2026-09-20T00:04:00Z GET /healthz status=200 body="ok"'
  ),
];

const deprecatedDefinition = (
  scenarioId: string,
  title: string,
  resourceRef: string,
  setup: object,
  apiVersion: string,
  currentVersion: string
) =>
  draft({
    scenarioId,
    title,
    resourceRefs: [resourceRef],
    setup: [setup],
    resourceRef,
    fieldPath: 'apiVersion',
    brokenValue: apiVersion,
    finding: `The concrete manifest uses removed API version ${apiVersion}.`,
    healthyValue: currentVersion,
    healthyDescription: `A current manifest uses ${currentVersion}.`,
    observationKinds: ['manifest.api-version', 'manifest.object-identity', 'manifest.field'],
    mechanisms: [],
    profiles: fileProfile,
  });

const deprecatedDefinitions: ScenarioDraftDefinition[] = [
  deprecatedDefinition(
    'rule-gap-deprecated-crd-v1beta1',
    'Deprecated CustomResourceDefinition API',
    'manifest/customresourcedefinition/widgets.fixture.example',
    {
      apiVersion: 'apiextensions.k8s.io/v1beta1',
      kind: 'CustomResourceDefinition',
      metadata: { name: 'widgets.fixture.example' },
      spec: {
        group: 'fixture.example',
        version: 'v1alpha1',
        scope: 'Namespaced',
        names: { plural: 'widgets', singular: 'widget', kind: 'Widget' },
        validation: { openAPIV3Schema: { type: 'object' } },
      },
    },
    'apiextensions.k8s.io/v1beta1',
    'apiextensions.k8s.io/v1'
  ),
  deprecatedDefinition(
    'rule-gap-deprecated-endpointslice-v1beta1',
    'Deprecated EndpointSlice API',
    'manifest/endpointslice/legacy-backends',
    {
      apiVersion: 'discovery.k8s.io/v1beta1',
      kind: 'EndpointSlice',
      metadata: { name: 'legacy-backends', labels: { 'kubernetes.io/service-name': 'web' } },
      addressType: 'IPv4',
      ports: [{ name: 'http', protocol: 'TCP', port: 80 }],
      endpoints: [{ addresses: ['192.0.2.10'], conditions: { ready: true } }],
    },
    'discovery.k8s.io/v1beta1',
    'discovery.k8s.io/v1'
  ),
  deprecatedDefinition(
    'rule-gap-deprecated-apiservice-v1beta1',
    'Deprecated APIService API',
    'manifest/apiservice/v1alpha1.legacy.fixture.example',
    {
      apiVersion: 'apiregistration.k8s.io/v1beta1',
      kind: 'APIService',
      metadata: { name: 'v1alpha1.legacy.fixture.example' },
      spec: {
        group: 'legacy.fixture.example',
        version: 'v1alpha1',
        groupPriorityMinimum: 1000,
        versionPriority: 10,
        service: { namespace: 'default', name: 'legacy-api' },
        insecureSkipTLSVerify: true,
      },
    },
    'apiregistration.k8s.io/v1beta1',
    'apiregistration.k8s.io/v1'
  ),
  deprecatedDefinition(
    'rule-gap-deprecated-validating-webhook-v1beta1',
    'Deprecated ValidatingWebhookConfiguration API',
    'manifest/validatingwebhookconfiguration/legacy-validator',
    {
      apiVersion: 'admissionregistration.k8s.io/v1beta1',
      kind: 'ValidatingWebhookConfiguration',
      metadata: { name: 'legacy-validator' },
      webhooks: [
        {
          name: 'validate.fixture.example',
          admissionReviewVersions: ['v1beta1'],
          sideEffects: 'None',
          clientConfig: {
            service: { namespace: 'default', name: 'legacy-validator', path: '/validate' },
          },
          rules: [
            {
              apiGroups: [''],
              apiVersions: ['v1'],
              operations: ['CREATE'],
              resources: ['pods'],
            },
          ],
        },
      ],
    },
    'admissionregistration.k8s.io/v1beta1',
    'admissionregistration.k8s.io/v1'
  ),
  deprecatedDefinition(
    'rule-gap-deprecated-cert-manager-certificate-v1beta1',
    'Deprecated Certificate API',
    'manifest/certificate/legacy-certificate',
    {
      apiVersion: 'cert-manager.io/v1beta1',
      kind: 'Certificate',
      metadata: { name: 'legacy-certificate' },
      spec: {
        secretName: 'legacy-certificate-tls',
        dnsNames: ['legacy.fixture.example'],
        issuerRef: { name: 'fixture-issuer', kind: 'Issuer' },
      },
    },
    'cert-manager.io/v1beta1',
    'cert-manager.io/v1'
  ),
];

export const v3ScenarioDraftDefinitions: ScenarioDraftDefinition[] = [
  ...policyDefinitions,
  ...telemetryDefinitions,
  ...runtimeDefinitions,
  ...hostDefinitions,
  ...deprecatedDefinitions,
];
