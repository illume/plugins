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
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';
import type {
  CandidatePacket,
  EvaluatorPacket,
  ScenarioManifest,
} from '../contracts/evaluationContracts.js';
import { advancedScenarioDraftDefinitions } from './scenarioDraftDefinitionsAdvanced.js';
import { manifestScenarioDraftDefinitions } from './scenarioDraftDefinitionsManifest.js';
import { remainingScenarioDraftDefinitions } from './scenarioDraftDefinitionsRemaining.js';
import { runtimeScenarioDraftDefinitions } from './scenarioDraftDefinitionsRuntime.js';
import { telemetryScenarioDraftDefinitions } from './scenarioDraftDefinitionsTelemetry.js';
import { v3ScenarioDraftDefinitions } from './scenarioDraftDefinitionsV3.js';
import { v4ScenarioDraftDefinitions } from './scenarioDraftDefinitionsV4.js';
import { v5ScenarioDraftDefinitions } from './scenarioDraftDefinitionsV5.js';
import { v6ScenarioDraftDefinitions } from './scenarioDraftDefinitionsV6.js';
import { v7ScenarioDraftDefinitions } from './scenarioDraftDefinitionsV7.js';
import { v8ScenarioDraftDefinitions } from './scenarioDraftDefinitionsV8.js';
import { v9ScenarioDraftDefinitions } from './scenarioDraftDefinitionsV9.js';
import type { ScenarioDraftDefinition } from './scenarioDraftDefinition.js';
import { SCENARIOS_GOAL } from './scenariosGoal.js';

const moduleRequire = createRequire(import.meta.url);
const prettier = moduleRequire('prettier') as {
  format(source: string, options: Record<string, unknown>): string;
  resolveConfig(filePath: string): Promise<Record<string, unknown> | null>;
};

interface GapScenario {
  scenario_id: string;
  title: string;
  category: string;
  selection_track?: string;
  target_rule_ids: string[];
  target_semantic_group_ids: string[];
  target_canonical_capability_ids?: string[];
  target_tool_ids: string[];
  target_rule_count: number;
  provenance_refs: string[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const draftRoot = path.join(evalRoot, 'scenario-drafts');
const v1Path = path.join(evalRoot, 'registrations', 'rule-gap-scenarios-v1.json');
const v2Path = path.join(evalRoot, 'registrations', 'rule-gap-scenarios-v2.json');
const v3Path = path.join(evalRoot, 'registrations', 'rule-gap-scenarios-v3.json');
const v4Path = path.join(evalRoot, 'registrations', 'rule-gap-scenarios-v4.json');
const v5Path = path.join(evalRoot, 'registrations', 'rule-gap-scenarios-v5.json');
const v6Path = path.join(evalRoot, 'registrations', 'rule-gap-scenarios-v6.json');
const v7Path = path.join(evalRoot, 'registrations', 'rule-gap-scenarios-v7.json');
const v8Path = path.join(evalRoot, 'registrations', 'rule-gap-scenarios-v8.json');
const v9Path = path.join(evalRoot, 'registrations', 'rule-gap-scenarios-v9.json');
const progressPath = path.resolve(
  evalRoot,
  '..',
  'docs',
  'kubernetes-scenario-implementation-progress.md'
);
const markerName = '.scenarios-goal-generated.json';

const container = (securityContext: Record<string, unknown>) => ({
  name: 'app',
  image: 'registry.k8s.io/pause:3.10',
  securityContext,
});

const deployment = (
  securityContext: Record<string, unknown>,
  podSpec: Record<string, unknown> = {}
) => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name: 'app', labels: { app: 'scenario-app' } },
  spec: {
    replicas: 1,
    selector: { matchLabels: { app: 'scenario-app' } },
    template: {
      metadata: { labels: { app: 'scenario-app' } },
      spec: { ...podSpec, containers: [container(securityContext)] },
    },
  },
});

const deploymentWith = (
  containerOverrides: Record<string, unknown>,
  podSpec: Record<string, unknown> = {},
  replicas = 1,
  name = 'app'
) => ({
  apiVersion: 'apps/v1',
  kind: 'Deployment',
  metadata: { name, labels: { app: name } },
  spec: {
    replicas,
    selector: { matchLabels: { app: name } },
    template: {
      metadata: { labels: { app: name } },
      spec: {
        ...podSpec,
        containers: [
          {
            name: 'app',
            image: 'registry.k8s.io/pause:3.10',
            securityContext: { runAsNonRoot: true, runAsUser: 1000 },
            ...containerOverrides,
          },
        ],
      },
    },
  },
});

