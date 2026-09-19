import assert from 'node:assert/strict';
import { metadata, namespaced, probePod, readyPod, type AksEndToEndCase } from './aksEndToEndCases.js';

const loadBalancerProbe: AksEndToEndCase = {
  validate() {},
  async run(context) {
    let address = '';
    const tcpAnnotation = 'service.beta.kubernetes.io/port_80_health-probe_protocol';
    const pathAnnotation = 'service.beta.kubernetes.io/azure-load-balancer-health-probe-request-path';
    const service = () => context.read('service', 'backend');
    const probe = () => {
      const endpoint = service();
      const addresses = endpoint.status?.loadBalancer?.ingress ?? [];
      const currentAddress = addresses.find((item: any) => item.ip)?.ip;
      const inventory = context.az(['network', 'lb', 'list', '--resource-group', context.nodeResourceGroup]);
      const publicIps = context.az(['network', 'public-ip', 'list', '--resource-group', context.nodeResourceGroup]);
      const publicIp = publicIps.find((item: any) => item.ipAddress === currentAddress);
      if (!publicIp) return null;
      for (const balancer of inventory) {
        const frontend = balancer.frontendIPConfigurations?.find((item: any) => item.publicIPAddress?.id.toLowerCase() === publicIp.id.toLowerCase());
        if (!frontend) continue;
        const rule = balancer.loadBalancingRules?.find((item: any) => item.frontendIPConfiguration?.id === frontend.id && item.frontendPort === 80);
        const health = balancer.probes?.find((item: any) => item.id === rule?.probe?.id);
        if (health) return { endpoint, health, balancerId: balancer.id };
      }
      return null;
    };
    const request = (host: string, target: string) => context.kube(namespaced(context, [
      'exec', 'client', '--', 'wget', '-q', '-T', '5', '-O', '-', `http://${host}${target}`,
    ]));
    const reachable = async () => {
      let response: ReturnType<typeof request> | undefined;
      await context.poll(() => { response = request(address, '/healthz'); return response.status === 0 && response.stdout.trim() === 'owned-healthy'; }, 'Public load-balancer control');
      return response;
    };
    await context.phase('baseline', async () => {
      const backend: any = probePod(context, 'backend');
      backend.metadata.labels.app = 'backend';
      backend.spec.containers[0].command = ['sh', '-c', 'mkdir -p /tmp/www; printf "owned-healthy\\n" >/tmp/www/healthz; exec httpd -f -p 8080 -h /tmp/www'];
      backend.spec.containers[0].readinessProbe = { httpGet: { path: '/healthz', port: 8080 }, periodSeconds: 2 };
      context.create('backend-pod', backend); await readyPod(context, 'backend');
      context.create('client-pod', probePod(context, 'client')); await readyPod(context, 'client');
      const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
      const outbound = cluster.networkProfile?.loadBalancerProfile?.effectiveOutboundIPs ?? [];
      assert.ok(outbound.length > 0, 'Owned outbound public IP required');
      const allowed = outbound.map((item: any) => context.az(['network', 'public-ip', 'show', '--ids', item.id]).ipAddress);
      assert.ok(allowed.every((value: unknown) => typeof value === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(value)));
      context.create('backend-service', {
        apiVersion: 'v1', kind: 'Service', metadata: { ...metadata(context, 'backend'), annotations: { [tcpAnnotation]: 'tcp' } },
        spec: { type: 'LoadBalancer', externalTrafficPolicy: 'Cluster', loadBalancerSourceRanges: allowed.map((value: string) => `${value}/32`),
          selector: { app: 'backend' }, ports: [{ port: 80, targetPort: 8080, protocol: 'TCP', appProtocol: 'http' }] },
      });
      await context.poll(() => { const observed = probe(); address = observed?.endpoint.status.loadBalancer.ingress.find((item: any) => item.ip)?.ip ?? ''; return observed?.health.protocol?.toLowerCase() === 'tcp' && !!address; }, 'Explicit TCP health probe');
      const external = await reachable();
      const backendIp = context.read('pod', 'backend').status.podIP;
      assert.equal(request(`${backendIp}:8080`, '/healthz').status, 0);
      assert.notEqual(request(`${backendIp}:8080`, '/').status, 0);
      return { probe: probe(), external, sourceRanges: allowed };
    });
    await context.phase('fault', async () => {
      const target = service(); delete target.metadata.annotations[tcpAnnotation];
      context.replace('http-default-service', target);
      await context.poll(() => { const current = probe(); context.save('default-http-probe', current); return current?.health.protocol?.toLowerCase() === 'http' && current.health.requestPath === '/'; }, 'Default HTTP root health probe');
      await context.poll(() => request(address, '/healthz').status !== 0, 'Failed public path with HTTP root probe');
      const failures = [];
      for (let attempt = 0; attempt < 3; attempt++) { const result = request(address, '/healthz'); assert.notEqual(result.status, 0); failures.push(result); }
      const backend = await readyPod(context, 'backend');
      assert.equal(request(`${backend.status.podIP}:8080`, '/healthz').status, 0);
      const endpoints = JSON.parse(context.run(namespaced(context, ['get', 'endpointslices', '-l', 'kubernetes.io/service-name=backend', '-o', 'json'])));
      assert.ok(endpoints.items.some((item: any) => item.endpoints.some((endpoint: any) => endpoint.conditions?.ready === true)));
      return { provider: probe(), backend, endpoints, failures };
    });
    await context.phase('recovery', async () => {
      const target = service(); target.metadata.annotations ??= {}; target.metadata.annotations[pathAnnotation] = '/healthz';
      context.replace('corrected-probe-service', target);
      await context.poll(() => { const current = probe(); return current?.health.protocol?.toLowerCase() === 'http' && current.health.requestPath === '/healthz'; }, 'Corrected HTTP health path');
      return { provider: probe(), external: await reachable() };
    });
  },
};

