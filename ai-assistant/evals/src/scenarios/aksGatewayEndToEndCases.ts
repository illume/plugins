import assert from 'node:assert/strict';
import { chartInput, installChart, available, controllerLogs } from './aksChartCaseSupport.js';
import { metadata, namespaced, probePod, readyPod, requiredParameter, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';

export function validateGateway(parameters: Record<string, string>) {
  chartInput(parameters, 'affectedGateway'); chartInput(parameters, 'recoveryGateway');
  requiredParameter(parameters, 'controllerDeployment', /^[a-z0-9][a-z0-9-]+$/);
}

export async function gatewayEnvironment(context: AksCaseContext, initial = 'affectedGateway') {
  assert.ok(context.subnetId);
  const vnetId = context.subnetId.slice(0, context.subnetId.lastIndexOf('/subnets/'));
  const vnetName = vnetId.split('/').at(-1)!;
  context.az(['network', 'vnet', 'subnet', 'create', '--resource-group', context.resourceGroup, '--vnet-name', vnetName,
    '--name', 'gateway', '--address-prefixes', '10.90.8.0/24', '--delegations', 'Microsoft.ServiceNetworking/trafficControllers']);
  const subnetId = `${vnetId}/subnets/gateway`;
  const identity = context.az(['identity', 'create', '--resource-group', context.resourceGroup, '--name', 'alb-controller', '--location', context.location,
    '--tags', `headlamp-e2e-owner=${context.owner}`]);
  const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
  assert.ok(cluster.oidcIssuerProfile?.issuerUrl);
  context.az(['identity', 'federated-credential', 'create', '--resource-group', context.resourceGroup, '--identity-name', 'alb-controller', '--name', 'controller',
    '--issuer', cluster.oidcIssuerProfile.issuerUrl, '--subject', 'system:serviceaccount:azure-alb-system:alb-controller-sa', '--audiences', 'api://AzureADTokenExchange']);
  const scope = `/subscriptions/${context.subscription}/resourceGroups/${context.resourceGroup}`;
  for (const role of ['AppGw for Containers Configuration Manager', 'Reader']) context.az(['role', 'assignment', 'create', '--assignee-object-id', identity.principalId, '--assignee-principal-type', 'ServicePrincipal', '--role', role, '--scope', scope]);
  context.az(['role', 'assignment', 'create', '--assignee-object-id', identity.principalId, '--assignee-principal-type', 'ServicePrincipal', '--role', 'Network Contributor', '--scope', subnetId]);
  const alb = context.az(['network', 'alb', 'create', '--resource-group', context.resourceGroup, '--name', 'gateway', '--location', context.location, '--tags', `headlamp-e2e-owner=${context.owner}`]);
  const association = context.az(['network', 'alb', 'association', 'create', '--resource-group', context.resourceGroup, '--alb-name', 'gateway', '--name', 'association', '--subnet', subnetId]);
  context.az(['network', 'alb', 'frontend', 'create', '--resource-group', context.resourceGroup, '--alb-name', 'gateway', '--name', 'frontend']);
  const values = { albController: { podIdentity: { clientID: identity.clientId } } };
  const install = async (prefix: string) => {
    installChart(context, 'alb', prefix, 'azure-alb-system', values);
    return available(context, 'azure-alb-system', context.parameters.controllerDeployment!);
  };
  await install(initial);
  context.create('gateway', { apiVersion: 'gateway.networking.k8s.io/v1', kind: 'Gateway', metadata: {
    ...metadata(context, 'gateway'), annotations: { 'alb.networking.azure.io/alb-id': alb.id, 'alb.networking.azure.io/alb-frontend': 'frontend' } },
    spec: { gatewayClassName: 'azure-alb-external', listeners: [{ name: 'http', protocol: 'HTTP', port: 80, allowedRoutes: { namespaces: { from: 'Same' } } }] } });
  const backend: any = probePod(context, 'backend'); backend.metadata.labels.app = 'backend';
  backend.spec.containers[0].command = ['sh', '-c', 'mkdir -p /tmp/www; printf "owned-gateway\\n" >/tmp/www/healthz; exec httpd -f -p 8080 -h /tmp/www'];
  backend.spec.containers[0].readinessProbe = { httpGet: { path: '/healthz', port: 8080 } };
  context.create('backend', backend); await readyPod(context, 'backend');
  context.create('backend-service', { apiVersion: 'v1', kind: 'Service', metadata: metadata(context, 'backend'), spec: { selector: { app: 'backend' }, ports: [{ name: 'http', port: 80, targetPort: 8080 }] } });
  context.create('client', probePod(context, 'client')); await readyPod(context, 'client');
  const route = (hosts: string[]) => ({ apiVersion: 'gateway.networking.k8s.io/v1', kind: 'HTTPRoute', metadata: metadata(context, 'route'),
    spec: { parentRefs: [{ name: 'gateway' }], hostnames: hosts, rules: [{ backendRefs: [{ name: 'backend', port: 80 }] }] } });
  context.create('route', route(['one.research.example', 'two.research.example']));
  let address = '';
  await context.poll(() => { const gateway = context.read('gateway', 'gateway'); address = gateway.status?.addresses?.[0]?.value ?? '';
    return !!address && gateway.status?.conditions?.some((condition: any) => condition.type === 'Programmed' && condition.status === 'True'); }, 'AGC programmed address');
  assert.match(address, /^[a-zA-Z0-9.-]+$/);
  const request = (host: string, target = '/healthz') => context.kube(namespaced(context, ['exec', 'client', '--', 'wget', '-q', '-T', '5', '--header', `Host: ${host}`, '-O', '-', `http://${address}${target}`]));
  const healthPolicy = { apiVersion: 'alb.networking.azure.io/v1', kind: 'HealthCheckPolicy', metadata: metadata(context, 'health'), spec: {
    targetRef: { group: '', kind: 'Service', name: 'backend' }, default: { interval: '5s', timeout: '3s', healthyThreshold: 1, unhealthyThreshold: 2,
      http: { path: '/healthz', match: { statusCodes: [{ start: 200, end: 200 }] } } } } };
  return { alb, association, subnetId, install, values, address, request, route, healthPolicy,
    works: async (host = 'one.research.example') => { await context.poll(() => { const result = request(host); return result.status === 0 && result.stdout.trim() === 'owned-gateway'; }, 'Gateway healthy response'); return request(host); },
  };
}

const restartAssociation: AksEndToEndCase = {
  customNetwork: true, enableOidc: true, validate: validateGateway,
  async run(context) {
    const environment = await gatewayEnvironment(context); context.create('health-policy', environment.healthPolicy);
    await context.phase('baseline', async () => ({ request: await environment.works(), association: environment.association }));
    await context.phase('fault', async () => {
      context.run(['-n', 'azure-alb-system', 'rollout', 'restart', `deployment/${context.parameters.controllerDeployment}`]); let captured: unknown;
      await context.poll(() => {
        const logs = controllerLogs(context, 'azure-alb-system', context.parameters.controllerDeployment!);
        const request = environment.request('one.research.example');
        const association = context.az(['network', 'alb', 'association', 'show', '--resource-group', context.resourceGroup, '--alb-name', 'gateway', '--name', 'association']);
        captured = { logs, request, association }; context.save('association-restart', captured);
        return /insufficient.*(?:subnet|address)|subnet.*(?:insufficient|exhaust)/i.test(logs.stdout + logs.stderr) && request.status !== 0;
      }, 'Restart association address-capacity failure'); return captured;
    });
    await context.phase('recovery', async () => { await environment.install('recoveryGateway'); return { request: await environment.works(), association: context.az(['network', 'alb', 'association', 'show', '--resource-group', context.resourceGroup, '--alb-name', 'gateway', '--name', 'association']) }; });
  },
};

const rootProbe: AksEndToEndCase = {
  customNetwork: true, enableOidc: true, validate: validateGateway,
  async run(context) {
    const environment = await gatewayEnvironment(context);
    await context.phase('baseline', async () => { context.create('healthy-probe-policy', environment.healthPolicy); return environment.works(); });
    await context.phase('fault', async () => {
      context.run(namespaced(context, ['delete', 'healthcheckpolicy', 'health']));
      await context.poll(() => environment.request('one.research.example').status !== 0, 'Default root health probe loses backend');
      const backend = await readyPod(context, 'backend');
      const direct = context.kube(namespaced(context, ['exec', 'client', '--', 'wget', '-q', '-T', '5', '-O', '-', `http://${backend.status.podIP}:8080/healthz`]));
      assert.equal(direct.status, 0);
      const root = context.kube(namespaced(context, ['exec', 'client', '--', 'wget', '-q', '-T', '5', '-O', '-', `http://${backend.status.podIP}:8080/`]));
      assert.notEqual(root.status, 0);
      return { backend, direct, root, gateway: environment.request('one.research.example'), scope: 'Root-path non-success versus explicit healthy probe; HTTP status must be retained for source fidelity' };
    });
    await context.phase('recovery', async () => { context.create('recovered-health-policy', environment.healthPolicy); return environment.works(); });
  },
};

const wildcardHost: AksEndToEndCase = {
  customNetwork: true, enableOidc: true, validate: validateGateway,
  async run(context) {
    const environment = await gatewayEnvironment(context); context.create('health-policy', environment.healthPolicy);
    await context.phase('baseline', async () => ({ first: await environment.works(), second: await environment.works('two.research.example') }));
    await context.phase('fault', async () => {
      const current = context.read('httproute', 'route'); current.spec.hostnames = ['*.research.example']; context.replace('wildcard-route', current);
      await context.poll(() => environment.request('one.research.example').status !== 0 && environment.request('two.research.example').status !== 0, 'Wildcard requests fail');
      const actual = context.read('httproute', 'route');
      assert.deepEqual(actual.spec.hostnames, ['*.research.example']); return { route: actual, first: environment.request('one.research.example'), second: environment.request('two.research.example') };
    });
    await context.phase('recovery', async () => {
      const current = context.read('httproute', 'route'); current.spec.hostnames = ['one.research.example', 'two.research.example']; context.replace('explicit-host-route', current);
      const first = await environment.works(); const second = await environment.works('two.research.example');
      assert.notEqual(environment.request('unmatched.invalid').status, 0); return { first, second, unmatchedRejected: true };
    });
  },
};

export const aksGatewayEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c018-v1': restartAssociation,
  'aks-c066-v1': rootProbe,
  'aks-c068-v1': wildcardHost,
};