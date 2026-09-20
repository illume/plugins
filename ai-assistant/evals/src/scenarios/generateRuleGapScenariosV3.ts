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
type Feasibility = 'manifest_only' | 'live_cluster' | 'telemetry' | 'host' | 'runtime';
type SelectionTrack = 'falco_chain' | 'node_problem_detector' | 'policy' | 'operations';
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

interface Blueprint {
  slug: string;
  title: string;
  selectionTrack: SelectionTrack;
  category: Category;
  feasibility: Feasibility;
  resources: string[];
  setup: string;
  trigger: string;
  healthy: string;
  ruleIds: string[];
  semanticGroupIds: string[];
  mechanisms?: string[];
  profiles?: ClusterProfile[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const registrations = path.join(evalRoot, 'registrations');
const inventoryPath = path.join(registrations, 'tool-rule-inventory-v1.json');
const mappingPath = path.join(registrations, 'tool-scenario-rule-mapping-v1.json');
const v1Path = path.join(registrations, 'rule-gap-scenarios-v1.json');
const v2Path = path.join(registrations, 'rule-gap-scenarios-v2.json');
const outputPath = path.join(registrations, 'rule-gap-scenarios-v3.json');
const documentationPath = path.resolve(
  evalRoot,
  '..',
  'docs',
  'kubernetes-rule-gap-scenarios-v3.md'
);

const blueprint = (
  slug: string,
  title: string,
  trigger: string,
  healthy: string,
  resources: string[],
  ruleIds: string[],
  options: Partial<
    Pick<
      Blueprint,
      'selectionTrack' | 'category' | 'feasibility' | 'semanticGroupIds' | 'mechanisms' | 'profiles'
    >
  > = {}
): Blueprint => ({
  slug,
  title,
  selectionTrack: options.selectionTrack ?? 'policy',
  category: options.category ?? 'workload_configuration',
  feasibility: options.feasibility ?? 'manifest_only',
  resources,
  setup: `Create one isolated ${resources.join(
    ', '
  )} fixture satisfying the predicate and a healthy control differing only in that state.`,
  trigger,
  healthy,
  ruleIds,
  semanticGroupIds: options.semanticGroupIds ?? [],
  mechanisms: options.mechanisms,
  profiles: options.profiles,
});

const policy = blueprint;
const telemetry = (
  slug: string,
  title: string,
  trigger: string,
  healthy: string,
  resources: string[],
  ruleIds: string[]
): Blueprint =>
  blueprint(slug, title, trigger, healthy, resources, ruleIds, {
    selectionTrack: 'operations',
    category: 'runtime_node_failure',
    feasibility: 'telemetry',
  });
const runtime = (
  slug: string,
  title: string,
  trigger: string,
  healthy: string,
  resources: string[],
  ruleIds: string[]
): Blueprint =>
  blueprint(slug, title, trigger, healthy, resources, ruleIds, {
    selectionTrack: 'falco_chain',
    category: 'runtime_node_failure',
    feasibility: 'runtime',
  });
const node = (
  slug: string,
  title: string,
  trigger: string,
  healthy: string,
  ruleIds: string[],
  profiles: ClusterProfile[] = ['local-minikube', 'aks']
): Blueprint =>
  blueprint(slug, title, trigger, healthy, ['Node', 'node evidence fixture'], ruleIds, {
    selectionTrack: 'node_problem_detector',
    category: 'runtime_node_failure',
    feasibility: 'host',
    profiles,
  });
const deprecation = (
  slug: string,
  title: string,
  trigger: string,
  healthy: string,
  resources: string[],
  ruleIds: string[]
): Blueprint =>
  blueprint(slug, title, trigger, healthy, resources, ruleIds, {
    selectionTrack: 'operations',
    category: 'operations_deprecation',
  });

const blueprints: Blueprint[] = [
  policy(
    'pod-shares-host-ipc',
    'Pod shares the host IPC namespace',
    'The Pod spec sets hostIPC to true.',
    'The Pod leaves hostIPC false or unset.',
    ['Pod'],
    [
      'kube-linter:check:host-ipc',
      'polaris:check:hostIPCSet',
      'kubescape:rule:host-ipc-privileges',
    ],
    {
      semanticGroupIds: [
        'kube-bench:semantic:minimize-the-admission-of-containers-wishing-to-share-the-host-ipc-namespace:f641f7f897d3',
      ],
    }
  ),
  policy(
    'pod-shares-host-pid',
    'Pod shares the host process namespace',
    'The Pod spec sets hostPID to true.',
    'The Pod leaves hostPID false or unset.',
    ['Pod'],
    [
      'kube-linter:check:host-pid',
      'polaris:check:hostPIDSet',
      'kubescape:rule:host-pid-privileges',
      'kubescape:rule:host-pid-ipc-privileges',
    ],
    {
      semanticGroupIds: [
        'kube-bench:semantic:minimize-the-admission-of-containers-wishing-to-share-the-host-process-id-namesp:fe291177eeb9',
      ],
    }
  ),
  policy(
    'container-allows-privilege-escalation',
    'Container allows privilege escalation',
    'The container security context sets allowPrivilegeEscalation to true.',
    'The container explicitly sets allowPrivilegeEscalation to false.',
    ['Pod', 'Container'],
    [
      'kube-linter:check:privilege-escalation-container',
      'polaris:check:privilegeEscalationAllowed',
      'kubescape:rule:rule-allow-privilege-escalation',
    ]
  ),
  policy(
    'container-unmasks-proc',
    'Container uses an unmasked proc mount',
    'The container security context sets procMount to Unmasked.',
    'The container uses the runtime default proc mount.',
    ['Pod', 'Container'],
    [
      'kube-linter:check:unsafe-proc-mount',
      'polaris:check:procMount',
      'kubescape:rule:set-procmount-default',
    ]
  ),
  policy(
    'container-missing-seccomp-profile',
    'Container has no seccomp profile',
    'Neither the Pod nor container security context specifies a seccomp profile.',
    'The container inherits or declares RuntimeDefault seccomp.',
    ['Pod', 'Container'],
    [
      'kube-score:check:container-seccomp-profile',
      'kubescape:rule:set-seccomp-profile',
      'kubescape:rule:set-seccomp-profile-RuntimeDefault',
    ],
    {
      semanticGroupIds: [
        'kube-bench:semantic:ensure-that-the-seccomp-profile-is-set-to-runtimedefault-in-your-pod-definitions:1e77c126ee8a',
      ],
    }
  ),
  policy(
    'container-image-tag-omitted',
    'Container image omits an immutable tag',
    'The container image has no explicit tag and therefore resolves as latest.',
    'The container image uses an explicit non-latest immutable tag.',
    ['Pod', 'Container'],
    ['kube-score:check:container-image-tag', 'polaris:check:tagNotSpecified']
  ),
  policy(
    'service-uses-nodeport',
    'Service exposes a NodePort',
    'The Service type is NodePort and allocates a node-level port.',
    'The Service uses ClusterIP without a node-level port.',
    ['Service'],
    ['kube-linter:check:exposed-services', 'kube-score:check:service-type', 'popeye:code:1104']
  ),
  policy(
    'hpa-minimum-replicas-too-low',
    'HorizontalPodAutoscaler minimum is below the resilience floor',
    'The HorizontalPodAutoscaler sets minReplicas to one.',
    'The HorizontalPodAutoscaler sets minReplicas to at least three.',
    ['HorizontalPodAutoscaler', 'Deployment'],
    [
      'kube-linter:check:hpa-minimum-three-replicas',
      'kube-score:check:horizontalpodautoscaler-replicas',
    ]
  ),
  policy(
    'secret-exposed-through-environment',
    'Container exposes a Secret through environment variables',
    'The container imports a Secret key as an environment variable.',
    'The Secret is mounted as a read-only volume instead of an environment variable.',
    ['Pod', 'Secret'],
    [
      'kube-linter:check:env-var-secret',
      'kube-linter:check:read-secret-from-env-var',
      'polaris:check:sensitiveContainerEnvVar',
      'kubescape:rule:rule-credentials-in-env-var',
      'kubescape:rule:rule-secrets-in-env-var',
    ]
  ),
  policy(
    'pod-uses-default-service-account',
    'Pod uses the default ServiceAccount',
    'The Pod resolves to the namespace default ServiceAccount with token automount enabled.',
    'The Pod names a dedicated least-privilege ServiceAccount with token automount disabled.',
    ['Pod', 'ServiceAccount'],
    [
      'kube-linter:check:default-service-account',
      'kubescape:rule:automount-default-service-account',
      'popeye:code:300',
      'popeye:code:308',
    ]
  ),
  policy(
    'rbac-subject-can-create-pods',
    'RBAC subject can create Pods',
    'A Role grants the subject create on the pods resource.',
    'The subject has no create permission on Pods.',
    ['Role', 'RoleBinding', 'ServiceAccount'],
    ['kube-linter:check:access-to-create-pods', 'kubescape:rule:rule-can-create-pod']
  ),
  policy(
    'rbac-subject-can-read-secrets',
    'RBAC subject can read Secrets',
    'A Role grants the subject get or list on the secrets resource.',
    'The subject has no read permission on Secrets.',
    ['Role', 'RoleBinding', 'ServiceAccount', 'Secret'],
    ['kube-linter:check:access-to-secrets', 'kubescape:rule:rule-can-list-get-secrets-v1']
  ),
  policy(
    'rbac-role-uses-wildcards',
    'RBAC role grants wildcard permissions',
    'A Role rule contains a wildcard verb or resource and is bound to a subject.',
    'The Role enumerates only the required verbs and resources.',
    ['Role', 'RoleBinding', 'ServiceAccount'],
    ['kube-linter:check:wildcard-in-rules', 'polaris:check:rolebindingClusterAdminRole']
  ),
  policy(
    'rbac-subject-can-exec-into-pods',
    'RBAC subject can exec into Pods',
    'A bound RBAC role grants create on pods/exec.',
    'The bound role omits pods/exec and pods/attach permissions.',
    ['Role', 'RoleBinding', 'ServiceAccount'],
    [
      'polaris:check:rolePodExecAttach',
      'polaris:check:rolebindingRolePodExecAttach',
      'kubescape:rule:exec-into-container-v1',
    ]
  ),
  policy(
    'container-references-missing-configmap',
    'Container references a missing ConfigMap',
    'A container envFrom reference names a ConfigMap that does not exist.',
    'The referenced ConfigMap exists in the Pod namespace.',
    ['Pod', 'ConfigMap'],
    ['kube-linter:check:env-value-from', 'kubevious:rule:container-env-from-config-map-ref']
  ),
  policy(
    'container-references-missing-secret',
    'Container references a missing Secret',
    'A container envFrom reference names a Secret that does not exist.',
    'The referenced Secret exists in the Pod namespace.',
    ['Pod', 'Secret'],
    ['kubevious:rule:container-env-from-secret-ref', 'popeye:code:304']
  ),
  policy(
    'pod-references-missing-service-account',
    'Workload Pod names a nonexistent ServiceAccount',
    'The Pod names a ServiceAccount that does not exist in its namespace.',
    'The named ServiceAccount exists in the Pod namespace.',
    ['Pod', 'ServiceAccount'],
    ['kubevious:rule:pod-spec-service-account-ref', 'popeye:code:507']
  ),
  policy(
    'rolebinding-references-missing-role',
    'RoleBinding references a missing role',
    'The RoleBinding roleRef names a Role that does not exist.',
    'The referenced Role exists and has the intended scope.',
    ['RoleBinding', 'Role'],
    ['kubevious:rule:role-binding-role-ref']
  ),
  policy(
    'servicemonitor-selector-matches-no-service',
    'ServiceMonitor selector matches no Service',
    'The ServiceMonitor selector matches no Service labels in its selected namespaces.',
    'At least one intended Service matches the ServiceMonitor selector.',
    ['ServiceMonitor', 'Service'],
    ['kube-linter:check:dangling-servicemonitor']
  ),
  policy(
    'hpa-references-missing-target',
    'HorizontalPodAutoscaler references a missing target',
    'The HorizontalPodAutoscaler scaleTargetRef names a workload that does not exist.',
    'The scaleTargetRef resolves to a scalable workload.',
    ['HorizontalPodAutoscaler', 'Deployment'],
    [
      'kube-score:check:horizontalpodautoscaler-has-target',
      'kubescape:rule:hpa-has-target',
      'popeye:code:600',
    ]
  ),
  policy(
    'deployment-has-no-pdb',
    'Deployment has no PodDisruptionBudget',
    'No PodDisruptionBudget selector covers the Deployment Pods.',
    'A PodDisruptionBudget selects the Deployment Pods with a viable budget.',
    ['Deployment', 'PodDisruptionBudget'],
    ['kube-score:check:deployment-has-poddisruptionbudget']
  ),
  policy(
    'statefulset-has-no-pdb',
    'StatefulSet has no PodDisruptionBudget',
    'No PodDisruptionBudget selector covers the StatefulSet Pods.',
    'A PodDisruptionBudget selects the StatefulSet Pods with a viable budget.',
    ['StatefulSet', 'PodDisruptionBudget'],
    ['kube-score:check:statefulset-has-poddisruptionbudget']
  ),
  policy(
    'pdb-omits-unhealthy-eviction-policy',
    'PodDisruptionBudget omits unhealthy Pod eviction policy',
    'The PodDisruptionBudget leaves unhealthyPodEvictionPolicy unset.',
    'The PodDisruptionBudget explicitly selects the reviewed unhealthy Pod eviction policy.',
    ['PodDisruptionBudget'],
    ['kube-linter:check:pdb-unhealthy-pod-eviction-policy']
  ),
  policy(
    'cronjob-misses-starting-deadline',
    'CronJob has no starting deadline',
    'The CronJob leaves startingDeadlineSeconds unset.',
    'The CronJob declares a bounded starting deadline.',
    ['CronJob'],
    ['kube-score:check:cronjob-has-deadline']
  ),
  policy(
    'ingress-has-no-tls',
    'Ingress exposes HTTP without TLS',
    'The Ingress has HTTP rules but no TLS hosts or certificate Secret.',
    'The Ingress serves every host through a valid TLS Secret.',
    ['Ingress', 'Secret', 'Service'],
    [
      'polaris:check:tlsSettingsMissing',
      'kubescape:rule:encrypt-traffic-to-https-load-balancers-with-tls-certificates',
    ]
  ),
  policy(
    'ingress-references-missing-service',
    'Ingress references a missing Service',
    'An Ingress backend names a Service that does not exist.',
    'Every Ingress backend resolves to an existing Service and port.',
    ['Ingress', 'Service'],
    ['kubevious:rule:ingress-ext-service-ref', 'popeye:code:1402']
  ),
  policy(
    'gateway-references-missing-class',
    'Gateway references a missing GatewayClass',
    'The Gateway gatewayClassName does not resolve to a GatewayClass.',
    'The Gateway references an accepted GatewayClass.',
    ['Gateway', 'GatewayClass'],
    ['kubevious:rule:gateway-class-ref']
  ),
  policy(
    'httproute-references-missing-backend',
    'HTTPRoute references a missing backend Service',
    'An HTTPRoute backendRef names a Service that does not exist.',
    'Every HTTPRoute backendRef resolves to an existing Service and port.',
    ['HTTPRoute', 'Service', 'Gateway'],
    ['kubevious:rule:http-route-backend-ref', 'kubescape:rule:dangling-gateway-backend']
  ),
  policy(
    'pod-mounts-container-runtime-socket',
    'Pod mounts the container runtime socket',
    'A hostPath volume exposes the node container runtime socket inside a container.',
    'The Pod has no hostPath to a container runtime socket.',
    ['Pod', 'hostPath'],
    ['kube-linter:check:docker-sock', 'kubescape:rule:containers-mounting-docker-socket']
  ),
  policy(
    'pod-sets-unsafe-sysctl',
    'Pod sets an unsafe sysctl',
    'The Pod security context declares a sysctl outside the safe allowlist.',
    'The Pod declares only safe sysctls or none.',
    ['Pod'],
    ['kube-linter:check:unsafe-sysctls', 'kubescape:rule:set-sysctls-params']
  ),
  policy(
    'pod-misses-priority-class',
    'Pod has no valid PriorityClass',
    'The Pod omits priorityClassName or names a PriorityClass that does not exist.',
    'The Pod references an existing reviewed PriorityClass.',
    ['Pod', 'PriorityClass'],
    ['kube-linter:check:priority-class-name', 'polaris:check:priorityClassNotSet']
  ),
  policy(
    'container-binds-host-port',
    'Container binds a host port',
    'A container port declares a nonzero hostPort.',
    'The workload is reached through a Service without hostPort.',
    ['Pod', 'Service'],
    ['polaris:check:hostPortSet', 'kubescape:rule:container-hostPort']
  ),
  telemetry(
    'cpu-throttling-sustained',
    'Container CPU throttling remains high',
    'The throttled-period ratio exceeds the pinned threshold for the alert duration.',
    'The throttled-period ratio remains below the threshold.',
    ['Pod', 'Prometheus metrics'],
    ['kubernetes-mixin:alert:CPUThrottlingHigh']
  ),
  telemetry(
    'aggregated-api-unavailable',
    'Aggregated API is unavailable and returning errors',
    'An APIService is unavailable while aggregated API error responses exceed the pinned ratio.',
    'The APIService remains available without an elevated error ratio.',
    ['APIService', 'Prometheus metrics'],
    [
      'kubernetes-mixin:alert:KubeAggregatedAPIDown',
      'kubernetes-mixin:alert:KubeAggregatedAPIErrors',
    ]
  ),
  telemetry(
    'deployment-generation-stale',
    'Deployment observed generation remains stale',
    'The Deployment metadata generation differs from status observedGeneration for the pinned duration.',
    'The controller observes the current Deployment generation.',
    ['Deployment', 'Prometheus metrics'],
    ['kubernetes-mixin:alert:KubeDeploymentGenerationMismatch']
  ),
  telemetry(
    'kubelet-certificate-renewal-fails',
    'Kubelet certificate renewal fails',
    'Kubelet client and server certificate renewal error counters increase in the observation window.',
    'Kubelet renews both certificate roles without errors.',
    ['Node', 'Kubelet', 'Prometheus metrics'],
    [
      'kubernetes-mixin:alert:KubeletClientCertificateRenewalErrors',
      'kubernetes-mixin:alert:KubeletServerCertificateRenewalErrors',
    ]
  ),
  telemetry(
    'kubelet-pleg-duration-high',
    'Kubelet PLEG relist duration is high',
    'The pinned kubelet PLEG relist duration quantile exceeds its threshold.',
    'PLEG relist duration remains below the threshold.',
    ['Node', 'Kubelet', 'Prometheus metrics'],
    ['kubernetes-mixin:alert:KubeletPlegDurationHigh']
  ),
  telemetry(
    'pod-startup-latency-high',
    'Kubelet Pod startup latency is high',
    'The pinned Pod startup latency quantile exceeds its threshold.',
    'Pod startup latency remains below the threshold.',
    ['Node', 'Pod', 'Prometheus metrics'],
    ['kubernetes-mixin:alert:KubeletPodStartUpLatencyHigh']
  ),
  telemetry(
    'node-readiness-flaps',
    'Node readiness repeatedly changes',
    'The Node Ready condition changes more often than the pinned threshold permits.',
    'The Node Ready condition remains stable during the observation window.',
    ['Node', 'Prometheus metrics'],
    ['kubernetes-mixin:alert:KubeNodeReadinessFlapping']
  ),
  telemetry(
    'resource-quota-exceeded',
    'Namespace resource quota is exceeded',
    'ResourceQuota usage reaches and attempts to exceed its hard limit.',
    'ResourceQuota usage remains below its hard limit.',
    ['Namespace', 'ResourceQuota', 'Prometheus metrics'],
    [
      'kubernetes-mixin:alert:KubeQuotaAlmostFull',
      'kubernetes-mixin:alert:KubeQuotaFullyUsed',
      'kubernetes-mixin:alert:KubeQuotaExceeded',
    ]
  ),
  runtime(
    'fileless-memfd-execution',
    'Process executes a fileless memfd payload',
    'A controlled helper creates an executable memfd and executes it from memory.',
    'The helper executes only an on-disk allowlisted binary.',
    ['Pod', 'controlled executable payload'],
    ['falco:rule:fileless-execution-via-memfd-create:9a13b10b7954']
  ),
  runtime(
    'release-agent-container-escape',
    'Container writes a cgroup release agent',
    'A capability-bearing container writes a controlled release_agent path in its cgroup hierarchy.',
    'The container has no capability or writable cgroup path for release_agent changes.',
    ['Pod', 'cgroup fixture'],
    ['falco:rule:detect-release-agent-file-container-escapes:656197fb5d89']
  ),
  runtime(
    'container-loads-kernel-module',
    'Container attempts to load a kernel module',
    'A controlled container with SYS_MODULE invokes finit_module for a harmless test module.',
    'The container lacks SYS_MODULE and never invokes module-loading syscalls.',
    ['Pod', 'Node', 'test kernel module'],
    ['falco:rule:linux-kernel-module-injection-detected:c2dba6ea0792']
  ),
  runtime(
    'process-uses-ptrace',
    'Process attaches with ptrace and enables anti-debugging',
    'A controlled process attaches to a sibling with ptrace and then calls PTRACE_TRACEME.',
    'Neither process invokes ptrace.',
    ['Pod', 'two controlled processes'],
    [
      'falco:rule:ptrace-attached-to-process:44e91bf04e8a',
      'falco:rule:ptrace-anti-debug-attempt:4ff2dccac20a',
    ]
  ),
  runtime(
    'process-reads-proc-environ',
    'Process reads another process environment',
    'A controlled helper reads the environ file for a sibling process under procfs.',
    'The helper never opens another process environ file.',
    ['Pod', 'two controlled processes'],
    ['falco:rule:read-environment-variable-from-proc-files:4e70120c6b24']
  ),
  runtime(
    'process-sets-setuid-bit',
    'Process sets and exercises a setuid bit',
    'A controlled helper sets a setuid bit on a test executable and runs it without sudo.',
    'The test executable remains non-setuid and no process changes effective user unexpectedly.',
    ['Pod', 'controlled executable'],
    ['falco:rule:set-setuid-or-setgid-bit:163cfd660ac6', 'falco:rule:non-sudo-setuid:1c693a1b67bd']
  ),
  runtime(
    'sensitive-file-symlink-created',
    'Process creates a symlink over a sensitive path',
    'A controlled helper creates a symlink targeting a fixture path representing a sensitive file.',
    'No symlink targets the sensitive fixture path.',
    ['Pod', 'sensitive file fixture'],
    ['falco:rule:create-symlink-over-sensitive-files:0a0aa9f08b8a']
  ),
  node(
    'npd-ntp-is-down',
    'Node time synchronization is down',
    'The custom monitor emits the pinned NTPIsDown result for one Node.',
    'The custom monitor reports successful time synchronization.',
    [
      'node-problem-detector:source:custom-plugin-monitor-ntpisdown:43b6fa446259',
      'node-problem-detector:source:custom-plugin-monitor-ntpisdown:dc62c6e4c02d',
    ]
  ),
  node(
    'npd-iptables-version-mismatch',
    'Node reports an iptables version mismatch',
    'The monitor emits the pinned IPTablesVersionsMismatch result.',
    'The node networking components use compatible iptables modes.',
    ['node-problem-detector:source:iptables-mode-monitor-iptablesversionsmismatch:3d124b564c29']
  ),
  node(
    'npd-kernel-oops',
    'Node reports a kernel oops',
    'The ABRT adaptor fixture emits the pinned KernelOops record.',
    'The ABRT stream contains no kernel oops record.',
    ['node-problem-detector:source:abrt-adaptor-kerneloops:2257ec0e1cab']
  ),
  node(
    'npd-vmcore-created',
    'Node reports a VMcore crash dump',
    'The ABRT adaptor fixture emits the pinned VMcore record.',
    'The ABRT stream contains no VMcore record.',
    ['node-problem-detector:source:abrt-adaptor-vmcore:3cb63d427617']
  ),
  node(
    'npd-windows-defender-threat',
    'Windows Defender reports a threat',
    'The Windows monitor emits the pinned WindowsDefenderThreatsDetected result.',
    'Windows Defender reports no detected threat.',
    [
      'node-problem-detector:source:windows-defender-monitor-windowsdefenderthreatsdetected:1647030b06f6',
    ],
    ['aks']
  ),
  node(
    'npd-windows-kubeproxy-unhealthy',
    'Windows kube-proxy health check fails',
    'The Windows health checker reports the pinned KubeProxyUnhealthy condition.',
    'The kube-proxy health endpoint remains healthy.',
    [
      'node-problem-detector:source:windows-health-checker-kubeproxy-kubeproxyunhealthy:22ab318201b0',
    ],
    ['aks']
  ),
  deprecation(
    'deprecated-crd-v1beta1',
    'CustomResourceDefinition uses removed v1beta1 API',
    'A fixture contains an apiextensions.k8s.io/v1beta1 CustomResourceDefinition.',
    'The CustomResourceDefinition uses apiextensions.k8s.io/v1.',
    ['CustomResourceDefinition manifest'],
    [
      'pluto:source:k8s-customresourcedefinition-apiextensions-k8s-io-v1beta1-removed-v1-22-:8a0635b2de53',
    ]
  ),
  deprecation(
    'deprecated-endpointslice-v1beta1',
    'EndpointSlice uses removed v1beta1 API',
    'A fixture contains a discovery.k8s.io/v1beta1 EndpointSlice.',
    'The EndpointSlice uses discovery.k8s.io/v1.',
    ['EndpointSlice manifest'],
    ['pluto:source:k8s-endpointslice-discovery-k8s-io-v1beta1-removed-v1-25-0:1dad2acaa9c0']
  ),
  deprecation(
    'deprecated-apiservice-v1beta1',
    'APIService uses removed v1beta1 API',
    'A fixture contains an apiregistration.k8s.io/v1beta1 APIService.',
    'The APIService uses apiregistration.k8s.io/v1.',
    ['APIService manifest'],
    ['pluto:source:k8s-apiservice-apiregistration-k8s-io-v1beta1-removed-v1-22-0:9fa80d63afa1']
  ),
  deprecation(
    'deprecated-validating-webhook-v1beta1',
    'ValidatingWebhookConfiguration uses removed v1beta1 API',
    'A fixture contains an admissionregistration.k8s.io/v1beta1 ValidatingWebhookConfiguration.',
    'The ValidatingWebhookConfiguration uses admissionregistration.k8s.io/v1.',
    ['ValidatingWebhookConfiguration manifest'],
    [
      'pluto:source:k8s-validatingwebhookconfiguration-admissionregistration-k8s-io-v1beta1-:abcff4b6742b',
    ]
  ),
  deprecation(
    'deprecated-cert-manager-certificate-v1beta1',
    'Certificate uses removed cert-manager v1beta1 API',
    'A fixture contains a cert-manager.io/v1beta1 Certificate.',
    'The Certificate uses cert-manager.io/v1.',
    ['Certificate manifest'],
    ['pluto:source:cert-manager-certificate-cert-manager-io-v1beta1-removed-v1-6-0:d3ff836cb9fe']
  ),
];

const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as { tools: InventoryTool[] };
const mapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as {
  rule_mappings: Array<{ rules: Array<{ rule_id: string; status: string }> }>;
};
const priorBatches = [v1Path, v2Path].map(
  file =>
    JSON.parse(readFileSync(file, 'utf8')) as {
      scenarios: Array<{ target_rule_ids: string[] }>;
    }
);
const inventoryRules = inventory.tools.flatMap(tool =>
  tool.rules.map(rule => ({
    ...rule,
    tool_id: tool.tool_id,
    revision: tool.revision,
    readiness: rule.mapping_readiness ?? tool.mapping_readiness,
  }))
);
const byId = new Map(inventoryRules.map(rule => [rule.rule_id, rule] as const));
const byGroup = new Map<string, typeof inventoryRules>();
for (const rule of inventoryRules) {
  const members = byGroup.get(rule.semantic_group_id) ?? [];
  members.push(rule);
  byGroup.set(rule.semantic_group_id, members);
}
const statusById = new Map(
  mapping.rule_mappings.flatMap(entry =>
    entry.rules.map(rule => [rule.rule_id, rule.status] as const)
  )
);
const priorTargetIds = new Set(
  priorBatches.flatMap(batch => batch.scenarios.flatMap(scenario => scenario.target_rule_ids))
);

const defaultMechanisms: Record<Feasibility, string[]> = {
  manifest_only: ['manifest parser', 'normalized predicate evaluator'],
  live_cluster: ['Kubernetes API', 'normalized predicate evaluator'],
  telemetry: ['Prometheus fixture', 'PromQL evaluator'],
  host: ['node evidence fixture', 'node evidence evaluator'],
  runtime: ['runtime syscall evidence fixture', 'runtime predicate evaluator'],
};
const defaultProfiles: Record<Feasibility, ClusterProfile[]> = {
  manifest_only: ['local-kwok', 'local-minikube', 'aks'],
  live_cluster: ['local-minikube', 'aks'],
  telemetry: ['local-minikube', 'aks'],
  host: ['local-minikube', 'aks'],
  runtime: ['local-minikube', 'aks'],
};

assert.equal(blueprints.length, 58, 'expected exactly 58 blueprints');
const claimedRuleIds = new Set<string>();
const scenarios = blueprints.map(item => {
  const selected = new Map<string, (typeof inventoryRules)[number]>();
  for (const ruleId of item.ruleIds) {
    const rule = byId.get(ruleId);
    assert.ok(rule, `unknown target rule ${ruleId}`);
    selected.set(ruleId, rule);
  }
  for (const groupId of item.semanticGroupIds) {
    const members = byGroup.get(groupId);
    assert.ok(members?.length, `unknown semantic group ${groupId}`);
    for (const rule of members) selected.set(rule.rule_id, rule);
  }
  const targetRules = [...selected.values()].sort((left, right) =>
    left.rule_id.localeCompare(right.rule_id)
  );
  for (const rule of targetRules) {
    assert.equal(rule.readiness, 'direct_predicate', `${rule.rule_id} is not direct`);
    assert.equal(statusById.get(rule.rule_id), 'uncovered', `${rule.rule_id} is not uncovered`);
    assert.equal(priorTargetIds.has(rule.rule_id), false, `${rule.rule_id} overlaps v1/v2`);
    assert.equal(claimedRuleIds.has(rule.rule_id), false, `${rule.rule_id} is targeted twice`);
    assert.ok(rule.info_url.includes(rule.revision), `${rule.rule_id} URL is not revision-pinned`);
    claimedRuleIds.add(rule.rule_id);
  }
  return {
    scenario_id: `rule-gap-${item.slug}`,
    title: item.title,
    selection_track: item.selectionTrack,
    category: item.category,
    setup_summary: item.setup,
    trigger_predicate: item.trigger,
    expected_finding: `Identify ${item.title.toLowerCase()} and cite the exact field, status, log, syscall, or metric satisfying the trigger.`,
    healthy_condition: item.healthy,
    required_resources: item.resources,
    required_mechanisms: item.mechanisms ?? defaultMechanisms[item.feasibility],
    supported_cluster_profiles: item.profiles ?? defaultProfiles[item.feasibility],
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
        detail: 'Generate and validate the isolated fixture and healthy control.',
      },
      {
        kind: 'observation',
        detail: 'Prove the required native evidence is stable for a bounded observation window.',
      },
      {
        kind: 'oracle',
        detail:
          'Freeze positive, healthy-control, and confounder assertions before candidate runs.',
      },
      {
        kind: 'leakage',
        detail: 'Keep rule names and expected findings out of candidate-visible inputs.',
      },
    ],
  };
});

