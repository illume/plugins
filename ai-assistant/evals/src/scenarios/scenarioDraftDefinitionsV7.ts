import assert from 'node:assert/strict';
import type { ClusterProfileName, RequiredMechanism } from '../contracts/evaluationContracts.js';
import { createRequire } from 'node:module';
import type { DraftFact, ScenarioDraftDefinition } from './scenarioDraftDefinition.js';

export type V7Category =
  | 'workload_configuration'
  | 'control_plane_host_hardening'
  | 'runtime_node_failure'
  | 'operations_deprecation';
export type V7Feasibility =
  | 'manifest_only'
  | 'live_cluster'
  | 'telemetry'
  | 'host'
  | 'cloud'
  | 'runtime'
  | 'custom_crd';
export type V7SelectionTrack = 'policy' | 'operations' | 'node_problem_detector';

interface Capability {
  canonical_capability_id: string;
  title: string;
  predicate_summary: string;
  source_rule_ids: string[];
  source_semantic_group_ids: string[];
  source_tool_ids: string[];
}

export interface V7ScenarioCatalogSeed {
  scenarioId: string;
  title: string;
  trigger: string;
  healthy: string;
  resources: string[];
  targetRuleIds: string[];
  targetSemanticGroupIds: string[];
  targetCanonicalCapabilityIds: string[];
  selectionTrack: V7SelectionTrack;
  category: V7Category;
  feasibility: V7Feasibility;
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
  category: V7Category;
  feasibility: V7Feasibility;
  track: V7SelectionTrack;
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

const selectedCapabilityIds = [
  'canonical:agent-sandbox-claim-overrides:c9d2aaa42c7a',
  'canonical:agent-sandbox-egress-policy:0ffaca61595b',
  'canonical:agent-sandbox-hardened-runtime-class:d1fd0c804786',
  'canonical:agent-sandbox-managed-networking:4cc54f55fff7',
  'canonical:agent-sandbox-strict-egress:bfb55920cc5b',
  'canonical:at-current-load-cpu-over-allocated-current-s-vs-requested-s-s:a1c9da1e5d45',
  'canonical:at-current-load-cpu-under-allocated-current-s-vs-requested-s-s:3fac0be0a7fc',
  'canonical:at-current-load-memory-over-allocated-current-s-vs-requested-s-s:785321169721',
  'canonical:at-current-load-memory-under-allocated-current-s-vs-requested-s-:a87bda82e540',
  'canonical:authentication-istio-io-v1alpha1-removed-in-v1-6-0:ea43fd0d31bf',
  'canonical:cluster-access-manager-api-eks:74906880aa6e',
  'canonical:configure-encryption-of-data-at-rest-in-etcd-datastore:24b17661cd73',
  'canonical:cpu-threshold-d-reached-d:422ac7b4dc56',
  'canonical:enable-the-eventratelimit-plugin:52d1de982d80',
  'canonical:ensure-api-server-authorization-modes-does-not-include-alwaysall:dcc85052f01a',
  'canonical:ensure-aws-policies-are-present:e1c9df58b842',
  'canonical:ensure-clusters-are-created-with-private-endpoint-enabled-and-pu:d468fbe3c960',
  'canonical:ensure-clusters-are-created-with-private-nodes:4b8dc351fe20',
  'canonical:ensure-controller-manager-profiling-is-disabled:9b7325c7a738',
  'canonical:ensure-latest-cni-version-is-used-manual:e447a67eaaf9',
  'canonical:ensure-legacy-authorization-abac-is-disabled-scored:553632d476d6',
  'canonical:ensure-logging-and-cloud-monitoring-is-enabled-automated:2aafe8409558',
  'canonical:ensure-master-authorized-networks-is-enabled-manual:d1992013b918',
  'canonical:ensure-node-auto-repair-is-enabled-for-gke-nodes-scored:78eaea21a0c6',
  'canonical:ensure-node-auto-upgrade-is-enabled-for-gke-nodes-scored:89eca1505ceb',
  'canonical:ensure-only-trusted-container-images-are-used-manual:79780f14f007',
  'canonical:ensure-that-all-namespaces-have-networkpolicies-defined-manual:0573d7a09d37',
  'canonical:ensure-that-anonymous-requests-are-authorized-manual:821811a013d7',
  'canonical:ensure-that-controller-manager-healthz-endpoints-are-protected-b:5f1faaed9b35',
  'canonical:ensure-that-default-service-accounts-are-not-actively-used:f02452490746',
  'canonical:ensure-that-garbage-collection-is-configured-as-appropriate-manu:bb2b4f92acb2',
  'canonical:ensure-that-the-admin-conf-file-ownership-is-set-to-root-root:272c3e29d85a',
  'canonical:ensure-that-the-admin-conf-file-permissions-are-set-to-600:fe759f6fbb6b',
  'canonical:ensure-that-the-admin-conf-file-permissions-are-set-to-644-or-mo:a4672f9933b5',
  'canonical:ensure-that-the-admin-kubeconfig-file-ownership-is-set-to-root-r:43a0bbdb5a3b',
  'canonical:ensure-that-the-admin-kubeconfig-file-permissions-are-set-to-644:aa9c9a966cc8',
  'canonical:ensure-that-the-admission-control-plugin-podsecuritypolicy-is-se:95bdae0d8bca',
  'canonical:ensure-that-the-admission-control-plugin-securitycontextdeny-is-:2c7b401543f6',
  'canonical:ensure-that-the-anonymous-auth-is-not-enabled-automated:3a5b399d138a',
  'canonical:ensure-that-the-controller-manager-conf-file-ownership-is-set-to:f63f8ba72a85',
  'canonical:ensure-that-the-controller-manager-conf-file-permissions-are-set:aa05e333e01b',
  'canonical:ensure-that-the-controller-manager-profiling-argument-is-set-to-:5be212e08351',
  'canonical:ensure-that-the-etcd-data-directory-ownership-is-set-to-etcd-etc:89d4a57f1996',
  'canonical:ensure-that-the-etcd-data-directory-permissions-are-set-to-700-o:f73508f2ae92',
  'canonical:ensure-that-the-kubeconfig-file-permissions-are-set-to-644-or-mo:142897da97ec',
  'canonical:ensure-that-the-kubernetes-pki-directory-and-file-ownership-is-s:168989584815',
  'canonical:ensure-that-the-kubernetes-pki-key-file-permissions-are-set-to-6:b31b621fdb40',
  'canonical:ensure-that-the-scheduler-conf-file-ownership-is-set-to-root-roo:b9de30e5cb94',
  'canonical:ensure-that-the-scheduler-conf-file-permissions-are-set-to-600-o:12096097663a',
  'canonical:ensure-that-a-minimal-audit-policy-is-created:9ebe76abdacc',
  'canonical:flowcontrol-apiserver-k8s-io-v1beta1-flowcontrol-removed-in-v1-2:50f320e30aa2',
  'canonical:if-proxy-kubeconfig-file-exists-ensure-ownership-is-set-to-root-:3e642eff2a05',
  'canonical:if-proxy-kubeconfig-file-exists-ensure-permissions-are-set-to-60:f659b7106a9d',
  'canonical:is-this-a-jurassic-cluster-might-want-to-upgrade-k8s-a-bit:7b08e810031b',
  'canonical:k8s-common-labels-usage:8334b2cf122a',
  'canonical:k8s-version-ok:5419234efd81',
  'canonical:key-s-used-unable-to-locate-key-reference:02db171eda5a',
  'canonical:label-usage-for-resources:aece01c38eda',
  'canonical:list-all-mutating-webhooks:ccd754b1cf51',
  'canonical:list-all-validating-webhooks:dd97ea0c92ea',
  'canonical:memory-threshold-d-reached-d:491fcaa7a329',
  'canonical:no-node-metrics-available:a31cf56e307f',
  'canonical:node-has-an-unknown-condition:f105c5911f8c',
  'canonical:pod-is-in-an-unhappy-phase-s:9f2c61da7f14',
  'canonical:pod-is-terminating-d-d-s:849d60d75971',
  'canonical:pod-is-terminating-d-d:5fba65fe6630',
  'canonical:pod-is-waiting-d-d-s:c3df65c1edc8',
  'canonical:pod-is-waiting-d-d:e1713bbb9475',
  'canonical:pod-security-admission-applied-2:badb9ab2d206',
  'canonical:pod-security-admission-baseline-applied-1:c7cc72d0a24d',
  'canonical:pod-security-admission-baseline-applied-2:00b6dbd3a602',
  'canonical:pod-security-admission-restricted-applied-1:a481b986e554',
  'canonical:pod-security-admission-restricted-applied-2:9b1c6ce40367',
  'canonical:pv-without-encryption:1142cd6af852',
  'canonical:rbac-istio-io-authorizationpolicies-removed-in-v1-4-0:8b182ca1e955',
  'canonical:read-only-port-enabled-updated:dd79653c46f7',
  'canonical:references-a-pull-secret-which-does-not-exist-s:7804a19fbac4',
  'canonical:references-an-unknown-node-ip-q:e7948daf5e6f',
  'canonical:references-namespace-which-does-not-exists-q:7133d8f9866b',
  'canonical:replicas-d-d-at-burst-will-match-exceed-cluster-cpu-s-capacity-b:699578126bfe',
  'canonical:replicas-d-d-at-burst-will-match-exceed-cluster-memory-s-capacit:33e1f2f15130',
  'canonical:resource-policies:51c2bfc93135',
  'canonical:resources-sandbox-cpu-limits:5ec1a97a1dcb',
  'canonical:resources-sandbox-memory-limits:ae2d627c83b4',
  'canonical:restrict-access-to-the-control-plane-endpoint:63725283e7ae',
  'canonical:rule-access-dashboard-subject-v1:5ecb7c1752d2',
  'canonical:rule-access-dashboard-wl-v1:0b6116539613',
  'canonical:rule-can-bind-escalate:76034340c7d5',
  'canonical:rule-can-create-pv:c918fab93352',
  'canonical:rule-can-delete-k8s-events-v1:1933698fa282',
  'canonical:rule-can-ssh-to-pod-v1:286572e37e6a',
  'canonical:rule-credentials-configmap:94be7ba64e19',
  'canonical:rule-deny-cronjobs:f40db95baaae',
  'canonical:rule-hostile-multitenant-workloads:c87d31b1f7e3',
  'canonical:rule-identify-old-k8s-registry:314ee6f4bec0',
  'canonical:s-is-suspended:d0cf46996ae9',
  'canonical:s-references-s-q-which-does-not-exist:b6a2c452a583',
  'canonical:scheduling-disabled:9866c4d77c94',
  'canonical:set-gmsacredentialspecname-value:ec4f661dc0fe',
  'canonical:set-hostprocess-true:b0a49fb57a0a',
  'canonical:set-selinuxoptions:23627ee6c0b6',
  'canonical:stale-unable-to-locate-matching-cilium-endpoint:8479c5776644',
  'canonical:symlink-exchange-can-allow-host-filesystem-access:21d8b4af0235',
  'canonical:system-authenticated-allowed-to-take-over-cluster:0747cf98e0af',
  'canonical:unable-to-assert-namespace-label-q:2d3bbd781127',
  'canonical:unauthenticated-service:6d0ba53b792b',
  'canonical:unhealthy-d-desired-but-have-d-available:4c90c5a881ca',
  'canonical:unmanaged-pod-detected-best-to-use-a-controller:1376498016b2',
  'canonical:used-unable-to-locate-resource-reference:6e2ccec4d6ed',
  'canonical:validate-kubelet-tls-configuration-updated:8248fac6b42d',
  'canonical:verify-image-signature:158acf93ab0f',
  'canonical:warning-found-s:396d654788c9',
  'canonical:worker-pod-resource-ceilings:d2985d01989e',
  'canonical:workload-mounted-configmap:3aea1d1ec3a8',
  'canonical:workload-mounted-secrets:f70af2acb96c',
  'canonical:zero-scale-detected:c721cbb831ef',
] as const;

assert.equal(selectedCapabilityIds.length, 116, 'expected exactly 116 v7 capabilities');
assert.equal(new Set(selectedCapabilityIds).size, 116, 'v7 capabilities must be unique');

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
  return `rule-gap-v7-${stem}-${digest.slice(0, 8)}`;
};

