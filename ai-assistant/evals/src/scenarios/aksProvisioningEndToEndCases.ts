import assert from 'node:assert/strict';
import { requiredParameter, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';

function subjectArguments(context: AksCaseContext) {
  return ['aks', 'create', '--resource-group', context.resourceGroup, '--name', 'subject', '--location', context.location,
    '--node-resource-group', `${context.resourceGroup}-subject-nodes`, '--node-count', '1', '--node-vm-size', context.nodeVmSize,
    '--kubernetes-version', context.kubernetesVersion, '--enable-managed-identity', '--ssh-key-value', context.publicSshKey,
    '--tags', `headlamp-e2e-owner=${context.owner}`];
}

const encryptionNap: AksEndToEndCase = {
  validate(parameters) { requiredParameter(parameters, 'keyAdministratorObjectId', /^[a-f0-9-]{36}$/i); },
  async run(context) {
    const vaultName = `hl${context.owner.replaceAll('-', '').slice(0, 22)}`;
    const vault = context.az(['keyvault', 'create', '--resource-group', context.resourceGroup, '--name', vaultName, '--location', context.location,
      '--enable-rbac-authorization', 'true', '--enable-purge-protection', 'true', '--retention-days', '7', '--tags', `headlamp-e2e-owner=${context.owner}`]);
    context.az(['role', 'assignment', 'create', '--assignee-object-id', context.parameters.keyAdministratorObjectId!, '--role', 'Key Vault Crypto Officer', '--scope', vault.id]);
    const key = context.az(['keyvault', 'key', 'create', '--vault-name', vaultName, '--name', 'owned-key', '--kty', 'RSA', '--size', '2048']);
    const encryption = context.az(['disk-encryption-set', 'create', '--resource-group', context.resourceGroup, '--name', 'encryption', '--location', context.location,
      '--key-url', key.key.kid, '--source-vault', vault.id, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    context.az(['role', 'assignment', 'create', '--assignee-object-id', encryption.identity.principalId, '--assignee-principal-type', 'ServicePrincipal',
      '--role', 'Key Vault Crypto Service Encryption User', '--scope', vault.id]);
    context.registerAuxiliaryNodeGroup(`${context.resourceGroup}-subject-nodes`);
    const cluster = () => context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'subject']);
    await context.phase('baseline', async () => {
      context.az([...subjectArguments(context), '--disk-encryption-set-id', encryption.id, '--network-plugin', 'azure', '--network-plugin-mode', 'overlay']);
      const current = cluster(); assert.equal(current.diskEncryptionSetID?.toLowerCase(), encryption.id.toLowerCase()); assert.equal(current.provisioningState, 'Succeeded');
      return { cluster: current, encryptionSetId: encryption.id, fidelity: 'Actual encrypted AKS NAP incompatibility; BYOCNI/private-network variant not asserted' };
    });
    await context.phase('fault', async () => {
      const result = context.attemptAz(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'subject', '--node-provisioning-mode', 'Auto']);
      assert.notEqual(result.status, 0); assert.match(result.stderr, /diskEncryptionSetI[Dd]/); assert.match(result.stderr, /nodeProvisioning|provisioning.*Auto/i);
      return { result, cluster: cluster() };
    });
    await context.phase('recovery', async () => {
      context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'subject', '--node-provisioning-mode', 'Manual']);
      const current = cluster(); assert.equal(current.provisioningState, 'Succeeded'); assert.equal(current.diskEncryptionSetID?.toLowerCase(), encryption.id.toLowerCase());
      assert.notEqual(current.nodeProvisioningProfile?.mode, 'Auto');
      return { cluster: current, security: 'Customer-managed encryption retained', retainedResource: 'Purge-protected vault may remain soft-deleted under Azure retention policy after resource-group cleanup' };
    });
  },
};

