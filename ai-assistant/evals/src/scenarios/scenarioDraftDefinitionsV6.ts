import type { ClusterProfileName, RequiredMechanism } from '../contracts/evaluationContracts.js';
import { createRequire } from 'node:module';
import type { DraftFact, ScenarioDraftDefinition } from './scenarioDraftDefinition.js';

export type V6Category =
  | 'workload_configuration'
  | 'control_plane_host_hardening'
  | 'runtime_node_failure'
  | 'operations_deprecation';
export type V6Feasibility =
  | 'manifest_only'
  | 'live_cluster'
  | 'telemetry'
  | 'host'
  | 'cloud'
  | 'runtime'
  | 'custom_crd';
export type V6SelectionTrack = 'policy' | 'operations' | 'node_problem_detector';

interface Capability {
  canonical_capability_id: string;
  title: string;
  predicate_summary: string;
  source_rule_ids: string[];
  source_semantic_group_ids: string[];
  source_tool_ids: string[];
}

export interface V6ScenarioCatalogSeed {
  scenarioId: string;
  title: string;
  trigger: string;
  healthy: string;
  resources: string[];
  targetRuleIds: string[];
  targetSemanticGroupIds: string[];
  targetCanonicalCapabilityIds: string[];
  selectionTrack: V6SelectionTrack;
  category: V6Category;
  feasibility: V6Feasibility;
  requiredMechanisms: RequiredMechanism[];
  supportedClusterProfiles: ClusterProfileName[];
}

interface Fixture {
  title: string;
  description: string;
  taskPrompt: string;
  visibleResourceRefs: string[];
  observationKinds: string[];
  setup: object[];
  acceptedFacts: DraftFact[];
  contradictionFacts: DraftFact[];
  category: V6Category;
  feasibility: V6Feasibility;
  track: V6SelectionTrack;
  mechanisms: RequiredMechanism[];
  profiles: ClusterProfileName[];
}

const moduleRequire = createRequire(import.meta.url);
const registry = moduleRequire('../../registrations/canonical-capability-registry-v1.json') as {
  capabilities: Capability[];
};

const capabilityById = new Map(
  registry.capabilities.map(capability => [capability.canonical_capability_id, capability] as const)
);

const allProfiles: ClusterProfileName[] = ['local-kwok', 'local-minikube', 'aks'];
const hostProfiles: ClusterProfileName[] = ['local-minikube', 'aks'];
const manifestProfiles: ClusterProfileName[] = ['local-kwok'];
const pauseImage = 'registry.k8s.io/pause:3.10';
const nginxImage = 'registry.k8s.io/ingress-nginx/controller:v1.11.3';

const selectedCapabilityIds = [
  'canonical:access-container-service-account-v1:daa36c4819f6',
  'canonical:agent-runtime-image-digests:d20ca89e9104',
  'canonical:agent-runtime-image-registries:74c2a9c479e8',
  'canonical:agent-sandbox-container-limits:d1dd6cf72524',
  'canonical:agent-sandbox-image-registry-allowlist:d98f5889ed98',
  'canonical:agent-sandbox-image-tag-provenance:dee5a230b79f',
  'canonical:agent-sandbox-service-account-token:1fcbfb91ac55',
  'canonical:alert-mount-potential-credentials-paths:976fc30f3356',
  'canonical:anonymous-access-enabled:af2fac841ee6',
  'canonical:anonymous-requests-to-kubelet-service-updated:51fe01366fd4',
  'canonical:audit-policy-content:b5e39d9631b1',
  'canonical:container-image-repository-v1:01f9d14acf2f',
  'canonical:container-image-repository:91d5dc5b59e1',
  'canonical:container-start:3306dd990aad',
  'canonical:cve-2022-3172:3c70d9ae020e',
  'canonical:deprecated-service-account-field:b3694ab1132c',
  'canonical:detect-nginx-ingress-controller-eol:f62555d2d160',
  'canonical:do-you-mean-it-serviceaccount-is-automounting-apiserver-credenti:ec7f95ff03c1',
  'canonical:enforce-kubelet-client-tls-authentication-updated:ed87299e447a',
  'canonical:ensure-azure-rbac-is-set:da50fccf4011',
  'canonical:ensure-image-vulnerability-scanning-using-azure-defender-image-s:7396038e49cc',
  'canonical:ensure-network-policy-configured-in-labels:026450e6f201',
  'canonical:ensure-that-the-admission-control-plugin-securitycontextdeny-is-:1412da8bf9e4',
  'canonical:ensure-that-the-api-server-audit-log-maxage-argument-is-set-to-3:6826292d8b70',
  'canonical:ensure-that-the-api-server-audit-log-maxbackup-argument-is-set-t:9063c8f811f0',
  'canonical:ensure-that-the-api-server-audit-log-path-argument-is-set:4868f9a55616',
  'canonical:ensure-that-the-api-server-authorization-mode-argument-includes-:4676831e76d9',
  'canonical:ensure-that-the-api-server-authorization-mode-argument-includes-:dad26cbfb0ed',
  'canonical:ensure-that-the-api-server-authorization-mode-argument-is-not-se:4dc561095900',
  'canonical:ensure-that-the-api-server-client-ca-file-argument-is-set-as-app:c491d9ca24da',
  'canonical:ensure-that-the-api-server-denyserviceexternalips-is-not-set:b4920a82e150',
  'canonical:ensure-that-the-api-server-denyserviceexternalips-is-set:b307f113bec8',
  'canonical:ensure-that-the-api-server-encryption-provider-config-argument-i:80435753eabb',
  'canonical:ensure-that-the-api-server-encryption-providers-are-appropriatel:db98ae9e35fa',
  'canonical:ensure-that-the-api-server-etcd-cafile-argument-is-set-as-approp:674f4cffafb8',
  'canonical:ensure-that-the-api-server-etcd-certfile-and-etcd-keyfile-argume:e04fbfbecc4c',
  'canonical:ensure-that-the-api-server-kubelet-certificate-authority-argumen:966112451e05',
  'canonical:ensure-that-the-api-server-kubelet-client-certificate-and-kubele:f9fd46fd9b1e',
  'canonical:ensure-that-the-api-server-only-makes-use-of-strong-cryptographi:6518d83b0bfc',
  'canonical:ensure-that-the-api-server-only-makes-use-of-strong-cryptographi:b59c3100533a',
  'canonical:ensure-that-the-api-server-pod-specification-file-ownership-is-s:6f40dadb2582',
  'canonical:ensure-that-the-api-server-pod-specification-file-permissions-ar:276e106be3f3',
  'canonical:ensure-that-the-api-server-profiling-argument-is-set-to-false:0e3249352540',
  'canonical:ensure-that-the-api-server-request-timeout-argument-is-set-as-ap:d1b84bb7a2eb',
  'canonical:ensure-that-the-api-server-secure-port-argument-is-not-set-to-0:a8f84cb68a36',
  'canonical:ensure-that-the-api-server-service-account-extend-token-expirati:297b42a87a09',
  'canonical:ensure-that-the-api-server-service-account-key-file-argument-is-:1c1258c42250',
  'canonical:ensure-that-the-api-server-service-account-lookup-argument-is-se:45757d642d2a',
  'canonical:ensure-that-the-api-server-tls-cert-file-and-tls-private-key-fil:1aac90dd474f',
  'canonical:ensure-that-the-api-server-token-auth-file-parameter-is-not-set:ee7a111b889c',
  'canonical:ensure-that-the-certificate-authorities-file-permissions-are-set:31c7e4ed093f',
  'canonical:ensure-that-the-client-certificate-authorities-file-ownership-is:8df3017e4c81',
  'canonical:ensure-that-the-cni-in-use-supports-network-policies:17cf1661ad3a',
  'canonical:ensure-that-the-container-network-interface-file-ownership-is-se:0b1de2777d4a',
  'canonical:ensure-that-the-container-network-interface-file-permissions-are:2e6adda64a87',
  'canonical:ensure-that-the-controller-manager-bind-address-argument-is-set-:65122aaf8b6f',
  'canonical:ensure-that-the-controller-manager-pod-specification-file-owners:c143d5432701',
  'canonical:ensure-that-the-controller-manager-pod-specification-file-permis:56f30914097f',
  'canonical:ensure-that-the-controller-manager-root-ca-file-argument-is-set-:55cf15c662f2',
  'canonical:ensure-that-the-controller-manager-rotatekubeletservercertificat:b2ba7acd8983',
  'canonical:ensure-that-the-controller-manager-service-account-private-key-f:d3b71b75a4df',
  'canonical:ensure-that-the-controller-manager-terminated-pod-gc-threshold-a:8d6648996e29',
  'canonical:ensure-that-the-controller-manager-use-service-account-credentia:596fc8472b3e',
  'canonical:ensure-that-the-etcd-pod-specification-file-ownership-is-set-to-:5e3ba8a562cc',
  'canonical:ensure-that-the-etcd-pod-specification-file-permissions-are-set-:e4096ada4eb6',
  'canonical:ensure-that-the-kube-proxy-metrics-service-is-bound-to-localhost:5a4429ec8966',
  'canonical:ensure-that-the-kubeconfig-kubelet-conf-file-ownership-is-set-to:0cf74c9833b7',
  'canonical:ensure-that-the-kubeconfig-kubelet-conf-file-permissions-are-set:8e4fd76058d7',
  'canonical:ensure-that-the-kubelet-configuration-file-ownership-is-set-to-r:6ea8d5565954',
  'canonical:ensure-that-the-kubelet-service-file-ownership-is-set-to-root-ro:5891ca23c113',
  'canonical:ensure-that-the-kubelet-service-file-permissions-are-set-to-600-:6dae64b11dd8',
  'canonical:ensure-that-the-kubernetes-pki-certificate-file-permissions-are-:bf8251831c59',
  'canonical:ensure-that-the-scheduler-bind-address-argument-is-set-to-127-0-:b9f931e6a624',
  'canonical:ensure-that-the-scheduler-pod-specification-file-ownership-is-se:185487cb46b5',
  'canonical:ensure-that-the-scheduler-pod-specification-file-permissions-are:9574d91aa701',
  'canonical:etcd-auto-tls-disabled:08158319a0da',
  'canonical:etcd-client-auth-cert:f7cb0e00411e',
  'canonical:etcd-peer-auto-tls-disabled:94fc8f11b727',
  'canonical:etcd-peer-tls-enabled:a32ffc574c3a',
  'canonical:etcd-tls-enabled:d93cb6d83864',
  'canonical:etcd-unique-ca:96e7fca1d255',
  'canonical:excessive-amount-of-vulnerabilities-pods:72b297fc4454',
  'canonical:exposed-critical-pods:26f59b657129',
  'canonical:exposed-rce-pods:dd895a3181b6',
  'canonical:exposed-sensitive-interfaces-v1:075eb7791b57',
  'canonical:exposure-to-internet-via-gateway-api:34df4a1bf705',
  'canonical:exposure-to-internet-via-istio-ingress:f5559314318b',
  'canonical:exposure-to-internet:f9d520415f00',
  'canonical:external-secret-storage:7cceabdd2f8d',
  'canonical:found-taint-s-but-no-pod-can-tolerate:8bfaa4992afd',
  'canonical:has-image-signature:baed11d8b5c5',
  'canonical:if-the-kubelet-config-yaml-configuration-file-is-being-used-vali:c41f68735141',
  'canonical:ingress-and-egress-blocked:140895e3ac6d',
  'canonical:insecure-capabilities:39eb9eccf638',
  'canonical:insecure-port-flag:d3f50a0e723e',
  'canonical:instance-metadata-api-access:9c1fb110918d',
  'canonical:insufficient-disk-space:1f326b851e38',
  'canonical:insufficient-pids-on-node:74830a89f5dc',
  'canonical:k8s-audit-logs-enabled-native-cis:5d788bb2d869',
  'canonical:kubelet-hostname-override:99159e3f25e7',
  'canonical:kubelet-ip-tables:e6354480c348',
  'canonical:kubelet-rotate-kubelet-server-certificate:9f36ce834f9c',
  'canonical:kubelet-streaming-connection-idle-timeout:8a333b04112c',
  'canonical:kubelet-strong-cryptographics-ciphers:aa497f1740dc',
  'canonical:lint-internal-error-s:593bb657a384',
  'canonical:linux-hardening:9f46be5acf32',
  'canonical:list-all-namespaces:a25c909e2fef',
  'canonical:missing-security-namespace-label-q:49181e5af116',
  'canonical:namespace-is-inactive:663ef557f735',
  'canonical:namespace-mismatch-with-security-labels-namespace-q-vs-q:50e36f2f5905',
  'canonical:no-cilium-endpoints-matched-s-selector:5aca6ec9fac3',
  'canonical:no-network-configured-on-node:9b13a1d5d643',
  'canonical:no-nodes-matched-node-selector:879e87741bca',
  'canonical:no-pods-match-controller-selector-s:e0ad471c18de',
  'canonical:no-pods-match-pdb-selector-s:89bef59b41f8',
] as const;

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const scenarioIdFor = (capabilityId: string): string => {
  const [, stem, digest] = capabilityId.split(':');
  if (!stem || !digest) {
    throw new Error(`invalid canonical capability id ${capabilityId}`);
  }
  return `rule-gap-v6-${stem}-${digest.slice(0, 8)}`;
};

