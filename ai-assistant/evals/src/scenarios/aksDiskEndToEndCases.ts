import assert from 'node:assert/strict';
import {
  metadata, namespaced, objectEvents, probePod, readyPod, requiredParameter,
  type AksCaseContext, type AksEndToEndCase,
} from './aksEndToEndCases.js';

function storageClass(context: AksCaseContext, name: string, parameters: Record<string, string>) {
  context.create(`class-${name}`, {
    apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass',
    metadata: { name, labels: { 'headlamp-e2e-owner': context.owner } },
    provisioner: 'disk.csi.azure.com', parameters, reclaimPolicy: 'Delete',
    volumeBindingMode: 'Immediate', allowVolumeExpansion: true,
  });
}

function claim(context: AksCaseContext, name: string, className: string, source?: Record<string, string>) {
  context.create(`claim-${name}`, {
    apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(context, name),
    spec: { accessModes: ['ReadWriteOnce'], volumeMode: 'Filesystem', storageClassName: className,
      resources: { requests: { storage: '4Gi' } }, ...(source ? { dataSource: source } : {}) },
  });
}

function consumer(context: AksCaseContext, name: string, volume: string, write = false, pool?: string) {
  const pod: any = probePod(context, name);
  pod.spec.securityContext = { runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000 };
  if (pool) pod.spec.nodeSelector = { agentpool: pool };
  pod.spec.containers[0].command = ['sh', '-c', `${write ? 'printf "owned-disk-sentinel\\n" > /data/sentinel && ' : ''}exec tail -f /dev/null`];
  pod.spec.containers[0].volumeMounts = [{ name: 'data', mountPath: '/data' }];
  pod.spec.volumes = [{ name: 'data', persistentVolumeClaim: { claimName: volume } }];
  context.create(`pod-${name}`, pod);
}

async function mounted(context: AksCaseContext, name: string) {
  const pod = await readyPod(context, name);
  assert.equal(context.run(namespaced(context, ['exec', name, '--', 'cat', '/data/sentinel'])).trim(), 'owned-disk-sentinel');
  return pod;
}

async function bound(context: AksCaseContext, name: string) {
  await context.poll(() => context.read('pvc', name).status?.phase === 'Bound', `${name} bound`);
  const pvc = context.read('pvc', name);
  const pv = JSON.parse(context.run(['get', 'pv', pvc.spec.volumeName, '-o', 'json']));
  assert.equal(pv.spec.csi?.driver, 'disk.csi.azure.com');
  assert.ok(pv.spec.csi.volumeHandle.toLowerCase().startsWith(`/subscriptions/${context.subscription}/resourcegroups/${context.nodeResourceGroup}/`.toLowerCase()) ||
    pv.spec.csi.volumeHandle.toLowerCase().startsWith(`/subscriptions/${context.subscription}/resourcegroups/${context.resourceGroup}/`.toLowerCase()), 'Disk must be in a trial-owned group');
  return { pvc, pv, disk: context.az(['disk', 'show', '--ids', pv.spec.csi.volumeHandle]) };
}

async function rejected(context: AksCaseContext, name: string, pattern: RegExp) {
  let captured: unknown;
  await context.poll(() => {
    const pvc = context.read('pvc', name);
    const events = objectEvents(context, pvc);
    captured = { pvc, events };
    context.save(`${name}-pending`, captured);
    return pvc.status?.phase === 'Pending' && events.items.some((event: any) =>
      event.reason === 'ProvisioningFailed' && pattern.test(event.message ?? ''));
  }, `${name} source-specific provisioning rejection`);
  return captured;
}

async function detach(context: AksCaseContext, podName: string, diskId: string) {
  context.run(namespaced(context, ['delete', 'pod', podName, '--wait=true', '--timeout=120s']));
  await context.poll(() => !context.az(['disk', 'show', '--ids', diskId]).managedBy, 'Source disk detach');
}

function snapshotClass(context: AksCaseContext) {
  context.create('snapshot-class', {
    apiVersion: 'snapshot.storage.k8s.io/v1', kind: 'VolumeSnapshotClass',
    metadata: { name: 'research-snapshots', labels: { 'headlamp-e2e-owner': context.owner } },
    driver: 'disk.csi.azure.com', deletionPolicy: 'Delete',
  });
}

