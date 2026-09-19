import assert from 'node:assert/strict';
import { filesEnvironment, staticShare, sharePod, shareReady, validateFile } from './aksFileEndToEndCases.js';
import { metadata, namespaced, requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

const snapshotDeletion: AksEndToEndCase = {
  validate(parameters) { validateFile(parameters); requiredParameter(parameters, 'recoveryKubernetesVersion', /^1\.\d+\.\d+$/); requiredParameter(parameters, 'recoveryFileDriverImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/); },
  async run(context) {
    const environment = await filesEnvironment(context); staticShare(context, 'source', environment.account);
    context.create('source-pod', sharePod(context, 'source', 'source', true)); await shareReady(context, 'source');
    const backup = context.run(namespaced(context, ['exec', 'source', '--', 'cat', '/data/sentinel']));
    assert.equal(backup.trim(), 'owned-share-sentinel'); context.save('independent-sentinel-backup', { content: backup, syntheticTestDataOnly: true });
    context.create('delete-snapshot-class', { apiVersion: 'snapshot.storage.k8s.io/v1', kind: 'VolumeSnapshotClass', metadata: { name: 'delete-snapshots' }, driver: 'file.csi.azure.com', deletionPolicy: 'Delete',
      parameters: { 'csi.storage.k8s.io/snapshotter-secret-name': 'storage-auth', 'csi.storage.k8s.io/snapshotter-secret-namespace': context.namespace } });
    const snapshots = () => context.az(['storage', 'share-rm', 'list', '--resource-group', context.resourceGroup, '--storage-account', environment.account, '--include-snapshot']);
    const take = async (name: string) => {
      context.create(`${name}-snapshot`, { apiVersion: 'snapshot.storage.k8s.io/v1', kind: 'VolumeSnapshot', metadata: metadata(context, name),
        spec: { volumeSnapshotClassName: 'delete-snapshots', source: { persistentVolumeClaimName: 'source' } } });
      await context.poll(() => context.read('volumesnapshot', name).status?.readyToUse === true, `${name} ready`); return context.read('volumesnapshot', name);
    };
    let before: any;
    await context.phase('baseline', async () => {
      const first = await take('keep'); const second = await take('subject'); before = snapshots();
      assert.ok(before.filter((share: any) => share.snapshotTime).length >= 2);
      return { first, second, provider: before, pod: await shareReady(context, 'source') };
    });
    await context.phase('fault', async () => {
      const deleting = context.kube(namespaced(context, ['delete', 'volumesnapshot', 'subject', '--wait=true', '--timeout=60s']));
      const provider = snapshots();
      const logs = context.kube(['-n', 'kube-system', 'logs', 'deployment/csi-azurefile-controller', '-c', 'azurefile', '--tail=100']);
      const shareMissing = !provider.some((share: any) => share.name === 'owned-share' && !share.snapshotTime);
      assert.ok(shareMissing || (deleting.status !== 0 && /ShareHasSnapshots|snapshots.*(?:lease|delete)|cannot delete.*share/i.test(logs.stdout + logs.stderr)), 'No share-targeted snapshot deletion failure');
      return { deleting, provider, shareMissing, relevantLog: (logs.stdout + logs.stderr).split('\n').filter(line => /snapshot|share.*delet/i.test(line)).slice(-30) };
    });
    await context.phase('recovery', async () => {
      context.az(['aks', 'upgrade', '--resource-group', context.resourceGroup, '--name', 'research', '--kubernetes-version', context.parameters.recoveryKubernetesVersion!, '--yes']);
      const driver = JSON.parse(context.run(['-n', 'kube-system', 'get', 'daemonset', 'csi-azurefile-node', '-o', 'json']));
      assert.ok(driver.spec.template.spec.containers.some((container: any) => container.image === context.parameters.recoveryFileDriverImage));
      const provider = snapshots();
      if (!provider.some((share: any) => share.name === 'owned-share' && !share.snapshotTime)) context.az(['storage', 'share-rm', 'create', '--resource-group', context.resourceGroup, '--storage-account', environment.account, '--name', 'owned-share', '--quota', '1']);
      context.run(namespaced(context, ['delete', 'pod', 'source', '--ignore-not-found', '--wait=true', '--timeout=90s']));
      context.create('source-recovery', sharePod(context, 'source', 'source', true)); await shareReady(context, 'source');
      const retained = await take('recovery-keep'); const remove = await take('recovery-delete');
      context.run(namespaced(context, ['delete', 'volumesnapshot', 'recovery-delete', '--wait=true', '--timeout=120s']));
      await shareReady(context, 'source'); assert.equal(context.read('volumesnapshot', 'recovery-keep').status.readyToUse, true);
      return { retained, removedUid: remove.metadata.uid, provider: snapshots(), recovery: 'Disposable sentinel restored from retained test backup; original snapshot contents not silently reconstructed' };
    });
  },
};

export const aksSnapshotDeleteEndToEndCases: Record<string, AksEndToEndCase> = { 'aks-c081-v1': snapshotDeletion };