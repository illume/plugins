import type { ClusterProfileName, RequiredMechanism } from '../contracts/evaluationContracts.js';
import type { ScenarioDraftDefinition } from './scenarioDraftDefinition.js';

export type V4Category =
  | 'workload_configuration'
  | 'control_plane_host_hardening'
  | 'runtime_node_failure'
  | 'operations_deprecation';
export type V4Feasibility = 'manifest_only' | 'live_cluster' | 'telemetry' | 'host' | 'runtime';
export type V4SelectionTrack = 'falco_chain' | 'node_problem_detector' | 'policy' | 'operations';

export interface V4ScenarioCatalogSeed {
  scenarioId: string;
  title: string;
  trigger: string;
  healthy: string;
  resources: string[];
  targetRuleIds: string[];
  selectionTrack: V4SelectionTrack;
  category: V4Category;
  feasibility: V4Feasibility;
  requiredMechanisms: string[];
  supportedClusterProfiles: ClusterProfileName[];
}

interface ScenarioOptions {
  id: string;
  title: string;
  setup: object[];
  resourceRef: string;
  fieldPath: string;
  brokenValue: string;
  finding: string;
  healthyValue: string;
  healthyDescription: string;
  rules: string[];
  resources?: string[];
  observationKinds?: string[];
  mechanisms?: RequiredMechanism[];
  profiles?: ClusterProfileName[];
  track?: V4SelectionTrack;
  category?: V4Category;
  feasibility?: V4Feasibility;
}

interface ScenarioRecord {
  definition: ScenarioDraftDefinition;
  catalog: V4ScenarioCatalogSeed;
}

const allProfiles: ClusterProfileName[] = ['local-kwok', 'local-minikube', 'aks'];
const runtimeProfiles: ClusterProfileName[] = ['local-minikube', 'aks'];
const fileProfile: ClusterProfileName[] = ['local-kwok'];
const pauseImage = 'registry.k8s.io/pause:3.10';
const busyboxImage = 'registry.k8s.io/e2e-test-images/busybox:1.29-4';

const scenario = (options: ScenarioOptions): ScenarioRecord => {
  const resources = options.resources ?? [options.resourceRef];
  const mechanisms = options.mechanisms ?? ['api-server'];
  const profiles = options.profiles ?? allProfiles;
  const definition: ScenarioDraftDefinition = {
    scenarioId: options.id,
    title: options.title,
    description: options.finding,
    taskPrompt:
      'Inspect the listed Kubernetes resources and diagnose the unsafe or unhealthy state. Cite the exact native field, status, event, metric, configuration, log, or bounded action evidence. Do not mutate resources.',
    visibleResourceRefs: resources,
    observationKinds: options.observationKinds ?? ['manifest.object', 'manifest.field'],
    setup: options.setup,
    acceptedFacts: [
      {
        fact_id: 'trigger-evidence',
        resource_ref: options.resourceRef,
        field_path: options.fieldPath,
        observed_value: options.brokenValue,
        description: options.finding,
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'healthy-control',
        resource_ref: options.resourceRef,
        field_path: options.fieldPath,
        observed_value: options.healthyValue,
        description: options.healthyDescription,
      },
    ],
    requiredMechanisms: mechanisms,
    supportedClusterProfiles: profiles,
  };
  return {
    definition,
    catalog: {
      scenarioId: options.id,
      title: options.title,
      trigger: `${options.title}: ${options.fieldPath} is ${options.brokenValue}.`,
      healthy: `${options.fieldPath} is ${options.healthyValue}.`,
      resources,
      targetRuleIds: options.rules,
      selectionTrack: options.track ?? 'policy',
      category: options.category ?? 'workload_configuration',
      feasibility: options.feasibility ?? 'manifest_only',
      requiredMechanisms:
        mechanisms.length > 0 ? mechanisms : ['manifest parser', 'normalized predicate evaluator'],
      supportedClusterProfiles: profiles,
    },
  };
};

const container = (overrides: Record<string, unknown> = {}) => ({
  name: 'app',
  image: pauseImage,
  securityContext: { allowPrivilegeEscalation: false, runAsNonRoot: true, runAsUser: 65532 },
  ...overrides,
});

const pod = (
  name: string,
  spec: Record<string, unknown>,
  metadata: Record<string, unknown> = {}
) => ({
  apiVersion: 'v1',
  kind: 'Pod',
  metadata: { name, labels: { app: name }, ...metadata },
  spec,
});

const deployment = (name: string, podSpec: Record<string, unknown>, replicas = 2) => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name },
  spec: {
    replicas,
    selector: { matchLabels: { app: name } },
    template: { metadata: { labels: { app: name } }, spec: podSpec },
  },
});

const role = (name: string, resources: string[], verbs: string[], apiGroups = ['']) => ({
  apiVersion: 'rbac.authorization.k8s.io/v1',
  kind: 'Role',
  metadata: { name },
  rules: [{ apiGroups, resources, verbs }],
});

const clusterRole = (name: string, resources: string[], verbs: string[], apiGroups = ['']) => ({
  apiVersion: 'rbac.authorization.k8s.io/v1',
  kind: 'ClusterRole',
  metadata: { name },
  rules: [{ apiGroups, resources, verbs }],
});

const actionJob = (name: string, command: string, image = busyboxImage) => ({
  apiVersion: 'batch/v1',
  kind: 'Job',
  metadata: { name, labels: { 'evals.kubernetes.io/bounded-action': 'true' } },
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
            name: 'action',
            image,
            command: ['/bin/sh', '-ceu', command],
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
              runAsNonRoot: true,
              runAsUser: 1000,
            },
            volumeMounts: [
              { name: 'fixture', mountPath: '/fixture' },
              { name: 'device-fixture', mountPath: '/dev/fixture' },
            ],
          },
        ],
        volumes: [
          { name: 'fixture', emptyDir: { sizeLimit: '16Mi' } },
          { name: 'device-fixture', emptyDir: { medium: 'Memory', sizeLimit: '1Mi' } },
        ],
      },
    },
  },
});

