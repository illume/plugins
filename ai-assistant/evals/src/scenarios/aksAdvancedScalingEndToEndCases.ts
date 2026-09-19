import assert from 'node:assert/strict';
import { chartInput, installChart } from './aksChartCaseSupport.js';
import { metadata, namespaced, probePod, readyPod, requiredParameter, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';

function pool(context: AksCaseContext, name: string) {
  return context.az(['aks', 'nodepool', 'show', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', name]);
}

function autoscalerLogs(context: AksCaseContext) {
  const resource = context.clusterId;
  const workspace = context.az(['monitor', 'log-analytics', 'workspace', 'show', '--resource-group', context.resourceGroup, '--workspace-name', 'autoscaler']);
  return context.az(['monitor', 'log-analytics', 'query', '--workspace', workspace.customerId, '--analytics-query',
    `AKSControlPlane | where TimeGenerated > ago(20m) | where _ResourceId =~ '${resource}' | where Category == 'cluster-autoscaler' | project TimeGenerated,Message | take 200`]);
}

function captureAutoscaler(context: AksCaseContext) {
  const workspace = context.az(['monitor', 'log-analytics', 'workspace', 'create', '--resource-group', context.resourceGroup, '--workspace-name', 'autoscaler', '--location', context.location,
    '--retention-time', '30', '--tags', `headlamp-e2e-owner=${context.owner}`]);
  context.az(['monitor', 'diagnostic-settings', 'create', '--name', 'autoscaler', '--resource', context.clusterId, '--workspace', workspace.id,
    '--export-to-resource-specific', 'true', '--logs', JSON.stringify([{ category: 'cluster-autoscaler', enabled: true }])]);
}

const topologyScaleIn: AksEndToEndCase = {
  validate(parameters) { requiredParameter(parameters, 'autoscalerImageVersion', /^1\.\d+\.\d+$/); },
  async run(context) {
    assert.equal(context.kubernetesVersion, context.parameters.autoscalerImageVersion);
    captureAutoscaler(context);
    context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'research', '--cluster-autoscaler-profile',
      'scale-down-delay-after-add=1m', 'scale-down-unneeded-time=1m', 'scan-interval=10s']);
    context.az(['aks', 'nodepool', 'add', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'spread',
      '--node-count', '3', '--node-vm-size', context.nodeVmSize, '--enable-cluster-autoscaler', '--min-count', '3', '--max-count', '3',
      '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const base: any = probePod(context, 'template'); base.spec.restartPolicy = 'Always'; base.spec.nodeSelector = { agentpool: 'spread' };
    base.spec.topologySpreadConstraints = [{ topologyKey: 'kubernetes.io/hostname', maxSkew: 1, minDomains: 3, whenUnsatisfiable: 'DoNotSchedule', labelSelector: { matchLabels: { app: 'spread' } }, matchLabelKeys: ['pod-template-hash'] }];
    const deployment = () => context.read('deployment', 'spread');
    const pods = () => JSON.parse(context.run(namespaced(context, ['get', 'pods', '-l', 'app=spread', '-o', 'json'])));
    await context.phase('baseline', async () => {
      context.create('spread-deployment', { apiVersion: 'apps/v1', kind: 'Deployment', metadata: metadata(context, 'spread'), spec: {
        replicas: 3, selector: { matchLabels: { app: 'spread' } }, template: { metadata: { labels: { app: 'spread' } }, spec: base.spec } } });
      context.run(namespaced(context, ['rollout', 'status', 'deployment/spread', '--timeout=180s']));
      const workloads = pods(); assert.equal(new Set(workloads.items.map((pod: any) => pod.spec.nodeName)).size, 3);
      return { deployment: deployment(), pods: workloads, pool: pool(context, 'spread') };
    });
    await context.phase('fault', async () => {
      context.az(['aks', 'nodepool', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'spread', '--update-cluster-autoscaler', '--min-count', '1', '--max-count', '3']);
      let logs: any;
      await context.poll(() => { logs = autoscalerLogs(context); context.save('spread-scale-in-logs', logs); return JSON.stringify(logs).includes('spread') && /cannot.*reschedul|no.place.to.move|cannot.be.removed/i.test(JSON.stringify(logs)); }, 'Topology-constrained scale-in decision');
      assert.equal(pool(context, 'spread').count, 3); return { logs, pods: pods(), pool: pool(context, 'spread') };
    });
    await context.phase('recovery', async () => {
      const target = deployment(); target.spec.template.spec.topologySpreadConstraints[0].minDomains = 1;
      context.replace('relaxed-spread', target); context.run(namespaced(context, ['rollout', 'status', 'deployment/spread', '--timeout=180s']));
      await context.poll(() => pool(context, 'spread').count < 3, 'Permitted autoscaler scale-in');
      assert.equal(deployment().status.availableReplicas, 3); return { pool: pool(context, 'spread'), deployment: deployment(), pods: pods() };
    });
  },
};

const deallocatedThreshold: AksEndToEndCase = {
  validate() {},
  async run(context) {
    captureAutoscaler(context);
    context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'research', '--cluster-autoscaler-profile',
      'scale-down-delay-after-add=1m', 'scale-down-unneeded-time=1m', 'max-total-unready-percentage=0', 'ok-total-unready-count=0']);
    context.az(['aks', 'nodepool', 'add', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'deallocate', '--node-count', '2',
      '--node-vm-size', context.nodeVmSize, '--scale-down-mode', 'Deallocate', '--enable-cluster-autoscaler', '--min-count', '2', '--max-count', '2', '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const make = (name: string) => { const pod: any = probePod(context, name); pod.spec.nodeSelector = { agentpool: 'deallocate' }; return pod; };
    const vmStates = () => {
      const sets = context.az(['vmss', 'list', '--resource-group', context.nodeResourceGroup]);
      const set = sets.find((item: any) => item.tags?.['aks-managed-poolName'] === 'deallocate'); assert.ok(set);
      return context.az(['vmss', 'list-instances', '--resource-group', context.nodeResourceGroup, '--name', set.name, '--expand', 'instanceView']);
    };
    await context.phase('baseline', async () => { context.create('control-pod', make('control')); const pod = await readyPod(context, 'control');
      context.run(namespaced(context, ['delete', 'pod', 'control', '--wait=true', '--timeout=90s'])); return { pod, pool: pool(context, 'deallocate') }; });
    await context.phase('fault', async () => {
      context.az(['aks', 'nodepool', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'deallocate', '--update-cluster-autoscaler', '--min-count', '0', '--max-count', '2']);
      await context.poll(() => vmStates().some((instance: any) => instance.instanceView?.statuses?.some((status: any) => status.code === 'PowerState/deallocated')), 'Actual autoscaler deallocation');
      context.create('subject-pod', make('subject')); let logs: any;
      await context.poll(() => { logs = autoscalerLogs(context); context.save('deallocation-backoff', logs); return /unready|unhealthy/i.test(JSON.stringify(logs)) && /too many|backoff|not.*scale/i.test(JSON.stringify(logs)) && context.read('pod', 'subject').status.phase === 'Pending'; }, 'Unready threshold blocks pending demand');
      return { logs, instances: vmStates(), pod: context.read('pod', 'subject') };
    });
    await context.phase('recovery', async () => {
      context.az(['aks', 'nodepool', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'deallocate', '--disable-cluster-autoscaler']);
      context.az(['aks', 'nodepool', 'scale', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'deallocate', '--node-count', '2']);
      const pod = await readyPod(context, 'subject');
      context.az(['aks', 'nodepool', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'deallocate', '--scale-down-mode', 'Delete']);
      return { pod, pool: pool(context, 'deallocate'), recovery: 'Supported restored capacity and Delete mode, not retroactive health of deallocated nodes' };
    });
  },
};

const gpuTimeSlicing: AksEndToEndCase = {
  validate(parameters) {
    chartInput(parameters, 'gpuPlugin'); requiredParameter(parameters, 'gpuNodeVmSize', /^Standard_N[a-zA-Z0-9_]+$/);
    requiredParameter(parameters, 'gpuProbeImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
    requiredParameter(parameters, 'gpuNodeCeiling', /^2$/);
  },
  async run(context) {
    installChart(context, 'gpu-plugin', 'gpuPlugin', 'gpu-system', { nodeSelector: { agentpool: 'gpu' }, tolerations: [{ operator: 'Exists' }],
      config: { map: { research: 'version: v1\nsharing:\n  timeSlicing:\n    resources:\n    - name: nvidia.com/gpu\n      replicas: 4\n' }, default: 'research' } }, false);
    context.az(['aks', 'nodepool', 'add', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'gpu', '--node-count', '1',
      '--node-vm-size', context.parameters.gpuNodeVmSize!, '--enable-cluster-autoscaler', '--min-count', '0', '--max-count', '2', '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const nodes = () => JSON.parse(context.run(['get', 'nodes', '-l', 'agentpool=gpu', '-o', 'json']));
    const pods = () => JSON.parse(context.run(namespaced(context, ['get', 'pods', '-l', 'app=gpu-demand', '-o', 'json'])));
    const workload = (name: string) => { const pod: any = probePod(context, name); pod.metadata.labels.app = 'gpu-demand'; pod.spec.nodeSelector = { agentpool: 'gpu' };
      pod.spec.containers[0].image = context.parameters.gpuProbeImage; pod.spec.containers[0].resources.limits['nvidia.com/gpu'] = '1'; return pod; };
    await context.phase('baseline', async () => {
      await context.poll(() => nodes().items.some((node: any) => Number(node.status.allocatable['nvidia.com/gpu']) >= 4), 'Four advertised GPU slices');
      for (const name of ['control-one', 'control-two']) { context.create(name, workload(name)); await readyPod(context, name); }
      const evidence = pods(); assert.equal(new Set(evidence.items.map((pod: any) => pod.spec.nodeName)).size, 1);
      for (const name of ['control-one', 'control-two']) context.run(namespaced(context, ['delete', 'pod', name, '--wait=true', '--timeout=90s'])); return evidence;
    });
    await context.phase('fault', async () => {
      context.az(['aks', 'nodepool', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'gpu', '--disable-cluster-autoscaler']);
      context.az(['aks', 'nodepool', 'scale', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'gpu', '--node-count', '0']);
      context.az(['aks', 'nodepool', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'gpu', '--enable-cluster-autoscaler', '--min-count', '0', '--max-count', '2']);
      context.create('subject-one', workload('subject-one')); context.create('subject-two', workload('subject-two'));
      await context.poll(() => pool(context, 'gpu').count === 2, 'Extra node requested before shared capacity registered');
      await readyPod(context, 'subject-one'); await readyPod(context, 'subject-two');
      const actual = nodes(); assert.ok(actual.items.every((node: any) => Number(node.status.allocatable['nvidia.com/gpu']) >= 4));
      return { nodes: actual, pods: pods(), pool: pool(context, 'gpu'), demand: 2, demonstratedSingleNodeCapacity: 4 };
    });
    await context.phase('recovery', async () => {
      for (const name of ['subject-one', 'subject-two']) context.run(namespaced(context, ['delete', 'pod', name, '--wait=true', '--timeout=90s']));
      context.az(['aks', 'nodepool', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'gpu', '--disable-cluster-autoscaler']);
      context.az(['aks', 'nodepool', 'scale', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'gpu', '--node-count', '1']);
      for (const name of ['recovered-one', 'recovered-two']) { context.create(name, workload(name)); await readyPod(context, name); }
      assert.equal(pool(context, 'gpu').count, 1); return { nodes: nodes(), pods: pods(), scope: 'Warm single-node shared capacity workaround, not fixed scale-from-zero estimation' };
    });
  },
};

export const aksAdvancedScalingEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c042-v1': deallocatedThreshold,
  'aks-c043-v1': gpuTimeSlicing,
  'aks-c045-v1': topologyScaleIn,
};