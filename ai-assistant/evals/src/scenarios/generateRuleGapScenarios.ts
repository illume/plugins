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

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SCENARIOS_GOAL } from './scenariosGoal.js';

const moduleRequire = createRequire(import.meta.url);
const prettier = moduleRequire('prettier') as {
  format(source: string, options: Record<string, unknown>): string;
  resolveConfig(filePath: string): Promise<Record<string, unknown> | null>;
};

type Category =
  | 'workload_configuration'
  | 'control_plane_host_hardening'
  | 'runtime_node_failure'
  | 'operations_deprecation';
type Feasibility =
  | 'manifest_only'
  | 'live_cluster'
  | 'telemetry'
  | 'host'
  | 'cloud'
  | 'runtime'
  | 'custom_crd';
type ClusterProfile = 'local-kwok' | 'local-minikube' | 'aks';

interface InventoryRule {
  rule_id: string;
  semantic_group_id: string;
  info_url: string;
  mapping_readiness?: 'direct_predicate' | 'requires_decomposition' | 'reference_only';
}

interface InventoryTool {
  tool_id: string;
  revision: string;
  mapping_readiness: 'direct_predicate' | 'requires_decomposition' | 'reference_only';
  rules: InventoryRule[];
}

interface Inventory {
  tools: InventoryTool[];
}

interface Mapping {
  rule_mappings: Array<{
    rules: Array<{ rule_id: string; status: 'covered' | 'unsure' | 'uncovered' }>;
  }>;
}

interface Targets {
  ruleIds?: string[];
  semanticGroupIds?: string[];
}

type BlueprintTuple = [
  slug: string,
  title: string,
  resource: string,
  trigger: string,
  healthy: string,
  targets: Targets,
  feasibility?: Feasibility
];