const summarize = <T extends string>(
  values: T[],
  count: (value: T) => number
): Record<string, number> =>
  Object.fromEntries([...new Set(values)].sort().map(value => [value, count(value)]));
const targetIds = scenarios.flatMap(scenario => scenario.target_rule_ids);
const targetGroups = new Set(scenarios.flatMap(scenario => scenario.target_semantic_group_ids));
const targetTools = new Set(scenarios.flatMap(scenario => scenario.target_tool_ids));
const categoryCounts = Object.fromEntries(
  [
    'workload_configuration',
    'control_plane_host_hardening',
    'runtime_node_failure',
    'operations_deprecation',
  ].map(category => [category, scenarios.filter(scenario => scenario.category === category).length])
);
const coverageByTool = summarize(
  targetIds.map(ruleId => byId.get(ruleId)!.tool_id),
  toolId => targetIds.filter(ruleId => byId.get(ruleId)!.tool_id === toolId).length
);
const coverageByFeasibility = summarize(
  scenarios.map(scenario => scenario.feasibility),
  feasibility =>
    scenarios
      .filter(scenario => scenario.feasibility === feasibility)
      .reduce((total, scenario) => total + scenario.target_rule_count, 0)
);
const scenarioCountsByFeasibility = summarize(
  scenarios.map(scenario => scenario.feasibility),
  feasibility => scenarios.filter(scenario => scenario.feasibility === feasibility).length
);
const coverageBySelectionTrack = summarize(
  scenarios.map(scenario => scenario.selection_track),
  track =>
    scenarios
      .filter(scenario => scenario.selection_track === track)
      .reduce((total, scenario) => total + scenario.target_rule_count, 0)
);
const scenarioCountsBySelectionTrack = summarize(
  scenarios.map(scenario => scenario.selection_track),
  track => scenarios.filter(scenario => scenario.selection_track === track).length
);
const document = {
  schema_version: '1.0.0',
  batch_id: 'rule-gap-scenarios-v3',
  generated_at: '2026-09-20',
  review_status: 'provisional',
  inventory_path: 'registrations/tool-rule-inventory-v1.json',
  mapping_path: 'registrations/tool-scenario-rule-mapping-v1.json',
  prior_batch_path: 'registrations/rule-gap-scenarios-v1.json',
  scenarios_goal: SCENARIOS_GOAL,
  optimization_objective:
    'Maximize distinct semantic groups and cross-tool breadth using reproducible Kubernetes states after excluding active, v1, and v2 targets.',
  methodology: {
    selection:
      'Select exactly 58 reviewed single-trigger states or coherent action chains from the remaining direct-predicate frontier, favoring cross-tool agreement.',
    deduplication:
      'Reject active coverage, v1 and v2 targets, duplicate v3 occurrences, and kube-bench-only profile multiplication without one equivalent Kubernetes state.',
    qualification:
      'Keep every specification draft and pending until setup, observation, oracle, and leakage blockers are resolved.',
    external_tool_execution: false,
  },
  total_scenarios: scenarios.length,
  total_target_rules: targetIds.length,
  total_target_semantic_groups: targetGroups.size,
  category_counts: categoryCounts,
  coverage_by_tool: coverageByTool,
  coverage_by_feasibility: coverageByFeasibility,
  scenario_counts_by_feasibility: scenarioCountsByFeasibility,
  coverage_by_selection_track: coverageBySelectionTrack,
  scenario_counts_by_selection_track: scenarioCountsBySelectionTrack,
  scenarios,
};

