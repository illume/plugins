import assert from 'node:assert/strict';
import { metadata, namespaced, objectEvents, probePod, readyPod, requiredParameter, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';
import { validateWindows, windowsPod, windowsPool } from './aksWindowsEndToEndCases.js';

const windowsClone: AksEndToEndCase = {
  requiresDiskDriver: true, windows: true, validate: validateWindows,
  async run(context) {
    await windowsPool(context);
    context.create('disk-class', { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: { name: 'windows-disk' },
      provisioner: 'disk.csi.azure.com', reclaimPolicy: 'Delete', volumeBindingMode: 'Immediate', parameters: { skuName: 'Standard_LRS', fsType: 'ntfs', cachingMode: 'None' } });
    const claim = (name: string, clone: boolean) => context.create(`${name}-claim`, { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(context, name),
      spec: { storageClassName: 'windows-disk', accessModes: ['ReadWriteOnce'], resources: { requests: { storage: '4Gi' } },
        ...(clone ? { dataSource: { kind: 'PersistentVolumeClaim', name: 'source' } } : {}) } });
    const consumer = (name: string, volume: string, write: boolean) => {
      const pod: any = windowsPod(context, name); pod.spec.volumes = [{ name: 'disk', persistentVolumeClaim: { claimName: volume } }];
      pod.spec.containers[0].volumeMounts = [{ name: 'disk', mountPath: 'C:\\data' }];
      pod.spec.containers[0].command = ['powershell.exe', '-NoLogo', '-NonInteractive', '-Command', `${write ? "Set-Content C:\\data\\sentinel 'owned-clone-data'; " : ''}Start-Sleep -Seconds 3600`];
      context.create(`${name}-pod`, pod);
    };
    const content = async (name: string) => { const pod = await readyPod(context, name);
      assert.equal(context.run(namespaced(context, ['exec', name, '--', 'powershell.exe', '-NoLogo', '-NonInteractive', '-Command', 'Get-Content C:\\data\\sentinel'])).trim(), 'owned-clone-data'); return pod; };
    let sourceId = '';
    const detach = async () => {
      context.run(namespaced(context, ['delete', 'pod', 'source', '--wait=true', '--timeout=90s']));
      await context.poll(() => !context.az(['disk', 'show', '--ids', sourceId]).managedBy, 'Windows source detach');
    };
    await context.phase('baseline', async () => {
      claim('source', false); consumer('source', 'source', true); await content('source');
      const source = context.read('pvc', 'source'); const pv = JSON.parse(context.run(['get', 'pv', source.spec.volumeName, '-o', 'json'])); sourceId = pv.spec.csi.volumeHandle;
      assert.ok(sourceId.toLowerCase().includes(`/resourcegroups/${context.nodeResourceGroup}/`.toLowerCase()));
      await detach(); claim('control', true); consumer('control', 'control', false); const control = await content('control');
      consumer('source', 'source', false); await content('source'); return { control, sourceId };
    });
    await context.phase('fault', async () => {
      assert.ok(context.az(['disk', 'show', '--ids', sourceId]).managedBy); claim('subject', true); let captured: unknown;
      await context.poll(() => { const pvc = context.read('pvc', 'subject'); const events = objectEvents(context, pvc); captured = { pvc, events, source: context.az(['disk', 'show', '--ids', sourceId]) };
        context.save('windows-clone-observation', captured); return pvc.status?.phase === 'Pending' && events.items.some((event: any) =>
          event.reason === 'ProvisioningFailed' && /(?:copy|clone|source).*?(?:attached|in use|mounted|being used)/i.test(event.message ?? ''));
      }, 'Mounted Windows source clone failure'); return captured;
    });
    await context.phase('recovery', async () => {
      await detach(); context.run(namespaced(context, ['delete', 'pvc', 'subject', '--wait=true', '--timeout=90s']));
      claim('subject', true); consumer('subject', 'subject', false); return { cloned: await content('subject'), source: context.az(['disk', 'show', '--ids', sourceId]) };
    });
  },
};

const nodeDiskLimit: AksEndToEndCase = {
  requiresDiskDriver: true,
  validate(parameters) {
    requiredParameter(parameters, 'expectedDiskLimit', /^[1-7]$/);
    requiredParameter(parameters, 'diskBudget', /^[2-8]$/);
    assert.equal(Number(parameters.diskBudget), Number(parameters.expectedDiskLimit) + 1);
  },
  async run(context) {
    const nodes = JSON.parse(context.run(['get', 'nodes', '-o', 'json'])); assert.equal(nodes.items.length, 1);
    const node = nodes.items[0]; const expected = Number(context.parameters.expectedDiskLimit);
    const capabilities = context.az(['vm', 'list-skus', '--location', context.location, '--size', context.nodeVmSize, '--all']);
    const sku = capabilities.find((item: any) => item.name === context.nodeVmSize);
    assert.equal(Number(sku?.capabilities?.find((item: any) => item.name === 'MaxDataDiskCount')?.value), expected);
    const registration = () => JSON.parse(context.run(['get', 'csinode', node.metadata.name, '-o', 'json']));
    const driver = JSON.parse(context.run(['-n', 'kube-system', 'get', 'daemonset', 'csi-azuredisk-node', '-o', 'json']));
    const container = driver.spec.template.spec.containers.find((item: any) => item.name === 'azuredisk'); assert.ok(container);
    const restoreArgs = [...container.args];
    context.create('capacity-class', { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: { name: 'capacity-disk' },
      provisioner: 'disk.csi.azure.com', reclaimPolicy: 'Delete', volumeBindingMode: 'Immediate', parameters: { skuName: 'Standard_LRS', cachingMode: 'None' } });
    const fixture = (name: string) => {
      context.create(`${name}-pvc`, { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(context, name),
        spec: { accessModes: ['ReadWriteOnce'], storageClassName: 'capacity-disk', resources: { requests: { storage: '1Gi' } } } });
      const pod: any = probePod(context, name); pod.spec.nodeSelector = { 'kubernetes.io/hostname': node.metadata.labels['kubernetes.io/hostname'] };
      pod.spec.volumes = [{ name: 'disk', persistentVolumeClaim: { claimName: name } }]; pod.spec.containers[0].volumeMounts = [{ name: 'disk', mountPath: '/data' }]; context.create(`${name}-pod`, pod);
    };
    await context.phase('baseline', async () => {
      fixture('control'); const control = await readyPod(context, 'control'); return { control, sku, csinode: registration(), driver };
    });
    await context.phase('fault', async () => {
      const actual = registration().spec.drivers.find((item: any) => item.name === 'disk.csi.azure.com');
      assert.ok(actual && actual.allocatable?.count !== expected, 'Advertised disk limit matches provider; mismatch not reproduced');
      const requestedLimit = container.args.find((arg: string) => arg.startsWith('--max-volumes-per-node='));
      assert.ok(requestedLimit && Number(requestedLimit.split('=')[1]) === expected, 'Reported driver limit mismatch precondition missing');
      for (let index = 1; index < Math.min(Number(actual.allocatable.count), expected); index++) { fixture(`disk-${index}`); await readyPod(context, `disk-${index}`); }
      fixture('boundary'); let evidence: unknown;
      await context.poll(() => {
        const pod = context.read('pod', 'boundary'); const events = objectEvents(context, pod);
        evidence = { pod, events, csinode: registration(), expected }; context.save('disk-capacity-boundary', evidence);
        return events.items.some((event: any) => /max volume count|maximum.*disk|too many.*volum|exceed.*disk/i.test(event.message ?? ''));
      }, 'Advertised/provider attachment mismatch evidence'); return evidence;
    });
    await context.phase('recovery', async () => {
      const changed = JSON.parse(context.run(['-n', 'kube-system', 'get', 'daemonset', 'csi-azuredisk-node', '-o', 'json']));
      const target = changed.spec.template.spec.containers.find((item: any) => item.name === 'azuredisk');
      target.args = restoreArgs.map((arg: string) => arg.startsWith('--max-volumes-per-node=') ? `--max-volumes-per-node=${expected}` : arg);
      context.replace('reregister-driver', changed); context.run(['-n', 'kube-system', 'rollout', 'restart', 'daemonset/csi-azuredisk-node']);
      context.run(['-n', 'kube-system', 'rollout', 'status', 'daemonset/csi-azuredisk-node', '--timeout=180s']);
      await context.poll(() => registration().spec.drivers.find((item: any) => item.name === 'disk.csi.azure.com')?.allocatable?.count === expected, 'Supported CSI re-registration');
      await readyPod(context, 'control'); return { csinode: registration(), control: context.read('pod', 'control'), scope: 'Owned driver restart and accurate advertised limit, not a new provider capacity' };
    });
  },
};

export const aksDiskCapacityEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c055-v1': windowsClone,
  'aks-c091-v1': nodeDiskLimit,
};