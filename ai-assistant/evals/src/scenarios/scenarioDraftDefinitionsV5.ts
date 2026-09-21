import type { ClusterProfileName, RequiredMechanism } from '../contracts/evaluationContracts.js';
import { createRequire } from 'node:module';
import type { ScenarioDraftDefinition } from './scenarioDraftDefinition.js';

export type V5Category =
  | 'workload_configuration'
  | 'control_plane_host_hardening'
  | 'runtime_node_failure'
  | 'operations_deprecation';
export type V5Feasibility = 'manifest_only' | 'live_cluster' | 'telemetry' | 'host' | 'runtime';
export type V5SelectionTrack = 'falco_chain' | 'node_problem_detector' | 'policy' | 'operations';

export interface V5ScenarioCatalogSeed {
  scenarioId: string;
  title: string;
  trigger: string;
  healthy: string;
  resources: string[];
  targetRuleIds: string[];
  selectionTrack: V5SelectionTrack;
  category: V5Category;
  feasibility: V5Feasibility;
  requiredMechanisms: string[];
  supportedClusterProfiles: ClusterProfileName[];
}

interface InventoryRule {
  rule_id: string;
  title: string;
  semantic_group_id: string;
  mapping_readiness?: string;
}

interface InventoryTool {
  tool_id: string;
  mapping_readiness: string;
  rules: InventoryRule[];
}

interface PriorCatalogue {
  scenarios: Array<{ target_semantic_group_ids: string[] }>;
}

interface SelectedGroup {
  toolId: string;
  title: string;
  rules: InventoryRule[];
}

interface Fixture {
  setup: object[];
  resourceRef: string;
  fieldPath: string;
  brokenValue: string;
  healthyValue: string;
  finding: string;
  observationKinds: string[];
  mechanisms: RequiredMechanism[];
  profiles: ClusterProfileName[];
  category: V5Category;
  feasibility: V5Feasibility;
  track: V5SelectionTrack;
}

const allProfiles: ClusterProfileName[] = ['local-kwok', 'local-minikube', 'aks'];
const runtimeProfiles: ClusterProfileName[] = ['local-minikube', 'aks'];
const manifestProfiles: ClusterProfileName[] = ['local-kwok'];
const pauseImage = 'registry.k8s.io/pause:3.10';
const busyboxImage = 'registry.k8s.io/e2e-test-images/busybox:1.29-4';

const moduleRequire = createRequire(import.meta.url);
const inventory = moduleRequire('../../registrations/tool-rule-inventory-v1.json') as {
  tools: InventoryTool[];
};
const mapping = moduleRequire('../../registrations/tool-scenario-rule-mapping-v1.json') as {
  rule_mappings: Array<{ rules: Array<{ rule_id: string; status: string }> }>;
};
const priorCatalogues = [1, 2, 3, 4].map(
  version =>
    moduleRequire(`../../registrations/rule-gap-scenarios-v${version}.json`) as PriorCatalogue
);

const priorGroups = new Set(
  priorCatalogues.flatMap(batch =>
    batch.scenarios.flatMap(scenario => scenario.target_semantic_group_ids)
  )
);
const statusByRule = new Map(
  mapping.rule_mappings.flatMap(entry => entry.rules.map(rule => [rule.rule_id, rule.status]))
);
const quotas = new Map<string, number>([
  ['pluto', 53],
  ['falco', 16],
  ['kubevious', 13],
  ['popeye', 24],
  ['kubernetes-mixin', 4],
]);

const selectedGroups: SelectedGroup[] = inventory.tools
  .filter(tool => quotas.has(tool.tool_id))
  .flatMap(tool => {
    const groups = new Map<string, InventoryRule[]>();
    for (const rawRule of tool.rules) {
      const rule = rawRule as InventoryRule;
      const readiness = rule.mapping_readiness ?? tool.mapping_readiness;
      if (
        readiness !== 'direct_predicate' ||
        statusByRule.get(rule.rule_id) !== 'uncovered' ||
        priorGroups.has(rule.semantic_group_id) ||
        (tool.tool_id === 'pluto' &&
          (rule.title === 'authentication.istio.io/v1alpha1 removed in v1.6.0' ||
            rule.title.includes('AuthorizationPolicies removed') ||
            rule.title.includes(' FlowControl removed')))
      ) {
        continue;
      }
      const members = groups.get(rule.semantic_group_id) ?? [];
      members.push(rule);
      groups.set(rule.semantic_group_id, members);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, quotas.get(tool.tool_id))
      .map(([, rules]) => ({ toolId: tool.tool_id, title: rules[0]!.title, rules }));
  });

if (selectedGroups.length !== 110) {
  throw new Error(`expected 110 v5 semantic groups, found ${selectedGroups.length}`);
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 46);