const titleCase = (value: string): string => {
  const normalized = value.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const deployment = (name: string, containerOverrides: Record<string, unknown>, podSpec = {}) => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name, labels: { app: name } },
  spec: {
    replicas: 1,
    selector: { matchLabels: { app: name } },
    template: {
      metadata: { labels: { app: name } },
      spec: {
        ...podSpec,
        containers: [
          {
            name: 'app',
            image: pauseImage,
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
              runAsNonRoot: true,
              runAsUser: 65532,
            },
            ...containerOverrides,
          },
        ],
      },
    },
  },
});

const service = (name: string, serviceType: 'ClusterIP' | 'LoadBalancer' = 'ClusterIP') => ({
  apiVersion: 'v1',
  kind: 'Service',
  metadata: { name },
  spec: {
    type: serviceType,
    selector: { app: name },
    ports: [{ name: 'http', port: 80, targetPort: 8080 }],
  },
});

const serviceAccount = (name: string, automount?: boolean) => ({
  apiVersion: 'v1',
  kind: 'ServiceAccount',
  metadata: { name },
  ...(automount === undefined ? {} : { automountServiceAccountToken: automount }),
});

const namespace = (name: string, labels?: Record<string, string>) => ({
  apiVersion: 'v1',
  kind: 'Namespace',
  metadata: { name, ...(labels ? { labels } : {}) },
});

const inertConfigMap = (
  name: string,
  targetPath: string,
  fixtureKind: string,
  data: Record<string, string>
) => ({
  apiVersion: 'v1',
  kind: 'ConfigMap',
  metadata: {
    name,
    labels: { 'evals.kubernetes.io/fixture-kind': fixtureKind },
    annotations: {
      'evals.kubernetes.io/adapter': 'normalized-predicate',
      'evals.kubernetes.io/target-path': targetPath,
      'evals.kubernetes.io/apply-to-current-host': 'false',
    },
  },
  data,
});

