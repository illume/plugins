import assert from 'node:assert/strict';
import {
  metadata, namespaced, objectEvents, probePod, readyPod, requiredParameter,
  type AksCaseContext, type AksEndToEndCase,
} from './aksEndToEndCases.js';

export async function filesEnvironment(context: AksCaseContext) {
  const expected = requiredParameter(context.parameters, 'fileDriverImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
  const daemonset = JSON.parse(context.run(['-n', 'kube-system', 'get', 'daemonset', 'csi-azurefile-node', '-o', 'json']));
  assert.equal(daemonset.spec.template.spec.containers.find((container: any) => container.name === 'azurefile')?.image, expected, 'Managed file-driver image mismatch');
  context.save('file-driver', daemonset);
  const account = `hl${context.owner.replaceAll('-', '').slice(0, 22)}`;
  context.az(['storage', 'account', 'create', '--resource-group', context.resourceGroup, '--name', account,
    '--location', context.location, '--kind', 'StorageV2', '--sku', 'Standard_LRS', '--https-only', 'true',
    '--allow-blob-public-access', 'false', '--allow-cross-tenant-replication', 'false', '--min-tls-version', 'TLS1_2',
    '--tags', `headlamp-e2e-owner=${context.owner}`]);
  context.az(['storage', 'share-rm', 'create', '--resource-group', context.resourceGroup, '--storage-account', account,
    '--name', 'owned-share', '--quota', '1', '--enabled-protocols', 'SMB']);
  const setSecret = (targetNamespace = context.namespace) => {
    const keys = context.az(['storage', 'account', 'keys', 'list', '--resource-group', context.resourceGroup, '--account-name', account]);
    const key = keys.find((item: any) => item.keyName === 'key1')?.value;
    assert.ok(typeof key === 'string' && key.length > 0, 'Storage account key unavailable');
    context.createPrivate({ apiVersion: 'v1', kind: 'Secret', type: 'Opaque',
      metadata: { name: 'storage-auth', namespace: targetNamespace, labels: { 'headlamp-e2e-owner': context.owner } },
      stringData: { azurestorageaccountname: account, azurestorageaccountkey: key },
    });
  };
  setSecret();
  return { account, setSecret };
}

export function staticShare(context: AksCaseContext, name: string, account: string, folderName?: string) {
  context.create(`${name}-pv`, { apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name, labels: { 'headlamp-e2e-owner': context.owner } },
    spec: { capacity: { storage: '1Gi' }, accessModes: ['ReadWriteMany'], persistentVolumeReclaimPolicy: 'Retain', storageClassName: '',
      claimRef: { name, namespace: context.namespace },
      mountOptions: ['dir_mode=0777', 'file_mode=0666', 'uid=1000', 'gid=1000'],
      csi: { driver: 'file.csi.azure.com', volumeHandle: `${context.resourceGroup}#${account}#owned-share#${name}`,
        volumeAttributes: { resourceGroup: context.resourceGroup, storageAccount: account, shareName: 'owned-share', ...(folderName ? { folderName } : {}) },
        nodeStageSecretRef: { name: 'storage-auth', namespace: context.namespace } } },
  });
  context.create(`${name}-pvc`, { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(context, name),
    spec: { accessModes: ['ReadWriteMany'], storageClassName: '', volumeName: name, resources: { requests: { storage: '1Gi' } } },
  });
}

export function sharePod(context: AksCaseContext, name: string, pvc: string, write = false) {
  const pod: any = probePod(context, name);
  pod.spec.containers[0].command = ['sh', '-c', `${write ? 'printf "owned-share-sentinel\\n" > /data/sentinel && ' : ''}exec tail -f /dev/null`];
  pod.spec.volumes = [{ name: 'share', persistentVolumeClaim: { claimName: pvc } }];
  pod.spec.containers[0].volumeMounts = [{ name: 'share', mountPath: '/data' }];
  return pod;
}

export async function shareReady(context: AksCaseContext, name: string, file = '/data/sentinel') {
  const pod = await readyPod(context, name);
  assert.equal(context.run(namespaced(context, ['exec', name, '--', 'cat', file])).trim(), 'owned-share-sentinel');
  return pod;
}

