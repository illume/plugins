import assert from 'node:assert/strict';
import { chartInput, installChart, available, deployment, deploymentPods } from './aksChartCaseSupport.js';
import { namespaced, probePod, readyPod, requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

const byocniCidr: AksEndToEndCase = {
  bringYourOwnCni: true, podCidr: '10.244.0.0/16',
  validate(parameters) { chartInput(parameters, 'ciliumChart'); requiredParameter(parameters, 'recoveryApiVersion', /^\d{4}-\d{2}-\d{2}(?:-preview)?$/); },
  async run(context) {
    const cluster = () => context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
    installChart(context, 'cilium', 'ciliumChart', 'kube-system', { aksbyocni: { enabled: true }, k8sServiceHost: cluster().fqdn, k8sServicePort: 443,
      ipam: { mode: 'cluster-pool', operator: { clusterPoolIPv4PodCIDRList: ['10.244.0.0/16'] } } });
    await context.phase('baseline', async () => {
      context.create('cni-control', probePod(context, 'control')); const pod = await readyPod(context, 'control'); assert.match(pod.status.podIP, /^10\.244\./);
      return { requestedPodCidr: '10.244.0.0/16', observedPod: pod, control: 'Working CNI address allocation, not an assertion of a healthy ARM round trip' };
    });
    await context.phase('fault', async () => {
      const actual = cluster(); assert.equal(actual.networkProfile.networkPlugin, 'none');
      assert.ok(!actual.networkProfile.podCidr && (!actual.networkProfile.podCidrs || actual.networkProfile.podCidrs.length === 0), 'ARM retained CIDR; drift not reproduced');
      return { requested: '10.244.0.0/16', actual: actual.networkProfile, scope: 'ARM persistence mechanism; private API/webhook routing variant is not inferred' };
    });
    await context.phase('recovery', async () => {
      const actual = cluster(); const properties = { ...actual, networkProfile: { ...actual.networkProfile, podCidr: '10.244.0.0/16', podCidrs: ['10.244.0.0/16'] } };
      delete properties.id; delete properties.name; delete properties.type;
      context.az(['rest', '--method', 'put', '--url', `https://management.azure.com${context.clusterId}?api-version=${context.parameters.recoveryApiVersion}`,
        '--body', JSON.stringify({ location: context.location, identity: actual.identity, tags: actual.tags, properties })]);
      await context.poll(() => cluster().networkProfile.podCidr === '10.244.0.0/16', 'Supported API retains explicit pod CIDR');
      return { cluster: cluster(), pod: await readyPod(context, 'control') };
    });
  },
};

const virtualTypha: AksEndToEndCase = {
  customNetwork: true, nodeSubnetNetworking: true, networkPolicy: 'calico',
  validate(parameters) { requiredParameter(parameters, 'typhaImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/); },
  async run(context) {
    assert.ok(context.subnetId); const vnet = context.subnetId.slice(0, context.subnetId.lastIndexOf('/subnets/')); const name = vnet.split('/').at(-1)!;
    context.az(['network', 'vnet', 'subnet', 'create', '--resource-group', context.resourceGroup, '--vnet-name', name, '--name', 'virtual-nodes', '--address-prefixes', '10.90.20.0/24', '--delegations', 'Microsoft.ContainerInstance/containerGroups']);
    context.az(['aks', 'enable-addons', '--resource-group', context.resourceGroup, '--name', 'research', '--addons', 'virtual-node', '--subnet-name', 'virtual-nodes']);
    const original = deployment(context, 'kube-system', 'calico-typha');
    assert.ok(original.spec.template.spec.containers.some((container: any) => container.image === context.parameters.typhaImage));
    await context.phase('baseline', async () => { await available(context, 'kube-system', 'calico-typha'); return { deployment: original, pods: deploymentPods(context, 'kube-system', 'calico-typha') }; });
    await context.phase('fault', async () => {
      const changed = deployment(context, 'kube-system', 'calico-typha'); changed.spec.replicas = 2;
      context.replace('additional-typha-demand', changed); let captured: unknown;
      await context.poll(() => {
        const pods = deploymentPods(context, 'kube-system', 'calico-typha');
        const virtual = pods.items.find((pod: any) => pod.spec.nodeName && JSON.parse(context.run(['get', 'node', pod.spec.nodeName, '-o', 'json'])).metadata.labels.type === 'virtual-kubelet');
        if (!virtual) return false;
        const events = JSON.parse(context.run(['-n', 'kube-system', 'get', 'events', '--field-selector', `involvedObject.uid=${virtual.metadata.uid}`, '-o', 'json']));
        captured = { pods, virtual, events }; context.save('virtual-typha-fault', captured);
        return !virtual.status.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'True') &&
          events.items.some((event: any) => /Failed|Invalid|Unsupported/i.test(event.reason ?? ''));
      }, 'Real Typha placement and failure on owned ACI virtual node'); return captured;
    });
    await context.phase('recovery', async () => {
      const actual = deployment(context, 'kube-system', 'calico-typha'); actual.spec.template.spec.affinity ??= {};
      actual.spec.template.spec.affinity.nodeAffinity = { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchExpressions: [{ key: 'type', operator: 'NotIn', values: ['virtual-kubelet'] }] }] } };
      context.replace('physical-typha-only', actual);
      const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']); const system = cluster.agentPoolProfiles.find((item: any) => item.mode === 'System');
      context.az(['aks', 'nodepool', 'scale', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', system.name, '--node-count', '2']);
      return available(context, 'kube-system', 'calico-typha');
    });
  },
};

const automaticIsolation: AksEndToEndCase = {
  customNetwork: true,
  validate() {},
  async run(context) {
    assert.ok(context.subnetId); const nodeGroup = `${context.resourceGroup}-subject-nodes`; context.registerAuxiliaryNodeGroup(nodeGroup);
    const registryName = `boot${context.owner.replaceAll('-', '').slice(0, 20)}`;
    const registry = context.az(['acr', 'create', '--resource-group', context.resourceGroup, '--name', registryName, '--sku', 'Premium', '--location', context.location, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const identity = context.az(['identity', 'create', '--resource-group', context.resourceGroup, '--name', 'isolation', '--location', context.location, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const scope = `/subscriptions/${context.subscription}/resourceGroups/${context.resourceGroup}`;
    context.az(['role', 'assignment', 'create', '--assignee-object-id', identity.principalId, '--assignee-principal-type', 'ServicePrincipal', '--role', 'Network Contributor', '--scope', scope]);
    context.az(['role', 'assignment', 'create', '--assignee-object-id', identity.principalId, '--assignee-principal-type', 'ServicePrincipal', '--role', 'AcrPull', '--scope', registry.id]);
    const create = (sku: string, isolated: boolean) => context.attemptAz(['aks', 'create', '--resource-group', context.resourceGroup, '--name', 'subject', '--location', context.location,
      '--node-resource-group', nodeGroup, '--node-vm-size', context.nodeVmSize, '--node-count', '1', '--kubernetes-version', context.kubernetesVersion,
      '--sku', sku, '--tier', 'Standard', '--enable-managed-identity', '--assign-identity', identity.id, '--vnet-subnet-id', context.subnetId!, '--network-plugin', 'azure', '--network-plugin-mode', 'overlay',
      '--outbound-type', isolated ? 'none' : 'loadBalancer', '--bootstrap-artifact-source', isolated ? 'Cache' : 'Direct',
      ...(isolated ? ['--bootstrap-container-registry-resource-id', registry.id] : []), '--ssh-key-value', context.publicSshKey, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    await context.phase('baseline', async () => { const baseline = create('Base', false); assert.equal(baseline.status, 0);
      const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'subject']); assert.equal(cluster.provisioningState, 'Succeeded');
      context.az(['aks', 'delete', '--resource-group', context.resourceGroup, '--name', 'subject', '--yes']);
      await context.poll(() => context.az(['group', 'exists', '--name', nodeGroup]) === false, 'Baseline node group deleted'); return cluster; });
    await context.phase('fault', async () => { const result = create('Automatic', true); assert.notEqual(result.status, 0); assert.match(result.stderr, /InvalidNetworkIsolatedClusterConfiguration/); return result; });
    await context.phase('recovery', async () => {
      const existing = context.az(['aks', 'list', '--resource-group', context.resourceGroup]);
      if (existing.some((item: any) => item.name === 'subject')) context.az(['aks', 'delete', '--resource-group', context.resourceGroup, '--name', 'subject', '--yes']);
      const result = create('Base', true); assert.equal(result.status, 0, 'Declared supported Base/isolated combination did not provision');
      const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'subject']); assert.equal(cluster.provisioningState, 'Succeeded');
      return { cluster, changed: 'Supported SKU/isolation pairing, not enabling the rejected Automatic combination' };
    });
  },
};

export const aksNetworkConfigurationEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c021-v1': byocniCidr,
  'aks-c022-v1': virtualTypha,
  'aks-c035-v1': automaticIsolation,
};