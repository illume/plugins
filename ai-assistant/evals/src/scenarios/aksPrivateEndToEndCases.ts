import assert from 'node:assert/strict';
import { requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

const privateDnsPermissions: AksEndToEndCase = {
  validate(parameters) { requiredParameter(parameters, 'networkProbeImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/); },
  async run(context) {
    const vnet = (name: string) => `/subscriptions/${context.subscription}/resourceGroups/${context.resourceGroup}/providers/Microsoft.Network/virtualNetworks/${name}`;
    for (const [name, prefix, subnet] of [['hub', '10.80.0.0/16', '10.80.0.0/24'], ['spoke', '10.81.0.0/16', '10.81.0.0/24']] as const) {
      context.az(['network', 'vnet', 'create', '--resource-group', context.resourceGroup, '--name', name, '--location', context.location,
        '--address-prefixes', prefix, '--subnet-name', 'nodes', '--subnet-prefixes', subnet, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    }
    for (const [from, to] of [['hub', 'spoke'], ['spoke', 'hub']] as const) context.az(['network', 'vnet', 'peering', 'create',
      '--resource-group', context.resourceGroup, '--vnet-name', from, '--name', `to-${to}`, '--remote-vnet', vnet(to), '--allow-vnet-access']);
    const zoneName = `privatelink.${context.location}.azmk8s.io`;
    const zone = context.az(['network', 'private-dns', 'zone', 'create', '--resource-group', context.resourceGroup, '--name', zoneName, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    context.az(['network', 'private-dns', 'link', 'vnet', 'create', '--resource-group', context.resourceGroup, '--zone-name', zoneName,
      '--name', 'hub-link', '--virtual-network', vnet('hub'), '--registration-enabled', 'false']);
    context.az(['network', 'private-dns', 'record-set', 'a', 'add-record', '--resource-group', context.resourceGroup, '--zone-name', zoneName,
      '--record-set-name', 'sentinel', '--ipv4-address', '192.0.2.55']);
    const identity = context.az(['identity', 'create', '--resource-group', context.resourceGroup, '--name', 'private-subject', '--location', context.location, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const role = (name: string, scope: string) => context.az(['role', 'assignment', 'create', '--assignee-object-id', identity.principalId,
      '--assignee-principal-type', 'ServicePrincipal', '--role', name, '--scope', scope]);
    role('Private DNS Zone Contributor', zone.id); role('Network Contributor', `${vnet('spoke')}/subnets/nodes`);
    const nodeGroup = `${context.resourceGroup}-subject-nodes`; context.registerAuxiliaryNodeGroup(nodeGroup);
    const createSubject = () => context.attemptAz(['aks', 'create', '--resource-group', context.resourceGroup, '--name', 'subject', '--location', context.location,
      '--node-resource-group', nodeGroup, '--node-count', '1', '--node-vm-size', context.nodeVmSize, '--kubernetes-version', context.kubernetesVersion,
      '--enable-managed-identity', '--assign-identity', identity.id, '--enable-private-cluster', '--private-dns-zone', zone.id,
      '--vnet-subnet-id', `${vnet('spoke')}/subnets/nodes`, '--network-plugin', 'azure', '--network-plugin-mode', 'overlay', '--network-dataplane', 'cilium',
      '--ssh-key-value', context.publicSshKey, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    await context.phase('baseline', async () => {
      context.az(['network', 'vnet', 'subnet', 'create', '--resource-group', context.resourceGroup, '--vnet-name', 'hub', '--name', 'probes',
        '--address-prefixes', '10.80.1.0/24', '--delegations', 'Microsoft.ContainerInstance/containerGroups']);
      context.az(['container', 'create', '--resource-group', context.resourceGroup, '--name', 'dns-probe', '--location', context.location,
        '--image', context.parameters.networkProbeImage!, '--os-type', 'Linux', '--cpu', '1', '--memory', '1', '--restart-policy', 'Never',
        '--subnet', `${vnet('hub')}/subnets/probes`, '--command-line', `sh -c "nslookup sentinel.${zoneName} 168.63.129.16"`, '--tags', `headlamp-e2e-owner=${context.owner}`]);
      let response: any;
      await context.poll(() => {
        response = context.az(['container', 'show', '--resource-group', context.resourceGroup, '--name', 'dns-probe']);
        return response.containers?.[0]?.instanceView?.currentState?.state === 'Terminated';
      }, 'Owned hub DNS probe completion');
      assert.equal(response.containers[0].instanceView.currentState.exitCode, 0);
      const logs = context.attemptAz(['container', 'logs', '--resource-group', context.resourceGroup, '--name', 'dns-probe']);
      assert.equal(logs.status, 0); assert.match(logs.stdout, /192\.0\.2\.55/);
      return { probe: response, logs, roleScopes: context.az(['role', 'assignment', 'list', '--assignee', identity.principalId, '--all']) };
    });
    await context.phase('fault', async () => {
      const result = createSubject(); context.save('private-create-result', result);
      assert.notEqual(result.status, 0, 'Private creation did not fail');
      assert.match(result.stderr, /AuthorizationFailed|AuthorizationMissing|LinkedAuthorizationFailed/);
      assert.ok(result.stderr.toLowerCase().includes(vnet('spoke').toLowerCase()), 'Authorization error not scoped to owned spoke VNet');
      assert.match(result.stderr, /virtualNetworkLinks|virtualNetworks\/join|join\/action|read/i);
      return { result, roles: context.az(['role', 'assignment', 'list', '--assignee', identity.principalId, '--all']) };
    });
    await context.phase('recovery', async () => {
      role('Network Contributor', vnet('spoke'));
      const result = createSubject(); assert.equal(result.status, 0, 'Supported VNet authorization did not restore creation');
      const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'subject']);
      assert.equal(cluster.provisioningState, 'Succeeded'); assert.equal(cluster.nodeResourceGroup, nodeGroup);
      const links = context.az(['network', 'private-dns', 'link', 'vnet', 'list', '--resource-group', context.resourceGroup, '--zone-name', zoneName]);
      assert.ok(links.some((item: any) => item.virtualNetwork?.id.toLowerCase() === vnet('spoke').toLowerCase()));
      return { cluster, links, recovery: 'Real private AKS creation and DNS-link acceptance; workload connectivity qualification remains separate' };
    });
  },
};

export const aksPrivateEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c010-v1': privateDnsPermissions,
};