async function mountFailure(context: AksCaseContext, name: string, message: RegExp) {
  let captured: unknown;
  await context.poll(() => {
    const pod = context.read('pod', name); const events = objectEvents(context, pod);
    captured = { pod, events }; context.save(`${name}-mount-observation`, captured);
    return !pod.status?.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'True') &&
      events.items.some((event: any) => event.reason === 'FailedMount' && message.test(event.message ?? ''));
  }, `${name} source-specific mount error`);
  return captured;
}

export function validateFile(parameters: Record<string, string>) {
  requiredParameter(parameters, 'fileDriverImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
}

const missingFolder: AksEndToEndCase = {
  validate(parameters) {
    validateFile(parameters);
    requiredParameter(parameters, 'affectedFileDriverVersion', /^v?1\.(?:[0-9]|[12][0-9]|3[0-3])\.\d+$/);
  },
  async run(context) {
    let account: string;
    await context.phase('baseline', async () => {
      account = (await filesEnvironment(context)).account;
      staticShare(context, 'root', account); context.create('root-pod', sharePod(context, 'root', 'root', true));
      await shareReady(context, 'root');
      context.run(namespaced(context, ['exec', 'root', '--', 'sh', '-c', 'mkdir /data/existing && cp /data/sentinel /data/existing/sentinel && test ! -e /data/missing']));
      staticShare(context, 'control', account, 'existing'); context.create('control-pod', sharePod(context, 'control', 'control'));
      return { root: context.read('pod', 'root'), control: await shareReady(context, 'control') };
    });
    await context.phase('fault', async () => {
      staticShare(context, 'subject', account!, 'missing'); context.create('subject-pod', sharePod(context, 'subject', 'subject'));
      const failure = await mountFailure(context, 'subject', /No such file or directory|not exist|error\(2\)/i);
      context.run(namespaced(context, ['exec', 'root', '--', 'test', '!', '-e', '/data/missing']));
      await shareReady(context, 'control'); return failure;
    });
    await context.phase('recovery', async () => {
      context.run(namespaced(context, ['exec', 'root', '--', 'sh', '-c', 'mkdir /data/missing && cp /data/sentinel /data/missing/sentinel']));
      return shareReady(context, 'subject');
    });
  },
};

const duplicateVolume: AksEndToEndCase = {
  validate: validateFile,
  async run(context) {
    await context.phase('baseline', async () => {
      const { account } = await filesEnvironment(context); staticShare(context, 'shared', account);
      context.create('baseline-pod', sharePod(context, 'baseline', 'shared', true)); return shareReady(context, 'baseline');
    });
    await context.phase('fault', async () => {
      const pod: any = sharePod(context, 'subject', 'shared');
      pod.spec.volumes.push({ name: 'duplicate', persistentVolumeClaim: { claimName: 'shared' } });
      pod.spec.containers.push({ ...structuredClone(pod.spec.containers[0]), name: 'second', volumeMounts: [{ name: 'duplicate', mountPath: '/data' }] });
      context.create('fault-pod', pod);
      let observed: any;
      await context.poll(() => {
        observed = context.read('pod', 'subject'); const events = objectEvents(context, observed);
        context.save('duplicate-mount-evidence', { pod: observed, events });
        return !observed.status?.podIP && observed.status?.containerStatuses?.some((container: any) => container.state?.waiting?.reason === 'PodInitializing') &&
          events.items.some((event: any) => /FailedMount|FailedCreatePodSandBox/.test(event.reason ?? '') && /(?:volume|mount)/i.test(event.message ?? ''));
      }, 'Duplicate-volume initialization stall');
      await shareReady(context, 'baseline'); return observed;
    });
    await context.phase('recovery', async () => {
      context.run(namespaced(context, ['delete', 'pod', 'subject', '--wait=true', '--timeout=90s']));
      const pod: any = sharePod(context, 'subject', 'shared');
      pod.spec.containers.push({ ...structuredClone(pod.spec.containers[0]), name: 'second' });
      context.create('recovery-pod', pod); const recovered = await shareReady(context, 'subject');
      assert.equal(context.run(namespaced(context, ['exec', 'subject', '-c', 'second', '--', 'cat', '/data/sentinel'])).trim(), 'owned-share-sentinel');
      return recovered;
    });
  },
};

function inlinePod(context: AksCaseContext, name: string, attributes: Record<string, string>) {
  const pod: any = probePod(context, name);
  pod.spec.volumes = [{ name: 'share', csi: { driver: 'file.csi.azure.com', volumeAttributes: attributes } }];
  pod.spec.containers[0].volumeMounts = [{ name: 'share', mountPath: '/data' }];
  return pod;
}

const inlineAccount: AksEndToEndCase = {
  validate: validateFile,
  async run(context) {
    let attributes: Record<string, string>;
    await context.phase('baseline', async () => {
      const { account } = await filesEnvironment(context); staticShare(context, 'root', account);
      context.create('root-pod', sharePod(context, 'root', 'root', true)); await shareReady(context, 'root');
      attributes = { shareName: 'owned-share', secretName: 'storage-auth', storageAccount: account };
      context.create('baseline-inline', inlinePod(context, 'baseline', attributes)); return shareReady(context, 'baseline');
    });
    await context.phase('fault', async () => {
      const missingAccount = { ...attributes }; delete missingAccount.storageAccount;
      context.create('fault-inline', inlinePod(context, 'subject', missingAccount));
      return mountFailure(context, 'subject', /(?:account name|storageaccount|server).*(?:empty|missing|not found|invalid)|failed to get account/i);
    });
    await context.phase('recovery', async () => {
      context.run(namespaced(context, ['delete', 'pod', 'subject', '--wait=true', '--timeout=90s']));
      context.create('recovery-inline', inlinePod(context, 'subject', attributes)); return shareReady(context, 'subject');
    });
  },
};

const secretNamespace: AksEndToEndCase = {
  validate: validateFile,
  async run(context) {
    let environment: Awaited<ReturnType<typeof filesEnvironment>>;
    const secretNamespace = 'research-credentials';
    const attributes = () => ({ storageAccount: environment.account, shareName: 'owned-share', secretName: 'storage-auth', secretNamespace });
    await context.phase('baseline', async () => {
      environment = await filesEnvironment(context); staticShare(context, 'root', environment.account);
      context.create('root-pod', sharePod(context, 'root', 'root', true)); await shareReady(context, 'root');
      context.create('baseline-inline', inlinePod(context, 'baseline', { ...attributes(), secretNamespace: context.namespace }));
      await shareReady(context, 'baseline');
      context.create('credential-namespace', { apiVersion: 'v1', kind: 'Namespace', metadata: { name: secretNamespace, labels: { 'headlamp-e2e-owner': context.owner } } });
      environment.setSecret(secretNamespace); return context.read('pod', 'baseline');
    });
    await context.phase('fault', async () => {
      context.run(namespaced(context, ['delete', 'secret', 'storage-auth']));
      context.create('fault-inline', inlinePod(context, 'subject', attributes()));
      const error = await mountFailure(context, 'subject', /(?:secret|storage-auth).*not found/i);
      const remote = context.run(['-n', secretNamespace, 'get', 'secret', 'storage-auth', '-o', 'jsonpath={.metadata.name}']);
      assert.equal(remote.trim(), 'storage-auth');
      return { error, secretPresentInDeclaredNamespace: true };
    });
    await context.phase('recovery', async () => {
      environment.setSecret();
      context.run(namespaced(context, ['delete', 'pod', 'subject', '--wait=true', '--timeout=90s']));
      context.create('recovery-inline', inlinePod(context, 'subject', { ...attributes(), secretNamespace: context.namespace }));
      return shareReady(context, 'subject');
    });
  },
};

const rotatedKey: AksEndToEndCase = {
  validate: validateFile,
  async run(context) {
    let environment: Awaited<ReturnType<typeof filesEnvironment>>;
    let rolesBefore: any;
    let secretVersion = '';
    const secretMetadata = () => JSON.parse(context.run(namespaced(context, ['get', 'secret', 'storage-auth', '-o', 'jsonpath={.metadata}'])));
    await context.phase('baseline', async () => {
      environment = await filesEnvironment(context); staticShare(context, 'shared', environment.account);
      context.create('baseline-pod', sharePod(context, 'baseline', 'shared', true));
      await shareReady(context, 'baseline');
      secretVersion = secretMetadata().resourceVersion;
      rolesBefore = context.az(['role', 'assignment', 'list', '--resource-group', context.resourceGroup, '--all']);
      return { pod: context.read('pod', 'baseline'), secret: { resourceVersion: secretVersion }, roleAssignments: rolesBefore };
    });
    await context.phase('fault', async () => {
      context.az(['storage', 'account', 'keys', 'renew', '--resource-group', context.resourceGroup, '--account-name', environment.account, '--key', 'key1']);
      context.run(namespaced(context, ['delete', 'pod', 'baseline', '--wait=true', '--timeout=90s']));
      context.create('fault-pod', sharePod(context, 'subject', 'shared'));
      const failure = await mountFailure(context, 'subject', /permission denied|access denied|error\(13\)/i);
      assert.equal(secretMetadata().resourceVersion, secretVersion, 'Credential reference changed independently of the trial');
      const assignments = context.az(['role', 'assignment', 'list', '--resource-group', context.resourceGroup, '--all']);
      assert.deepEqual(assignments.map((role: any) => role.id).sort(), rolesBefore.map((role: any) => role.id).sort());
      return { failure, roleAssignmentIds: assignments.map((role: any) => role.id), secretVersion };
    });
    await context.phase('recovery', async () => {
      context.run(namespaced(context, ['delete', 'secret', 'storage-auth'])); environment.setSecret();
      const refreshed = secretMetadata(); assert.notEqual(refreshed.resourceVersion, secretVersion);
      context.run(namespaced(context, ['delete', 'pod', 'subject', '--wait=true', '--timeout=90s']));
      context.create('recovery-pod', sharePod(context, 'subject', 'shared'));
      return { pod: await shareReady(context, 'subject'), secretVersion: refreshed.resourceVersion };
    });
  },
};

const legacyMigration: AksEndToEndCase = {
  validate: validateFile,
  async run(context) {
    let account: string;
    await context.phase('baseline', async () => {
      account = (await filesEnvironment(context)).account; staticShare(context, 'control', account);
      context.create('baseline-pod', sharePod(context, 'control', 'control', true)); return shareReady(context, 'control');
    });
    await context.phase('fault', async () => {
      context.create('legacy-pv', { apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name: 'legacy-source', labels: { 'headlamp-e2e-owner': context.owner } },
        spec: { capacity: { storage: '1Gi' }, accessModes: ['ReadWriteMany'], persistentVolumeReclaimPolicy: 'Retain', storageClassName: '',
          claimRef: { namespace: context.namespace, name: 'legacy' }, azureFile: { secretName: 'storage-auth', secretNamespace: context.namespace, shareName: 'owned-share', readOnly: false } } });
      context.create('legacy-claim', { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(context, 'legacy'),
        spec: { storageClassName: '', volumeName: 'legacy-source', accessModes: ['ReadWriteMany'], resources: { requests: { storage: '1Gi' } } } });
      context.create('legacy-pod', sharePod(context, 'subject', 'legacy'));
      const failure = await mountFailure(context, 'subject', /(?:api:\/\/AzureADTokenExchange|audience).*(?:not found|missing|not available|not.*token)/i);
      const pv = JSON.parse(context.run(['get', 'pv', 'legacy-source', '-o', 'json']));
      assert.equal(pv.metadata.annotations?.['pv.kubernetes.io/migrated-to'], 'file.csi.azure.com', 'Real in-tree migration did not occur');
      await shareReady(context, 'control'); return { failure, pv };
    });
    await context.phase('recovery', async () => {
      context.run(namespaced(context, ['delete', 'pod', 'subject', '--wait=true', '--timeout=90s']));
      context.create('recovery-pod', sharePod(context, 'subject', 'control')); return shareReady(context, 'subject');
    });
  },
};

