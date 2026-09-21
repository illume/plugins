import assert from 'node:assert/strict';
import type { ClusterProfileName, RequiredMechanism } from '../contracts/evaluationContracts.js';
import { createRequire } from 'node:module';
import type { DraftFact, ScenarioDraftDefinition } from './scenarioDraftDefinition.js';

export type V8Category = 'control_plane_host_hardening';
export type V8Feasibility = 'host' | 'cloud';
export type V8SelectionTrack = 'policy' | 'operations';

interface Capability {
  canonical_capability_id: string;
  title: string;
  predicate_summary: string;
  source_rule_ids: string[];
  source_semantic_group_ids: string[];
  source_tool_ids: string[];
}

interface InventoryRule {
  rule_id: string;
  source_path: string;
}

export interface V8ScenarioCatalogSeed {
  scenarioId: string;
  title: string;
  trigger: string;
  healthy: string;
  resources: string[];
  targetRuleIds: string[];
  targetSemanticGroupIds: string[];
  targetCanonicalCapabilityIds: string[];
  selectionTrack: V8SelectionTrack;
  category: V8Category;
  feasibility: V8Feasibility;
  requiredMechanisms: RequiredMechanism[];
  supportedClusterProfiles: ClusterProfileName[];
}

export interface VersionedRuleGapScenarioCatalogSeed {
  scenarioId: string;
  title: string;
  trigger: string;
  healthy: string;
  resources: string[];
  targetRuleIds: string[];
  targetSemanticGroupIds: string[];
  targetCanonicalCapabilityIds: string[];
  selectionTrack: V8SelectionTrack;
  category: V8Category;
  feasibility: V8Feasibility;
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
  category: V8Category;
  feasibility: V8Feasibility;
  track: V8SelectionTrack;
  mechanisms: RequiredMechanism[];
  profiles: ClusterProfileName[];
}

interface ConcreteEvidence {
  component: string;
  evidenceKind: string;
  exactField: string;
  brokenValue: string;
  healthyValue: string;
  targetPath: string;
  applicability: string;
}

const moduleRequire = createRequire(import.meta.url);
const registry = moduleRequire('../../registrations/canonical-capability-registry-v1.json') as {
  capabilities: Capability[];
};
const inventory = moduleRequire('../../registrations/tool-rule-inventory-v1.json') as {
  tools: Array<{ rules: InventoryRule[] }>;
};
const sourcePathByRuleId = new Map(
  inventory.tools.flatMap(tool => tool.rules.map(rule => [rule.rule_id, rule.source_path] as const))
);

export const capabilityById = new Map(
  registry.capabilities.map(capability => [capability.canonical_capability_id, capability] as const)
);

const hostProfiles: ClusterProfileName[] = ['local-minikube', 'aks'];