async function takeSnapshot(context: AksCaseContext, name: string, pvc: string) {
  context.create(`snapshot-${name}`, {
    apiVersion: 'snapshot.storage.k8s.io/v1', kind: 'VolumeSnapshot', metadata: metadata(context, name),
    spec: { volumeSnapshotClassName: 'research-snapshots', source: { persistentVolumeClaimName: pvc } },
  });
  await context.poll(() => context.read('volumesnapshot', name).status?.readyToUse === true, 'Snapshot ready');
  return context.read('volumesnapshot', name);
}

const detachedExpansion: AksEndToEndCase = {
  requiresDiskDriver: true,
  validate() {},
  async run(context) {
    let source: Awaited<ReturnType<typeof bound>>;
    const resize = (name: string, size: string) => {
      const pvc = context.read('pvc', name);
      pvc.spec.resources.requests.storage = size;
      context.replace(`resize-${name}`, pvc);
    };
    const sizes = (name: string, id: string) => ({
      pvc: context.read('pvc', name),
      pv: JSON.parse(context.run(['get', 'pv', context.read('pvc', name).spec.volumeName, '-o', 'json'])),
      disk: context.az(['disk', 'show', '--ids', id]),
    });
    await context.phase('baseline', async () => {
      storageClass(context, 'research-disk', { skuName: 'Standard_LRS', fsType: 'ext4' });
      for (const name of ['control', 'subject']) { claim(context, name, 'research-disk'); consumer(context, name, name, true); await mounted(context, name); }
      source = await bound(context, 'subject');
      const control = await bound(context, 'control');
      resize('control', '8Gi');
      await context.poll(() => {
        const state = sizes('control', control.disk.id);
        return state.pvc.status?.capacity?.storage === '8Gi' && state.pv.spec.capacity.storage === '8Gi' && state.disk.diskSizeGb === 8;
      }, 'Attached expansion control');
      return { control: sizes('control', control.disk.id), source, mounted: await mounted(context, 'control') };
    });
    await context.phase('fault', async () => {
      await detach(context, 'subject', source!.disk.id);
      resize('subject', '8Gi');
      await context.poll(() => context.az(['disk', 'show', '--ids', source!.disk.id]).diskSizeGb === 8, 'First detached provider expansion');
      resize('subject', '12Gi');
      await context.poll(() => {
        const state = sizes('subject', source!.disk.id);
        context.save('detached-resize-observation', state);
        const events = objectEvents(context, state.pvc);
        context.save('detached-resize-events', events);
        return state.pvc.spec.resources.requests.storage === '12Gi' &&
          state.pvc.status?.capacity?.storage !== '12Gi' && events.items.some((event: any) =>
            /expand|resiz/i.test(event.reason ?? '') && /fail|error|invalid/i.test(event.message ?? ''));
      }, 'Repeated detached expansion error');
      return sizes('subject', source!.disk.id);
    });
    await context.phase('recovery', async () => {
      consumer(context, 'subject', 'subject');
      await mounted(context, 'subject');
      await context.poll(() => {
        const state = sizes('subject', source!.disk.id);
        return state.pvc.status?.capacity?.storage === '12Gi' && state.pv.spec.capacity.storage === '12Gi' && state.disk.diskSizeGb === 12;
      }, 'Mounted expansion convergence');
      const filesystem = context.run(namespaced(context, ['exec', 'subject', '--', 'df', '-k', '/data']));
      const row = filesystem.trim().split('\n').at(-1)!.trim().split(/\s+/);
      assert.ok(Number(row[1]) > 11 * 1024 * 1024, 'Filesystem did not reach expanded capacity');
      return { ...sizes('subject', source!.disk.id), filesystem, sentinel: 'preserved' };
    });
  },
};

