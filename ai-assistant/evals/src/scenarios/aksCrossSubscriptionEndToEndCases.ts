import assert from 'node:assert/strict';
import { metadata, namespaced, objectEvents, requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';
import { sharePod, shareReady, validateFile } from './aksFileEndToEndCases.js';

const crossSubscriptionFiles: AksEndToEndCase = {
  validate(parameters) { validateFile(parameters); requiredParameter(parameters, 'storageSubscription', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i); },
  async run(context) {
    const subscription = context.parameters.storageSubscription!;
    const resourceGroup = context.createSecondaryResourceGroup(subscription);
    const other = (args: string[]) => context.secondaryAzure(subscription, args);
    const account = `cross${context.owner.replaceAll('-', '').slice(0, 19)}`;
    const storage = other(['storage', 'account', 'create', '--resource-group', resourceGroup, '--name', account, '--location', context.location,
      '--sku', 'Standard_LRS', '--kind', 'StorageV2', '--https-only', 'true', '--allow-blob-public-access', 'false', '--tags', `headlamp-e2e-owner=${context.owner}`]);
    other(['storage', 'share-rm', 'create', '--resource-group', resourceGroup, '--storage-account', account, '--name', 'owned-share', '--quota', '1']);
    const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
    const principal = cluster.identity?.principalId; assert.ok(principal);
    for (const role of ['Reader', 'Storage Account Key Operator Service Role']) other(['role', 'assignment', 'create', '--assignee-object-id', principal, '--assignee-principal-type', 'ServicePrincipal', '--role', role, '--scope', storage.id]);
    const driver = JSON.parse(context.run(['-n', 'kube-system', 'get', 'daemonset', 'csi-azurefile-node', '-o', 'json']));
    assert.ok(driver.spec.template.spec.containers.some((container: any) => container.image === context.parameters.fileDriverImage));
    const fixture = (name: string, explicit: boolean) => {
      context.create(`${name}-pv`, { apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name, labels: { 'headlamp-e2e-owner': context.owner } },
        spec: { capacity: { storage: '1Gi' }, accessModes: ['ReadWriteMany'], persistentVolumeReclaimPolicy: 'Retain', storageClassName: '', claimRef: { namespace: context.namespace, name },
          csi: { driver: 'file.csi.azure.com', volumeHandle: `${resourceGroup}#${account}#owned-share#${name}`,
            volumeAttributes: { resourceGroup, storageAccount: account, shareName: 'owned-share', storeAccountKey: 'false', getLatestAccountKey: 'true', ...(explicit ? { subscriptionID: subscription } : {}) } } } });
      context.create(`${name}-pvc`, { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(context, name),
        spec: { accessModes: ['ReadWriteMany'], volumeName: name, storageClassName: '', resources: { requests: { storage: '1Gi' } } } });
      context.create(`${name}-pod`, sharePod(context, name, name, name === 'control'));
    };
    await context.phase('baseline', async () => { fixture('control', true); return { pod: await shareReady(context, 'control'), storageId: storage.id }; });
    await context.phase('fault', async () => {
      fixture('subject', false); let result: unknown;
      await context.poll(() => {
        const pod = context.read('pod', 'subject'); const events = objectEvents(context, pod); result = { pod, events }; context.save('wrong-subscription-mount', result);
        return events.items.some((event: any) => event.reason === 'FailedMount' && /AuthorizationFailed|ResourceNotFound/i.test(event.message ?? '') &&
          (event.message ?? '').toLowerCase().includes(context.subscription.toLowerCase()) && (event.message ?? '').includes(account));
      }, 'Driver-selected incorrect subscription scope'); await shareReady(context, 'control'); return { evidence: result, actualStorageId: storage.id };
    });
    await context.phase('recovery', async () => {
      context.run(namespaced(context, ['delete', 'pod', 'subject', '--wait=true', '--timeout=90s']));
      context.run(namespaced(context, ['delete', 'pvc', 'subject', '--wait=true', '--timeout=90s'])); context.run(['delete', 'pv', 'subject', '--wait=true', '--timeout=90s']);
      fixture('subject', true); return { pod: await shareReady(context, 'subject'), resource: other(['storage', 'account', 'show', '--resource-group', resourceGroup, '--name', account]) };
    });
  },
};

export const aksCrossSubscriptionEndToEndCases: Record<string, AksEndToEndCase> = { 'aks-c085-v1': crossSubscriptionFiles };