const prettierConfig = (await prettier.resolveConfig(outputPath)) ?? {};
writeFileSync(
  outputPath,
  prettier.format(JSON.stringify(document), { ...prettierConfig, parser: 'json' })
);

const markdown = [
  '# Kubernetes rule-gap draft scenarios v3',
  '',
  'Status: draft and pending, 2026-09-20',
  '',
  'This third catalogue selects remaining uncovered direct predicates after excluding',
  'the active roster and every v1/v2 target. Its machine-readable source is',
  '[`rule-gap-scenarios-v3.json`](../evals/registrations/rule-gap-scenarios-v3.json),',
  'generated by',
  '[`generateRuleGapScenariosV3.ts`](../evals/src/scenarios/generateRuleGapScenariosV3.ts).',
  '',
  '## Scenarios Goal',
  '',
  `> ${SCENARIOS_GOAL.statement}`,
  '',
  'See [Scenarios Goal](kubernetes-scenarios-goal.md) for the canonical denominator and',
  'qualification gates. These drafts reproduce Kubernetes states, configurations, and',
  'actions from native evidence. Surveyed external tools are never installed or executed.',
  '',
  '## Selection constraints',
  '',
  '- Select only revision-pinned, uncovered `direct_predicate` occurrences.',
  '- Reuse no active, v1, or v2 target and assign each v3 occurrence once.',
  '- Keep exactly one trigger state or coherent causal action chain per scenario.',
  '- Expand kube-bench profiles only for equivalent host IPC, host PID, and seccomp states.',
  '- Keep all specifications outside the active 275-scenario roster.',
  '',
  '## Marginal coverage',
  '',
  `The 58 drafts add **${targetIds.length}** exact target occurrences in`,
  `**${targetGroups.size}** semantic groups across **${targetTools.size}** tools.`,
  '',
  '| Tool | Occurrences |',
  '| --- | ---: |',
  ...Object.entries(coverageByTool).map(([tool, count]) => `| ${tool} | ${count} |`),
  '',
  '| Selection track | Drafts | Occurrences |',
  '| --- | ---: | ---: |',
  ...Object.entries(scenarioCountsBySelectionTrack).map(
    ([track, count]) => `| ${track} | ${count} | ${coverageBySelectionTrack[track]} |`
  ),
  '',
  '| Feasibility | Drafts | Occurrences |',
  '| --- | ---: | ---: |',
  ...Object.entries(scenarioCountsByFeasibility).map(
    ([feasibility, count]) =>
      `| ${feasibility} | ${count} | ${coverageByFeasibility[feasibility]} |`
  ),
  '',
  'Kube-bench contributes profile occurrences only where one manifest state has the same',
  'predicate across profiles. Those occurrences are provenance expansion, not separate',
  'scenario behaviors or independent completion credit.',
  '',
  '## Draft catalogue',
  '',
  '| Scenario ID | Selection track | Title | Occurrences | Groups | Tools |',
  '| --- | --- | --- | ---: | ---: | ---: |',
  ...scenarios.map(
    scenario =>
      `| ${scenario.scenario_id} | ${scenario.selection_track} | ${scenario.title} | ${scenario.target_rule_count} | ${scenario.target_semantic_group_ids.length} | ${scenario.target_tool_ids.length} |`
  ),
  '',
].join('\n');
const markdownConfig = (await prettier.resolveConfig(documentationPath)) ?? {};
writeFileSync(
  documentationPath,
  prettier.format(markdown, { ...markdownConfig, parser: 'markdown' })
);

console.log(
  `Wrote ${scenarios.length} v3 drafts targeting ${targetIds.length} rule occurrences in ${targetGroups.size} semantic groups across ${targetTools.size} tools.`
);