const zonalClone: AksEndToEndCase = {
  requiresDiskDriver: true,
  validate(parameters) {
    requiredParameter(parameters, 'sourceZone', /^[123]$/);
    requiredParameter(parameters, 'destinationZone', /^[123]$/);
    assert.notEqual(parameters.sourceZone, parameters.destinationZone);
  },
  async run(context) {
    let source: Awaited<ReturnType<typeof bound>>;
    const clone = (name: string, className: string) => claim(context, name, className, { apiGroup: '', kind: 'PersistentVolumeClaim', name: 'source' });
    await context.phase('baseline', async () => {
      context.az(['aks', 'nodepool', 'add', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'sourcezone',
        '--node-count', '1', '--node-vm-size', context.nodeVmSize, '--zones', context.parameters.sourceZone!, '--tags', `headlamp-e2e-owner=${context.owner}`]);
      storageClass(context, 'source-zone', { skuName: 'StandardSSD_LRS', zone: context.parameters.sourceZone! });
      storageClass(context, 'different-zone', { skuName: 'StandardSSD_LRS', zone: context.parameters.destinationZone! });
      claim(context, 'source', 'source-zone'); consumer(context, 'source', 'source', true);
      await mounted(context, 'source'); source = await bound(context, 'source');
      assert.deepEqual(source.disk.zones, [context.parameters.sourceZone]);
      await detach(context, 'source', source.disk.id);
      clone('control', 'source-zone'); await bound(context, 'control'); consumer(context, 'control', 'control');
      return { source, control: await mounted(context, 'control') };
    });
    await context.phase('fault', async () => {
      clone('subject', 'different-zone');
      return rejected(context, 'subject', /sourceResourceId.*zone|zone.*(?:different|match|source)/i);
    });
    await context.phase('recovery', async () => {
      context.run(namespaced(context, ['delete', 'pvc', 'subject', '--wait=true', '--timeout=90s']));
      clone('subject', 'source-zone'); const volume = await bound(context, 'subject');
      assert.deepEqual(volume.disk.zones, [context.parameters.sourceZone]);
      consumer(context, 'subject', 'subject');
      return { volume, pod: await mounted(context, 'subject'), source: context.az(['disk', 'show', '--ids', source!.disk.id]) };
    });
  },
};

const importedClone: AksEndToEndCase = {
  requiresDiskDriver: true,
  validate() {},
  async run(context) {
    let importedDisk: any;
    const bindStatic = () => {
      context.create('imported-pv', {
        apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: 'imported-source', labels: { 'headlamp-e2e-owner': context.owner } },
        spec: { capacity: { storage: '4Gi' }, accessModes: ['ReadWriteOnce'], volumeMode: 'Filesystem',
          persistentVolumeReclaimPolicy: 'Retain', storageClassName: 'research-disk',
          claimRef: { namespace: context.namespace, name: 'imported-source' },
          csi: { driver: 'disk.csi.azure.com', volumeHandle: importedDisk.id, fsType: 'ext4', volumeAttributes: { cachingMode: 'None' } } },
      });
      context.create('imported-claim', { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(context, 'imported-source'),
        spec: { storageClassName: 'research-disk', volumeName: 'imported-source', accessModes: ['ReadWriteOnce'], volumeMode: 'Filesystem', resources: { requests: { storage: '4Gi' } } } });
    };
    await context.phase('baseline', async () => {
      storageClass(context, 'research-disk', { skuName: 'Standard_LRS', cachingMode: 'None' });
      claim(context, 'source', 'research-disk'); consumer(context, 'source', 'source', true);
      await mounted(context, 'source'); const volume = await bound(context, 'source');
      await detach(context, 'source', volume.disk.id);
      claim(context, 'control', 'research-disk', { apiGroup: '', kind: 'PersistentVolumeClaim', name: 'source' });
      await bound(context, 'control'); consumer(context, 'control', 'control'); await mounted(context, 'control');
      importedDisk = context.az(['disk', 'create', '--resource-group', context.resourceGroup, '--name', 'imported-source',
        '--location', context.location, '--source', volume.disk.id, '--sku', 'Standard_LRS', '--tags', `headlamp-e2e-owner=${context.owner}`]);
      bindStatic(); await bound(context, 'imported-source'); consumer(context, 'imported', 'imported-source');
      const imported = await mounted(context, 'imported'); await detach(context, 'imported', importedDisk.id);
      return { volume, importedDisk, imported };
    });
    await context.phase('fault', async () => {
      claim(context, 'subject', 'research-disk', { apiGroup: '', kind: 'PersistentVolumeClaim', name: 'imported-source' });
      return rejected(context, 'subject', /disks\/+subscriptions|sourceResourceId.*(?:invalid|malformed)/i);
    });
    await context.phase('recovery', async () => {
      context.run(namespaced(context, ['delete', 'pvc', 'subject', '--wait=true', '--timeout=90s']));
      snapshotClass(context); await takeSnapshot(context, 'imported-backup', 'imported-source');
      claim(context, 'subject', 'research-disk', { apiGroup: 'snapshot.storage.k8s.io', kind: 'VolumeSnapshot', name: 'imported-backup' });
      const volume = await bound(context, 'subject'); consumer(context, 'subject', 'subject');
      return { volume, pod: await mounted(context, 'subject'), source: context.az(['disk', 'show', '--ids', importedDisk.id]) };
    });
  },
};

