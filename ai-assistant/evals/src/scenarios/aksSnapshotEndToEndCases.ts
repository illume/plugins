import assert from 'node:assert/strict';
import { filesEnvironment, staticShare, sharePod, shareReady, validateFile } from './aksFileEndToEndCases.js';
import { metadata, namespaced, type AksEndToEndCase } from './aksEndToEndCases.js';

const fileSnapshotTime: AksEndToEndCase = {
  validate: validateFile,
  async run(context) {
    const { account } = await filesEnvironment(context);
    staticShare(context, 'source', account); context.create('source-pod', sharePod(context, 'source', 'source', true)); await shareReady(context, 'source');
    for (const [name, dataPlane] of [['management-snapshot', false], ['data-snapshot', true]] as const) {
      context.create(`${name}-class`, { apiVersion: 'snapshot.storage.k8s.io/v1', kind: 'VolumeSnapshotClass',
        metadata: { name, labels: { 'headlamp-e2e-owner': context.owner } },
        driver: 'file.csi.azure.com', deletionPolicy: 'Delete', parameters: { useDataPlaneAPI: String(dataPlane),
          'csi.storage.k8s.io/snapshotter-secret-name': 'storage-auth', 'csi.storage.k8s.io/snapshotter-secret-namespace': context.namespace } });
    }
    const snapshots = () => context.az(['storage', 'share-rm', 'list', '--resource-group', context.resourceGroup,
      '--storage-account', account, '--include-snapshot']);
    const take = async (name: string, className: string) => {
      const before = snapshots();
      const startedAt = Date.now();
      context.create(`${name}-snapshot`, { apiVersion: 'snapshot.storage.k8s.io/v1', kind: 'VolumeSnapshot', metadata: metadata(context, name),
        spec: { volumeSnapshotClassName: className, source: { persistentVolumeClaimName: 'source' } } });
      await context.poll(() => context.read('volumesnapshot', name).status?.readyToUse === true, `${name} snapshot readiness`);
      const object = context.read('volumesnapshot', name);
      const content = JSON.parse(context.run(['get', 'volumesnapshotcontent', object.status.boundVolumeSnapshotContentName, '-o', 'json']));
      const provider = snapshots();
      const added = provider.filter((item: any) => item.name === 'owned-share' && item.snapshotTime &&
        !before.some((previous: any) => previous.name === item.name && previous.snapshotTime === item.snapshotTime));
      assert.equal(added.length, 1, 'Snapshot provider correlation is ambiguous');
      const providerTime = Date.parse(added[0].snapshotTime);
      const kubernetesTime = Date.parse(object.status.creationTime);
      assert.ok(Number.isFinite(providerTime) && Number.isFinite(kubernetesTime));
      assert.ok(providerTime >= startedAt - 60_000 && providerTime <= Date.now() + 60_000, 'Provider snapshot creation not within the bounded request window');
      return { object, content, provider: added[0], startedAt, providerTime, kubernetesTime };
    };
    let baseline: Awaited<ReturnType<typeof take>>;
    await context.phase('baseline', async () => {
      baseline = await take('control', 'management-snapshot');
      assert.ok(Math.abs(baseline.providerTime - baseline.kubernetesTime) <= 60_000);
      return baseline;
    });
    await context.phase('fault', async () => {
      const first = await take('subject-first', 'data-snapshot');
      const second = await take('subject-second', 'data-snapshot');
      assert.ok(first.kubernetesTime < first.startedAt - 60_000 && second.kubernetesTime < second.startedAt - 60_000, 'No stale snapshot timestamp reproduced');
      assert.equal(first.kubernetesTime, second.kubernetesTime, 'Repeated old timestamp not reproduced');
      assert.notEqual(first.provider.snapshotTime, second.provider.snapshotTime);
      return { first, second };
    });
    await context.phase('recovery', async () => {
      const recovered = await take('recovered', 'management-snapshot');
      assert.ok(Math.abs(recovered.providerTime - recovered.kubernetesTime) <= 60_000);
      await shareReady(context, 'source');
      return { recovered, originalProviderSnapshot: baseline.provider, scope: 'Management-plane snapshot control; does not rewrite existing timestamp status' };
    });
  },
};

export const aksSnapshotEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c084-v1': fileSnapshotTime,
};