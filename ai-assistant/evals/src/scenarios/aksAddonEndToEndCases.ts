import assert from 'node:assert/strict';
import { addPool, requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

const costArchitecture: AksEndToEndCase = {
  standardTier: true,
  validate(parameters) {
    requiredParameter(parameters, 'armNodeVmSize', /^Standard_[a-zA-Z0-9_]+$/);
    requiredParameter(parameters, 'costDeployment', /^[a-z0-9][a-z0-9.-]+$/);
    requiredParameter(parameters, 'costContainer', /^[a-z0-9][a-z0-9.-]+$/);
    requiredParameter(parameters, 'costImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
  },
  async run(context) {
    const deploymentName = context.parameters.costDeployment!;
    const read = () => JSON.parse(context.run(['-n', 'kube-system', 'get', 'deployment', deploymentName, '-o', 'json']));
    const pods = () => {
      const selector = Object.entries(read().spec.selector.matchLabels).map(([key, value]) => `${key}=${value}`).join(',');
      return JSON.parse(context.run(['-n', 'kube-system', 'get', 'pods', '-l', selector, '-o', 'json']));
    };
    const move = (architecture: string) => {
      const current = read(); current.spec.template.spec.nodeSelector ??= {};
      current.spec.template.spec.nodeSelector['kubernetes.io/arch'] = architecture;
      context.replace(`cost-placement-${architecture}`, current);
    };
    await context.phase('baseline', async () => {
      context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'research', '--enable-cost-analysis']);
      await context.poll(() => {
        const result = context.kube(['-n', 'kube-system', 'get', 'deployment', deploymentName, '-o', 'json']);
        return result.status === 0 && JSON.parse(result.stdout).status?.availableReplicas >= 1;
      }, 'Managed cost-analysis readiness');
      assert.equal(read().spec.template.spec.containers.find((container: any) => container.name === context.parameters.costContainer)?.image, context.parameters.costImage, 'Affected managed cost image mismatch');
      context.az(['aks', 'nodepool', 'add', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'armcost',
        '--node-vm-size', context.parameters.armNodeVmSize!, '--node-count', '1', '--mode', 'System', '--tags', `headlamp-e2e-owner=${context.owner}`]);
      const arm = JSON.parse(context.run(['get', 'nodes', '-l', 'agentpool=armcost', '-o', 'json']));
      assert.ok(arm.items.length > 0 && arm.items.every((node: any) => node.status.nodeInfo.architecture === 'arm64'));
      move('amd64'); await context.poll(() => read().status?.availableReplicas >= 1, 'AMD64 addon control');
      return { deployment: read(), pods: pods() };
    });
    await context.phase('fault', async () => {
      move('arm64'); let evidence: unknown;
      await context.poll(() => {
        for (const pod of pods().items) {
          if (!pod.spec.nodeName) continue;
          const node = JSON.parse(context.run(['get', 'node', pod.spec.nodeName, '-o', 'json']));
          if (node.status.nodeInfo.architecture !== 'arm64') continue;
          const logs = context.kube(['-n', 'kube-system', 'logs', pod.metadata.name, '-c', context.parameters.costContainer!, '--tail=50']);
          const events = JSON.parse(context.run(['-n', 'kube-system', 'get', 'events', '--field-selector', `involvedObject.uid=${pod.metadata.uid}`, '-o', 'json']));
          evidence = { deployment: read(), pod, node, logs, events }; context.save('cost-architecture-observation', evidence);
          if (/exec format error/i.test(`${logs.stdout}\n${logs.stderr}`) || events.items.some((event: any) => /exec format error/i.test(event.message ?? ''))) return true;
        }
        return false;
      }, 'Managed cost image ARM64 format error'); return evidence;
    });
    await context.phase('recovery', async () => {
      move('amd64'); await context.poll(() => read().status?.availableReplicas >= 1 && pods().items.some((pod: any) =>
        pod.spec.nodeName && pod.status.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'True') &&
        JSON.parse(context.run(['get', 'node', pod.spec.nodeName, '-o', 'json'])).status.nodeInfo.architecture === 'amd64'), 'Restored supported addon placement');
      return { deployment: read(), pods: pods(), scope: 'Owned managed deployment placement experiment, not natural managed rollout timing' };
    });
  },
};

const typhaPorts: AksEndToEndCase = {
  validate(parameters) { requiredParameter(parameters, 'typhaImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/); },
  networkPolicy: 'calico',
  async run(context) {
    await addPool(context, 'tainted', ['--node-taints', 'research=reserved:NoSchedule']);
    const read = () => JSON.parse(context.run(['-n', 'kube-system', 'get', 'deployment', 'calico-typha', '-o', 'json']));
    const setReplicas = (replicas: number) => context.run(['-n', 'kube-system', 'scale', 'deployment/calico-typha', `--replicas=${replicas}`]);
    const pods = () => JSON.parse(context.run(['-n', 'kube-system', 'get', 'pods', '-l', 'k8s-app=calico-typha', '-o', 'json']));
    await context.phase('baseline', async () => {
      const deployment = read(); assert.equal(deployment.spec.template.spec.containers[0].image, context.parameters.typhaImage);
      assert.ok(deployment.spec.template.spec.containers.some((container: any) => container.ports?.some((port: any) => port.hostPort > 0)) || deployment.spec.template.spec.hostNetwork === true, 'Reported host-port mechanism absent');
      setReplicas(1); await context.poll(() => read().status?.availableReplicas === 1, 'One Typha replica'); return { deployment: read(), pods: pods() };
    });
    await context.phase('fault', async () => {
      setReplicas(2); let evidence: unknown;
      await context.poll(() => {
        for (const pod of pods().items.filter((item: any) => item.status.phase === 'Pending')) {
          const events = JSON.parse(context.run(['-n', 'kube-system', 'get', 'events', '--field-selector', `involvedObject.uid=${pod.metadata.uid}`, '-o', 'json']));
          evidence = { pod, events, deployment: read() }; context.save('typha-scheduling-observation', evidence);
          if (events.items.some((event: any) => event.reason === 'FailedScheduling' && /free ports|requested ports|used ports/i.test(event.message ?? '') && /taint/i.test(event.message ?? ''))) return true;
        }
        return false;
      }, 'Typha host-port and taint conflict'); return evidence;
    });
    await context.phase('recovery', async () => {
      const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
      const system = cluster.agentPoolProfiles.find((item: any) => item.mode === 'System'); assert.ok(system);
      context.az(['aks', 'nodepool', 'scale', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', system.name, '--node-count', '2']);
      await context.poll(() => read().status?.availableReplicas >= 2, 'Supported Typha capacity'); return { deployment: read(), pods: pods() };
    });
  },
};

export const aksAddonEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c026-v1': costArchitecture,
  'aks-c044-v1': typhaPorts,
};