const manifestRecords: ScenarioRecord[] = [
  scenario({
    id: 'rule-gap-networkpolicy-peer-selector-matches-no-pods',
    title: 'NetworkPolicy peer selector matches no Pods',
    setup: [
      {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: { name: 'orphan-peer-policy' },
        spec: {
          podSelector: { matchLabels: { app: 'client' } },
          policyTypes: ['Egress'],
          egress: [{ to: [{ podSelector: { matchLabels: { app: 'missing-peer' } } }] }],
        },
      },
    ],
    resourceRef: 'networkpolicy/orphan-peer-policy',
    fieldPath: 'spec.egress[0].to[0].podSelector + matching Pod inventory',
    brokenValue: '{"matchLabels":{"app":"missing-peer"}}; 0',
    finding: 'The egress peer selector resolves to no Pods in the policy namespace.',
    healthyValue: '{app: peer}; 1 match',
    healthyDescription: 'The healthy peer selector resolves to one intended Pod.',
    rules: ['kube-linter:check:dangling-networkpolicypeer-podselector'],
    observationKinds: ['manifest.object', 'manifest.reference', 'pod.list'],
  }),
  scenario({
    id: 'rule-gap-deployment-uses-deprecated-service-account-field',
    title: 'Deployment uses the deprecated serviceAccount field',
    setup: [
      deployment('legacy-service-account', {
        serviceAccount: 'workload-identity',
        containers: [container()],
      }),
    ],
    resourceRef: 'deployment/legacy-service-account',
    fieldPath: 'spec.template.spec.serviceAccount',
    brokenValue: 'workload-identity',
    finding: 'The Pod template uses the deprecated serviceAccount alias.',
    healthyValue: 'field absent; serviceAccountName=workload-identity',
    healthyDescription: 'The healthy Pod template uses serviceAccountName only.',
    rules: ['kube-linter:check:deprecated-service-account-field'],
  }),
  scenario({
    id: 'rule-gap-deployment-omits-dns-options',
    title: 'Deployment omits required DNS resolver options',
    setup: [
      deployment('dns-options-missing', { dnsPolicy: 'ClusterFirst', containers: [container()] }),
    ],
    resourceRef: 'deployment/dns-options-missing',
    fieldPath: 'spec.template.spec.dnsConfig.options',
    brokenValue: 'field absent',
    finding: 'The Pod template omits the required resolver option set.',
    healthyValue: '[{name: ndots, value: "2"}]',
    healthyDescription: 'The healthy Pod template declares the reviewed ndots option.',
    rules: ['kube-linter:check:dnsconfig-options'],
  }),
  scenario({
    id: 'rule-gap-service-target-port-name-invalid',
    title: 'Service target port name violates Kubernetes syntax',
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'invalid-target-port' },
        spec: {
          selector: { app: 'web' },
          ports: [{ name: 'http', port: 80, targetPort: 'HTTP_UPPER' }],
        },
      },
    ],
    resourceRef: 'service/invalid-target-port',
    fieldPath: 'spec.ports[0].targetPort',
    brokenValue: 'HTTP_UPPER',
    finding: 'The named target port contains uppercase and underscore characters.',
    healthyValue: 'http-web',
    healthyDescription: 'The healthy target port is a valid IANA service name.',
    rules: ['kube-linter:check:invalid-target-ports'],
    profiles: fileProfile,
    mechanisms: [],
  }),
  scenario({
    id: 'rule-gap-standalone-job-omits-finished-ttl',
    title: 'Standalone Job omits its finished TTL',
    setup: [
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name: 'retained-completed-job' },
        spec: { template: { spec: { restartPolicy: 'Never', containers: [container()] } } },
      },
    ],
    resourceRef: 'job/retained-completed-job',
    fieldPath: 'spec.ttlSecondsAfterFinished',
    brokenValue: 'field absent',
    finding: 'The standalone Job has no bounded cleanup TTL.',
    healthyValue: '300',
    healthyDescription: 'The healthy Job is deleted 300 seconds after completion.',
    rules: ['kube-linter:check:job-ttl-seconds-after-finished'],
  }),
  scenario({
    id: 'rule-gap-deployment-uses-extensions-v1beta1',
    title: 'Deployment uses removed extensions API',
    setup: [
      {
        apiVersion: 'extensions/v1beta1',
        kind: 'Deployment',
        metadata: { name: 'legacy-extension-deployment' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'legacy-extension-deployment' } },
          template: {
            metadata: { labels: { app: 'legacy-extension-deployment' } },
            spec: { containers: [container()] },
          },
        },
      },
    ],
    resourceRef: 'manifest/deployment/legacy-extension-deployment',
    fieldPath: 'apiVersion',
    brokenValue: 'extensions/v1beta1',
    finding: 'The Deployment manifest uses an API removed from current Kubernetes releases.',
    healthyValue: 'apps/v1',
    healthyDescription: 'The healthy Deployment uses apps/v1.',
    rules: ['kube-linter:check:no-extensions-v1beta', 'kube-score:check:stable-version'],
    profiles: fileProfile,
    mechanisms: [],
    category: 'operations_deprecation',
  }),
  scenario({
    id: 'rule-gap-deployment-omits-node-affinity',
    title: 'Deployment omits required node affinity',
    setup: [deployment('no-node-affinity', { containers: [container()] })],
    resourceRef: 'deployment/no-node-affinity',
    fieldPath: 'spec.template.spec.affinity.nodeAffinity',
    brokenValue: 'field absent',
    finding: 'The Pod template has no node affinity constraints.',
    healthyValue: 'requiredDuringSchedulingIgnoredDuringExecution present',
    healthyDescription: 'The healthy template declares its reviewed node placement constraint.',
    rules: ['kube-linter:check:no-node-affinity'],
  }),
  scenario({
    id: 'rule-gap-container-exposes-privileged-port',
    title: 'Container exposes a privileged port',
    setup: [
      deployment('privileged-port', {
        containers: [container({ ports: [{ name: 'web', containerPort: 80 }] })],
      }),
    ],
    resourceRef: 'deployment/privileged-port',
    fieldPath: 'spec.template.spec.containers[0].ports[0].containerPort',
    brokenValue: '80',
    finding: 'The container declares a port below 1024.',
    healthyValue: '8080',
    healthyDescription: 'The healthy container listens on an unprivileged port.',
    rules: ['kube-linter:check:privileged-ports'],
  }),
  scenario({
    id: 'rule-gap-workload-omits-owner-email',
    title: 'Workload omits its owner email annotation',
    setup: [deployment('owner-email-missing', { containers: [container()] })],
    resourceRef: 'deployment/owner-email-missing',
    fieldPath: 'metadata.annotations[owner-email]',
    brokenValue: 'field absent',
    finding: 'The workload has no valid owner email annotation.',
    healthyValue: 'platform@example.test',
    healthyDescription: 'The healthy workload has a syntactically valid owner email.',
    rules: ['kube-linter:check:required-annotation-email'],
  }),
  scenario({
    id: 'rule-gap-workload-omits-owner-label',
    title: 'Workload omits its owner label',
    setup: [deployment('owner-label-missing', { containers: [container()] })],
    resourceRef: 'deployment/owner-label-missing',
    fieldPath: 'metadata.labels[owner]',
    brokenValue: 'field absent',
    finding: 'The workload has no ownership label.',
    healthyValue: 'platform-team',
    healthyDescription: 'The healthy workload identifies its owning team.',
    rules: ['kube-linter:check:required-label-owner'],
  }),
  scenario({
    id: 'rule-gap-pod-template-omits-restart-policy',
    title: 'Pod template omits its restart policy',
    setup: [deployment('restart-policy-missing', { containers: [container()] })],
    resourceRef: 'deployment/restart-policy-missing',
    fieldPath: 'spec.template.spec.restartPolicy',
    brokenValue: 'field absent',
    finding: 'The Pod template relies on an implicit restart policy.',
    healthyValue: 'Always',
    healthyDescription: 'The healthy controller template declares Always explicitly.',
    rules: ['kube-linter:check:restart-policy'],
  }),
  scenario({
    id: 'rule-gap-scc-allows-privileged-containers',
    title: 'SecurityContextConstraints permits privileged containers',
    setup: [
      {
        apiVersion: 'security.openshift.io/v1',
        kind: 'SecurityContextConstraints',
        metadata: { name: 'privileged-fixture' },
        allowPrivilegedContainer: true,
        runAsUser: { type: 'RunAsAny' },
        seLinuxContext: { type: 'RunAsAny' },
        users: ['system:serviceaccount:fixture:workload'],
      },
    ],
    resourceRef: 'manifest/securitycontextconstraints/privileged-fixture',
    fieldPath: 'allowPrivilegedContainer',
    brokenValue: 'true',
    finding: 'The security constraint explicitly permits privileged containers.',
    healthyValue: 'false',
    healthyDescription: 'The healthy constraint denies privileged containers.',
    rules: ['kube-linter:check:scc-deny-privileged-container'],
    profiles: fileProfile,
    mechanisms: [],
  }),
  scenario({
    id: 'rule-gap-pod-manifest-fails-schema-validation',
    title: 'Pod manifest contains an unknown specification field',
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'schema-invalid-pod' },
        spec: { containers: [container()], restartPolice: 'Never' },
      },
    ],
    resourceRef: 'manifest/pod/schema-invalid-pod',
    fieldPath: 'spec.restartPolice',
    brokenValue: 'Never',
    finding: 'The manifest contains the unknown restartPolice field.',
    healthyValue: 'field absent; spec.restartPolicy=Never',
    healthyDescription: 'The healthy manifest uses the recognized restartPolicy field.',
    rules: ['kube-linter:check:schema-validation'],
    profiles: fileProfile,
    mechanisms: [],
  }),
  scenario({
    id: 'rule-gap-pod-mounts-host-etc',
    title: 'Pod mounts the node etc directory',
    setup: [
      pod('host-etc-reader', {
        containers: [
          container({
            volumeMounts: [{ name: 'host-etc', mountPath: '/host-etc', readOnly: true }],
          }),
        ],
        volumes: [{ name: 'host-etc', hostPath: { path: '/etc', type: 'Directory' } }],
      }),
    ],
    resourceRef: 'pod/host-etc-reader',
    fieldPath: 'spec.volumes[0].hostPath.path',
    brokenValue: '/etc',
    finding: 'The Pod exposes the node etc directory through a hostPath volume.',
    healthyValue: 'hostPath field absent',
    healthyDescription: 'The healthy Pod uses only namespaced or ephemeral storage.',
    rules: ['kube-linter:check:sensitive-host-mounts'],
  }),
  scenario({
    id: 'rule-gap-manifest-keys-are-not-sorted',
    title: 'Manifest mapping keys violate the repository ordering policy',
    setup: [
      {
        kind: 'ConfigMap',
        apiVersion: 'v1',
        metadata: { name: 'unsorted-keys' },
        data: { zebra: '1', alpha: '2' },
      },
    ],
    resourceRef: 'manifest/configmap/unsorted-keys',
    fieldPath: 'document key order',
    brokenValue: 'kind before apiVersion; data.zebra before data.alpha',
    finding: 'The source manifest places mapping keys outside alphabetical order.',
    healthyValue: 'apiVersion before kind; data.alpha before data.zebra',
    healthyDescription: 'The healthy source orders comparable mapping keys alphabetically.',
    rules: ['kube-linter:check:sorted-keys'],
    profiles: fileProfile,
    mechanisms: [],
    observationKinds: ['manifest.source-order'],
  }),
  scenario({
    id: 'rule-gap-container-exposes-ssh-port',
    title: 'Container exposes the SSH port',
    setup: [
      deployment('ssh-port', {
        containers: [container({ ports: [{ name: 'ssh', containerPort: 22 }] })],
      }),
    ],
    resourceRef: 'deployment/ssh-port',
    fieldPath: 'spec.template.spec.containers[0].ports[0].containerPort',
    brokenValue: '22',
    finding: 'The workload declares the conventional SSH port.',
    healthyValue: '8080',
    healthyDescription: 'The healthy workload exposes only its application port.',
    rules: ['kube-linter:check:ssh-port'],
  }),
  scenario({
    id: 'rule-gap-workload-uses-default-namespace',
    title: 'Workload is assigned to the default namespace',
    setup: [deployment('default-namespace-workload', { containers: [container()] })],
    resourceRef: 'deployment/default-namespace-workload',
    fieldPath: 'metadata.namespace',
    brokenValue: 'default after namespace defaulting',
    finding: 'The workload is assigned to the shared default namespace.',
    healthyValue: 'team-a',
    healthyDescription: 'The healthy workload is assigned to a dedicated namespace.',
    rules: ['kube-linter:check:use-namespace'],
  }),
  ...[
    [
      'cpu-request-limit-differ',
      'Container CPU request differs from its limit',
      'spec.containers[0].resources.requests.cpu + spec.containers[0].resources.limits.cpu',
      '100m; 500m',
      '500m; 500m',
      'kube-score:check:container-cpu-requests-equal-limits',
    ],
    [
      'ephemeral-storage-omitted',
      'Container omits ephemeral storage request and limit',
      'spec.containers[0].resources.requests.ephemeral-storage + spec.containers[0].resources.limits.ephemeral-storage',
      '<both absent>',
      '64Mi; 64Mi',
      'kube-score:check:container-ephemeral-storage-request-and-limit',
    ],
    [
      'ephemeral-storage-request-limit-differ',
      'Container ephemeral storage request differs from its limit',
      'spec.containers[0].resources.requests.ephemeral-storage + spec.containers[0].resources.limits.ephemeral-storage',
      '32Mi; 64Mi',
      '64Mi; 64Mi',
      'kube-score:check:container-ephemeral-storage-request-equals-limit',
    ],
    [
      'memory-request-limit-differ',
      'Container memory request differs from its limit',
      'spec.containers[0].resources.requests.memory + spec.containers[0].resources.limits.memory',
      '32Mi; 64Mi',
      '64Mi; 64Mi',
      'kube-score:check:container-memory-requests-equal-limits',
    ],
    [
      'aggregate-request-limit-differ',
      'Container aggregate requests differ from limits',
      'spec.containers[0].resources.requests + spec.containers[0].resources.limits',
      '{"cpu":"100m","memory":"32Mi"}; {"cpu":"500m","memory":"64Mi"}',
      '{cpu:500m,memory:64Mi}; equal limits',
      'kube-score:check:container-resource-requests-equal-limits',
    ],
  ].map(([slug, title, fieldPath, brokenValue, healthyValue, rule]) =>
    scenario({
      id: `rule-gap-${slug}`,
      title: title!,
      setup: [
        pod(slug!, {
          containers: [
            container({
              resources:
                slug === 'ephemeral-storage-omitted'
                  ? {
                      requests: { cpu: '100m', memory: '32Mi' },
                      limits: { cpu: '100m', memory: '32Mi' },
                    }
                  : slug === 'ephemeral-storage-request-limit-differ'
                  ? {
                      requests: { 'ephemeral-storage': '32Mi' },
                      limits: { 'ephemeral-storage': '64Mi' },
                    }
                  : slug === 'cpu-request-limit-differ'
                  ? { requests: { cpu: '100m' }, limits: { cpu: '500m' } }
                  : slug === 'memory-request-limit-differ'
                  ? { requests: { memory: '32Mi' }, limits: { memory: '64Mi' } }
                  : {
                      requests: { cpu: '100m', memory: '32Mi' },
                      limits: { cpu: '500m', memory: '64Mi' },
                    },
            }),
          ],
        }),
      ],
      resourceRef: `pod/${slug}`,
      fieldPath: fieldPath!,
      brokenValue: brokenValue!,
      finding: `${title!}.`,
      healthyValue: healthyValue!,
      healthyDescription:
        'The healthy container has the exact reviewed resource request and limit values.',
      rules: [rule!],
    })
  ),
  scenario({
    id: 'rule-gap-container-port-is-unnamed',
    title: 'Container port omits a name',
    setup: [
      pod('unnamed-container-port', {
        containers: [container({ ports: [{ containerPort: 8080, protocol: 'TCP' }] })],
      }),
    ],
    resourceRef: 'pod/unnamed-container-port',
    fieldPath: 'spec.containers[0].ports[0].name',
    brokenValue: 'field absent for TCP port 8080',
    finding: 'The declared container port has no stable name.',
    healthyValue: 'http',
    healthyDescription: 'The healthy container names port 8080 http.',
    rules: ['kube-score:check:container-ports-check'],
  }),
  scenario({
    id: 'rule-gap-cronjob-restart-policy-invalid',
    title: 'CronJob template uses an invalid restart policy',
    setup: [
      {
        apiVersion: 'batch/v1',
        kind: 'CronJob',
        metadata: { name: 'invalid-restart-cronjob' },
        spec: {
          schedule: '0 * * * *',
          jobTemplate: {
            spec: { template: { spec: { restartPolicy: 'Always', containers: [container()] } } },
          },
        },
      },
    ],
    resourceRef: 'manifest/cronjob/invalid-restart-cronjob',
    fieldPath: 'spec.jobTemplate.spec.template.spec.restartPolicy',
    brokenValue: 'Always',
    finding: 'The CronJob Pod template uses a restart policy disallowed for Jobs.',
    healthyValue: 'Never',
    healthyDescription: 'The healthy CronJob uses Never.',
    rules: ['kube-score:check:cronjob-restartpolicy'],
    profiles: fileProfile,
    mechanisms: [],
  }),
  scenario({
    id: 'rule-gap-hpa-target-deployment-pins-replicas',
    title: 'Autoscaled Deployment pins a replica count',
    setup: [
      deployment('autoscaled-pinned', { containers: [container()] }, 3),
      {
        apiVersion: 'autoscaling/v2',
        kind: 'HorizontalPodAutoscaler',
        metadata: { name: 'autoscaled-pinned' },
        spec: {
          minReplicas: 2,
          maxReplicas: 6,
          scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'autoscaled-pinned' },
          metrics: [
            {
              type: 'Resource',
              resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 70 } },
            },
          ],
        },
      },
    ],
    resourceRef: 'deployment/autoscaled-pinned',
    fieldPath: 'spec.replicas + horizontalpodautoscaler/autoscaled-pinned.spec.scaleTargetRef',
    brokenValue: '3; {"apiVersion":"apps/v1","kind":"Deployment","name":"autoscaled-pinned"}',
    finding: 'The Deployment targeted by an HPA also pins spec.replicas.',
    healthyValue: 'spec.replicas field absent; Deployment/autoscaled-pinned',
    healthyDescription: 'The healthy autoscaled Deployment leaves replicas to the HPA.',
    rules: ['kube-score:check:deployment-targeted-by-hpa-does-not-have-replicas-configured'],
  }),
  scenario({
    id: 'rule-gap-label-value-invalid',
    title: 'Resource label value violates Kubernetes syntax',
    setup: [
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'invalid-label', labels: { owner: 'UPPER_VALUE!' } },
        data: { setting: 'safe' },
      },
    ],
    resourceRef: 'manifest/configmap/invalid-label',
    fieldPath: 'metadata.labels.owner',
    brokenValue: 'UPPER_VALUE!',
    finding: 'The owner label contains a disallowed exclamation mark.',
    healthyValue: 'platform-team',
    healthyDescription: 'The healthy label value conforms to Kubernetes label syntax.',
    rules: ['kube-score:check:label-values'],
    profiles: fileProfile,
    mechanisms: [],
  }),
  scenario({
    id: 'rule-gap-readiness-and-liveness-probes-identical',
    title: 'Container readiness and liveness probes are identical',
    setup: [
      pod('identical-probes', {
        containers: [
          container({
            readinessProbe: { httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 10 },
            livenessProbe: { httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 10 },
          }),
        ],
      }),
    ],
    resourceRef: 'pod/identical-probes',
    fieldPath: 'spec.containers[0].readinessProbe + spec.containers[0].livenessProbe',
    brokenValue:
      '{"failureThreshold":3,"httpGet":{"path":"/healthz","port":8080,"scheme":"HTTP"},"periodSeconds":10,"successThreshold":1,"timeoutSeconds":1}; {"failureThreshold":3,"httpGet":{"path":"/healthz","port":8080,"scheme":"HTTP"},"periodSeconds":10,"successThreshold":1,"timeoutSeconds":1}',
    finding: 'Readiness and liveness use the same endpoint and timing.',
    healthyValue: 'readiness GET /readyz; liveness GET /healthz',
    healthyDescription:
      'The healthy container distinguishes traffic readiness from process liveness.',
    rules: ['kube-score:check:pod-probes-identical'],
  }),
  scenario({
    id: 'rule-gap-statefulset-omits-host-anti-affinity',
    title: 'StatefulSet omits hostname anti-affinity',
    setup: [
      {
        apiVersion: 'apps/v1',
        kind: 'StatefulSet',
        metadata: { name: 'co-locatable-stateful' },
        spec: {
          serviceName: 'co-locatable-stateful',
          replicas: 3,
          selector: { matchLabels: { app: 'co-locatable-stateful' } },
          template: {
            metadata: { labels: { app: 'co-locatable-stateful' } },
            spec: { containers: [container()] },
          },
        },
      },
    ],
    resourceRef: 'statefulset/co-locatable-stateful',
    fieldPath: 'spec.template.spec.affinity.podAntiAffinity',
    brokenValue: 'field absent',
    finding: 'The StatefulSet does not prevent replicas from sharing one hostname.',
    healthyValue: 'required anti-affinity on kubernetes.io/hostname present',
    healthyDescription: 'The healthy StatefulSet spreads replicas across hostnames.',
    rules: ['kube-score:check:statefulset-has-host-podantiaffinity'],
  }),
  scenario({
    id: 'rule-gap-statefulset-service-is-not-headless',
    title: 'StatefulSet service is not headless',
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'stateful-address' },
        spec: {
          clusterIP: '10.96.0.44',
          selector: { app: 'stateful-address' },
          ports: [{ name: 'peer', port: 7000 }],
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'StatefulSet',
        metadata: { name: 'stateful-address' },
        spec: {
          serviceName: 'stateful-address',
          replicas: 2,
          selector: { matchLabels: { app: 'stateful-address' } },
          template: {
            metadata: { labels: { app: 'stateful-address' } },
            spec: { containers: [container()] },
          },
        },
      },
    ],
    resourceRef: 'statefulset/stateful-address',
    fieldPath: 'spec.serviceName + service/stateful-address.spec.clusterIP',
    brokenValue: 'stateful-address; 10.96.0.44',
    finding: 'The governing Service has a cluster IP instead of headless discovery.',
    healthyValue: 'stateful-address; None',
    healthyDescription: 'The healthy governing Service sets clusterIP to None.',
    rules: ['kube-score:check:statefulset-has-servicename'],
  }),
  scenario({
    id: 'rule-gap-statefulset-selector-mismatches-template',
    title: 'StatefulSet selector mismatches its Pod labels',
    setup: [
      {
        apiVersion: 'apps/v1',
        kind: 'StatefulSet',
        metadata: { name: 'selector-mismatch-stateful' },
        spec: {
          serviceName: 'selector-mismatch-stateful',
          selector: { matchLabels: { app: 'selected' } },
          template: {
            metadata: { labels: { app: 'different' } },
            spec: { containers: [container()] },
          },
        },
      },
    ],
    resourceRef: 'manifest/statefulset/selector-mismatch-stateful',
    fieldPath: 'spec.selector.matchLabels + spec.template.metadata.labels',
    brokenValue: '{app:selected}; {app:different}',
    finding: 'The StatefulSet selector cannot match its own Pod template.',
    healthyValue: '{app:selected}; {app:selected}',
    healthyDescription: 'The healthy selector and template labels are equal.',
    rules: ['kube-score:check:statefulset-pod-selector-labels-match-template-metadata-labels'],
    profiles: fileProfile,
    mechanisms: [],
  }),
  scenario({
    id: 'rule-gap-cluster-admin-binding-to-workload',
    title: 'Workload account is bound to cluster-admin',
    setup: [
      { apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'overprivileged-workload' } },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'ClusterRoleBinding',
        metadata: { name: 'workload-cluster-admin' },
        roleRef: {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'ClusterRole',
          name: 'cluster-admin',
        },
        subjects: [
          { kind: 'ServiceAccount', name: 'overprivileged-workload', namespace: 'default' },
        ],
      },
    ],
    resourceRef: 'clusterrolebinding/workload-cluster-admin',
    fieldPath: 'roleRef.name + subjects[0]',
    brokenValue:
      'cluster-admin; {"kind":"ServiceAccount","name":"overprivileged-workload","namespace":"default"}',
    finding: 'A namespaced workload account receives cluster-admin.',
    healthyValue: 'view; ServiceAccount/default/overprivileged-workload',
    healthyDescription: 'The healthy binding grants a reviewed least-privilege role.',
    rules: ['polaris:check:clusterrolebindingClusterAdmin'],
  }),
  ...[
    [
      'clusterrolebinding-grants-pod-exec',
      'ClusterRoleBinding grants Pod exec and attach',
      'ClusterRoleBinding',
      'polaris:check:clusterrolebindingPodExecAttach',
    ],
    [
      'clusterrole-grants-pod-exec',
      'ClusterRole grants Pod exec and attach',
      'ClusterRole',
      'polaris:check:clusterrolePodExecAttach',
    ],
    [
      'rolebinding-grants-cluster-pod-exec',
      'RoleBinding grants cluster-scoped Pod exec and attach',
      'RoleBinding',
      'polaris:check:rolebindingClusterRolePodExecAttach',
    ],
  ].map(([slug, title, bindingKind, rule]) => {
    const execRole = clusterRole(`${slug}-role`, ['pods/exec', 'pods/attach'], ['create']);
    const binding =
      bindingKind === 'ClusterRoleBinding'
        ? {
            apiVersion: 'rbac.authorization.k8s.io/v1',
            kind: 'ClusterRoleBinding',
            metadata: { name: slug },
            roleRef: {
              apiGroup: 'rbac.authorization.k8s.io',
              kind: 'ClusterRole',
              name: `${slug}-role`,
            },
            subjects: [{ kind: 'ServiceAccount', name: 'operator', namespace: 'default' }],
          }
        : bindingKind === 'RoleBinding'
        ? {
            apiVersion: 'rbac.authorization.k8s.io/v1',
            kind: 'RoleBinding',
            metadata: { name: slug },
            roleRef: {
              apiGroup: 'rbac.authorization.k8s.io',
              kind: 'ClusterRole',
              name: `${slug}-role`,
            },
            subjects: [{ kind: 'ServiceAccount', name: 'operator' }],
          }
        : execRole;
    return scenario({
      id: `rule-gap-${slug}`,
      title: title!,
      setup: bindingKind === 'ClusterRole' ? [execRole] : [execRole, binding],
      resourceRef: `${bindingKind!.toLowerCase()}/${
        bindingKind === 'ClusterRole' ? `${slug}-role` : slug
      }`,
      fieldPath:
        bindingKind === 'ClusterRole' ? 'rules[0]' : 'roleRef + referenced ClusterRole.rules[0]',
      brokenValue: '{"apiGroups":[""],"resources":["pods/exec","pods/attach"],"verbs":["create"]}',
      finding: `${title!}.`,
      healthyValue: 'resources=["pods"]; verbs=["get","list"]',
      healthyDescription: 'The healthy role cannot create exec or attach subresources.',
      rules: [rule!],
    });
  }),
  scenario({
    id: 'rule-gap-container-adds-sys-admin',
    title: 'Container adds the SYS_ADMIN capability',
    setup: [
      pod('sys-admin-capability', {
        containers: [
          container({
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { add: ['SYS_ADMIN'], drop: ['ALL'] },
              runAsUser: 1000,
            },
          }),
        ],
      }),
    ],
    resourceRef: 'pod/sys-admin-capability',
    fieldPath: 'spec.containers[0].securityContext.capabilities.add',
    brokenValue: '["SYS_ADMIN"]',
    finding: 'The container explicitly adds SYS_ADMIN.',
    healthyValue: '[] with drop=[ALL]',
    healthyDescription: 'The healthy container drops all capabilities and adds none.',
    rules: ['polaris:check:dangerousCapabilities'],
  }),
  scenario({
    id: 'rule-gap-windows-pod-enables-host-process',
    title: 'Windows Pod enables host process isolation',
    setup: [
      pod('windows-host-process', {
        os: { name: 'windows' },
        securityContext: {
          windowsOptions: { hostProcess: true, runAsUserName: 'NT AUTHORITY\\SYSTEM' },
        },
        containers: [container({ image: 'mcr.microsoft.com/windows/nanoserver:ltsc2022' })],
        nodeSelector: { 'kubernetes.io/os': 'windows' },
      }),
    ],
    resourceRef: 'pod/windows-host-process',
    fieldPath: 'spec.securityContext.windowsOptions.hostProcess',
    brokenValue: 'true',
    finding: 'The Windows Pod requests host process isolation.',
    healthyValue: 'false',
    healthyDescription: 'The healthy Windows Pod does not run as a host process.',
    rules: ['polaris:check:hostProcess'],
    profiles: fileProfile,
    mechanisms: [],
  }),
  scenario({
    id: 'rule-gap-container-omits-linux-hardening-controls',
    title: 'Container omits Linux hardening controls',
    setup: [
      pod('linux-hardening-missing', {
        containers: [{ name: 'app', image: pauseImage, securityContext: {} }],
      }),
    ],
    resourceRef: 'pod/linux-hardening-missing',
    fieldPath: 'spec.containers[0].securityContext',
    brokenValue: '{}',
    finding:
      'The Linux container declares neither RuntimeDefault seccomp nor a drop-all capability policy.',
    healthyValue: '{seccompProfile:{type:RuntimeDefault},capabilities:{drop:[ALL]}}',
    healthyDescription:
      'The healthy container combines RuntimeDefault seccomp with drop-all capabilities.',
    rules: ['polaris:check:linuxHardening'],
  }),
  scenario({
    id: 'rule-gap-controller-metadata-mismatches-template',
    title: 'Controller metadata labels mismatch Pod template labels',
    setup: [
      {
        ...deployment('metadata-mismatch', { containers: [container()] }),
        metadata: { name: 'metadata-mismatch', labels: { app: 'public-name' } },
      },
    ],
    resourceRef: 'deployment/metadata-mismatch',
    fieldPath: 'metadata.labels.app + spec.template.metadata.labels.app',
    brokenValue: 'public-name; metadata-mismatch',
    finding: 'The controller and Pod template publish different app labels.',
    healthyValue: 'metadata-mismatch; metadata-mismatch',
    healthyDescription: 'The healthy controller and Pod template use the same app label.',
    rules: ['polaris:check:metadataAndInstanceMismatched'],
  }),
  scenario({
    id: 'rule-gap-container-pull-policy-not-always',
    title: 'Mutable image tag uses a non-Always pull policy',
    setup: [
      pod('stale-image-policy', {
        containers: [
          container({ image: 'registry.example.test/app:latest', imagePullPolicy: 'IfNotPresent' }),
        ],
      }),
    ],
    resourceRef: 'pod/stale-image-policy',
    fieldPath: 'spec.containers[0].image + spec.containers[0].imagePullPolicy',
    brokenValue: 'registry.example.test/app:latest; IfNotPresent',
    finding: 'The mutable latest tag can reuse a stale local image.',
    healthyValue: 'registry.example.test/app:latest; Always',
    healthyDescription: 'The healthy mutable tag is always pulled.',
    rules: ['polaris:check:pullPolicyNotAlways'],
  }),
  scenario({
    id: 'rule-gap-configmap-contains-private-key',
    title: 'ConfigMap contains private key material',
    setup: [
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'misplaced-key' },
        data: {
          'tls.key': '-----BEGIN PRIVATE KEY-----\nCONTROLLED-FIXTURE\n-----END PRIVATE KEY-----',
        },
      },
    ],
    resourceRef: 'configmap/misplaced-key',
    fieldPath: 'data[tls.key]',
    brokenValue: 'PEM private-key header and footer present',
    finding: 'Private key material is stored in a non-secret ConfigMap.',
    healthyValue: 'data contains only non-sensitive configuration',
    healthyDescription: 'The healthy ConfigMap contains no credential or key patterns.',
    rules: ['polaris:check:sensitiveConfigmapContent'],
  }),
];