const deployment = (name: string, spec: Record<string, unknown>) => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name },
  spec: {
    replicas: 1,
    selector: { matchLabels: { app: name } },
    template: {
      metadata: { labels: { app: name } },
      spec: {
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
          },
        ],
        ...spec,
      },
    },
  },
});

const boundedJob = (name: string, command: string) => ({
  apiVersion: 'batch/v1',
  kind: 'Job',
  metadata: { name, labels: { 'evals.kubernetes.io/bounded-action': 'true' } },
  spec: {
    activeDeadlineSeconds: 60,
    backoffLimit: 0,
    ttlSecondsAfterFinished: 300,
    template: {
      metadata: { labels: { app: name } },
      spec: {
        restartPolicy: 'Never',
        containers: [
          {
            name: 'action',
            image: busyboxImage,
            command: ['/bin/sh', '-ceu', command],
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
              runAsNonRoot: true,
              runAsUser: 1000,
            },
            volumeMounts: [{ name: 'fixture', mountPath: '/fixture' }],
          },
        ],
        volumes: [{ name: 'fixture', emptyDir: { sizeLimit: '8Mi' } }],
      },
    },
  },
});

const deprecatedApiFixture = (title: string, index: number): Fixture => {
  const match = title.match(/^(\S+)(?:\s+(.+?))?\s+removed in(?:\s+(\S+))?$/);
  if (!match) {
    throw new Error(`cannot parse deprecation title: ${title}`);
  }
  const [, sourceApi, parsedKind, parsedRemoval] = match;
  const kind = parsedKind ?? 'Policy';
  const removal = parsedRemoval ?? 'the pinned target release';
  const apiVersion = sourceApi!.includes('/') ? sourceApi! : `${sourceApi}/v1alpha1`;
  const stableApi = apiVersion.startsWith('certmanager.k8s.io/')
    ? 'cert-manager.io/v1'
    : apiVersion.startsWith('acme.cert-manager.io/')
    ? 'acme.cert-manager.io/v1'
    : apiVersion.startsWith('cert-manager.io/')
    ? 'cert-manager.io/v1'
    : apiVersion.startsWith('flowcontrol.apiserver.k8s.io/')
    ? 'flowcontrol.apiserver.k8s.io/v1'
    : apiVersion.startsWith('resource.k8s.io/')
    ? 'resource.k8s.io/v1'
    : apiVersion.startsWith('storage.k8s.io/')
    ? 'storage.k8s.io/v1'
    : apiVersion.startsWith('rbac.authorization.k8s.io/')
    ? 'rbac.authorization.k8s.io/v1'
    : apiVersion.startsWith('audit.k8s.io/')
    ? 'audit.k8s.io/v1'
    : apiVersion.startsWith('authentication.k8s.io/')
    ? 'authentication.k8s.io/v1'
    : apiVersion.startsWith('admissionregistration.k8s.io/')
    ? 'admissionregistration.k8s.io/v1'
    : 'security.istio.io/v1beta1';
  const name = `deprecated-api-${index}`;
  const object: Record<string, unknown> = {
    apiVersion,
    kind,
    metadata: { name },
  };
  if (kind!.endsWith('List')) {
    object.items = [];
  } else if (kind === 'ClusterRole' || kind === 'Role') {
    object.rules = [{ apiGroups: [''], resources: ['pods'], verbs: ['get'] }];
  } else if (kind === 'ClusterRoleBinding' || kind === 'RoleBinding') {
    object.roleRef = { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: 'reader' };
    object.subjects = [{ kind: 'ServiceAccount', name: 'reader', namespace: 'default' }];
  } else {
    object.spec = {};
  }
  return {
    setup: [object],
    resourceRef: `${kind!.toLowerCase()}/${name}`,
    fieldPath: 'apiVersion',
    brokenValue: apiVersion,
    healthyValue: stableApi,
    finding: `${kind} uses ${apiVersion}, which was removed in ${removal}.`,
    observationKinds: ['manifest.object', 'manifest.field'],
    mechanisms: [],
    profiles: manifestProfiles,
    category: 'operations_deprecation',
    feasibility: 'manifest_only',
    track: 'operations',
  };
};