const genericConfigMapFixture = (
  capability: Capability,
  options?: Partial<Pick<Fixture, 'category' | 'feasibility' | 'track' | 'mechanisms' | 'profiles'>>
): Fixture => {
  const name = `${scenarioIdFor(capability.canonical_capability_id).slice(
    'rule-gap-'.length
  )}-fixture`;
  const resourceRef = `configmap/${name}`;
  const normalized = `${capability.title} ${capability.predicate_summary}`
    .toLowerCase()
    .replace(/[^a-z0-9/.:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const component = normalized.includes('controller manager')
    ? 'kube-controller-manager'
    : normalized.includes('scheduler')
    ? 'kube-scheduler'
    : normalized.includes('api server')
    ? 'kube-apiserver'
    : normalized.includes('kube proxy')
    ? 'kube-proxy'
    : normalized.includes('kubelet')
    ? 'kubelet'
    : normalized.includes('etcd')
    ? 'etcd'
    : normalized.includes('namespace')
    ? 'Namespace'
    : 'cluster';
  const explicitPath = capability.predicate_summary.match(/`(\/[^`]+)`/)?.[1];
  let field = 'normalizedPredicate';
  let observedValue = capability.predicate_summary;
  let healthyValue = `not (${capability.predicate_summary})`;
  let evidenceType = 'normalized-observation';
  let targetPath = '/var/lib/evals/normalized-observation.json';

  if (normalized.includes('ownership')) {
    field = explicitPath ? `files[${explicitPath}].owner` : 'file.owner';
    observedValue = 'nobody:nogroup';
    healthyValue = 'root:root';
    evidenceType = 'file-metadata';
    targetPath = explicitPath ?? '/etc/kubernetes/component-file';
  } else if (normalized.includes('permissions')) {
    const expectedMode =
      normalized.match(/(?:permissions?(?: are)? set to|permissions of)\s*`?(\d{3})/)?.[1] ?? '600';
    field = explicitPath ? `files[${explicitPath}].mode` : 'file.mode';
    observedValue = expectedMode === '600' ? '0644' : '0666';
    healthyValue = `0${expectedMode}`;
    evidenceType = 'file-metadata';
    targetPath = explicitPath ?? '/etc/kubernetes/component-file';
  } else if (normalized.includes('authorization mode')) {
    field = 'arguments.--authorization-mode';
    observedValue = normalized.includes('includes node') ? 'RBAC' : 'AlwaysAllow';
    healthyValue = 'Node,RBAC';
    evidenceType = 'component-arguments';
    targetPath = `/etc/kubernetes/manifests/${component}.yaml`;
  } else if (normalized.includes('audit log maxage')) {
    field = 'arguments.--audit-log-maxage';
    observedValue = '7';
    healthyValue = '30';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('audit log maxbackup')) {
    field = 'arguments.--audit-log-maxbackup';
    observedValue = '1';
    healthyValue = '10';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('audit log path')) {
    field = 'arguments.--audit-log-path';
    observedValue = 'absent';
    healthyValue = '/var/log/kubernetes/audit.log';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('encryption provider')) {
    field = normalized.includes('providers are')
      ? 'encryptionConfig.providers[0]'
      : 'arguments.--encryption-provider-config';
    observedValue = normalized.includes('providers are') ? 'identity' : 'absent';
    healthyValue = normalized.includes('providers are')
      ? 'aescbc'
      : '/etc/kubernetes/encryption.yaml';
    evidenceType = 'component-configuration';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('strong cryptographic ciphers')) {
    field = 'arguments.--tls-cipher-suites';
    observedValue = 'TLS_RSA_WITH_3DES_EDE_CBC_SHA';
    healthyValue = 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256';
    evidenceType = 'component-arguments';
    targetPath = `/etc/kubernetes/manifests/${component}.yaml`;
  } else if (normalized.includes('bind address') || normalized.includes('bound to localhost')) {
    field = normalized.includes('metrics') ? 'metricsBindAddress' : 'arguments.--bind-address';
    observedValue = '0.0.0.0';
    healthyValue = '127.0.0.1';
    evidenceType = 'component-configuration';
    targetPath = `/etc/kubernetes/manifests/${component}.yaml`;
  } else if (normalized.includes('profiling')) {
    field = 'arguments.--profiling';
    observedValue = 'true';
    healthyValue = 'false';
    evidenceType = 'component-arguments';
    targetPath = `/etc/kubernetes/manifests/${component}.yaml`;
  } else if (normalized.includes('secure port')) {
    field = 'arguments.--secure-port';
    observedValue = '0';
    healthyValue = '6443';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('request timeout')) {
    field = 'arguments.--request-timeout';
    observedValue = '0s';
    healthyValue = '60s';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('token auth file')) {
    field = 'arguments.--token-auth-file';
    observedValue = '/etc/kubernetes/tokens.csv';
    healthyValue = 'absent';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('service account extend token expiration')) {
    field = 'arguments.--service-account-extend-token-expiration';
    observedValue = 'true';
    healthyValue = 'false';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('service account lookup')) {
    field = 'arguments.--service-account-lookup';
    observedValue = 'false';
    healthyValue = 'true';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('rotatekubeletservercertificate')) {
    field = 'featureGates.RotateKubeletServerCertificate';
    observedValue = 'false';
    healthyValue = 'true';
    evidenceType = 'component-configuration';
    targetPath = '/etc/kubernetes/manifests/kube-controller-manager.yaml';
  } else if (normalized.includes('use service account credentials')) {
    field = 'arguments.--use-service-account-credentials';
    observedValue = 'false';
    healthyValue = 'true';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-controller-manager.yaml';
  } else if (normalized.includes('terminated pod gc threshold')) {
    field = 'arguments.--terminated-pod-gc-threshold';
    observedValue = '0';
    healthyValue = '12500';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-controller-manager.yaml';
  } else if (normalized.includes('cni in use supports network policies')) {
    field = 'cni.capabilities.networkPolicy';
    observedValue = 'false';
    healthyValue = 'true';
    evidenceType = 'cluster-network-configuration';
    targetPath = '/etc/cni/net.d/00-cluster.conflist';
  } else if (normalized.includes('insufficient disk space')) {
    field = 'node.status.conditions[DiskPressure].status';
    observedValue = 'True';
    healthyValue = 'False';
    evidenceType = 'node-status';
    targetPath = '/var/lib/kubelet/status.json';
  } else if (normalized.includes('insufficient pids')) {
    field = 'node.status.conditions[PIDPressure].status';
    observedValue = 'True';
    healthyValue = 'False';
    evidenceType = 'node-status';
    targetPath = '/var/lib/kubelet/status.json';
  } else if (normalized.includes('no network configured on node')) {
    field = 'node.network.configured';
    observedValue = 'false';
    healthyValue = 'true';
    evidenceType = 'node-status';
    targetPath = '/var/lib/kubelet/network-status.json';
  } else if (normalized.includes('namespace is inactive')) {
    field = 'namespace.status.phase';
    observedValue = 'Terminating';
    healthyValue = 'Active';
    evidenceType = 'resource-status';
    targetPath = '/var/lib/evals/namespace-status.json';
  } else if (normalized.includes('anonymous requests to kubelet')) {
    field = 'authentication.anonymous.enabled';
    observedValue = 'true';
    healthyValue = 'false';
    evidenceType = 'kubelet-configuration';
    targetPath = '/var/lib/kubelet/config.yaml';
  } else if (normalized.includes('audit policy content')) {
    field = 'auditPolicy.rules';
    observedValue = '[]';
    healthyValue = '[{"level":"Metadata"}]';
    evidenceType = 'audit-policy';
    targetPath = '/etc/kubernetes/audit-policy.yaml';
  } else if (normalized.includes('container start')) {
    field = 'pod.status.containerStatuses[0].state.waiting.reason';
    observedValue = 'CreateContainerError';
    healthyValue = 'Running';
    evidenceType = 'pod-status';
    targetPath = '/var/lib/evals/pod-status.json';
  } else if (normalized.includes('cve 2022 3172')) {
    field = 'apiServer.version';
    observedValue = 'v1.23.6';
    healthyValue = 'v1.23.7';
    evidenceType = 'version-inventory';
    targetPath = '/var/lib/evals/api-server-version.json';
  } else if (normalized.includes('kubelet client tls authentication')) {
    field = 'authentication.x509.clientCAFile';
    observedValue = 'absent';
    healthyValue = '/etc/kubernetes/pki/ca.crt';
    evidenceType = 'kubelet-configuration';
    targetPath = '/var/lib/kubelet/config.yaml';
  } else if (normalized.includes('azure rbac')) {
    field = 'managedCluster.enableAzureRBAC';
    observedValue = 'false';
    healthyValue = 'true';
    evidenceType = 'cloud-cluster-configuration';
    targetPath = '/var/lib/evals/managed-cluster.json';
  } else if (normalized.includes('image vulnerability scanning')) {
    field = 'securityProfile.imageVulnerabilityScanning.enabled';
    observedValue = 'false';
    healthyValue = 'true';
    evidenceType = 'cloud-security-configuration';
    targetPath = '/var/lib/evals/cloud-security-profile.json';
  } else if (normalized.includes('securitycontextdeny')) {
    field = 'admissionControl.enabledPlugins';
    observedValue = '["ServiceAccount"]';
    healthyValue = '["ServiceAccount","SecurityContextDeny"]';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('client ca file')) {
    field = 'arguments.--client-ca-file';
    observedValue = 'absent';
    healthyValue = '/etc/kubernetes/pki/ca.crt';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('denyserviceexternalips')) {
    field = 'featureGates.DenyServiceExternalIPs';
    observedValue = normalized.includes('is not set') ? 'true' : 'absent';
    healthyValue = normalized.includes('is not set') ? 'absent' : 'true';
    evidenceType = 'component-configuration';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('etcd cafile')) {
    field = 'arguments.--etcd-cafile';
    observedValue = 'absent';
    healthyValue = '/etc/kubernetes/pki/etcd/ca.crt';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('etcd certfile') && normalized.includes('etcd keyfile')) {
    field = 'arguments.--etcd-certfile + arguments.--etcd-keyfile';
    observedValue = 'absent + absent';
    healthyValue =
      '/etc/kubernetes/pki/apiserver-etcd-client.crt + /etc/kubernetes/pki/apiserver-etcd-client.key';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('kubelet certificate authority')) {
    field = 'arguments.--kubelet-certificate-authority';
    observedValue = 'absent';
    healthyValue = '/etc/kubernetes/pki/ca.crt';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('kubelet client certificate')) {
    field = 'arguments.--kubelet-client-certificate + arguments.--kubelet-client-key';
    observedValue = 'absent + absent';
    healthyValue =
      '/etc/kubernetes/pki/apiserver-kubelet-client.crt + /etc/kubernetes/pki/apiserver-kubelet-client.key';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('service account key file')) {
    field = 'arguments.--service-account-key-file';
    observedValue = 'absent';
    healthyValue = '/etc/kubernetes/pki/sa.pub';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
  } else if (normalized.includes('tls cert file') && normalized.includes('tls private key file')) {
    field = 'arguments.--tls-cert-file + arguments.--tls-private-key-file';
    observedValue = 'absent + absent';
    healthyValue = '/etc/kubernetes/pki/apiserver.crt + /etc/kubernetes/pki/apiserver.key';
    evidenceType = 'component-arguments';
    targetPath = `/etc/kubernetes/manifests/${component}.yaml`;
  } else if (normalized.includes('root ca file')) {
    field = 'arguments.--root-ca-file';
    observedValue = 'absent';
    healthyValue = '/etc/kubernetes/pki/ca.crt';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-controller-manager.yaml';
  } else if (normalized.includes('service account private key file')) {
    field = 'arguments.--service-account-private-key-file';
    observedValue = 'absent';
    healthyValue = '/etc/kubernetes/pki/sa.key';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/kube-controller-manager.yaml';
  } else if (normalized.includes('etcd auto tls disabled')) {
    field = 'arguments.--auto-tls';
    observedValue = 'true';
    healthyValue = 'false';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/etcd.yaml';
  } else if (normalized.includes('etcd peer auto tls disabled')) {
    field = 'arguments.--peer-auto-tls';
    observedValue = 'true';
    healthyValue = 'false';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/etcd.yaml';
  } else if (normalized.includes('etcd client auth cert')) {
    field = 'arguments.--client-cert-auth';
    observedValue = 'false';
    healthyValue = 'true';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/etcd.yaml';
  } else if (normalized.includes('etcd peer tls enabled')) {
    field = 'arguments.--peer-cert-file + arguments.--peer-key-file';
    observedValue = 'absent + absent';
    healthyValue = '/etc/kubernetes/pki/etcd/peer.crt + /etc/kubernetes/pki/etcd/peer.key';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/etcd.yaml';
  } else if (normalized.includes('etcd tls enabled')) {
    field = 'arguments.--cert-file + arguments.--key-file';
    observedValue = 'absent + absent';
    healthyValue = '/etc/kubernetes/pki/etcd/server.crt + /etc/kubernetes/pki/etcd/server.key';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/etcd.yaml';
  } else if (normalized.includes('etcd unique ca')) {
    field = 'arguments.--trusted-ca-file + arguments.--peer-trusted-ca-file';
    observedValue = '/etc/kubernetes/pki/ca.crt + /etc/kubernetes/pki/ca.crt';
    healthyValue = '/etc/kubernetes/pki/etcd/ca.crt + /etc/kubernetes/pki/etcd/peer-ca.crt';
    evidenceType = 'component-arguments';
    targetPath = '/etc/kubernetes/manifests/etcd.yaml';
  } else if (normalized.includes('instance metadata api access')) {
    field = 'networkAccess.instanceMetadataEndpoint';
    observedValue = 'allowed';
    healthyValue = 'blocked';
    evidenceType = 'cloud-network-configuration';
    targetPath = '/var/lib/evals/cloud-network-policy.json';
  } else if (normalized.includes('audit logs enabled')) {
    field = 'audit.enabled';
    observedValue = 'false';
    healthyValue = 'true';
    evidenceType = 'audit-configuration';
    targetPath = '/etc/kubernetes/audit-policy.yaml';
  } else if (normalized.includes('hostname override')) {
    field = 'arguments.--hostname-override';
    observedValue = 'spoofed-node-name';
    healthyValue = 'absent';
    evidenceType = 'kubelet-arguments';
    targetPath = '/var/lib/kubelet/kubeadm-flags.env';
  } else if (normalized.includes('kubelet ip tables')) {
    field = 'makeIPTablesUtilChains';
    observedValue = 'false';
    healthyValue = 'true';
    evidenceType = 'kubelet-configuration';
    targetPath = '/var/lib/kubelet/config.yaml';
  } else if (normalized.includes('streaming connection idle timeout')) {
    field = 'streamingConnectionIdleTimeout';
    observedValue = '0s';
    healthyValue = '4h0m0s';
    evidenceType = 'kubelet-configuration';
    targetPath = '/var/lib/kubelet/config.yaml';
  } else if (normalized.includes('lint internal error')) {
    field = 'diagnostic.status';
    observedValue = 'internal-error';
    healthyValue = 'completed';
    evidenceType = 'diagnostic-status';
    targetPath = '/var/lib/evals/diagnostic-status.json';
  }
  const observation = JSON.stringify(
    {
      subject: component,
      evidenceType,
      field,
      observedValue,
      triggerPredicate: capability.predicate_summary,
    },
    null,
    2
  );
  const healthy = JSON.stringify(
    {
      subject: component,
      evidenceType,
      field,
      observedValue: healthyValue,
    },
    null,
    2
  );
  return {
    title: titleCase(capability.title),
    description: `${capability.predicate_summary} The fixture is inert ConfigMap evidence for normalized-predicate review and does not alter a live control-plane, node, or cloud resource.`,
    taskPrompt: `Inspect ${resourceRef}. Explain the concrete configuration or evidence defect represented by the fixture, cite exact fields, and do not mutate resources.`,
    visibleResourceRefs: [resourceRef],
    observationKinds: ['configmap.data', 'normalized-predicate'],
    setup: [
      inertConfigMap(name, targetPath, 'normalized-predicate', {
        'observation.json': observation,
        'predicate-summary.txt': capability.predicate_summary,
        'healthy-control.json': healthy,
      }),
    ],
    acceptedFacts: [
      {
        fact_id: 'represented-broken-state',
        resource_ref: resourceRef,
        field_path: `data.observation.json#${field}`,
        observed_value: observedValue,
        description: capability.predicate_summary,
      },
      {
        fact_id: 'fixture-is-inert',
        resource_ref: resourceRef,
        field_path: 'metadata.annotations.evals.kubernetes.io/apply-to-current-host',
        observed_value: 'false',
        description:
          'The evidence remains inert ConfigMap data and is never applied to the current environment.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'healthy-control-does-not-trigger',
        resource_ref: resourceRef,
        field_path: `data.healthy-control.json#${field}`,
        observed_value: healthyValue,
        description: 'The healthy control differs only in the predicate-satisfying state.',
      },
    ],
    category: options?.category ?? 'control_plane_host_hardening',
    feasibility: options?.feasibility ?? 'host',
    track: options?.track ?? 'policy',
    mechanisms: options?.mechanisms ?? ['api-server'],
    profiles: options?.profiles ?? hostProfiles,
  };
};

