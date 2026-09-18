import assert from 'node:assert/strict';
import { chartInput } from './aksChartCaseSupport.js';
import { metadata, requiredParameter, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';

function extension(context: AksCaseContext, name: string, type: string, version: string, settings: string[] = []) {
  const operation = context.attemptAz(['k8s-extension', 'create', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters',
    '--name', name, '--extension-type', type, '--version', version, '--auto-upgrade-minor-version', 'false',
    ...(settings.length ? ['--configuration-settings', ...settings] : [])]);
  context.save(`${name}-${version}-install`, operation); return operation;
}

function removeExtension(context: AksCaseContext, name: string) {
  context.az(['k8s-extension', 'delete', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', name, '--yes']);
}

const fluxHome: AksEndToEndCase = {
  validate(parameters) {
    requiredParameter(parameters, 'affectedExtensionVersion', /^\d+\.\d+\.\d+$/);
    requiredParameter(parameters, 'controlExtensionVersion', /^\d+\.\d+\.\d+$/);
    requiredParameter(parameters, 'sourceChartOci', /^.+@sha256:[a-f0-9]{64}$/);
    requiredParameter(parameters, 'sourceChartName', /^[a-z0-9][a-z0-9-]*$/);
    requiredParameter(parameters, 'sourceChartVersion', /^\d+\.\d+\.\d+$/);
  },
  async run(context) {
    const registry = `flux${context.owner.replaceAll('-', '').slice(0, 20)}`;
    context.az(['acr', 'create', '--resource-group', context.resourceGroup, '--name', registry, '--location', context.location, '--sku', 'Basic', '--admin-enabled', 'false', '--tags', `headlamp-e2e-owner=${context.owner}`]);
    context.az(['acr', 'import', '--name', registry, '--source', context.parameters.sourceChartOci!, '--image', `charts/${context.parameters.sourceChartName}:${context.parameters.sourceChartVersion}`]);
    const acr = context.az(['acr', 'show', '--resource-group', context.resourceGroup, '--name', registry]);
    const install = (version: string, overrides: string[] = []) => {
      const result = extension(context, 'flux', 'microsoft.flux', version, overrides); assert.equal(result.status, 0);
      const actual = context.az(['k8s-extension', 'show', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', 'flux']);
      const principal = actual.identity?.principalId; assert.ok(principal, 'Managed extension identity required');
      context.az(['role', 'assignment', 'create', '--assignee-object-id', principal, '--assignee-principal-type', 'ServicePrincipal', '--role', 'AcrPull', '--scope', acr.id]);
      return actual;
    };
    const source = () => context.read('helmrepository', 'source');
    const chart = () => context.read('helmchart', 'chart');
    const ready = () => chart().status?.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'True');
    const reconcile = () => context.run(['-n', context.namespace, 'annotate', 'helmrepository/source', `reconcile.fluxcd.io/requestedAt=${Date.now()}`, '--overwrite']);
    await context.phase('baseline', async () => {
      const installed = install(context.parameters.controlExtensionVersion!);
      context.create('oci-source', { apiVersion: 'source.toolkit.fluxcd.io/v1beta2', kind: 'HelmRepository', metadata: metadata(context, 'source'),
        spec: { interval: '10s', type: 'oci', provider: 'azure', url: `oci://${acr.loginServer}/charts` } });
      context.create('oci-chart', { apiVersion: 'source.toolkit.fluxcd.io/v1beta2', kind: 'HelmChart', metadata: metadata(context, 'chart'),
        spec: { interval: '10s', chart: context.parameters.sourceChartName, version: context.parameters.sourceChartVersion, sourceRef: { kind: 'HelmRepository', name: 'source' } } });
      await context.poll(ready, 'Owned OCI chart fetched by control Flux'); return { installed, source: source(), chart: chart() };
    });
    await context.phase('fault', async () => {
      context.az(['k8s-extension', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', 'flux', '--version', context.parameters.affectedExtensionVersion!]);
      reconcile(); let logs: any;
      await context.poll(() => {
        logs = context.kube(['-n', 'flux-system', 'logs', 'deployment/source-controller', '--tail=100']);
        context.save('flux-oci-failure', { logs, source: source(), chart: chart() });
        return /\/dev\/null\/\.config\/helm\/registry\/config.json.*not a directory/i.test(logs.stdout + logs.stderr);
      }, 'Reported Flux HOME registry error'); return { logs, source: source(), chart: chart() };
    });
    await context.phase('recovery', async () => {
      context.az(['k8s-extension', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', 'flux',
        '--configuration-settings', 'source-controller.extraEnvVars[0].name=DOCKER_CONFIG', 'source-controller.extraEnvVars[0].value=/tmp/docker',
        'source-controller.extraEnvVars[1].name=HELM_CONFIG_HOME', 'source-controller.extraEnvVars[1].value=/tmp/helm']);
      reconcile(); await context.poll(ready, 'OCI source after supported writable config override'); return { source: source(), chart: chart() };
    });
  },
};

const automaticDapr: AksEndToEndCase = {
  automatic: true,
  validate(parameters) {
    requiredParameter(parameters, 'affectedExtensionVersion', /^\d+\.\d+\.\d+$/);
    requiredParameter(parameters, 'recoveryExtensionVersion', /^\d+\.\d+\.\d+$/);
  },
  async run(context) {
    const workloads = () => JSON.parse(context.run(['-n', 'dapr-system', 'get', 'deployments', '-o', 'json']));
    const ready = () => { const items = workloads().items; return items.length > 0 && items.every((item: any) => item.status?.availableReplicas >= (item.spec.replicas ?? 1)); };
    await context.phase('baseline', async () => {
      const result = extension(context, 'dapr', 'microsoft.dapr', context.parameters.recoveryExtensionVersion!); assert.equal(result.status, 0);
      await context.poll(ready, 'Supported Dapr extension on Automatic'); const evidence = workloads(); removeExtension(context, 'dapr'); return evidence;
    });
    await context.phase('fault', async () => {
      const result = extension(context, 'dapr', 'microsoft.dapr', context.parameters.affectedExtensionVersion!);
      const extensionState = context.az(['k8s-extension', 'show', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', 'dapr']);
      const events = context.kube(['-n', 'dapr-system', 'get', 'events', '-o', 'json']);
      const diagnostic = JSON.stringify(extensionState) + result.stderr + events.stdout;
      assert.match(diagnostic, /aks-managed-protect-system-namespaces/); assert.match(diagnostic, /serviceaccount|service.account/i); assert.match(diagnostic, /denied|forbidden/i);
      assert.ok(result.status !== 0 || extensionState.provisioningState !== 'Succeeded'); return { result, extensionState, events };
    });
    await context.phase('recovery', async () => {
      removeExtension(context, 'dapr'); const result = extension(context, 'dapr', 'microsoft.dapr', context.parameters.recoveryExtensionVersion!); assert.equal(result.status, 0);
      await context.poll(ready, 'Dapr initialization without disabling namespace protection'); return { result, deployments: workloads() };
    });
  },
};

export const aksExtensionEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c012-v1': fluxHome,
  'aks-c028-v1': automaticDapr,
};