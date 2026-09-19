import assert from 'node:assert/strict';
import {
  metadata, namespaced, objectEvents, probePod, readyPod, requiredParameter,
  type AksCaseContext, type AksEndToEndCase,
} from './aksEndToEndCases.js';

function pool(context: AksCaseContext, name: string) {
  return context.az(['aks', 'nodepool', 'show', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', name]);
}

function nodes(context: AksCaseContext, name: string) {
  return JSON.parse(context.run(['get', 'nodes', '-l', `agentpool=${name}`, '-o', 'json']));
}

async function zero(context: AksCaseContext, name: string) {
  context.az(['aks', 'nodepool', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', name, '--disable-cluster-autoscaler']);
  context.az(['aks', 'nodepool', 'scale', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', name, '--node-count', '0']);
  await context.poll(() => pool(context, name).count === 0 && nodes(context, name).items.length === 0, `${name} zero nodes`);
  context.az(['aks', 'nodepool', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', name,
    '--enable-cluster-autoscaler', '--min-count', '0', '--max-count', '1']);
}

function deletePod(context: AksCaseContext, name: string) {
  context.run(namespaced(context, ['delete', 'pod', name, '--wait=true', '--timeout=90s']));
}

function noScaleEvidence(context: AksCaseContext, name: string, targetPool: string) {
  const pod = context.read('pod', name); const events = objectEvents(context, pod); const target = pool(context, targetPool);
  context.save('scale-from-zero-observation', { pod, events, pool: target });
  return pod.status?.phase === 'Pending' && target.count === 0 && events.items.some((event: any) =>
    event.reason === 'NotTriggerScaleUp' && /affinity|selector|taint|match/i.test(event.message ?? ''));
}

const armScaleFromZero: AksEndToEndCase = {
  validate(parameters) {
    requiredParameter(parameters, 'armNodeVmSize', /^Standard_[a-zA-Z0-9_]+$/);
    requiredParameter(parameters, 'armProbeImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
  },
  async run(context) {
    const cluster = () => context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
    const system = cluster().agentPoolProfiles.find((item: any) => item.mode === 'System');
    assert.ok(system?.name);
    context.az(['aks', 'nodepool', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', system.name, '--labels', 'research=shared']);
    const pod = (name: string) => {
      const item: any = probePod(context, name); item.spec.nodeSelector = { research: 'shared', 'kubernetes.io/arch': 'arm64' };
      item.spec.containers[0].image = context.parameters.armProbeImage; return item;
    };
    await context.phase('baseline', async () => {
      context.az(['aks', 'nodepool', 'add', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'arm', '--node-count', '1',
        '--node-vm-size', context.parameters.armNodeVmSize!, '--os-sku', 'Ubuntu', '--mode', 'User', '--labels', 'research=shared',
        '--enable-cluster-autoscaler', '--min-count', '0', '--max-count', '1', '--tags', `headlamp-e2e-owner=${context.owner}`]);
      context.create('arm-control', pod('control')); const workload = await readyPod(context, 'control');
      const node = JSON.parse(context.run(['get', 'node', workload.spec.nodeName, '-o', 'json'])); assert.equal(node.status.nodeInfo.architecture, 'arm64');
      deletePod(context, 'control'); return { workload, node };
    });
    await context.phase('fault', async () => {
      await zero(context, 'arm'); context.create('arm-subject', pod('subject'));
      await context.poll(() => noScaleEvidence(context, 'subject', 'arm'), 'ARM64 template mismatch from zero');
      return { pod: context.read('pod', 'subject'), pool: pool(context, 'arm'), events: objectEvents(context, context.read('pod', 'subject')) };
    });
    await context.phase('recovery', async () => {
      context.az(['aks', 'nodepool', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'arm', '--disable-cluster-autoscaler']);
      context.az(['aks', 'nodepool', 'scale', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'arm', '--node-count', '1']);
      const workload = await readyPod(context, 'subject');
      return { workload, pool: pool(context, 'arm'), recovery: 'Explicit nonzero supported capacity, not a claim that scale-from-zero was repaired' };
    });
  },
};

const runtimeClassZero: AksEndToEndCase = {
  windows: true,
  validate(parameters) {
    requiredParameter(parameters, 'windowsProbeImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
    requiredParameter(parameters, 'windowsNodeVmSize', /^Standard_[a-zA-Z0-9_]+$/);
    requiredParameter(parameters, 'windowsNodeImageVersion', /^[a-zA-Z0-9._-]+$/);
  },
  async run(context) {
    const item = (name: string, runtime: boolean) => {
      const pod: any = probePod(context, name);
      pod.spec.containers[0].image = context.parameters.windowsProbeImage;
      pod.spec.containers[0].command = ['powershell.exe', '-NoLogo', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 3600'];
      pod.spec.containers[0].securityContext = {};
      pod.spec.containers[0].resources.requests.memory = '128Mi'; pod.spec.containers[0].resources.limits.memory = '256Mi';
      if (runtime) pod.spec.runtimeClassName = 'research-windows';
      else pod.spec.nodeSelector = { 'kubernetes.io/os': 'windows', agentpool: 'windows' };
      return pod;
    };
    await context.phase('baseline', async () => {
      context.az(['aks', 'nodepool', 'add', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'windows',
        '--os-type', 'Windows', '--os-sku', 'Windows2022', '--node-count', '1', '--node-vm-size', context.parameters.windowsNodeVmSize!,
        '--enable-cluster-autoscaler', '--min-count', '0', '--max-count', '1', '--tags', `headlamp-e2e-owner=${context.owner}`]);
      assert.equal(pool(context, 'windows').nodeImageVersion, context.parameters.windowsNodeImageVersion);
      context.create('runtime-class', { apiVersion: 'node.k8s.io/v1', kind: 'RuntimeClass', metadata: { name: 'research-windows' }, handler: 'runhcs-wcow-process',
        scheduling: { nodeSelector: { 'kubernetes.io/os': 'windows', agentpool: 'windows' } } });
      context.create('runtime-warm-control', item('warm-control', true)); await readyPod(context, 'warm-control'); deletePod(context, 'warm-control');
      await zero(context, 'windows'); context.create('direct-control', item('direct-control', false));
      const control = await readyPod(context, 'direct-control'); deletePod(context, 'direct-control'); return control;
    });
    await context.phase('fault', async () => {
      await zero(context, 'windows'); context.create('runtime-subject', item('subject', true));
      await context.poll(() => noScaleEvidence(context, 'subject', 'windows'), 'RuntimeClass scale-from-zero rejection');
      return { pod: context.read('pod', 'subject'), runtimeClass: JSON.parse(context.run(['get', 'runtimeclass', 'research-windows', '-o', 'json'])), pool: pool(context, 'windows') };
    });
    await context.phase('recovery', async () => {
      deletePod(context, 'subject'); context.create('direct-recovery', item('subject', false)); return readyPod(context, 'subject');
    });
  },
};

export const aksScalingEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c046-v1': armScaleFromZero,
  'aks-c050-v1': runtimeClassZero,
};