interface Blueprint {
  category: Category;
  slug: string;
  title: string;
  resource: string;
  trigger: string;
  healthy: string;
  targets: Targets;
  feasibility: Feasibility;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const inventoryPath = path.join(evalRoot, 'registrations', 'tool-rule-inventory-v1.json');
const mappingPath = path.join(evalRoot, 'registrations', 'tool-scenario-rule-mapping-v1.json');
const outputPath = path.resolve(here, '..', '..', 'registrations', 'rule-gap-scenarios-v1.json');
const documentationPath = path.resolve(evalRoot, '..', 'docs', 'kubernetes-rule-gap-scenarios.md');

const r = (...ruleIds: string[]): Targets => ({ ruleIds });
const g = (...semanticGroupIds: string[]): Targets => ({ semanticGroupIds });
const rg = (ruleIds: string[], semanticGroupIds: string[]): Targets => ({
  ruleIds,
  semanticGroupIds,
});

const workload: BlueprintTuple[] = [
  [
    'missing-liveness-probe',
    'Container missing a liveness probe',
    'Deployment, Pod',
    'an application container has no livenessProbe field',
    'every long-running application container declares a valid liveness probe',
    r(
      'kube-linter:check:no-liveness-probe',
      'polaris:check:livenessProbeMissing',
      'popeye:code:103',
      'kubescape:rule:configured-liveness-probe'
    ),
  ],
  [
    'missing-readiness-probe',
    'Container missing a readiness probe',
    'Deployment, Pod',
    'an application container has no readinessProbe field',
    'every traffic-serving container declares a valid readiness probe',
    r(
      'kube-linter:check:no-readiness-probe',
      'polaris:check:readinessProbeMissing',
      'popeye:code:104',
      'kubescape:rule:configured-readiness-probe'
    ),
  ],
  [
    'unsafe-probe-suite',
    'Container has no safe probe suite',
    'Deployment, Pod',
    'the container omits both readiness and liveness probes',
    'the container has distinct valid readiness and liveness probes',
    r('popeye:code:102', 'kube-score:check:pod-probes'),
  ],
  [
    'liveness-port-not-exposed',
    'Liveness probe targets an undeclared port',
    'Deployment, Pod',
    'livenessProbe.httpGet.port names a port absent from container.ports',
    'the liveness probe port resolves to a declared container port',
    r('kube-linter:check:liveness-port'),
  ],
  [
    'readiness-port-not-exposed',
    'Readiness probe targets an undeclared port',
    'Deployment, Pod',
    'readinessProbe.httpGet.port names a port absent from container.ports',
    'the readiness probe port resolves to a declared container port',
    r('kube-linter:check:readiness-port'),
  ],
  [
    'startup-port-not-exposed',
    'Startup probe targets an undeclared port',
    'Deployment, Pod',
    'startupProbe.httpGet.port names a port absent from container.ports',
    'the startup probe port resolves to a declared container port',
    r('kube-linter:check:startup-port'),
  ],
  [
    'cpu-request-missing',
    'Container CPU request is missing',
    'Deployment, Pod',
    'resources.requests.cpu is absent while other resource fields remain valid',
    'each application container declares a positive CPU request',
    r('polaris:check:cpuRequestsMissing', 'kubescape:rule:resources-cpu-requests'),
  ],
  [
    'cpu-limit-missing',
    'Container CPU limit is missing',
    'Deployment, Pod',
    'resources.limits.cpu is absent while a CPU request is present',
    'each application container declares a positive CPU limit',
    r('polaris:check:cpuLimitsMissing', 'kubescape:rule:resources-cpu-limits'),
  ],
  [
    'cpu-requirements-missing',
    'Container CPU request and limit are missing',
    'Deployment, Pod',
    'both resources.requests.cpu and resources.limits.cpu are absent',
    'both CPU request and CPU limit are explicitly configured',
    r(
      'kube-linter:check:unset-cpu-requirements',
      'kube-score:check:container-resources',
      'kubescape:rule:resources-cpu-limit-and-request'
    ),
  ],
  [
    'memory-request-missing',
    'Container memory request is missing',
    'Deployment, Pod',
    'resources.requests.memory is absent while other resource fields remain valid',
    'each application container declares a positive memory request',
    r('polaris:check:memoryRequestsMissing', 'kubescape:rule:resources-memory-requests'),
  ],
  [
    'memory-limit-missing',
    'Container memory limit is missing',
    'Deployment, Pod',
    'resources.limits.memory is absent while a memory request is present',
    'each application container declares a positive memory limit',
    r('polaris:check:memoryLimitsMissing', 'kubescape:rule:resources-memory-limits'),
  ],
  [
    'memory-requirements-missing',
    'Container memory request and limit are missing',
    'Deployment, Pod',
    'both resources.requests.memory and resources.limits.memory are absent',
    'both memory request and memory limit are explicitly configured',
    r(
      'kube-linter:check:unset-memory-requirements',
      'kubescape:rule:resources-memory-limit-and-request'
    ),
  ],
  [
    'latest-image-tag',
    'Mutable latest image tag is used',
    'Deployment, Pod',
    'a container image has the latest tag or omits a tag and resolves as latest',
    'every image uses a non-latest immutable version reference',
    r('kube-linter:check:latest-tag', 'kubevious:rule:container-latest-image', 'popeye:code:101'),
  ],
  [
    'image-not-pinned',
    'Container image is not pinned to a digest',
    'Deployment, Pod',
    'a container image uses an untagged or tag-only reference without a sha256 digest',
    'every image reference includes an approved sha256 digest',
    r('popeye:code:100', 'kubescape:rule:image-not-pinned-to-digest'),
  ],
  [
    'image-pull-policy',
    'Image pull policy is not Always',
    'Deployment, Pod',
    'a tag-based image has imagePullPolicy omitted or set to IfNotPresent',
    'the container uses imagePullPolicy Always for the tag-based image',
    r(
      'kube-score:check:container-image-pull-policy',
      'kubescape:rule:image-pull-policy-is-not-set-to-always'
    ),
  ],
  [
    'blocked-image-registry',
    'Container uses a disallowed image registry',
    'Deployment, Pod',
    'a container image registry is outside the fixture allowlist',
    'every container image is hosted by an explicitly allowed registry',
    r(
      'popeye:code:113',
      'kubescape:rule:rule-identify-blocklisted-image-registries',
      'kubescape:rule:rule-identify-blocklisted-image-registries-v1'
    ),
  ],
  [
    'insufficient-replicas',
    'Deployment has too few replicas',
    'Deployment',
    'a non-HPA Deployment declares fewer than the configured minimum replicas',
    'the Deployment declares at least the configured minimum replicas',
    r(
      'kube-linter:check:minimum-three-replicas',
      'kube-score:check:deployment-replicas',
      'polaris:check:deploymentMissingReplicas',
      'kubevious:rule:replica-count-check'
    ),
  ],
  [
    'missing-pod-disruption-budget',
    'Replicated workload has no PodDisruptionBudget',
    'Deployment, PodDisruptionBudget',
    'a multi-replica Deployment has no selecting PodDisruptionBudget',
    'exactly one valid PodDisruptionBudget selects the Deployment pods',
    r('polaris:check:missingPodDisruptionBudget', 'popeye:code:206'),
  ],
  [
    'pdb-policy-missing',
    'PodDisruptionBudget has no availability policy',
    'PodDisruptionBudget',
    'the budget specifies neither minAvailable nor maxUnavailable',
    'the budget specifies exactly one bounded availability policy',
    r('kube-score:check:poddisruptionbudget-has-policy'),
  ],
  [
    'pdb-blocks-all-disruptions',
    'PodDisruptionBudget blocks every voluntary disruption',
    'Deployment, PodDisruptionBudget',
    'maxUnavailable is zero for the selected replica count',
    'the budget permits at least one voluntary disruption',
    r('kube-linter:check:pdb-max-unavailable', 'polaris:check:pdbDisruptionsIsZero'),
  ],
  [
    'pdb-exceeds-hpa-minimum',
    'PodDisruptionBudget exceeds HPA minimum replicas',
    'Deployment, HorizontalPodAutoscaler, PodDisruptionBudget',
    'PDB minAvailable is greater than HPA minReplicas',
    'PDB minAvailable does not exceed HPA minReplicas',
    r(
      'kube-linter:check:pdb-min-available',
      'polaris:check:pdbMinAvailableGreaterThanHPAMinReplicas'
    ),
  ],
  [
    'missing-pod-anti-affinity',
    'Replicas lack host anti-affinity',
    'Deployment, Pod',
    'a multi-replica workload has neither hostname anti-affinity nor an equivalent spread constraint',
    'replicas are constrained to spread across distinct nodes',
    r('kube-linter:check:no-anti-affinity', 'kube-score:check:deployment-has-host-podantiaffinity'),
  ],
  [
    'missing-topology-spread',
    'Workload lacks topology spread constraints',
    'Deployment, Pod',
    'a replicated workload omits topologySpreadConstraints',
    'the workload declares a satisfiable zone or hostname spread constraint',
    r('kube-score:check:pod-topology-spread-constraints', 'polaris:check:topologySpreadConstraint'),
  ],
  [
    'non-rolling-deployment',
    'Deployment does not use RollingUpdate',
    'Deployment, Service',
    'a Service-targeted Deployment uses Recreate or omits the required rolling strategy',
    'the Deployment uses RollingUpdate with valid surge and unavailable bounds',
    r(
      'kube-linter:check:no-rolling-update-strategy',
      'kube-score:check:deployment-strategy',
      'kubescape:rule:no-rolling-update-strategy'
    ),
  ],
  [
    'workload-selector-mismatch',
    'Workload selector does not match pod labels',
    'Deployment, Pod',
    'spec.selector.matchLabels differs from spec.template.metadata.labels',
    'the workload selector is a subset of the pod template labels',
    r(
      'kube-linter:check:mismatching-selector',
      'kube-score:check:deployment-pod-selector-labels-match-template-metadata-labels',
      'kubescape:rule:mismatching-selector'
    ),
  ],
  [
    'dangling-hpa-target',
    'HorizontalPodAutoscaler target is missing',
    'HorizontalPodAutoscaler, Deployment',
    'scaleTargetRef names a Deployment absent from the namespace',
    'scaleTargetRef resolves to an existing scalable workload',
    r('kube-linter:check:dangling-horizontalpodautoscaler', 'kubevious:rule:hpa-scale-target-ref'),
  ],
  [
    'dangling-ingress-backend',
    'Ingress backend Service is missing',
    'Ingress, Service',
    'an Ingress rule names a Service absent from the namespace',
    'every Ingress backend resolves to an existing Service and port',
    r(
      'kube-linter:check:dangling-ingress',
      'kube-score:check:ingress-targets-service',
      'kubevious:rule:ingress-service-ref',
      'popeye:code:1401',
      'kubescape:rule:dangling-ingress-backend'
    ),
  ],
  [
    'ingress-without-valid-tls',
    'Ingress lacks matching TLS coverage',
    'Ingress, Secret',
    'an Ingress rule host is absent from tls.hosts or the TLS section is absent',
    'every routed host has a matching TLS host and certificate Secret',
    r('kubevious:rule:ingress-tls-rule-domain-match', 'kubescape:rule:ingress-no-tls'),
  ],
  [
    'missing-service-account',
    'Pod references a missing ServiceAccount',
    'Pod, ServiceAccount',
    'spec.serviceAccountName names no ServiceAccount in the Pod namespace',
    'the named ServiceAccount exists in the same namespace',
    r(
      'kube-linter:check:non-existent-service-account',
      'popeye:code:307',
      'kubescape:rule:non-existent-service-account'
    ),
  ],
  [
    'duplicate-environment-variable',
    'Container declares a duplicate environment variable',
    'Deployment, Pod',
    'one container env array repeats the same variable name',
    'environment variable names are unique within each container',
    r(
      'kube-linter:check:duplicate-env-var',
      'kube-score:check:environment-variable-key-duplication',
      'kubescape:rule:duplicate-env-var'
    ),
  ],
];

const hardening: BlueprintTuple[] = [
  [
    'anonymous-kubelet-auth',
    'Anonymous kubelet authentication is enabled',
    'kubelet configuration',
    'the effective anonymous-auth setting is true',
    'anonymous-auth is explicitly false',
    g('kube-bench:semantic:ensure-that-the-anonymous-auth-argument-is-set-to-false:090699c1c827'),
  ],
  [
    'alwaysallow-authorization',
    'AlwaysAllow authorization is enabled',
    'API server configuration',
    'authorization-mode contains AlwaysAllow',
    'authorization-mode excludes AlwaysAllow',
    g(
      'kube-bench:semantic:ensure-that-the-authorization-mode-argument-is-not-set-to-alwaysallow:bbd03c30a195'
    ),
  ],
  [
    'node-authorizer-missing',
    'Node authorizer is missing',
    'API server configuration',
    'authorization-mode does not include Node',
    'authorization-mode includes Node',
    g('kube-bench:semantic:ensure-that-the-authorization-mode-argument-includes-node:c04257a3c1df'),
  ],
  [
    'rbac-authorizer-missing',
    'RBAC authorizer is missing',
    'API server configuration',
    'authorization-mode does not include RBAC',
    'authorization-mode includes RBAC',
    g('kube-bench:semantic:ensure-that-the-authorization-mode-argument-includes-rbac:a0fae543585b'),
  ],
  [
    'etcd-client-cert-auth-disabled',
    'etcd client certificate authentication is disabled',
    'etcd configuration',
    'client-cert-auth is absent or false',
    'client-cert-auth is explicitly true',
    g('kube-bench:semantic:ensure-that-the-client-cert-auth-argument-is-set-to-true:0f8cfdb02faa'),
  ],
  [
    'etcd-peer-cert-auth-disabled',
    'etcd peer certificate authentication is disabled',
    'etcd configuration',
    'peer-client-cert-auth is absent or false',
    'peer-client-cert-auth is explicitly true',
    g(
      'kube-bench:semantic:ensure-that-the-peer-client-cert-auth-argument-is-set-to-true:b2344c6f991c'
    ),
  ],
  [
    'alwaysadmit-enabled',
    'AlwaysAdmit admission plugin is enabled',
    'API server configuration',
    'the effective admission chain contains AlwaysAdmit',
    'AlwaysAdmit is absent from the effective admission chain',
    g(
      'kube-bench:semantic:ensure-that-the-admission-control-plugin-alwaysadmit-is-not-set:598eddf79303'
    ),
  ],
  [
    'serviceaccount-admission-missing',
    'ServiceAccount admission plugin is missing',
    'API server configuration',
    'the effective admission chain omits ServiceAccount',
    'ServiceAccount is enabled in the admission chain',
    g(
      'kube-bench:semantic:ensure-that-the-admission-control-plugin-serviceaccount-is-set:bed8c27a6f12'
    ),
  ],
  [
    'namespace-lifecycle-admission-missing',
    'NamespaceLifecycle admission plugin is missing',
    'API server configuration',
    'the effective admission chain omits NamespaceLifecycle',
    'NamespaceLifecycle is enabled in the admission chain',
    g(
      'kube-bench:semantic:ensure-that-the-admission-control-plugin-namespacelifecycle-is-set:bcd3dad5190b'
    ),
  ],
  [
    'node-restriction-admission-missing',
    'NodeRestriction admission plugin is missing',
    'API server configuration',
    'the effective admission chain omits NodeRestriction',
    'NodeRestriction is enabled in the admission chain',
    g(
      'kube-bench:semantic:ensure-that-the-admission-control-plugin-noderestriction-is-set:bee56194bc23'
    ),
  ],
  [
    'event-rate-limit-admission-missing',
    'EventRateLimit admission plugin is missing',
    'API server configuration',
    'the effective admission chain omits EventRateLimit',
    'EventRateLimit is enabled with a reviewed configuration',
    g(
      'kube-bench:semantic:ensure-that-the-admission-control-plugin-eventratelimit-is-set:1617d7e69132'
    ),
  ],
  [
    'always-pull-images-admission-missing',
    'AlwaysPullImages admission plugin is missing',
    'API server configuration',
    'the effective admission chain omits AlwaysPullImages',
    'AlwaysPullImages is enabled in the admission chain',
    g(
      'kube-bench:semantic:ensure-that-the-admission-control-plugin-alwayspullimages-is-set:45826088186e'
    ),
  ],
  [
    'secret-encryption-provider-missing',
    'API data encryption provider is missing',
    'API server, encryption configuration',
    'encryption-provider-config is absent from API server arguments',
    'a readable reviewed encryption provider configuration is supplied',
    g(
      'kube-bench:semantic:ensure-that-the-encryption-provider-config-argument-is-set-as-appropriate:4e634e485961'
    ),
  ],
  [
    'audit-log-path-missing',
    'API audit log path is missing',
    'API server configuration',
    'audit-log-path is absent or unusable',
    'audit-log-path names a writable retained destination',
    g('kube-bench:semantic:ensure-that-the-audit-log-path-argument-is-set:908addcff4a1'),
  ],
  [
    'audit-log-retention-too-short',
    'API audit log retention is too short',
    'API server configuration',
    'audit-log-maxage is below the reviewed 30-day threshold',
    'audit-log-maxage is at least 30 days',
    g(
      'kube-bench:semantic:ensure-that-the-audit-log-maxage-argument-is-set-to-30-or-as-appropriate:d0478cf7f504'
    ),
  ],
  [
    'audit-log-backups-too-few',
    'API audit log backup count is too low',
    'API server configuration',
    'audit-log-maxbackup is below the reviewed threshold of 10',
    'audit-log-maxbackup is at least 10',
    g(
      'kube-bench:semantic:ensure-that-the-audit-log-maxbackup-argument-is-set-to-10-or-as-appropriate:eff0f684ab25'
    ),
  ],
  [
    'audit-log-file-too-small',
    'API audit log rotation size is too small',
    'API server configuration',
    'audit-log-maxsize is below the reviewed threshold of 100 MB',
    'audit-log-maxsize is at least 100 MB',
    g(
      'kube-bench:semantic:ensure-that-the-audit-log-maxsize-argument-is-set-to-100-or-as-appropriate:e90a7e94b24f'
    ),
  ],
  [
    'service-account-token-lookup-disabled',
    'Service account token lookup is disabled',
    'API server configuration',
    'service-account-lookup is absent or false',
    'service-account-lookup is explicitly true',
    g(
      'kube-bench:semantic:ensure-that-the-service-account-lookup-argument-is-set-to-true:e3097c2ff52e'
    ),
  ],
  [
    'etcd-client-keypair-missing',
    'API server etcd client keypair is missing',
    'API server, certificate files',
    'etcd-certfile or etcd-keyfile is absent or unreadable',
    'both etcd client certificate and key are configured and readable',
    g(
      'kube-bench:semantic:ensure-that-the-etcd-certfile-and-etcd-keyfile-arguments-are-set-as-appropriate:6ca492fbc048'
    ),
  ],
  [
    'component-profiling-enabled',
    'Control-plane profiling endpoint is enabled',
    'control-plane component configuration',
    'the effective profiling argument is true',
    'profiling is explicitly false on the inspected component',
    g('kube-bench:semantic:ensure-that-the-profiling-argument-is-set-to-false:486df6acbb64'),
  ],
  [
    'kubelet-read-only-port',
    'Kubelet read-only port is enabled',
    'kubelet configuration',
    'read-only-port is nonzero',
    'read-only-port is explicitly zero',
    g('kube-bench:semantic:ensure-that-the-read-only-port-argument-is-set-to-0:33425e4719e2'),
  ],
  [
    'unbounded-streaming-idle-timeout',
    'Kubelet streaming idle timeout is disabled',
    'kubelet configuration',
    'streaming-connection-idle-timeout is zero',
    'streaming-connection-idle-timeout is a positive bounded duration',
    g(
      'kube-bench:semantic:ensure-that-the-streaming-connection-idle-timeout-argument-is-not-set-to-0:103583e5cb8e'
    ),
  ],
  [
    'kernel-default-protection-disabled',
    'Kubelet does not protect kernel defaults',
    'kubelet configuration, sysctls',
    'protect-kernel-defaults is absent or false',
    'protect-kernel-defaults is true and node sysctls conform',
    g(
      'kube-bench:semantic:ensure-that-the-protect-kernel-defaults-argument-is-set-to-true:f691c11ca1b6'
    ),
  ],
  [
    'event-qps-throttles-auditability',
    'Kubelet event QPS is too restrictive',
    'kubelet configuration',
    'event-qps is below the reviewed diagnostic capture rate',
    'event-qps is zero or meets the reviewed capture rate',
    g(
      'kube-bench:semantic:ensure-that-the-event-qps-argument-is-set-to-0-or-a-level-which-ensures-appropri:e87c0a1faa44'
    ),
  ],
  [
    'kubelet-server-cert-rotation-disabled',
    'Kubelet server certificate rotation is disabled',
    'kubelet configuration',
    'RotateKubeletServerCertificate is absent or false',
    'RotateKubeletServerCertificate is explicitly true',
    g(
      'kube-bench:semantic:ensure-that-the-rotatekubeletservercertificate-argument-is-set-to-true:fb95f1e42618'
    ),
  ],
];

const runtime: BlueprintTuple[] = [
  [
    'pod-crash-loop',
    'Pod repeatedly crashes and backs off',
    'Pod, Event, restart metric',
    'restart count increases while the container waits with CrashLoopBackOff',
    'the container remains Ready without new restarts through the window',
    r(
      'headlamp:source:crashloop:a822f7fe2524',
      'popeye:code:205',
      'kubernetes-mixin:alert:KubePodCrashLooping'
    ),
    'telemetry',
  ],
  [
    'pod-image-pull-failure',
    'Pod cannot pull its container image',
    'Pod, Event',
    'the container waits with ErrImagePull or ImagePullBackOff for a nonexistent image',
    'the image pulls and the container reaches Running',
    r('headlamp:source:image-pull:e232213a0ebe'),
  ],
  [
    'pod-invalid-config-reference',
    'Pod references missing configuration',
    'Pod, ConfigMap, Secret, Event',
    'a required env or volume reference names an absent ConfigMap or Secret',
    'every required configuration reference resolves in the Pod namespace',
    r('headlamp:source:invalid-config-reference:3a7fa28d96ac'),
  ],
  [
    'pod-oom-killed',
    'Container is terminated by the OOM killer',
    'Pod, node journal, metric',
    'lastState.terminated.reason is OOMKilled and the node records an OOM kill',
    'the container remains below its limit without OOM events',
    rg(
      ['headlamp:source:oom-killed:992679017bdb', 'popeye:code:704'],
      ['node-problem-detector:semantic:oomkilling:5a3d709ff5ff']
    ),
  ],
  [
    'pod-containers-not-ready',
    'Pod containers remain not ready',
    'Pod, readiness metric',
    'Ready is False and a container ready field remains false beyond the window',
    'Ready and all container ready fields are true',
    r(
      'headlamp:source:containers-not-ready:e6a9696d06f7',
      'popeye:code:204',
      'kubernetes-mixin:alert:KubePodNotReady'
    ),
    'telemetry',
  ],
  [
    'pod-unschedulable',
    'Pod remains unschedulable',
    'Pod, Event, Node',
    'PodScheduled is False with reason Unschedulable beyond the window',
    'PodScheduled becomes True on an eligible node',
    r('headlamp:source:unschedulable:9400f4e59d12'),
  ],
  [
    'pod-evicted',
    'Pod is evicted under node pressure',
    'Pod, Node, Event, metric',
    'the Pod is Failed with reason Evicted and node eviction activity increases',
    'the replacement Pod is Running without an eviction signal',
    r('headlamp:source:evicted:df605ecccd1b', 'kubernetes-mixin:alert:KubeNodeEviction'),
    'telemetry',
  ],
  [
    'node-not-ready',
    'Node remains NotReady',
    'Node, node metric',
    'the Ready condition is False beyond the alert window',
    'the Ready condition is True and stable',
    r('popeye:code:702', 'kubernetes-mixin:alert:KubeNodeNotReady'),
    'telemetry',
  ],
  [
    'node-unreachable',
    'Node is unreachable',
    'Node, node metric',
    'Ready is Unknown because the control plane cannot reach the node',
    'Ready is True and node leases continue updating',
    r('kubernetes-mixin:alert:KubeNodeUnreachable'),
    'telemetry',
  ],
  [
    'node-pressure',
    'Node reports sustained resource pressure',
    'Node, node metric',
    'MemoryPressure, DiskPressure, or PIDPressure remains True beyond the window',
    'all pressure conditions remain False',
    r('kubernetes-mixin:alert:KubeNodePressure'),
    'telemetry',
  ],
  [
    'readonly-node-filesystem',
    'Node filesystem becomes read-only',
    'Node, kernel journal',
    'a write probe fails with EROFS and the journal reports a read-only filesystem',
    'the filesystem accepts writes without EROFS events',
    g('node-problem-detector:semantic:filesystemisreadonly:78f660613627'),
  ],
  [
    'corrupt-container-image',
    'Container image storage is corrupt',
    'Node, runtime log',
    'the runtime reports a corrupt image or layer during pull or unpack',
    'the pinned image verifies and unpacks without corruption',
    g(
      'node-problem-detector:semantic:corruptdockerimage:484510ad7562',
      'node-problem-detector:semantic:corruptcontainerimagelayer:01c949da16fd'
    ),
  ],
  [
    'containerd-unhealthy',
    'Containerd health check fails',
    'Node, containerd service',
    'containerd health checks fail for the consecutive threshold',
    'containerd health checks succeed throughout the window',
    g('node-problem-detector:semantic:containerdunhealthy:43cb9d6c429b'),
  ],
  [
    'docker-unhealthy',
    'Docker runtime health check fails',
    'Node, Docker service',
    'Docker health checks fail for the consecutive threshold',
    'Docker health checks succeed throughout the window',
    g('node-problem-detector:semantic:dockerunhealthy:6837d6adb871'),
  ],
  [
    'kubelet-unhealthy',
    'Kubelet health check fails',
    'Node, kubelet service, scrape target',
    'the kubelet health endpoint fails and its scrape target is down',
    'the kubelet health endpoint and scrape target remain healthy',
    rg(
      ['kubernetes-mixin:alert:KubeletDown'],
      ['node-problem-detector:semantic:kubeletunhealthy:0094b2d8e44b']
    ),
    'telemetry',
  ],
  [
    'frequent-containerd-restarts',
    'Containerd restarts repeatedly',
    'Node, systemd journal',
    'containerd start events exceed the configured restart threshold',
    'containerd remains active without restart events',
    g('node-problem-detector:semantic:frequentcontainerdrestart:099bf5c822da'),
  ],
  [
    'frequent-docker-restarts',
    'Docker restarts repeatedly',
    'Node, systemd journal',
    'Docker start events exceed the configured restart threshold',
    'Docker remains active without restart events',
    g('node-problem-detector:semantic:frequentdockerrestart:d57c912b9e15'),
  ],
  [
    'frequent-kubelet-restarts',
    'Kubelet restarts repeatedly',
    'Node, systemd journal',
    'kubelet start events exceed the configured restart threshold',
    'kubelet remains active without restart events',
    g('node-problem-detector:semantic:frequentkubeletrestart:4285b5dcded5'),
  ],
  [
    'node-dns-unreachable',
    'Node cannot reach its DNS resolver',
    'Node network namespace, resolver',
    'a pinned DNS lookup fails while the control address remains reachable',
    'the same lookup returns the expected address within its timeout',
    g('node-problem-detector:semantic:dnsunreachable:d3de4c93a116'),
  ],
  [
    'node-conntrack-full',
    'Node connection tracking table is full',
    'Node, kernel journal, conntrack limit',
    'the kernel reports nf_conntrack table full and drops a controlled connection',
    'conntrack occupancy stays below threshold without table-full events',
    g('node-problem-detector:semantic:conntrackfull:acdc36ea7fb8'),
  ],
];

const operations: BlueprintTuple[] = [
  [
    'deprecated-certificate-signing-request',
    'Deprecated CertificateSigningRequest API',
    'CertificateSigningRequest manifest',
    'the manifest uses certificates.k8s.io/v1beta1',
    'the manifest uses certificates.k8s.io/v1',
    r(
      'pluto:source:k8s-certificatesigningrequest-certificates-k8s-io-v1beta1-removed-v1-22-:9646c102c5bb'
    ),
    'manifest_only',
  ],
  [
    'deprecated-cronjob-apis',
    'Deprecated CronJob API tuple',
    'CronJob, CronJobList manifests',
    'the fixture uses batch/v1beta1 CronJob and CronJobList objects',
    'all CronJob objects use batch/v1',
    r(
      'pluto:source:k8s-cronjob-batch-v1beta1-removed-v1-25-0:1bded1366684',
      'pluto:source:k8s-cronjoblist-batch-v1beta1-removed-v1-25-0:434e62ec3f7e'
    ),
    'manifest_only',
  ],
  [
    'deprecated-daemonset-apis',
    'Deprecated DaemonSet API tuple',
    'DaemonSet manifests',
    'the fixture uses apps/v1beta2 and extensions/v1beta1 DaemonSets',
    'all DaemonSets use apps/v1',
    r(
      'pluto:source:k8s-daemonset-apps-v1beta2-removed-v1-16-0:9ad47832093f',
      'pluto:source:k8s-daemonset-extensions-v1beta1-removed-v1-16-0:1dcb60c48daa'
    ),
    'manifest_only',
  ],
  [
    'deprecated-deployment-apis',
    'Deprecated Deployment API tuple',
    'Deployment manifests',
    'the fixture uses apps/v1beta1, apps/v1beta2, and extensions/v1beta1 Deployments',
    'all Deployments use apps/v1',
    r(
      'pluto:source:k8s-deployment-apps-v1beta1-removed-v1-16-0:def49c0b9d54',
      'pluto:source:k8s-deployment-apps-v1beta2-removed-v1-16-0:f464ea1b4ef5',
      'pluto:source:k8s-deployment-extensions-v1beta1-removed-v1-16-0:52b91a00873a'
    ),
    'manifest_only',
  ],
  [
    'deprecated-hpa-apis',
    'Deprecated HorizontalPodAutoscaler API tuple',
    'HorizontalPodAutoscaler, HorizontalPodAutoscalerList manifests',
    'the fixture uses autoscaling/v2beta1 and v2beta2 HPA objects',
    'all HPA objects use autoscaling/v2',
    r(
      'pluto:source:k8s-horizontalpodautoscaler-autoscaling-v2beta1-removed-v1-25-0:c18509e15b36',
      'pluto:source:k8s-horizontalpodautoscaler-autoscaling-v2beta2-removed-v1-26-0:37ba0f65af9e',
      'pluto:source:k8s-horizontalpodautoscalerlist-autoscaling-v2beta1-removed-v1-25-0:944a20c0d750',
      'pluto:source:k8s-horizontalpodautoscalerlist-autoscaling-v2beta2-removed-v1-26-0:4bf7312060e0'
    ),
    'manifest_only',
  ],
  [
    'deprecated-ingress-apis',
    'Deprecated Ingress API tuple',
    'Ingress, IngressClass manifests',
    'the fixture uses extensions/v1beta1 and networking.k8s.io/v1beta1 ingress objects',
    'all ingress objects use networking.k8s.io/v1',
    r(
      'pluto:source:k8s-ingress-extensions-v1beta1-removed-v1-22-0:1b8f026f2d39',
      'pluto:source:k8s-ingress-networking-k8s-io-v1beta1-removed-v1-22-0:3db50951e529',
      'pluto:source:k8s-ingressclass-networking-k8s-io-v1beta1-removed-v1-22-0:1bbeaa2356ff'
    ),
    'manifest_only',
  ],
  [
    'deprecated-pdb-apis',
    'Deprecated PodDisruptionBudget API tuple',
    'PodDisruptionBudget, PodDisruptionBudgetList manifests',
    'the fixture uses policy/v1beta1 budget objects',
    'all PodDisruptionBudget objects use policy/v1',
    r(
      'pluto:source:k8s-poddisruptionbudget-policy-v1beta1-removed-v1-25-0:3e249c55ea46',
      'pluto:source:k8s-poddisruptionbudgetlist-policy-v1beta1-removed-v1-25-0:1cddda2a5c63'
    ),
    'manifest_only',
  ],
  [
    'deprecated-pod-security-policy-apis',
    'Deprecated PodSecurityPolicy API tuple',
    'PodSecurityPolicy manifests',
    'the fixture uses extensions/v1beta1 and policy/v1beta1 PodSecurityPolicy objects',
    'Pod Security Admission replaces PodSecurityPolicy objects',
    r(
      'pluto:source:k8s-podsecuritypolicy-extensions-v1beta1-removed-v1-16-0:0070b568bf3d',
      'pluto:source:k8s-podsecuritypolicy-policy-v1beta1-removed-v1-25-0:56234de6cfd8'
    ),
    'manifest_only',
  ],
  [
    'deprecated-priority-class-apis',
    'Deprecated PriorityClass API tuple',
    'PriorityClass manifests',
    'the fixture uses scheduling.k8s.io/v1alpha1 and v1beta1 PriorityClass objects',
    'all PriorityClass objects use scheduling.k8s.io/v1',
    r(
      'pluto:source:k8s-priorityclass-scheduling-k8s-io-v1alpha1-removed-v1-17-0:710ad98cf8d7',
      'pluto:source:k8s-priorityclass-scheduling-k8s-io-v1beta1-removed-v1-22-0:56f9625c1c50'
    ),
    'manifest_only',
  ],
  [
    'deprecated-replicaset-apis',
    'Deprecated ReplicaSet API tuple',
    'ReplicaSet manifests',
    'the fixture uses apps/v1beta1, apps/v1beta2, and extensions/v1beta1 ReplicaSets',
    'all ReplicaSets use apps/v1',
    r(
      'pluto:source:k8s-replicaset-apps-v1beta1-removed-v1-16-0:4e874be21cad',
      'pluto:source:k8s-replicaset-apps-v1beta2-removed-v1-16-0:da0db342c94b',
      'pluto:source:k8s-replicaset-extensions-v1beta1-removed-v1-16-0:89b17351d250'
    ),
    'manifest_only',
  ],
  [
    'deprecated-runtime-class-api',
    'Deprecated RuntimeClass API',
    'RuntimeClass manifest',
    'the manifest uses node.k8s.io/v1beta1 RuntimeClass',
    'the RuntimeClass uses node.k8s.io/v1',
    r('pluto:source:k8s-runtimeclass-node-k8s-io-v1beta1-removed-v1-25-0:a4f6cf0bb945'),
    'manifest_only',
  ],
  [
    'deprecated-statefulset-apis',
    'Deprecated StatefulSet API tuple',
    'StatefulSet manifests',
    'the fixture uses apps/v1beta1 and apps/v1beta2 StatefulSets',
    'all StatefulSets use apps/v1',
    r(
      'pluto:source:k8s-statefulset-apps-v1beta1-removed-v1-16-0:03a7b24b475c',
      'pluto:source:k8s-statefulset-apps-v1beta2-removed-v1-16-0:1c6b01fbee41'
    ),
    'manifest_only',
  ],
  [
    'deprecated-storage-class-api',
    'Deprecated StorageClass API',
    'StorageClass manifest',
    'the manifest uses storage.k8s.io/v1beta1 StorageClass',
    'the StorageClass uses storage.k8s.io/v1',
    r('pluto:source:k8s-storageclass-storage-k8s-io-v1beta1-removed-v1-22-0:46b8cba8c336'),
    'manifest_only',
  ],
  [
    'deprecated-volume-attachment-api',
    'Deprecated VolumeAttachment API',
    'VolumeAttachment manifest',
    'the manifest uses storage.k8s.io/v1beta1 VolumeAttachment',
    'the VolumeAttachment uses storage.k8s.io/v1',
    r('pluto:source:k8s-volumeattachment-storage-k8s-io-v1beta1-removed-v1-22-0:296840b277da'),
    'manifest_only',
  ],
  [
    'persistent-volume-phase-errors',
    'PersistentVolume enters an error phase',
    'PersistentVolume, volume metric',
    'a PersistentVolume remains Failed or Pending beyond the window',
    'the PersistentVolume is Bound without a phase-error alert',
    r('kubernetes-mixin:alert:KubePersistentVolumeErrors', 'popeye:code:1001', 'popeye:code:1002'),
  ],
  [
    'persistent-volume-claim-phase-errors',
    'PersistentVolumeClaim remains Pending or Lost',
    'PersistentVolumeClaim',
    'a claim remains Pending or enters Lost after the provisioning window',
    'the claim reaches Bound and remains associated with its volume',
    r('popeye:code:1003', 'popeye:code:1004'),
    'live_cluster',
  ],
  [
    'persistent-volume-filling-up',
    'PersistentVolume is filling up',
    'PersistentVolumeClaim, volume metric',
    'predicted free bytes cross the exhaustion threshold',
    'predicted free bytes remain above the threshold',
    r('kubernetes-mixin:alert:KubePersistentVolumeFillingUp'),
  ],
  [
    'persistent-volume-inodes-filling-up',
    'PersistentVolume inodes are filling up',
    'PersistentVolumeClaim, inode metric',
    'predicted free inodes cross the exhaustion threshold',
    'predicted free inodes remain above the threshold',
    r('kubernetes-mixin:alert:KubePersistentVolumeInodesFillingUp'),
  ],
  [
    'job-failed',
    'Job has failed',
    'Job, Pod, job metric',
    'the Job failed condition is True or failures exceed backoffLimit',
    'the Job complete condition is True without failure',
    r('kubernetes-mixin:alert:KubeJobFailed', 'popeye:code:1502'),
  ],
  [
    'job-not-completed',
    'Job misses its completion deadline',
    'Job, job metric',
    'the active Job age exceeds its declared completion deadline',
    'the Job completes before its deadline',
    r('kubernetes-mixin:alert:KubeJobNotCompleted', 'popeye:code:1501'),
  ],
  [
    'api-error-budget-burn',
    'API server error budget burns too quickly',
    'API server request metric',
    'the multi-window API availability burn rate exceeds its fast-burn threshold',
    'API error ratios remain below every burn-rate threshold',
    r('kubernetes-mixin:alert:KubeAPIErrorBudgetBurn'),
  ],
  [
    'cluster-certificate-expiration',
    'Cluster certificates near expiration',
    'API server, kubelet certificate metrics',
    'a client, kubelet client, or kubelet server certificate falls below the warning horizon',
    'all observed certificate lifetimes exceed the warning horizon',
    r(
      'kubernetes-mixin:alert:KubeClientCertificateExpiration',
      'kubernetes-mixin:alert:KubeletClientCertificateExpiration',
      'kubernetes-mixin:alert:KubeletServerCertificateExpiration'
    ),
  ],
  [
    'daemonset-rollout-failure',
    'DaemonSet rollout cannot converge',
    'DaemonSet, kube-state-metrics',
    'desired pods are unavailable, unscheduled, or on ineligible nodes beyond the window',
    'desired, current, ready, and available pod counts converge',
    r(
      'kubernetes-mixin:alert:KubeDaemonSetRolloutStuck',
      'kubernetes-mixin:alert:KubeDaemonSetMisScheduled',
      'kubernetes-mixin:alert:KubeDaemonSetNotScheduled'
    ),
  ],
  [
    'statefulset-rollout-failure',
    'StatefulSet rollout cannot converge',
    'StatefulSet, kube-state-metrics',
    'observed generation, ready replicas, or updated replicas fail to converge',
    'generation is current and all desired replicas are ready and updated',
    r(
      'kubernetes-mixin:alert:KubeStatefulSetGenerationMismatch',
      'kubernetes-mixin:alert:KubeStatefulSetReplicasMismatch',
      'kubernetes-mixin:alert:KubeStatefulSetUpdateNotRolledOut'
    ),
  ],
  [
    'cluster-resource-overcommit',
    'Cluster CPU and memory requests are overcommitted',
    'Pod, Node, scheduler metrics',
    'aggregate pod requests exceed allocatable CPU or memory after tolerance',
    'aggregate requests remain within allocatable CPU and memory',
    r('kubernetes-mixin:alert:KubeCPUOvercommit', 'kubernetes-mixin:alert:KubeMemoryOvercommit'),
  ],
];

function expand(
  category: Category,
  defaultFeasibility: Feasibility,
  rows: BlueprintTuple[]
): Blueprint[] {
  return rows.map(([slug, title, resource, trigger, healthy, targets, feasibility]) => ({
    category,
    slug,
    title,
    resource,
    trigger,
    healthy,
    targets,
    feasibility: feasibility ?? defaultFeasibility,
  }));
}

const blueprints = [
  ...expand('workload_configuration', 'manifest_only', workload),
  ...expand('control_plane_host_hardening', 'host', hardening),
  ...expand('runtime_node_failure', 'runtime', runtime),
  ...expand('operations_deprecation', 'telemetry', operations),
];

const defaultProfiles: Record<Feasibility, ClusterProfile[]> = {
  manifest_only: ['local-kwok', 'local-minikube', 'aks'],
  live_cluster: ['local-kwok', 'local-minikube', 'aks'],
  telemetry: ['local-minikube', 'aks'],
  host: ['local-minikube'],
  cloud: ['aks'],
  runtime: ['local-minikube', 'aks'],
  custom_crd: ['local-minikube', 'aks'],
};
const defaultMechanisms: Record<Feasibility, string[]> = {
  manifest_only: ['manifest parser', 'normalized predicate evaluator'],
  live_cluster: ['Kubernetes API', 'status and event observation'],
  telemetry: ['Kubernetes API', 'time-series metric evidence', 'bounded observation window'],
  host: ['host filesystem inspection', 'component configuration inspection'],
  cloud: ['Kubernetes API', 'cloud provider API'],
  runtime: ['Kubernetes API', 'node or container runtime observation'],
  custom_crd: ['Kubernetes API', 'custom resource definition and controller'],
};

const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as Inventory;
const mapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as Mapping;
const inventoryRules = inventory.tools.flatMap(tool =>
  tool.rules.map(rule => ({
    ...rule,
    tool_id: tool.tool_id,
    revision: tool.revision,
    readiness: rule.mapping_readiness ?? tool.mapping_readiness,
  }))
);
const byId = new Map(inventoryRules.map(rule => [rule.rule_id, rule]));
const byGroup = new Map<string, typeof inventoryRules>();
for (const rule of inventoryRules) {
  const members = byGroup.get(rule.semantic_group_id) ?? [];
  members.push(rule);
  byGroup.set(rule.semantic_group_id, members);
}
const statusById = new Map(
  mapping.rule_mappings.flatMap(tool =>
    tool.rules.map(rule => [rule.rule_id, rule.status] as const)
  )
);

assert.equal(blueprints.length, 100, 'expected exactly 100 blueprints');
assert.deepEqual(
  Object.fromEntries(
    [...new Set(blueprints.map(item => item.category))]
      .sort()
      .map(category => [category, blueprints.filter(item => item.category === category).length])
  ),
  {
    control_plane_host_hardening: 25,
    operations_deprecation: 25,
    runtime_node_failure: 20,
    workload_configuration: 30,
  }
);
const scenarioIds = blueprints.map(item => `rule-gap-${item.slug}`);
assert.equal(new Set(scenarioIds).size, 100, 'scenario IDs must be unique');

const claimedRuleIds = new Set<string>();
const scenarios = blueprints.map((item, index) => {
  const selected = new Map<string, (typeof inventoryRules)[number]>();
  for (const ruleId of item.targets.ruleIds ?? []) {
    const rule = byId.get(ruleId);
    assert.ok(rule, `unknown target rule ${ruleId}`);
    selected.set(ruleId, rule);
  }
  for (const groupId of item.targets.semanticGroupIds ?? []) {
    const members = byGroup.get(groupId);
    assert.ok(members?.length, `unknown semantic group ${groupId}`);
    for (const rule of members) selected.set(rule.rule_id, rule);
  }
  const targetRules = [...selected.values()].sort((left, right) =>
    left.rule_id.localeCompare(right.rule_id)
  );
  assert.ok(targetRules.length > 0, `${item.slug} has no targets`);
  for (const rule of targetRules) {
    assert.equal(rule.readiness, 'direct_predicate', `${rule.rule_id} is not direct`);
    assert.equal(statusById.get(rule.rule_id), 'uncovered', `${rule.rule_id} is not uncovered`);
    assert.equal(claimedRuleIds.has(rule.rule_id), false, `${rule.rule_id} is targeted twice`);
    assert.ok(rule.info_url.startsWith('https://'), `${rule.rule_id} has no source URL`);
    assert.ok(rule.info_url.includes(rule.revision), `${rule.rule_id} URL is not revision-pinned`);
    claimedRuleIds.add(rule.rule_id);
  }
  return {
    scenario_id: scenarioIds[index]!,
    title: item.title,
    category: item.category,
    setup_summary: `Create an isolated ${item.resource} fixture where ${item.trigger}. Include a healthy control differing only in that predicate.`,
    trigger_predicate: item.trigger,
    expected_finding: `Identify ${item.title.toLowerCase()} and cite the exact field, status, event, log, or metric satisfying the trigger.`,
    healthy_condition: item.healthy,
    required_resources: item.resource.split(',').map(value => value.trim()),
    required_mechanisms: defaultMechanisms[item.feasibility],
    supported_cluster_profiles: defaultProfiles[item.feasibility],
    feasibility: item.feasibility,
    target_rule_ids: targetRules.map(rule => rule.rule_id),
    target_semantic_group_ids: [...new Set(targetRules.map(rule => rule.semantic_group_id))].sort(),
    target_tool_ids: [...new Set(targetRules.map(rule => rule.tool_id))].sort(),
    target_rule_count: targetRules.length,
    provenance_refs: [...new Set(targetRules.map(rule => rule.info_url))].sort(),
    lifecycle_state: 'draft',
    qualification_status: 'pending',
    qualification_blockers: [
      {
        kind: 'setup',
        detail: `Generate and validate the ${item.resource} fixture and healthy control with source-grounded agents.`,
      },
      {
        kind: 'observation',
        detail: `Prove the required ${item.feasibility} evidence is stable for a bounded window.`,
      },
      {
        kind: 'oracle',
        detail:
          'Generate positive, healthy-control, and confounder assertions, then verify them with a separate critic agent.',
      },
      {
        kind: 'leakage',
        detail: 'Keep rule names and expected findings out of candidate-visible inputs.',
      },
    ],
  };
});

const coverageByTool = Object.fromEntries(
  [...new Set(scenarios.flatMap(scenario => scenario.target_tool_ids))]
    .sort()
    .map(toolId => [
      toolId,
      scenarios
        .flatMap(scenario => scenario.target_rule_ids)
        .filter(ruleId => ruleId.startsWith(`${toolId}:`)).length,
    ])
);
const scenarioCountsByFeasibility = Object.fromEntries(
  [...new Set(scenarios.map(scenario => scenario.feasibility))]
    .sort()
    .map(feasibility => [
      feasibility,
      scenarios.filter(scenario => scenario.feasibility === feasibility).length,
    ])
);
const coverageByFeasibility = Object.fromEntries(
  [...new Set(scenarios.map(scenario => scenario.feasibility))]
    .sort()
    .map(feasibility => [
      feasibility,
      scenarios
        .filter(scenario => scenario.feasibility === feasibility)
        .reduce((count, scenario) => count + scenario.target_rule_count, 0),
    ])
);
const coverageByCategory = Object.fromEntries(
  [...new Set(scenarios.map(scenario => scenario.category))]
    .sort()
    .map(category => [
      category,
      scenarios
        .filter(scenario => scenario.category === category)
        .reduce((count, scenario) => count + scenario.target_rule_count, 0),
    ])
);
const document = {
  schema_version: '1.0.0',
  generated_at: '2026-09-20',
  review_status: 'provisional',
  inventory_path: 'registrations/tool-rule-inventory-v1.json',
  mapping_path: 'registrations/tool-scenario-rule-mapping-v1.json',
  scenarios_goal: SCENARIOS_GOAL,
  methodology: {
    selection:
      'Exact rule IDs and semantic-group IDs select only uncovered direct predicates; titles are never used for matching.',
    deduplication:
      'Each occurrence belongs to one draft. Kube-bench profile variants expand from one semantic group into one scenario.',
    qualification:
      'Drafts remain outside the active roster until setup, observation, oracle, and leakage blockers are resolved.',
  },
  total_scenarios: scenarios.length,
  total_target_rules: claimedRuleIds.size,
  total_target_semantic_groups: new Set(
    scenarios.flatMap(scenario => scenario.target_semantic_group_ids)
  ).size,
  category_counts: {
    workload_configuration: 30,
    control_plane_host_hardening: 25,
    runtime_node_failure: 20,
    operations_deprecation: 25,
  },
  coverage_by_tool: coverageByTool,
  coverage_by_feasibility: coverageByFeasibility,
  scenario_counts_by_feasibility: scenarioCountsByFeasibility,
  scenarios,
};

const prettierConfig = (await prettier.resolveConfig(outputPath)) ?? {};
writeFileSync(
  outputPath,
  prettier.format(JSON.stringify(document), { ...prettierConfig, parser: 'json' })
);

const categoryLabels: Record<Category, string> = {
  workload_configuration: 'Workload/configuration',
  control_plane_host_hardening: 'Control-plane/host hardening',
  runtime_node_failure: 'Runtime/node failure',
  operations_deprecation: 'Operations/deprecation',
};
const markdown = [
  '# Kubernetes rule-gap draft scenarios',
  '',
  'Status: provisional, 2026-09-20',
  '',
  'This catalogue proposes 100 repository-owned scenario specifications for currently',
  'uncovered, directly evaluable rules. The machine-readable source is',
  '[`rule-gap-scenarios-v1.json`](../evals/registrations/rule-gap-scenarios-v1.json),',
  'validated by',
  '[`rule-gap-scenarios.schema.json`](../evals/schema/rule-gap-scenarios.schema.json)',
  'and generated by',
  '[`generateRuleGapScenarios.ts`](../evals/src/scenarios/generateRuleGapScenarios.ts).',
  'These drafts are deliberately absent from the 275-scenario active roster.',
  'A [second marginal-coverage batch](kubernetes-rule-gap-scenarios-v2.md) adds',
  '42 non-overlapping drafts without changing that roster.',
  '',
  '## Scenarios Goal',
  '',
  `> ${SCENARIOS_GOAL.statement}`,
  '',
  'See [Scenarios Goal](kubernetes-scenarios-goal.md) for the canonical denominator,',
  'risk model, milestones, and qualification gates.',
  '',
  'These tool-local targets are discovery and progress measures. Completion is measured',
  'against reviewed cross-tool canonical capabilities, and only qualified scenarios count.',
  'The scenarios reproduce Kubernetes states and normalized predicates; they do not install',
  'or execute the surveyed tools named by `target_rule_ids`.',
  '',
  '## Methodology',
  '',
  '- Select rules only by exact `rule_id` or exact `semantic_group_id`; titles are',
  '  descriptive and are never matching keys.',
  '- Require effective readiness `direct_predicate` and current mapping status',
  '  `uncovered`. Covered rules are rejected.',
  '- Assign each rule occurrence to one scenario. Duplicate targets fail generation.',
  '- Expand each selected kube-bench semantic group into one scenario so benchmark',
  '  profile variants remain provenance-rich occurrences without becoming false cases.',
  '- Put multiple Pluto API-version tuples in one scenario only when one',
  '  multi-document manifest can exercise those objects together.',
  '- Prefer cross-tool overlap where predicates are equivalent, while keeping',
  '  runtime, telemetry, host, and manifest evidence requirements explicit.',
  '',
  '## Allocation and coverage',
  '',
  '| Category | Drafts | Target occurrences |',
  '| --- | ---: | ---: |',
  ...Object.entries(document.category_counts).map(
    ([category, count]) =>
      `| ${categoryLabels[category as Category]} | ${count} | ${coverageByCategory[category]} |`
  ),
  `| **Total** | **${document.total_scenarios}** | **${document.total_target_rules.toLocaleString(
    'en-US'
  )}** |`,
  '',
  `The ${document.total_target_rules.toLocaleString('en-US')} target occurrences represent ${
    document.total_target_semantic_groups
  } tool-local semantic groups across ${Object.keys(document.coverage_by_tool).length} tools.`,
  '',
  '| Tool | Target occurrences |',
  '| --- | ---: |',
  ...Object.entries(document.coverage_by_tool).map(([tool, count]) => `| ${tool} | ${count} |`),
  '',
  '| Feasibility | Drafts | Target occurrences |',
  '| --- | ---: | ---: |',
  ...Object.entries(document.scenario_counts_by_feasibility).map(
    ([feasibility, count]) =>
      `| ${feasibility} | ${count} | ${document.coverage_by_feasibility[feasibility]} |`
  ),
  '',
  '## Limitations',
  '',
  'These are specifications, not qualified evaluator scenarios. Every row remains',
  '`draft` and `pending` until its setup, observation window, independent oracle,',
  'and leakage controls are implemented and reviewed. Kube-bench profile expansion',
  'explains most occurrence coverage; it does not imply 896 independent hardening',
  'behaviors. Telemetry drafts require the named metrics and enough time to cross',
  'their alert windows. Host checks generally require a self-managed control plane',
  'and are not claimed for AKS. Manifest-only deprecation fixtures prove static',
  'detection, not admission or upgrade behavior. No target count is an end-to-end',
  'candidate coverage claim.',
  '',
  '## Draft catalogue',
  '',
  '| Scenario ID | Title | Targets |',
  '| --- | --- | ---: |',
  ...scenarios.map(
    scenario => `| ${scenario.scenario_id} | ${scenario.title} | ${scenario.target_rule_count} |`
  ),
  '',
].join('\n');
const markdownPrettierConfig = (await prettier.resolveConfig(documentationPath)) ?? {};
writeFileSync(
  documentationPath,
  prettier.format(markdown, { ...markdownPrettierConfig, parser: 'markdown' })
);

console.log(
  `Wrote ${scenarios.length} drafts targeting ${
    claimedRuleIds.size
  } rule occurrences and ${path.relative(evalRoot, documentationPath)}.`
);