const kubeviousFixture = (ruleId: string, index: number): Fixture => {
  const name = `missing-reference-${index}`;
  let setup: object[];
  let resourceRef: string;
  let fieldPath: string;
  if (ruleId.endsWith('container-env-config-map-ref')) {
    setup = [
      deployment(name, {
        containers: [
          {
            name: 'app',
            image: pauseImage,
            env: [
              {
                name: 'SETTING',
                valueFrom: { configMapKeyRef: { name: 'absent-settings', key: 'value' } },
              },
            ],
          },
        ],
      }),
    ];
    resourceRef = `deployment/${name}`;
    fieldPath = 'spec.template.spec.containers[0].env[0].valueFrom.configMapKeyRef.name';
  } else if (ruleId.endsWith('container-env-secret-ref')) {
    setup = [
      deployment(name, {
        containers: [
          {
            name: 'app',
            image: pauseImage,
            env: [
              {
                name: 'TOKEN',
                valueFrom: { secretKeyRef: { name: 'absent-token', key: 'token' } },
              },
            ],
          },
        ],
      }),
    ];
    resourceRef = `deployment/${name}`;
    fieldPath = 'spec.template.spec.containers[0].env[0].valueFrom.secretKeyRef.name';
  } else if (ruleId.includes('sql-database-to-instance')) {
    setup = [
      {
        apiVersion: 'sql.cnrm.cloud.google.com/v1beta1',
        kind: 'SQLDatabase',
        metadata: { name },
        spec: { instanceRef: { name: 'absent-sql-instance' } },
      },
    ];
    resourceRef = `sqldatabase/${name}`;
    fieldPath = 'spec.instanceRef.name';
  } else if (ruleId.includes('sql-user-to-instance')) {
    setup = [
      {
        apiVersion: 'sql.cnrm.cloud.google.com/v1beta1',
        kind: 'SQLUser',
        metadata: { name },
        spec: { instanceRef: { name: 'absent-sql-instance' }, host: '%' },
      },
    ];
    resourceRef = `sqluser/${name}`;
    fieldPath = 'spec.instanceRef.name';
  } else if (ruleId.includes('sql-user-to-password')) {
    setup = [
      {
        apiVersion: 'sql.cnrm.cloud.google.com/v1beta1',
        kind: 'SQLUser',
        metadata: { name },
        spec: {
          instanceRef: { name: 'fixture-instance' },
          password: { valueFrom: { secretKeyRef: { name: 'absent-password', key: 'password' } } },
        },
      },
    ];
    resourceRef = `sqluser/${name}`;
    fieldPath = 'spec.password.valueFrom.secretKeyRef.name';
  } else if (ruleId.endsWith('ingress-to-cert-issuer-ref')) {
    setup = [
      {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: { name, annotations: { 'cert-manager.io/issuer': 'absent-issuer' } },
        spec: { rules: [{ host: 'fixture.example.test' }] },
      },
    ];
    resourceRef = `ingress/${name}`;
    fieldPath = 'metadata.annotations[cert-manager.io/issuer]';
  } else if (ruleId.endsWith('istio-virtual-service-to-gateway-ref')) {
    setup = [
      {
        apiVersion: 'networking.istio.io/v1beta1',
        kind: 'VirtualService',
        metadata: { name },
        spec: {
          hosts: ['fixture.example.test'],
          gateways: ['absent-gateway'],
          http: [{ route: [{ destination: { host: 'fixture' } }] }],
        },
      },
    ];
    resourceRef = `virtualservice/${name}`;
    fieldPath = 'spec.gateways[0]';
  } else if (ruleId.endsWith('kong-consumer-to-credential-secret-ref')) {
    setup = [
      {
        apiVersion: 'configuration.konghq.com/v1',
        kind: 'KongConsumer',
        metadata: { name },
        username: 'fixture-user',
        credentials: ['absent-credential'],
      },
    ];
    resourceRef = `kongconsumer/${name}`;
    fieldPath = 'credentials[0]';
  } else if (ruleId.endsWith('kong-plugin-ref')) {
    setup = [
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name, annotations: { 'konghq.com/plugins': 'absent-plugin' } },
        spec: { selector: { app: name }, ports: [{ name: 'http', port: 80, targetPort: 'http' }] },
      },
    ];
    resourceRef = `service/${name}`;
    fieldPath = 'metadata.annotations[konghq.com/plugins]';
  } else if (ruleId.includes('volume-config-map')) {
    setup = [
      deployment(name, { volumes: [{ name: 'config', configMap: { name: 'absent-config' } }] }),
    ];
    resourceRef = `deployment/${name}`;
    fieldPath = 'spec.template.spec.volumes[0].configMap.name';
  } else if (ruleId.includes('volume-pvc')) {
    setup = [
      deployment(name, {
        volumes: [{ name: 'data', persistentVolumeClaim: { claimName: 'absent-claim' } }],
      }),
    ];
    resourceRef = `deployment/${name}`;
    fieldPath = 'spec.template.spec.volumes[0].persistentVolumeClaim.claimName';
  } else if (ruleId.includes('volume-secret')) {
    setup = [
      deployment(name, { volumes: [{ name: 'secret', secret: { secretName: 'absent-secret' } }] }),
    ];
    resourceRef = `deployment/${name}`;
    fieldPath = 'spec.template.spec.volumes[0].secret.secretName';
  } else {
    setup = [
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'RoleBinding',
        metadata: { name },
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: 'reader' },
        subjects: [{ kind: 'ServiceAccount', name: 'absent-account', namespace: 'default' }],
      },
    ];
    resourceRef = `rolebinding/${name}`;
    fieldPath = 'subjects[0]';
  }
  return {
    setup,
    resourceRef,
    fieldPath,
    brokenValue: 'reference names an absent object',
    healthyValue: 'reference resolves to one object of the required kind',
    finding: 'The object reference cannot resolve within its required scope.',
    observationKinds: ['manifest.object', 'manifest.reference'],
    mechanisms: ['api-server'],
    profiles: allProfiles,
    category: 'workload_configuration',
    feasibility: 'manifest_only',
    track: 'policy',
  };
};