const relationshipRecords: ScenarioRecord[] = [
  scenario({
    id: 'rule-gap-rollout-references-missing-analysis-template',
    title: 'Rollout references a missing AnalysisTemplate',
    setup: [
      {
        apiVersion: 'argoproj.io/v1alpha1',
        kind: 'Rollout',
        metadata: { name: 'analysis-rollout' },
        spec: {
          replicas: 2,
          selector: { matchLabels: { app: 'analysis-rollout' } },
          template: {
            metadata: { labels: { app: 'analysis-rollout' } },
            spec: { containers: [container()] },
          },
          strategy: { canary: { analysis: { templates: [{ templateName: 'missing-analysis' }] } } },
        },
      },
    ],
    resourceRef: 'manifest/rollout/analysis-rollout',
    fieldPath:
      'spec.strategy.canary.analysis.templates[0].templateName + AnalysisTemplate inventory',
    brokenValue: 'missing-analysis; 0 matches',
    finding: 'The rollout analysis step names an AnalysisTemplate that is absent.',
    healthyValue: 'release-analysis; 1 match',
    healthyDescription: 'The healthy rollout resolves its analysis template.',
    rules: ['kubevious:rule:argo-rollout-analysis-template-ref'],
    profiles: fileProfile,
    mechanisms: [],
  }),
  scenario({
    id: 'rule-gap-certificate-references-missing-issuer',
    title: 'Certificate references a missing Issuer',
    setup: [
      {
        apiVersion: 'cert-manager.io/v1',
        kind: 'Certificate',
        metadata: { name: 'orphan-certificate' },
        spec: {
          secretName: 'orphan-certificate-tls',
          dnsNames: ['orphan.example.test'],
          issuerRef: { name: 'missing-issuer', kind: 'Issuer' },
        },
      },
    ],
    resourceRef: 'manifest/certificate/orphan-certificate',
    fieldPath: 'spec.issuerRef + Issuer inventory',
    brokenValue: 'Issuer/missing-issuer; 0 matches',
    finding: 'The Certificate names an Issuer that does not exist.',
    healthyValue: 'Issuer/team-issuer; 1 match',
    healthyDescription: 'The healthy Certificate resolves its issuer.',
    rules: ['kubevious:rule:certificate-to-issuer-ref'],
    profiles: fileProfile,
    mechanisms: [],
  }),
  scenario({
    id: 'rule-gap-container-request-exceeds-limit',
    title: 'Container resource request exceeds its limit',
    setup: [
      pod('request-above-limit', {
        containers: [container({ resources: { requests: { cpu: '1' }, limits: { cpu: '500m' } } })],
      }),
    ],
    resourceRef: 'manifest/pod/request-above-limit',
    fieldPath: 'spec.containers[0].resources.requests.cpu + limits.cpu',
    brokenValue: '1; 500m',
    finding: 'The CPU request is greater than the CPU limit.',
    healthyValue: '500m; 500m',
    healthyDescription: 'The healthy request does not exceed the limit.',
    rules: ['kubevious:rule:container-resource-request-limit-check'],
    profiles: fileProfile,
    mechanisms: [],
  }),
  scenario({
    id: 'rule-gap-container-volume-mount-has-no-volume',
    title: 'Container volume mount has no matching volume',
    setup: [
      pod('orphan-volume-mount', {
        containers: [container({ volumeMounts: [{ name: 'missing-volume', mountPath: '/data' }] })],
        volumes: [],
      }),
    ],
    resourceRef: 'manifest/pod/orphan-volume-mount',
    fieldPath: 'spec.containers[0].volumeMounts[0].name + spec.volumes',
    brokenValue: 'missing-volume; []',
    finding: 'The container mount name has no matching Pod volume.',
    healthyValue: 'data; [{name:data,emptyDir:{}}]',
    healthyDescription: 'The healthy mount resolves to an explicit Pod volume.',
    rules: ['kubevious:rule:container-volume-mount-ref'],
    profiles: fileProfile,
    mechanisms: [],
  }),
  scenario({
    id: 'rule-gap-gateway-certificate-secret-missing',
    title: 'Gateway listener references a missing TLS Secret',
    setup: [
      {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'Gateway',
        metadata: { name: 'tls-gateway' },
        spec: {
          gatewayClassName: 'fixture-class',
          listeners: [
            {
              name: 'https',
              protocol: 'HTTPS',
              port: 443,
              tls: {
                mode: 'Terminate',
                certificateRefs: [{ kind: 'Secret', name: 'missing-gateway-tls' }],
              },
            },
          ],
        },
      },
    ],
    resourceRef: 'manifest/gateway/tls-gateway',
    fieldPath: 'spec.listeners[0].tls.certificateRefs[0] + Secret inventory',
    brokenValue: 'Secret/missing-gateway-tls; 0 matches',
    finding: 'The HTTPS listener cannot resolve its certificate Secret.',
    healthyValue: 'Secret/gateway-tls; 1 match',
    healthyDescription: 'The healthy listener resolves a TLS Secret.',
    rules: ['kubevious:rule:gateway-certificate-secret-ref'],
    profiles: fileProfile,
    mechanisms: [],
  }),
  scenario({
    id: 'rule-gap-gateway-listeners-duplicate',
    title: 'Gateway declares duplicate listeners',
    setup: [
      {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'Gateway',
        metadata: { name: 'duplicate-listeners' },
        spec: {
          gatewayClassName: 'fixture-class',
          listeners: [
            { name: 'web-a', protocol: 'HTTP', port: 80 },
            { name: 'web-b', protocol: 'HTTP', port: 80 },
          ],
        },
      },
    ],
    resourceRef: 'manifest/gateway/duplicate-listeners',
    fieldPath: 'spec.listeners[*].protocol + spec.listeners[*].port',
    brokenValue: 'HTTP:80 appears twice',
    finding: 'Two Gateway listeners claim the same protocol and port.',
    healthyValue: 'HTTP:80 and HTTPS:443',
    healthyDescription: 'The healthy listeners have unique protocol and port tuples.',
    rules: ['kubevious:rule:gateway-unique-listeners'],
    profiles: fileProfile,
    mechanisms: [],
  }),
  scenario({
    id: 'rule-gap-httproute-references-missing-gateway',
    title: 'HTTPRoute references a missing Gateway',
    setup: [
      {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'HTTPRoute',
        metadata: { name: 'orphan-route' },
        spec: {
          parentRefs: [{ name: 'missing-gateway' }],
          rules: [{ backendRefs: [{ name: 'web', port: 80 }] }],
        },
      },
    ],
    resourceRef: 'manifest/httproute/orphan-route',
    fieldPath: 'spec.parentRefs[0].name + Gateway inventory',
    brokenValue: 'missing-gateway; 0 matches',
    finding: 'The route parent Gateway is absent.',
    healthyValue: 'public-gateway; 1 match',
    healthyDescription: 'The healthy route resolves its parent Gateway.',
    rules: ['kubevious:rule:http-route-gateway-ref'],
    profiles: fileProfile,
    mechanisms: [],
  }),
  scenario({
    id: 'rule-gap-ingress-routes-duplicate',
    title: 'Ingress objects declare duplicate routes',
    setup: [
      {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: { name: 'route-a' },
        spec: {
          rules: [
            {
              host: 'duplicate.example.test',
              http: {
                paths: [
                  {
                    path: '/',
                    pathType: 'Prefix',
                    backend: { service: { name: 'web-a', port: { number: 80 } } },
                  },
                ],
              },
            },
          ],
        },
      },
      {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: { name: 'route-b' },
        spec: {
          rules: [
            {
              host: 'duplicate.example.test',
              http: {
                paths: [
                  {
                    path: '/',
                    pathType: 'Prefix',
                    backend: { service: { name: 'web-b', port: { number: 80 } } },
                  },
                ],
              },
            },
          ],
        },
      },
    ],
    resourceRef: 'ingress/route-a + ingress/route-b',
    fieldPath: 'spec.rules[0].host + spec.rules[0].http.paths[0].path',
    brokenValue: 'duplicate.example.test; /; duplicate.example.test; /',
    finding: 'Two Ingress objects claim the same host and path.',
    healthyValue: 'distinct.example.test; / on route-b',
    healthyDescription: 'The healthy routes use distinct host and path tuples.',
    rules: ['kubevious:rule:ingress-unique-route-rules'],
  }),
  scenario({
    id: 'rule-gap-multiple-default-ingress-classes',
    title: 'Multiple IngressClasses are marked default',
    setup: [
      {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'IngressClass',
        metadata: {
          name: 'default-a',
          annotations: { 'ingressclass.kubernetes.io/is-default-class': 'true' },
        },
        spec: { controller: 'example.test/a' },
      },
      {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'IngressClass',
        metadata: {
          name: 'default-b',
          annotations: { 'ingressclass.kubernetes.io/is-default-class': 'true' },
        },
        spec: { controller: 'example.test/b' },
      },
    ],
    resourceRef: 'ingressclass/default-a + ingressclass/default-b',
    fieldPath: 'metadata.annotations[ingressclass.kubernetes.io/is-default-class]',
    brokenValue: 'true; true',
    finding: 'Two IngressClasses simultaneously claim default status.',
    healthyValue: 'true on exactly one IngressClass',
    healthyDescription: 'The healthy cluster has at most one default IngressClass.',
    rules: ['kubevious:rule:multiple-default-ingress-classes'],
  }),
  scenario({
    id: 'rule-gap-service-has-no-endpoints',
    title: 'Service has no associated endpoints',
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'empty-service' },
        spec: {
          selector: { app: 'missing-backend' },
          ports: [{ name: 'http', port: 80, targetPort: 'http' }],
        },
      },
    ],
    resourceRef: 'service/empty-service',
    fieldPath: 'spec.selector + EndpointSlice inventory',
    brokenValue: '{"app":"missing-backend"}; 0',
    finding: 'The Service selector produces no ready endpoints.',
    healthyValue: '{app:web}; 2 ready endpoints',
    healthyDescription: 'The healthy Service has two ready endpoints.',
    rules: ['popeye:code:1105'],
    feasibility: 'live_cluster',
    mechanisms: ['api-server', 'endpointslice-controller'],
  }),
  scenario({
    id: 'rule-gap-endpoints-object-has-no-subsets',
    title: 'Endpoints object has no subsets',
    setup: [
      { apiVersion: 'v1', kind: 'Endpoints', metadata: { name: 'empty-subsets' }, subsets: [] },
    ],
    resourceRef: 'endpoints/empty-subsets',
    fieldPath: 'subsets',
    brokenValue: '[]',
    finding: 'The Endpoints object contains no address and port subsets.',
    healthyValue: '[{addresses:[{ip:192.0.2.10}],ports:[{port:8080}]}]',
    healthyDescription: 'The healthy object contains one address and port subset.',
    rules: ['popeye:code:1110'],
  }),
  scenario({
    id: 'rule-gap-service-has-single-endpoint',
    title: 'Service has only one ready endpoint',
    setup: [
      {
        apiVersion: 'discovery.k8s.io/v1',
        kind: 'EndpointSlice',
        metadata: {
          name: 'single-backend',
          labels: { 'kubernetes.io/service-name': 'single-backend' },
        },
        addressType: 'IPv4',
        ports: [{ name: 'http', protocol: 'TCP', port: 8080 }],
        endpoints: [{ addresses: ['192.0.2.10'], conditions: { ready: true } }],
      },
    ],
    resourceRef: 'endpointslice/single-backend',
    fieldPath: 'endpoints[?conditions.ready=true]',
    brokenValue: '1',
    finding: 'The Service backend has no redundancy because only one endpoint is ready.',
    healthyValue: 'at least 2 endpoints',
    healthyDescription: 'The healthy Service has at least two ready endpoints.',
    rules: ['popeye:code:1109'],
  }),
  scenario({
    id: 'rule-gap-replicaset-ready-count-below-desired',
    title: 'ReplicaSet has fewer ready Pods than desired',
    setup: [
      {
        apiVersion: 'apps/v1',
        kind: 'ReplicaSet',
        metadata: { name: 'underready-replicaset' },
        spec: {
          replicas: 3,
          selector: { matchLabels: { app: 'underready-replicaset' } },
          template: {
            metadata: { labels: { app: 'underready-replicaset' } },
            spec: {
              containers: [
                container({ image: busyboxImage, command: ['/bin/sh', '-c', 'exit 1'] }),
              ],
            },
          },
        },
      },
    ],
    resourceRef: 'replicaset/underready-replicaset',
    fieldPath: 'spec.replicas + status.readyReplicas',
    brokenValue: '3; <absent or 0>',
    finding: 'None of the three desired replicas becomes ready.',
    healthyValue: '3; 3',
    healthyDescription: 'The healthy ReplicaSet has all desired replicas ready.',
    rules: ['popeye:code:1120'],
    feasibility: 'telemetry',
    track: 'operations',
    category: 'runtime_node_failure',
    mechanisms: ['api-server', 'kubelet'],
    profiles: runtimeProfiles,
    observationKinds: ['replicaset.spec', 'replicaset.status'],
  }),
  scenario({
    id: 'rule-gap-networkpolicy-namespace-selector-matches-none',
    title: 'NetworkPolicy namespace selector matches no namespace',
    setup: [
      {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: { name: 'orphan-namespace-peer' },
        spec: {
          podSelector: {},
          policyTypes: ['Ingress'],
          ingress: [
            { from: [{ namespaceSelector: { matchLabels: { tenant: 'missing-tenant' } } }] },
          ],
        },
      },
    ],
    resourceRef: 'networkpolicy/orphan-namespace-peer',
    fieldPath: 'spec.ingress[0].from[0].namespaceSelector + Namespace inventory',
    brokenValue: '{"matchLabels":{"tenant":"missing-tenant"}}; 0',
    finding: 'The ingress namespace selector resolves to no namespace.',
    healthyValue: '{tenant:team-a}; 1 match',
    healthyDescription: 'The healthy peer selector resolves to its intended namespace.',
    rules: ['popeye:code:1201'],
  }),
  scenario({
    id: 'rule-gap-pod-owner-is-not-running',
    title: 'Pod owner is not in a running state',
    setup: [
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name: 'failed-owner' },
        spec: {
          activeDeadlineSeconds: 60,
          backoffLimit: 0,
          template: {
            metadata: { labels: { app: 'failed-owner' } },
            spec: {
              restartPolicy: 'Never',
              containers: [
                container({ image: busyboxImage, command: ['/bin/sh', '-c', 'exit 1'] }),
              ],
            },
          },
        },
      },
    ],
    resourceRef: 'pod[label=job-name=failed-owner]',
    fieldPath:
      'metadata.ownerReferences[0].name + job/failed-owner.status.conditions[type=Failed].status',
    brokenValue: 'failed-owner; True',
    finding: 'The Pod controller owner is a failed Job.',
    healthyValue: 'Job/running-owner; Failed condition absent',
    healthyDescription: 'The healthy Pod owner remains active or complete.',
    rules: ['popeye:code:1703'],
    feasibility: 'telemetry',
    track: 'operations',
    category: 'runtime_node_failure',
    profiles: runtimeProfiles,
  }),
  scenario({
    id: 'rule-gap-pod-owner-reference-is-missing',
    title: 'Pod owner reference resolves to no object',
    setup: [
      pod(
        'orphan-owner-pod',
        { containers: [container()] },
        {
          ownerReferences: [
            {
              apiVersion: 'apps/v1',
              kind: 'ReplicaSet',
              name: 'missing-owner',
              uid: '00000000-0000-4000-8000-000000000018',
              controller: true,
            },
          ],
        }
      ),
    ],
    resourceRef: 'pod/orphan-owner-pod',
    fieldPath: 'metadata.ownerReferences[0] + ReplicaSet inventory',
    brokenValue:
      '{"apiVersion":"apps/v1","controller":true,"kind":"ReplicaSet","name":"missing-owner","uid":"00000000-0000-4000-8000-000000000018"}; 0',
    finding: 'The controlling owner reference cannot be resolved by name and UID.',
    healthyValue: 'ReplicaSet/present-owner; 1 UID match',
    healthyDescription: 'The healthy owner reference resolves to its controller.',
    rules: ['popeye:code:1704'],
  }),
  scenario({
    id: 'rule-gap-pod-matches-multiple-pdbs',
    title: 'Pod matches multiple PodDisruptionBudgets',
    setup: [
      pod('multiply-protected', { containers: [container()] }),
      {
        apiVersion: 'policy/v1',
        kind: 'PodDisruptionBudget',
        metadata: { name: 'pdb-a' },
        spec: { minAvailable: 1, selector: { matchLabels: { app: 'multiply-protected' } } },
      },
      {
        apiVersion: 'policy/v1',
        kind: 'PodDisruptionBudget',
        metadata: { name: 'pdb-b' },
        spec: { maxUnavailable: 1, selector: { matchLabels: { app: 'multiply-protected' } } },
      },
    ],
    resourceRef: 'pod/multiply-protected',
    fieldPath: 'metadata.labels + PodDisruptionBudget selector inventory',
    brokenValue: '{"app":"multiply-protected"}; 2',
    finding: 'Two disruption budgets select the same Pod.',
    healthyValue: '{app:multiply-protected}; matches only pdb-a',
    healthyDescription: 'The healthy Pod is governed by one disruption budget.',
    rules: ['popeye:code:209'],
  }),
];

