import assert from 'node:assert/strict';
import { chartInput, installChart, available, deployment, deploymentPods, controllerLogs } from './aksChartCaseSupport.js';
import { metadata, requiredParameter, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';

const costDiskZone: AksEndToEndCase = {
  standardTier: true,
  validate(parameters) {
    for (const name of ['sourceZone', 'differentZone']) requiredParameter(parameters, name, /^[123]$/);
    assert.notEqual(parameters.sourceZone, parameters.differentZone);
    requiredParameter(parameters, 'costDeployment', /^[a-z0-9-]+$/);
    requiredParameter(parameters, 'costImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
  },
  async run(context) {
    for (const [name, zone] of [['sourcezone', context.parameters.sourceZone], ['otherzone', context.parameters.differentZone]]) context.az(['aks', 'nodepool', 'add',
      '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', name!, '--node-count', '1', '--node-vm-size', context.nodeVmSize,
      '--zones', zone!, '--mode', 'System', '--tags', `headlamp-e2e-owner=${context.owner}`]);
    context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'research', '--enable-cost-analysis']);
    const target = context.parameters.costDeployment!;
    const move = (zone: string) => { const object = deployment(context, 'kube-system', target); object.spec.template.spec.nodeSelector ??= {};
      object.spec.template.spec.nodeSelector['topology.kubernetes.io/zone'] = `${context.location}-${zone}`; context.replace(`cost-zone-${zone}`, object); };
    let volume: any;
    await context.phase('baseline', async () => {
      const object = await available(context, 'kube-system', target);
      assert.ok(object.spec.template.spec.containers.some((container: any) => container.image === context.parameters.costImage));
      const reference = object.spec.template.spec.volumes.find((item: any) => item.persistentVolumeClaim); assert.ok(reference);
      const pvc = JSON.parse(context.run(['-n', 'kube-system', 'get', 'pvc', reference.persistentVolumeClaim.claimName, '-o', 'json']));
      volume = JSON.parse(context.run(['get', 'pv', pvc.spec.volumeName, '-o', 'json']));
      const disk = context.az(['disk', 'show', '--ids', volume.spec.csi.volumeHandle]); assert.match(disk.sku.name, /LRS$/); assert.deepEqual(disk.zones, [context.parameters.sourceZone]);
      move(context.parameters.sourceZone!); await available(context, 'kube-system', target); return { deployment: object, volume, disk };
    });
    await context.phase('fault', async () => {
      move(context.parameters.differentZone!); let observed: unknown;
      await context.poll(() => {
        const pods = deploymentPods(context, 'kube-system', target); const events = JSON.parse(context.run(['-n', 'kube-system', 'get', 'events', '-o', 'json']));
        observed = { pods, events, volume }; context.save('cost-disk-zone-failure', observed);
        const uids = new Set(pods.items.map((pod: any) => pod.metadata.uid));
        return events.items.some((event: any) => uids.has(event.involvedObject?.uid) && /FailedAttachVolume|FailedMount/.test(event.reason ?? '') && /zone/i.test(event.message ?? ''));
      }, 'Actual addon disk-zone attachment error, not scheduler-only mismatch'); return observed;
    });
    await context.phase('recovery', async () => { move(context.parameters.sourceZone!); return available(context, 'kube-system', target); });
  },
};