const popeyeFixture = (ruleId: string, index: number): Fixture => {
  const code = ruleId.split(':').at(-1)!;
  const name = `object-finding-${index}`;
  let setup: object[] = [deployment(name, {})];
  let resourceRef = `deployment/${name}`;
  let fieldPath = 'spec.template.spec.containers[0]';
  let brokenValue = `predicate ${code} is satisfied`;
  let healthyValue = `predicate ${code} is false`;
  let observationKinds = ['manifest.object', 'manifest.field'];
  let feasibility: V5Feasibility = 'manifest_only';
  if (code === '1000') {
    setup = [
      {
        apiVersion: 'v1',
        kind: 'PersistentVolume',
        metadata: { name },
        spec: {
          capacity: { storage: '1Gi' },
          accessModes: ['ReadWriteOnce'],
          csi: {
            driver: 'fixture.csi.evals.kubernetes.io',
            volumeHandle: 'unused-volume',
          },
        },
        status: { phase: 'Available' },
      },
    ];
    resourceRef = `persistentvolume/${name}`;
    fieldPath = 'status.phase';
    brokenValue = 'Available';
    healthyValue = 'Bound';
  } else if (code === '105') {
    setup = [
      deployment(name, {
        containers: [
          {
            name: 'app',
            image: pauseImage,
            ports: [{ name: 'http', containerPort: 8080 }],
            livenessProbe: { httpGet: { path: '/healthz', port: 8080 } },
            readinessProbe: { httpGet: { path: '/ready', port: 'http' } },
            resources: {
              requests: { cpu: '100m', memory: '64Mi' },
              limits: { cpu: '100m', memory: '64Mi' },
            },
          },
        ],
      }),
    ];
    fieldPath = 'spec.template.spec.containers[0].livenessProbe.httpGet.port';
    brokenValue = '8080';
    healthyValue = 'http';
  } else if (['1102', '1106'].includes(code)) {
    const containerPort = code === '1102' ? 8080 : 9090;
    setup = [
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name },
        spec: { selector: { app: name }, ports: [{ name: 'http', port: 80, targetPort: 8080 }] },
      },
      deployment(name, {
        containers: [{ name: 'app', image: pauseImage, ports: [{ name: 'web', containerPort }] }],
      }),
    ];
    resourceRef = `service/${name}`;
    fieldPath = 'spec.ports[0].targetPort + selected container ports';
    brokenValue =
      code === '1102'
        ? 'numeric targetPort 8080 with selected container port 8080'
        : 'targetPort 8080 with no selected container port 8080';
    healthyValue = `web resolving to selected container port ${containerPort}`;
  } else if (['106', '107'].includes(code)) {
    const resources = code === '107' ? { requests: { cpu: '10m', memory: '16Mi' } } : undefined;
    setup = [deployment(name, { containers: [{ name: 'app', image: pauseImage, resources }] })];
    fieldPath = 'spec.template.spec.containers[0].resources';
    brokenValue = code === '107' ? 'requests set; limits absent' : 'field absent';
    healthyValue = 'requests and limits set';
  } else if (code === '108') {
    setup = [
      deployment(name, {
        containers: [{ name: 'app', image: pauseImage, ports: [{ containerPort: 8080 }] }],
      }),
    ];
    fieldPath = 'spec.template.spec.containers[0].ports[0].name';
    brokenValue = 'field absent';
    healthyValue = 'http';
  } else if (['109', '110', '111', '112'].includes(code)) {
    const resource = code === '109' || code === '111' ? 'cpu' : 'memory';
    const guaranteed = code === '111' || code === '112';
    const requests = { cpu: '100m', memory: '100Mi' };
    const limits = guaranteed ? { cpu: '100m', memory: '100Mi' } : { cpu: '200m', memory: '200Mi' };
    const usage = {
      cpu: resource === 'cpu' ? '95m' : '50m',
      memory: resource === 'memory' ? '95Mi' : '50Mi',
    };
    setup = [
      deployment(name, {
        containers: [
          {
            name: 'app',
            image: pauseImage,
            resources: { requests, limits },
          },
        ],
      }),
      {
        apiVersion: 'metrics.k8s.io/v1beta1',
        kind: 'PodMetrics',
        metadata: { name: `${name}-pod` },
        containers: [{ name: 'app', usage }],
      },
    ];
    resourceRef = `podmetrics/${name}-pod`;
    fieldPath = `containers[0].usage.${resource} / workload ${
      code === '109' || code === '110' ? 'request' : 'limit'
    }`;
    brokenValue = '95%';
    healthyValue = 'below 80%';
    observationKinds = ['manifest.object', 'metrics.pod'];
    feasibility = 'telemetry';
  } else if (code === '1101') {
    setup = [
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name },
        spec: { selector: { app: name }, ports: [{ name: 'http', port: 80, targetPort: 'http' }] },
      },
      deployment(name, {}),
    ];
    resourceRef = `service/${name}`;
    fieldPath = 'spec.selector + selected container ports';
    brokenValue = 'selected Pod has no explicit container ports';
    healthyValue = 'selected Pod declares named container port http';
  } else if (['1103', '1107', '1108'].includes(code)) {
    const type = code === '1108' ? 'NodePort' : 'LoadBalancer';
    const externalTrafficPolicy = code === '1103' ? 'Local' : code === '1108' ? 'Local' : 'Cluster';
    setup = [
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name },
        spec: {
          type,
          externalTrafficPolicy,
          selector: { app: name },
          ports: [{ name: 'http', port: 80, targetPort: 'http' }],
        },
      },
    ];
    resourceRef = `service/${name}`;
    fieldPath = code === '1103' ? 'spec.type' : 'spec.type + spec.externalTrafficPolicy';
    brokenValue = code === '1103' ? type : `${type}; ${externalTrafficPolicy}`;
    healthyValue =
      code === '1103' ? 'ClusterIP' : `${type}; ${code === '1108' ? 'Cluster' : 'Local'}`;
  } else if (['1202', '1203', '1206', '1207', '1208'].includes(code)) {
    const clientPod = {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: `${name}-client`, labels: { app: 'client' } },
      spec: { containers: [{ name: 'app', image: pauseImage }] },
      status: { podIP: code === '1207' ? '192.0.2.10' : '198.51.100.10' },
    };
    if (code === '1203') {
      setup = [
        {
          apiVersion: 'networking.k8s.io/v1',
          kind: 'NetworkPolicy',
          metadata: { name },
          spec: { podSelector: {}, policyTypes: ['Ingress', 'Egress'] },
        },
      ];
      resourceRef = `networkpolicy/${name}`;
      fieldPath = 'spec.podSelector + spec.policyTypes + ingress + egress';
      brokenValue = 'empty selector with both policy types and no rules';
      healthyValue = 'non-empty selector scoped to one workload';
    } else {
      const peer =
        code === '1208'
          ? {
              namespaceSelector: { matchLabels: { tenant: 'controlled' } },
              podSelector: { matchLabels: { app: 'absent' } },
            }
          : code === '1202'
          ? {
              namespaceSelector: { matchLabels: { tenant: 'absent' } },
              podSelector: { matchLabels: { app: 'absent' } },
            }
          : {
              ipBlock: {
                cidr: '192.0.2.0/24',
                except: code === '1207' ? ['192.0.2.128/25'] : [],
              },
            };
      setup = [
        ...(code === '1208'
          ? [
              {
                apiVersion: 'v1',
                kind: 'Namespace',
                metadata: { name: `${name}-peer`, labels: { tenant: 'controlled' } },
              },
            ]
          : []),
        clientPod,
        {
          apiVersion: 'networking.k8s.io/v1',
          kind: 'NetworkPolicy',
          metadata: { name },
          spec: {
            podSelector: { matchLabels: { app: 'client' } },
            policyTypes: ['Egress'],
            egress: [{ to: [peer] }],
          },
        },
      ];
      resourceRef = `networkpolicy/${name}`;
      fieldPath = 'spec.egress[0].to[0] + namespace and Pod inventory';
      brokenValue =
        code === '1207'
          ? 'CIDR matches a Pod IP but except range matches none'
          : 'peer matches no controlled destination';
      healthyValue = 'peer matches one controlled destination';
    }
  } else if (code === '1300') {
    setup = [deployment(name, { serviceAccountName: 'absent-account' })];
    fieldPath = 'spec.template.spec.serviceAccountName + ServiceAccount inventory';
    brokenValue = 'absent-account; 0 matches';
    healthyValue = 'fixture-account; 1 match';
  } else if (['1400', '1403', '1404'].includes(code)) {
    const port = code === '1403' ? { number: 8080 } : code === '1404' ? {} : { name: 'http' };
    setup = [
      {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: { name },
        spec: {
          rules: [
            {
              host: 'fixture.example.test',
              http: {
                paths: [
                  {
                    path: '/',
                    pathType: 'Prefix',
                    backend: { service: { name: 'fixture-backend', port } },
                  },
                ],
              },
            },
          ],
        },
        ...(code === '1400'
          ? {
              status: {
                loadBalancer: {
                  ingress: [
                    {
                      ip: '192.0.2.10',
                      ports: [{ port: 443, protocol: 'TCP', error: 'fixture port unavailable' }],
                    },
                  ],
                },
              },
            }
          : {}),
      },
    ];
    resourceRef = `ingress/${name}`;
    fieldPath =
      code === '1400'
        ? 'status.loadBalancer.ingress[0].ports[0].error'
        : 'spec.rules[0].http.paths[0].backend.service.port';
    brokenValue =
      code === '1400' ? 'fixture port unavailable' : code === '1403' ? '{number: 8080}' : '{}';
    healthyValue = code === '1400' ? 'error field absent' : '{name: http}';
  }
  return {
    setup,
    resourceRef,
    fieldPath,
    brokenValue,
    healthyValue,
    finding: `The controlled object satisfies the exact ${code} trigger described by its native fields or status.`,
    observationKinds,
    mechanisms: feasibility === 'telemetry' ? ['api-server', 'kubelet'] : ['api-server'],
    profiles: feasibility === 'telemetry' ? runtimeProfiles : allProfiles,
    category: 'workload_configuration',
    feasibility,
    track: 'policy',
  };
};

