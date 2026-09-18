import assert from 'node:assert/strict';
import { filesEnvironment, staticShare, sharePod, shareReady, validateFile } from './aksFileEndToEndCases.js';
import { metadata, namespaced, objectEvents, probePod, readyPod, requiredParameter, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';

const cifsCipher: AksEndToEndCase = {
  validate(parameters) { validateFile(parameters); requiredParameter(parameters, 'affectedNodeImageVersion', /^[a-zA-Z0-9._-]+$/); requiredParameter(parameters, 'hostProbeImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/); },
  async run(context) {
    const environment = await filesEnvironment(context);
    context.az(['storage', 'account', 'file-service-properties', 'update', '--resource-group', context.resourceGroup, '--account-name', environment.account,
      '--channel-encryption', 'AES-256-GCM', '--versions', 'SMB3.1.1']);
    const nodes = JSON.parse(context.run(['get', 'nodes', '-o', 'json'])); assert.equal(nodes.items.length, 1); const node = nodes.items[0];
    assert.equal(node.metadata.labels['kubernetes.azure.com/node-image-version'], context.parameters.affectedNodeImageVersion);
    const host: any = probePod(context, 'kernel-control'); host.spec.nodeName = node.metadata.name;
    host.spec.containers[0].image = context.parameters.hostProbeImage; host.spec.containers[0].securityContext = { privileged: true };
    host.spec.volumes = [{ name: 'host', hostPath: { path: '/', type: 'Directory' } }]; host.spec.containers[0].volumeMounts = [{ name: 'host', mountPath: '/host' }];
    context.create('kernel-control', host); await readyPod(context, 'kernel-control');
    const kernel = (script: string) => context.run(namespaced(context, ['exec', 'kernel-control', '--', 'chroot', '/host', '/bin/sh', '-c', script]));
    kernel('modprobe cifs; test -e /sys/module/cifs/parameters/require_gcm_256; test -e /sys/module/cifs/parameters/enable_gcm_256');
    const original = kernel('cat /sys/module/cifs/parameters/require_gcm_256 /sys/module/cifs/parameters/enable_gcm_256');
    const fixture = (name: string) => {
      staticShare(context, name, environment.account); const pod: any = sharePod(context, name, name, name === 'control');
      pod.spec.nodeName = node.metadata.name; context.create(`${name}-pod`, pod);
    };
    await context.phase('baseline', async () => {
      kernel('echo Y >/sys/module/cifs/parameters/require_gcm_256; echo Y >/sys/module/cifs/parameters/enable_gcm_256');
      fixture('control'); const control = await shareReady(context, 'control');
      context.run(namespaced(context, ['delete', 'pod', 'control', '--wait=true', '--timeout=90s'])); return { control, originalKernelFlags: original };
    });
    await context.phase('fault', async () => {
      kernel('echo N >/sys/module/cifs/parameters/require_gcm_256; echo Y >/sys/module/cifs/parameters/enable_gcm_256'); fixture('subject'); let captured: unknown;
      await context.poll(() => { const pod = context.read('pod', 'subject'); const events = objectEvents(context, pod);
        captured = { pod, events, flags: kernel('cat /sys/module/cifs/parameters/require_gcm_256 /sys/module/cifs/parameters/enable_gcm_256') }; context.save('cipher-failure', captured);
        return events.items.some((event: any) => event.reason === 'FailedMount' && /permission denied|error\(13\)/i.test(event.message ?? ''));
      }, 'AES-256-only mount rejection with enable flag alone'); return captured;
    });
    await context.phase('recovery', async () => {
      kernel('echo Y >/sys/module/cifs/parameters/require_gcm_256');
      context.run(namespaced(context, ['delete', 'pod', 'subject', '--wait=true', '--timeout=90s'])); context.create('cipher-recovered', sharePod(context, 'subject', 'subject'));
      return { pod: await shareReady(context, 'subject'), policy: context.az(['storage', 'account', 'file-service-properties', 'show', '--resource-group', context.resourceGroup, '--account-name', environment.account]) };
    });
  },
};

async function snapshotFixture(context: AksCaseContext) {
  const environment = await filesEnvironment(context); staticShare(context, 'source', environment.account);
  context.create('source-pod', sharePod(context, 'source', 'source', true)); await shareReady(context, 'source');
  context.create('snapshot-class', { apiVersion: 'snapshot.storage.k8s.io/v1', kind: 'VolumeSnapshotClass', metadata: { name: 'file-snapshot' }, driver: 'file.csi.azure.com', deletionPolicy: 'Retain', parameters: {
    'csi.storage.k8s.io/snapshotter-secret-name': 'storage-auth', 'csi.storage.k8s.io/snapshotter-secret-namespace': context.namespace } });
  context.create('snapshot', { apiVersion: 'snapshot.storage.k8s.io/v1', kind: 'VolumeSnapshot', metadata: metadata(context, 'source-backup'), spec: { volumeSnapshotClassName: 'file-snapshot', source: { persistentVolumeClaimName: 'source' } } });
  await context.poll(() => context.read('volumesnapshot', 'source-backup').status?.readyToUse === true, 'Actual file snapshot');
  context.create('restore-class', { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: { name: 'restore-files' }, provisioner: 'file.csi.azure.com', reclaimPolicy: 'Delete', volumeBindingMode: 'Immediate',
    parameters: { skuName: 'Standard_LRS', resourceGroup: context.resourceGroup, storageAccount: environment.account } });
  const restore = (name: string) => context.create(`${name}-claim`, { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(context, name),
    spec: { accessModes: ['ReadWriteMany'], storageClassName: 'restore-files', resources: { requests: { storage: '1Gi' } }, dataSource: { apiGroup: 'snapshot.storage.k8s.io', kind: 'VolumeSnapshot', name: 'source-backup' } } });
  const shares = () => context.az(['storage', 'share-rm', 'list', '--resource-group', context.resourceGroup, '--storage-account', environment.account]);
  return { ...environment, restore, shares };
}

function copyNetworkCase(orphan: boolean): AksEndToEndCase {
  return {
    validate: validateFile,
    async run(context) {
      const environment = await snapshotFixture(context); let before: string[] = []; let newShare = '';
      const network = (action: 'Allow' | 'Deny') => context.az(['storage', 'account', 'update', '--resource-group', context.resourceGroup,
        '--name', environment.account, '--default-action', action, '--bypass', 'None']);
      await context.phase('baseline', async () => {
        environment.restore('control'); context.create('control-pod', sharePod(context, 'control', 'control')); const control = await shareReady(context, 'control');
        context.run(namespaced(context, ['delete', 'pod', 'control', '--wait=true', '--timeout=90s'])); context.run(namespaced(context, ['delete', 'pvc', 'control', '--wait=true', '--timeout=90s']));
        await context.poll(() => environment.shares().length === 1, 'Successful restore destination cleanup'); before = environment.shares().map((share: any) => share.name); return { control, remaining: before };
      });
      await context.phase('fault', async () => {
        if (!orphan) network('Deny');
        environment.restore('subject');
        if (orphan) {
          await context.poll(() => {
            const created = environment.shares().filter((share: any) => !before.includes(share.name));
            if (created.length !== 1) return false; newShare = created[0].name; return true;
          }, 'Destination creation before controlled copy failure');
          network('Deny');
        }
        let captured: unknown;
        await context.poll(() => {
          const pvc = context.read('pvc', 'subject'); const events = objectEvents(context, pvc);
          captured = { pvc, events, shares: environment.shares() }; context.save('copy-network-fault', captured);
          return pvc.status?.phase === 'Pending' && events.items.some((event: any) => event.reason === 'ProvisioningFailed' && /AzCopy|copy/i.test(event.message ?? '') && /AuthorizationFailure|403|denied/i.test(event.message ?? ''));
        }, 'Provider copy authorization failure');
        if (orphan) {
          context.run(namespaced(context, ['delete', 'pvc', 'subject', '--wait=true', '--timeout=90s']));
          assert.ok(environment.shares().some((share: any) => share.name === newShare));
          const pvs = JSON.parse(context.run(['get', 'pv', '-o', 'json']));
          assert.ok(!pvs.items.some((pv: any) => pv.spec.csi?.volumeAttributes?.shareName === newShare && pv.status.phase === 'Bound'));
        }
        return { evidence: captured, orphanedShare: orphan ? newShare : null, scope: 'Owned storage network restriction; no claim that a successful Azure identity login occurred unless separately captured' };
      });
      await context.phase('recovery', async () => {
        network('Allow');
        if (orphan) {
          assert.ok(newShare && !before.includes(newShare)); context.az(['storage', 'share-rm', 'delete', '--resource-group', context.resourceGroup, '--storage-account', environment.account, '--name', newShare, '--yes']);
          assert.ok(!environment.shares().some((share: any) => share.name === newShare)); environment.restore('subject');
        }
        context.create('recovery-pod', sharePod(context, 'subject', 'subject')); return { pod: await shareReady(context, 'subject'), shares: environment.shares() };
      });
    },
  };
}

export const aksFileFailureEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c071-v1': copyNetworkCase(false),
  'aks-c072-v1': cifsCipher,
  'aks-c075-v1': copyNetworkCase(true),
};