const sharedBlock: AksEndToEndCase = {
  requiresDiskDriver: true,
  validate() {},
  async run(context) {
    let disk: any;
    const fixture = (name: string, complete: boolean) => {
      context.create(`${name}-pv`, { apiVersion: 'v1', kind: 'PersistentVolume',
        metadata: { name, labels: { 'headlamp-e2e-owner': context.owner } },
        spec: { capacity: { storage: '4Gi' }, accessModes: ['ReadWriteMany'], volumeMode: 'Block',
          persistentVolumeReclaimPolicy: 'Retain', storageClassName: '', claimRef: { namespace: context.namespace, name },
          csi: { driver: 'disk.csi.azure.com', volumeHandle: disk.id,
            volumeAttributes: complete ? { maxShares: '3', cachingMode: 'None', skuName: 'Premium_LRS' } : {} } } });
      context.create(`${name}-pvc`, { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(context, name),
        spec: { accessModes: ['ReadWriteMany'], volumeMode: 'Block', storageClassName: '', volumeName: name, resources: { requests: { storage: '4Gi' } } } });
      const pod: any = probePod(context, name);
      pod.spec.containers[0].volumeDevices = [{ name: 'disk', devicePath: '/dev/research' }];
      pod.spec.volumes = [{ name: 'disk', persistentVolumeClaim: { claimName: name } }];
      context.create(`${name}-pod`, pod);
    };
    const readBlock = async (name: string) => {
      const pod = await readyPod(context, name);
      const block = context.run(namespaced(context, ['exec', name, '--', 'sh', '-c', 'test -b /dev/research && dd if=/dev/research bs=512 count=1 2>/dev/null | sha256sum']));
      assert.match(block.trim(), /^[a-f0-9]{64}\s/);
      return { pod, block };
    };
    const remove = async (name: string) => {
      await detach(context, name, disk.id);
      context.run(namespaced(context, ['delete', 'pvc', name, '--wait=true', '--timeout=90s']));
      context.run(['delete', 'pv', name, '--wait=true', '--timeout=90s']);
    };
    await context.phase('baseline', async () => {
      disk = context.az(['disk', 'create', '--resource-group', context.resourceGroup, '--name', 'shared-block', '--location', context.location,
        '--size-gb', '4', '--sku', 'Premium_LRS', '--max-shares', '3', '--tags', `headlamp-e2e-owner=${context.owner}`]);
      assert.equal(disk.maxShares, 3); fixture('control', true);
      const baseline = await readBlock('control'); await remove('control'); return { disk, baseline };
    });
    await context.phase('fault', async () => {
      fixture('subject', false); let captured: unknown;
      await context.poll(() => {
        const pod = context.read('pod', 'subject'); const events = objectEvents(context, pod);
        captured = { pod, events }; context.save('block-attach-events', captured);
        return events.items.some((event: any) => /(?:MULTI_NODE_MULTI_WRITER|maxShares|access.mode).*?(?:unsupported|not supported|invalid)/i.test(event.message ?? ''));
      }, 'Shared disk missing CSI attributes'); return captured;
    });
    await context.phase('recovery', async () => { await remove('subject'); fixture('subject', true); return readBlock('subject'); });
  },
};