const initialDefinitions: ScenarioDraftDefinition[] = [
  {
    scenarioId: 'rule-gap-writable-container-root-filesystem',
    title: 'Container root filesystem is writable',
    description:
      'A Deployment explicitly permits writes to the container root filesystem. Diagnose the isolation weakness from the workload specification.',
    taskPrompt:
      'Review the `app` Deployment container isolation settings and identify any material filesystem risk. Cite the exact field you inspect and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.security-context'],
    setup: [deployment({ readOnlyRootFilesystem: false, runAsNonRoot: true, runAsUser: 1000 })],
    acceptedFacts: [
      {
        fact_id: 'writable-root-filesystem',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem',
        observed_value: 'false',
        description: 'The application container explicitly permits a writable root filesystem.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-read-only-root-filesystem',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem',
        observed_value: 'true',
        description: 'The fixture does not enforce a read-only root filesystem.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-net-raw-capability',
    title: 'Container retains the NET_RAW capability',
    description:
      'A Deployment explicitly adds NET_RAW and does not drop it. Diagnose the effective Linux capability risk.',
    taskPrompt:
      'Review the `app` Deployment Linux capability configuration and identify any material privilege risk. Cite exact fields and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.security-context'],
    setup: [
      deployment({
        runAsNonRoot: true,
        runAsUser: 1000,
        capabilities: { add: ['NET_RAW'], drop: [] },
      }),
    ],
    acceptedFacts: [
      {
        fact_id: 'net-raw-added',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].securityContext.capabilities.add',
        observed_value: '["NET_RAW"]',
        description: 'The container explicitly adds NET_RAW.',
      },
      {
        fact_id: 'net-raw-not-dropped',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].securityContext.capabilities.drop',
        observed_value: '<absent>',
        description: 'The container does not drop NET_RAW or all capabilities.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-drop-all',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].securityContext.capabilities.drop',
        observed_value: '["ALL"]',
        description: 'The fixture does not drop all capabilities.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-host-network-namespace',
    title: 'Pod shares the host network namespace',
    description:
      'A Deployment requests the node network namespace. Diagnose the isolation boundary change from the Pod template.',
    taskPrompt:
      'Review the `app` Deployment network isolation settings and identify any material risk. Cite the exact field and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'pod.network-namespace'],
    setup: [
      deployment(
        { runAsNonRoot: true, runAsUser: 1000 },
        { hostNetwork: true, dnsPolicy: 'ClusterFirstWithHostNet' }
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'host-network-enabled',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.hostNetwork',
        observed_value: 'true',
        description: 'The Pod template joins the node network namespace.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-host-network-disabled',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.hostNetwork',
        observed_value: 'false',
        description: 'The fixture explicitly enables host networking.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-cluster-admin-rolebinding',
    title: 'RoleBinding grants cluster-admin',
    description:
      'A namespaced RoleBinding grants the built-in cluster-admin ClusterRole to an application ServiceAccount. Diagnose the excessive authorization grant.',
    taskPrompt:
      'Review the `app-admin` RoleBinding and explain any material authorization risk to the `app` ServiceAccount. Cite exact fields and do not mutate resources.',
    visibleResourceRefs: ['rolebinding/app-admin', 'serviceaccount/app'],
    observationKinds: ['rolebinding.role-ref', 'rolebinding.subjects'],
    setup: [
      { apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'app' } },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'RoleBinding',
        metadata: { name: 'app-admin' },
        subjects: [{ kind: 'ServiceAccount', name: 'app' }],
        roleRef: {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'ClusterRole',
          name: 'cluster-admin',
        },
      },
    ],
    acceptedFacts: [
      {
        fact_id: 'cluster-admin-reference',
        resource_ref: 'rolebinding/app-admin',
        field_path: 'roleRef.name',
        observed_value: 'cluster-admin',
        description: 'The RoleBinding references the built-in cluster-admin ClusterRole.',
      },
      {
        fact_id: 'application-subject',
        resource_ref: 'rolebinding/app-admin',
        field_path: 'subjects[0]',
        observed_value: '{"kind":"ServiceAccount","name":"app"}',
        description: 'The excessive grant applies to the application ServiceAccount.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-least-privilege-role',
        resource_ref: 'rolebinding/app-admin',
        field_path: 'roleRef.name',
        observed_value: 'app-reader',
        description:
          'The binding references cluster-admin, not a least-privilege application role.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-namespace-without-network-policy',
    title: 'Namespace workload has no selecting NetworkPolicy',
    description:
      'A workload runs in an otherwise empty namespace with no NetworkPolicy. Diagnose the missing network isolation boundary.',
    taskPrompt:
      'Review network isolation for the `app` Deployment and explain any material exposure. Cite the workload and namespace policy inventory; do not mutate resources.',
    visibleResourceRefs: ['deployment/app', 'networkpolicy/*'],
    observationKinds: ['deployment.pod-template', 'networkpolicy.list'],
    setup: [deployment({ runAsNonRoot: true, runAsUser: 1000 })],
    acceptedFacts: [
      {
        fact_id: 'workload-present',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.metadata.labels',
        observed_value: '{"app":"scenario-app"}',
        description: 'The namespace contains the application workload.',
      },
      {
        fact_id: 'network-policy-count',
        resource_ref: 'networkpolicy/*',
        field_path: 'items.length',
        observed_value: '0',
        description: 'The namespace contains no NetworkPolicy selecting the workload.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-default-deny',
        resource_ref: 'networkpolicy/default-deny',
        field_path: 'metadata.name',
        observed_value: 'default-deny',
        description: 'No default-deny NetworkPolicy exists in the fixture.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-dangling-network-policy-selector',
    title: 'NetworkPolicy selector matches no workload',
    description:
      'A NetworkPolicy selects app=api while the only workload is labeled app=web. Diagnose why the intended workload is not governed by the policy.',
    taskPrompt:
      'Review whether `web-policy` applies to the `web` Deployment. Cite the exact selectors and labels you retrieve; do not mutate resources.',
    visibleResourceRefs: ['networkpolicy/web-policy', 'deployment/web'],
    observationKinds: ['networkpolicy.pod-selector', 'deployment.pod-template-labels'],
    setup: [
      {
        ...deployment({ runAsNonRoot: true, runAsUser: 1000 }),
        metadata: { name: 'web', labels: { app: 'web' } },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'web' } },
          template: {
            metadata: { labels: { app: 'web' } },
            spec: { containers: [container({ runAsNonRoot: true, runAsUser: 1000 })] },
          },
        },
      },
      {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'NetworkPolicy',
        metadata: { name: 'web-policy' },
        spec: {
          podSelector: { matchLabels: { app: 'api' } },
          policyTypes: ['Ingress', 'Egress'],
          ingress: [],
          egress: [],
        },
      },
    ],
    acceptedFacts: [
      {
        fact_id: 'policy-selector',
        resource_ref: 'networkpolicy/web-policy',
        field_path: 'spec.podSelector.matchLabels',
        observed_value: '{"app":"api"}',
        description: 'The NetworkPolicy selects app=api.',
      },
      {
        fact_id: 'workload-labels',
        resource_ref: 'deployment/web',
        field_path: 'spec.template.metadata.labels',
        observed_value: '{"app":"web"}',
        description: 'The only workload template is labeled app=web.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-policy-match',
        resource_ref: 'deployment/web',
        field_path: 'spec.template.metadata.labels',
        observed_value: '{"app":"api"}',
        description: 'The workload does not carry the policy selector label.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-missing-liveness-probe',
    title: 'Container missing a liveness probe',
    description:
      'A long-running application container defines readiness but no liveness probe. Diagnose the missing self-recovery signal.',
    taskPrompt:
      'Review the `app` Deployment health-check configuration and identify what protection is missing. Cite exact fields and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.probes'],
    setup: [
      deploymentWith({
        readinessProbe: { exec: { command: ['true'] }, periodSeconds: 10 },
      }),
    ],
    acceptedFacts: [
      {
        fact_id: 'liveness-probe-absent',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].livenessProbe',
        observed_value: '<absent>',
        description: 'The application container has no liveness probe.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-liveness-probe',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].livenessProbe',
        observed_value: '{"exec":{"command":["true"]}}',
        description: 'Only a readiness probe is configured.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-missing-readiness-probe',
    title: 'Container missing a readiness probe',
    description:
      'A traffic-serving application container defines liveness but no readiness probe. Diagnose the missing traffic-admission signal.',
    taskPrompt:
      'Review the `app` Deployment health-check configuration and identify what traffic-safety signal is missing. Cite exact fields and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.probes'],
    setup: [
      deploymentWith({
        livenessProbe: { exec: { command: ['true'] }, periodSeconds: 10 },
      }),
    ],
    acceptedFacts: [
      {
        fact_id: 'readiness-probe-absent',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].readinessProbe',
        observed_value: '<absent>',
        description: 'The application container has no readiness probe.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-readiness-probe',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].readinessProbe',
        observed_value: '{"exec":{"command":["true"]}}',
        description: 'Only a liveness probe is configured.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-cpu-requirements-missing',
    title: 'Container CPU request and limit are missing',
    description:
      'A container declares a memory budget but omits both CPU request and CPU limit. Diagnose the missing CPU resource contract.',
    taskPrompt:
      'Review resource configuration for the `app` Deployment and identify the missing scheduling or isolation values. Cite exact fields and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.resources'],
    setup: [
      deploymentWith({ resources: { requests: { memory: '64Mi' }, limits: { memory: '128Mi' } } }),
    ],
    acceptedFacts: [
      {
        fact_id: 'cpu-request-absent',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].resources.requests.cpu',
        observed_value: '<absent>',
        description: 'The container has no CPU request.',
      },
      {
        fact_id: 'cpu-limit-absent',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].resources.limits.cpu',
        observed_value: '<absent>',
        description: 'The container has no CPU limit.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-cpu-request',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].resources.requests.cpu',
        observed_value: '100m',
        description: 'No CPU request exists in the fixture.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-memory-requirements-missing',
    title: 'Container memory request and limit are missing',
    description:
      'A container declares a CPU budget but omits both memory request and memory limit. Diagnose the missing memory resource contract.',
    taskPrompt:
      'Review resource configuration for the `app` Deployment and identify the missing scheduling or isolation values. Cite exact fields and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.resources'],
    setup: [deploymentWith({ resources: { requests: { cpu: '100m' }, limits: { cpu: '500m' } } })],
    acceptedFacts: [
      {
        fact_id: 'memory-request-absent',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].resources.requests.memory',
        observed_value: '<absent>',
        description: 'The container has no memory request.',
      },
      {
        fact_id: 'memory-limit-absent',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].resources.limits.memory',
        observed_value: '<absent>',
        description: 'The container has no memory limit.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-memory-request',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].resources.requests.memory',
        observed_value: '64Mi',
        description: 'No memory request exists in the fixture.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-latest-image-tag',
    title: 'Mutable latest image tag is used',
    description:
      'A Deployment uses an image tagged latest. Diagnose the mutable image-version risk from the Pod template.',
    taskPrompt:
      'Review the `app` Deployment image reference and identify any reproducibility risk. Cite the exact image value and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.image'],
    setup: [deploymentWith({ image: 'nginx:latest' })],
    acceptedFacts: [
      {
        fact_id: 'latest-image-tag',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].image',
        observed_value: 'nginx:latest',
        description: 'The image uses the mutable latest tag.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-image-digest',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].image',
        observed_value: 'nginx@sha256:fixture',
        description: 'The image is not digest pinned.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-image-not-pinned',
    title: 'Container image is not pinned to a digest',
    description:
      'A Deployment uses a non-latest version tag without an immutable digest. Diagnose the remaining supply-chain reproducibility risk.',
    taskPrompt:
      'Review the `app` Deployment image reference for immutability. Cite the exact image value and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.image'],
    setup: [deploymentWith({ image: 'nginx:1.27' })],
    acceptedFacts: [
      {
        fact_id: 'image-digest-absent',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].image',
        observed_value: 'nginx:1.27',
        description: 'The image uses a tag and contains no sha256 digest.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-latest-tag',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].image',
        observed_value: 'nginx:latest',
        description: 'The image is tagged 1.27, not latest.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-insufficient-replicas',
    title: 'Deployment has too few replicas',
    description:
      'A Deployment without an autoscaler declares one replica. Diagnose the avoidable single-replica availability risk.',
    taskPrompt:
      'Review availability configuration for the `app` Deployment and explain any replica-level risk. Cite exact fields and do not mutate resources.',
    visibleResourceRefs: ['deployment/app', 'horizontalpodautoscaler/*'],
    observationKinds: ['deployment.replicas', 'horizontalpodautoscaler.list'],
    setup: [deploymentWith({}, {}, 1)],
    acceptedFacts: [
      {
        fact_id: 'single-replica',
        resource_ref: 'deployment/app',
        field_path: 'spec.replicas',
        observed_value: '1',
        description: 'The Deployment declares only one replica.',
      },
      {
        fact_id: 'hpa-count',
        resource_ref: 'horizontalpodautoscaler/*',
        field_path: 'items.length',
        observed_value: '0',
        description: 'No HPA supplies a higher minimum replica count.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-three-replicas',
        resource_ref: 'deployment/app',
        field_path: 'spec.replicas',
        observed_value: '3',
        description: 'The fixture declares one replica.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-dangling-ingress-backend',
    title: 'Ingress backend Service is missing',
    description:
      'An Ingress routes to a Service name that does not exist in the namespace. Diagnose the broken backend reference.',
    taskPrompt:
      'Investigate why the `web` Ingress backend cannot route. Cite the exact backend reference and Service inventory; do not mutate resources.',
    visibleResourceRefs: ['ingress/web', 'service/*'],
    observationKinds: ['ingress.backends', 'service.list'],
    setup: [
      {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: { name: 'web' },
        spec: {
          rules: [
            {
              host: 'web.example.invalid',
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
    acceptedFacts: [
      {
        fact_id: 'ingress-service-reference',
        resource_ref: 'ingress/web',
        field_path: 'spec.rules[0].http.paths[0].backend.service.name',
        observed_value: 'missing-web',
        description: 'The Ingress backend names missing-web.',
      },
      {
        fact_id: 'service-count',
        resource_ref: 'service/*',
        field_path: 'items[metadata.name=missing-web].length',
        observed_value: '0',
        description: 'No Service named missing-web exists in the namespace.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-service',
        resource_ref: 'service/missing-web',
        field_path: 'metadata.name',
        observed_value: 'missing-web',
        description: 'The referenced Service does not exist.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-missing-service-account',
    title: 'Pod references a missing ServiceAccount',
    description:
      'A Deployment names a ServiceAccount that does not exist in its namespace. Diagnose the broken identity reference.',
    taskPrompt:
      'Investigate the identity configuration for the `app` Deployment. Cite the exact ServiceAccount reference and namespace inventory; do not mutate resources.',
    visibleResourceRefs: ['deployment/app', 'serviceaccount/*'],
    observationKinds: ['deployment.pod-template', 'serviceaccount.list'],
    setup: [deploymentWith({}, { serviceAccountName: 'missing-app' })],
    acceptedFacts: [
      {
        fact_id: 'service-account-reference',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.serviceAccountName',
        observed_value: 'missing-app',
        description: 'The Pod template names missing-app as its ServiceAccount.',
      },
      {
        fact_id: 'service-account-count',
        resource_ref: 'serviceaccount/*',
        field_path: 'items[metadata.name=missing-app].length',
        observed_value: '0',
        description: 'No ServiceAccount named missing-app exists in the namespace.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-service-account',
        resource_ref: 'serviceaccount/missing-app',
        field_path: 'metadata.name',
        observed_value: 'missing-app',
        description: 'The referenced ServiceAccount does not exist.',
      },
    ],
  },
  {
    scenarioId: 'rule-gap-duplicate-environment-variable',
    title: 'Container declares a duplicate environment variable',
    description:
      'A container declares the same environment variable twice with different values. Diagnose the ambiguous configuration.',
    taskPrompt:
      'Review the `app` Deployment environment configuration and identify any ambiguity. Cite exact entries and do not mutate resources.',
    visibleResourceRefs: ['deployment/app'],
    observationKinds: ['deployment.pod-template', 'container.environment'],
    setup: [
      deploymentWith({
        env: [
          { name: 'LOG_LEVEL', value: 'info' },
          { name: 'LOG_LEVEL', value: 'debug' },
        ],
      }),
    ],
    acceptedFacts: [
      {
        fact_id: 'duplicate-environment-name',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].env',
        observed_value:
          '[{"name":"LOG_LEVEL","value":"info"},{"name":"LOG_LEVEL","value":"debug"}]',
        description: 'LOG_LEVEL appears twice with conflicting values.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-unique-environment',
        resource_ref: 'deployment/app',
        field_path: 'spec.template.spec.containers[0].env',
        observed_value: '[{"name":"LOG_LEVEL","value":"info"}]',
        description: 'The fixture contains two LOG_LEVEL entries.',
      },
    ],
  },
];

const definitions: ScenarioDraftDefinition[] = [
  ...initialDefinitions,
  ...manifestScenarioDraftDefinitions,
  ...telemetryScenarioDraftDefinitions,
  ...runtimeScenarioDraftDefinitions,
  ...advancedScenarioDraftDefinitions,
  ...remainingScenarioDraftDefinitions,
  ...v3ScenarioDraftDefinitions,
  ...v4ScenarioDraftDefinitions,
  ...v5ScenarioDraftDefinitions,
  ...v6ScenarioDraftDefinitions,
  ...v7ScenarioDraftDefinitions,
  ...v8ScenarioDraftDefinitions,
  ...v9ScenarioDraftDefinitions,
];

const catalogs = [
  {
    path: 'registrations/rule-gap-scenarios-v1.json',
    scenarios: (JSON.parse(readFileSync(v1Path, 'utf8')) as { scenarios: GapScenario[] }).scenarios,
  },
  {
    path: 'registrations/rule-gap-scenarios-v2.json',
    scenarios: (JSON.parse(readFileSync(v2Path, 'utf8')) as { scenarios: GapScenario[] }).scenarios,
  },
  {
    path: 'registrations/rule-gap-scenarios-v3.json',
    scenarios: (JSON.parse(readFileSync(v3Path, 'utf8')) as { scenarios: GapScenario[] }).scenarios,
  },
  {
    path: 'registrations/rule-gap-scenarios-v4.json',
    scenarios: (JSON.parse(readFileSync(v4Path, 'utf8')) as { scenarios: GapScenario[] }).scenarios,
  },
  {
    path: 'registrations/rule-gap-scenarios-v5.json',
    scenarios: (JSON.parse(readFileSync(v5Path, 'utf8')) as { scenarios: GapScenario[] }).scenarios,
  },
  {
    path: 'registrations/rule-gap-scenarios-v6.json',
    scenarios: (JSON.parse(readFileSync(v6Path, 'utf8')) as { scenarios: GapScenario[] }).scenarios,
  },
  {
    path: 'registrations/rule-gap-scenarios-v7.json',
    scenarios: (JSON.parse(readFileSync(v7Path, 'utf8')) as { scenarios: GapScenario[] }).scenarios,
  },
  {
    path: 'registrations/rule-gap-scenarios-v8.json',
    scenarios: (JSON.parse(readFileSync(v8Path, 'utf8')) as { scenarios: GapScenario[] }).scenarios,
  },
  {
    path: 'registrations/rule-gap-scenarios-v9.json',
    scenarios: (JSON.parse(readFileSync(v9Path, 'utf8')) as { scenarios: GapScenario[] }).scenarios,
  },
];
const gapById = new Map(
  catalogs.flatMap(catalog =>
    catalog.scenarios.map(scenario => [scenario.scenario_id, { ...scenario, catalog }] as const)
  )
);
assert.equal(definitions.length, 980);
assert.equal(new Set(definitions.map(definition => definition.scenarioId)).size, 980);

mkdirSync(draftRoot, { recursive: true });
for (const entry of readdirSync(draftRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const directory = path.join(draftRoot, entry.name);
  if (existsSync(path.join(directory, markerName))) rmSync(directory, { recursive: true });
}

const prettierConfig = (await prettier.resolveConfig(v2Path)) ?? {};
const formatJson = (value: unknown): string =>
  prettier.format(JSON.stringify(value), { ...prettierConfig, parser: 'json' });

for (const definition of definitions) {
  const gap = gapById.get(definition.scenarioId);
  assert.ok(gap, `missing gap scenario ${definition.scenarioId}`);
  const directory = path.join(draftRoot, definition.scenarioId);
  mkdirSync(directory, { recursive: true });

  const manifest = {
    schema_version: '1.0.0',
    scenario_id: definition.scenarioId,
    scenario_version: '0.1.0',
    family: 'rule-gap-policy',
    mode: 'diagnose_only',
    title: definition.title,
    description: definition.description,
    provenance: {
      owner: 'scenarios-goal-agents',
      source: 'reference-implementation',
      license: 'Apache-2.0',
      admission_date: '2026-09-20',
      last_review: '2026-09-20',
      review_due: '2026-12-19',
      lifecycle_state: 'draft',
    },
    portfolio: {
      phase: 2,
      visibility: 'public',
      behavioral_stratum: 'fault_diagnosis',
      family_id: 'rule-gap-policy',
      lineage_id: definition.scenarioId,
      variant_kind: 'anchor',
      splits: ['capability'],
      qualification_status: 'pending',
      qualification_controls: {
        provenance: 'passed',
        rights: 'passed',
        family_lineage: 'passed',
        mechanism_oracle: 'pending',
        candidate_view: 'pending',
        setup: 'pending',
        observation_capture: 'pending',
        cleanup: 'pending',
        leakage: 'pending',
      },
      reviewed_by: [],
    },
    supported_cluster_profiles: definition.supportedClusterProfiles ?? [
      'local-kwok',
      'local-minikube',
      'aks',
    ],
    required_mechanisms: definition.requiredMechanisms ?? ['api-server'],
    declared_kwok_compatible: (definition.requiredMechanisms ?? ['api-server']).every(mechanism =>
      ['api-server', 'endpointslice-controller'].includes(mechanism)
    ),
    setup_manifest_path: 'setup.yaml',
    namespace_prefix: `eval-${createHash('sha256')
      .update(definition.scenarioId)
      .digest('hex')
      .slice(0, 12)}`,
    artifact_policy: { retain_raw_tool_output: true },
  } satisfies ScenarioManifest;

  const candidate = {
    schema_version: '1.0.0',
    scenario_id: definition.scenarioId,
    scenario_version: '0.1.0',
    task_prompt: definition.taskPrompt,
    visible_resource_refs: definition.visibleResourceRefs,
    allowed_observation_kinds: definition.observationKinds,
    allow_additional_retrieval: true,
    allow_mutations: false,
    required_submission_schema: 'diagnosis_submission@1.0.0',
  } satisfies CandidatePacket;

  const evaluator = {
    schema_version: '1.0.0',
    scenario_id: definition.scenarioId,
    scenario_version: '0.1.0',
    accepted_fact_sets: [definition.acceptedFacts],
    accepted_actions: [
      { action_id: 'no-op', description: 'Read-only diagnosis only.', operation: 'no_action' },
    ],
    contradiction_facts: definition.contradictionFacts,
    expects_uncertainty: false,
    secret_canary: `EVAL-CANARY-RULE-GAP-${createHash('sha256')
      .update(definition.scenarioId)
      .digest('hex')
      .slice(0, 16)}`,
  } satisfies EvaluatorPacket;

  const coverage = {
    schema_version: '1.0.0',
    source_catalog: gap.catalog.path,
    scenario_id: definition.scenarioId,
    implementation_status: 'authored',
    qualification_status: 'pending',
    detection_validation: 'normalized_predicate',
    external_tool_execution: false,
    target_rule_ids: gap.target_rule_ids,
    target_semantic_group_ids: gap.target_semantic_group_ids,
    ...(gap.target_canonical_capability_ids
      ? { target_canonical_capability_ids: gap.target_canonical_capability_ids }
      : {}),
    target_tool_ids: gap.target_tool_ids,
    target_rule_count: gap.target_rule_count,
    provenance_refs: gap.provenance_refs,
  };

  writeFileSync(path.join(directory, 'scenario.yaml'), yaml.dump(manifest, { lineWidth: 100 }));
  writeFileSync(path.join(directory, 'candidate-packet.json'), formatJson(candidate));
  writeFileSync(path.join(directory, 'evaluator-packet.json'), formatJson(evaluator));
  writeFileSync(
    path.join(directory, 'setup.yaml'),
    `${definition.setup
      .map(resource => yaml.dump(resource, { lineWidth: 100 }).trim())
      .join('\n---\n')}\n`
  );
  writeFileSync(path.join(directory, 'coverage.json'), formatJson(coverage));
  writeFileSync(
    path.join(directory, markerName),
    formatJson({ schema_version: '1.0.0', generator: 'generateScenarioDraftBundles.ts' })
  );
}

const selectedGaps = definitions.map(definition => gapById.get(definition.scenarioId)!);
const targetRuleIds = selectedGaps.flatMap(scenario => scenario.target_rule_ids);
const targetGroupIds = new Set(
  selectedGaps.flatMap(scenario => scenario.target_semantic_group_ids)
);
const targetToolIds = new Set(selectedGaps.flatMap(scenario => scenario.target_tool_ids));
const coverageByTool = Object.fromEntries(
  [...targetToolIds]
    .sort()
    .map(toolId => [toolId, targetRuleIds.filter(ruleId => ruleId.startsWith(`${toolId}:`)).length])
);
const coverageByCatalog = Object.fromEntries(
  catalogs.map(catalog => {
    const selected = selectedGaps.filter(scenario => scenario.catalog.path === catalog.path);
    return [
      catalog.path,
      {
        scenarios: selected.length,
        rules: selected.reduce((total, scenario) => total + scenario.target_rule_count, 0),
        groups: new Set(selected.flatMap(scenario => scenario.target_semantic_group_ids)).size,
        catalogRules: catalog.scenarios.reduce(
          (total, scenario) => total + scenario.target_rule_count,
          0
        ),
        catalogGroups: new Set(
          catalog.scenarios.flatMap(scenario => scenario.target_semantic_group_ids)
        ).size,
      },
    ];
  })
);
assert.equal(new Set(targetRuleIds).size, targetRuleIds.length);

const progress = [
  '# Scenarios Goal implementation progress',
  '',
  'Status: agent-authored, qualification pending, 2026-09-20',
  '',
  `The implementation batches contain ${definitions.length} complete draft bundles under`,
  '`evals/scenario-drafts/`. Each bundle has a scenario manifest, candidate packet,',
  'evaluator packet, setup manifest, and exact coverage metadata. The separate draft',
  'root keeps the active qualified roster fixed at 275.',
  'Surveyed tools are not installed or executed; their rule IDs provide source provenance',
  'for normalized predicates evaluated from the generated Kubernetes evidence.',
  '',
  '## Coverage added',
  '',
  `- Rule occurrences authored: ${targetRuleIds.length}`,
  `- Tool-local semantic groups authored: ${targetGroupIds.size}`,
  `- Tools represented: ${targetToolIds.size}`,
  '- Qualified scenarios added: 0',
  '',
  '| Source catalogue | Authored scenarios | Rules | Rule progress | Groups | Group progress |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...Object.entries(coverageByCatalog).map(
    ([catalog, coverage]) =>
      `| ${catalog} | ${coverage.scenarios} | ${coverage.rules} | ${(
        (coverage.rules / coverage.catalogRules) *
        100
      ).toFixed(1)}% | ${coverage.groups} | ${(
        (coverage.groups / coverage.catalogGroups) *
        100
      ).toFixed(1)}% |`
  ),
  '',
  '| Tool | Authored rule occurrences |',
  '| --- | ---: |',
  ...Object.entries(coverageByTool).map(([toolId, count]) => `| ${toolId} | ${count} |`),
  '',
  '| Scenario | Rules | Groups | Tools | Exact coverage |',
  '| --- | ---: | ---: | ---: | --- |',
  ...selectedGaps.map(
    scenario =>
      `| ${scenario.scenario_id} | ${scenario.target_rule_count} | ${scenario.target_semantic_group_ids.length} | ${scenario.target_tool_ids.length} | [rules](../evals/scenario-drafts/${scenario.scenario_id}/coverage.json) |`
  ),
  '',
  '## Next qualification steps',
  '',
  '1. Generate generic Kubernetes API observation logic for the declared field paths.',
  '2. Run setup and healthy-control manifests on KWOK, minikube, and AKS as declared.',
  '3. Capture evidence and run the evaluator oracle without exposing target rule names.',
  '4. Promote each scenario only after all admission controls pass.',
  '',
  `Governing objective: **${SCENARIOS_GOAL.name}**.`,
  '',
].join('\n');
const markdownConfig = (await prettier.resolveConfig(progressPath)) ?? {};
writeFileSync(progressPath, prettier.format(progress, { ...markdownConfig, parser: 'markdown' }));

console.log(
  `Wrote ${definitions.length} draft bundles targeting ${targetRuleIds.length} occurrences in ${targetGroupIds.size} groups across ${targetToolIds.size} tools.`
);