const kubescapeRecords: ScenarioRecord[] = [
  ...[
    [
      'proxy-subresource',
      'Role permits API proxy subresource access',
      clusterRole(
        'proxy-access',
        ['pods/proxy', 'services/proxy', 'nodes/proxy'],
        ['get', 'create']
      ),
      'rules[0]',
      'resources=[pods/proxy,services/proxy,nodes/proxy]; verbs=[get,create]',
      'resources=[pods]; verbs=[get,list]',
      'kubescape:rule:rule-can-access-proxy-subresource',
    ],
    [
      'approve-csr',
      'Role permits certificate request approval',
      clusterRole(
        'csr-approver',
        ['certificatesigningrequests/approval'],
        ['update'],
        ['certificates.k8s.io']
      ),
      'rules[0]',
      'apiGroups=[certificates.k8s.io]; resources=[certificatesigningrequests/approval]; verbs=[update]',
      'resources=[certificatesigningrequests]; verbs=[get,list]',
      'kubescape:rule:rule-can-approve-cert-signing-request',
    ],
    [
      'create-service-account-token',
      'Role permits ServiceAccount token creation',
      role('token-creator', ['serviceaccounts/token'], ['create']),
      'rules[0]',
      'resources=[serviceaccounts/token]; verbs=[create]',
      'resources=[serviceaccounts]; verbs=[get]',
      'kubescape:rule:rule-can-create-service-account-token',
    ],
    [
      'impersonate-identities',
      'ClusterRole permits identity impersonation',
      clusterRole(
        'identity-impersonator',
        ['users', 'groups'],
        ['impersonate'],
        ['authentication.k8s.io']
      ),
      'rules[0]',
      'resources=[users,groups]; verbs=[impersonate]',
      'resources=[users]; verbs=[get]',
      'kubescape:rule:rule-can-impersonate-users-groups-v1',
    ],
    [
      'modify-admission-webhooks',
      'ClusterRole permits admission webhook mutation',
      clusterRole(
        'webhook-editor',
        ['mutatingwebhookconfigurations', 'validatingwebhookconfigurations'],
        ['create', 'update', 'patch'],
        ['admissionregistration.k8s.io']
      ),
      'rules[0]',
      'resources=[mutatingwebhookconfigurations,validatingwebhookconfigurations]; verbs=[create,update,patch]',
      'resources=[validatingwebhookconfigurations]; verbs=[get,list]',
      'kubescape:rule:rule-can-modify-admission-webhooks',
    ],
    [
      'update-configmaps',
      'Role permits ConfigMap updates',
      role('configmap-editor', ['configmaps'], ['update', 'patch']),
      'rules[0]',
      'resources=[configmaps]; verbs=[update,patch]',
      'resources=[configmaps]; verbs=[get,list]',
      'kubescape:rule:rule-can-update-configmap-v1',
    ],
    [
      'excessive-delete-rights',
      'ClusterRole grants broad delete rights',
      clusterRole(
        'broad-deleter',
        ['deployments', 'statefulsets', 'daemonsets'],
        ['delete', 'deletecollection'],
        ['apps']
      ),
      'rules[0]',
      'resources=[deployments,statefulsets,daemonsets]; verbs=[delete,deletecollection]',
      'resources=[deployments]; verbs=[get,list]',
      'kubescape:rule:rule-excessive-delete-rights-v1',
    ],
  ].map(([slug, title, object, fieldPath, brokenValue, healthyValue, rule]) =>
    scenario({
      id: `rule-gap-${slug}`,
      title: title as string,
      setup: [object as object],
      resourceRef: `${(object as { kind: string }).kind.toLowerCase()}/${
        (object as { metadata: { name: string } }).metadata.name
      }`,
      fieldPath: fieldPath as string,
      brokenValue: brokenValue as string,
      finding: `${title}.`,
      healthyValue: healthyValue as string,
      healthyDescription:
        'The healthy role is limited to read-only access to the named ordinary resource.',
      rules: [rule as string],
    })
  ),
  scenario({
    id: 'rule-gap-pod-has-no-controller-owner',
    title: 'Pod has no controller owner',
    setup: [pod('standalone-workload', { containers: [container()] })],
    resourceRef: 'pod/standalone-workload',
    fieldPath: 'metadata.ownerReferences[?controller=true]',
    brokenValue: '[]',
    finding: 'The Pod is not managed by a workload controller.',
    healthyValue: '[{kind:ReplicaSet,name:managed-owner,controller:true}]',
    healthyDescription: 'The healthy Pod has one controller owner.',
    rules: ['kubescape:rule:naked-pods'],
  }),
  scenario({
    id: 'rule-gap-namespace-has-no-service-account',
    title: 'Namespace contains no ServiceAccount',
    setup: [{ apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'accountless-namespace' } }],
    resourceRef: 'namespace/accountless-namespace',
    fieldPath: 'ServiceAccount inventory for metadata.name=accountless-namespace',
    brokenValue: '0 ServiceAccounts',
    finding: 'The namespace contains no ServiceAccount object.',
    healthyValue: '1 ServiceAccount named default',
    healthyDescription: 'The healthy namespace contains its default ServiceAccount.',
    rules: ['kubescape:rule:namespace-without-service-account'],
    observationKinds: ['namespace.object', 'serviceaccount.list'],
  }),
  scenario({
    id: 'rule-gap-namespace-omits-pod-security-enforce',
    title: 'Namespace omits Pod Security enforcement',
    setup: [
      {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name: 'unenforced-namespace',
          labels: {
            'pod-security.kubernetes.io/audit': 'restricted',
            'pod-security.kubernetes.io/warn': 'restricted',
          },
        },
      },
    ],
    resourceRef: 'namespace/unenforced-namespace',
    fieldPath: 'metadata.labels[pod-security.kubernetes.io/enforce]',
    brokenValue: 'field absent',
    finding: 'The namespace audits and warns but does not enforce a Pod Security level.',
    healthyValue: 'restricted',
    healthyDescription: 'The healthy namespace enforces the restricted level.',
    rules: ['kubescape:rule:pod-security-admission-applied-1'],
  }),
  ...[
    [
      'pod-fsgroup-is-root',
      'Pod filesystem group is root',
      { fsGroup: 0 },
      'spec.securityContext.fsGroup',
      '0',
      '65532',
      'kubescape:rule:set-fsgroup-value',
    ],
    [
      'pod-fsgroup-change-policy-always',
      'Pod always changes volume ownership',
      { fsGroup: 65532, fsGroupChangePolicy: 'Always' },
      'spec.securityContext.fsGroupChangePolicy',
      'Always',
      'OnRootMismatch',
      'kubescape:rule:set-fsgroupchangepolicy-value',
    ],
    [
      'windows-pod-runs-as-system',
      'Windows Pod runs as the SYSTEM account',
      { windowsOptions: { runAsUserName: 'NT AUTHORITY\\SYSTEM' } },
      'spec.securityContext.windowsOptions.runAsUserName',
      'NT AUTHORITY\\SYSTEM',
      'ContainerUser',
      'kubescape:rule:set-runasusername-value',
    ],
    [
      'pod-supplemental-group-is-root',
      'Pod supplemental groups include root',
      { supplementalGroups: [0, 65532] },
      'spec.securityContext.supplementalGroups',
      '[0,65532]',
      '[65532]',
      'kubescape:rule:set-supplementalgroups-values',
    ],
  ].map(([slug, title, securityContext, fieldPath, brokenValue, healthyValue, rule]) =>
    scenario({
      id: `rule-gap-${slug}`,
      title: title as string,
      setup: [pod(slug as string, { securityContext, containers: [container()] })],
      resourceRef: `pod/${slug}`,
      fieldPath: fieldPath as string,
      brokenValue: brokenValue as string,
      finding: `${title}.`,
      healthyValue: healthyValue as string,
      healthyDescription: 'The healthy Pod uses the reviewed non-root security setting.',
      rules: [rule as string],
    })
  ),
  scenario({
    id: 'rule-gap-workload-mounts-persistent-volume-claim',
    title: 'Workload mounts a PersistentVolumeClaim',
    setup: [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: { name: 'workload-data' },
        spec: { accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '1Gi' } } },
      },
      pod('pvc-consumer', {
        containers: [container({ volumeMounts: [{ name: 'data', mountPath: '/data' }] })],
        volumes: [
          { name: 'data', persistentVolumeClaim: { claimName: 'workload-data', readOnly: false } },
        ],
      }),
    ],
    resourceRef: 'pod/pvc-consumer',
    fieldPath: 'spec.volumes[0].persistentVolumeClaim',
    brokenValue: '{"claimName":"workload-data"}',
    finding: 'The workload mounts a writable persistent claim.',
    healthyValue: 'persistentVolumeClaim field absent',
    healthyDescription: 'The healthy stateless workload uses no persistent claim.',
    rules: ['kubescape:rule:workload-mounted-pvc'],
  }),
];

