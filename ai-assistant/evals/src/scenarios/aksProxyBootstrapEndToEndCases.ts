import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { namespaced, probePod, readyPod, requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

const aptNoProxy: AksEndToEndCase = {
  customNetwork: true,
  validate(parameters) {
    requiredParameter(parameters, 'squidImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
    requiredParameter(parameters, 'aptProbeImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
    requiredParameter(parameters, 'recoveryKubernetesVersion', /^1\.\d+\.\d+$/);
  },
  async run(context) {
    assert.ok(context.subnetId); const vnetId = context.subnetId.slice(0, context.subnetId.lastIndexOf('/subnets/')); const vnetName = vnetId.split('/').at(-1)!;
    context.az(['network', 'vnet', 'subnet', 'create', '--resource-group', context.resourceGroup, '--vnet-name', vnetName, '--name', 'proxy', '--address-prefixes', '10.90.24.0/24', '--delegations', 'Microsoft.ContainerInstance/containerGroups']);
    const proxy = context.az(['container', 'create', '--resource-group', context.resourceGroup, '--name', 'proxy', '--location', context.location,
      '--image', context.parameters.squidImage!, '--os-type', 'Linux', '--cpu', '1', '--memory', '1', '--subnet', `${vnetId}/subnets/proxy`, '--ports', '3128',
      '--command-line', 'sh -c "printf \'http_port 3128\nacl denied dstdomain packages.microsoft.com\nhttp_access deny denied\nhttp_access allow all\ncache deny all\naccess_log stdio:/dev/stdout\n\' >/tmp/research-squid.conf; exec squid -N -f /tmp/research-squid.conf"', '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const address = proxy.ipAddress?.ip; assert.ok(typeof address === 'string' && /^10\./.test(address)); const url = `http://${address}:3128`;
    context.registerAuxiliaryNodeGroup(`${context.resourceGroup}-subject-nodes`);
    const configFile = path.join(context.artifactDirectory, 'http-proxy.json');
    writeFileSync(configFile, JSON.stringify({ httpProxy: url, httpsProxy: url, noProxy: ['packages.microsoft.com', '169.254.169.254', '168.63.129.16', '10.90.0.0/16'] }), { mode: 0o600 });
    const create = (version: string) => context.attemptAz(['aks', 'create', '--resource-group', context.resourceGroup, '--name', 'subject', '--location', context.location,
      '--node-resource-group', `${context.resourceGroup}-subject-nodes`, '--kubernetes-version', version, '--node-count', '1', '--node-vm-size', context.nodeVmSize,
      '--vnet-subnet-id', context.subnetId!, '--network-plugin', 'azure', '--network-plugin-mode', 'overlay', '--enable-managed-identity', '--http-proxy-config', configFile,
      '--ssh-key-value', context.publicSshKey, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    await context.phase('baseline', async () => {
      const pod: any = probePod(context, 'apt-control'); pod.spec.containers[0].image = context.parameters.aptProbeImage;
      context.create('apt-control', pod); await readyPod(context, 'apt-control');
      const test = context.kube(namespaced(context, ['exec', 'apt-control', '--', 'env', `https_proxy=${url}`, 'no_proxy=packages.microsoft.com',
        'sh', '-c', 'mkdir -p /tmp/lists/partial /tmp/cache; printf "deb [trusted=yes] https://packages.microsoft.com/repos/azure-cli/ noble main\\n" >/tmp/research.list; apt-get update -o Dir::Etc::sourcelist=/tmp/research.list -o Dir::Etc::sourceparts=- -o Dir::State::lists=/tmp/lists -o Dir::Cache=/tmp/cache -o APT::Get::List-Cleanup=0']));
      assert.equal(test.status, 0); return { result: test, control: 'Bounded package index request with lowercase no_proxy through owned rejecting proxy' };
    });
    await context.phase('fault', async () => {
      const result = create(context.kubernetesVersion); assert.notEqual(result.status, 0); assert.match(result.stderr, /VMExtensionError_AptUpdateTimeout/);
      const logs = context.attemptAz(['container', 'logs', '--resource-group', context.resourceGroup, '--name', 'proxy']);
      assert.equal(logs.status, 0); assert.match(logs.stdout, /(?:DENIED|403).*packages\.microsoft\.com|packages\.microsoft\.com.*(?:DENIED|403)/i);
      return { result, proxyLogs: logs.stdout, configuredExclusion: 'packages.microsoft.com' };
    });
    await context.phase('recovery', async () => {
      if (context.az(['aks', 'list', '--resource-group', context.resourceGroup]).some((cluster: any) => cluster.name === 'subject')) context.az(['aks', 'delete', '--resource-group', context.resourceGroup, '--name', 'subject', '--yes']);
      await context.poll(() => context.az(['group', 'exists', '--name', `${context.resourceGroup}-subject-nodes`]) === false, 'Failed bootstrap node group deletion');
      const result = create(context.parameters.recoveryKubernetesVersion!); assert.equal(result.status, 0, 'Declared corrected bootstrap version did not provision');
      const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'subject']); assert.equal(cluster.provisioningState, 'Succeeded'); return { cluster, unchangedProxyPolicy: true };
    });
  },
};

export const aksProxyBootstrapEndToEndCases: Record<string, AksEndToEndCase> = { 'aks-c015-v1': aptNoProxy };