const customResourceFixture = (
  capability: Capability,
  resource: object,
  resourceRef: string,
  fieldPath: string,
  brokenValue: string,
  healthyValue: string
): Fixture => ({
  title: titleCase(capability.title),
  description: `${capability.predicate_summary} The fixture uses an inert custom resource to express the invalid state directly in Kubernetes API form.`,
  taskPrompt: `Review ${resourceRef} and identify the concrete policy or configuration defect. Cite exact fields and do not mutate resources.`,
  visibleResourceRefs: [resourceRef],
  observationKinds: ['custom-resource.spec', 'custom-resource.metadata'],
  setup: [resource],
  acceptedFacts: [
    {
      fact_id: 'trigger-evidence',
      resource_ref: resourceRef,
      field_path: fieldPath,
      observed_value: brokenValue,
      description: capability.predicate_summary,
    },
  ],
  contradictionFacts: [
    {
      fact_id: 'healthy-control',
      resource_ref: resourceRef,
      field_path: fieldPath,
      observed_value: healthyValue,
      description: 'The healthy control removes the represented defect.',
    },
  ],
  category: 'workload_configuration',
  feasibility: 'custom_crd',
  track: 'policy',
  mechanisms: ['api-server', 'operator-reconciliation'],
  profiles: allProfiles,
});

const hostPathVolumeFixture = (capability: Capability): Fixture => ({
  title: 'Workload mounts a host credentials path',
  description: `${capability.predicate_summary} The Deployment mounts a concrete hostPath under /var/lib/kubelet/pki.`,
  taskPrompt:
    'Review the workload storage configuration and identify the host exposure risk. Cite exact fields and do not mutate resources.',
  visibleResourceRefs: ['deployment/credential-mount'],
  observationKinds: ['deployment.pod-template', 'volume.host-path'],
  setup: [
    deployment(
      'credential-mount',
      { volumeMounts: [{ name: 'host-credentials', mountPath: '/host-pki', readOnly: true }] },
      {
        volumes: [
          {
            name: 'host-credentials',
            hostPath: { path: '/var/lib/kubelet/pki', type: 'Directory' },
          },
        ],
      }
    ),
  ],
  acceptedFacts: [
    {
      fact_id: 'hostpath-mounted',
      resource_ref: 'deployment/credential-mount',
      field_path: 'spec.template.spec.volumes[0].hostPath.path',
      observed_value: '/var/lib/kubelet/pki',
      description: 'The workload mounts a host credentials directory.',
    },
  ],
  contradictionFacts: [
    {
      fact_id: 'healthy-control',
      resource_ref: 'deployment/credential-mount',
      field_path: 'spec.template.spec.volumes[0].hostPath.path',
      observed_value: '/var/run/fixtures',
      description: 'The healthy control uses a non-sensitive workload-local path instead.',
    },
  ],
  category: 'workload_configuration',
  feasibility: 'manifest_only',
  track: 'policy',
  mechanisms: ['api-server'],
  profiles: manifestProfiles,
});

const anonymousAccessFixture = (capability: Capability): Fixture => ({
  title: 'Anonymous subject receives RBAC access',
  description: `${capability.predicate_summary} The binding grants read access to system:anonymous.`,
  taskPrompt:
    'Inspect the RBAC binding and identify any anonymous access grant. Cite exact subjects and role references and do not mutate resources.',
  visibleResourceRefs: ['clusterrolebinding/anonymous-pod-reader'],
  observationKinds: ['clusterrolebinding.subjects', 'clusterrolebinding.role-ref'],
  setup: [
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRoleBinding',
      metadata: { name: 'anonymous-pod-reader' },
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'view' },
      subjects: [
        { apiGroup: 'rbac.authorization.k8s.io', kind: 'Group', name: 'system:anonymous' },
      ],
    },
  ],
  acceptedFacts: [
    {
      fact_id: 'anonymous-bound',
      resource_ref: 'clusterrolebinding/anonymous-pod-reader',
      field_path: 'subjects[0].name',
      observed_value: 'system:anonymous',
      description: 'Anonymous subjects are bound to a cluster role.',
    },
  ],
  contradictionFacts: [
    {
      fact_id: 'healthy-control',
      resource_ref: 'clusterrolebinding/anonymous-pod-reader',
      field_path: 'subjects[0].name',
      observed_value: 'system:serviceaccounts',
      description: 'The healthy control would bind an intended service-account group instead.',
    },
  ],
  category: 'workload_configuration',
  feasibility: 'manifest_only',
  track: 'policy',
  mechanisms: ['api-server', 'authorization'],
  profiles: manifestProfiles,
});

const imageRepositoryFixture = (capability: Capability, name: string, image: string): Fixture => ({
  title: titleCase(capability.title),
  description: `${capability.predicate_summary} The Deployment uses a concrete image from an unapproved registry.`,
  taskPrompt:
    'Inspect the image reference and explain the policy violation. Cite the exact image value and do not mutate resources.',
  visibleResourceRefs: [`deployment/${name}`],
  observationKinds: ['deployment.pod-template', 'container.image'],
  setup: [deployment(name, { image, ports: [{ containerPort: 8080 }] })],
  acceptedFacts: [
    {
      fact_id: 'disallowed-registry',
      resource_ref: `deployment/${name}`,
      field_path: 'spec.template.spec.containers[0].image',
      observed_value: image,
      description: capability.predicate_summary,
    },
  ],
  contradictionFacts: [
    {
      fact_id: 'healthy-control',
      resource_ref: `deployment/${name}`,
      field_path: 'spec.template.spec.containers[0].image',
      observed_value: 'registry.k8s.io/pause:3.10',
      description: 'The healthy control uses an explicitly allowed registry.',
    },
  ],
  category: 'workload_configuration',
  feasibility: 'manifest_only',
  track: 'policy',
  mechanisms: ['api-server'],
  profiles: manifestProfiles,
});

const deprecatedServiceAccountFixture = (capability: Capability): Fixture => ({
  title: 'Workload uses deprecated serviceAccount field',
  description: `${capability.predicate_summary} The Pod template sets the deprecated serviceAccount field instead of serviceAccountName.`,
  taskPrompt:
    'Inspect the workload identity configuration and identify the deprecated field use. Cite exact fields and do not mutate resources.',
  visibleResourceRefs: ['deployment/deprecated-identity'],
  observationKinds: ['deployment.pod-template'],
  setup: [
    {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'deprecated-identity' },
      spec: {
        replicas: 1,
        selector: { matchLabels: { app: 'deprecated-identity' } },
        template: {
          metadata: { labels: { app: 'deprecated-identity' } },
          spec: {
            serviceAccount: 'legacy-identity',
            containers: [{ name: 'app', image: pauseImage }],
          },
        },
      },
    },
  ],
  acceptedFacts: [
    {
      fact_id: 'deprecated-field-present',
      resource_ref: 'deployment/deprecated-identity',
      field_path: 'spec.template.spec.serviceAccount',
      observed_value: 'legacy-identity',
      description: 'The workload uses the deprecated serviceAccount field.',
    },
  ],
  contradictionFacts: [
    {
      fact_id: 'healthy-control',
      resource_ref: 'deployment/deprecated-identity',
      field_path: 'spec.template.spec.serviceAccountName',
      observed_value: 'legacy-identity',
      description: 'The healthy control would set serviceAccountName instead.',
    },
  ],
  category: 'workload_configuration',
  feasibility: 'manifest_only',
  track: 'policy',
  mechanisms: ['api-server'],
  profiles: manifestProfiles,
});