const encryptedVnet: AksEndToEndCase = {
  validate() {},
  async run(context) {
    context.registerAuxiliaryNodeGroup(`${context.resourceGroup}-subject-nodes`);
    const vnet = context.az(['network', 'vnet', 'create', '--resource-group', context.resourceGroup, '--name', 'integrated', '--location', context.location,
      '--address-prefixes', '10.110.0.0/16', '--subnet-name', 'nodes', '--subnet-prefixes', '10.110.0.0/22', '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const vnetId = vnet.newVNet?.id ?? vnet.id; assert.ok(vnetId);
    const apiSubnet = context.az(['network', 'vnet', 'subnet', 'create', '--resource-group', context.resourceGroup, '--vnet-name', 'integrated', '--name', 'apiserver',
      '--address-prefixes', '10.110.8.0/27', '--delegations', 'Microsoft.ContainerService/managedClusters']);
    const identity = context.az(['identity', 'create', '--resource-group', context.resourceGroup, '--name', 'integration', '--location', context.location, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    context.az(['role', 'assignment', 'create', '--assignee-object-id', identity.principalId, '--assignee-principal-type', 'ServicePrincipal', '--role', 'Network Contributor', '--scope', vnetId]);
    const create = () => context.attemptAz([...subjectArguments(context), '--assign-identity', identity.id, '--enable-private-cluster', '--enable-apiserver-vnet-integration',
      '--apiserver-subnet-id', apiSubnet.id, '--vnet-subnet-id', `${vnetId}/subnets/nodes`, '--os-sku', 'AzureLinux', '--network-plugin', 'azure', '--network-plugin-mode', 'overlay']);
    const remove = async () => {
      const objects = context.az(['aks', 'list', '--resource-group', context.resourceGroup]);
      if (objects.some((item: any) => item.name === 'subject')) context.az(['aks', 'delete', '--resource-group', context.resourceGroup, '--name', 'subject', '--yes']);
      await context.poll(() => context.az(['group', 'exists', '--name', `${context.resourceGroup}-subject-nodes`]) === false, 'Auxiliary managed node-group removal');
    };
    await context.phase('baseline', async () => {
      const result = create(); assert.equal(result.status, 0); const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'subject']);
      assert.equal(cluster.provisioningState, 'Succeeded'); await remove(); return cluster;
    });
    await context.phase('fault', async () => {
      context.az(['network', 'vnet', 'update', '--ids', vnetId, '--set', 'encryption.enabled=true', 'encryption.enforcement=AllowUnencrypted']);
      const properties = context.az(['network', 'vnet', 'show', '--ids', vnetId]); assert.equal(properties.encryption.enabled, true);
      const result = create(); assert.notEqual(result.status, 0); assert.match(result.stderr, /NodesNotReady/);
      return { result, network: properties };
    });
    await context.phase('recovery', async () => {
      await remove(); context.az(['network', 'vnet', 'update', '--ids', vnetId, '--set', 'encryption.enabled=false']);
      const result = create(); assert.equal(result.status, 0); const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'subject']);
      assert.equal(cluster.provisioningState, 'Succeeded'); return { cluster, workaround: 'Unencrypted disposable compatibility control, not weakening production encryption' };
    });
  },
};

const deprecatedApiUpgrade: AksEndToEndCase = {
  validate(parameters) {
    requiredParameter(parameters, 'upgradeVersion', /^1\.\d+\.\d+$/);
    requiredParameter(parameters, 'deprecatedApiPath', /^\/apis\/[a-z0-9.-]+\/v[0-9][a-z0-9]*\/namespaces\/aks-reproduction\/[a-z]+$/);
    requiredParameter(parameters, 'detectionWindowSeconds', /^[0-9]+$/);
    assert.ok(Number(parameters.detectionWindowSeconds) >= 60 && Number(parameters.detectionWindowSeconds) <= 86400, 'Declare a bounded supported detection window');
    requiredParameter(parameters, 'acceptLookbackCost', /^true$/);
  },
  async run(context) {
    await context.phase('baseline', async () => {
      const available = context.az(['aks', 'get-upgrades', '--resource-group', context.resourceGroup, '--name', 'research']);
      assert.ok(available.controlPlaneProfile?.upgrades?.some((item: any) => item.kubernetesVersion === context.parameters.upgradeVersion), 'Requested upgrade unavailable');
      return { available, boundary: 'Version availability only; the following request is the real upgrade preflight' };
    });
    await context.phase('fault', async () => {
      const request = context.kube(['get', '--raw', context.parameters.deprecatedApiPath!]); assert.equal(request.status, 0, 'Deprecated API is not served by the source version');
      const at = new Date().toISOString(); context.save('deprecated-call', { path: context.parameters.deprecatedApiPath, at, status: request.status });
      const upgrade = context.attemptAz(['aks', 'upgrade', '--resource-group', context.resourceGroup, '--name', 'research', '--kubernetes-version', context.parameters.upgradeVersion!, '--yes']);
      assert.notEqual(upgrade.status, 0); assert.match(upgrade.stderr, /deprecated.*API|API.*deprecated/i);
      const group = context.parameters.deprecatedApiPath!.split('/')[2]!; assert.ok(upgrade.stderr.includes(group), 'Upgrade block does not identify the exercised API group');
      return { upgrade, requestPath: context.parameters.deprecatedApiPath, lastUse: at };
    });
    await context.phase('recovery', async () => {
      await context.wait(Number(context.parameters.detectionWindowSeconds) * 1000);
      context.az(['aks', 'upgrade', '--resource-group', context.resourceGroup, '--name', 'research', '--kubernetes-version', context.parameters.upgradeVersion!, '--yes']);
      const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
      assert.equal(cluster.currentKubernetesVersion ?? cluster.kubernetesVersion, context.parameters.upgradeVersion);
      const nodes = JSON.parse(context.run(['get', 'nodes', '-o', 'json'])); assert.ok(nodes.items.every((node: any) => node.status.conditions.some((condition: any) => condition.type === 'Ready' && condition.status === 'True')));
      return { cluster, nodes, recovery: 'No more deprecated caller activity, waited declared lookback, no force-upgrade flag' };
    });
  },
};

export const aksProvisioningEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c004-v1': encryptionNap,
  'aks-c034-v1': encryptedVnet,
  'aks-c051-v1': deprecatedApiUpgrade,
};