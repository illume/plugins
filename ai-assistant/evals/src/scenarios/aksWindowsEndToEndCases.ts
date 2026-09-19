import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { createServer } from 'node:net';
import {
  metadata, namespaced, objectEvents, probePod, readyPod, requiredParameter,
  type AksCaseContext, type AksEndToEndCase,
} from './aksEndToEndCases.js';

export function validateWindows(parameters: Record<string, string>) {
  requiredParameter(parameters, 'windowsProbeImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
  requiredParameter(parameters, 'windowsNodeImageVersion', /^[a-zA-Z0-9._-]+$/);
  requiredParameter(parameters, 'windowsNodeVmSize', /^Standard_[a-zA-Z0-9_]+$/);
  requiredParameter(parameters, 'windowsOsSku', /^(Windows2022|Windows2025)$/);
}

export async function windowsPool(context: AksCaseContext, autoscaling = false) {
  context.az(['aks', 'nodepool', 'add', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'windows',
    '--os-type', 'Windows', '--os-sku', context.parameters.windowsOsSku!, '--node-vm-size', context.parameters.windowsNodeVmSize!,
    '--node-count', '1', '--mode', 'User', '--labels', 'research=windows', '--tags', `headlamp-e2e-owner=${context.owner}`,
    ...(autoscaling ? ['--enable-cluster-autoscaler', '--min-count', '0', '--max-count', '1'] : [])]);
  const pool = context.az(['aks', 'nodepool', 'show', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'windows']);
  assert.equal(pool.nodeImageVersion, context.parameters.windowsNodeImageVersion, 'Windows image pin mismatch');
  await context.poll(() => {
    const nodes = JSON.parse(context.run(['get', 'nodes', '-l', 'agentpool=windows', '-o', 'json']));
    return nodes.items.length === 1 && nodes.items[0].status.conditions.some((condition: any) => condition.type === 'Ready' && condition.status === 'True');
  }, 'Windows pool readiness');
  context.save('windows-pool', pool); return pool;
}

export function windowsPod(context: AksCaseContext, name: string) {
  return { apiVersion: 'v1', kind: 'Pod', metadata: metadata(context, name),
    spec: { nodeSelector: { 'kubernetes.io/os': 'windows', agentpool: 'windows' }, automountServiceAccountToken: false, restartPolicy: 'Never',
      containers: [{ name: 'probe', image: context.parameters.windowsProbeImage,
        command: ['powershell.exe', '-NoLogo', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 3600'],
        resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '500m', memory: '256Mi' } } }],
    },
  };
}

const httpServer = '$listener = New-Object System.Net.HttpListener; $listener.Prefixes.Add("http://+:8080/"); $listener.Start(); while ($listener.IsListening) { $request = $listener.GetContext(); $body = [System.Text.Encoding]::UTF8.GetBytes("owned-windows-backend"); $request.Response.ContentLength64 = $body.Length; $request.Response.OutputStream.Write($body,0,$body.Length); $request.Response.Close() }';

function serverPod(context: AksCaseContext, name: string) {
  const pod: any = windowsPod(context, name);
  pod.metadata.labels.app = name;
  pod.spec.containers[0].command = ['powershell.exe', '-NoLogo', '-NonInteractive', '-Command', httpServer];
  pod.spec.containers[0].readinessProbe = { httpGet: { path: '/', port: 8080 }, periodSeconds: 2 };
  context.create(`${name}-pod`, pod);
}