const automountTokenFixture = (capability: Capability): Fixture => ({
  title: 'Service account token is unnecessarily automounted',
  description: `${capability.predicate_summary} The workload opts in to service-account token mounting.`,
  taskPrompt:
    'Review the service account and Pod template identity settings and identify the token exposure risk. Cite exact fields and do not mutate resources.',
  visibleResourceRefs: ['serviceaccount/runner', 'deployment/runner'],
  observationKinds: ['serviceaccount.spec', 'deployment.pod-template'],
  setup: [
    serviceAccount('runner', true),
    deployment('runner', {}, { serviceAccountName: 'runner', automountServiceAccountToken: true }),
  ],
  acceptedFacts: [
    {
      fact_id: 'pod-automount-enabled',
      resource_ref: 'deployment/runner',
      field_path: 'spec.template.spec.automountServiceAccountToken',
      observed_value: 'true',
      description: capability.predicate_summary,
    },
  ],
  contradictionFacts: [
    {
      fact_id: 'healthy-control',
      resource_ref: 'deployment/runner',
      field_path: 'spec.template.spec.automountServiceAccountToken',
      observed_value: 'false',
      description: 'The healthy control disables token automounting.',
    },
  ],
  category: 'workload_configuration',
  feasibility: 'manifest_only',
  track: 'policy',
  mechanisms: ['api-server'],
  profiles: manifestProfiles,
});

const accessServiceAccountFixture = (capability: Capability): Fixture => ({
  title: 'Workload uses an elevated service account',
  description: `${capability.predicate_summary} The workload runs under a service account that is bound to edit in its namespace.`,
  taskPrompt:
    'Inspect the workload identity and associated RBAC grant. Explain the access risk with exact fields and do not mutate resources.',
  visibleResourceRefs: [
    'deployment/workload',
    'serviceaccount/workload-sa',
    'rolebinding/workload-edit',
  ],
  observationKinds: ['deployment.pod-template', 'rolebinding.subjects', 'rolebinding.role-ref'],
  setup: [
    serviceAccount('workload-sa'),
    deployment('workload', {}, { serviceAccountName: 'workload-sa' }),
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'RoleBinding',
      metadata: { name: 'workload-edit' },
      roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name: 'edit' },
      subjects: [{ kind: 'ServiceAccount', name: 'workload-sa', namespace: 'default' }],
    },
  ],
  acceptedFacts: [
    {
      fact_id: 'elevated-service-account',
      resource_ref: 'rolebinding/workload-edit',
      field_path: 'subjects[0].name + roleRef.name',
      observed_value: 'workload-sa + edit',
      description: capability.predicate_summary,
    },
  ],
  contradictionFacts: [
    {
      fact_id: 'healthy-control',
      resource_ref: 'rolebinding/workload-edit',
      field_path: 'roleRef.name',
      observed_value: 'view',
      description: 'The healthy control would bind only a read-only role.',
    },
  ],
  category: 'workload_configuration',
  feasibility: 'manifest_only',
  track: 'policy',
  mechanisms: ['api-server', 'authorization'],
  profiles: manifestProfiles,
});

const networkPolicyLabelsFixture = (capability: Capability): Fixture => ({
  title: 'Workload labels are not protected by a matching NetworkPolicy',
  description: `${capability.predicate_summary} The namespace contains a labeled workload but no matching NetworkPolicy.`,
  taskPrompt:
    'Review the workload labels and any policy selectors. Explain why the workload is not protected, citing exact fields, and do not mutate resources.',
  visibleResourceRefs: ['deployment/tenant-app', 'networkpolicy/*'],
  observationKinds: ['deployment.pod-template', 'networkpolicy.list'],
  setup: [deployment('tenant-app', {}, {})],
  acceptedFacts: [
    {
      fact_id: 'no-networkpolicy',
      resource_ref: 'networkpolicy/*',
      field_path: 'items.length',
      observed_value: '0',
      description: capability.predicate_summary,
    },
  ],
  contradictionFacts: [
    {
      fact_id: 'healthy-control',
      resource_ref: 'networkpolicy/default-deny',
      field_path: 'metadata.name',
      observed_value: 'default-deny',
      description: 'The healthy control would include a selecting NetworkPolicy.',
    },
  ],
  category: 'workload_configuration',
  feasibility: 'manifest_only',
  track: 'policy',
  mechanisms: ['api-server', 'cni'],
  profiles: manifestProfiles,
});

const internetExposureFixture = (
  capability: Capability,
  mode: 'gateway' | 'istio' | 'service',
  withVuln = false,
  title?: string
): Fixture => {
  const setup: object[] = [
    deployment('public-app', {
      image: 'ghcr.io/public/demo:1.0',
      ports: [{ containerPort: 8080 }],
    }),
    service('public-app', mode === 'service' ? 'LoadBalancer' : 'ClusterIP'),
  ];
  let resourceRefs = ['deployment/public-app', 'service/public-app'];
  let fieldPath = 'spec.type';
  let observedValue = mode === 'service' ? 'LoadBalancer' : 'gateway-backed';
  if (mode === 'gateway') {
    setup.push(
      {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'Gateway',
        metadata: { name: 'public-gateway' },
        spec: {
          gatewayClassName: 'external',
          listeners: [{ name: 'http', protocol: 'HTTP', port: 80 }],
        },
      },
      {
        apiVersion: 'gateway.networking.k8s.io/v1',
        kind: 'HTTPRoute',
        metadata: { name: 'public-route' },
        spec: {
          parentRefs: [{ name: 'public-gateway' }],
          rules: [{ backendRefs: [{ name: 'public-app', port: 80 }] }],
        },
      }
    );
    resourceRefs = [...resourceRefs, 'gateway/public-gateway', 'httproute/public-route'];
    fieldPath = 'spec.rules[0].backendRefs[0].name';
    observedValue = 'public-app';
  }
  if (mode === 'istio') {
    setup.push(
      {
        apiVersion: 'networking.istio.io/v1beta1',
        kind: 'Gateway',
        metadata: { name: 'public-gateway' },
        spec: {
          selector: { istio: 'ingressgateway' },
          servers: [{ port: { number: 80, name: 'http', protocol: 'HTTP' }, hosts: ['*'] }],
        },
      },
      {
        apiVersion: 'networking.istio.io/v1beta1',
        kind: 'VirtualService',
        metadata: { name: 'public-route' },
        spec: {
          hosts: ['*'],
          gateways: ['public-gateway'],
          http: [{ route: [{ destination: { host: 'public-app' } }] }],
        },
      }
    );
    resourceRefs = [...resourceRefs, 'gateway/public-gateway', 'virtualservice/public-route'];
    fieldPath = 'spec.http[0].route[0].destination.host';
    observedValue = 'public-app';
  }
  if (withVuln) {
    setup.push(
      inertConfigMap(
        'public-app-vulnerability-report',
        '/var/lib/evals/vuln-report.json',
        'normalized-predicate',
        {
          'report.json': JSON.stringify(
            { image: 'ghcr.io/public/demo:1.0', severity: 'critical', remoteCodeExecution: true },
            null,
            2
          ),
          'healthy-control.json': JSON.stringify(
            { image: 'ghcr.io/public/demo:1.0', severity: 'none', remoteCodeExecution: false },
            null,
            2
          ),
        }
      )
    );
    resourceRefs.push('configmap/public-app-vulnerability-report');
  }
  return {
    title: title ?? titleCase(capability.title),
    description: `${capability.predicate_summary} The setup combines a concrete workload exposure path with any additional evidence required by the capability.`,
    taskPrompt:
      'Inspect the workload exposure path and any supporting evidence. Explain the risk with exact fields and do not mutate resources.',
    visibleResourceRefs: resourceRefs,
    observationKinds: ['deployment.pod-template', 'service.spec', 'configmap.data'],
    setup,
    acceptedFacts: [
      {
        fact_id: 'exposure-evidence',
        resource_ref: mode === 'service' ? 'service/public-app' : resourceRefs[2]!,
        field_path: fieldPath,
        observed_value: observedValue,
        description: capability.predicate_summary,
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'healthy-control',
        resource_ref: 'service/public-app',
        field_path: 'spec.type',
        observed_value: 'ClusterIP',
        description: 'The healthy control keeps the workload internal only.',
      },
    ],
    category: 'workload_configuration',
    feasibility: 'manifest_only',
    track: 'policy',
    mechanisms: ['api-server'],
    profiles: manifestProfiles,
  };
};

const namespaceLabelFixture = (
  capability: Capability,
  labels?: Record<string, string>,
  title?: string
): Fixture => ({
  title: title ?? titleCase(capability.title),
  description: `${capability.predicate_summary} The Namespace fixture carries the exact broken label state under review.`,
  taskPrompt:
    'Inspect the Namespace metadata and identify the missing or conflicting security label state. Cite exact labels and do not mutate resources.',
  visibleResourceRefs: ['namespace/team-a'],
  observationKinds: ['namespace.metadata'],
  setup: [namespace('team-a', labels)],
  acceptedFacts: [
    {
      fact_id: 'label-state',
      resource_ref: 'namespace/team-a',
      field_path: 'metadata.labels',
      observed_value: JSON.stringify(labels ?? {}),
      description: capability.predicate_summary,
    },
  ],
  contradictionFacts: [
    {
      fact_id: 'healthy-control',
      resource_ref: 'namespace/team-a',
      field_path: 'metadata.labels',
      observed_value: '{"pod-security.kubernetes.io/enforce":"restricted"}',
      description: 'The healthy control applies the expected restricted label set.',
    },
  ],
  category: 'workload_configuration',
  feasibility: 'manifest_only',
  track: 'policy',
  mechanisms: ['api-server'],
  profiles: manifestProfiles,
});

