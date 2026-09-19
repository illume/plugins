import assert from 'node:assert/strict';
import { metadata, namespaced, objectEvents, requiredParameter, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';
import { filesEnvironment, staticShare, sharePod, shareReady, validateFile } from './aksFileEndToEndCases.js';
import { managedIdentityShare, identityVolume } from './aksFilePlatformEndToEndCases.js';

function endpoint(context: AksCaseContext, account: string, storageId: string) {
  assert.ok(context.subnetId);
  const vnetId = context.subnetId.slice(0, context.subnetId.lastIndexOf('/subnets/')); const vnetName = vnetId.split('/').at(-1)!;
  const subnet = context.az(['network', 'vnet', 'subnet', 'create', '--resource-group', context.resourceGroup, '--vnet-name', vnetName,
    '--name', 'storage', '--address-prefixes', '10.90.12.0/24', '--private-endpoint-network-policies', 'Enabled']);
  context.az(['network', 'private-endpoint', 'create', '--resource-group', context.resourceGroup, '--name', 'storage', '--location', context.location,
    '--subnet', subnet.id, '--private-connection-resource-id', storageId, '--group-id', 'file', '--connection-name', 'storage', '--tags', `headlamp-e2e-owner=${context.owner}`]);
  const zone = context.az(['network', 'private-dns', 'zone', 'create', '--resource-group', context.resourceGroup, '--name', 'privatelink.file.core.windows.net', '--tags', `headlamp-e2e-owner=${context.owner}`]);
  context.az(['network', 'private-dns', 'link', 'vnet', 'create', '--resource-group', context.resourceGroup, '--zone-name', zone.name, '--name', 'cluster', '--virtual-network', vnetId, '--registration-enabled', 'false']);
  context.az(['network', 'private-endpoint', 'dns-zone-group', 'create', '--resource-group', context.resourceGroup, '--endpoint-name', 'storage', '--name', 'default', '--private-dns-zone', zone.id, '--zone-name', 'file']);
  context.az(['storage', 'account', 'update', '--resource-group', context.resourceGroup, '--name', account, '--public-network-access', 'Disabled']);
  return { subnet, zone };
}

const privateSpn: AksEndToEndCase = {
  customNetwork: true, validate: validateFile,
  async run(context) {
    const environment = managedIdentityShare(context); endpoint(context, environment.account, environment.storage.id);
    const canonical = `${environment.account}.file.core.windows.net`;
    const subjectHost = `${environment.account}.privatelink.file.core.windows.net`;
    const fixture = (name: string, host: string) => {
      const pod = identityVolume(context, name, environment.account, environment.clientId, false, { server: host });
      context.create(`${name}-pod`, pod);
    };
    await context.phase('baseline', async () => { fixture('control', canonical); return shareReady(context, 'control'); });
    await context.phase('fault', async () => {
      fixture('subject', subjectHost); let captured: unknown;
      await context.poll(() => {
        const pod = context.read('pod', 'subject'); const events = objectEvents(context, pod);
        const logs = context.kube(['-n', 'kube-system', 'logs', 'daemonset/csi-azurefile-node', '-c', 'azurefile', '--tail=100']);
        const messages = events.items.map((event: any) => event.message ?? '').join('\n') + logs.stdout;
        const matching = messages.split('\n').filter((line: string) => line.includes(subjectHost) && /SPN|principal|Kerberos|ticket/i.test(line));
        captured = { pod, events, spnHostMatched: matching.length > 0, expectedCanonical: canonical, requestedHost: subjectHost };
        context.save('private-spn-observation', captured);
        return matching.length > 0 && events.items.some((event: any) => event.reason === 'FailedMount') && !pod.status?.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'True');
      }, 'Private-link hostname used in failed Kerberos identity mount');
      await shareReady(context, 'control'); return captured;
    });
    await context.phase('recovery', async () => {
      context.run(namespaced(context, ['delete', 'pod', 'subject', '--wait=true', '--timeout=90s']));
      const recovered: any = sharePod(context, 'subject', 'control'); context.create('canonical-recovery', recovered);
      return { pod: await shareReady(context, 'subject'), canonical, scope: 'Explicit canonical-host recovery; not a demonstration of every dynamic privateEndpoint SPN variant' };
    });
  },
};

const endpointPolicy: AksEndToEndCase = {
  customNetwork: true, validate: validateFile,
  async run(context) {
    assert.ok(context.subnetId); const vnet = context.subnetId.slice(0, context.subnetId.lastIndexOf('/subnets/')); const name = vnet.split('/').at(-1)!;
    await filesEnvironment(context);
    context.az(['network', 'vnet', 'subnet', 'create', '--resource-group', context.resourceGroup, '--vnet-name', name, '--name', 'endpoint-subject',
      '--address-prefixes', '10.90.16.0/24', '--private-endpoint-network-policies', 'Enabled']);
    const subnetId = `${vnet}/subnets/endpoint-subject`;
    const state = () => context.az(['network', 'vnet', 'subnet', 'show', '--ids', subnetId]);
    const provision = (claimName: string) => context.create(`${claimName}-claim`, { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(context, claimName),
      spec: { storageClassName: 'endpoint-storage', accessModes: ['ReadWriteMany'], resources: { requests: { storage: '100Gi' } } } });
    await context.phase('baseline', async () => {
      const subnet = state(); assert.equal(subnet.privateEndpointNetworkPolicies, 'Enabled');
      context.create('private-endpoint-class', { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: { name: 'endpoint-storage' },
        provisioner: 'file.csi.azure.com', reclaimPolicy: 'Delete', volumeBindingMode: 'Immediate', parameters: {
          skuName: 'Premium_LRS', resourceGroup: context.resourceGroup, networkEndpointType: 'privateEndpoint',
          vnetResourceGroup: context.resourceGroup, vnetName: name, subnetName: 'endpoint-subject' } });
      return { subnet, class: JSON.parse(context.run(['get', 'storageclass', 'endpoint-storage', '-o', 'json'])) };
    });
    await context.phase('fault', async () => {
      provision('subject'); let actual: any;
      await context.poll(() => { actual = state(); context.save('subnet-policy-observation', actual); return actual.privateEndpointNetworkPolicies === 'Disabled'; }, 'Actual CSI subnet network-policy mutation');
      return { subnet: actual, claim: context.read('pvc', 'subject'), scope: 'Provider property mutation, not a synthetic policy-deny response' };
    });
    await context.phase('recovery', async () => {
      context.az(['network', 'vnet', 'subnet', 'update', '--ids', subnetId, '--private-endpoint-network-policies', 'Enabled']);
      assert.equal(state().privateEndpointNetworkPolicies, 'Enabled');
      await context.poll(() => context.read('pvc', 'subject').status?.phase === 'Bound', 'Provisioned private endpoint share');
      context.create('private-mounted', sharePod(context, 'recovered', 'subject', true));
      return { subnet: state(), pod: await shareReady(context, 'recovered') };
    });
  },
};

export const aksPrivateFileEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c074-v1': privateSpn,
  'aks-c080-v1': endpointPolicy,
};