const metricScenario = (
  id: string,
  title: string,
  setup: object[],
  resourceRef: string,
  fieldPath: string,
  brokenValue: string,
  healthyValue: string,
  rule: string,
  mechanisms: RequiredMechanism[]
) =>
  scenario({
    id,
    title,
    setup,
    resourceRef,
    fieldPath,
    brokenValue,
    finding: `${title} for the pinned observation window.`,
    healthyValue,
    healthyDescription: 'The healthy control remains outside the threshold for the full window.',
    rules: [rule],
    resources: [
      ...new Set([
        ...setup.map(
          item =>
            `${String((item as { kind?: string }).kind ?? 'resource').toLowerCase()}/${String(
              (item as { metadata?: { name?: string } }).metadata?.name ?? 'fixture'
            )}`
        ),
        resourceRef,
      ]),
    ],
    observationKinds: ['resource.spec', 'resource.status', 'metric.range'],
    mechanisms,
    profiles: runtimeProfiles,
    track: 'operations',
    category: 'runtime_node_failure',
    feasibility: 'telemetry',
  });

const telemetryRecords: ScenarioRecord[] = [
  metricScenario(
    'rule-gap-cluster-cpu-quota-overcommitted',
    'Cluster CPU quotas are overcommitted',
    [
      {
        apiVersion: 'v1',
        kind: 'ResourceQuota',
        metadata: { name: 'cpu-quota-overcommit' },
        spec: { hard: { 'requests.cpu': '100000' } },
      },
    ],
    'metric/kube_resourcequota + kube_node_status_allocatable',
    'sum(hard requests.cpu) / sum(allocatable cpu)',
    '> 1.5 for 5m',
    '<= 1.0 for 5m',
    'kubernetes-mixin:alert:KubeCPUQuotaOvercommit',
    ['api-server', 'scheduler']
  ),
  metricScenario(
    'rule-gap-cluster-memory-quota-overcommitted',
    'Cluster memory quotas are overcommitted',
    [
      {
        apiVersion: 'v1',
        kind: 'ResourceQuota',
        metadata: { name: 'memory-quota-overcommit' },
        spec: { hard: { 'requests.memory': '1Pi' } },
      },
    ],
    'metric/kube_resourcequota + kube_node_status_allocatable',
    'sum(hard requests.memory) / sum(allocatable memory)',
    '> 1.5 for 5m',
    '<= 1.0 for 5m',
    'kubernetes-mixin:alert:KubeMemoryQuotaOvercommit',
    ['api-server', 'scheduler']
  ),
  metricScenario(
    'rule-gap-pdb-has-insufficient-healthy-pods',
    'PodDisruptionBudget has insufficient healthy Pods',
    [
      {
        apiVersion: 'policy/v1',
        kind: 'PodDisruptionBudget',
        metadata: { name: 'underhealthy-pdb' },
        spec: { minAvailable: 2, selector: { matchLabels: { app: 'underhealthy' } } },
      },
      pod('underhealthy-ready', { containers: [container()] }, { labels: { app: 'underhealthy' } }),
      pod(
        'underhealthy-failed',
        {
          restartPolicy: 'Never',
          containers: [container({ image: busyboxImage, command: ['/bin/sh', '-c', 'exit 1'] })],
        },
        { labels: { app: 'underhealthy' } }
      ),
    ],
    'poddisruptionbudget/underhealthy-pdb',
    'status.currentHealthy + status.desiredHealthy',
    '1; 2',
    '2; 2 for 15m',
    'kubernetes-mixin:alert:KubePdbNotEnoughHealthyPods',
    ['api-server', 'operator-reconciliation']
  ),
];