const selectorMismatchFixture = (
  capability: Capability,
  kind: 'Deployment' | 'PodDisruptionBudget' | 'CiliumNetworkPolicy'
): Fixture => {
  if (kind === 'Deployment') {
    return {
      title: 'Controller selector matches no pods',
      description: `${capability.predicate_summary} The Deployment selector differs from the template labels.`,
      taskPrompt:
        'Inspect the controller selector and template labels. Explain why no Pods match, citing exact fields, and do not mutate resources.',
      visibleResourceRefs: ['deployment/mismatch'],
      observationKinds: ['deployment.selector', 'deployment.pod-template-labels'],
      setup: [
        {
          apiVersion: 'apps/v1',
          kind: 'Deployment',
          metadata: { name: 'mismatch' },
          spec: {
            replicas: 1,
            selector: { matchLabels: { app: 'api' } },
            template: {
              metadata: { labels: { app: 'web' } },
              spec: { containers: [{ name: 'app', image: pauseImage }] },
            },
          },
        },
      ],
      acceptedFacts: [
        {
          fact_id: 'selector-mismatch',
          resource_ref: 'deployment/mismatch',
          field_path: 'spec.selector.matchLabels + spec.template.metadata.labels',
          observed_value: '{"app":"api"}+{"app":"web"}',
          description: capability.predicate_summary,
        },
      ],
      contradictionFacts: [
        {
          fact_id: 'healthy-control',
          resource_ref: 'deployment/mismatch',
          field_path: 'spec.template.metadata.labels',
          observed_value: '{"app":"api"}',
          description: 'The healthy control uses matching labels.',
        },
      ],
      category: 'workload_configuration',
      feasibility: 'manifest_only',
      track: 'policy',
      mechanisms: ['api-server'],
      profiles: manifestProfiles,
    };
  }
  if (kind === 'PodDisruptionBudget') {
    return {
      title: 'PodDisruptionBudget selector matches no workload',
      description: `${capability.predicate_summary} The PodDisruptionBudget selects app=api while the only workload is app=web.`,
      taskPrompt:
        'Inspect the PodDisruptionBudget selector and workload labels. Explain why no Pods are protected, citing exact fields, and do not mutate resources.',
      visibleResourceRefs: ['deployment/web', 'poddisruptionbudget/web-pdb'],
      observationKinds: ['pdb.selector', 'deployment.pod-template-labels'],
      setup: [
        deployment('web', {}, {}),
        {
          apiVersion: 'policy/v1',
          kind: 'PodDisruptionBudget',
          metadata: { name: 'web-pdb' },
          spec: { minAvailable: 1, selector: { matchLabels: { app: 'api' } } },
        },
      ],
      acceptedFacts: [
        {
          fact_id: 'pdb-selector-mismatch',
          resource_ref: 'poddisruptionbudget/web-pdb',
          field_path: 'spec.selector.matchLabels',
          observed_value: '{"app":"api"}',
          description: capability.predicate_summary,
        },
      ],
      contradictionFacts: [
        {
          fact_id: 'healthy-control',
          resource_ref: 'poddisruptionbudget/web-pdb',
          field_path: 'spec.selector.matchLabels',
          observed_value: '{"app":"web"}',
          description: 'The healthy control would target the actual workload labels.',
        },
      ],
      category: 'workload_configuration',
      feasibility: 'manifest_only',
      track: 'policy',
      mechanisms: ['api-server'],
      profiles: manifestProfiles,
    };
  }
  return {
    title: 'Cilium selector matches no endpoints',
    description: `${capability.predicate_summary} The CiliumNetworkPolicy selects app=api while the only Pod label is app=web.`,
    taskPrompt:
      'Inspect the policy selector and workload labels. Explain why no endpoints match, citing exact fields, and do not mutate resources.',
    visibleResourceRefs: ['deployment/web', 'ciliumnetworkpolicy/web-policy'],
    observationKinds: ['custom-resource.spec', 'deployment.pod-template-labels'],
    setup: [
      deployment('web', {}, {}),
      {
        apiVersion: 'cilium.io/v2',
        kind: 'CiliumNetworkPolicy',
        metadata: { name: 'web-policy' },
        spec: {
          endpointSelector: { matchLabels: { app: 'api' } },
          ingress: [{ fromEndpoints: [{ matchLabels: { app: 'frontend' } }] }],
        },
      },
    ],
    acceptedFacts: [
      {
        fact_id: 'cilium-selector-mismatch',
        resource_ref: 'ciliumnetworkpolicy/web-policy',
        field_path: 'spec.endpointSelector.matchLabels',
        observed_value: '{"app":"api"}',
        description: capability.predicate_summary,
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'healthy-control',
        resource_ref: 'ciliumnetworkpolicy/web-policy',
        field_path: 'spec.endpointSelector.matchLabels',
        observed_value: '{"app":"web"}',
        description: 'The healthy control uses the actual workload label set.',
      },
    ],
    category: 'workload_configuration',
    feasibility: 'custom_crd',
    track: 'policy',
    mechanisms: ['api-server', 'cni'],
    profiles: manifestProfiles,
  };
};

const listAllNamespacesFixture = (capability: Capability): Fixture => ({
  title: 'RBAC subject can list all namespaces',
  description: `${capability.predicate_summary} The binding grants namespace inventory rights cluster-wide.`,
  taskPrompt:
    'Inspect the RBAC grant and identify why the subject can enumerate namespaces. Cite exact fields and do not mutate resources.',
  visibleResourceRefs: ['clusterrole/namespace-list', 'clusterrolebinding/namespace-lister'],
  observationKinds: ['clusterrole.rules', 'clusterrolebinding.subjects'],
  setup: [
    serviceAccount('auditor'),
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRole',
      metadata: { name: 'namespace-list' },
      rules: [{ apiGroups: [''], resources: ['namespaces'], verbs: ['get', 'list'] }],
    },
    {
      apiVersion: 'rbac.authorization.k8s.io/v1',
      kind: 'ClusterRoleBinding',
      metadata: { name: 'namespace-lister' },
      roleRef: {
        apiGroup: 'rbac.authorization.k8s.io',
        kind: 'ClusterRole',
        name: 'namespace-list',
      },
      subjects: [{ kind: 'ServiceAccount', name: 'auditor', namespace: 'default' }],
    },
  ],
  acceptedFacts: [
    {
      fact_id: 'namespace-list-grant',
      resource_ref: 'clusterrole/namespace-list',
      field_path: 'rules[0]',
      observed_value: '{"resources":["namespaces"],"verbs":["get","list"]}',
      description: capability.predicate_summary,
    },
  ],
  contradictionFacts: [
    {
      fact_id: 'healthy-control',
      resource_ref: 'clusterrole/namespace-list',
      field_path: 'rules[0].resources',
      observed_value: '["pods"]',
      description: 'The healthy control would not grant namespace inventory rights.',
    },
  ],
  category: 'workload_configuration',
  feasibility: 'manifest_only',
  track: 'policy',
  mechanisms: ['api-server', 'authorization'],
  profiles: manifestProfiles,
});

const foundTaintFixture = (capability: Capability): Fixture => ({
  title: 'Node taint has no matching Pod toleration',
  description: `${capability.predicate_summary} The only node is tainted dedicated=infra:NoSchedule and the workload has no toleration.`,
  taskPrompt:
    'Inspect node taints and Pod tolerations. Explain why the workload cannot tolerate the node, citing exact fields, and do not mutate resources.',
  visibleResourceRefs: ['node/worker-a', 'deployment/workload'],
  observationKinds: ['node.spec', 'deployment.pod-template'],
  setup: [
    {
      apiVersion: 'v1',
      kind: 'Node',
      metadata: { name: 'worker-a', labels: { 'kubernetes.io/hostname': 'worker-a' } },
      spec: { taints: [{ key: 'dedicated', value: 'infra', effect: 'NoSchedule' }] },
    },
    deployment('workload', {}, { nodeSelector: { 'kubernetes.io/hostname': 'worker-a' } }),
  ],
  acceptedFacts: [
    {
      fact_id: 'untolerated-taint',
      resource_ref: 'node/worker-a',
      field_path: 'spec.taints[0]',
      observed_value: '{"key":"dedicated","value":"infra","effect":"NoSchedule"}',
      description: capability.predicate_summary,
    },
  ],
  contradictionFacts: [
    {
      fact_id: 'healthy-control',
      resource_ref: 'deployment/workload',
      field_path: 'spec.template.spec.tolerations[0].key',
      observed_value: 'dedicated',
      description: 'The healthy control would add a matching toleration.',
    },
  ],
  category: 'workload_configuration',
  feasibility: 'manifest_only',
  track: 'policy',
  mechanisms: ['api-server', 'scheduler'],
  profiles: manifestProfiles,
});

const noNodesMatchFixture = (capability: Capability): Fixture => ({
  title: 'Node selector matches no node',
  description: `${capability.predicate_summary} The Deployment requires disk=ssd while the only Node advertises disk=hdd.`,
  taskPrompt:
    'Inspect the node selector and available node labels. Explain why no nodes match, citing exact fields, and do not mutate resources.',
  visibleResourceRefs: ['node/worker-a', 'deployment/storage-app'],
  observationKinds: ['node.metadata', 'deployment.pod-template'],
  setup: [
    { apiVersion: 'v1', kind: 'Node', metadata: { name: 'worker-a', labels: { disk: 'hdd' } } },
    deployment('storage-app', {}, { nodeSelector: { disk: 'ssd' } }),
  ],
  acceptedFacts: [
    {
      fact_id: 'selector-has-no-match',
      resource_ref: 'deployment/storage-app',
      field_path: 'spec.template.spec.nodeSelector.disk',
      observed_value: 'ssd',
      description: capability.predicate_summary,
    },
  ],
  contradictionFacts: [
    {
      fact_id: 'healthy-control',
      resource_ref: 'node/worker-a',
      field_path: 'metadata.labels.disk',
      observed_value: 'ssd',
      description: 'The healthy control would expose the requested label on a node.',
    },
  ],
  category: 'workload_configuration',
  feasibility: 'manifest_only',
  track: 'policy',
  mechanisms: ['api-server', 'scheduler'],
  profiles: manifestProfiles,
});