const duplicateSubPath: AksEndToEndCase = {
  windows: true, validate: validateWindows,
  async run(context) {
    await windowsPool(context);
    context.create('configuration', { apiVersion: 'v1', kind: 'ConfigMap', metadata: metadata(context, 'configuration'), data: { first: 'sentinel-one', second: 'sentinel-two' } });
    const workload = (name: string, duplicate: boolean) => {
      const pod: any = windowsPod(context, name);
      pod.spec.volumes = [{ name: 'config', configMap: { name: 'configuration' } }];
      pod.spec.containers[0].volumeMounts = [{ name: 'config', mountPath: 'C:\\research\\first', subPath: 'first' },
        ...(duplicate ? [{ name: 'config', mountPath: 'C:\\research\\second', subPath: 'second' }] : [])];
      return pod;
    };
    const remove = (name: string) => context.kube(namespaced(context, ['delete', 'pod', name, '--wait=true', '--timeout=60s']));
    const absent = (name: string) => context.run(namespaced(context, ['get', 'pod', name, '--ignore-not-found', '-o', 'name'])).trim() === '';
    await context.phase('baseline', async () => {
      context.create('control-pod', workload('control', false)); await readyPod(context, 'control');
      const content = context.run(namespaced(context, ['exec', 'control', '--', 'powershell.exe', '-NoLogo', '-NonInteractive', '-Command', 'Get-Content C:\\research\\first']));
      assert.equal(content.trim(), 'sentinel-one'); assert.equal(remove('control').status, 0); assert.ok(absent('control'));
      return { content, deleted: true };
    });
    await context.phase('fault', async () => {
      context.create('fault-pod', workload('subject', true)); await readyPod(context, 'subject');
      const deletion = remove('subject'); assert.notEqual(deletion.status, 0, 'Duplicate-mount Pod deletion completed; fault not reproduced');
      const pod = context.read('pod', 'subject'); assert.ok(pod.metadata.deletionTimestamp);
      const events = objectEvents(context, pod);
      assert.ok(events.items.some((event: any) => /(?:unmount|cleanup|remove).*(?:subpath|mount)|(?:subpath|mount).*(?:denied|busy|failed)/i.test(event.message ?? '')), 'Deletion delay lacks mount-cleanup evidence');
      return { deletion, pod, events };
    });
    await context.phase('recovery', async () => {
      context.create('recovered-pod', workload('recovered', false)); await readyPod(context, 'recovered');
      assert.equal(remove('recovered').status, 0); assert.ok(absent('recovered'));
      context.az(['aks', 'nodepool', 'delete', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'windows']);
      context.run(namespaced(context, ['delete', 'pod', 'subject', '--force', '--grace-period=0', '--wait=true', '--timeout=60s']));
      assert.ok(absent('subject')); return { singleMountControlDeleted: true, affectedOwnedPoolRemoved: true };
    });
  },
};

const affinity: AksEndToEndCase = {
  windows: true, validate: validateWindows,
  async run(context) {
    await windowsPool(context); serverPod(context, 'backend');
    context.create('windows-client', windowsPod(context, 'client'));
    const linux = probePod(context, 'linux-client'); context.create('linux-client', linux);
    await readyPod(context, 'backend'); await readyPod(context, 'client'); await readyPod(context, 'linux-client');
    const backendIp = context.read('pod', 'backend').status.podIP;
    const request = (host: string) => context.kube(namespaced(context, ['exec', 'client', '--', 'powershell.exe', '-NoLogo', '-NonInteractive', '-Command',
      `(Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri 'http://${host}/').Content`]));
    const service = () => context.read('service', 'backend');
    let address = '';
    await context.phase('baseline', async () => {
      context.create('backend-service', { apiVersion: 'v1', kind: 'Service', metadata: metadata(context, 'backend'), spec: {
        selector: { app: 'backend' }, sessionAffinity: 'None', ports: [{ port: 80, targetPort: 8080 }] } });
      address = service().spec.clusterIP;
      await context.poll(() => request(address).status === 0 && request(`${backendIp}:8080`).status === 0, 'Windows Service and direct control');
      return { service: service(), direct: request(`${backendIp}:8080`), routed: request(address) };
    });
    await context.phase('fault', async () => {
      const target = service(); target.spec.sessionAffinity = 'ClientIP'; context.replace('affinity-service', target);
      await context.poll(() => request(address).status !== 0, 'Windows ClientIP affinity failure');
      const failures = [];
      for (let sample = 0; sample < 3; sample++) { const result = request(address); assert.notEqual(result.status, 0); failures.push(result); }
      assert.equal(request(`${backendIp}:8080`).status, 0);
      const linuxResult = context.kube(namespaced(context, ['exec', 'linux-client', '--', 'wget', '-q', '-T', '5', '-O', '-', `http://${address}/`]));
      assert.equal(linuxResult.status, 0); return { service: service(), failures, linuxResult };
    });
    await context.phase('recovery', async () => {
      const target = service(); target.spec.sessionAffinity = 'None'; delete target.spec.sessionAffinityConfig;
      context.replace('restored-service', target); await context.poll(() => request(address).status === 0, 'Restored Windows routing');
      return { service: service(), result: request(address) };
    });
  },
};