const mixinFixture = (ruleId: string, index: number): Fixture => {
  const alert = ruleId.split(':').at(-1)!;
  const name = `telemetry-state-${index}`;
  const telemetryConfigMap = (evidence: object) => ({
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: {
      name,
      labels: { 'evals.kubernetes.io/fixture-kind': 'telemetry-evidence' },
      annotations: { 'evals.kubernetes.io/apply-to-current-host': 'false' },
    },
    data: { 'evidence.json': JSON.stringify(evidence) },
  });
  const states: Record<
    string,
    { object: object; ref: string; path: string; broken: string; healthy: string }
  > = {
    KubeAPITerminatedRequests: {
      object: telemetryConfigMap({
        reason: 'RequestTerminated',
        note: 'apiserver_request_terminations_total increased by 6 in five minutes',
      }),
      ref: `configmap/${name}`,
      path: 'data.evidence.json#reason + note',
      broken:
        'RequestTerminated; apiserver_request_terminations_total increased by 6 in five minutes',
      healthy: 'no termination events; increase=0/5m',
    },
    KubeClientErrors: {
      object: telemetryConfigMap({
        reason: 'ClientRequestErrors',
        note: 'rest_client_requests_total code=500 rate is 0.03 over five minutes',
      }),
      ref: `configmap/${name}`,
      path: 'data.evidence.json#reason + note',
      broken:
        'ClientRequestErrors; rest_client_requests_total code=500 rate is 0.03 over five minutes',
      healthy: '500 ratio=0',
    },
    KubeletTooManyPods: {
      object: telemetryConfigMap({
        status: { allocatable: { pods: '10' }, capacity: { pods: '10' } },
        observedPodCount: 10,
      }),
      ref: `configmap/${name}`,
      path: 'data.evidence.json#observedPodCount + status.allocatable.pods',
      broken: '10; 10',
      healthy: '5/10',
    },
    KubeVersionMismatch: {
      object: telemetryConfigMap({
        status: { nodeInfo: { kubeletVersion: 'v1.31.0', kubeProxyVersion: 'v1.31.0' } },
        controlPlaneVersion: 'v1.34.0',
      }),
      ref: `configmap/${name}`,
      path: 'data.evidence.json#status.nodeInfo.kubeletVersion + controlPlaneVersion',
      broken: 'v1.31.0; v1.34.0',
      healthy: 'same minor version',
    },
  };
  const state = states[alert];
  if (!state) {
    throw new Error(`missing telemetry fixture for ${alert}`);
  }
  return {
    setup: [state.object],
    resourceRef: state.ref,
    fieldPath: state.path,
    brokenValue: state.broken,
    healthyValue: state.healthy,
    finding: `${alert} is sustained by the controlled native status or event evidence.`,
    observationKinds: ['resource.status', 'events.warning', 'metrics.series'],
    mechanisms: ['api-server', 'kubelet'],
    profiles: runtimeProfiles,
    category: 'runtime_node_failure',
    feasibility: 'telemetry',
    track: 'policy',
  };
};