const buildFixture = (capability: Capability): Fixture => {
  switch (capability.canonical_capability_id) {
    case 'canonical:access-container-service-account-v1:daa36c4819f6':
      return accessServiceAccountFixture(capability);
    case 'canonical:agent-runtime-image-digests:d20ca89e9104':
      return customResourceFixture(
        capability,
        {
          apiVersion: 'agentruntime.example.io/v1alpha1',
          kind: 'SandboxTemplate',
          metadata: { name: 'build-sandbox' },
          spec: {
            image: 'ghcr.io/example/agent-runner:latest',
            workerPoolImage: 'ghcr.io/example/worker:v1',
          },
        },
        'sandboxtemplate/build-sandbox',
        'spec.image + spec.workerPoolImage',
        'ghcr.io/example/agent-runner:latest + ghcr.io/example/worker:v1',
        'ghcr.io/example/agent-runner@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa + ghcr.io/example/worker@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      );
    case 'canonical:agent-runtime-image-registries:74c2a9c479e8':
      return customResourceFixture(
        capability,
        {
          apiVersion: 'agentruntime.example.io/v1alpha1',
          kind: 'WorkerPool',
          metadata: { name: 'public-workers' },
          spec: { image: 'docker.io/example/worker:1.0.0' },
        },
        'workerpool/public-workers',
        'spec.image',
        'docker.io/example/worker:1.0.0',
        'registry.example.corp/worker@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
      );
    case 'canonical:agent-sandbox-container-limits:d1dd6cf72524':
      return customResourceFixture(
        capability,
        {
          apiVersion: 'agentruntime.example.io/v1alpha1',
          kind: 'Sandbox',
          metadata: { name: 'unbounded-sandbox' },
          spec: {
            containers: [
              {
                name: 'runner',
                image: pauseImage,
                resources: { requests: { cpu: '100m', memory: '128Mi' } },
              },
            ],
          },
        },
        'sandbox/unbounded-sandbox',
        'spec.containers[0].resources',
        '{"requests":{"cpu":"100m","memory":"128Mi"}}',
        '{"requests":{"cpu":"100m","memory":"128Mi"},"limits":{"cpu":"500m","memory":"512Mi"}}'
      );
    case 'canonical:agent-sandbox-image-registry-allowlist:d98f5889ed98':
      return customResourceFixture(
        capability,
        {
          apiVersion: 'agentruntime.example.io/v1alpha1',
          kind: 'SandboxTemplate',
          metadata: { name: 'external-template' },
          spec: { containers: [{ name: 'runner', image: 'docker.io/library/alpine:3.20' }] },
        },
        'sandboxtemplate/external-template',
        'spec.containers[0].image',
        'docker.io/library/alpine:3.20',
        'registry.example.corp/agent/alpine:3.20'
      );
    case 'canonical:agent-sandbox-image-tag-provenance:dee5a230b79f':
      return customResourceFixture(
        capability,
        {
          apiVersion: 'agentruntime.example.io/v1alpha1',
          kind: 'SandboxTemplate',
          metadata: { name: 'floating-template' },
          spec: {
            containers: [{ name: 'runner', image: 'registry.example.corp/agent/runner:latest' }],
          },
        },
        'sandboxtemplate/floating-template',
        'spec.containers[0].image',
        'registry.example.corp/agent/runner:latest',
        'registry.example.corp/agent/runner:1.4.2'
      );
    case 'canonical:agent-sandbox-service-account-token:1fcbfb91ac55':
      return customResourceFixture(
        capability,
        {
          apiVersion: 'agentruntime.example.io/v1alpha1',
          kind: 'Sandbox',
          metadata: { name: 'token-sandbox' },
          spec: { podTemplate: { spec: { automountServiceAccountToken: true } } },
        },
        'sandbox/token-sandbox',
        'spec.podTemplate.spec.automountServiceAccountToken',
        'true',
        'false'
      );
    case 'canonical:alert-mount-potential-credentials-paths:976fc30f3356':
      return hostPathVolumeFixture(capability);
    case 'canonical:anonymous-access-enabled:af2fac841ee6':
      return anonymousAccessFixture(capability);
    case 'canonical:container-image-repository-v1:01f9d14acf2f':
      return imageRepositoryFixture(capability, 'legacy-image', 'docker.io/library/nginx:1.27');
    case 'canonical:container-image-repository:91d5dc5b59e1':
      return imageRepositoryFixture(
        capability,
        'external-image',
        'quay.io/example/unapproved:2.1.0'
      );
    case 'canonical:deprecated-service-account-field:b3694ab1132c':
      return deprecatedServiceAccountFixture(capability);
    case 'canonical:detect-nginx-ingress-controller-eol:f62555d2d160':
      return {
        title: 'Ingress controller image is at an end-of-life version',
        description: `${capability.predicate_summary} The Deployment runs a concrete ingress controller image scheduled for end of support.`,
        taskPrompt:
          'Inspect the ingress controller deployment image and identify the supportability risk. Cite exact image values and do not mutate resources.',
        visibleResourceRefs: ['deployment/ingress-nginx-controller'],
        observationKinds: ['deployment.pod-template', 'container.image'],
        setup: [deployment('ingress-nginx-controller', { image: nginxImage })],
        acceptedFacts: [
          {
            fact_id: 'eol-image',
            resource_ref: 'deployment/ingress-nginx-controller',
            field_path: 'spec.template.spec.containers[0].image',
            observed_value: nginxImage,
            description: capability.predicate_summary,
          },
        ],
        contradictionFacts: [
          {
            fact_id: 'healthy-control',
            resource_ref: 'deployment/ingress-nginx-controller',
            field_path: 'spec.template.spec.containers[0].image',
            observed_value: 'registry.k8s.io/ingress-nginx/controller:v1.13.0',
            description: 'The healthy control advances to a supported release line.',
          },
        ],
        category: 'workload_configuration',
        feasibility: 'manifest_only',
        track: 'operations',
        mechanisms: ['api-server'],
        profiles: manifestProfiles,
      };
    case 'canonical:do-you-mean-it-serviceaccount-is-automounting-apiserver-credenti:ec7f95ff03c1':
      return automountTokenFixture(capability);
    case 'canonical:ensure-network-policy-configured-in-labels:026450e6f201':
      return networkPolicyLabelsFixture(capability);
    case 'canonical:excessive-amount-of-vulnerabilities-pods:72b297fc4454':
      return internetExposureFixture(
        capability,
        'service',
        true,
        'Exposed workload has a severe vulnerability backlog'
      );
    case 'canonical:exposed-critical-pods:26f59b657129':
      return internetExposureFixture(
        capability,
        'service',
        true,
        'Internet-exposed workload has critical vulnerabilities'
      );
    case 'canonical:exposed-rce-pods:dd895a3181b6':
      return internetExposureFixture(
        capability,
        'service',
        true,
        'Internet-exposed workload has remote-code-execution vulnerabilities'
      );
    case 'canonical:exposed-sensitive-interfaces-v1:075eb7791b57':
      return internetExposureFixture(
        capability,
        'service',
        false,
        'Sensitive management interface is exposed'
      );
    case 'canonical:exposure-to-internet-via-gateway-api:34df4a1bf705':
      return internetExposureFixture(capability, 'gateway');
    case 'canonical:exposure-to-internet-via-istio-ingress:f5559314318b':
      return internetExposureFixture(capability, 'istio');
    case 'canonical:exposure-to-internet:f9d520415f00':
      return internetExposureFixture(capability, 'service');
    case 'canonical:external-secret-storage:7cceabdd2f8d':
      return {
        title: 'Application stores a database password directly in a Secret',
        description: `${capability.predicate_summary} The workload relies on a namespace Secret rather than an external secret manager.`,
        taskPrompt:
          'Inspect the Secret consumption pattern and explain the secret-management gap. Cite exact resources and do not mutate resources.',
        visibleResourceRefs: ['secret/app-db', 'deployment/app'],
        observationKinds: ['secret.metadata', 'deployment.pod-template'],
        setup: [
          {
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: { name: 'app-db' },
            type: 'Opaque',
            stringData: { password: 'fixture-db-password' },
          },
          deployment('app', {
            env: [
              {
                name: 'DB_PASSWORD',
                valueFrom: { secretKeyRef: { name: 'app-db', key: 'password' } },
              },
            ],
          }),
        ],
        acceptedFacts: [
          {
            fact_id: 'direct-secret-dependency',
            resource_ref: 'deployment/app',
            field_path: 'spec.template.spec.containers[0].env[0].valueFrom.secretKeyRef.name',
            observed_value: 'app-db',
            description: capability.predicate_summary,
          },
        ],
        contradictionFacts: [
          {
            fact_id: 'healthy-control',
            resource_ref: 'deployment/app',
            field_path: 'spec.template.spec.containers[0].env[0].value',
            observed_value: 'vault://apps/app-db/password',
            description: 'The healthy control would reference an external secret system instead.',
          },
        ],
        category: 'workload_configuration',
        feasibility: 'manifest_only',
        track: 'operations',
        mechanisms: ['api-server'],
        profiles: manifestProfiles,
      };
    case 'canonical:found-taint-s-but-no-pod-can-tolerate:8bfaa4992afd':
      return foundTaintFixture(capability);
    case 'canonical:has-image-signature:baed11d8b5c5':
      return {
        title: 'Deployment image lacks recorded signature evidence',
        description: `${capability.predicate_summary} The setup pairs a concrete Deployment with an inert verification report that records no signature.`,
        taskPrompt:
          'Inspect the workload image and the attached verification evidence. Explain the signature gap and do not mutate resources.',
        visibleResourceRefs: ['deployment/signed-app', 'configmap/image-verification-report'],
        observationKinds: ['deployment.pod-template', 'configmap.data'],
        setup: [
          deployment('signed-app', { image: 'registry.example.corp/apps/signed-app:1.2.0' }),
          inertConfigMap(
            'image-verification-report',
            '/var/lib/evals/image-report.json',
            'normalized-predicate',
            {
              'report.json': JSON.stringify(
                { image: 'registry.example.corp/apps/signed-app:1.2.0', hasSignature: false },
                null,
                2
              ),
              'healthy-control.json': JSON.stringify(
                { image: 'registry.example.corp/apps/signed-app:1.2.0', hasSignature: true },
                null,
                2
              ),
            }
          ),
        ],
        acceptedFacts: [
          {
            fact_id: 'signature-absent',
            resource_ref: 'configmap/image-verification-report',
            field_path: 'data.report.json',
            observed_value:
              '{\n  "image": "registry.example.corp/apps/signed-app:1.2.0",\n  "hasSignature": false\n}',
            description: capability.predicate_summary,
          },
        ],
        contradictionFacts: [
          {
            fact_id: 'healthy-control',
            resource_ref: 'configmap/image-verification-report',
            field_path: 'data.healthy-control.json',
            observed_value:
              '{\n  "image": "registry.example.corp/apps/signed-app:1.2.0",\n  "hasSignature": true\n}',
            description: 'The healthy control records a verified signature.',
          },
        ],
        category: 'workload_configuration',
        feasibility: 'manifest_only',
        track: 'operations',
        mechanisms: ['api-server'],
        profiles: manifestProfiles,
      };
    case 'canonical:ingress-and-egress-blocked:140895e3ac6d':
      return {
        title: 'NetworkPolicy blocks both ingress and egress',
        description: `${capability.predicate_summary} The selected Pod has a default-deny ingress and egress policy with no allow rules.`,
        taskPrompt:
          'Inspect the workload and selecting NetworkPolicy. Explain how traffic is blocked, citing exact fields, and do not mutate resources.',
        visibleResourceRefs: ['deployment/isolated-app', 'networkpolicy/default-deny-all'],
        observationKinds: ['deployment.pod-template', 'networkpolicy.spec'],
        setup: [
          deployment('isolated-app', {}, {}),
          {
            apiVersion: 'networking.k8s.io/v1',
            kind: 'NetworkPolicy',
            metadata: { name: 'default-deny-all' },
            spec: {
              podSelector: { matchLabels: { app: 'isolated-app' } },
              policyTypes: ['Ingress', 'Egress'],
              ingress: [],
              egress: [],
            },
          },
        ],
        acceptedFacts: [
          {
            fact_id: 'deny-both-directions',
            resource_ref: 'networkpolicy/default-deny-all',
            field_path: 'spec.policyTypes',
            observed_value: '["Ingress","Egress"]',
            description: capability.predicate_summary,
          },
        ],
        contradictionFacts: [
          {
            fact_id: 'healthy-control',
            resource_ref: 'networkpolicy/default-deny-all',
            field_path: 'spec.egress[0].to[0].namespaceSelector',
            observed_value: '{"matchLabels":{"name":"monitoring"}}',
            description: 'The healthy control would include explicit allow rules.',
          },
        ],
        category: 'workload_configuration',
        feasibility: 'manifest_only',
        track: 'policy',
        mechanisms: ['api-server', 'cni'],
        profiles: manifestProfiles,
      };
    case 'canonical:insecure-capabilities:39eb9eccf638':
      return {
        title: 'Container retains insecure Linux capabilities',
        description: `${capability.predicate_summary} The Deployment adds SYS_ADMIN and NET_RAW.`,
        taskPrompt:
          'Inspect the container security context and explain the capability risk. Cite exact fields and do not mutate resources.',
        visibleResourceRefs: ['deployment/cap-app'],
        observationKinds: ['deployment.pod-template', 'container.security-context'],
        setup: [
          deployment('cap-app', {
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { add: ['SYS_ADMIN', 'NET_RAW'], drop: [] },
            },
          }),
        ],
        acceptedFacts: [
          {
            fact_id: 'insecure-capabilities',
            resource_ref: 'deployment/cap-app',
            field_path: 'spec.template.spec.containers[0].securityContext.capabilities.add',
            observed_value: '["SYS_ADMIN","NET_RAW"]',
            description: capability.predicate_summary,
          },
        ],
        contradictionFacts: [
          {
            fact_id: 'healthy-control',
            resource_ref: 'deployment/cap-app',
            field_path: 'spec.template.spec.containers[0].securityContext.capabilities.drop',
            observed_value: '["ALL"]',
            description: 'The healthy control would drop all default capabilities.',
          },
        ],
        category: 'workload_configuration',
        feasibility: 'manifest_only',
        track: 'policy',
        mechanisms: ['api-server'],
        profiles: manifestProfiles,
      };
    case 'canonical:linux-hardening:9f46be5acf32':
      return {
        title: 'Container omits Linux hardening controls',
        description: `${capability.predicate_summary} The Deployment omits seccompProfile, runAsNonRoot, and capability drops.`,
        taskPrompt:
          'Inspect the container hardening settings and identify the missing controls. Cite exact fields and do not mutate resources.',
        visibleResourceRefs: ['deployment/soft-app'],
        observationKinds: ['deployment.pod-template', 'container.security-context'],
        setup: [deployment('soft-app', { securityContext: { allowPrivilegeEscalation: true } })],
        acceptedFacts: [
          {
            fact_id: 'hardening-missing',
            resource_ref: 'deployment/soft-app',
            field_path: 'spec.template.spec.containers[0].securityContext',
            observed_value: '{"allowPrivilegeEscalation":true}',
            description: capability.predicate_summary,
          },
        ],
        contradictionFacts: [
          {
            fact_id: 'healthy-control',
            resource_ref: 'deployment/soft-app',
            field_path: 'spec.template.spec.containers[0].securityContext.seccompProfile.type',
            observed_value: 'RuntimeDefault',
            description: 'The healthy control would define baseline Linux hardening.',
          },
        ],
        category: 'workload_configuration',
        feasibility: 'manifest_only',
        track: 'policy',
        mechanisms: ['api-server'],
        profiles: manifestProfiles,
      };
    case 'canonical:list-all-namespaces:a25c909e2fef':
      return listAllNamespacesFixture(capability);
    case 'canonical:missing-security-namespace-label-q:49181e5af116':
      return namespaceLabelFixture(
        capability,
        undefined,
        'Namespace is missing required security labels'
      );
    case 'canonical:namespace-mismatch-with-security-labels-namespace-q-vs-q:50e36f2f5905':
      return namespaceLabelFixture(
        capability,
        { 'pod-security.kubernetes.io/audit': 'team-b' },
        'Namespace security label references a different tenant'
      );
    case 'canonical:no-cilium-endpoints-matched-s-selector:5aca6ec9fac3':
      return selectorMismatchFixture(capability, 'CiliumNetworkPolicy');
    case 'canonical:no-nodes-matched-node-selector:879e87741bca':
      return noNodesMatchFixture(capability);
    case 'canonical:no-pods-match-controller-selector-s:e0ad471c18de':
      return selectorMismatchFixture(capability, 'Deployment');
    case 'canonical:no-pods-match-pdb-selector-s:89bef59b41f8':
      return selectorMismatchFixture(capability, 'PodDisruptionBudget');
    default:
      if (capability.canonical_capability_id.includes('namespace-is-inactive')) {
        return genericConfigMapFixture(capability, {
          category: 'runtime_node_failure',
          feasibility: 'host',
          track: 'node_problem_detector',
          mechanisms: ['api-server'],
          profiles: hostProfiles,
        });
      }
      if (
        capability.canonical_capability_id.includes('insufficient-disk-space') ||
        capability.canonical_capability_id.includes('insufficient-pids-on-node') ||
        capability.canonical_capability_id.includes('no-network-configured-on-node') ||
        capability.canonical_capability_id.includes('lint-internal-error')
      ) {
        return genericConfigMapFixture(capability, {
          category: 'runtime_node_failure',
          feasibility: 'host',
          track: 'node_problem_detector',
          mechanisms: ['api-server'],
          profiles: hostProfiles,
        });
      }
      if (
        capability.canonical_capability_id.includes('ensure-azure-rbac') ||
        capability.canonical_capability_id.includes('image-vulnerability-scanning') ||
        capability.canonical_capability_id.includes('instance-metadata-api-access')
      ) {
        return genericConfigMapFixture(capability, {
          category: 'control_plane_host_hardening',
          feasibility: 'cloud',
          track: 'operations',
          mechanisms: ['api-server'],
          profiles: ['aks'],
        });
      }
      if (capability.source_tool_ids.includes('popeye')) {
        return genericConfigMapFixture(capability, {
          category: 'workload_configuration',
          feasibility: 'manifest_only',
          track: 'policy',
          mechanisms: ['api-server'],
          profiles: manifestProfiles,
        });
      }
      return genericConfigMapFixture(capability);
  }
};

