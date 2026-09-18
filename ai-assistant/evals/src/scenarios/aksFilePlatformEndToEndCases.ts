import assert from 'node:assert/strict';
import { addPool, metadata, namespaced, objectEvents, requiredParameter, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';
import { filesEnvironment, staticShare, sharePod, shareReady, validateFile } from './aksFileEndToEndCases.js';

async function pendingMount(context: AksCaseContext, name: string, pattern: RegExp) {
  let observed: unknown;
  await context.poll(() => {
    const pod = context.read('pod', name); const events = objectEvents(context, pod);
    observed = { pod, events }; context.save(`${name}-mount-failure`, observed);
    return !pod.status?.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'True') &&
      events.items.some((event: any) => event.reason === 'FailedMount' && pattern.test(event.message ?? ''));
  }, `${name} expected mount failure`);
  return observed;
}

function driver(context: AksCaseContext) {
  const expected = requiredParameter(context.parameters, 'fileDriverImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
  const object = JSON.parse(context.run(['-n', 'kube-system', 'get', 'daemonset', 'csi-azurefile-node', '-o', 'json']));
  assert.equal(object.spec.template.spec.containers.find((container: any) => container.name === 'azurefile')?.image, expected);
  context.save('file-driver', object);
}

function nfsCase(missingHelper: boolean): AksEndToEndCase {
  return {
    customNetwork: true, serviceEndpoints: ['Microsoft.Storage'],
    validate(parameters) {
      validateFile(parameters);
      if (missingHelper) requiredParameter(parameters, 'affectedNodeImageVersion', /^[a-zA-Z0-9._-]+$/);
    },
    async run(context) {
      driver(context); assert.ok(context.subnetId);
      const account = `nfs${context.owner.replaceAll('-', '').slice(0, 21)}`;
      context.az(['storage', 'account', 'create', '--resource-group', context.resourceGroup, '--name', account, '--location', context.location,
        '--sku', 'Premium_LRS', '--kind', 'FileStorage', '--https-only', 'true', '--default-action', 'Deny', '--bypass', 'None',
        '--tags', `headlamp-e2e-owner=${context.owner}`]);
      context.az(['storage', 'account', 'network-rule', 'add', '--resource-group', context.resourceGroup, '--account-name', account, '--subnet', context.subnetId]);
      context.az(['storage', 'share-rm', 'create', '--resource-group', context.resourceGroup, '--storage-account', account, '--name', 'owned-nfs', '--enabled-protocols', 'NFS', '--quota', '100', '--root-squash', 'NoRootSquash']);
      if (missingHelper) {
        const affected = await addPool(context, 'affected', ['--os-sku', 'AzureLinux']);
        assert.equal(affected.nodeImageVersion, context.parameters.affectedNodeImageVersion, 'Affected image unavailable');
      }
      const fixture = (name: string, encrypted: boolean, affected: boolean) => {
        context.create(`${name}-pv`, { apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name, labels: { 'headlamp-e2e-owner': context.owner } },
          spec: { capacity: { storage: '100Gi' }, accessModes: ['ReadWriteMany'], storageClassName: '', persistentVolumeReclaimPolicy: 'Retain',
            claimRef: { namespace: context.namespace, name }, mountOptions: ['nfsvers=4.1', 'sec=sys'],
            csi: { driver: 'file.csi.azure.com', volumeHandle: `${context.resourceGroup}#${account}#owned-nfs#${name}`,
              volumeAttributes: { resourceGroup: context.resourceGroup, storageAccount: account, shareName: 'owned-nfs', protocol: 'nfs', encryptInTransit: String(encrypted) } } } });
        context.create(`${name}-pvc`, { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(context, name),
          spec: { accessModes: ['ReadWriteMany'], volumeName: name, storageClassName: '', resources: { requests: { storage: '100Gi' } } } });
        const pod: any = sharePod(context, name, name, name === 'control');
        pod.spec.nodeSelector = affected ? { agentpool: 'affected' } : { 'kubernetes.azure.com/mode': 'system', 'kubernetes.io/os': 'linux' };
        context.create(`${name}-pod`, pod);
      };
      const secure = () => {
        const properties = context.az(['storage', 'account', 'show', '--resource-group', context.resourceGroup, '--name', account]);
        assert.equal(properties.enableHttpsTrafficOnly, true, 'Storage security policy changed'); return properties;
      };
      await context.phase('baseline', async () => { fixture('control', true, false); return { pod: await shareReady(context, 'control'), storage: secure() }; });
      await context.phase('fault', async () => {
        fixture('subject', missingHelper, missingHelper);
        const failure = await pendingMount(context, 'subject', missingHelper ? /unknown filesystem type.*aznfs|aznfs.*(?:not found|no such file)/i : /access denied.*server|permission denied/i);
        assert.equal(context.read('pvc', 'subject').status.phase, 'Bound');
        await shareReady(context, 'control'); return { failure, storage: secure() };
      });
      await context.phase('recovery', async () => {
        context.run(namespaced(context, ['delete', 'pod', 'subject', '--wait=true', '--timeout=90s']));
        if (missingHelper) {
          const recovered: any = sharePod(context, 'subject', 'subject'); recovered.spec.nodeSelector = { 'kubernetes.azure.com/mode': 'system' };
          context.create('supported-image-pod', recovered);
        } else {
          context.run(namespaced(context, ['delete', 'pvc', 'subject', '--wait=true', '--timeout=90s']));
          context.run(['delete', 'pv', 'subject', '--wait=true', '--timeout=90s']); fixture('subject', true, false);
        }
        return { pod: await shareReady(context, 'subject'), storage: secure() };
      });
    },
  };
}