const falcoFixture = (ruleId: string, title: string, index: number): Fixture => {
  const name = `bounded-action-${index}`;
  const actions: Record<string, { command: string; evidence: string }> = {
    'backdoored-library-loaded-into-sshd-cve-2024-3094:07b397541f6f': {
      command:
        'mkdir -p /fixture/lib; printf xz-fixture > /fixture/lib/liblzma.so.5; printf "#!/bin/sh\ncat /fixture/lib/liblzma.so.5\n" > /fixture/sshd; chmod 700 /fixture/sshd; /fixture/sshd',
      evidence: 'sshd-named fixture reads controlled liblzma.so.5',
    },
    'bpf-program-not-profiled:c852d4ff5dc4': {
      command:
        'mkdir -p /fixture/sys/fs/bpf; printf unprofiled > /fixture/sys/fs/bpf/program; test -s /fixture/sys/fs/bpf/program',
      evidence: 'unprofiled program marker exists in the Pod-local bpf fixture',
    },
    'disallowed-ssh-connection-non-standard-port:01e10d51e54d': {
      command:
        'printf controlled > /fixture/ssh-payload; /bin/busybox nc -l -p 2222 < /fixture/ssh-payload & listener=$!; /bin/busybox nc 127.0.0.1 2222 > /fixture/ssh-result; wait "$listener"; cat /fixture/ssh-result',
      evidence: 'loopback SSH-shaped connection on port 2222',
    },
    'java-process-class-file-download:2880c71d3043': {
      command:
        'printf cafebabe > /fixture/Controlled.class; printf "#!/bin/sh\ncat /fixture/Controlled.class\n" > /fixture/java; chmod 700 /fixture/java; /fixture/java',
      evidence: 'java-named fixture reads a controlled class file',
    },
    'launch-disallowed-container:53dab90d12d4': {
      command:
        'printf disallowed-container-marker > /fixture/container-name; cat /fixture/container-name',
      evidence: 'bounded Job launches the explicitly marked action container',
    },
    'launch-suspicious-network-tool-on-host:12d60c2b4bc7': {
      command: '/bin/busybox nc -z -w 1 127.0.0.1 1 || printf closed-loopback-port',
      evidence: 'network utility probes one closed loopback port',
    },
    'netcat-socat-remote-code-execution-on-host:3fa7002640b7': {
      command:
        'printf bounded-command > /fixture/input; /bin/busybox nc -l -p 2323 < /fixture/input & listener=$!; /bin/busybox nc 127.0.0.1 2323 > /fixture/output; wait "$listener"; cat /fixture/output',
      evidence: 'netcat transfers a fixed string over Pod loopback',
    },
    'polkit-local-privilege-escalation-vulnerability-cve-2021-4034:561465fb9c8d': {
      command:
        'printf "#!/bin/sh\nprintf pkexec-fixture\n" > /fixture/pkexec; chmod 700 /fixture/pkexec; /fixture/pkexec',
      evidence: 'pkexec-named fixture runs without privileges',
    },
    'potential-local-privilege-escalation-via-environment-variables-misuse:6e949965f6d1': {
      command:
        'printf controlled > /fixture/preload.so; LD_PRELOAD=/fixture/preload.so /bin/true 2> /fixture/loader.log || true; printf preload-marker >> /fixture/loader.log; cat /fixture/loader.log',
      evidence: 'process starts with controlled LD_PRELOAD evidence',
    },
    'sudo-potential-privilege-escalation:c88287c4bb4e': {
      command:
        'printf "#!/bin/sh\nprintf sudo-fixture\n" > /fixture/sudo; chmod 700 /fixture/sudo; /fixture/sudo -n true',
      evidence: 'sudo-named fixture runs as the existing non-root user',
    },
    'system-procs-network-activity:350606efdb57': {
      command:
        'printf "#!/bin/sh\n/bin/busybox nc -z -w 1 127.0.0.1 1 || true\nprintf systemd-loopback\n" > /fixture/systemd; chmod 700 /fixture/systemd; /fixture/systemd',
      evidence: 'systemd-named fixture performs one loopback probe',
    },
    'system-user-interactive:d27a9e9973d0': {
      command: 'USER=root SHELL=/bin/sh /bin/sh -c "printf system-user-shell"',
      evidence: 'bounded shell starts with a controlled system-user identity marker',
    },
    'unprivileged-delegation-of-page-faults-handling-to-a-userspace-process:5c66ac38f88e': {
      command:
        'mkdir -p /fixture/userfaultfd; printf delegated > /fixture/userfaultfd/registration; cat /fixture/userfaultfd/registration',
      evidence: 'Pod-local userfaultfd registration marker is recorded',
    },
    'update-package-repository:35ae1f185013': {
      command:
        'printf "#!/bin/sh\nprintf repository-update-fixture\n" > /fixture/apt-get; chmod 700 /fixture/apt-get; /fixture/apt-get update',
      evidence: 'package-manager-named fixture receives update',
    },
    'user-mgmt-binaries:9e567b3bae75': {
      command:
        'printf "#!/bin/sh\nprintf useradd-fixture\n" > /fixture/useradd; chmod 700 /fixture/useradd; /fixture/useradd controlled-user',
      evidence: 'useradd-named fixture receives a controlled username',
    },
    'write-below-rpm-database:8947bdea39d4': {
      command:
        'mkdir -p /fixture/var/lib/rpm; printf controlled > /fixture/var/lib/rpm/Packages; sha256sum /fixture/var/lib/rpm/Packages',
      evidence: 'write occurs below the Pod-local rpm database fixture',
    },
  };
  const action = actions[ruleId.replace('falco:rule:', '')];
  if (!action) {
    throw new Error(`missing bounded action for ${ruleId}`);
  }
  return {
    setup: [boundedJob(name, action.command)],
    resourceRef: `job/${name}`,
    fieldPath: 'spec.template.spec.containers[0].command + logs[action]',
    brokenValue: `${action.command}; ${action.evidence}`,
    healthyValue: 'control Job records a benign no-op action',
    finding: `The bounded Job emits the exact controlled process, file, or network action evidence for ${title}.`,
    observationKinds: ['resource.status', 'pod.logs', 'manifest.field'],
    mechanisms: ['api-server', 'scheduler', 'kubelet'],
    profiles: runtimeProfiles,
    category: 'runtime_node_failure',
    feasibility: 'runtime',
    track: 'falco_chain',
  };
};