const selectedCapabilityIds = [
  'canonical:ensure-that-a-minimal-audit-policy-is-created-not-scored:1b6fb9928427',
  'canonical:adjust-the-streaming-connection-idle-timeout-argument:98d0c736cbe0',
  'canonical:adjust-the-terminated-pod-gc-threshold-argument-as-needed:fdb1b6babd9f',
  'canonical:the-kubernetes-admin-conf-must-have-file-permissions-set-to-644-:8d695c902b0d',
  'canonical:ensure-anonymous-auth-is-not-disabled:22807e48b74f',
  'canonical:the-kubernetes-api-server-must-have-an-audit-policy-set-componen:3ec072570429',
  'canonical:the-kubernetes-api-server-must-have-file-permissions-set-to-644-:f79841626d2c',
  'canonical:the-kubernetes-api-server-must-prohibit-communication-using-tls-:f65d89d4e866',
  'canonical:the-kubernetes-api-server-must-use-tls-1-2-at-a-minimum-componen:0f0225d09538',
  'canonical:verify-that-authorization-mode-is-not-set-to-alwaysallow:671508b125da',
  'canonical:the-kubernetes-controller-manager-must-use-tls-1-2-at-a-minimum-:8ec6c6d1b4bc',
  'canonical:verify-that-controller-profiling-is-not-exposed-to-the-web:311dd62ac834',
  'canonical:do-not-expose-api-server-profiling-data:0ae1344a3f6c',
  'canonical:the-kubernetes-etcd-must-have-file-permissions-set-to-644-or-mor:87329b3386bd',
  'canonical:the-kubernetes-etcd-must-use-tls-to-protect-the-confidentiality-:5f0f03bd5309',
  'canonical:verify-that-if-defined-the-read-only-port-argument-is-set-to-0-m:e6406846892e',
  'canonical:if-proxy-kube-proxy-configuration-file-exists-ensure-permissions:c6080a96f77b',
  'canonical:if-proxy-kubeconfig-file-exists-ensure-permissions-are-set-to-64:aba311c95690',
  'canonical:if-proxy-kubeproxy-kubeconfig-file-exists-ensure-permissions-are:4632923b9cc7',
  'canonical:if-the-kubelet-config-yaml-configuration-file-is-being-used-vali:cc4544ef7272',
  'canonical:the-kubernetes-kube-proxy-must-have-file-permissions-set-to-644-:425f45272bce',
  'canonical:the-kubernetes-kubeadm-conf-must-have-file-permissions-set-to-64:9c49fd0903e4',
  'canonical:the-kubernetes-kubelet-certificate-authority-file-must-have-file:a047d76005e2',
  'canonical:the-kubernetes-kubelet-config-must-have-file-permissions-set-to-:c1ae71a0a7e7',
  'canonical:the-kubernetes-kubelet-configuration-file-must-be-owned-by-root-:379c02a48740',
  'canonical:the-kubernetes-kubelet-configuration-files-must-have-file-permis:a1558b7ceb08',
  'canonical:kubernetes-controller-manager-must-disable-profiling-component-o:20f102fc7c9d',
  'canonical:kubernetes-etcd-must-have-a-peer-key-file-set-for-secure-communi:74fe8387705b',
  'canonical:kubernetes-etcd-must-have-peer-cert-file-set-for-secure-communic:23b435adbf12',
  'canonical:kubernetes-kubelet-must-enable-tls-cert-file-for-client-authenti:3ec2ec349dc1',
  'canonical:limit-use-of-the-bind-impersonate-and-escalate-permissions-in-th:91751ba76781',
  'canonical:ensure-that-the-kubernetes-pki-certificate-file-permissions-are-:480d0448a82d',
  'canonical:the-kubernetes-pki-crt-must-have-file-permissions-set-to-644-or-:6728807fa53d',
  'canonical:the-kubernetes-pki-keys-must-have-file-permissions-set-to-600-or:fd7b880a0e79',
  'canonical:the-kubernetes-scheduler-must-use-tls-1-2-at-a-minimum-component:7deddc7c4968',
  'canonical:verify-that-scheduler-profiling-is-not-exposed-to-the-web:853f069d95ad',
  'canonical:set-the-event-qps-argument-to-0:e0411d8b1b72',
  'canonical:ensure-that-the-admin-conf-file-permissions-are-set-to-644-or-mo:1754dec15d13',
  'canonical:ensure-that-the-admission-control-plugin-podsecuritypolicy-is-se:7260845b9ea8',
  'canonical:ensure-that-the-admission-control-plugin-securitycontextconstrai:0cba0bcc65d8',
  'canonical:ensure-that-the-admission-control-plugin-securitycontextdeny-is-:fb64a1c6f1bb',
  'canonical:ensure-that-the-api-server-pod-specification-file-permissions-ar:09b5444dd760',
  'canonical:ensure-that-the-audit-log-maxage-argument-is-set-to-30-or-as-app:e4018b597bac',
  'canonical:ensure-that-the-audit-log-maxbackup-argument-is-set-to-10-or-as-:e07841787d3d',
  'canonical:ensure-that-the-audit-log-path-argument-is-set-as-appropriate:231c10f4f13a',
  'canonical:ensure-that-the-audit-log-path-argument-is-set-not-scored:5c8b32ad8f66',
  'canonical:ensure-that-the-audit-policy-covers-key-security-concerns:8c1f33e935b1',
  'canonical:ensure-that-the-authorization-mode-argument-includes-node-not-sc:3ccc00de8053',
  'canonical:ensure-that-the-authorization-mode-argument-includes-rbac-not-sc:e53fa1f33dfb',
  'canonical:verify-that-the-authorization-mode-argument-is-not-set:57dddd22e00f',
  'canonical:ensure-that-the-authorization-mode-argument-is-not-set-to-always:d5355e135a84',
  'canonical:verify-that-the-authorization-mode-argument-is-set-to-webhook:3a913aa2743a',
  'canonical:ensure-that-the-auto-tls-argument-is-not-set-to-true:5725619b5b2b',
  'canonical:ensure-that-the-azure-json-file-has-permissions-set-to-644-or-mo:510e5d046daf',
  'canonical:ensure-that-the-azure-json-file-ownership-is-set-to-root-root-au:b68a06a40860',
  'canonical:ensure-that-the-basic-auth-file-argument-is-not-set:064afd7f537c',
  'canonical:verify-that-the-basic-auth-file-method-is-not-enabled:29152f8f7f6a',
  'canonical:ensure-that-the-bind-address-argument-is-set-to-127-0-0-1:699d7ba2e337',
  'canonical:ensure-that-the-cert-file-and-key-file-arguments-are-set-as-appr:d361a0b3f218',
  'canonical:ensure-that-the-cert-file-and-key-file-arguments-are-set-as-appr:4c0a330f6188',
  'canonical:ensure-that-the-certificate-authorities-file-permissions-are-set:b1ebb867c30e',
  'canonical:verify-that-the-client-ca-file-argument-is-not-set:3701fdf75230',
  'canonical:ensure-that-the-client-ca-file-argument-is-set-as-appropriate:1b4c2aacecfa',
  'canonical:ensure-that-the-cloud-controller-kubeconfig-file-permissions-are:166a3198ad41',
  'canonical:ensure-that-the-container-network-interface-file-permissions-are:349a05ce68e4',
  'canonical:ensure-that-the-controller-manager-conf-file-permissions-are-set:7b90f6d6f64a',
  'canonical:ensure-that-the-controller-manager-configuration-file-ownership-:e0a8a0d81ed7',
  'canonical:ensure-that-the-controller-manager-configuration-file-permission:0c286f72948f',
  'canonical:ensure-that-the-controller-manager-kubeconfig-file-ownership-is-:51551c88885d',
  'canonical:ensure-that-the-controller-manager-kubeconfig-file-permissions-a:3295080904d8',
  'canonical:ensure-that-the-controller-manager-pod-specification-file-permis:107e1e15c999',
  'canonical:ensure-that-the-controllermanagerkubeconfig-file-ownership-is-se:2e569fa82aa1',
  'canonical:ensure-that-the-default-administrative-credential-file-ownership:fa134065fa65',
  'canonical:ensure-that-the-default-administrative-credential-file-permissio:1611671e4c66',
  'canonical:ensure-that-the-etcd-data-directory-ownership-is-set-to-etcd-etc:667d6ab81041',
  'canonical:ensure-that-the-etcd-data-directory-ownership-is-set-to-root-roo:aabdddc6385e',
  'canonical:ensure-that-the-etcd-data-directory-permissions-are-set-to-700-o:f23d02f90207',
  'canonical:ensure-that-the-etcd-pod-specification-file-permissions-are-set-:081138dd65dd',
  'canonical:ensure-that-the-etcd-service-file-ownership-is-set-to-root-root-:2604e0a05394',
  'canonical:ensure-that-the-etcd-service-file-permissions-are-set-to-644-or-:3c405e49b16d',
  'canonical:ensure-that-the-insecure-bind-address-argument-is-not-set:953dd52f95df',
  'canonical:ensure-that-the-insecure-port-argument-is-set-to-0:bf2465460cbc',
  'canonical:ensure-that-the-kubeconfig-file-ownership-is-set-to-root-root-ma:26a3716a222e',
  'canonical:ensure-that-the-kubeconfig-file-permissions-are-set-to-600-or-mo:a5d6d40c9634',
  'canonical:ensure-that-the-kubeconfig-kubelet-conf-file-permissions-are-set:5fe2b75cf084',
  'canonical:ensure-that-the-kubelet-conf-file-ownership-is-set-to-root-root:4439d761041d',
  'canonical:ensure-that-the-kubelet-conf-file-permissions-are-set-to-644-or-:c34500b58fc3',
  'canonical:ensure-that-the-kubelet-config-configuration-file-has-permission:60c1636f2a82',
  'canonical:ensure-that-the-kubelet-config-configuration-file-has-permission:15c107a34e63',
  'canonical:ensure-that-the-kubelet-config-configuration-file-ownership-is-s:6b73c0c0f400',
  'canonical:ensure-that-the-kubelet-configuration-file-has-permissions-set-t:262e1298458b',
  'canonical:ensure-that-the-kubelet-configuration-file-has-permissions-set-t:dd1774a17d8e',
  'canonical:ensure-that-the-kubelet-configuration-file-has-permissions-set-t:620125ce8c9d',
  'canonical:ensure-that-the-kubelet-configuration-file-permissions-are-set-t:ca23d16a7573',
  'canonical:ensure-that-the-kubelet-kubeconfig-file-ownership-is-set-to-root:22de462c07f5',
  'canonical:ensure-that-the-kubelet-service-file-permissions-are-set-to-644-:82a9cc44f93b',
  'canonical:ensure-that-the-maximumfilesizemegabytes-argument-is-set-to-100-:1c7d1e32a5c6',
  'canonical:ensure-that-the-maximumfilesizemegabytes-argument-is-set-to-100-:31875cd7d64b',
  'canonical:ensure-that-the-maximumretainedfiles-argument-is-set-to-10-or-as:21ea197411b0',
  'canonical:ensure-that-the-openshift-pki-certificate-file-permissions-are-s:341273f7ef2b',
  'canonical:ensure-that-the-openshift-pki-certificate-file-permissions-are-s:38d2eef6008a',
  'canonical:ensure-that-the-openshift-pki-directory-and-file-ownership-is-se:4c3dba998c80',
  'canonical:ensure-that-the-openshift-pki-key-file-permissions-are-set-to-60:d8a51fc88b15',
  'canonical:ensure-that-the-peer-auto-tls-argument-is-not-set-to-true:e331cc522ff6',
  'canonical:ensure-that-the-peer-cert-file-and-peer-key-file-arguments-are-s:3092ab88fa52',
  'canonical:ensure-that-the-profiling-argument-is-set-to-false-not-scored:5c0b0b21b400',
  'canonical:ensure-that-the-protect-kernel-defaults-argument-is-not-set-manu:a965e14807ed',
  'canonical:ensure-that-the-proxy-kubeconfig-file-ownership-is-set-to-root-r:57d412a7d9ca',
  'canonical:ensure-that-the-proxy-kubeconfig-file-permissions-are-set-to-644:5c355c0fa2c4',
  'canonical:ensure-that-the-read-only-port-argument-is-disabled-automated:27e083d37de6',
  'canonical:verify-that-the-read-only-port-argument-is-set-to-0-manual:03d1985e9245',
  'canonical:ensure-that-the-read-only-port-is-disabled-manual:80fe11687810',
  'canonical:ensure-that-the-read-only-port-is-secured-automated:29d978d5e822',
  'canonical:ensure-that-the-request-timeout-argument-is-set-manual:a18791e1c597',
  'canonical:ensure-that-the-root-ca-file-argument-is-set-as-appropriate:675f0201c1ea',
  'canonical:ensure-that-the-rotate-certificates-argument-is-not-present-or-i:20907180d596',
  'canonical:verify-that-the-rotatekubeletservercertificate-argument-is-set-t:7d11a378e11c',
] as const;