const runtimeRecords: ScenarioRecord[] = [
  [
    'create-file-below-dev',
    'Process creates a file below dev',
    'printf controlled > /dev/fixture/created-file; stat -c "%n %s" /dev/fixture/created-file',
    '/dev/fixture/created-file 10',
    'falco:rule:create-files-below-dev:c43e0522340a',
  ],
  [
    'hardlink-sensitive-file',
    'Process hard-links a sensitive fixture file',
    'printf credential > /fixture/shadow; ln /fixture/shadow /fixture/shadow-link; stat -c "%i" /fixture/shadow /fixture/shadow-link',
    'two identical inode numbers',
    'falco:rule:create-hardlink-over-sensitive-files:5587275ce68c',
  ],
  [
    'database-process-spawns-shell',
    'Database-named process spawns a shell',
    'cp /usr/local/bin/python3 /fixture/mysqld; /fixture/mysqld -c \'import subprocess; subprocess.run(["/bin/sh","-c","echo database-child-shell"], check=True)\'',
    'database-child-shell',
    'falco:rule:db-program-spawned-process:63f26be05ca7',
    'python:3.12-alpine',
  ],
  [
    'directory-traversal-read',
    'Process reads a monitored file through directory traversal',
    'mkdir -p /fixture/root/a /fixture/root/secret; printf controlled > /fixture/root/secret/value; cat /fixture/root/a/../secret/value',
    'controlled',
    'falco:rule:directory-traversal-monitored-file-read:c83a585f7dce',
  ],
  [
    'remote-copy-tool-launched',
    'Container launches a remote copy client',
    'mkdir -p /fixture/bin; printf "#!/bin/sh\necho scp-fixture\n" > /fixture/bin/scp; chmod 755 /fixture/bin/scp; /fixture/bin/scp --help',
    'scp-fixture',
    'falco:rule:launch-remote-file-copy-tools-in-container:fac2e6a651ee',
  ],
  [
    'container-entrypoint-modified',
    'Process modifies a container entrypoint fixture',
    'printf "#!/bin/sh\nexit 0\n" > /fixture/entrypoint.sh; chmod 755 /fixture/entrypoint.sh; printf "#!/bin/sh\necho changed\n" > /fixture/entrypoint.sh; sha256sum /fixture/entrypoint.sh',
    '<sha256> /fixture/entrypoint.sh',
    'falco:rule:modify-container-entrypoint:1b1c0293255e',
  ],
  [
    'http-proxy-environment-exec',
    'Program executes with an HTTP proxy environment variable',
    'HTTP_PROXY=http://127.0.0.1:9 /bin/sh -c "printf proxy-env-exec"',
    'proxy-env-exec',
    'falco:rule:program-run-with-disallowed-http-proxy-env:480022c74baf',
  ],
  [
    'sensitive-file-read-after-startup',
    'Process reads a sensitive fixture after startup',
    'printf controlled > /fixture/shadow; sleep 2; cat /fixture/shadow',
    'controlled',
    'falco:rule:read-sensitive-file-trusted-after-startup:41584bab67f3',
  ],
  [
    'bounded-bulk-file-removal',
    'Process removes a bounded bulk data set',
    'mkdir -p /fixture/data; n=0; while [ "$n" -lt 40 ]; do printf x > /fixture/data/file-$n; n=$((n+1)); done; rm -f /fixture/data/file-*; find /fixture/data -type f | wc -l',
    '0',
    'falco:rule:remove-bulk-data-from-disk:8aa8cf7ccdec',
  ],
  [
    'write-monitored-directory',
    'Process writes below a monitored fixture directory',
    'mkdir -p /fixture/etc; printf controlled > /fixture/etc/monitor.conf; sha256sum /fixture/etc/monitor.conf',
    '<sha256> /fixture/etc/monitor.conf',
    'falco:rule:write-below-monitored-dir:3f3906c7a191',
  ],
].map(([slug, title, command, output, rule, image]) =>
  scenario({
    id: `rule-gap-${slug}`,
    title: title!,
    setup: [actionJob(slug!, command!, image)],
    resourceRef: `pod[label=job-name=${slug}]`,
    fieldPath: 'spec.containers[0].command + logs',
    brokenValue: `${command!}; ${output!}`,
    finding: `${title!} inside bounded Pod-local storage.`,
    healthyValue: 'bounded command and output marker absent',
    healthyDescription: 'The healthy control performs no matching file or process action.',
    rules: [rule!],
    resources: [`job/${slug}`, `pod[label=job-name=${slug}]`],
    observationKinds: ['job.pod-template', 'pod.security-context', 'pod.logs'],
    mechanisms: ['api-server', 'kubelet'],
    profiles: runtimeProfiles,
    track: 'falco_chain',
    category: 'runtime_node_failure',
    feasibility: 'runtime',
  })
);

