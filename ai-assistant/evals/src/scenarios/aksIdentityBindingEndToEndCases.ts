import assert from 'node:assert/strict';
import { metadata, namespaced, probePod, readyPod, requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

const bindingPath: AksEndToEndCase = {
  enableOidc: true,
  validate(parameters) { requiredParameter(parameters, 'originalTokenPath', /^\/var\/run\/[a-zA-Z0-9/_-]+$/); },
  async run(context) {
    const identity = context.az(['identity', 'create', '--resource-group', context.resourceGroup, '--name', 'binding', '--location', context.location, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
    context.az(['identity', 'federated-credential', 'create', '--resource-group', context.resourceGroup, '--identity-name', 'binding', '--name', 'binding',
      '--issuer', cluster.oidcIssuerProfile.issuerUrl, '--subject', `system:serviceaccount:${context.namespace}:binding`, '--audiences', 'api://AzureADTokenExchange']);
    context.create('binding-account', { apiVersion: 'v1', kind: 'ServiceAccount', metadata: { ...metadata(context, 'binding'), annotations: { 'azure.workload.identity/client-id': identity.clientId } } });
    const create = (name: string) => {
      const pod: any = probePod(context, name); pod.metadata.labels['azure.workload.identity/use'] = 'true'; pod.spec.serviceAccountName = 'binding'; context.create(`${name}-pod`, pod);
    };
    const path = (name: string) => context.read('pod', name).spec.containers.find((container: any) => container.name === 'probe').env?.find((variable: any) => variable.name === 'AZURE_FEDERATED_TOKEN_FILE')?.value;
    const exists = (name: string, file: string) => context.kube(namespaced(context, ['exec', name, '--', 'test', '-s', file])).status === 0;
    await context.phase('baseline', async () => { create('control'); await readyPod(context, 'control'); assert.equal(path('control'), context.parameters.originalTokenPath); assert.ok(exists('control', path('control'))); return { pod: context.read('pod', 'control'), tokenContentsRead: false }; });
    await context.phase('fault', async () => {
      context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'research', '--enable-identity-binding']);
      create('subject'); await readyPod(context, 'subject'); const actual = path('subject');
      assert.ok(typeof actual === 'string' && actual.startsWith('/var/run/') && actual !== context.parameters.originalTokenPath);
      assert.equal(exists('subject', context.parameters.originalTokenPath!), false); assert.equal(exists('subject', actual), true);
      return { pod: context.read('pod', 'subject'), expectedPath: context.parameters.originalTokenPath, actualPath: actual, scope: 'Filesystem/metadata consumer failure, not an Azure token-exchange failure' };
    });
    await context.phase('recovery', async () => {
      const result = context.kube(namespaced(context, ['exec', 'subject', '--', 'sh', '-c', 'test -n "$AZURE_FEDERATED_TOKEN_FILE" && test -s "$AZURE_FEDERATED_TOKEN_FILE"']));
      assert.equal(result.status, 0); return { resolvedFromEnvironment: true, contentsLogged: false };
    });
  },
};

const argoIdentity: AksEndToEndCase = {
  enableOidc: true,
  validate(parameters) {
    for (const name of ['affectedArgoVersion', 'recoveryArgoVersion']) requiredParameter(parameters, name, /^\d+\.\d+\.\d+$/);
    requiredParameter(parameters, 'argoDeployment', /^[a-z0-9-]+$/);
    const config = JSON.parse(requiredParameter(parameters, 'argoConfiguration', /^\{.*\}$/s)); assert.ok(config && Object.values(config).every(value => typeof value === 'string'));
  },
  async run(context) {
    const identity = context.az(['identity', 'create', '--resource-group', context.resourceGroup, '--name', 'argo', '--location', context.location, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const settings = Object.entries(JSON.parse(context.parameters.argoConfiguration!)).map(([key, value]) => `${key}=${value}`);
    const install = (version: string) => context.az(['k8s-extension', 'create', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', 'argo',
      '--extension-type', 'Microsoft.ArgoCD', '--version', version, '--auto-upgrade-minor-version', 'false', '--configuration-settings', ...settings, `workloadIdentity.clientId=${identity.clientId}`]);
    const read = () => JSON.parse(context.run(['-n', 'argocd', 'get', 'deployment', context.parameters.argoDeployment!, '-o', 'json']));
    const pods = () => { const selector = Object.entries(read().spec.selector.matchLabels).map(([key, value]) => `${key}=${value}`).join(','); return JSON.parse(context.run(['-n', 'argocd', 'get', 'pods', '-l', selector, '-o', 'json'])); };
    const injected = (pod: any) => pod.spec.containers.some((container: any) => container.env?.some((variable: any) => variable.name === 'AZURE_CLIENT_ID' && variable.value === identity.clientId)) &&
      pod.spec.volumes?.some((volume: any) => volume.projected?.sources?.some((source: any) => source.serviceAccountToken?.audience === 'api://AzureADTokenExchange'));
    await context.phase('baseline', async () => {
      install(context.parameters.recoveryArgoVersion!); await context.poll(() => pods().items.some(injected), 'Control extension identity injection');
      const snapshot = { deployment: read(), pods: pods() };
      context.az(['k8s-extension', 'delete', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', 'argo', '--yes']); return snapshot;
    });
    await context.phase('fault', async () => {
      install(context.parameters.affectedArgoVersion!); let observation: unknown;
      await context.poll(() => {
        const actual = pods(); const logs = context.kube(['-n', 'argocd', 'logs', `deployment/${context.parameters.argoDeployment}`, '--all-containers=true', '--tail=100']);
        observation = { deployment: read(), pods: actual, logs }; context.save('argo-identity-failure', observation);
        return actual.items.length > 0 && actual.items.every((pod: any) => !injected(pod)) && /credential|identity|token/i.test(logs.stdout + logs.stderr) && /missing|not found|unavailable|failed/i.test(logs.stdout + logs.stderr);
      }, 'Managed extension identity injection failure'); return observation;
    });
    await context.phase('recovery', async () => {
      context.az(['k8s-extension', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', 'argo', '--version', context.parameters.recoveryArgoVersion!]);
      await context.poll(() => pods().items.some(injected), 'Restored managed extension identity metadata'); return { pods: pods(), limitation: 'Injection and controller error mechanism; cloud repository authorization requires a separate scored control' };
    });
  },
};

export const aksIdentityBindingEndToEndCases: Record<string, AksEndToEndCase> = { 'aks-c031-v1': argoIdentity, 'aks-c032-v1': bindingPath };