const titleCase = (value: string): string => {
  const normalized = value.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const inertEvidenceConfigMap = (
  name: string,
  targetPath: string,
  applicability: string,
  data: Record<string, string>
) => ({
  apiVersion: 'v1',
  kind: 'ConfigMap',
  metadata: {
    name,
    labels: { 'evals.kubernetes.io/fixture-kind': 'static-evidence' },
    annotations: {
      'evals.kubernetes.io/target-path': targetPath,
      'evals.kubernetes.io/apply-to-current-host': 'false',
      'evals.kubernetes.io/applicability': applicability,
    },
  },
  data,
});

const deprecatedManifestFixture = (
  capability: Capability,
  resource: object,
  resourceRef: string,
  fieldPath: string,
  brokenValue: string,
  healthyValue: string
): Fixture => ({
  title: titleCase(capability.title),
  description: `${capability.predicate_summary} The fixture encodes the deprecated Kubernetes API use directly in resource form.`,
  taskPrompt: `Inspect ${resourceRef} and explain the concrete API deprecation risk. Cite exact fields and do not mutate resources.`,
  visibleResourceRefs: [resourceRef],
  observationKinds: ['custom-resource.metadata', 'custom-resource.spec'],
  setup: [resource],
  acceptedFacts: [
    {
      fact_id: 'deprecated-api-trigger',
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
      description: 'The healthy control uses the supported API version for the same resource.',
    },
  ],
  category: 'operations_deprecation',
  feasibility: 'manifest_only',
  track: 'operations',
  mechanisms: ['api-server'],
  profiles: manifestProfiles,
});

const classify = (
  capability: Capability
): Pick<Fixture, 'category' | 'feasibility' | 'track' | 'mechanisms' | 'profiles'> => {
  const normalized = `${capability.title} ${capability.predicate_summary}`.toLowerCase();
  if (capability.source_tool_ids.includes('pluto') || normalized.includes('removed in v1')) {
    return {
      category: 'operations_deprecation',
      feasibility: 'manifest_only',
      track: 'operations',
      mechanisms: ['api-server'],
      profiles: manifestProfiles,
    };
  }
  if (
    normalized.includes('gke') ||
    normalized.includes('eks') ||
    normalized.includes('aws') ||
    normalized.includes('azure') ||
    normalized.includes('alibaba') ||
    normalized.includes('cloud security') ||
    normalized.includes('private endpoint') ||
    normalized.includes('private nodes') ||
    normalized.includes('authorized networks') ||
    normalized.includes('auto-repair') ||
    normalized.includes('auto-upgrade') ||
    normalized.includes('logging and cloud monitoring')
  ) {
    return {
      category: 'control_plane_host_hardening',
      feasibility: 'cloud',
      track: 'operations',
      mechanisms: ['api-server'],
      profiles: ['aks'],
    };
  }
  if (
    normalized.includes('node metrics') ||
    normalized.includes('cpu threshold') ||
    normalized.includes('memory threshold') ||
    normalized.includes('terminating') ||
    normalized.includes('waiting') ||
    normalized.includes('unhappy phase') ||
    normalized.includes('unknown condition') ||
    normalized.includes('scheduling disabled')
  ) {
    return {
      category: 'runtime_node_failure',
      feasibility: 'runtime',
      track: 'node_problem_detector',
      mechanisms: ['api-server'],
      profiles: hostProfiles,
    };
  }
  if (
    capability.source_tool_ids.includes('kube-bench') ||
    normalized.includes('permissions') ||
    normalized.includes('ownership') ||
    normalized.includes('audit') ||
    normalized.includes('kubelet') ||
    normalized.includes('scheduler') ||
    normalized.includes('controller manager') ||
    normalized.includes('api server') ||
    normalized.includes('etcd') ||
    normalized.includes('authorization') ||
    normalized.includes('anonymous auth') ||
    normalized.includes('eventratelimit') ||
    normalized.includes('podsecuritypolicy') ||
    normalized.includes('securitycontextdeny')
  ) {
    return {
      category: 'control_plane_host_hardening',
      feasibility: 'host',
      track: 'policy',
      mechanisms: ['api-server'],
      profiles: hostProfiles,
    };
  }
  return {
    category: 'workload_configuration',
    feasibility: 'manifest_only',
    track: capability.source_tool_ids.includes('popeye') ? 'operations' : 'policy',
    mechanisms: ['api-server'],
    profiles: manifestProfiles,
  };
};

const buildConcreteEvidence = (capability: Capability) => {
  const normalized = `${capability.title} ${capability.predicate_summary}`
    .toLowerCase()
    .replace(/[^a-z0-9/.:_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const explicitPath = capability.predicate_summary.match(/`(\/[^`]+)`/)?.[1];
  const component = normalized.includes('controller manager')
    ? 'kube-controller-manager'
    : normalized.includes('scheduler')
    ? 'kube-scheduler'
    : normalized.includes('api server')
    ? 'kube-apiserver'
    : normalized.includes('kubelet')
    ? 'kubelet'
    : normalized.includes('etcd')
    ? 'etcd'
    : normalized.includes('namespace')
    ? 'namespace'
    : normalized.includes('pod')
    ? 'pod'
    : normalized.includes('node')
    ? 'node'
    : normalized.includes('webhook')
    ? 'admission-webhook'
    : normalized.includes('sandbox')
    ? 'sandbox'
    : 'cluster';

  let exactField = 'status.condition';
  let brokenValue = 'misconfigured';
  let healthyValue = 'configured';
  let targetPath = explicitPath ?? '/var/lib/evals/cluster-status.json';
  let evidenceKind = 'cluster-status';
  let applicability = 'inert-review-only';

  if (normalized.includes('ownership')) {
    exactField = explicitPath ? `files[${explicitPath}].owner` : 'file.owner';
    brokenValue = normalized.includes('etcd') ? 'root:root' : 'nobody:nogroup';
    healthyValue = normalized.includes('etcd') ? 'etcd:etcd' : 'root:root';
    targetPath = explicitPath ?? '/etc/kubernetes/component-file';
    evidenceKind = 'file-metadata';
  } else if (normalized.includes('permissions')) {
    const expectedMode =
      normalized.match(/(?:permissions?(?: are)? set to|permissions set to)\s*(\d{3})/)?.[1] ??
      (normalized.includes('key file') ? '600' : '644');
    exactField = explicitPath ? `files[${explicitPath}].mode` : 'file.mode';
    brokenValue = expectedMode === '600' ? '0644' : '0666';
    healthyValue = `0${expectedMode}`;
    targetPath = explicitPath ?? '/etc/kubernetes/component-file';
    evidenceKind = 'file-metadata';
  } else if (normalized.includes('eventratelimit')) {
    exactField = 'admissionPlugins.EventRateLimit.enabled';
    brokenValue = 'false';
    healthyValue = 'true';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
    evidenceKind = 'component-arguments';
  } else if (normalized.includes('alwaysallow') || normalized.includes('abac')) {
    exactField = 'arguments.--authorization-mode';
    brokenValue = normalized.includes('abac') ? 'ABAC,RBAC' : 'Node,AlwaysAllow';
    healthyValue = 'Node,RBAC';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
    evidenceKind = 'component-arguments';
  } else if (normalized.includes('profiling')) {
    exactField = 'arguments.--profiling';
    brokenValue = 'true';
    healthyValue = 'false';
    targetPath = `/etc/kubernetes/manifests/${component}.yaml`;
    evidenceKind = 'component-arguments';
  } else if (normalized.includes('audit policy')) {
    exactField = 'auditPolicy.rules';
    brokenValue = '[]';
    healthyValue = '[{"level":"Metadata","resources":[{"group":"","resources":["pods"]}]}]';
    targetPath = '/etc/kubernetes/audit-policy.yaml';
    evidenceKind = 'audit-policy';
  } else if (normalized.includes('anonymous auth') || normalized.includes('anonymous requests')) {
    exactField = normalized.includes('requests')
      ? 'authorization.anonymous.allowed'
      : 'authentication.anonymous.enabled';
    brokenValue = 'true';
    healthyValue = 'false';
    targetPath = normalized.includes('kubelet')
      ? '/var/lib/kubelet/config.yaml'
      : '/etc/kubernetes/manifests/kube-apiserver.yaml';
    evidenceKind = normalized.includes('kubelet') ? 'kubelet-configuration' : 'component-arguments';
  } else if (normalized.includes('default service accounts')) {
    exactField = 'workload.spec.serviceAccountName';
    brokenValue = 'default';
    healthyValue = 'workload-sa';
    targetPath = '/manifests/workload.yaml';
    evidenceKind = 'workload-identity';
  } else if (normalized.includes('networkpolicies defined')) {
    exactField = 'namespace.networkPolicy.defaultDenyPresent';
    brokenValue = 'false';
    healthyValue = 'true';
    targetPath = '/manifests/namespace-networkpolicy.yaml';
    evidenceKind = 'network-policy-coverage';
  } else if (normalized.includes('garbage collection')) {
    exactField = 'arguments.--terminated-pod-gc-threshold';
    brokenValue = '0';
    healthyValue = '12500';
    targetPath = '/etc/kubernetes/manifests/kube-controller-manager.yaml';
    evidenceKind = 'component-arguments';
  } else if (normalized.includes('podsecuritypolicy')) {
    exactField = 'admissionControl.enabledPlugins';
    brokenValue = '["NamespaceLifecycle","ServiceAccount"]';
    healthyValue = '["NamespaceLifecycle","ServiceAccount","PodSecurityPolicy"]';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
    evidenceKind = 'component-arguments';
  } else if (normalized.includes('securitycontextdeny')) {
    exactField = 'admissionControl.enabledPlugins';
    brokenValue = '["NamespaceLifecycle","ServiceAccount"]';
    healthyValue = '["NamespaceLifecycle","ServiceAccount","SecurityContextDeny"]';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
    evidenceKind = 'component-arguments';
  } else if (normalized.includes('read only port')) {
    exactField = 'readOnlyPort';
    brokenValue = '10255';
    healthyValue = '0';
    targetPath = '/var/lib/kubelet/config.yaml';
    evidenceKind = 'kubelet-configuration';
  } else if (normalized.includes('validate kubelet tls')) {
    exactField = 'authentication.x509.clientCAFile';
    brokenValue = 'absent';
    healthyValue = '/etc/kubernetes/pki/ca.crt';
    targetPath = '/var/lib/kubelet/config.yaml';
    evidenceKind = 'kubelet-configuration';
  } else if (normalized.includes('cni version')) {
    exactField = 'cni.version';
    brokenValue = '0.9.1';
    healthyValue = '1.4.0';
    targetPath = '/etc/cni/net.d/10-container.conflist';
    evidenceKind = 'cluster-network-configuration';
  } else if (normalized.includes('private endpoint')) {
    exactField = 'managedCluster.apiServerAccessProfile.enablePrivateCluster';
    brokenValue = 'false';
    healthyValue = 'true';
    targetPath = '/var/lib/evals/managed-cluster.json';
    evidenceKind = 'cloud-cluster-configuration';
  } else if (normalized.includes('private nodes')) {
    exactField = 'managedCluster.privateNodes';
    brokenValue = 'false';
    healthyValue = 'true';
    targetPath = '/var/lib/evals/managed-cluster.json';
    evidenceKind = 'cloud-cluster-configuration';
  } else if (normalized.includes('aws policies')) {
    exactField = 'iam.clusterPolicies.present';
    brokenValue = 'false';
    healthyValue = 'true';
    targetPath = '/var/lib/evals/iam-policies.json';
    evidenceKind = 'cloud-iam-configuration';
  } else if (normalized.includes('cluster access manager api')) {
    exactField = 'managedCluster.accessConfig.authenticationMode';
    brokenValue = 'CONFIG_MAP';
    healthyValue = 'API';
    targetPath = '/var/lib/evals/managed-cluster.json';
    evidenceKind = 'cloud-cluster-configuration';
  } else if (normalized.includes('logging and cloud monitoring')) {
    exactField = 'observability.loggingAndMonitoring.enabled';
    brokenValue = 'false';
    healthyValue = 'true';
    targetPath = '/var/lib/evals/managed-cluster-observability.json';
    evidenceKind = 'cloud-observability-configuration';
  } else if (
    normalized.includes('authorized networks') ||
    normalized.includes('control plane endpoint')
  ) {
    exactField = 'network.authorizedNetworks.enabled';
    brokenValue = 'false';
    healthyValue = 'true';
    targetPath = '/var/lib/evals/network-access-profile.json';
    evidenceKind = 'cloud-network-configuration';
  } else if (normalized.includes('auto repair')) {
    exactField = 'nodePool.management.autoRepair';
    brokenValue = 'false';
    healthyValue = 'true';
    targetPath = '/var/lib/evals/nodepool-management.json';
    evidenceKind = 'cloud-nodepool-configuration';
  } else if (normalized.includes('auto upgrade')) {
    exactField = 'nodePool.management.autoUpgrade';
    brokenValue = 'false';
    healthyValue = 'true';
    targetPath = '/var/lib/evals/nodepool-management.json';
    evidenceKind = 'cloud-nodepool-configuration';
  } else if (
    normalized.includes('trusted container images') ||
    normalized.includes('old k8s registry')
  ) {
    exactField = 'workload.containers[0].image';
    brokenValue = normalized.includes('registry')
      ? 'k8s.gcr.io/pause:3.5'
      : 'docker.io/library/nginx:1.27';
    healthyValue =
      'registry.example.corp/workloads/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    targetPath = '/manifests/deployment-app.yaml';
    evidenceKind = 'container-image';
  } else if (normalized.includes('image signature')) {
    exactField = 'signature.verification.status';
    brokenValue = 'missing';
    healthyValue = 'verified';
    targetPath = '/var/lib/evals/image-signature-report.json';
    evidenceKind = 'image-signature-verification';
  } else if (normalized.includes('sandbox cpu limits')) {
    exactField = 'spec.containers[0].resources.limits.cpu';
    brokenValue = 'absent';
    healthyValue = '500m';
    targetPath = '/manifests/sandbox.yaml';
    evidenceKind = 'sandbox-resource-policy';
  } else if (normalized.includes('sandbox memory limits')) {
    exactField = 'spec.containers[0].resources.limits.memory';
    brokenValue = 'absent';
    healthyValue = '512Mi';
    targetPath = '/manifests/sandbox.yaml';
    evidenceKind = 'sandbox-resource-policy';
  } else if (normalized.includes('sandbox hardened runtime class')) {
    exactField = 'spec.runtimeClassName';
    brokenValue = 'runc';
    healthyValue = 'gvisor';
    targetPath = '/manifests/sandbox.yaml';
    evidenceKind = 'sandbox-runtime';
  } else if (normalized.includes('sandbox strict egress')) {
    exactField = 'sandbox.network.egressPolicy';
    brokenValue = 'AllowAll';
    healthyValue = 'DenyAll';
    targetPath = '/manifests/sandbox-networking.yaml';
    evidenceKind = 'sandbox-networking';
  } else if (normalized.includes('sandbox egress policy')) {
    exactField = 'sandbox.network.egressPolicy';
    brokenValue = 'absent';
    healthyValue = 'AllowDNSOnly';
    targetPath = '/manifests/sandbox-networking.yaml';
    evidenceKind = 'sandbox-networking';
  } else if (normalized.includes('sandbox managed networking')) {
    exactField = 'sandbox.network.managed';
    brokenValue = 'false';
    healthyValue = 'true';
    targetPath = '/manifests/sandbox-networking.yaml';
    evidenceKind = 'sandbox-networking';
  } else if (normalized.includes('sandbox claim overrides')) {
    exactField = 'spec.claimOverrides.storageClassName';
    brokenValue = 'fast-ssd';
    healthyValue = 'restricted-sandbox';
    targetPath = '/manifests/sandbox-claims.yaml';
    evidenceKind = 'sandbox-storage-claims';
  } else if (normalized.includes('pod security admission restricted')) {
    exactField = 'metadata.labels.pod-security.kubernetes.io/enforce';
    brokenValue = 'baseline';
    healthyValue = 'restricted';
    targetPath = '/manifests/namespace-security.yaml';
    evidenceKind = 'namespace-pod-security-labels';
  } else if (normalized.includes('pod security admission baseline')) {
    exactField = 'metadata.labels.pod-security.kubernetes.io/enforce';
    brokenValue = 'privileged';
    healthyValue = 'baseline';
    targetPath = '/manifests/namespace-security.yaml';
    evidenceKind = 'namespace-pod-security-labels';
  } else if (normalized.includes('pod security admission applied')) {
    exactField = 'metadata.labels.pod-security.kubernetes.io/enforce';
    brokenValue = 'absent';
    healthyValue = 'baseline';
    targetPath = '/manifests/namespace-security.yaml';
    evidenceKind = 'namespace-pod-security-labels';
  } else if (normalized.includes('hostprocess')) {
    exactField = 'spec.template.spec.securityContext.windowsOptions.hostProcess';
    brokenValue = 'true';
    healthyValue = 'false';
    targetPath = '/manifests/windows-deployment.yaml';
    evidenceKind = 'windows-security-context';
  } else if (normalized.includes('gmsacredentialspecname')) {
    exactField = 'spec.template.spec.securityContext.windowsOptions.gmsaCredentialSpecName';
    brokenValue = 'legacy-gmsa';
    healthyValue = 'absent';
    targetPath = '/manifests/windows-deployment.yaml';
    evidenceKind = 'windows-security-context';
  } else if (normalized.includes('selinuxoptions')) {
    exactField = 'spec.template.spec.containers[0].securityContext.seLinuxOptions.type';
    brokenValue = 'spc_t';
    healthyValue = 'container_t';
    targetPath = '/manifests/deployment-app.yaml';
    evidenceKind = 'container-security-context';
  } else if (normalized.includes('pull secret')) {
    exactField = 'spec.imagePullSecrets[0].name';
    brokenValue = 'missing-regcred';
    healthyValue = 'registry-creds';
    targetPath = '/manifests/deployment-app.yaml';
    evidenceKind = 'workload-image-pull-authentication';
  } else if (normalized.includes('mounted secrets')) {
    exactField = 'spec.template.spec.volumes[0].secret.secretName';
    brokenValue = 'app-secret';
    healthyValue = 'external-secret-sync';
    targetPath = '/manifests/deployment-app.yaml';
    evidenceKind = 'workload-secret-mount';
  } else if (normalized.includes('mounted configmap')) {
    exactField = 'spec.template.spec.volumes[0].configMap.name';
    brokenValue = 'live-config';
    healthyValue = 'immutable-config';
    targetPath = '/manifests/deployment-app.yaml';
    evidenceKind = 'workload-configmap-mount';
  } else if (normalized.includes('credentials configmap')) {
    exactField = 'data.api-token';
    brokenValue = 'present';
    healthyValue = 'absent';
    targetPath = '/manifests/configmap-credentials.yaml';
    evidenceKind = 'configmap-credential-storage';
  } else if (normalized.includes('can create pv')) {
    exactField = 'rules[0].resources[0]';
    brokenValue = 'persistentvolumes';
    healthyValue = 'persistentvolumeclaims';
    targetPath = '/manifests/clusterrole-storage.yaml';
    evidenceKind = 'rbac-rule';
  } else if (normalized.includes('can bind escalate')) {
    exactField = 'rules[0].verbs';
    brokenValue = '["bind","escalate"]';
    healthyValue = '["get","list"]';
    targetPath = '/manifests/clusterrole-escalation.yaml';
    evidenceKind = 'rbac-rule';
  } else if (normalized.includes('system authenticated allowed to take over cluster')) {
    exactField = 'clusterrolebinding.subjects[0].name';
    brokenValue = 'system:authenticated';
    healthyValue = 'ops-admins';
    targetPath = '/manifests/clusterrolebinding-authenticated.yaml';
    evidenceKind = 'rbac-binding';
  } else if (normalized.includes('dashboard')) {
    exactField = 'rolebinding.subjects[0].name';
    brokenValue = normalized.includes('subject') ? 'system:authenticated' : 'dashboard';
    healthyValue = 'dashboard-viewer';
    targetPath = '/manifests/dashboard-access.yaml';
    evidenceKind = 'dashboard-access';
  } else if (normalized.includes('ssh to pod')) {
    exactField = 'rules[0].verbs';
    brokenValue = '["create"]';
    healthyValue = '["get"]';
    targetPath = '/manifests/role-pod-exec.yaml';
    evidenceKind = 'rbac-rule';
  } else if (normalized.includes('delete k8s events')) {
    exactField = 'rules[0].resources[0]';
    brokenValue = 'events';
    healthyValue = 'pods';
    targetPath = '/manifests/role-events.yaml';
    evidenceKind = 'rbac-rule';
  } else if (normalized.includes('deny cronjobs')) {
    exactField = 'admissionPolicy.deniedResources[0]';
    brokenValue = 'batch/cronjobs';
    healthyValue = '[]';
    targetPath = '/manifests/admission-policy.yaml';
    evidenceKind = 'admission-policy';
  } else if (normalized.includes('hostile multitenant workloads')) {
    exactField = 'namespace.labels.tenant-isolation';
    brokenValue = 'shared';
    healthyValue = 'dedicated';
    targetPath = '/manifests/tenant-namespace.yaml';
    evidenceKind = 'tenant-isolation';
  } else if (normalized.includes('resource policies')) {
    exactField = 'spec.template.spec.containers[0].resources';
    brokenValue = '{}';
    healthyValue =
      '{"requests":{"cpu":"100m","memory":"128Mi"},"limits":{"cpu":"500m","memory":"512Mi"}}';
    targetPath = '/manifests/deployment-app.yaml';
    evidenceKind = 'workload-resource-policy';
  } else if (normalized.includes('worker pod resource ceilings')) {
    exactField = 'spec.template.spec.containers[0].resources.limits.memory';
    brokenValue = '16Gi';
    healthyValue = '1Gi';
    targetPath = '/manifests/deployment-worker.yaml';
    evidenceKind = 'workload-resource-policy';
  } else if (normalized.includes('cpu threshold')) {
    exactField = 'node.metrics.cpu.usagePercent';
    brokenValue = '96';
    healthyValue = '42';
    targetPath = '/var/lib/evals/node-metrics.json';
    evidenceKind = 'node-metrics';
  } else if (normalized.includes('memory threshold')) {
    exactField = 'node.metrics.memory.usagePercent';
    brokenValue = '97';
    healthyValue = '48';
    targetPath = '/var/lib/evals/node-metrics.json';
    evidenceKind = 'node-metrics';
  } else if (normalized.includes('no node metrics')) {
    exactField = 'node.metrics.lastCollection';
    brokenValue = 'absent';
    healthyValue = '2026-09-20T12:00:00Z';
    targetPath = '/var/lib/evals/node-metrics.json';
    evidenceKind = 'node-metrics';
  } else if (normalized.includes('unknown condition')) {
    exactField = 'node.status.conditions[Ready].status';
    brokenValue = 'Unknown';
    healthyValue = 'True';
    targetPath = '/var/lib/evals/node-status.json';
    evidenceKind = 'node-status';
  } else if (normalized.includes('scheduling disabled')) {
    exactField = 'node.spec.unschedulable';
    brokenValue = 'true';
    healthyValue = 'false';
    targetPath = '/var/lib/evals/node-spec.json';
    evidenceKind = 'node-spec';
  } else if (normalized.includes('unknown node ip')) {
    exactField = 'spec.nodeName';
    brokenValue = 'worker-missing-ip';
    healthyValue = 'worker-a';
    targetPath = '/manifests/pod-status.json';
    evidenceKind = 'pod-placement';
  } else if (normalized.includes('pod is waiting')) {
    exactField = 'pod.status.containerStatuses[0].state.waiting.reason';
    brokenValue = normalized.includes('image') ? 'ImagePullBackOff' : 'CrashLoopBackOff';
    healthyValue = 'Running';
    targetPath = '/var/lib/evals/pod-status.json';
    evidenceKind = 'pod-status';
  } else if (normalized.includes('pod is terminating')) {
    exactField = 'metadata.deletionTimestamp';
    brokenValue = '2026-09-20T12:00:00Z';
    healthyValue = 'absent';
    targetPath = '/var/lib/evals/pod-status.json';
    evidenceKind = 'pod-status';
  } else if (normalized.includes('unhappy phase')) {
    exactField = 'pod.status.phase';
    brokenValue = 'Failed';
    healthyValue = 'Running';
    targetPath = '/var/lib/evals/pod-status.json';
    evidenceKind = 'pod-status';
  } else if (normalized.includes('zero scale')) {
    exactField = 'deployment.spec.replicas';
    brokenValue = '0';
    healthyValue = '2';
    targetPath = '/manifests/deployment-app.yaml';
    evidenceKind = 'workload-scale';
  } else if (normalized.includes('s is suspended')) {
    exactField = 'cronjob.spec.suspend';
    brokenValue = 'true';
    healthyValue = 'false';
    targetPath = '/manifests/cronjob-app.yaml';
    evidenceKind = 'cronjob-status';
  } else if (normalized.includes('available')) {
    exactField = 'deployment.status.availableReplicas';
    brokenValue = '1';
    healthyValue = '3';
    targetPath = '/var/lib/evals/deployment-status.json';
    evidenceKind = 'workload-status';
  } else if (normalized.includes('over allocated')) {
    exactField = normalized.includes('memory')
      ? 'cluster.capacity.memory.requestedVsCurrent'
      : 'cluster.capacity.cpu.requestedVsCurrent';
    brokenValue = normalized.includes('memory') ? '36Gi > 24Gi' : '14 > 8';
    healthyValue = normalized.includes('memory') ? '12Gi <= 24Gi' : '4 <= 8';
    targetPath = '/var/lib/evals/cluster-capacity.json';
    evidenceKind = 'cluster-capacity';
  } else if (normalized.includes('under allocated')) {
    exactField = normalized.includes('memory')
      ? 'cluster.capacity.memory.currentVsRequested'
      : 'cluster.capacity.cpu.currentVsRequested';
    brokenValue = normalized.includes('memory') ? '4Gi << 16Gi' : '1 << 8';
    healthyValue = normalized.includes('memory') ? '14Gi ~= 16Gi' : '6 ~= 8';
    targetPath = '/var/lib/evals/cluster-capacity.json';
    evidenceKind = 'cluster-capacity';
  } else if (normalized.includes('burst')) {
    exactField = normalized.includes('memory')
      ? 'hpa.projectedBurst.memoryCapacity'
      : 'hpa.projectedBurst.cpuCapacity';
    brokenValue = normalized.includes('memory') ? '52Gi > 32Gi' : '18 > 8';
    healthyValue = normalized.includes('memory') ? '24Gi <= 32Gi' : '6 <= 8';
    targetPath = '/var/lib/evals/cluster-capacity.json';
    evidenceKind = 'autoscaling-capacity';
  } else if (normalized.includes('mutating webhooks')) {
    exactField = 'webhooks[0].name';
    brokenValue = 'mutate.example.dev';
    healthyValue = '[]';
    targetPath = '/manifests/mutatingwebhookconfiguration.yaml';
    evidenceKind = 'admission-webhooks';
  } else if (normalized.includes('validating webhooks')) {
    exactField = 'webhooks[0].name';
    brokenValue = 'validate.example.dev';
    healthyValue = '[]';
    targetPath = '/manifests/validatingwebhookconfiguration.yaml';
    evidenceKind = 'admission-webhooks';
  } else if (normalized.includes('namespace label')) {
    exactField = 'metadata.labels.pod-security.kubernetes.io/enforce';
    brokenValue = 'absent';
    healthyValue = 'baseline';
    targetPath = '/manifests/namespace-security.yaml';
    evidenceKind = 'namespace-labels';
  } else if (normalized.includes('common labels') || normalized.includes('label usage')) {
    exactField = 'metadata.labels.app.kubernetes.io/name';
    brokenValue = 'absent';
    healthyValue = 'payments-api';
    targetPath = '/manifests/deployment-app.yaml';
    evidenceKind = 'resource-labels';
  } else if (normalized.includes('unable to locate key reference')) {
    exactField = 'spec.template.spec.containers[0].env[0].valueFrom.secretKeyRef.name';
    brokenValue = 'missing-secret';
    healthyValue = 'app-secret';
    targetPath = '/manifests/deployment-app.yaml';
    evidenceKind = 'secret-key-reference';
  } else if (normalized.includes('unable to locate resource reference')) {
    exactField = 'spec.rules[0].http.paths[0].backend.service.name';
    brokenValue = 'missing-service';
    healthyValue = 'api';
    targetPath = '/manifests/ingress-app.yaml';
    evidenceKind = 'resource-reference';
  } else if (normalized.includes('cilium endpoint')) {
    exactField = 'spec.endpointSelector.matchLabels.app';
    brokenValue = 'ghost-app';
    healthyValue = 'api';
    targetPath = '/manifests/ciliumnetworkpolicy.yaml';
    evidenceKind = 'selector-mismatch';
  } else if (normalized.includes('unauthenticated service')) {
    exactField = 'service.metadata.annotations.authn-required';
    brokenValue = 'false';
    healthyValue = 'true';
    targetPath = '/manifests/service-app.yaml';
    evidenceKind = 'service-authentication';
  } else if (normalized.includes('unmanaged pod')) {
    exactField = 'metadata.ownerReferences';
    brokenValue = '[]';
    healthyValue = '[{"kind":"Deployment","name":"app"}]';
    targetPath = '/manifests/pod-app.yaml';
    evidenceKind = 'owner-reference';
  } else if (normalized.includes('jurassic cluster') || normalized.includes('k8s version ok')) {
    exactField = 'cluster.version';
    brokenValue = normalized.includes('jurassic') ? 'v1.21.0' : 'v1.23.0';
    healthyValue = 'v1.30.0';
    targetPath = '/var/lib/evals/cluster-version.json';
    evidenceKind = 'cluster-version';
  } else if (normalized.includes('pv without encryption')) {
    exactField = 'persistentVolume.spec.csi.volumeAttributes.encryption';
    brokenValue = 'false';
    healthyValue = 'true';
    targetPath = '/manifests/persistentvolume.yaml';
    evidenceKind = 'storage-encryption';
  } else if (normalized.includes('symlink exchange')) {
    exactField = 'volumeMounts[0].mountPath';
    brokenValue = '/hostpath/shared';
    healthyValue = '/workspace/data';
    targetPath = '/manifests/pod-volume-mount.yaml';
    evidenceKind = 'filesystem-exposure';
  } else if (normalized.includes('healthz endpoints are protected')) {
    exactField = 'healthEndpoints.authorization.mode';
    brokenValue = 'AlwaysAllow';
    healthyValue = 'RBAC';
    targetPath = '/etc/kubernetes/manifests/kube-controller-manager.yaml';
    evidenceKind = 'component-authorization';
  } else if (normalized.includes('references namespace which does not exist')) {
    exactField = 'object.metadata.namespace';
    brokenValue = 'missing-namespace';
    healthyValue = 'existing-namespace';
    targetPath = '/manifests/namespaced-object.yaml';
    evidenceKind = 'namespace-reference';
  } else if (normalized.includes('references s q which does not exist')) {
    exactField = 'reference.name';
    brokenValue = 'missing-object';
    healthyValue = 'existing-object';
    targetPath = '/manifests/object-reference.yaml';
    evidenceKind = 'resource-reference';
  } else if (normalized.includes('warning found')) {
    exactField = 'event.type';
    brokenValue = 'Warning';
    healthyValue = 'Normal';
    targetPath = '/var/lib/evals/events.json';
    evidenceKind = 'kubernetes-event';
  } else if (normalized.includes('encryption of data at rest')) {
    exactField = 'arguments.--encryption-provider-config';
    brokenValue = 'absent';
    healthyValue = '/etc/kubernetes/encryption-provider.yaml';
    targetPath = '/etc/kubernetes/manifests/kube-apiserver.yaml';
    evidenceKind = 'component-arguments';
  }

  return {
    component,
    exactField,
    brokenValue,
    healthyValue,
    targetPath,
    evidenceKind,
    applicability,
  };
};

const genericEvidenceFixture = (capability: Capability): Fixture => {
  const scenarioId = scenarioIdFor(capability.canonical_capability_id);
  const name = `${scenarioId.slice('rule-gap-'.length)}-fixture`;
  const resourceRef = `configmap/${name}`;
  const classification = classify(capability);
  const evidence = buildConcreteEvidence(capability);
  const observation = JSON.stringify(
    {
      component: evidence.component,
      evidenceKind: evidence.evidenceKind,
      exactField: evidence.exactField,
      brokenValue: evidence.brokenValue,
      targetPath: evidence.targetPath,
      applicability: evidence.applicability,
      predicateSummary: capability.predicate_summary,
    },
    null,
    2
  );
  const healthy = JSON.stringify(
    {
      component: evidence.component,
      evidenceKind: evidence.evidenceKind,
      exactField: evidence.exactField,
      healthyValue: evidence.healthyValue,
      targetPath: evidence.targetPath,
      applicability: evidence.applicability,
    },
    null,
    2
  );
  return {
    title: titleCase(capability.title),
    description: `${capability.predicate_summary} The fixture preserves inert, typed evidence for review without mutating a host, cloud, or runtime control-plane surface.`,
    taskPrompt: `Inspect ${resourceRef}. Explain the concrete defect represented by the fixture, cite the exact field, and do not mutate resources.`,
    visibleResourceRefs: [resourceRef],
    observationKinds: ['configmap.data', 'configuration-evidence'],
    setup: [
      inertEvidenceConfigMap(name, evidence.targetPath, evidence.applicability, {
        'evidence.json': observation,
        'healthy-control.json': healthy,
      }),
    ],
    acceptedFacts: [
      {
        fact_id: 'concrete-broken-state',
        resource_ref: resourceRef,
        field_path: `data.evidence.json#${evidence.exactField}`,
        observed_value: evidence.brokenValue,
        description: capability.predicate_summary,
      },
      {
        fact_id: 'fixture-remains-inert',
        resource_ref: resourceRef,
        field_path: 'metadata.annotations.evals.kubernetes.io/apply-to-current-host',
        observed_value: 'false',
        description:
          'The evidence is stored as inert review data and is never applied to the current environment.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'healthy-control',
        resource_ref: resourceRef,
        field_path: `data.healthy-control.json#${evidence.exactField}`,
        observed_value: evidence.healthyValue,
        description: 'The healthy control differs only in the concrete trigger state.',
      },
    ],
    ...classification,
  };
};