const fixtureFor = (group: SelectedGroup, index: number): Fixture => {
  if (group.toolId === 'pluto') return deprecatedApiFixture(group.title, index);
  if (group.toolId === 'kubevious') return kubeviousFixture(group.rules[0]!.rule_id, index);
  if (group.toolId === 'popeye') return popeyeFixture(group.rules[0]!.rule_id, index);
  if (group.toolId === 'kubernetes-mixin') return mixinFixture(group.rules[0]!.rule_id, index);
  return falcoFixture(group.rules[0]!.rule_id, group.title, index);
};

const records = selectedGroups.map((group, index) => {
  const fixture = fixtureFor(group, index + 1);
  const scenarioId = `rule-gap-v5-${group.toolId.replace('kubernetes-', '')}-${slug(group.title)}-${
    index + 1
  }`;
  const title = `V5 ${group.title}`;
  const definition: ScenarioDraftDefinition = {
    scenarioId,
    title,
    description: fixture.finding,
    taskPrompt:
      'Inspect the listed Kubernetes resources and diagnose the unsafe, unhealthy, deprecated, or suspicious state. Cite the exact native field, status, event, metric, log, or bounded action evidence. Do not mutate resources.',
    visibleResourceRefs: [fixture.resourceRef],
    observationKinds: fixture.observationKinds,
    setup: fixture.setup,
    acceptedFacts: [
      {
        fact_id: 'trigger-evidence',
        resource_ref: fixture.resourceRef,
        field_path: fixture.fieldPath,
        observed_value: fixture.brokenValue,
        description: fixture.finding,
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'healthy-control',
        resource_ref: fixture.resourceRef,
        field_path: fixture.fieldPath,
        observed_value: fixture.healthyValue,
        description: `The healthy control differs only at ${fixture.fieldPath}.`,
      },
    ],
    requiredMechanisms: fixture.mechanisms,
    supportedClusterProfiles: fixture.profiles,
  };
  const catalog: V5ScenarioCatalogSeed = {
    scenarioId,
    title,
    trigger: `${title}: ${fixture.fieldPath} is ${fixture.brokenValue}.`,
    healthy: `${fixture.fieldPath} is ${fixture.healthyValue}.`,
    resources: [fixture.resourceRef],
    targetRuleIds: group.rules.map(rule => rule.rule_id).sort(),
    selectionTrack: fixture.track,
    category: fixture.category,
    feasibility: fixture.feasibility,
    requiredMechanisms:
      fixture.mechanisms.length > 0
        ? fixture.mechanisms
        : ['manifest parser', 'normalized predicate evaluator'],
    supportedClusterProfiles: fixture.profiles,
  };
  return { definition, catalog };
});

export const v5ScenarioDraftDefinitions: ScenarioDraftDefinition[] = records.map(
  record => record.definition
);

export const v5ScenarioCatalogSeeds: V5ScenarioCatalogSeed[] = records.map(
  record => record.catalog
);