async function portForward(context: AksCaseContext, name: string) {
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
  const assigned = reservation.address(); assert.ok(assigned && typeof assigned !== 'string'); const port = assigned.port;
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const child = spawn('kubectl', ['--kubeconfig', context.kubeconfig, '--context', context.contextName, '-n', context.namespace,
    'port-forward', `pod/${name}`, `${port}:8080`, '--address=127.0.0.1', '--pod-running-timeout=20s'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; let startError = false;
  child.stdout.on('data', data => { stdout = (stdout + data.toString()).slice(-65536); });
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-65536); });
  child.on('error', () => { startError = true; });
  const exited = new Promise<void>(resolve => { child.once('close', () => resolve()); });
  let ok = false;
  try {
    for (let attempt = 0; attempt < 20 && !startError && child.exitCode === null; attempt++) {
      if (stdout.includes('Forwarding from')) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
          ok = response.ok && (await response.text()).trim() === 'owned-windows-backend';
        } catch {}
        if (ok || /wincat.*not found|cannot find.*wincat/i.test(stderr)) break;
      }
      await setTimeout(500);
    }
  } finally {
    child.kill('SIGTERM');
    const force = globalThis.setTimeout(() => child.kill('SIGKILL'), 2000);
    await exited; clearTimeout(force);
  }
  return { ok, stdout, stderr, startError };
}

const missingWincat: AksEndToEndCase = {
  windows: true,
  validate(parameters) { validateWindows(parameters); requiredParameter(parameters, 'recoveryKubernetesVersion', /^1\.\d+\.\d+$/); requiredParameter(parameters, 'recoveryWindowsNodeImageVersion', /^[a-zA-Z0-9._-]+$/); },
  async run(context) {
    await windowsPool(context); serverPod(context, 'backend'); context.create('client-pod', probePod(context, 'client'));
    await readyPod(context, 'backend'); await readyPod(context, 'client');
    const direct = () => context.run(namespaced(context, ['exec', 'client', '--', 'wget', '-q', '-T', '5', '-O', '-', `http://${context.read('pod', 'backend').status.podIP}:8080/`]));
    await context.phase('baseline', async () => { assert.equal(direct().trim(), 'owned-windows-backend'); return { pod: context.read('pod', 'backend'), direct: 'served' }; });
    await context.phase('fault', async () => {
      const result = await portForward(context, 'backend'); assert.equal(result.ok, false); assert.equal(result.startError, false);
      assert.match(result.stderr, /wincat.*(?:not found|cannot find)|(?:cannot find|not found).*wincat/i);
      assert.equal(direct().trim(), 'owned-windows-backend'); return result;
    });
    await context.phase('recovery', async () => {
      context.az(['aks', 'upgrade', '--resource-group', context.resourceGroup, '--name', 'research', '--kubernetes-version', context.parameters.recoveryKubernetesVersion!, '--yes']);
      context.az(['aks', 'nodepool', 'upgrade', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'windows', '--node-image-only']);
      const pool = context.az(['aks', 'nodepool', 'show', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'windows']);
      assert.equal(pool.nodeImageVersion, context.parameters.recoveryWindowsNodeImageVersion);
      context.run(namespaced(context, ['delete', 'pod', 'backend', '--ignore-not-found', '--wait=true', '--timeout=90s']));
      serverPod(context, 'backend');
      await readyPod(context, 'backend'); const result = await portForward(context, 'backend'); assert.equal(result.ok, true);
      return { pool, result };
    });
  },
};

export const aksWindowsEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c002-v1': duplicateSubPath,
  'aks-c023-v1': missingWincat,
  'aks-c069-v1': affinity,
};