const managedMeshImage: AksEndToEndCase = {
  networkDataplane: 'cilium',
  validate(parameters) {
    requiredParameter(parameters, 'affectedRevision', /^asm-\d+-\d+$/); requiredParameter(parameters, 'recoveryRevision', /^asm-\d+-\d+$/);
    chartInput(parameters, 'gatewayApiChart');
  },
  async run(context) {
    installChart(context, 'gateway-api', 'gatewayApiChart', 'gateway-api-system', {});
    const configure = (revision: string) => context.az(['aks', 'mesh', 'enable', '--resource-group', context.resourceGroup, '--name', 'research', '--revision', revision]);
    const pods = () => JSON.parse(context.run(['-n', context.namespace, 'get', 'pods', '-l', 'gateway.networking.k8s.io/gateway-name=mesh-gateway', '-o', 'json']));
    const gateway = () => context.read('gateway', 'mesh-gateway');
    const applyGateway = (revision: string, replace: boolean) => {
      const object = replace ? gateway() : { apiVersion: 'gateway.networking.k8s.io/v1', kind: 'Gateway', metadata: metadata(context, 'mesh-gateway'), spec: { gatewayClassName: 'istio', listeners: [{ name: 'http', port: 80, protocol: 'HTTP' }] } };
      object.metadata.labels ??= {}; object.metadata.labels['istio.io/rev'] = revision;
      if (replace) context.replace(`mesh-${revision}`, object); else context.create('mesh-gateway', object);
    };
    const healthy = async () => { await context.poll(() => pods().items.some((pod: any) => pod.status?.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'True')), 'Managed Gateway generated Pod ready'); return { gateway: gateway(), pods: pods() }; };
    await context.phase('baseline', async () => { configure(context.parameters.recoveryRevision!); applyGateway(context.parameters.recoveryRevision!, false); return healthy(); });
    await context.phase('fault', async () => {
      configure(context.parameters.affectedRevision!); applyGateway(context.parameters.affectedRevision!, true); let evidence: any;
      await context.poll(() => { evidence = pods(); context.save('mesh-image-error', evidence); return evidence.items.some((pod: any) =>
        pod.status?.containerStatuses?.some((container: any) => ['InvalidImageName', 'ImagePullBackOff', 'ErrImagePull'].includes(container.state?.waiting?.reason))); }, 'Generated invalid proxy image');
      return { gateway: gateway(), pods: evidence };
    });
    await context.phase('recovery', async () => { applyGateway(context.parameters.recoveryRevision!, true); return healthy(); });
  },
};

const appRoutingMissingApi: AksEndToEndCase = {
  validate(parameters) {
    chartInput(parameters, 'gatewayApiChart'); requiredParameter(parameters, 'operatorDeployment', /^[a-z0-9-]+$/);
  },
  async run(context) {
    context.az(['aks', 'approuting', 'enable', '--resource-group', context.resourceGroup, '--name', 'research']);
    const name = context.parameters.operatorDeployment!;
    await context.phase('baseline', async () => {
      installChart(context, 'gateway-api', 'gatewayApiChart', 'gateway-api-system', {});
      return available(context, 'app-routing-system', name);
    });
    await context.phase('fault', async () => {
      const crds = JSON.parse(context.run(['get', 'crds', '-o', 'json'])).items.filter((crd: any) => crd.spec.group === 'gateway.networking.k8s.io');
      assert.ok(crds.length > 0); context.save('owned-gateway-crds', crds);
      for (const crd of crds) context.run(['delete', 'crd', crd.metadata.name, '--wait=true', '--timeout=90s']);
      context.run(['-n', 'app-routing-system', 'rollout', 'restart', `deployment/${name}`]); let evidence: unknown;
      await context.poll(() => {
        const pods = deploymentPods(context, 'app-routing-system', name); const logs = controllerLogs(context, 'app-routing-system', name);
        evidence = { pods, logs }; context.save('missing-gateway-api', evidence);
        return /gateway.networking.k8s.io/.test(logs.stdout + logs.stderr) && /no matches|could not find|failed to list/i.test(logs.stdout + logs.stderr) &&
          pods.items.some((pod: any) => pod.status?.containerStatuses?.some((container: any) => container.restartCount > 0));
      }, 'Operator crash with missing Gateway API dependency'); return evidence;
    });
    await context.phase('recovery', async () => {
      installChart(context, 'gateway-api', 'gatewayApiChart', 'gateway-api-system', {}); context.run(['-n', 'app-routing-system', 'rollout', 'restart', `deployment/${name}`]);
      return available(context, 'app-routing-system', name);
    });
  },
};

export const aksManagedStartupEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c005-v1': costDiskZone,
  'aks-c041-v1': managedMeshImage,
  'aks-c063-v1': appRoutingMissingApi,
};