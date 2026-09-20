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

type Profiles = NonNullable<ScenarioDraftDefinition['supportedClusterProfiles']>;
type Mechanisms = NonNullable<ScenarioDraftDefinition['requiredMechanisms']>;

interface HostDraftOptions {
  scenarioId: string;
  title: string;
  component: string;
  targetPath: string;
  data: Record<string, string>;
  fieldPath: string;
  brokenValue: string;
  healthyValue: string;
  finding: string;
  healthyDescription: string;
  mechanisms?: Mechanisms;
}

interface LogDraftOptions {
  scenarioId: string;
  title: string;
  source: string;
  sourcePath: string;
  line: string;
  pattern: string;
  finding: string;
  healthyLine: string;
  profiles?: Profiles;
  count?: number;
  lookback?: string;
}

const minikubeProfile: Profiles = ['local-minikube'];
const nodeProfiles: Profiles = ['local-minikube', 'aks'];

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
      'evals.kubernetes.io/adapter': 'disposable-node',
      'evals.kubernetes.io/target-path': targetPath,
      'evals.kubernetes.io/apply-to-current-host': 'false',
    },
  },
  data,
});

const staticPod = (component: string, args: string[]) =>
  [
    'apiVersion: v1',
    'kind: Pod',
    'metadata:',
    `  name: ${component}`,
    '  namespace: kube-system',
    'spec:',
    '  hostNetwork: true',
    '  containers:',
    `    - name: ${component}`,
    `      image: registry.k8s.io/${component}:${component === 'etcd' ? '3.5.15-0' : 'v1.31.1'}`,
    '      command:',
    `        - ${component}`,
    ...args.map(argument => `        - ${argument}`),
    '',
  ].join('\n');

const kubeletConfiguration = (body: string[]) =>
  ['apiVersion: kubelet.config.k8s.io/v1beta1', 'kind: KubeletConfiguration', ...body, ''].join(
    '\n'
  );

const hostDraft = (options: HostDraftOptions): ScenarioDraftDefinition => {
  const name = `${options.scenarioId.slice('rule-gap-'.length)}-fixture`;
  const resourceRef = `configmap/${name}`;
  return {
    scenarioId: options.scenarioId,
    title: options.title,
    description: `${options.finding} The concrete component files are inert ConfigMap data for a disposable-node adapter and cannot alter the current host.`,
    taskPrompt: `Inspect the ${resourceRef} component fixture. ${options.finding} Cite the exact field or command argument and do not mutate resources.`,
    visibleResourceRefs: [resourceRef],
    observationKinds: ['configmap.data', `component-config.${options.component}`],
    setup: [inertConfigMap(name, options.targetPath, 'component-configuration', options.data)],
    acceptedFacts: [
      {
        fact_id: 'configured-broken-value',
        resource_ref: resourceRef,
        field_path: options.fieldPath,
        observed_value: options.brokenValue,
        description: options.finding,
      },
      {
        fact_id: 'fixture-is-inert',
        resource_ref: resourceRef,
        field_path: 'metadata.annotations.evals.kubernetes.io/apply-to-current-host',
        observed_value: 'false',
        description: 'The fixture explicitly forbids application to the current host.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-healthy-value',
        resource_ref: resourceRef,
        field_path: options.fieldPath,
        observed_value: options.healthyValue,
        description: options.healthyDescription,
      },
    ],
    requiredMechanisms: options.mechanisms ?? ['api-server'],
    supportedClusterProfiles: minikubeProfile,
  };
};