const staleRoleAssignment: AksEndToEndCase = {
  validate() {},
  async run(context) {
    const cluster = () => context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
    const scope = `/subscriptions/${context.subscription}/resourceGroups/${context.nodeResourceGroup}`;
    const roles = () => context.az(['role', 'assignment', 'list', '--scope', scope, '--all']);
    let oldPrincipal = '';
    let before: any[] = [];
    let replacement: any;
    await context.phase('baseline', async () => {
      const current = cluster(); oldPrincipal = current.identity?.principalId;
      assert.ok(typeof oldPrincipal === 'string' && oldPrincipal.length > 0, 'System-assigned cluster identity required');
      before = roles().filter((role: any) => role.principalId === oldPrincipal && role.scope.toLowerCase() === scope.toLowerCase());
      assert.ok(before.length > 0, 'No provider-created old-identity assignments to investigate');
      replacement = context.az(['identity', 'create', '--resource-group', context.resourceGroup, '--name', 'replacement', '--location', context.location,
        '--tags', `headlamp-e2e-owner=${context.owner}`]);
      return { principal: oldPrincipal, assignments: before, replacementId: replacement.id };
    });
    await context.phase('fault', async () => {
      context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'research', '--enable-managed-identity', '--assign-identity', replacement.id]);
      const updated = cluster();
      assert.ok(Object.keys(updated.identity?.userAssignedIdentities ?? {}).some(id => id.toLowerCase() === replacement.id.toLowerCase()));
      const retained = roles().filter((role: any) => role.principalId === oldPrincipal && before.some(original => original.id === role.id));
      assert.ok(retained.length > 0, 'No stale provider assignment remains; fault not reproduced');
      return { identity: updated.identity, retained };
    });
    await context.phase('recovery', async () => {
      for (const original of before) {
        assert.equal(original.scope.toLowerCase(), scope.toLowerCase());
        assert.ok(original.id.toLowerCase().startsWith(`${scope}/providers/microsoft.authorization/roleassignments/`.toLowerCase()));
        const present = roles().find((role: any) => role.id === original.id);
        if (present) { assert.equal(present.principalId, oldPrincipal); context.az(['role', 'assignment', 'delete', '--ids', original.id]); }
      }
      assert.ok(!roles().some((role: any) => role.principalId === oldPrincipal && role.scope.toLowerCase() === scope.toLowerCase()));
      const current = cluster(); assert.equal(current.provisioningState, 'Succeeded');
      const nodes = JSON.parse(context.run(['get', 'nodes', '-o', 'json']));
      assert.ok(nodes.items.length > 0 && nodes.items.every((node: any) => node.status.conditions.some((condition: any) => condition.type === 'Ready' && condition.status === 'True')));
      return { identity: current.identity, assignments: roles(), nodes, scope: 'Exact trial node-group role inventory; no claim about cached access tokens outside this scope' };
    });
  },
};

export const aksNetworkEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c038-v1': staleRoleAssignment,
  'aks-c067-v1': loadBalancerProbe,
};