const nodeRecord = (id: string, title: string, eventType: string, payload: string, rule: string) =>
  scenario({
    id,
    title,
    setup: [
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: {
          name: `${eventType.toLowerCase()}-node-evidence`,
          labels: { 'evals.kubernetes.io/fixture-kind': 'node-log-or-config' },
          annotations: {
            'evals.kubernetes.io/adapter': 'normalized-node-predicate',
            'evals.kubernetes.io/source-path': '/var/run/abrt/abrt.socket',
            'evals.kubernetes.io/apply-to-current-host': 'false',
          },
        },
        data: {
          'source-evidence.json': payload,
          'predicate.json': JSON.stringify({ recordType: eventType, minimumCount: 1 }),
          'healthy-control.json': JSON.stringify({
            type: 'Health',
            count: 1,
            message: `no ${eventType} records`,
          }),
        },
      },
    ],
    resourceRef: `configmap/${eventType.toLowerCase()}-node-evidence`,
    fieldPath: 'data.source-evidence.json + data.predicate.json',
    brokenValue: `${payload}; ${JSON.stringify({ recordType: eventType, minimumCount: 1 })}`,
    finding: `${title} appears once in the inert adaptor stream.`,
    healthyValue: `type=Health; no ${eventType} records`,
    healthyDescription: `The healthy adaptor stream contains no ${eventType} record.`,
    rules: [rule],
    observationKinds: ['configmap.data', 'node-log-fixture', 'normalized-predicate'],
    mechanisms: ['api-server'],
    profiles: runtimeProfiles,
    track: 'node_problem_detector',
    category: 'runtime_node_failure',
    feasibility: 'host',
  });

const nodeConfigRecord = (
  id: string,
  title: string,
  name: string,
  componentConfig: string,
  predicate: string,
  healthyConfig: string,
  rule: string
) =>
  scenario({
    id,
    title,
    setup: [
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: {
          name,
          labels: { 'evals.kubernetes.io/fixture-kind': 'node-log-or-config' },
          annotations: {
            'evals.kubernetes.io/adapter': 'normalized-node-predicate',
            'evals.kubernetes.io/source-path': '/var/lib/kubelet/config.yaml',
            'evals.kubernetes.io/apply-to-current-host': 'false',
          },
        },
        data: {
          'component-config.yaml': componentConfig,
          'predicate.json': predicate,
          'healthy-control.yaml': healthyConfig,
        },
      },
    ],
    resourceRef: `configmap/${name}`,
    fieldPath: 'data.component-config.yaml + data.predicate.json',
    brokenValue: `${componentConfig.trim()}; ${predicate}`,
    finding: `${title} is present in the inert component configuration fixture.`,
    healthyValue: healthyConfig.trim(),
    healthyDescription: 'The healthy component configuration satisfies the normalized predicate.',
    rules: [rule],
    observationKinds: ['configmap.data', 'node-config-fixture', 'normalized-predicate'],
    mechanisms: ['api-server'],
    profiles: runtimeProfiles,
    track: 'policy',
    category: 'control_plane_host_hardening',
    feasibility: 'host',
  });