const storagePolicy: AksEndToEndCase = {
  validate: validateFile,
  async run(context) {
    await filesEnvironment(context);
    const resourceGroupId = `/subscriptions/${context.subscription}/resourceGroups/${context.resourceGroup}`;
    const policyName = `hl-${context.owner}`;
    assert.ok(!context.az(['policy', 'definition', 'list']).some((definition: any) => definition.name === policyName), 'Policy definition name already exists');
    context.registerExternalCleanup('policy-definition', `/subscriptions/${context.subscription}/providers/Microsoft.Authorization/policyDefinitions/${policyName}`);
    const policy = context.az(['policy', 'definition', 'create', '--name', policyName, '--mode', 'Indexed',
      '--metadata', JSON.stringify({ 'headlamp-e2e-owner': context.owner }),
      '--display-name', 'Owned trial storage cross-tenant-replication policy', '--rules', JSON.stringify({
        if: { allOf: [{ field: 'type', equals: 'Microsoft.Storage/storageAccounts' }, { field: 'Microsoft.Storage/storageAccounts/allowCrossTenantReplication', notEquals: false }] },
        then: { effect: 'deny' },
      })]);
    context.az(['policy', 'assignment', 'create', '--name', 'research-storage', '--scope', resourceGroupId, '--policy', policy.id, '--enforcement-mode', 'Default']);
    const storageClass = (name: string, compliant: boolean) => context.create(`${name}-class`, {
      apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass', metadata: { name, labels: { 'headlamp-e2e-owner': context.owner } },
      provisioner: 'file.csi.azure.com', reclaimPolicy: 'Delete', volumeBindingMode: 'Immediate',
      parameters: { skuName: 'Premium_LRS', resourceGroup: context.resourceGroup, ...(compliant ? { allowCrossTenantReplication: 'false' } : {}) },
    });
    const pvc = (name: string, className: string) => context.create(`${name}-claim`, { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(context, name),
      spec: { accessModes: ['ReadWriteMany'], storageClassName: className, resources: { requests: { storage: '100Gi' } } } });
    await context.phase('baseline', async () => {
      storageClass('compliant', true); pvc('control', 'compliant');
      context.create('control-pod', sharePod(context, 'control', 'control', true)); await shareReady(context, 'control');
      const pv = JSON.parse(context.run(['get', 'pv', context.read('pvc', 'control').spec.volumeName, '-o', 'json']));
      const account = pv.spec.csi.volumeAttributes.storageAccount;
      const provider = context.az(['storage', 'account', 'show', '--resource-group', context.resourceGroup, '--name', account]);
      assert.equal(provider.allowCrossTenantReplication, false); return { pvc: context.read('pvc', 'control'), pv, provider };
    });
    await context.phase('fault', async () => {
      storageClass('default-policy', false); pvc('subject', 'default-policy'); let captured: unknown;
      await context.poll(() => {
        const claim = context.read('pvc', 'subject'); const events = objectEvents(context, claim);
        captured = { claim, events }; context.save('policy-provisioning', captured);
        return claim.status?.phase === 'Pending' && events.items.some((event: any) =>
          /RequestDisallowedByPolicy/.test(event.message ?? '') && (event.message ?? '').includes('research-storage'));
      }, 'Storage-account deny by owned policy'); return captured;
    });
    await context.phase('recovery', async () => {
      context.run(namespaced(context, ['delete', 'pvc', 'subject', '--wait=true', '--timeout=90s']));
      pvc('subject', 'compliant'); context.create('recovery-pod', sharePod(context, 'subject', 'subject', true));
      const recovered = await shareReady(context, 'subject');
      const assignment = context.az(['policy', 'assignment', 'show', '--name', 'research-storage', '--scope', resourceGroupId]);
      assert.equal(assignment.enforcementMode, 'Default'); return { recovered, assignment };
    });
  },
};

export const aksFileEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c011-v1': legacyMigration,
  'aks-c073-v1': inlineAccount,
  'aks-c076-v1': storagePolicy,
  'aks-c077-v1': duplicateVolume,
  'aks-c078-v1': missingFolder,
  'aks-c082-v1': rotatedKey,
  'aks-c083-v1': secretNamespace,
};