assert.equal(selectedCapabilityIds.length, 117, 'expected exactly 117 v8 capabilities');
assert.equal(new Set(selectedCapabilityIds).size, 117, 'v8 capabilities must be unique');

const scenarioIdFor = (batchLabel: string, capabilityId: string): string => {
  const [, stem, digest] = capabilityId.split(':');
  if (!stem || !digest) {
    throw new Error(`invalid canonical capability id ${capabilityId}`);
  }
  return `rule-gap-${batchLabel}-${stem}-${digest.slice(0, 8)}`;
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

const classify = (
  capability: Capability
): Pick<Fixture, 'category' | 'feasibility' | 'track' | 'mechanisms' | 'profiles'> => {
  const managedService = capability.source_rule_ids.some(ruleId =>
    sourcePathByRuleId.get(ruleId)?.endsWith('/managedservices.yaml')
  );
  return {
    category: 'control_plane_host_hardening',
    feasibility: managedService ? 'cloud' : 'host',
    track: managedService ? 'operations' : 'policy',
    mechanisms: ['api-server'],
    profiles: managedService ? ['aks'] : hostProfiles,
  };
};

const explicitFilePath = (capability: Capability, fallback: string): string => {
  const normalized = `${capability.title} ${capability.predicate_summary}`.toLowerCase();
  if (normalized.includes('admin.conf')) return '/etc/kubernetes/admin.conf';
  if (normalized.includes('scheduler.conf')) return '/etc/kubernetes/scheduler.conf';
  if (normalized.includes('scheduler configuration file')) return '/etc/kubernetes/scheduler.conf';
  if (normalized.includes('controller-manager.conf'))
    return '/etc/kubernetes/controller-manager.conf';
  if (normalized.includes('cloud-controller.kubeconfig'))
    return '/etc/kubernetes/cloud-controller.kubeconfig';
  if (normalized.includes('scheduler kubeconfig') || normalized.includes('scheduler.kubeconfig')) {
    return '/etc/kubernetes/scheduler.kubeconfig';
  }
  if (
    normalized.includes('controller-manager kubeconfig') ||
    normalized.includes('$controllermanagerkubeconfig')
  ) {
    return '/etc/kubernetes/controller-manager.kubeconfig';
  }
  if (normalized.includes('proxy kubeconfig')) return '/var/lib/kube-proxy/kubeconfig';
  if (normalized.includes('kube-proxy configuration file'))
    return '/var/lib/kube-proxy/config.conf';
  if (normalized.includes('kubelet.conf')) return '/etc/kubernetes/kubelet.conf';
  if (
    normalized.includes('kubelet --config') ||
    normalized.includes('kubelet configuration file') ||
    normalized.includes('config.yaml configuration file')
  ) {
    return '/var/lib/kubelet/config.yaml';
  }
  if (normalized.includes('kubelet kubeconfig')) return '/var/lib/kubelet/kubeconfig';
  if (normalized.includes('kubelet service file'))
    return '/etc/systemd/system/kubelet.service.d/10-kubeadm.conf';
  if (normalized.includes('kubeadm.conf')) return '/etc/kubernetes/kubeadm.conf';
  if (normalized.includes('kubelet certificate authority')) return '/etc/kubernetes/pki/ca.crt';
  if (normalized.includes('kubelet config must be owned')) return '/var/lib/kubelet/config.yaml';
  if (normalized.includes('kube proxy must be owned')) return '/var/lib/kube-proxy/kubeconfig';
  if (normalized.includes('component manifests') || normalized.includes('kubernetes manifests'))
    return '/etc/kubernetes/manifests';
  if (normalized.includes('component pki')) return '/etc/kubernetes/pki';
  if (normalized.includes('kubernetes conf files')) return '/etc/kubernetes/*.conf';
  if (normalized.includes('kubeconfig file ownership')) return '/var/lib/kubelet/kubeconfig';
  if (normalized.includes('azure.json')) return '/etc/kubernetes/azure.json';
  if (normalized.includes('container network interface file'))
    return '/etc/cni/net.d/10-container.conflist';
  if (normalized.includes('certificate authorities file')) return '/etc/kubernetes/pki/ca.crt';
  if (normalized.includes('default administrative credential file'))
    return '/etc/kubernetes/openshift-master/admin.kubeconfig';
  if (normalized.includes('openshift admin.conf')) return '/etc/origin/master/admin.kubeconfig';
  if (normalized.includes('service file') && normalized.includes('etcd'))
    return '/etc/systemd/system/etcd.service';
  if (normalized.includes('data directory')) return '/var/lib/etcd';
  if (normalized.includes('pki certificate file') || normalized.includes('pki crt'))
    return '/etc/kubernetes/pki/apiserver.crt';
  if (normalized.includes('pki key file') || normalized.includes('pki keys'))
    return '/etc/kubernetes/pki/apiserver.key';
  if (normalized.includes('api server pod specification file'))
    return '/etc/kubernetes/manifests/kube-apiserver.yaml';
  if (normalized.includes('controller manager pod specification file'))
    return '/etc/kubernetes/manifests/kube-controller-manager.yaml';
  if (normalized.includes('etcd pod specification file'))
    return '/etc/kubernetes/manifests/etcd.yaml';
  if (normalized.includes('scheduler pod specification file'))
    return '/etc/kubernetes/manifests/kube-scheduler.yaml';
  return fallback;
};

const componentFrom = (capability: Capability): string => {
  const normalized = `${capability.title} ${capability.predicate_summary}`.toLowerCase();
  if (capability.source_rule_ids.some(ruleId => /-etcd-/.test(ruleId))) return 'etcd';
  if (normalized.includes('rbac')) return 'rbac';
  if (normalized.includes('controller manager')) return 'kube-controller-manager';
  if (normalized.includes('scheduler')) return 'kube-scheduler';
  if (normalized.includes('etcd')) return 'etcd';
  if (normalized.includes('kubelet')) return 'kubelet';
  if (normalized.includes('kube-proxy') || normalized.includes('proxy ')) return 'kube-proxy';
  if (normalized.includes('api server')) return 'kube-apiserver';
  if (normalized.includes('gke')) return 'gke-cluster';
  if (normalized.includes('eks')) return 'eks-cluster';
  if (normalized.includes('azure') || normalized.includes('aks')) return 'aks-cluster';
  return 'kube-apiserver';
};

const assertConcreteEvidence = (
  capability: Capability,
  evidence: ConcreteEvidence
): ConcreteEvidence => {
  const forbidden = new Set(['status.condition', 'misconfigured', 'configured']);
  assert.equal(forbidden.has(evidence.exactField), false, capability.canonical_capability_id);
  assert.equal(forbidden.has(evidence.brokenValue), false, capability.canonical_capability_id);
  assert.equal(forbidden.has(evidence.healthyValue), false, capability.canonical_capability_id);
  assert.notEqual(evidence.brokenValue, evidence.healthyValue, capability.canonical_capability_id);
  return evidence;
};

export const buildConcreteEvidence = (capability: Capability): ConcreteEvidence => {
  const normalized = `${capability.title} ${capability.predicate_summary}`
    .toLowerCase()
    .replace(/[^a-z0-9/.:_$-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const component = componentFrom(capability);

  let evidence: ConcreteEvidence;

  if (normalized.includes('bind impersonate and escalate')) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-rule',
      exactField: 'rules[0].verbs',
      brokenValue: '["bind","impersonate","escalate"]',
      healthyValue: '["get","list"]',
      targetPath: '/manifests/clusterrole-escalation.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('system:anonymous')) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-binding',
      exactField: 'subjects[0].name',
      brokenValue: 'system:anonymous',
      healthyValue: 'system:serviceaccounts',
      targetPath: '/manifests/clusterrolebinding-subject.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('system:unauthenticated')) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-binding',
      exactField: 'subjects[0].name',
      brokenValue: 'system:unauthenticated',
      healthyValue: 'system:serviceaccounts',
      targetPath: '/manifests/clusterrolebinding-subject.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('system:authenticated')) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-binding',
      exactField: 'subjects[0].name',
      brokenValue: 'system:authenticated',
      healthyValue: 'system:serviceaccounts',
      targetPath: '/manifests/clusterrolebinding-subject.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('system:masters')) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-binding',
      exactField: 'subjects[0].name',
      brokenValue: 'system:masters',
      healthyValue: 'platform-admins',
      targetPath: '/manifests/clusterrolebinding-subject.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('ownership') || normalized.includes('owned by root')) {
    const targetPath = explicitFilePath(capability, '/etc/kubernetes/component-file');
    const expectsEtcdOwner =
      normalized.includes('must be owned by etcd') ||
      (normalized.includes('etcd') && normalized.includes('data directory ownership'));
    evidence = {
      component,
      evidenceKind: 'file-metadata',
      exactField: `files[${targetPath}].owner`,
      brokenValue: expectsEtcdOwner ? 'root:root' : 'nobody:nogroup',
      healthyValue: expectsEtcdOwner ? 'etcd:etcd' : 'root:root',
      targetPath,
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('must be owned by etcd')) {
    evidence = {
      component: 'etcd',
      evidenceKind: 'file-metadata',
      exactField: 'files[/var/lib/etcd].owner',
      brokenValue: 'root:root',
      healthyValue: 'etcd:etcd',
      targetPath: '/var/lib/etcd',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('permissions') || normalized.includes('file permissions set')) {
    const targetPath = explicitFilePath(capability, '/etc/kubernetes/component-file');
    const expectedMode =
      normalized.match(/set to\s*(\d{3})/)?.[1] ??
      (normalized.includes('key') ? '600' : normalized.includes('data directory') ? '700' : '644');
    evidence = {
      component,
      evidenceKind: 'file-metadata',
      exactField: `files[${targetPath}].mode`,
      brokenValue: expectedMode === '600' ? '0644' : expectedMode === '700' ? '0755' : '0666',
      healthyValue: `0${expectedMode}`,
      targetPath,
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('audit policy')) {
    evidence = {
      component,
      evidenceKind: 'audit-policy',
      exactField: 'auditPolicy.rules',
      brokenValue: '[]',
      healthyValue:
        '[{"level":"Metadata","resources":[{"group":"","resources":["pods","secrets"]}]}]',
      targetPath: '/etc/kubernetes/audit-policy.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('audit logs are forwarded off the cluster') ||
    normalized.includes('audit logs are collected and managed')
  ) {
    evidence = {
      component: 'audit-pipeline',
      evidenceKind: 'managed-cluster-config',
      exactField: 'auditLogExport.destination',
      brokenValue: 'absent',
      healthyValue: 'gs://central-audit-bucket',
      targetPath: '/managed-cluster/audit-log-export.json',
      applicability: 'managed-cluster-review',
    };
  } else if (
    normalized.includes('cluster auditing is enabled') ||
    normalized.includes('enable audit logs') ||
    normalized.includes('must generate audit records') ||
    normalized.includes('audit logs must be enabled')
  ) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--audit-log-path',
      brokenValue: 'absent',
      healthyValue: '/var/log/kubernetes/audit.log',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('audit-log-maxage')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--audit-log-maxage',
      brokenValue: '0',
      healthyValue: '30',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('advanced auditing')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'audit-policy',
      exactField: 'auditPolicy.rules',
      brokenValue: '[]',
      healthyValue:
        '[{"level":"RequestResponse","resources":[{"group":"","resources":["pods","secrets"]}]}]',
      targetPath: '/etc/kubernetes/audit-policy.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('audit log retention')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--audit-log-maxage',
      brokenValue: '0',
      healthyValue: '30',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('audit log backup retention') ||
    normalized.includes('audit log maximum backup')
  ) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--audit-log-maxbackup',
      brokenValue: '0',
      healthyValue: '10',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('audit log file size') ||
    normalized.includes('maximum audit log size') ||
    normalized.includes('set to audit log max size')
  ) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--audit-log-maxsize',
      brokenValue: '0',
      healthyValue: '100',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('audit-log-maxbackup')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--audit-log-maxbackup',
      brokenValue: '0',
      healthyValue: '10',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('maximumfilesizemegabytes') ||
    normalized.includes('audit-log-maxsize')
  ) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: normalized.includes('maximumfilesizemegabytes')
        ? 'arguments.maximumFileSizeMegabytes'
        : 'arguments.--audit-log-maxsize',
      brokenValue: '0',
      healthyValue: '100',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('maximumretainedfiles')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.maximumRetainedFiles',
      brokenValue: '0',
      healthyValue: '10',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('audit-log-path')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--audit-log-path',
      brokenValue: 'absent',
      healthyValue: '/var/log/kubernetes/audit.log',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('authorization-mode') && normalized.includes('alwaysallow')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--authorization-mode',
      brokenValue: 'Node,AlwaysAllow',
      healthyValue: 'Node,RBAC',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('authorization-mode') && normalized.includes('includes node')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--authorization-mode',
      brokenValue: 'RBAC',
      healthyValue: 'Node,RBAC',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('authorization-mode') && normalized.includes('includes rbac')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--authorization-mode',
      brokenValue: 'Node',
      healthyValue: 'Node,RBAC',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('authorization-mode') && normalized.includes('webhook')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'authorization.mode',
      brokenValue: 'AlwaysAllow',
      healthyValue: 'Webhook',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('node,rbac') ||
    normalized.includes('rbac is enabled') ||
    normalized.includes('enable node rbac as the authorization')
  ) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--authorization-mode',
      brokenValue: normalized.includes('rbac is enabled') ? 'Node,AlwaysAllow' : 'RBAC',
      healthyValue: 'Node,RBAC',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('explicit authorization')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'authorization.mode',
      brokenValue: 'AlwaysAllow',
      healthyValue: 'Webhook',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('node authorizer')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--authorization-mode',
      brokenValue: 'RBAC',
      healthyValue: 'Node,RBAC',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('authorization-mode') && normalized.includes('not set')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--authorization-mode',
      brokenValue: 'RBAC',
      healthyValue: 'absent',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('authorization-mode')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--authorization-mode',
      brokenValue: 'absent',
      healthyValue: 'Node,RBAC',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    (normalized.includes('anonymous auth') || normalized.includes('anonymous-auth')) &&
    normalized.includes('not disabled')
  ) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'authentication.anonymous.enabled',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'openshift',
    };
  } else if (normalized.includes('anonymous auth') || normalized.includes('anonymous-auth')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'authentication.anonymous.enabled',
      brokenValue: 'true',
      healthyValue: 'false',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('basic-auth-file')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--basic-auth-file',
      brokenValue: '/etc/kubernetes/basic-auth.csv',
      healthyValue: 'absent',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('basic authentication using static passwords') ||
    normalized.includes('disable basic authentication')
  ) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--basic-auth-file',
      brokenValue: '/etc/kubernetes/basic-auth.csv',
      healthyValue: 'absent',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('token-auth-file') ||
    normalized.includes('token authentication') ||
    normalized.includes('disable token authentication')
  ) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--token-auth-file',
      brokenValue: '/etc/kubernetes/token.csv',
      healthyValue: 'absent',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('client certificate authentication should not be used') ||
    normalized.includes('authentication using client certificates is disabled') ||
    normalized.includes('revoke client certificate')
  ) {
    evidence = {
      component: 'identity',
      evidenceKind: 'identity-policy',
      exactField: 'users[0].authMethod',
      brokenValue: 'x509-client-certificate',
      healthyValue: 'oidc',
      targetPath: '/identity/access-policy.json',
      applicability: 'identity-review-only',
    };
  } else if (
    normalized.includes('bootstrap token authentication should not be used') ||
    normalized.includes('insecure tokens')
  ) {
    evidence = {
      component: 'identity',
      evidenceKind: 'identity-policy',
      exactField: 'users[0].authMethod',
      brokenValue: 'bootstrap-token',
      healthyValue: 'oidc',
      targetPath: '/identity/access-policy.json',
      applicability: 'identity-review-only',
    };
  } else if (normalized.includes('service account token authentication should not be used')) {
    evidence = {
      component: 'identity',
      evidenceKind: 'identity-policy',
      exactField: 'users[0].authMethod',
      brokenValue: 'service-account-token',
      healthyValue: 'oidc',
      targetPath: '/identity/access-policy.json',
      applicability: 'identity-review-only',
    };
  } else if (
    (normalized.includes('client-ca-file') || normalized.includes('client ca file')) &&
    normalized.includes('not set')
  ) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--client-ca-file',
      brokenValue: '/etc/kubernetes/pki/ca.crt',
      healthyValue: 'absent',
      targetPath:
        component === 'kubelet'
          ? '/var/lib/kubelet/config.yaml'
          : '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('client-ca-file') ||
    normalized.includes('client ca file') ||
    normalized.includes('client ca file is configured')
  ) {
    evidence = {
      component,
      evidenceKind: component === 'kubelet' ? 'kubelet-configuration' : 'component-arguments',
      exactField:
        component === 'kubelet' ? 'authentication.x509.clientCAFile' : 'arguments.--client-ca-file',
      brokenValue: 'absent',
      healthyValue: '/etc/kubernetes/pki/ca.crt',
      targetPath:
        component === 'kubelet'
          ? '/var/lib/kubelet/config.yaml'
          : '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('client-cert-auth') ||
    normalized.includes('client cert auth') ||
    normalized.includes('client authentication to secure service')
  ) {
    evidence = {
      component: 'etcd',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--client-cert-auth',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/etc/kubernetes/manifests/etcd.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('root-ca-file') || normalized.includes('root ca file')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--root-ca-file',
      brokenValue: 'absent',
      healthyValue: '/etc/kubernetes/pki/ca.crt',
      targetPath: '/etc/kubernetes/manifests/kube-controller-manager.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('service-account-lookup')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--service-account-lookup',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('service account lookup flag is not set')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--service-account-lookup',
      brokenValue: 'true',
      healthyValue: 'absent',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('service account key file argument is not set')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--service-account-key-file',
      brokenValue: '/etc/kubernetes/pki/sa.pub',
      healthyValue: 'absent',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('eventratelimit')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'admissionPlugins.EventRateLimit.enabled',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('podsecuritypolicy')) {
    const expectsDisabled = normalized.includes('podsecuritypolicy is disabled');
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'admissionControl.enabledPlugins',
      brokenValue: expectsDisabled
        ? '["NamespaceLifecycle","ServiceAccount","PodSecurityPolicy"]'
        : '["NamespaceLifecycle","ServiceAccount"]',
      healthyValue: expectsDisabled
        ? '["NamespaceLifecycle","ServiceAccount"]'
        : '["NamespaceLifecycle","ServiceAccount","PodSecurityPolicy"]',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('securitycontextconstraint')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'admissionControl.enabledPlugins',
      brokenValue: '["NamespaceLifecycle","ServiceAccount"]',
      healthyValue: '["NamespaceLifecycle","ServiceAccount","SecurityContextConstraint"]',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('securitycontextdeny')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'admissionControl.enabledPlugins',
      brokenValue: '["NamespaceLifecycle","ServiceAccount","SecurityContextDeny"]',
      healthyValue: '["NamespaceLifecycle","ServiceAccount"]',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('alwayspullimages')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'admissionControl.enabledPlugins',
      brokenValue: '["NamespaceLifecycle","ServiceAccount"]',
      healthyValue: '["NamespaceLifecycle","ServiceAccount","AlwaysPullImages"]',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('namespacelifecycle')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'admissionControl.enabledPlugins',
      brokenValue: '["ServiceAccount"]',
      healthyValue: '["NamespaceLifecycle","ServiceAccount"]',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('alwaysadmit')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'admissionControl.enabledPlugins',
      brokenValue: '["AlwaysAdmit","NamespaceLifecycle"]',
      healthyValue: '["NamespaceLifecycle","ServiceAccount"]',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('serviceaccount admission controller')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'admissionControl.enabledPlugins',
      brokenValue: '["NamespaceLifecycle"]',
      healthyValue: '["NamespaceLifecycle","ServiceAccount"]',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('imagepolicywebhook')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'admissionControl.enabledPlugins',
      brokenValue: '["NamespaceLifecycle","ServiceAccount"]',
      healthyValue: '["NamespaceLifecycle","ServiceAccount","ImagePolicyWebhook"]',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('noderestriction admission controller')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'admissionControl.enabledPlugins',
      brokenValue: '["NamespaceLifecycle","ServiceAccount"]',
      healthyValue: '["NamespaceLifecycle","ServiceAccount","NodeRestriction"]',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('validatingadmissionwebhook')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'admissionControl.enabledPlugins',
      brokenValue: '["NamespaceLifecycle","ServiceAccount"]',
      healthyValue: '["NamespaceLifecycle","ServiceAccount","ValidatingAdmissionWebhook"]',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('denyserviceexternalips')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'admissionControl.configuration.DenyServiceExternalIPs',
      brokenValue: normalized.includes('is not set') ? 'true' : 'false',
      healthyValue: normalized.includes('is not set') ? 'false' : 'true',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('apipriorityandfairness')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'featureGates.APIPriorityAndFairness',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('profiling')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--profiling',
      brokenValue: 'true',
      healthyValue: 'false',
      targetPath: `/etc/kubernetes/manifests/${component}.yaml`,
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('streaming-connection-idle-timeout')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'streamingConnectionIdleTimeout',
      brokenValue: '0s',
      healthyValue: '4h0m0s',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('terminated-pod-gc-threshold')) {
    evidence = {
      component: 'kube-controller-manager',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--terminated-pod-gc-threshold',
      brokenValue: '0',
      healthyValue: '12500',
      targetPath: '/etc/kubernetes/manifests/kube-controller-manager.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('event-qps')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'eventRecordQPS',
      brokenValue: '5',
      healthyValue: '0',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('read-only-port') ||
    normalized.includes('read-only port') ||
    normalized.includes('read only port')
  ) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'readOnlyPort',
      brokenValue: '10255',
      healthyValue: '0',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('request-timeout') || normalized.includes('request timeout')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--request-timeout',
      brokenValue: 'absent',
      healthyValue: '60s',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('repair-malformed-updates')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'featureGates.RepairMalformedUpdates',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('keep-terminated-pod-volumes')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'keepTerminatedPodVolumes',
      brokenValue: 'true',
      healthyValue: 'false',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('rotatekubeletservercertificate')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'serverTLSBootstrap',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('rotate-certificates')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'rotateCertificates',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('rotatekubeletclientcertificate')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'rotateCertificates',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('certificate rotation')) {
    evidence = {
      component: 'kube-controller-manager',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--cluster-signing-duration',
      brokenValue: '87600h',
      healthyValue: '720h',
      targetPath: '/etc/kubernetes/manifests/kube-controller-manager.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('protect-kernel-defaults') && normalized.includes('not set')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'protectKernelDefaults',
      brokenValue: 'true',
      healthyValue: 'absent',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'openshift',
    };
  } else if (normalized.includes('protect-kernel-defaults')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'protectKernelDefaults',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('bind-address') || normalized.includes('insecure bind address')) {
    const expectsUnset =
      normalized.includes('insecure bind address') && normalized.includes('not set');
    evidence = {
      component,
      evidenceKind: component === 'kubelet' ? 'kubelet-configuration' : 'component-arguments',
      exactField: component === 'kubelet' ? 'address' : 'arguments.--bind-address',
      brokenValue: component === 'kubelet' ? '0.0.0.0' : '0.0.0.0',
      healthyValue: expectsUnset ? 'absent' : '127.0.0.1',
      targetPath:
        component === 'kubelet'
          ? '/var/lib/kubelet/config.yaml'
          : `/etc/kubernetes/manifests/${component}.yaml`,
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('secure binding')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--bind-address',
      brokenValue: '0.0.0.0',
      healthyValue: '127.0.0.1',
      targetPath: `/etc/kubernetes/manifests/${component}.yaml`,
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('insecure-port') ||
    normalized.includes('prevent insecure port access') ||
    normalized.includes('insecure port flag disabled')
  ) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--insecure-port',
      brokenValue: '8080',
      healthyValue: '0',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('secure-port')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--secure-port',
      brokenValue: '0',
      healthyValue: '6443',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('cert-file and --key-file') ||
    normalized.includes('cert-file and key-file')
  ) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: normalized.includes('peer-cert-file')
        ? 'arguments.--peer-cert-file'
        : 'arguments.--cert-file',
      brokenValue: 'absent',
      healthyValue: normalized.includes('peer-cert-file')
        ? '/etc/kubernetes/pki/etcd/peer.crt'
        : '/etc/kubernetes/pki/apiserver.crt',
      targetPath: normalized.includes('etcd')
        ? '/etc/kubernetes/manifests/etcd.yaml'
        : '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('organizational certificate')) {
    evidence = {
      component: 'eks-cluster',
      evidenceKind: 'certificate-metadata',
      exactField: 'tlsCertificate.issuer.organization',
      brokenValue: 'unapproved.example',
      healthyValue: 'approved-organizational-pki',
      targetPath: '/eks/control-plane-certificate.json',
      applicability: 'eks',
    };
  } else if (
    normalized.includes('certificate for communication') ||
    normalized.includes('certificate and key used') ||
    normalized.includes('key file for secure communication')
  ) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: normalized.includes('key file for secure communication')
        ? 'arguments.--key-file'
        : 'arguments.--cert-file',
      brokenValue: 'absent',
      healthyValue:
        component === 'etcd'
          ? normalized.includes('key file for secure communication')
            ? '/etc/kubernetes/pki/etcd/server.key'
            : '/etc/kubernetes/pki/etcd/server.crt'
          : normalized.includes('key used to encrypt api server traffic')
          ? '/etc/kubernetes/pki/apiserver.key'
          : '/etc/kubernetes/pki/apiserver.crt',
      targetPath:
        component === 'etcd'
          ? '/etc/kubernetes/manifests/etcd.yaml'
          : `/etc/kubernetes/manifests/${component}.yaml`,
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('certificate authority')) {
    evidence = {
      component,
      evidenceKind: component === 'kubelet' ? 'kubelet-configuration' : 'component-arguments',
      exactField:
        component === 'kubelet'
          ? 'authentication.x509.clientCAFile'
          : component === 'etcd'
          ? 'arguments.--trusted-ca-file'
          : component === 'kube-controller-manager'
          ? 'arguments.--root-ca-file'
          : 'arguments.--client-ca-file',
      brokenValue: 'absent',
      healthyValue:
        component === 'etcd' ? '/etc/kubernetes/pki/etcd/ca.crt' : '/etc/kubernetes/pki/ca.crt',
      targetPath:
        component === 'kubelet'
          ? '/var/lib/kubelet/config.yaml'
          : component === 'etcd'
          ? '/etc/kubernetes/manifests/etcd.yaml'
          : `/etc/kubernetes/manifests/${component}.yaml`,
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('peer-cert-file') || normalized.includes('peer-key-file')) {
    evidence = {
      component: 'etcd',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--peer-cert-file',
      brokenValue: 'absent',
      healthyValue: '/etc/kubernetes/pki/etcd/peer.crt',
      targetPath: '/etc/kubernetes/manifests/etcd.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('ssl certificate authority')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField:
        component === 'etcd' ? 'arguments.--trusted-ca-file' : 'arguments.--client-ca-file',
      brokenValue: 'absent',
      healthyValue:
        component === 'etcd' ? '/etc/kubernetes/pki/etcd/ca.crt' : '/etc/kubernetes/pki/ca.crt',
      targetPath:
        component === 'etcd'
          ? '/etc/kubernetes/manifests/etcd.yaml'
          : `/etc/kubernetes/manifests/${component}.yaml`,
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('auto-tls') ||
    normalized.includes('auto tls') ||
    normalized.includes('etcdautotls')
  ) {
    evidence = {
      component: 'etcd',
      evidenceKind: 'component-arguments',
      exactField:
        normalized.includes('peer-auto-tls') || normalized.includes('peer auto tls')
          ? 'arguments.--peer-auto-tls'
          : 'arguments.--auto-tls',
      brokenValue: 'true',
      healthyValue: 'false',
      targetPath: '/etc/kubernetes/manifests/etcd.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('tls 1.2')) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--tls-min-version',
      brokenValue: 'VersionTLS10',
      healthyValue: 'VersionTLS12',
      targetPath: normalized.includes('etcd')
        ? '/etc/kubernetes/manifests/etcd.yaml'
        : `/etc/kubernetes/manifests/${component}.yaml`,
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('prohibit communication using tls') ||
    normalized.includes('confidentiality of communications') ||
    normalized.includes('protect the confidentiality')
  ) {
    evidence = {
      component,
      evidenceKind: 'component-arguments',
      exactField:
        component === 'etcd' ? 'arguments.--client-cert-auth' : 'arguments.--tls-cert-file',
      brokenValue: 'absent',
      healthyValue: component === 'etcd' ? 'true' : '/etc/kubernetes/pki/apiserver.crt',
      targetPath: normalized.includes('etcd')
        ? '/etc/kubernetes/manifests/etcd.yaml'
        : `/etc/kubernetes/manifests/${component}.yaml`,
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('tls-cert-file')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'tlsCertFile',
      brokenValue: 'absent',
      healthyValue: '/var/lib/kubelet/pki/kubelet.crt',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('kubelet uses certificates to authenticate')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'authentication.x509.clientCAFile',
      brokenValue: 'absent',
      healthyValue: '/etc/kubernetes/pki/ca.crt',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('kubelet-https')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--kubelet-https',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('static podpath')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'staticPodPath',
      brokenValue: '/etc/kubernetes/manifests',
      healthyValue: 'absent',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('wildcard use in roles and clusterroles')) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-rule',
      exactField: 'rules[0].verbs',
      brokenValue: '["*"]',
      healthyValue: '["get","list","watch"]',
      targetPath: '/manifests/clusterrole-wildcard.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('persistent volumes') ||
    normalized.includes('persistentvolume objects')
  ) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-rule',
      exactField: 'rules[0].resources',
      brokenValue: '["persistentvolumes"]',
      healthyValue: '["persistentvolumeclaims"]',
      targetPath: '/manifests/clusterrole-scope.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('minimize access to create pods')) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-rule',
      exactField: 'rules[0].resources',
      brokenValue: '["pods"]',
      healthyValue: '["configmaps"]',
      targetPath: '/manifests/clusterrole-scope.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('minimize access to secrets')) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-rule',
      exactField: 'rules[0].resources',
      brokenValue: '["secrets"]',
      healthyValue: '["configmaps"]',
      targetPath: '/manifests/clusterrole-scope.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('approval sub-resource of certificatesigningrequests')) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-rule',
      exactField: 'rules[0].resources',
      brokenValue: '["certificatesigningrequests/approval"]',
      healthyValue: '["certificatesigningrequests"]',
      targetPath: '/manifests/clusterrole-scope.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('proxy sub-resource of node objects') ||
    normalized.includes('proxy sub-resource of nodes')
  ) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-rule',
      exactField: 'rules[0].resources',
      brokenValue: '["nodes/proxy"]',
      healthyValue: '["nodes"]',
      targetPath: '/manifests/clusterrole-scope.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('service account token creation')) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-rule',
      exactField: 'rules[0].resources',
      brokenValue: '["serviceaccounts/token"]',
      healthyValue: '["serviceaccounts"]',
      targetPath: '/manifests/clusterrole-scope.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('webhook configuration objects')) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-rule',
      exactField: 'rules[0].resources',
      brokenValue: '["mutatingwebhookconfigurations","validatingwebhookconfigurations"]',
      healthyValue: '["configmaps"]',
      targetPath: '/manifests/clusterrole-scope.yaml',
      applicability: 'inert-review-only',
    };
  } else if (
    normalized.includes('healthz endpoint is protected by rbac') ||
    normalized.includes('healthz endpoints for the scheduler are protected by rbac')
  ) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-rule',
      exactField: 'rules[0].nonResourceURLs',
      brokenValue: '["/healthz"]',
      healthyValue: '[]',
      targetPath: '/manifests/clusterrole-healthz.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('scheduler api service is protected by')) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-rule',
      exactField: 'rules[0].nonResourceURLs',
      brokenValue: '["/metrics","/healthz"]',
      healthyValue: '[]',
      targetPath: '/manifests/clusterrole-scheduler-api.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('seccomp profile is set to docker/default')) {
    evidence = {
      component: 'workload',
      evidenceKind: 'pod-security-context',
      exactField: 'spec.template.spec.securityContext.seccompProfile.type',
      brokenValue: 'Unconfined',
      healthyValue: 'RuntimeDefault',
      targetPath: '/manifests/workload-pod.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('seccomp-default')) {
    evidence = {
      component: 'kubelet',
      evidenceKind: 'kubelet-configuration',
      exactField: 'seccompDefault',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('allowprivilegeescalation')) {
    evidence = {
      component: 'workload',
      evidenceKind: 'pod-security-context',
      exactField: 'spec.template.spec.containers[0].securityContext.allowPrivilegeEscalation',
      brokenValue: 'true',
      healthyValue: 'false',
      targetPath: '/manifests/workload-pod.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('hostports') || normalized.includes('host ports')) {
    evidence = {
      component: 'workload',
      evidenceKind: 'pod-spec',
      exactField: 'spec.template.spec.containers[0].ports[0].hostPort',
      brokenValue: '22',
      healthyValue: '0',
      targetPath: '/manifests/workload-pod.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('windows hostprocess')) {
    evidence = {
      component: 'workload',
      evidenceKind: 'pod-security-context',
      exactField: 'spec.template.spec.securityContext.windowsOptions.hostProcess',
      brokenValue: 'true',
      healthyValue: 'false',
      targetPath: '/manifests/workload-pod.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('security context constraints')) {
    evidence = {
      component: 'openshift-admission',
      evidenceKind: 'managed-cluster-config',
      exactField: normalized.includes('privileged containers')
        ? 'securityContextConstraints.allowHostPorts'
        : 'securityContextConstraints.defaultAllowPrivilegeEscalation',
      brokenValue: normalized.includes('privileged containers') ? 'true' : 'true',
      healthyValue: normalized.includes('privileged containers') ? 'false' : 'false',
      targetPath: '/openshift/security-context-constraints.json',
      applicability: 'openshift',
    };
  } else if (normalized.includes('podsecuritypolicy is disabled')) {
    evidence = {
      component: 'openshift-admission',
      evidenceKind: 'managed-cluster-config',
      exactField: 'admissionControl.podSecurityPolicy.enabled',
      brokenValue: 'true',
      healthyValue: 'false',
      targetPath: '/openshift/security-context-constraints.json',
      applicability: 'openshift',
    };
  } else if (normalized.includes('control plane authorized networks')) {
    evidence = {
      component: 'gke-cluster',
      evidenceKind: 'managed-cluster-config',
      exactField: 'masterAuthorizedNetworksConfig.enabled',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/gke/cluster.json',
      applicability: 'gke',
    };
  } else if (normalized.includes('gke metadata server')) {
    evidence = {
      component: 'gke-cluster',
      evidenceKind: 'managed-cluster-config',
      exactField: 'workloadMetadataConfig.mode',
      brokenValue: 'GCE_METADATA',
      healthyValue: 'GKE_METADATA',
      targetPath: '/gke/node-pool.json',
      applicability: 'gke',
    };
  } else if (normalized.includes('legacy compute engine instance metadata apis')) {
    evidence = {
      component: 'gke-cluster',
      evidenceKind: 'managed-cluster-config',
      exactField: 'nodeMetadata.legacyEndpointsDisabled',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/gke/node-pool.json',
      applicability: 'gke',
    };
  } else if (normalized.includes('secure boot for shielded gke nodes')) {
    evidence = {
      component: 'gke-cluster',
      evidenceKind: 'managed-cluster-config',
      exactField: 'shieldedInstanceConfig.enableSecureBoot',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/gke/node-pool.json',
      applicability: 'gke',
    };
  } else if (
    normalized.includes('shielded gke nodes') &&
    !normalized.includes('secure boot') &&
    !normalized.includes('integrity monitoring')
  ) {
    evidence = {
      component: 'gke-cluster',
      evidenceKind: 'managed-cluster-config',
      exactField: 'shieldedNodes.enabled',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/gke/cluster.json',
      applicability: 'gke',
    };
  } else if (normalized.includes('integrity monitoring for shielded gke nodes')) {
    evidence = {
      component: 'gke-cluster',
      evidenceKind: 'managed-cluster-config',
      exactField: 'shieldedInstanceConfig.enableIntegrityMonitoring',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/gke/node-pool.json',
      applicability: 'gke',
    };
  } else if (normalized.includes('binary authorization')) {
    evidence = {
      component: 'gke-cluster',
      evidenceKind: 'managed-cluster-config',
      exactField: 'binaryAuthorization.enabled',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/gke/cluster.json',
      applicability: 'gke',
    };
  } else if (normalized.includes('network policies')) {
    evidence = {
      component: 'managed-networking',
      evidenceKind: 'managed-cluster-config',
      exactField: 'networkPolicy.enabled',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/managed-cluster/networking.json',
      applicability: 'managed-cluster-review',
    };
  } else if (
    normalized.includes('secrets are encrypted') ||
    normalized.includes('encryption provider is set to aescbc') ||
    normalized.includes('set the encryption provider to aescbc')
  ) {
    const usesAwsKms =
      normalized.includes('customer master keys') && normalized.includes('aws kms');
    const usesCloudKms = normalized.includes('keys managed in cloud kms');
    const usesAckKms = normalized.includes('keys managed in kms');
    const usesAescbc = normalized.includes('aescbc');
    evidence = {
      component: usesAwsKms
        ? 'eks-cluster'
        : usesCloudKms
        ? 'gke-cluster'
        : usesAckKms
        ? 'ack-cluster'
        : 'kube-apiserver',
      evidenceKind: usesAescbc ? 'encryption-provider' : 'managed-cluster-config',
      exactField: usesAwsKms
        ? 'encryptionConfig[0].provider.keyArn'
        : usesCloudKms
        ? 'databaseEncryption.keyName'
        : usesAckKms
        ? 'encryptionConfig.provider.keyArn'
        : usesAescbc
        ? 'encryptionProvider.providers[0].aescbc.keys[0].name'
        : 'etcdEncryption.enabled',
      brokenValue: 'absent',
      healthyValue: usesAwsKms
        ? 'arn:aws:kms:us-west-2:111122223333:key/example'
        : usesCloudKms
        ? 'projects/example/locations/global/keyRings/kubernetes/cryptoKeys/secrets'
        : usesAckKms
        ? 'acs:kms:cn-hangzhou:111122223333:key/example'
        : usesAescbc
        ? 'key1'
        : 'true',
      targetPath: usesAwsKms
        ? '/eks/cluster.json'
        : usesCloudKms
        ? '/gke/cluster.json'
        : usesAckKms
        ? '/ack/cluster.json'
        : '/etc/kubernetes/encryption-config.yaml',
      applicability: usesAwsKms ? 'eks' : usesCloudKms ? 'gke' : usesAckKms ? 'ack' : 'aks',
    };
  } else if (normalized.includes('azure rbac') || normalized.includes('azure ad')) {
    evidence = {
      component: 'aks-cluster',
      evidenceKind: 'managed-cluster-config',
      exactField: 'aadProfile.enableAzureRbac',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/aks/cluster.json',
      applicability: 'aks',
    };
  } else if (normalized.includes('aws iam authenticator')) {
    evidence = {
      component: 'eks-cluster',
      evidenceKind: 'managed-cluster-config',
      exactField: 'accessConfig.authenticationMode',
      brokenValue: 'CONFIG_MAP',
      healthyValue: 'API',
      targetPath: '/eks/cluster.json',
      applicability: 'eks',
    };
  } else if (normalized.includes('google groups for gke')) {
    evidence = {
      component: 'gke-cluster',
      evidenceKind: 'managed-cluster-config',
      exactField: 'authenticatorGroupsConfig.enabled',
      brokenValue: 'false',
      healthyValue: 'true',
      targetPath: '/gke/cluster.json',
      applicability: 'gke',
    };
  } else if (normalized.includes('kubernetes dashboard')) {
    evidence = {
      component: 'cluster-addons',
      evidenceKind: 'managed-cluster-config',
      exactField: 'addons.dashboard.enabled',
      brokenValue: 'true',
      healthyValue: 'false',
      targetPath: '/managed-cluster/addons.json',
      applicability: 'managed-cluster-review',
    };
  } else if (normalized.includes('alpha apis')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'arguments.--runtime-config',
      brokenValue: 'api/alpha=true',
      healthyValue: 'api/alpha=false',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('dynamicauditing')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'featureGates.DynamicAuditing',
      brokenValue: 'true',
      healthyValue: 'false',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('dynamickubeletconfig')) {
    evidence = {
      component: 'kube-apiserver',
      evidenceKind: 'component-arguments',
      exactField: 'featureGates.DynamicKubeletConfig',
      brokenValue: 'true',
      healthyValue: 'false',
      targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('anonymous authentication disabled')) {
    evidence = {
      component: normalized.includes('api server') ? 'kube-apiserver' : 'kubelet',
      evidenceKind: normalized.includes('api server')
        ? 'component-arguments'
        : 'kubelet-configuration',
      exactField: normalized.includes('api server')
        ? 'arguments.--anonymous-auth'
        : 'authentication.anonymous.enabled',
      brokenValue: normalized.includes('api server') ? 'true' : 'true',
      healthyValue: normalized.includes('api server') ? 'false' : 'false',
      targetPath: normalized.includes('api server')
        ? '/etc/kubernetes/manifests/kube-apiserver.yaml'
        : '/var/lib/kubelet/config.yaml',
      applicability: 'inert-review-only',
    };
  } else if (normalized.includes('prevent insecure bindings')) {
    evidence = {
      component: 'rbac',
      evidenceKind: 'rbac-binding',
      exactField: 'roleRef.name',
      brokenValue: 'cluster-admin',
      healthyValue: 'view',
      targetPath: '/manifests/clusterrolebinding-subject.yaml',
      applicability: 'inert-review-only',
    };
  } else {
    throw new Error(`missing concrete evidence mapping for ${capability.canonical_capability_id}`);
  }

  return assertConcreteEvidence(capability, evidence);
};

const genericEvidenceFixture = (batchLabel: string, capability: Capability): Fixture => {
  const name = scenarioIdFor(batchLabel, capability.canonical_capability_id).replace(
    new RegExp(`^rule-gap-${batchLabel}-`),
    `${batchLabel}-`
  );
  const resourceRef = `configmap/${name}`;
  const evidence = buildConcreteEvidence(capability);
  const observation = JSON.stringify(
    {
      component: evidence.component,
      evidenceKind: evidence.evidenceKind,
      exactField: evidence.exactField,
      brokenValue: evidence.brokenValue,
      targetPath: evidence.targetPath,
      applicability: evidence.applicability,
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
    description: `${capability.predicate_summary} The fixture preserves inert, typed evidence for review without mutating a host, runtime, or control-plane surface.`,
    taskPrompt: `Inspect ${resourceRef}. Explain the concrete configuration defect represented by the fixture, cite the exact field, and do not mutate resources.`,
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
    ...classify(capability),
  };
};

export const buildRuleGapScenarioBatch = (
  batchLabel: string,
  selectedIds: readonly string[]
): Array<{ definition: ScenarioDraftDefinition; catalog: VersionedRuleGapScenarioCatalogSeed }> =>
  selectedIds.map(capabilityId => {
    const capability = capabilityById.get(capabilityId);
    if (!capability) {
      throw new Error(`unknown canonical capability ${capabilityId}`);
    }
    const fixture = genericEvidenceFixture(batchLabel, capability);
    const scenarioId = scenarioIdFor(batchLabel, capability.canonical_capability_id);
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
    const catalog: VersionedRuleGapScenarioCatalogSeed = {
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

const records = buildRuleGapScenarioBatch('v8', selectedCapabilityIds);

export const v8ScenarioDraftDefinitions: ScenarioDraftDefinition[] = records.map(
  record => record.definition
);

export const v8ScenarioCatalogSeeds: V8ScenarioCatalogSeed[] = records.map(
  record => record.catalog
);