export function managedIdentityShare(context: AksCaseContext) {
  driver(context);
  const account = `smb${context.owner.replaceAll('-', '').slice(0, 21)}`;
  const storage = context.az(['storage', 'account', 'create', '--resource-group', context.resourceGroup, '--name', account,
    '--location', context.location, '--sku', 'Standard_LRS', '--kind', 'StorageV2', '--https-only', 'true',
    '--allow-blob-public-access', 'false', '--enable-smb-oauth', 'true', '--tags', `headlamp-e2e-owner=${context.owner}`]);
  context.az(['storage', 'share-rm', 'create', '--resource-group', context.resourceGroup, '--storage-account', account, '--name', 'owned-share', '--quota', '1']);
  const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
  const identity = cluster.identityProfile?.kubeletidentity;
  assert.ok(identity?.objectId && identity?.clientId);
  context.az(['role', 'assignment', 'create', '--assignee-object-id', identity.objectId, '--assignee-principal-type', 'ServicePrincipal',
    '--role', 'Storage File Data SMB MI Admin', '--scope', storage.id]);
  return { account, storage, clientId: identity.clientId };
}

export function identityVolume(context: AksCaseContext, name: string, account: string, clientId: string, inline: boolean, extra: Record<string, string> = {}) {
  const attributes = { resourceGroup: context.resourceGroup, storageAccount: account, shareName: 'owned-share',
    mountWithManagedIdentity: 'true', clientID: clientId, ...extra };
  const pod: any = sharePod(context, name, name, name === 'control');
  if (inline) pod.spec.volumes = [{ name: 'share', csi: { driver: 'file.csi.azure.com', volumeAttributes: attributes } }];
  else {
    context.create(`${name}-pv`, { apiVersion: 'v1', kind: 'PersistentVolume', metadata: { name, labels: { 'headlamp-e2e-owner': context.owner } },
      spec: { capacity: { storage: '1Gi' }, accessModes: ['ReadWriteMany'], storageClassName: '', persistentVolumeReclaimPolicy: 'Retain', claimRef: { namespace: context.namespace, name },
        csi: { driver: 'file.csi.azure.com', volumeHandle: `${context.resourceGroup}#${account}#owned-share#${name}`, volumeAttributes: attributes } } });
    context.create(`${name}-pvc`, { apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(context, name),
      spec: { accessModes: ['ReadWriteMany'], storageClassName: '', volumeName: name, resources: { requests: { storage: '1Gi' } } } });
  }
  return pod;
}

const secretlessInline: AksEndToEndCase = {
  validate: validateFile,
  async run(context) {
    const environment = managedIdentityShare(context);
    await context.phase('baseline', async () => {
      context.create('persistent-control', identityVolume(context, 'control', environment.account, environment.clientId, false));
      return shareReady(context, 'control');
    });
    await context.phase('fault', async () => {
      context.create('inline-subject', identityVolume(context, 'subject', environment.account, environment.clientId, true));
      const result = await pendingMount(context, 'subject', /failed to get account name|(?:parse|invalid).*csi-/i);
      await shareReady(context, 'control'); return result;
    });
    await context.phase('recovery', async () => {
      context.run(namespaced(context, ['delete', 'pod', 'subject', '--wait=true', '--timeout=90s']));
      context.create('persistent-recovery', identityVolume(context, 'subject', environment.account, environment.clientId, false)); return shareReady(context, 'subject');
    });
  },
};

const missingSmbHelper: AksEndToEndCase = {
  validate(parameters) {
    validateFile(parameters); requiredParameter(parameters, 'affectedNodeImageVersion', /^[a-zA-Z0-9._-]+$/);
    requiredParameter(parameters, 'controlNodeImageVersion', /^[a-zA-Z0-9._-]+$/);
    requiredParameter(parameters, 'affectedPoolVersion', /^1\.\d+\.\d+$/);
  },
  async run(context) {
    const environment = managedIdentityShare(context);
    const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
    assert.equal(cluster.agentPoolProfiles[0].nodeImageVersion, context.parameters.controlNodeImageVersion);
    const affected = await addPool(context, 'affected', ['--os-sku', 'Ubuntu', '--kubernetes-version', context.parameters.affectedPoolVersion!]);
    assert.equal(affected.nodeImageVersion, context.parameters.affectedNodeImageVersion);
    const fixture = (name: string, affectedNode: boolean) => {
      const pod: any = identityVolume(context, name, environment.account, environment.clientId, false);
      pod.spec.nodeSelector = affectedNode ? { agentpool: 'affected' } : { 'kubernetes.azure.com/mode': 'system' }; return pod;
    };
    await context.phase('baseline', async () => { context.create('control-pod', fixture('control', false)); return shareReady(context, 'control'); });
    await context.phase('fault', async () => {
      context.create('fault-pod', fixture('subject', true));
      const failure = await pendingMount(context, 'subject', /azfilesauthmanager.*(?:not found|no such file|executable)|(?:not found|no such file).*azfilesauthmanager/i);
      await shareReady(context, 'control'); return { failure, affectedImage: affected.nodeImageVersion };
    });
    await context.phase('recovery', async () => {
      context.run(namespaced(context, ['delete', 'pod', 'subject', '--wait=true', '--timeout=90s']));
      const pod: any = sharePod(context, 'subject', 'subject'); pod.spec.nodeSelector = { 'kubernetes.azure.com/mode': 'system' };
      context.create('supported-pod', pod); return shareReady(context, 'subject');
    });
  },
};

export const aksFilePlatformEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c003-v1': nfsCase(true),
  'aks-c006-v1': missingSmbHelper,
  'aks-c007-v1': nfsCase(false),
  'aks-c079-v1': secretlessInline,
};