const logDraft = (options: LogDraftOptions): ScenarioDraftDefinition => {
  const name = `${options.scenarioId.slice('rule-gap-'.length)}-fixture`;
  const resourceRef = `configmap/${name}`;
  const lines = Array.from({ length: options.count ?? 1 }, () => options.line).join('\n');
  const oracle = JSON.stringify({
    source: options.source,
    regex: options.pattern,
    requiredMatches: options.count ?? 1,
    ...(options.lookback ? { lookback: options.lookback } : {}),
  });
  return {
    scenarioId: options.scenarioId,
    title: options.title,
    description: `${options.finding} The source log and normalized regex oracle are immutable ConfigMap data; no node service or surveyed detector is run.`,
    taskPrompt: `Inspect ${resourceRef}. Compare the exact normalized log fixture with its regex oracle, report the represented node condition, and cite the matching line without mutating resources.`,
    visibleResourceRefs: [resourceRef],
    observationKinds: ['configmap.data', 'node-log-fixture', 'normalized-regex-oracle'],
    setup: [
      inertConfigMap(name, options.sourcePath, 'node-log', {
        'source.log': lines,
        'normalized-message.txt': lines,
        'oracle.json': oracle,
        'healthy-control.log': options.healthyLine,
      }),
    ],
    acceptedFacts: [
      {
        fact_id: 'exact-log-evidence',
        resource_ref: resourceRef,
        field_path: 'data.source.log',
        observed_value: lines,
        description: options.finding,
      },
      {
        fact_id: 'normalized-regex-oracle',
        resource_ref: resourceRef,
        field_path: 'data.oracle.json',
        observed_value: oracle,
        description: `The local oracle requires ${options.count ?? 1} match(es) for ${
          options.pattern
        }.`,
      },
      {
        fact_id: 'fixture-is-inert',
        resource_ref: resourceRef,
        field_path: 'metadata.annotations.evals.kubernetes.io/apply-to-current-host',
        observed_value: 'false',
        description: 'The log remains ConfigMap data and is never injected into a node log.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'healthy-control-is-not-failing-line',
        resource_ref: resourceRef,
        field_path: 'data.source.log',
        observed_value: options.healthyLine,
        description: `The failing source is not the nonmatching healthy control: ${options.healthyLine}`,
      },
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: options.profiles ?? nodeProfiles,
  };
};

const apiServerBase = ['--secure-port=6443', '--authorization-mode=Node,RBAC'];
const safeAdmissionPlugins = 'NamespaceLifecycle,ServiceAccount,NodeRestriction';
const auditBase = [
  ...apiServerBase,
  '--audit-log-path=/var/log/kubernetes/audit.log',
  '--audit-log-maxage=30',
  '--audit-log-maxbackup=10',
  '--audit-log-maxsize=100',
];

export const remainingScenarioDraftDefinitions: ScenarioDraftDefinition[] = [
  hostDraft({
    scenarioId: 'rule-gap-rbac-authorizer-missing',
    title: 'RBAC authorizer is missing',
    component: 'kube-apiserver',
    targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
    data: {
      'kube-apiserver.yaml': staticPod('kube-apiserver', [
        '--secure-port=6443',
        '--authorization-mode=Node',
      ]),
    },
    fieldPath: 'data.kube-apiserver.yaml#spec.containers[0].command',
    brokenValue: '--authorization-mode=Node',
    healthyValue: '--authorization-mode=Node,RBAC',
    finding: 'The complete authorization mode enables Node but omits RBAC.',
    healthyDescription: 'The fixture does not contain the healthy Node,RBAC authorizer chain.',
    mechanisms: ['api-server', 'authorization'],
  }),
  hostDraft({
    scenarioId: 'rule-gap-etcd-client-cert-auth-disabled',
    title: 'etcd client certificate authentication is disabled',
    component: 'etcd',
    targetPath: '/etc/kubernetes/manifests/etcd.yaml',
    data: {
      'etcd.yaml': staticPod('etcd', [
        '--listen-client-urls=https://127.0.0.1:2379',
        '--trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt',
        '--cert-file=/etc/kubernetes/pki/etcd/server.crt',
        '--key-file=/etc/kubernetes/pki/etcd/server.key',
        '--client-cert-auth=false',
      ]),
    },
    fieldPath: 'data.etcd.yaml#spec.containers[0].command',
    brokenValue: '--client-cert-auth=false',
    healthyValue: '--client-cert-auth=true',
    finding: 'The TLS listener explicitly accepts clients without certificate authentication.',
    healthyDescription:
      'The fixture explicitly disables, rather than enables, client certificate authentication.',
  }),
  hostDraft({
    scenarioId: 'rule-gap-etcd-peer-cert-auth-disabled',
    title: 'etcd peer certificate authentication is disabled',
    component: 'etcd',
    targetPath: '/etc/kubernetes/manifests/etcd.yaml',
    data: {
      'etcd.yaml': staticPod('etcd', [
        '--listen-peer-urls=https://127.0.0.1:2380',
        '--peer-trusted-ca-file=/etc/kubernetes/pki/etcd/ca.crt',
        '--peer-cert-file=/etc/kubernetes/pki/etcd/peer.crt',
        '--peer-key-file=/etc/kubernetes/pki/etcd/peer.key',
        '--peer-client-cert-auth=false',
      ]),
    },
    fieldPath: 'data.etcd.yaml#spec.containers[0].command',
    brokenValue: '--peer-client-cert-auth=false',
    healthyValue: '--peer-client-cert-auth=true',
    finding: 'The TLS peer listener explicitly accepts peers without certificate authentication.',
    healthyDescription: 'The fixture explicitly disables peer certificate authentication.',
  }),
  hostDraft({
    scenarioId: 'rule-gap-alwaysadmit-enabled',
    title: 'AlwaysAdmit admission plugin is enabled',
    component: 'kube-apiserver',
    targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
    data: {
      'kube-apiserver.yaml': staticPod('kube-apiserver', [
        ...apiServerBase,
        `--enable-admission-plugins=${safeAdmissionPlugins},AlwaysAdmit`,
      ]),
    },
    fieldPath: 'data.kube-apiserver.yaml#spec.containers[0].command',
    brokenValue: `--enable-admission-plugins=${safeAdmissionPlugins},AlwaysAdmit`,
    healthyValue: `--enable-admission-plugins=${safeAdmissionPlugins}`,
    finding: 'The effective admission chain explicitly includes AlwaysAdmit.',
    healthyDescription: 'The fixture does not omit AlwaysAdmit from the enabled plugin list.',
    mechanisms: ['api-server', 'admission-controller'],
  }),
  hostDraft({
    scenarioId: 'rule-gap-serviceaccount-admission-missing',
    title: 'ServiceAccount admission plugin is missing',
    component: 'kube-apiserver',
    targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
    data: {
      'kube-apiserver.yaml': staticPod('kube-apiserver', [
        ...apiServerBase,
        '--enable-admission-plugins=NamespaceLifecycle,NodeRestriction',
        '--disable-admission-plugins=ServiceAccount',
      ]),
    },
    fieldPath: 'data.kube-apiserver.yaml#spec.containers[0].command',
    brokenValue: '--disable-admission-plugins=ServiceAccount',
    healthyValue: '--enable-admission-plugins=ServiceAccount',
    finding: 'The effective admission chain explicitly disables ServiceAccount.',
    healthyDescription: 'ServiceAccount is not enabled by the fixture.',
    mechanisms: ['api-server', 'admission-controller'],
  }),
  hostDraft({
    scenarioId: 'rule-gap-namespace-lifecycle-admission-missing',
    title: 'NamespaceLifecycle admission plugin is missing',
    component: 'kube-apiserver',
    targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
    data: {
      'kube-apiserver.yaml': staticPod('kube-apiserver', [
        ...apiServerBase,
        '--enable-admission-plugins=ServiceAccount,NodeRestriction',
        '--disable-admission-plugins=NamespaceLifecycle',
      ]),
    },
    fieldPath: 'data.kube-apiserver.yaml#spec.containers[0].command',
    brokenValue: '--disable-admission-plugins=NamespaceLifecycle',
    healthyValue: '--enable-admission-plugins=NamespaceLifecycle',
    finding: 'The effective admission chain explicitly disables NamespaceLifecycle.',
    healthyDescription: 'NamespaceLifecycle is not enabled by the fixture.',
    mechanisms: ['api-server', 'admission-controller'],
  }),
  hostDraft({
    scenarioId: 'rule-gap-node-restriction-admission-missing',
    title: 'NodeRestriction admission plugin is missing',
    component: 'kube-apiserver',
    targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
    data: {
      'kube-apiserver.yaml': staticPod('kube-apiserver', [
        ...apiServerBase,
        '--enable-admission-plugins=NamespaceLifecycle,ServiceAccount',
        '--disable-admission-plugins=NodeRestriction',
      ]),
    },
    fieldPath: 'data.kube-apiserver.yaml#spec.containers[0].command',
    brokenValue: '--disable-admission-plugins=NodeRestriction',
    healthyValue: '--enable-admission-plugins=NodeRestriction',
    finding: 'The effective admission chain explicitly disables NodeRestriction.',
    healthyDescription: 'NodeRestriction is not enabled by the fixture.',
    mechanisms: ['api-server', 'admission-controller'],
  }),
  hostDraft({
    scenarioId: 'rule-gap-event-rate-limit-admission-missing',
    title: 'EventRateLimit admission plugin is missing',
    component: 'kube-apiserver',
    targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
    data: {
      'kube-apiserver.yaml': staticPod('kube-apiserver', [
        ...apiServerBase,
        `--enable-admission-plugins=${safeAdmissionPlugins}`,
      ]),
      'event-rate-limit.yaml': [
        'apiVersion: eventratelimit.admission.k8s.io/v1alpha1',
        'kind: Configuration',
        'limits:',
        '  - type: Namespace',
        '    qps: 50',
        '    burst: 100',
        '',
      ].join('\n'),
    },
    fieldPath: 'data.kube-apiserver.yaml#spec.containers[0].command',
    brokenValue: `--enable-admission-plugins=${safeAdmissionPlugins}`,
    healthyValue: '--enable-admission-plugins=EventRateLimit',
    finding:
      'A reviewed EventRateLimit configuration exists, but the API server never enables its plugin.',
    healthyDescription: 'The enabled plugin list omits EventRateLimit.',
    mechanisms: ['api-server', 'admission-controller'],
  }),
  hostDraft({
    scenarioId: 'rule-gap-always-pull-images-admission-missing',
    title: 'AlwaysPullImages admission plugin is missing',
    component: 'kube-apiserver',
    targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
    data: {
      'kube-apiserver.yaml': staticPod('kube-apiserver', [
        ...apiServerBase,
        `--enable-admission-plugins=${safeAdmissionPlugins}`,
      ]),
    },
    fieldPath: 'data.kube-apiserver.yaml#spec.containers[0].command',
    brokenValue: `--enable-admission-plugins=${safeAdmissionPlugins}`,
    healthyValue: '--enable-admission-plugins=AlwaysPullImages',
    finding: 'The complete enabled plugin list omits AlwaysPullImages.',
    healthyDescription: 'AlwaysPullImages is not enabled by the fixture.',
    mechanisms: ['api-server', 'admission-controller'],
  }),
  hostDraft({
    scenarioId: 'rule-gap-secret-encryption-provider-missing',
    title: 'API data encryption provider is missing',
    component: 'kube-apiserver',
    targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
    data: {
      'kube-apiserver.yaml': staticPod('kube-apiserver', apiServerBase),
      'reviewed-encryption-control.yaml': [
        'apiVersion: apiserver.config.k8s.io/v1',
        'kind: EncryptionConfiguration',
        'resources:',
        '  - resources: [secrets]',
        '    providers:',
        '      - aesgcm:',
        '          keys:',
        '            - name: key1',
        '              secret: YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE=',
        '      - identity: {}',
        '',
      ].join('\n'),
    },
    fieldPath: 'data.kube-apiserver.yaml#spec.containers[0].command',
    brokenValue: 'encryption-provider-config argument absent',
    healthyValue: '--encryption-provider-config=/etc/kubernetes/encryption/config.yaml',
    finding: 'The static Pod does not reference the supplied reviewed EncryptionConfiguration.',
    healthyDescription:
      'No encryption-provider-config argument connects the API server to the control file.',
  }),
  hostDraft({
    scenarioId: 'rule-gap-audit-log-path-missing',
    title: 'API audit log path is missing',
    component: 'kube-apiserver',
    targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
    data: {
      'kube-apiserver.yaml': staticPod('kube-apiserver', [
        ...apiServerBase,
        '--audit-log-maxage=30',
        '--audit-log-maxbackup=10',
        '--audit-log-maxsize=100',
      ]),
    },
    fieldPath: 'data.kube-apiserver.yaml#spec.containers[0].command',
    brokenValue: 'audit-log-path argument absent',
    healthyValue: '--audit-log-path=/var/log/kubernetes/audit.log',
    finding: 'Rotation settings are present, but the API server has no audit log destination.',
    healthyDescription: 'The fixture contains no writable retained audit-log-path.',
  }),
  hostDraft({
    scenarioId: 'rule-gap-audit-log-retention-too-short',
    title: 'API audit log retention is too short',
    component: 'kube-apiserver',
    targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
    data: {
      'kube-apiserver.yaml': staticPod(
        'kube-apiserver',
        auditBase.map(value => (value === '--audit-log-maxage=30' ? '--audit-log-maxage=7' : value))
      ),
    },
    fieldPath: 'data.kube-apiserver.yaml#spec.containers[0].command',
    brokenValue: '--audit-log-maxage=7',
    healthyValue: '--audit-log-maxage=30',
    finding: 'The audit destination is valid, but logs are retained for only 7 days.',
    healthyDescription: 'The fixture is below the reviewed 30-day retention threshold.',
  }),
  hostDraft({
    scenarioId: 'rule-gap-audit-log-backups-too-few',
    title: 'API audit log backup count is too low',
    component: 'kube-apiserver',
    targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
    data: {
      'kube-apiserver.yaml': staticPod(
        'kube-apiserver',
        auditBase.map(value =>
          value === '--audit-log-maxbackup=10' ? '--audit-log-maxbackup=3' : value
        )
      ),
    },
    fieldPath: 'data.kube-apiserver.yaml#spec.containers[0].command',
    brokenValue: '--audit-log-maxbackup=3',
    healthyValue: '--audit-log-maxbackup=10',
    finding: 'The audit destination is valid, but rotation retains only 3 backup files.',
    healthyDescription: 'The fixture is below the reviewed 10-backup threshold.',
  }),
  hostDraft({
    scenarioId: 'rule-gap-audit-log-file-too-small',
    title: 'API audit log rotation size is too small',
    component: 'kube-apiserver',
    targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
    data: {
      'kube-apiserver.yaml': staticPod(
        'kube-apiserver',
        auditBase.map(value =>
          value === '--audit-log-maxsize=100' ? '--audit-log-maxsize=20' : value
        )
      ),
    },
    fieldPath: 'data.kube-apiserver.yaml#spec.containers[0].command',
    brokenValue: '--audit-log-maxsize=20',
    healthyValue: '--audit-log-maxsize=100',
    finding: 'The audit destination is valid, but each audit file rotates after only 20 MB.',
    healthyDescription: 'The fixture is below the reviewed 100 MB rotation threshold.',
  }),
  hostDraft({
    scenarioId: 'rule-gap-service-account-token-lookup-disabled',
    title: 'Service account token lookup is disabled',
    component: 'kube-apiserver',
    targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
    data: {
      'kube-apiserver.yaml': staticPod('kube-apiserver', [
        ...apiServerBase,
        '--service-account-lookup=false',
      ]),
    },
    fieldPath: 'data.kube-apiserver.yaml#spec.containers[0].command',
    brokenValue: '--service-account-lookup=false',
    healthyValue: '--service-account-lookup=true',
    finding: 'The API server explicitly disables lookup of deleted service account tokens.',
    healthyDescription: 'The fixture does not enable service-account token lookup.',
    mechanisms: ['api-server', 'authorization'],
  }),
  hostDraft({
    scenarioId: 'rule-gap-etcd-client-keypair-missing',
    title: 'API server etcd client keypair is missing',
    component: 'kube-apiserver',
    targetPath: '/etc/kubernetes/manifests/kube-apiserver.yaml',
    data: {
      'kube-apiserver.yaml': staticPod('kube-apiserver', [
        ...apiServerBase,
        '--etcd-servers=https://127.0.0.1:2379',
        '--etcd-cafile=/etc/kubernetes/pki/etcd/ca.crt',
        '--etcd-certfile=/etc/kubernetes/pki/apiserver-etcd-client.crt',
      ]),
    },
    fieldPath: 'data.kube-apiserver.yaml#spec.containers[0].command',
    brokenValue: 'etcd-certfile present; etcd-keyfile absent',
    healthyValue: '--etcd-keyfile=/etc/kubernetes/pki/apiserver-etcd-client.key',
    finding:
      'The API server supplies an etcd client certificate but omits its private-key argument.',
    healthyDescription: 'The configured TLS client identity is incomplete without etcd-keyfile.',
  }),
  hostDraft({
    scenarioId: 'rule-gap-component-profiling-enabled',
    title: 'Control-plane profiling endpoint is enabled',
    component: 'control-plane',
    targetPath: '/etc/kubernetes/manifests',
    data: {
      'kube-apiserver.yaml': staticPod('kube-apiserver', [...apiServerBase, '--profiling=true']),
      'kube-controller-manager.yaml': staticPod('kube-controller-manager', ['--profiling=true']),
      'kube-scheduler.yaml': staticPod('kube-scheduler', ['--profiling=true']),
    },
    fieldPath: 'data.*.yaml#spec.containers[0].command',
    brokenValue: '3 of 3 contain --profiling=true',
    healthyValue: '3 of 3 contain --profiling=false',
    finding: 'The API server, controller manager, and scheduler all explicitly enable profiling.',
    healthyDescription: 'None of the three component fixtures disables profiling.',
  }),
  hostDraft({
    scenarioId: 'rule-gap-kubelet-read-only-port',
    title: 'Kubelet read-only port is enabled',
    component: 'kubelet',
    targetPath: '/var/lib/kubelet/config.yaml',
    data: { 'config.yaml': kubeletConfiguration(['readOnlyPort: 10255']) },
    fieldPath: 'data.config.yaml#readOnlyPort',
    brokenValue: '10255',
    healthyValue: '0',
    finding: 'The kubelet exposes its unauthenticated read-only endpoint on port 10255.',
    healthyDescription: 'The fixture does not disable the read-only port.',
    mechanisms: ['api-server', 'kubelet'],
  }),
  hostDraft({
    scenarioId: 'rule-gap-unbounded-streaming-idle-timeout',
    title: 'Kubelet streaming idle timeout is disabled',
    component: 'kubelet',
    targetPath: '/var/lib/kubelet/config.yaml',
    data: { 'config.yaml': kubeletConfiguration(['streamingConnectionIdleTimeout: 0s']) },
    fieldPath: 'data.config.yaml#streamingConnectionIdleTimeout',
    brokenValue: '0s',
    healthyValue: '4h0m0s',
    finding:
      'The zero duration leaves exec, attach, and port-forward streams without an idle bound.',
    healthyDescription: 'The fixture does not configure a positive streaming idle timeout.',
    mechanisms: ['api-server', 'kubelet'],
  }),
  hostDraft({
    scenarioId: 'rule-gap-kernel-default-protection-disabled',
    title: 'Kubelet does not protect kernel defaults',
    component: 'kubelet',
    targetPath: '/var/lib/kubelet/config.yaml',
    data: { 'config.yaml': kubeletConfiguration(['protectKernelDefaults: false']) },
    fieldPath: 'data.config.yaml#protectKernelDefaults',
    brokenValue: 'false',
    healthyValue: 'true',
    finding:
      'The kubelet explicitly permits startup when protected kernel tunables differ from defaults.',
    healthyDescription: 'The fixture does not enforce kernel-default conformance.',
    mechanisms: ['api-server', 'kubelet'],
  }),
  hostDraft({
    scenarioId: 'rule-gap-event-qps-throttles-auditability',
    title: 'Kubelet event QPS is too restrictive',
    component: 'kubelet',
    targetPath: '/var/lib/kubelet/config.yaml',
    data: { 'config.yaml': kubeletConfiguration(['eventRecordQPS: 1', 'eventBurst: 1']) },
    fieldPath: 'data.config.yaml#eventRecordQPS',
    brokenValue: '1',
    healthyValue: '0',
    finding: 'The kubelet restricts event recording to 1 event per second with a burst of 1.',
    healthyDescription: 'The fixture does not use unlimited event QPS or a reviewed higher rate.',
    mechanisms: ['api-server', 'kubelet'],
  }),
  hostDraft({
    scenarioId: 'rule-gap-kubelet-server-cert-rotation-disabled',
    title: 'Kubelet server certificate rotation is disabled',
    component: 'kubelet',
    targetPath: '/var/lib/kubelet/config.yaml',
    data: {
      'config.yaml': kubeletConfiguration([
        'rotateCertificates: true',
        'featureGates:',
        '  RotateKubeletServerCertificate: false',
      ]),
    },
    fieldPath: 'data.config.yaml#featureGates.RotateKubeletServerCertificate',
    brokenValue: 'false',
    healthyValue: 'true',
    finding:
      'Client certificate rotation is enabled, but the server certificate rotation gate is false.',
    healthyDescription: 'The fixture does not enable RotateKubeletServerCertificate.',
    mechanisms: ['api-server', 'kubelet'],
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-kernel-null-pointer',
    title: 'Kernel reports a null-pointer dereference',
    source: 'kernel-monitor',
    sourcePath: '/var/log/kern.log',
    line: 'BUG: unable to handle kernel NULL pointer dereference at 0000000000000010',
    pattern: 'BUG: unable to handle kernel NULL pointer dereference at .*',
    finding: 'The normalized kernel line is an exact null-pointer dereference signature.',
    healthyLine: 'kernel: worker completed without a fault',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-kernel-divide-error',
    title: 'Kernel reports a divide error',
    source: 'kernel-monitor',
    sourcePath: '/var/log/kern.log',
    line: 'divide error: 0000 [#1] SMP',
    pattern: 'divide error: 0000 \\[#\\d+\\] SMP',
    finding: 'The normalized kernel line is an exact divide-error signature for fault sequence 1.',
    healthyLine: 'kernel: arithmetic self-test passed',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-docker-task-stall',
    title: 'Docker task remains blocked',
    source: 'kernel-monitor',
    sourcePath: '/var/log/kern.log',
    line: 'task docker:123 blocked for more than 120 seconds.',
    pattern: 'task docker:\\w+ blocked for more than \\w+ seconds\\.',
    finding: 'The exact Docker task line reports PID 123 blocked beyond 120 seconds.',
    healthyLine: 'task docker:123 resumed after 2 seconds.',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-unregister-netdevice-burst',
    title: 'Network device unregister repeatedly stalls',
    source: 'kernel-monitor',
    sourcePath: '/var/log/kern.log',
    line: 'unregister_netdevice: waiting for eth0 to become free. Usage count = 1',
    pattern: 'unregister_netdevice: waiting for \\w+ to become free. Usage count = \\d+',
    finding: 'Three identical eth0 unregister stalls occur inside the 20-minute counter window.',
    healthyLine: 'unregister_netdevice: eth0 became free',
    count: 3,
    lookback: '20m',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-disk-bad-block',
    title: 'Disk health log reports a bad block',
    source: 'disk-monitor',
    sourcePath: '/var/log/messages',
    line: '101Currently unreadable sectors',
    pattern: '.*([1-9]\\d{2,})(Currently unreadable.*sectors|Offline uncorrectable sectors).*',
    finding: 'The SMART fixture reports 101 currently unreadable sectors.',
    healthyLine: '0 Currently unreadable sectors',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-ext4-error',
    title: 'Kernel reports an EXT4 error',
    source: 'kernel-monitor',
    sourcePath: '/dev/kmsg',
    line: 'EXT4-fs error (device sda1): ext4_find_entry:1455: inode #2: reading directory',
    pattern: 'EXT4-fs error .*',
    finding: 'The kernel fixture reports a concrete EXT4 directory-read error on sda1.',
    healthyLine: 'EXT4-fs (sda1): mounted filesystem with ordered data mode',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-ext4-warning',
    title: 'Kernel reports an EXT4 warning',
    source: 'kernel-monitor',
    sourcePath: '/dev/kmsg',
    line: 'EXT4-fs warning (device sda1): ext4_end_bio:343: I/O error 10 writing inode 12',
    pattern: 'EXT4-fs warning .*',
    finding: 'The kernel fixture reports a concrete EXT4 write warning on sda1.',
    healthyLine: 'EXT4-fs (sda1): re-mounted. Opts: errors=remount-ro',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-buffer-io-error',
    title: 'Kernel reports a buffer I/O error',
    source: 'kernel-monitor',
    sourcePath: '/dev/kmsg',
    line: 'Buffer I/O error on dev sda, logical block 8, async page read',
    pattern: 'Buffer I/O error .*',
    finding: 'The kernel fixture reports a buffer I/O failure at logical block 8 on sda.',
    healthyLine: 'sd 0:0:0:0: [sda] Attached SCSI disk',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-xfs-shutdown',
    title: 'Kernel reports a forced XFS shutdown',
    source: 'kernel-monitor',
    sourcePath: '/dev/kmsg',
    line: 'XFS (sda1): Shutting down filesystem',
    pattern: 'XFS .* Shutting down filesystem.?',
    finding: 'The XFS fixture explicitly reports filesystem shutdown on sda1.',
    healthyLine: 'XFS (sda1): Ending clean mount',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-cper-corrected',
    title: 'Kernel reports a corrected CPER hardware error',
    source: 'kernel-monitor',
    sourcePath: '/dev/kmsg',
    line: 'mce: [Hardware Error]: event severity: corrected',
    pattern: '.*\\[Hardware Error\\]: event severity: corrected$',
    finding: 'The CPER fixture ends with corrected hardware-error severity.',
    healthyLine: 'mce: hardware event polling enabled',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-cper-recoverable',
    title: 'Kernel reports a recoverable CPER hardware error',
    source: 'kernel-monitor',
    sourcePath: '/dev/kmsg',
    line: 'mce: [Hardware Error]: event severity: recoverable',
    pattern: '.*\\[Hardware Error\\]: event severity: recoverable$',
    finding: 'The CPER fixture ends with recoverable hardware-error severity.',
    healthyLine: 'mce: hardware event polling enabled',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-cper-fatal',
    title: 'Kernel reports a fatal CPER hardware error',
    source: 'kernel-monitor',
    sourcePath: '/dev/kmsg',
    line: 'mce: [Hardware Error]: event severity: fatal',
    pattern: '.*\\[Hardware Error\\]: event severity: fatal$',
    finding: 'The CPER fixture ends with fatal hardware-error severity.',
    healthyLine: 'mce: hardware event polling enabled',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-memory-read-error',
    title: 'Kernel reports a corrected memory-read error',
    source: 'kernel-monitor',
    sourcePath: '/dev/kmsg',
    line: 'CE memory read error on CPU 0 DIMM A1',
    pattern: 'CE memory read error .*',
    finding: 'The corrected-error fixture identifies a memory read fault on CPU 0 DIMM A1.',
    healthyLine: 'EDAC MC0: memory scrub completed',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-corrupt-docker-overlay',
    title: 'Docker overlay storage is corrupt',
    source: 'docker-monitor',
    sourcePath: '/var/log/journal',
    line: 'returned error: readlink /var/lib/docker/overlay2/abc/merged: invalid argument',
    pattern: 'returned error: readlink /var/lib/docker/overlay2.*: invalid argument.*',
    finding: 'Ten identical overlay2 readlink failures occur inside the 5-minute counter window.',
    healthyLine: 'overlay2: mounted /var/lib/docker/overlay2/abc/merged',
    count: 10,
    lookback: '5m',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-docker-container-startup-failure',
    title: 'Docker container startup fails',
    source: 'docker-monitor',
    sourcePath: '/var/log/journal',
    line: 'OCI runtime start failed: container process is already dead: unknown',
    pattern: 'OCI runtime start failed: container process is already dead: unknown',
    finding: 'The Docker fixture contains the exact OCI dead-process startup failure.',
    healthyLine: 'container start completed successfully',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-windows-container-creation-failure',
    title: 'Windows container creation fails',
    source: 'containerd',
    sourcePath: 'C:\\etc\\kubernetes\\logs\\containerd.log',
    line: 'failed to create containerd container: error unpacking image: wrong diff id calculated on extraction',
    pattern:
      '.*failed to create containerd container.*error unpacking image.*wrong diff id calculated on extraction.*',
    finding: 'The normalized Windows containerd line reports a wrong extracted layer diff ID.',
    healthyLine: 'created containerd container and unpacked image',
    profiles: ['aks'],
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-windows-hcs-empty-layerchain',
    title: 'Windows HCS reports an empty layerchain',
    source: 'containerd',
    sourcePath: 'C:\\etc\\kubernetes\\logs\\containerd.log',
    line: "Failed to unmarshall layerchain json - invalid character '\x00' looking for beginning of value",
    pattern:
      ".*Failed to unmarshall layerchain json - invalid character '\\x00' looking for beginning of value*",
    finding: 'The normalized Windows containerd line reports a NUL-prefixed empty HCS layerchain.',
    healthyLine: 'HCS unmarshalled layerchain with 3 layers',
    profiles: ['aks'],
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-containerd-start',
    title: 'Systemd starts containerd',
    source: 'systemd-monitor',
    sourcePath: '/var/log/journal',
    line: 'Starting containerd container runtime...',
    pattern:
      'Starting (containerd container runtime|containerd.service|containerd.service - containerd container runtime)...',
    finding: 'The exact systemd line records containerd entering its start sequence.',
    healthyLine: 'containerd.service is active and continuously running',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-docker-start',
    title: 'Systemd starts Docker',
    source: 'systemd-monitor',
    sourcePath: '/var/log/journal',
    line: 'Starting Docker Application Container Engine...',
    pattern:
      'Starting (Docker Application Container Engine|docker.service|docker.service - Docker Application Container Engine)...',
    finding: 'The exact systemd line records Docker entering its start sequence.',
    healthyLine: 'docker.service is active and continuously running',
  }),
  logDraft({
    scenarioId: 'rule-gap-npd-kubelet-start',
    title: 'Systemd starts kubelet',
    source: 'systemd-monitor',
    sourcePath: '/var/log/journal',
    line: 'Started Kubernetes kubelet.',
    pattern:
      'Started (Kubernetes kubelet|kubelet.service|kubelet.service - Kubernetes kubelet|kubelet.service - .*).',
    finding: 'The exact systemd line records kubelet completing a start event.',
    healthyLine: 'kubelet.service is active and continuously running',
  }),
];
