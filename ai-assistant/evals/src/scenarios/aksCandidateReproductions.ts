import assert from 'node:assert/strict';

export const aksCandidateReproductions = [
  ...[
    [
      '001',
      'crd-short-name-collision',
      'API-discovery mechanism with isolated CRDs; not installation of managed Flux or ACStor.',
    ],
    [
      '029',
      'immutable-deployment-selector',
      'Kubernetes selector immutability during an owned deployment update; not the managed ArgoCD extension.',
    ],
    [
      '054',
      'pdb-blocked-eviction',
      'Real policy/v1 eviction and PodDisruptionBudget admission; not a historical AKS upgrade.',
    ],
    [
      '094',
      'identity-false-proxy-annotation',
      'Pinned upstream workload-identity admission with false proxy annotation; no Azure authentication.',
    ],
    [
      '095',
      'identity-proxy-nonroot-conflict',
      'Pinned proxy injection and kubelet security-context validation; no Azure authentication.',
    ],
    [
      '096',
      'identity-proxy-job-completion',
      'Pinned proxy injection and real Job lifecycle; no Azure authentication.',
    ],
    [
      '097',
      'identity-proxy-quota',
      'Pinned proxy mutation and real ResourceQuota admission; no Azure authentication.',
    ],
    [
      '098',
      'identity-service-account-reinvocation',
      'Pinned webhook reinvocation with two test service accounts; metadata consistency, not Azure authorization.',
    ],
    [
      '099',
      'identity-native-sidecar-mutation',
      'Pinned webhook admission of a native-sidecar Pod and kubelet startup; no Azure authentication.',
    ],
    [
      '100',
      'identity-service-account-annotation',
      'Pinned webhook lookup of Service versus ServiceAccount annotations; metadata only, not token exchange.',
    ],
  ].map(([number, mechanism, scope]) => ({
    id: `aks-c${number}-v1`,
    candidateId: `AKS-C${number}`,
    mechanism,
    scope,
    qualification: 'pending',
    prerequisites:
      number! >= '094'
        ? 'Pinned workload-identity webhook restricted to owned namespaces'
        : 'Disposable Kubernetes cluster',
  })),
  {
    id: 'aks-c059-v1',
    candidateId: 'AKS-C059',
    mechanism: 'isolated-coredns-leading-dot-zone',
    qualification: 'pending',
    scope:
      'An isolated CoreDNS workload, not the managed cluster DNS service or historical AKS rollout.',
  },
] as const;

export const corednsCandidateCorefiles = {
  baseline:
    'example.test:1053 {\n  errors\n  health :8080\n  ready :8181\n  hosts {\n    192.0.2.10 answer.example.test\n  }\n}\n',
  fault:
    '.example.test:1053 {\n  errors\n  health :8080\n  ready :8181\n  hosts {\n    192.0.2.10 answer.example.test\n  }\n}\n',
};

export function corednsCandidateResources(options: {
  namespace: string;
  owner: string;
  corednsImage: string;
  probeImage: string;
  phase: 'baseline' | 'fault' | 'recovery';
}) {
  assert.match(options.owner, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(options.namespace, `hl-aks-c059-${options.owner}`);
  for (const image of [options.corednsImage, options.probeImage]) {
    assert.match(image, /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/, 'Use immutable images');
  }
  const metadata = (name: string) => ({
    name,
    namespace: options.namespace,
    labels: {
      'headlamp-research-owner': options.owner,
    },
  });
  const podName = 'dns';
  const configName = 'corefile';
  const securityContext = {
    allowPrivilegeEscalation: false,
    readOnlyRootFilesystem: true,
    capabilities: { drop: ['ALL'] },
    runAsNonRoot: true,
    runAsUser: 65532,
    seccompProfile: { type: 'RuntimeDefault' },
  };
  return {
    config: {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      metadata: metadata(configName),
      data: {
        Corefile: corednsCandidateCorefiles[options.phase === 'fault' ? 'fault' : 'baseline'],
      },
    },
    pod: {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { ...metadata(podName), labels: { ...metadata(podName).labels, app: podName } },
      spec: {
        automountServiceAccountToken: false,
        restartPolicy: 'Always',
        containers: [
          {
            name: 'coredns',
            image: options.corednsImage,
            imagePullPolicy: 'IfNotPresent',
            args: ['-conf', '/etc/coredns/Corefile'],
            securityContext,
            resources: {
              requests: { cpu: '10m', memory: '16Mi' },
              limits: { cpu: '100m', memory: '64Mi' },
            },
            volumeMounts: [{ name: 'config', mountPath: '/etc/coredns', readOnly: true }],
            readinessProbe: { httpGet: { path: '/ready', port: 8181 }, periodSeconds: 1 },
          },
        ],
        volumes: [{ name: 'config', configMap: { name: configName } }],
      },
    },
    service: {
      apiVersion: 'v1',
      kind: 'Service',
      metadata: metadata('dns'),
      spec: {
        selector: { app: podName },
        ports: [{ name: 'dns', protocol: 'UDP', port: 53, targetPort: 1053 }],
      },
    },
    probe: {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: metadata('probe'),
      spec: {
        automountServiceAccountToken: false,
        restartPolicy: 'Never',
        containers: [
          {
            name: 'probe',
            image: options.probeImage,
            imagePullPolicy: 'IfNotPresent',
            command: ['sh', '-c', 'exec tail -f /dev/null'],
            securityContext,
            resources: {
              requests: { cpu: '10m', memory: '8Mi' },
              limits: { cpu: '100m', memory: '32Mi' },
            },
          },
        ],
      },
    },
  };
}
