import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { metadata, namespaced, probePod, readyPod, requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

const windowsSqlEndpoint: AksEndToEndCase = {
  windows: true, customNetwork: true, nodeSubnetNetworking: true, dynamicPodSubnet: true, natGateway: true, serviceEndpoints: ['Microsoft.Sql'],
  validate(parameters) {
    for (const name of ['linuxSqlImage', 'windowsSqlImage']) requiredParameter(parameters, name, /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
    requiredParameter(parameters, 'windowsNodeVmSize', /^Standard_[a-zA-Z0-9_]+$/);
    requiredParameter(parameters, 'affectedWindowsImage', /^[a-zA-Z0-9._-]+$/); requiredParameter(parameters, 'recoveryWindowsImage', /^[a-zA-Z0-9._-]+$/);
    requiredParameter(parameters, 'recoveryKubernetesVersion', /^1\.\d+\.\d+$/);
  },
  async run(context) {
    assert.ok(context.subnetId && context.podSubnetId);
    const password = `R!${randomBytes(24).toString('base64url')}9a`; const sql = `sql${context.owner.replaceAll('-', '').slice(0, 20)}`;
    context.az(['sql', 'server', 'create', '--resource-group', context.resourceGroup, '--name', sql, '--location', context.location, '--admin-user', 'researchadmin', '--admin-password', password]);
    context.az(['sql', 'db', 'create', '--resource-group', context.resourceGroup, '--server', sql, '--name', 'research', '--service-objective', 'Basic', '--max-size', '2GB']);
    context.az(['sql', 'server', 'vnet-rule', 'create', '--resource-group', context.resourceGroup, '--server', sql, '--name', 'pods', '--subnet', context.podSubnetId]);
    context.createPrivate({ apiVersion: 'v1', kind: 'Secret', metadata: metadata(context, 'sql-auth'), stringData: { password } });
    context.az(['aks', 'nodepool', 'add', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'windows', '--os-type', 'Windows', '--os-sku', 'Windows2022',
      '--node-count', '1', '--node-vm-size', context.parameters.windowsNodeVmSize!, '--vnet-subnet-id', context.subnetId, '--pod-subnet-id', context.podSubnetId, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const pool = () => context.az(['aks', 'nodepool', 'show', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'windows']);
    assert.equal(pool().nodeImageVersion, context.parameters.affectedWindowsImage);
    const make = (windows: boolean) => {
      const name = windows ? 'windows-client' : 'linux-client'; const pod: any = probePod(context, name);
      pod.spec.nodeSelector = { 'kubernetes.io/os': windows ? 'windows' : 'linux' };
      pod.spec.containers[0].image = context.parameters[windows ? 'windowsSqlImage' : 'linuxSqlImage'];
      pod.spec.containers[0].command = windows ? ['powershell.exe', '-NoLogo', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 3600'] : ['sh', '-c', 'exec tail -f /dev/null'];
      if (windows) { delete pod.spec.containers[0].securityContext; pod.spec.containers[0].resources.requests.memory = '128Mi'; pod.spec.containers[0].resources.limits.memory = '256Mi'; }
      pod.spec.containers[0].env = [{ name: 'SQLCMDPASSWORD', valueFrom: { secretKeyRef: { name: 'sql-auth', key: 'password' } } }]; context.create(`${name}-pod`, pod);
    };
    make(false); make(true); await readyPod(context, 'linux-client'); await readyPod(context, 'windows-client');
    const query = (windows: boolean) => context.kube(namespaced(context, ['exec', windows ? 'windows-client' : 'linux-client', '--', windows ? 'sqlcmd.exe' : '/opt/mssql-tools18/bin/sqlcmd',
      '-S', `${sql}.database.windows.net`, '-d', 'research', '-U', 'researchadmin', '-Q', 'SET NOCOUNT ON; SELECT 1', '-l', '10', '-b']));
    const publicIp = context.az(['network', 'public-ip', 'show', '--resource-group', context.resourceGroup, '--name', 'egress']).ipAddress;
    await context.phase('baseline', async () => {
      await context.poll(() => query(false).status === 0, 'Linux service-endpoint SQL path');
      context.az(['sql', 'server', 'firewall-rule', 'create', '--resource-group', context.resourceGroup, '--server', sql, '--name', 'owned-nat-control', '--start-ip-address', publicIp, '--end-ip-address', publicIp]);
      await context.poll(() => query(true).status === 0, 'Windows explicit owned-NAT SQL control');
      const evidence = { linux: query(false), windows: query(true) };
      context.az(['sql', 'server', 'firewall-rule', 'delete', '--resource-group', context.resourceGroup, '--server', sql, '--name', 'owned-nat-control']); return evidence;
    });
    await context.phase('fault', async () => {
      let result: any;
      await context.poll(() => { result = query(true); return result.status !== 0 && (result.stdout + result.stderr).includes(publicIp) && /not allowed|firewall|cannot open/i.test(result.stdout + result.stderr); }, 'Windows denied with observed NAT source address');
      assert.equal(query(false).status, 0); return { windows: result, linux: query(false), natIp: publicIp, subnetRule: context.az(['sql', 'server', 'vnet-rule', 'show', '--resource-group', context.resourceGroup, '--server', sql, '--name', 'pods']) };
    });
    await context.phase('recovery', async () => {
      context.az(['aks', 'upgrade', '--resource-group', context.resourceGroup, '--name', 'research', '--kubernetes-version', context.parameters.recoveryKubernetesVersion!, '--yes']);
      context.az(['aks', 'nodepool', 'upgrade', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'windows', '--node-image-only']);
      assert.equal(pool().nodeImageVersion, context.parameters.recoveryWindowsImage);
      for (const windows of [false, true]) { context.run(namespaced(context, ['delete', 'pod', windows ? 'windows-client' : 'linux-client', '--ignore-not-found', '--wait=true', '--timeout=90s'])); make(windows); await readyPod(context, windows ? 'windows-client' : 'linux-client'); }
      await context.poll(() => query(false).status === 0 && query(true).status === 0, 'Corrected Windows endpoint path without NAT firewall exception');
      assert.ok(!context.az(['sql', 'server', 'firewall-rule', 'list', '--resource-group', context.resourceGroup, '--server', sql]).some((rule: any) => rule.name === 'owned-nat-control'));
      return { linux: query(false), windows: query(true), pool: pool() };
    });
  },
};

export const aksWindowsSqlEndToEndCases: Record<string, AksEndToEndCase> = { 'aks-c052-v1': windowsSqlEndpoint };