const remoteSnapshot: AksEndToEndCase = {
  requiresDiskDriver: true,
  validate(parameters) { requiredParameter(parameters, 'snapshotRegion', /^[a-z0-9]+$/); },
  async run(context) {
    assert.notEqual(context.parameters.snapshotRegion, context.location);
    let sourceDisk: any;
    let remote: any;
    const importSnapshot = (name: string, handle: string) => {
      context.create(`${name}-content`, { apiVersion: 'snapshot.storage.k8s.io/v1', kind: 'VolumeSnapshotContent',
        metadata: { name, labels: { 'headlamp-e2e-owner': context.owner } },
        spec: { deletionPolicy: 'Retain', driver: 'disk.csi.azure.com', source: { snapshotHandle: handle },
          volumeSnapshotRef: { name, namespace: context.namespace }, volumeSnapshotClassName: 'research-snapshots' } });
      context.create(`${name}-snapshot`, { apiVersion: 'snapshot.storage.k8s.io/v1', kind: 'VolumeSnapshot', metadata: metadata(context, name),
        spec: { volumeSnapshotClassName: 'research-snapshots', source: { volumeSnapshotContentName: name } } });
    };
    await context.phase('baseline', async () => {
      storageClass(context, 'research-disk', { skuName: 'Standard_LRS', cachingMode: 'None' }); snapshotClass(context);
      claim(context, 'source', 'research-disk'); consumer(context, 'source', 'source', true); await mounted(context, 'source');
      sourceDisk = (await bound(context, 'source')).disk;
      await detach(context, 'source', sourceDisk.id);
      await takeSnapshot(context, 'local-control', 'source');
      claim(context, 'control', 'research-disk', { apiGroup: 'snapshot.storage.k8s.io', kind: 'VolumeSnapshot', name: 'local-control' });
      await bound(context, 'control'); consumer(context, 'control', 'control'); return { sourceDisk, control: await mounted(context, 'control') };
    });
    await context.phase('fault', async () => {
      remote = context.az(['snapshot', 'create', '--resource-group', context.resourceGroup, '--name', 'remote-copy', '--location', context.parameters.snapshotRegion!,
        '--source', sourceDisk.id, '--copy-start', '--incremental', 'true', '--tags', `headlamp-e2e-owner=${context.owner}`]);
      await context.poll(() => {
        remote = context.az(['snapshot', 'show', '--resource-group', context.resourceGroup, '--name', 'remote-copy']);
        return remote.provisioningState === 'Succeeded' && (remote.completionPercent === undefined || remote.completionPercent === 100);
      }, 'Remote snapshot copy readiness');
      assert.equal(remote.location, context.parameters.snapshotRegion);
      importSnapshot('remote-source', remote.id);
      await context.poll(() => context.read('volumesnapshot', 'remote-source').status?.readyToUse === true, 'Imported remote snapshot ready');
      claim(context, 'subject', 'research-disk', { apiGroup: 'snapshot.storage.k8s.io', kind: 'VolumeSnapshot', name: 'remote-source' });
      const failure = await rejected(context, 'subject', /snapshot.*(?:not found|NotFound)|NotFound.*snapshot/i);
      const provider = context.az(['snapshot', 'show', '--ids', remote.id]); assert.equal(provider.provisioningState, 'Succeeded');
      return { failure, existingSnapshot: provider };
    });
    await context.phase('recovery', async () => {
      const local = context.az(['snapshot', 'create', '--resource-group', context.resourceGroup, '--name', 'local-copy', '--location', context.location,
        '--source', remote.id, '--copy-start', '--incremental', 'true', '--tags', `headlamp-e2e-owner=${context.owner}`]);
      await context.poll(() => {
        const status = context.az(['snapshot', 'show', '--ids', local.id]);
        return status.provisioningState === 'Succeeded' && (status.completionPercent === undefined || status.completionPercent === 100);
      }, 'Local snapshot copy readiness');
      importSnapshot('local-source', local.id);
      await context.poll(() => context.read('volumesnapshot', 'local-source').status?.readyToUse === true, 'Local imported snapshot ready');
      context.run(namespaced(context, ['delete', 'pvc', 'subject', '--wait=true', '--timeout=90s']));
      claim(context, 'subject', 'research-disk', { apiGroup: 'snapshot.storage.k8s.io', kind: 'VolumeSnapshot', name: 'local-source' });
      await bound(context, 'subject'); consumer(context, 'subject', 'subject');
      return { recovered: await mounted(context, 'subject'), copiedSnapshot: local.id, originalSnapshot: remote.id };
    });
  },
};