const buildFixture = (capability: Capability): Fixture => {
  switch (capability.canonical_capability_id) {
    case 'canonical:authentication-istio-io-v1alpha1-removed-in-v1-6-0:ea43fd0d31bf':
      return deprecatedManifestFixture(
        capability,
        {
          apiVersion: 'authentication.istio.io/v1alpha1',
          kind: 'Policy',
          metadata: { name: 'default', namespace: 'mesh-app' },
          spec: { peers: [{ mtls: {} }] },
        },
        'policy/default',
        'apiVersion',
        'authentication.istio.io/v1alpha1',
        'security.istio.io/v1beta1'
      );
    case 'canonical:flowcontrol-apiserver-k8s-io-v1beta1-flowcontrol-removed-in-v1-2:50f320e30aa2':
      return deprecatedManifestFixture(
        capability,
        {
          apiVersion: 'flowcontrol.apiserver.k8s.io/v1beta1',
          kind: 'FlowSchema',
          metadata: { name: 'legacy-flow' },
          spec: { matchingPrecedence: 1000, distinguisherMethod: { type: 'ByUser' } },
        },
        'flowschema/legacy-flow',
        'apiVersion',
        'flowcontrol.apiserver.k8s.io/v1beta1',
        'flowcontrol.apiserver.k8s.io/v1'
      );
    case 'canonical:rbac-istio-io-authorizationpolicies-removed-in-v1-4-0:8b182ca1e955':
      return deprecatedManifestFixture(
        capability,
        {
          apiVersion: 'rbac.istio.io/v1alpha1',
          kind: 'AuthorizationPolicy',
          metadata: { name: 'legacy-authz', namespace: 'mesh-app' },
          spec: { rules: [{ to: [{ operation: { methods: ['GET'] } }] }] },
        },
        'authorizationpolicy/legacy-authz',
        'apiVersion',
        'rbac.istio.io/v1alpha1',
        'security.istio.io/v1beta1'
      );
    default:
      return genericEvidenceFixture(capability);
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
  const catalog: V7ScenarioCatalogSeed = {
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

export const v7ScenarioDraftDefinitions: ScenarioDraftDefinition[] = records.map(
  record => record.definition
);

export const v7ScenarioCatalogSeeds: V7ScenarioCatalogSeed[] = records.map(
  record => record.catalog
);