const hostRecords: ScenarioRecord[] = [
  nodeConfigRecord(
    'rule-gap-kubelet-authorization-always-allow',
    'Kubelet authorization mode is AlwaysAllow',
    'kubelet-authorization-config',
    'apiVersion: kubelet.config.k8s.io/v1beta1\nkind: KubeletConfiguration\nauthorization:\n  mode: AlwaysAllow\n',
    '{"path":"authorization.mode","operator":"equals","value":"AlwaysAllow"}',
    'apiVersion: kubelet.config.k8s.io/v1beta1\nkind: KubeletConfiguration\nauthorization:\n  mode: Webhook\n',
    'kubescape:rule:kubelet-authorization-mode-alwaysAllow'
  ),
  nodeConfigRecord(
    'rule-gap-kubelet-client-certificate-rotation-disabled',
    'Kubelet client certificate rotation is disabled',
    'kubelet-client-rotation-config',
    'apiVersion: kubelet.config.k8s.io/v1beta1\nkind: KubeletConfiguration\nrotateCertificates: false\n',
    '{"path":"rotateCertificates","operator":"equals","value":false}',
    'apiVersion: kubelet.config.k8s.io/v1beta1\nkind: KubeletConfiguration\nrotateCertificates: true\n',
    'kubescape:rule:kubelet-rotate-certificates'
  ),
  nodeConfigRecord(
    'rule-gap-kubelet-pod-limit-excessive',
    'Kubelet Pod limit exceeds the reviewed ceiling',
    'kubelet-pod-limit-config',
    'apiVersion: kubelet.config.k8s.io/v1beta1\nkind: KubeletConfiguration\nmaxPods: 250\n',
    '{"path":"maxPods","operator":"greaterThan","value":110}',
    'apiVersion: kubelet.config.k8s.io/v1beta1\nkind: KubeletConfiguration\nmaxPods: 110\n',
    'kubescape:rule:kubelet-set-pod-limit'
  ),
  nodeRecord(
    'rule-gap-npd-ccpp-crash',
    'Node adaptor records a C or C++ process crash',
    'CCPPCrash',
    '{"type":"CCPPCrash","count":1,"executable":"/usr/bin/fixture-worker","signal":11}',
    'node-problem-detector:source:abrt-adaptor-ccppcrash:5ab49b297e1b'
  ),
  nodeRecord(
    'rule-gap-npd-uncaught-exception',
    'Node adaptor records an uncaught exception',
    'UncaughtException',
    '{"type":"UncaughtException","count":1,"runtime":"python","message":"ControlledFixtureError"}',
    'node-problem-detector:source:abrt-adaptor-uncaughtexception:500ed720fefd'
  ),
  nodeRecord(
    'rule-gap-npd-xorg-crash',
    'Node adaptor records an Xorg crash',
    'XorgCrash',
    '{"type":"XorgCrash","count":1,"executable":"/usr/libexec/Xorg","signal":6}',
    'node-problem-detector:source:abrt-adaptor-xorgcrash:41fe560545e1'
  ),
];

const deprecatedRecord = (
  id: string,
  title: string,
  apiVersion: string,
  kind: string,
  spec: Record<string, unknown>,
  rule: string,
  currentVersion: string
) =>
  scenario({
    id,
    title,
    setup: [
      { apiVersion, kind, metadata: { name: id.replace('rule-gap-deprecated-', '') }, ...spec },
    ],
    resourceRef: `manifest/${kind.toLowerCase()}/${id.replace('rule-gap-deprecated-', '')}`,
    fieldPath: 'apiVersion',
    brokenValue: apiVersion,
    finding: `The concrete ${kind} manifest uses removed API version ${apiVersion}.`,
    healthyValue: currentVersion,
    healthyDescription: `The current ${kind} API version is ${currentVersion}.`,
    rules: [rule],
    observationKinds: ['manifest.api-version', 'manifest.object-identity', 'manifest.field'],
    mechanisms: [],
    profiles: fileProfile,
    track: 'operations',
    category: 'operations_deprecation',
    feasibility: 'manifest_only',
  });

const deprecationRecords: ScenarioRecord[] = [
  deprecatedRecord(
    'rule-gap-deprecated-certificate-v1alpha2',
    'Deprecated Certificate v1alpha2 API',
    'cert-manager.io/v1alpha2',
    'Certificate',
    {
      spec: {
        secretName: 'legacy-cert-a2',
        dnsNames: ['a2.example.test'],
        issuerRef: { name: 'issuer', kind: 'Issuer' },
      },
    },
    'pluto:source:cert-manager-certificate-cert-manager-io-v1alpha2-removed-v1-6-0:afe1ce286fee',
    'cert-manager.io/v1'
  ),
  deprecatedRecord(
    'rule-gap-deprecated-certificaterequest-v1beta1',
    'Deprecated CertificateRequest v1beta1 API',
    'cert-manager.io/v1beta1',
    'CertificateRequest',
    {
      spec: { request: 'Y29udHJvbGxlZC1yZXF1ZXN0', issuerRef: { name: 'issuer', kind: 'Issuer' } },
    },
    'pluto:source:cert-manager-certificaterequest-cert-manager-io-v1beta1-removed-v1-6-0:fbc634b2c170',
    'cert-manager.io/v1'
  ),
  deprecatedRecord(
    'rule-gap-deprecated-challenge-v1beta1',
    'Deprecated Challenge v1beta1 API',
    'acme.cert-manager.io/v1beta1',
    'Challenge',
    {
      spec: {
        dnsName: 'challenge.example.test',
        issuerRef: { name: 'issuer', kind: 'Issuer' },
        solver: {
          dns01: { webhook: { groupName: 'fixture.example', solverName: 'fixture', config: {} } },
        },
        token: 'controlled-token',
        key: 'controlled-key',
      },
    },
    'pluto:source:cert-manager-challenge-acme-cert-manager-io-v1beta1-removed-v1-6-0:9fe71660718a',
    'acme.cert-manager.io/v1'
  ),
  deprecatedRecord(
    'rule-gap-deprecated-clusterissuer-v1beta1',
    'Deprecated ClusterIssuer v1beta1 API',
    'cert-manager.io/v1beta1',
    'ClusterIssuer',
    { spec: { selfSigned: {} } },
    'pluto:source:cert-manager-clusterissuer-cert-manager-io-v1beta1-removed-v1-6-0:8f4509ad8a69',
    'cert-manager.io/v1'
  ),
  deprecatedRecord(
    'rule-gap-deprecated-issuer-v1beta1',
    'Deprecated Issuer v1beta1 API',
    'cert-manager.io/v1beta1',
    'Issuer',
    { spec: { selfSigned: {} } },
    'pluto:source:cert-manager-issuer-cert-manager-io-v1beta1-removed-v1-6-0:36161bf2c2f9',
    'cert-manager.io/v1'
  ),
  deprecatedRecord(
    'rule-gap-deprecated-order-v1beta1',
    'Deprecated Order v1beta1 API',
    'acme.cert-manager.io/v1beta1',
    'Order',
    {
      spec: {
        dnsNames: ['order.example.test'],
        issuerRef: { name: 'issuer', kind: 'Issuer' },
        request: 'Y29udHJvbGxlZC1vcmRlcg==',
      },
    },
    'pluto:source:cert-manager-order-acme-cert-manager-io-v1beta1-removed-v1-6-0:80e6c6f6fa6e',
    'acme.cert-manager.io/v1'
  ),
  deprecatedRecord(
    'rule-gap-deprecated-clusterrole-v1alpha1',
    'Deprecated ClusterRole v1alpha1 API',
    'rbac.authorization.k8s.io/v1alpha1',
    'ClusterRole',
    { rules: [{ apiGroups: [''], resources: ['pods'], verbs: ['get'] }] },
    'pluto:source:k8s-clusterrole-rbac-authorization-k8s-io-v1alpha1-removed-v1-22-0:8b20c53084f1',
    'rbac.authorization.k8s.io/v1'
  ),
  deprecatedRecord(
    'rule-gap-deprecated-csidriver-v1beta1',
    'Deprecated CSIDriver v1beta1 API',
    'storage.k8s.io/v1beta1',
    'CSIDriver',
    { spec: { attachRequired: true, podInfoOnMount: false } },
    'pluto:source:k8s-csidriver-storage-k8s-io-v1beta1-removed-v1-22-0:a6237dfeac9b',
    'storage.k8s.io/v1'
  ),
  deprecatedRecord(
    'rule-gap-deprecated-event-v1beta1',
    'Deprecated events Event v1beta1 API',
    'events.k8s.io/v1beta1',
    'Event',
    {
      eventTime: '2026-09-20T00:00:00Z',
      action: 'ControlledCheck',
      reason: 'Fixture',
      regarding: { apiVersion: 'v1', kind: 'Pod', name: 'fixture-pod' },
      reportingController: 'evals.headlamp-k8s.io',
      reportingInstance: 'v4',
    },
    'pluto:source:k8s-event-events-k8s-io-v1beta1-removed-v1-25-0:b2abce78d75f',
    'events.k8s.io/v1'
  ),
  deprecatedRecord(
    'rule-gap-deprecated-lease-v1beta1',
    'Deprecated Lease v1beta1 API',
    'coordination.k8s.io/v1beta1',
    'Lease',
    { spec: { holderIdentity: 'fixture-holder', leaseDurationSeconds: 15 } },
    'pluto:source:k8s-lease-coordination-k8s-io-v1beta1-removed-v1-22-0:566bc6d0929e',
    'coordination.k8s.io/v1'
  ),
  deprecatedRecord(
    'rule-gap-deprecated-mutatingwebhook-v1beta1',
    'Deprecated MutatingWebhookConfiguration v1beta1 API',
    'admissionregistration.k8s.io/v1beta1',
    'MutatingWebhookConfiguration',
    {
      webhooks: [
        {
          name: 'mutate.fixture.example',
          clientConfig: {
            service: { namespace: 'default', name: 'fixture-webhook', path: '/mutate' },
          },
          rules: [
            { apiGroups: [''], apiVersions: ['v1'], operations: ['CREATE'], resources: ['pods'] },
          ],
          failurePolicy: 'Ignore',
          sideEffects: 'None',
          admissionReviewVersions: ['v1beta1'],
        },
      ],
    },
    'pluto:source:k8s-mutatingwebhookconfiguration-admissionregistration-k8s-io-v1beta1-re:b0b0a925c128',
    'admissionregistration.k8s.io/v1'
  ),
  deprecatedRecord(
    'rule-gap-deprecated-networkpolicy-extensions-v1beta1',
    'Deprecated extensions NetworkPolicy API',
    'extensions/v1beta1',
    'NetworkPolicy',
    { spec: { podSelector: { matchLabels: { app: 'legacy-network' } }, ingress: [] } },
    'pluto:source:k8s-networkpolicy-extensions-v1beta1-removed-v1-16-0:c64fcd3124a2',
    'networking.k8s.io/v1'
  ),
  deprecatedRecord(
    'rule-gap-deprecated-flowschema-v1beta3',
    'Deprecated FlowSchema v1beta3 API',
    'flowcontrol.apiserver.k8s.io/v1beta3',
    'FlowSchema',
    {
      spec: {
        matchingPrecedence: 1000,
        priorityLevelConfiguration: { name: 'global-default' },
        distinguisherMethod: { type: 'ByUser' },
        rules: [
          {
            subjects: [{ kind: 'Group', group: { name: 'system:authenticated' } }],
            resourceRules: [
              {
                verbs: ['get'],
                apiGroups: [''],
                resources: ['pods'],
                namespaces: ['*'],
                clusterScope: false,
              },
            ],
          },
        ],
      },
    },
    'pluto:source:k8s-flowschema-flowcontrol-apiserver-k8s-io-v1beta3-removed-v1-32-0:aff441457206',
    'flowcontrol.apiserver.k8s.io/v1'
  ),
];

const records = [
  ...manifestRecords,
  ...relationshipRecords,
  ...kubescapeRecords,
  ...telemetryRecords,
  ...runtimeRecords,
  ...hostRecords,
  ...deprecationRecords,
];

export const v4ScenarioDraftDefinitions: ScenarioDraftDefinition[] = records.map(
  record => record.definition
);

export const v4ScenarioCatalogSeeds: V4ScenarioCatalogSeed[] = records.map(
  record => record.catalog
);