const premiumCaching: AksEndToEndCase = {
  requiresDiskDriver: true,
  validate(parameters) { requiredParameter(parameters, 'diskZone', /^[123]$/); },
  async run(context) {
    const attachment = (diskId: string) => {
      const scalesets = context.az(['vmss', 'list', '--resource-group', context.nodeResourceGroup]);
      for (const scaleSet of scalesets) {
        for (const instance of context.az(['vmss', 'list-instances', '--resource-group', context.nodeResourceGroup, '--name', scaleSet.name])) {
          const disk = instance.storageProfile?.dataDisks?.find((item: any) => item.managedDisk?.id?.toLowerCase() === diskId.toLowerCase());
          if (disk) return { scaleSet: scaleSet.id, instanceId: instance.instanceId, disk };
        }
      }
      return null;
    };
    await context.phase('baseline', async () => {
      context.az(['aks', 'nodepool', 'add', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'control', '--node-count', '1', '--node-vm-size', context.nodeVmSize, '--zones', context.parameters.diskZone!, '--tags', `headlamp-e2e-owner=${context.owner}`]);
      context.az(['aks', 'nodepool', 'add', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'subject', '--node-count', '1', '--node-vm-size', context.nodeVmSize, '--zones', context.parameters.diskZone!, '--tags', `headlamp-e2e-owner=${context.owner}`]);
      storageClass(context, 'premium-none', { skuName: 'PremiumV2_LRS', cachingMode: 'None', zone: context.parameters.diskZone! });
      storageClass(context, 'premium-default', { skuName: 'PremiumV2_LRS', zone: context.parameters.diskZone! });
      claim(context, 'control', 'premium-none'); consumer(context, 'control', 'control', true, 'control');
      const boundControl = await bound(context, 'control');
      const pod = await mounted(context, 'control');
      const provider = attachment(boundControl.disk.id); assert.equal(provider?.disk.caching, 'None');
      return { volume: boundControl, pod, provider };
    });
    await context.phase('fault', async () => {
      claim(context, 'first', 'premium-default'); consumer(context, 'first', 'first', true, 'subject');
      const first = await bound(context, 'first');
      await context.poll(() => attachment(first.disk.id)?.disk.caching === 'ReadOnly', 'Incorrect first Premium SSD v2 caching');
      claim(context, 'second', 'premium-none'); consumer(context, 'second', 'second', true, 'subject');
      const second = await bound(context, 'second'); let captured: unknown;
      await context.poll(() => {
        const pod = context.read('pod', 'second'); const events = objectEvents(context, pod);
        captured = { pod, events, first: attachment(first.disk.id), second }; context.save('premium-cache-observation', captured);
        return events.items.some((event: any) => /caching/i.test(event.message ?? '') && /PremiumV2|Premium SSD v2/i.test(event.message ?? '') && /not supported|unsupported|invalid/i.test(event.message ?? ''));
      }, 'Subsequent attachment rejects unsupported caching'); return captured;
    });
    await context.phase('recovery', async () => {
      for (const name of ['first', 'second']) {
        const volume = await bound(context, name); await detach(context, name, volume.disk.id);
        context.run(namespaced(context, ['delete', 'pvc', name, '--wait=true', '--timeout=90s']));
      }
      claim(context, 'recovered', 'premium-none'); consumer(context, 'recovered', 'recovered', true, 'subject'); const volume = await bound(context, 'recovered');
      const pod = await mounted(context, 'recovered'); assert.equal(attachment(volume.disk.id)?.disk.caching, 'None');
      return { volume, pod, provider: attachment(volume.disk.id), scope: 'Recreated disposable attachment with None; original disk data not claimed preserved' };
    });
  },
};

export const aksDiskEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c009-v1': importedClone,
  'aks-c086-v1': detachedExpansion,
  'aks-c087-v1': sharedBlock,
  'aks-c088-v1': zonalClone,
  'aks-c090-v1': remoteSnapshot,
  'aks-c092-v1': premiumCaching,
};