const records = selectedCapabilityIds.map(capabilityId => {
  const capability = capabilityById.get(capabilityId);
  if (!capability) {
    throw new Error(`unknown canonical capability ${capabilityId}`);
  }
  const fixture = buildFixture(capability);
  const scenarioId = scenarioIdFor(capability.canonical_capability_id);
  const definition: ScenarioDraftDefinition = {
    scenarioId,
    title: fixture.title,
    description: fixture.description,
    taskPrompt: fixture.taskPrompt,
    visibleResourceRefs: fixture.visibleResourceRefs,
    observationKinds: fixture.observationKinds,
    setup: fixture.setup,
    acceptedFacts: fixture.acceptedFacts,
    contradictionFacts: fixture.contradictionFacts,
    requiredMechanisms: fixture.mechanisms,
    supportedClusterProfiles: fixture.profiles,
  };
  const catalog: V6ScenarioCatalogSeed = {
    scenarioId,
    title: fixture.title,
    trigger: `${fixture.acceptedFacts[0]!.description} Observed at ${
      fixture.acceptedFacts[0]!.field_path
    }.`,
    healthy: `${fixture.contradictionFacts[0]!.description} Observed at ${
      fixture.contradictionFacts[0]!.field_path
    }.`,
    resources: fixture.visibleResourceRefs,
    targetRuleIds: [...capability.source_rule_ids].sort(),
    targetSemanticGroupIds: [...capability.source_semantic_group_ids].sort(),
    targetCanonicalCapabilityIds: [capability.canonical_capability_id],
    selectionTrack: fixture.track,
    category: fixture.category,
    feasibility: fixture.feasibility,
    requiredMechanisms: fixture.mechanisms,
    supportedClusterProfiles: fixture.profiles,
  };
  return { definition, catalog };
});

export const v6ScenarioDraftDefinitions: ScenarioDraftDefinition[] = records.map(
  record => record.definition
);

export const v6ScenarioCatalogSeeds: V6ScenarioCatalogSeed[] = records.map(
  record => record.catalog
);
