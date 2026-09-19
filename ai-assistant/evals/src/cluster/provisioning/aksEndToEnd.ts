import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { boundedAzureRunner } from './aksObservability.js';
import type { CommandRunner } from '../commandRunner.js';
import { aksNetworkArguments, type AksCaseContext } from '../../scenarios/aksEndToEndCases.js';
import { aksEndToEndCases, hasAksEndToEndImplementation } from '../../scenarios/aksEndToEndRegistry.js';
import { cleanupOwnedDevOpsProject, type OwnedDevOpsProject } from './aksDevOpsOwnership.js';

const ownerTag = 'headlamp-e2e-owner';
const namespace = 'aks-reproduction';
type Phase = 'setup' | 'baseline' | 'fault' | 'recovery' | 'cleanup';
interface EndToEndState {
  schema_version: 'aks-end-to-end@1.0.0';
  scenario: string;
  owner: string;
  subscription: string;
  location: string;
  resourceGroup: string;
  nodeResourceGroup: string;
  clusterId: string;
  clusterResourceUid: string | null;
  requestedVersion: string;
  expectedDiskDriverImage: string | null;
  kubeconfig: string;
  phases: Record<Phase, 'not-run' | 'running' | 'passed' | 'failed'>;
  qualification: 'pending';
  modelInvocations: 0;
  error: string | null;
  externalCleanup?: Array<{ kind: 'policy-definition' | 'role-definition'; id: string }>;
  auxiliaryNodeGroups?: string[];
  secondaryGroups?: Array<{ subscription: string; name: string }>;
  devOpsProjects?: OwnedDevOpsProject[];
}

function save(directory: string, name: string, value: unknown) {
  const file = path.join(directory, `${name}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600, flush: true });
  renameSync(`${file}.tmp`, file);
}

function azure(runner: CommandRunner, subscription: string, args: string[]) {
  const result = runner('az', [...args, '--subscription', subscription, '--only-show-errors', '-o', 'json']);
  assert.equal(result.status, 0, `Azure ${args.slice(0, 2).join(' ')} failed; retain state for cleanup`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

export function normalizeOwnedAksContext(kubeconfig: string, owner: string, hostnames: string[], runner: CommandRunner) {
  const invoke = (args: string[]) => {
    const result = runner('kubectl', ['--kubeconfig', kubeconfig, 'config', ...args]);
    assert.equal(result.status, 0, 'Could not inspect the owned kubeconfig');
    return result.stdout.trim();
  };
  const contexts = invoke(['get-contexts', '-o', 'name']).split(/\s+/).filter(Boolean);
  assert.equal(contexts.length, 1, 'Expected exactly one context in the fresh private kubeconfig');
  const current = contexts[0]!;
  const server = invoke(['view', '--minify', '--context', current, '-o', 'jsonpath={.clusters[0].cluster.server}']);
  const endpoint = new URL(server);
  assert.equal(endpoint.protocol, 'https:');
  assert.ok(hostnames.some(hostname => hostname.toLowerCase() === endpoint.hostname.toLowerCase()), 'Downloaded kubeconfig points at another cluster');
  if (current !== owner) invoke(['rename-context', current, owner]);
}

export async function cleanupAksEndToEnd(
  directory: string,
  runner: CommandRunner = boundedAzureRunner(),
  wait: (milliseconds: number) => Promise<void> = setTimeout
) {
  const state: EndToEndState = JSON.parse(readFileSync(path.join(directory, 'end-to-end-state.json'), 'utf8'));
  assert.equal(state.schema_version, 'aks-end-to-end@1.0.0');
  assert.ok(hasAksEndToEndImplementation(state.scenario), 'Unknown end-to-end scenario');
  assert.match(state.owner, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.match(state.subscription, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  assert.equal(state.resourceGroup, `rg-hl-e2e-${state.owner}`);
  assert.equal(state.nodeResourceGroup, `${state.resourceGroup}-nodes`);
  assert.equal(state.clusterId, `/subscriptions/${state.subscription}/resourceGroups/${state.resourceGroup}/providers/Microsoft.ContainerService/managedClusters/research`);
  const cloud = runner('az', ['cloud', 'show', '--query', 'name', '-o', 'tsv']);
  assert.equal(cloud.status, 0);
  assert.equal(cloud.stdout.trim(), 'AzureCloud', 'Only public Azure is supported');
  const az = (args: string[]) => azure(runner, state.subscription, args);
  try {
    state.phases.cleanup = 'running';
    save(directory, 'end-to-end-state', state);
    for (const resource of state.devOpsProjects ?? []) await cleanupOwnedDevOpsProject(state.owner, resource, runner, wait);
    const exists = az(['group', 'exists', '--name', state.resourceGroup]);
    assert.equal(typeof exists, 'boolean');
    if (exists) {
      const group = az(['group', 'show', '--name', state.resourceGroup]);
      assert.equal(group.tags?.[ownerTag], state.owner, 'Refusing unowned resource-group cleanup');
      const clusters = az(['aks', 'list', '--resource-group', state.resourceGroup]);
      for (const cluster of clusters) {
        const allowedClusterIds = [state.clusterId, `/subscriptions/${state.subscription}/resourceGroups/${state.resourceGroup}/providers/Microsoft.ContainerService/managedClusters/subject`];
        assert.ok(allowedClusterIds.some(id => id.toLowerCase() === cluster.id.toLowerCase()));
        assert.equal(cluster.tags?.[ownerTag], state.owner, 'Cluster ownership changed');
        assert.ok([state.nodeResourceGroup, ...(state.auxiliaryNodeGroups ?? [])].includes(cluster.nodeResourceGroup));
        if (cluster.id.toLowerCase() === state.clusterId.toLowerCase() && state.clusterResourceUid) assert.equal(cluster.resourceUID, state.clusterResourceUid, 'Cluster UID changed');
      }
      az(['group', 'delete', '--name', state.resourceGroup, '--yes']);
    }
    for (const group of [state.resourceGroup, state.nodeResourceGroup, ...(state.auxiliaryNodeGroups ?? [])]) {
      assert.ok(group === state.resourceGroup || group === state.nodeResourceGroup || group === `${state.resourceGroup}-subject-nodes`, 'Unexpected auxiliary resource-group name');
      let absent = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        const present = az(['group', 'exists', '--name', group]);
        assert.equal(typeof present, 'boolean');
        if (!present) { absent = true; break; }
        await wait(10_000);
      }
      assert.ok(absent, `${group} remains; do not remove an unowned managed group manually`);
    }
    for (const external of state.externalCleanup ?? []) {
      if (external.kind === 'role-definition') {
        assert.equal(external.id.toLowerCase(), `/subscriptions/${state.subscription}/providers/Microsoft.Authorization/roleDefinitions/${state.owner}`.toLowerCase());
        const roles = az(['role', 'definition', 'list', '--name', state.owner]);
        for (const role of roles) {
          assert.equal(role.roleName, `hl-${state.owner}`); assert.equal(role.description, `Owned AKS reproduction ${state.owner}`);
          az(['role', 'definition', 'delete', '--name', state.owner]);
        }
        assert.equal(az(['role', 'definition', 'list', '--name', state.owner]).length, 0); continue;
      }
      assert.equal(external.kind, 'policy-definition');
      assert.equal(external.id.toLowerCase(), `/subscriptions/${state.subscription}/providers/Microsoft.Authorization/policyDefinitions/hl-${state.owner}`.toLowerCase());
      const definitions = az(['policy', 'definition', 'list']);
      const definition = definitions.find((item: any) => item.id.toLowerCase() === external.id.toLowerCase());
      if (definition) {
        assert.equal(definition.metadata?.[ownerTag] ?? definition.properties?.metadata?.[ownerTag], state.owner, 'Policy definition ownership changed');
        az(['policy', 'definition', 'delete', '--name', `hl-${state.owner}`]);
      }
      assert.ok(!az(['policy', 'definition', 'list']).some((definition: any) => definition.id.toLowerCase() === external.id.toLowerCase()), 'Owned policy definition remains');
    }
    for (const secondary of state.secondaryGroups ?? []) {
      assert.match(secondary.subscription, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
      assert.equal(secondary.name, `${state.resourceGroup}-storage`);
      const other = (args: string[]) => azure(runner, secondary.subscription, args);
      if (other(['group', 'exists', '--name', secondary.name]) === true) {
        assert.equal(other(['group', 'show', '--name', secondary.name]).tags?.[ownerTag], state.owner, 'Secondary storage group ownership changed');
        other(['group', 'delete', '--name', secondary.name, '--yes']);
      }
      assert.equal(other(['group', 'exists', '--name', secondary.name]), false, 'Secondary group cleanup incomplete');
    }
    state.phases.cleanup = 'passed';
  } catch (error) {
    state.phases.cleanup = 'failed';
    throw error;
  } finally {
    save(directory, 'end-to-end-state', state);
  }
}

export async function runAksDiskAccessModeReproduction(options: {
  scenario?: string;
  subscription: string;
  location: string;
  kubernetesVersion: string;
  nodeVmSize: string;
  probeImage: string;
  expectedDiskDriverImage?: string;
  caseParameters?: Record<string, string>;
  acceptAzureCosts: boolean;
  stateDirectory: string;
  runner?: CommandRunner;
  wait?: (milliseconds: number) => Promise<void>;
}) {
  assert.equal(options.acceptAzureCosts, true, 'Explicit Azure cost acknowledgement required');
  const scenarioId = options.scenario ?? 'aks-c089-v1';
  const definition = Object.hasOwn(aksEndToEndCases, scenarioId) ? aksEndToEndCases[scenarioId] : undefined;
  assert.ok(scenarioId === 'aks-c089-v1' || definition, 'No authored end-to-end implementation');
  const parameters = options.caseParameters ?? {};
  assert.ok(parameters && typeof parameters === 'object' && !Array.isArray(parameters) && Object.values(parameters).every(value => typeof value === 'string'), 'Case parameters must be a string-valued object');
  definition?.validate(parameters);
  const networkArguments = aksNetworkArguments(definition);
  assert.match(options.subscription, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  assert.match(options.location, /^[a-z0-9]+$/);
  assert.match(options.kubernetesVersion, /^1\.[0-9]+\.[0-9]+$/);
  assert.match(options.nodeVmSize, /^Standard_[a-zA-Z0-9_]+$/);
  assert.match(options.probeImage, /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
  if (!definition || definition.requiresDiskDriver) assert.ok(options.expectedDiskDriverImage, 'Disk-driver digest required');
  if (options.expectedDiskDriverImage) assert.match(options.expectedDiskDriverImage, /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
  const directory = path.resolve(options.stateDirectory);
  const runner = options.runner ?? boundedAzureRunner();
  const wait = options.wait ?? setTimeout;
  const cloud = runner('az', ['cloud', 'show', '--query', 'name', '-o', 'tsv']);
  assert.equal(cloud.status, 0);
  assert.equal(cloud.stdout.trim(), 'AzureCloud', 'Only public Azure is supported');
  const az = (args: string[]) => azure(runner, options.subscription, args);
  assert.equal(az(['account', 'show']).id.toLowerCase(), options.subscription.toLowerCase());
  const owner = randomUUID();
  const resourceGroup = `rg-hl-e2e-${owner}`;
  const nodeResourceGroup = `${resourceGroup}-nodes`;
  assert.equal(az(['group', 'exists', '--name', resourceGroup]), false);
  assert.equal(az(['group', 'exists', '--name', nodeResourceGroup]), false);
  mkdirSync(directory, { mode: 0o700 });
  const state: EndToEndState = {
    schema_version: 'aks-end-to-end@1.0.0', scenario: scenarioId, owner,
    subscription: options.subscription, location: options.location, resourceGroup, nodeResourceGroup,
    clusterId: `/subscriptions/${options.subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService/managedClusters/research`,
    clusterResourceUid: null, requestedVersion: options.kubernetesVersion,
    expectedDiskDriverImage: options.expectedDiskDriverImage ?? null,
    kubeconfig: path.join(directory, 'kubeconfig'),
    phases: { setup: 'not-run', baseline: 'not-run', fault: 'not-run', recovery: 'not-run', cleanup: 'not-run' },
    qualification: 'pending', modelInvocations: 0, error: null,
  };
  const persist = () => save(directory, 'end-to-end-state', state);
  const kube = (args: string[]) => runner('kubectl', [
    '--kubeconfig', state.kubeconfig, '--context', owner, '--request-timeout=30s', ...args,
  ]);
  const run = (args: string[]) => {
    const result = kube(args);
    assert.equal(result.status, 0, `kubectl ${args[0]} failed`);
    return result.stdout;
  };
  const scoped = (args: string[]) => ['--namespace', namespace, ...args];
  const create = (name: string, resource: unknown) => {
    save(directory, name, resource);
    run(['create', '-f', path.join(directory, `${name}.json`)]);
  };
  const read = (kind: string, name: string) => JSON.parse(run(scoped(['get', kind, name, '-o', 'json'])));
  const metadata = (name: string) => ({ name, namespace, labels: { [ownerTag]: owner } });
  const claim = (name: string, accessMode: 'ReadWriteOnce' | 'ReadWriteMany') => ({
    apiVersion: 'v1', kind: 'PersistentVolumeClaim', metadata: metadata(name),
    spec: { accessModes: [accessMode], volumeMode: 'Filesystem', storageClassName: 'research-disk', resources: { requests: { storage: '1Gi' } } },
  });
  const pod = (name: string, volume: string) => ({
    apiVersion: 'v1', kind: 'Pod', metadata: metadata(name),
    spec: {
      restartPolicy: 'Never', automountServiceAccountToken: false,
      securityContext: { runAsUser: 1000, runAsGroup: 1000, fsGroup: 1000 },
      containers: [{ name: 'probe', image: options.probeImage,
        command: ['sh', '-c', 'printf "storage-control-ok\\n" > /data/sentinel && exec tail -f /dev/null'],
        securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] }, seccompProfile: { type: 'RuntimeDefault' } },
        resources: { requests: { cpu: '10m', memory: '16Mi' }, limits: { cpu: '100m', memory: '64Mi' } },
        volumeMounts: [{ name: 'data', mountPath: '/data' }],
      }],
      volumes: [{ name: 'data', persistentVolumeClaim: { claimName: volume } }],
    },
  });
  const poll = async (action: () => boolean, label: string) => {
    const deadline = Date.now() + 300_000;
    for (let attempt = 0; attempt < 60 && Date.now() < deadline; attempt++) {
      if (action()) return;
      await wait(5000);
    }
    throw new Error(`${label} did not converge; no reproduction success is inferred`);
  };
  const healthy = async (name: string) => {
    await poll(() => read('pvc', name).status?.phase === 'Bound', `${name} binding`);
    await poll(() => read('pod', name).status?.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'True'), `${name} readiness`);
    assert.equal(run(scoped(['exec', name, '--', 'cat', '/data/sentinel'])).trim(), 'storage-control-ok');
    return { pvc: read('pvc', name), pod: read('pod', name) };
  };
  let phase: Exclude<Phase, 'cleanup'> = 'setup';
  let failure: unknown;
  persist();
  try {
    state.phases.setup = 'running'; persist();
    az(['group', 'create', '--name', resourceGroup, '--location', options.location, '--tags', `${ownerTag}=${owner}`]);
    const key = path.join(directory, 'ssh');
    assert.equal(runner('ssh-keygen', ['-q', '-t', 'rsa', '-b', '4096', '-N', '', '-f', key]).status, 0);
    let subnetId: string | undefined;
    let podSubnetId: string | undefined;
    if (definition?.customNetwork) {
      az(['network', 'vnet', 'create', '--resource-group', resourceGroup, '--name', 'research', '--location', options.location,
        '--address-prefixes', '10.90.0.0/16', '--subnet-name', 'nodes', '--subnet-prefixes', '10.90.0.0/22', '--tags', `${ownerTag}=${owner}`]);
      subnetId = `/subscriptions/${options.subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/virtualNetworks/research/subnets/nodes`;
      if (definition.serviceEndpoints?.length) az(['network', 'vnet', 'subnet', 'update', '--ids', subnetId, '--service-endpoints', ...definition.serviceEndpoints]);
      if (definition.dynamicPodSubnet) {
        const podSubnet = az(['network', 'vnet', 'subnet', 'create', '--resource-group', resourceGroup, '--vnet-name', 'research', '--name', 'pods',
          '--address-prefixes', '10.90.32.0/20', '--delegations', 'Microsoft.ContainerService/managedClusters']);
        podSubnetId = podSubnet.id;
        if (definition.serviceEndpoints?.length) az(['network', 'vnet', 'subnet', 'update', '--ids', podSubnetId!, '--service-endpoints', ...definition.serviceEndpoints]);
      }
      if (definition.natGateway) {
        const address = az(['network', 'public-ip', 'create', '--resource-group', resourceGroup, '--name', 'egress', '--location', options.location, '--sku', 'Standard', '--allocation-method', 'Static', '--tags', `${ownerTag}=${owner}`]);
        const gateway = az(['network', 'nat', 'gateway', 'create', '--resource-group', resourceGroup, '--name', 'egress', '--location', options.location,
          '--public-ip-addresses', address.publicIp?.id ?? address.id, '--idle-timeout', '4', '--tags', `${ownerTag}=${owner}`]);
        for (const subnet of [subnetId, podSubnetId].filter(Boolean)) az(['network', 'vnet', 'subnet', 'update', '--ids', subnet!, '--nat-gateway', gateway.id]);
      }
    }
    az(['aks', 'create', '--resource-group', resourceGroup, '--name', 'research',
      '--node-resource-group', nodeResourceGroup, '--location', options.location,
      '--kubernetes-version', options.kubernetesVersion, '--node-count', '1',
      '--node-vm-size', options.nodeVmSize, '--node-osdisk-size', '32', '--os-sku', 'Ubuntu',
      '--enable-managed-identity', '--ssh-key-value', readFileSync(`${key}.pub`, 'utf8').trim(),
      ...(definition?.standardTier ? ['--tier', 'Standard'] : []),
      ...(definition?.automatic ? ['--sku', 'automatic', '--tier', 'Standard'] : []),
      ...(definition?.windows ? ['--windows-admin-username', 'researchadmin', '--windows-admin-password', `R!${randomBytes(24).toString('base64url')}9a`] : []),
      ...(definition?.enableOidc ? ['--enable-oidc-issuer', '--enable-workload-identity'] : []),
      ...(definition?.azureRbac ? ['--enable-aad', '--enable-azure-rbac'] : []),
      ...networkArguments,
      ...(subnetId ? ['--vnet-subnet-id', subnetId] : []),
      ...(podSubnetId ? ['--pod-subnet-id', podSubnetId] : []),
      ...(definition?.natGateway ? ['--outbound-type', 'userAssignedNATGateway'] : []),
      ...(definition?.networkDataplane ? ['--network-dataplane', definition.networkDataplane] : []),
      ...(definition?.enableAcns ? ['--enable-acns'] : []),
      ...(definition?.networkPolicy ? ['--network-policy', definition.networkPolicy] : []),
      ...(definition?.serviceCidr && definition.dnsServiceIp ? ['--service-cidr', definition.serviceCidr, '--dns-service-ip', definition.dnsServiceIp] : []),
      ...(definition?.podCidr ? ['--pod-cidr', definition.podCidr] : []), '--tags', `${ownerTag}=${owner}`]);
    if (definition?.bringYourOwnCni) await poll(() => {
      const current = az(['aks', 'show', '--resource-group', resourceGroup, '--name', 'research']);
      return typeof current.fqdn === 'string' && current.fqdn.length > 0;
    }, 'BYOCNI control-plane endpoint');
    const cluster = az(['aks', 'show', '--resource-group', resourceGroup, '--name', 'research']);
    assert.equal(cluster.id.toLowerCase(), state.clusterId.toLowerCase());
    assert.equal(cluster.nodeResourceGroup, nodeResourceGroup);
    assert.equal(cluster.currentKubernetesVersion ?? cluster.kubernetesVersion, options.kubernetesVersion, 'Requested AKS version was substituted');
    state.clusterResourceUid = cluster.resourceUID ?? null; persist();
    save(directory, 'cluster-evidence', cluster);
    az(['aks', 'get-credentials', '--resource-group', resourceGroup, '--name', 'research', '--file', state.kubeconfig, '--context', owner, '--admin']);
    chmodSync(state.kubeconfig, 0o600);
    normalizeOwnedAksContext(state.kubeconfig, owner, [cluster.fqdn, cluster.privateFqdn].filter((value): value is string => typeof value === 'string'), runner);
    if (options.expectedDiskDriverImage) {
      const drivers = JSON.parse(run(['--namespace', 'kube-system', 'get', 'daemonset', 'csi-azuredisk-node', '-o', 'json']));
      const diskContainer = drivers.spec?.template?.spec?.containers?.find((container: any) => container.name === 'azuredisk');
      assert.equal(diskContainer?.image, options.expectedDiskDriverImage, 'Managed driver does not match the declared digest; do not silently substitute');
      save(directory, 'driver-evidence', drivers);
    }
    save(directory, 'version-evidence', JSON.parse(run(['version', '-o', 'json'])));
    const versions = JSON.parse(run(['version', '-o', 'json']));
    assert.ok(typeof versions.clientVersion?.minor === 'string' && typeof versions.serverVersion?.minor === 'string', 'Client/server versions missing');
    const clientMinor = Number(String(versions.clientVersion?.minor).replace(/\D/g, ''));
    const serverMinor = Number(String(versions.serverVersion?.minor).replace(/\D/g, ''));
    assert.ok(Number.isFinite(clientMinor) && Number.isFinite(serverMinor) && Math.abs(clientMinor - serverMinor) <= 1, 'Unsupported kubectl/server version skew');
    create('namespace', { apiVersion: 'v1', kind: 'Namespace', metadata: { name: namespace, labels: { [ownerTag]: owner } } });
    if (definition) {
      state.phases.setup = 'passed'; persist();
      const context: AksCaseContext = {
        subscription: options.subscription, location: options.location, resourceGroup, nodeResourceGroup,
        subnetId, podSubnetId,
        clusterId: state.clusterId, owner, namespace, probeImage: options.probeImage,
        kubeconfig: state.kubeconfig, contextName: owner,
        artifactDirectory: directory,
        publicSshKey: readFileSync(`${key}.pub`, 'utf8').trim(), kubernetesVersion: options.kubernetesVersion,
        nodeVmSize: options.nodeVmSize, parameters, az, kube, run, create, read,
        attemptAz: args => runner('az', [...args, '--subscription', options.subscription, '--only-show-errors', '-o', 'json']),
        replace: (name, resource) => { save(directory, name, resource); run(['replace', '-f', path.join(directory, `${name}.json`)]); },
        attemptCreate: (name, resource) => { save(directory, name, resource); return kube(['create', '-f', path.join(directory, `${name}.json`)]); },
        helm: args => runner('helm', ['--kubeconfig', state.kubeconfig, '--kube-context', owner, ...args]),
        createPrivate: resource => {
          const file = path.join(directory, `.private-request-${randomUUID()}.json`);
          try {
            writeFileSync(file, JSON.stringify(resource), { mode: 0o600, flag: 'wx' });
            const result = kube(['apply', '-f', file]);
            assert.equal(result.status, 0, 'Private Kubernetes resource write failed; provider details withheld');
          } finally { try { unlinkSync(file); } catch {} }
        },
        save: (name, evidence) => save(directory, name, evidence), poll, wait,
        registerExternalCleanup: (kind, id) => { state.externalCleanup ??= []; state.externalCleanup.push({ kind, id }); persist(); },
        registerAuxiliaryNodeGroup: name => {
          assert.equal(name, `${resourceGroup}-subject-nodes`);
          assert.equal(az(['group', 'exists', '--name', name]), false, 'Auxiliary node group must be new');
          state.auxiliaryNodeGroups ??= []; state.auxiliaryNodeGroups.push(name); persist();
        },
        createSecondaryResourceGroup: subscription => {
          assert.match(subscription, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
          assert.notEqual(subscription.toLowerCase(), options.subscription.toLowerCase());
          const name = `${resourceGroup}-storage`;
          assert.equal(azure(runner, subscription, ['group', 'exists', '--name', name]), false);
          state.secondaryGroups ??= []; state.secondaryGroups.push({ subscription, name }); persist();
          azure(runner, subscription, ['group', 'create', '--name', name, '--location', options.location, '--tags', `${ownerTag}=${owner}`]); return name;
        },
        secondaryAzure: (subscription, args) => {
          assert.ok(state.secondaryGroups?.some(group => group.subscription === subscription), 'Secondary subscription not registered');
          return azure(runner, subscription, args);
        },
        recordDevOpsOwnership: resource => {
          assert.equal(resource.projectName, `hl-${owner}`);
          assert.ok(state.secondaryGroups?.some(group => group.subscription === resource.subscription), 'Unregistered target subscription');
          state.devOpsProjects ??= [];
          const existing = state.devOpsProjects.findIndex(item => item.organization === resource.organization && item.projectName === resource.projectName);
          if (existing < 0) state.devOpsProjects.push(structuredClone(resource)); else state.devOpsProjects[existing] = structuredClone(resource);
          persist();
        },
        phase: async (name, action) => {
          phase = name; state.phases[name] = 'running'; persist();
          const evidence = await action();
          save(directory, `${name}-evidence`, evidence);
          state.phases[name] = 'passed'; persist();
        },
      };
      await definition.run(context);
    } else {
    create('storage-class', { apiVersion: 'storage.k8s.io/v1', kind: 'StorageClass',
      metadata: { name: 'research-disk', labels: { [ownerTag]: owner } },
      provisioner: 'disk.csi.azure.com', parameters: { skuName: 'Standard_LRS' },
      reclaimPolicy: 'Delete', volumeBindingMode: 'Immediate',
    });
    state.phases.setup = 'passed'; persist();
    phase = 'baseline'; state.phases.baseline = 'running'; persist();
    create('baseline-claim', claim('baseline', 'ReadWriteOnce'));
    create('baseline-pod', pod('baseline', 'baseline'));
    save(directory, 'baseline-evidence', await healthy('baseline'));
    state.phases.baseline = 'passed'; persist();
    phase = 'fault'; state.phases.fault = 'running'; persist();
    create('fault-claim', claim('subject', 'ReadWriteMany'));
    create('fault-pod', pod('subject', 'subject'));
    const subject = read('pvc', 'subject');
    assert.ok(subject.metadata?.uid, 'Missing fault PVC UID');
    await poll(() => {
      const events = JSON.parse(run(scoped(['get', 'events', '--field-selector', `involvedObject.uid=${subject.metadata.uid}`, '-o', 'json'])));
      const pvc = read('pvc', 'subject');
      const workload = read('pod', 'subject');
      save(directory, 'fault-evidence', { pvc, pod: workload, events });
      return pvc.status?.phase === 'Pending' && events.items.some((event: any) =>
        event.reason === 'ProvisioningFailed' && /MULTI_NODE_MULTI_WRITER/.test(event.message ?? '') && /not supported|unsupported/i.test(event.message ?? ''));
    }, 'Unsupported ordinary disk RWX fault');
    state.phases.fault = 'passed'; persist();
    phase = 'recovery'; state.phases.recovery = 'running'; persist();
    run(scoped(['delete', 'pod', 'subject', '--wait=true', '--timeout=120s']));
    run(scoped(['delete', 'pvc', 'subject', '--wait=true', '--timeout=120s']));
    create('recovery-claim', claim('subject', 'ReadWriteOnce'));
    create('recovery-pod', pod('subject', 'subject'));
    save(directory, 'recovery-evidence', await healthy('subject'));
    save(directory, 'baseline-after-recovery', await healthy('baseline'));
    state.phases.recovery = 'passed'; persist();
    }
  } catch (error) {
    failure = error;
    state.phases[phase] = 'failed';
    state.error = error instanceof Error ? error.message : 'End-to-end reproduction failed';
    persist();
  }
  try { await cleanupAksEndToEnd(directory, runner, wait); }
  catch (cleanupError) {
    if (failure) throw new AggregateError([failure, cleanupError], 'Reproduction and cleanup failed; retain state');
    throw cleanupError;
  }
  if (failure) throw failure;
  return JSON.parse(readFileSync(path.join(directory, 'end-to-end-state.json'), 'utf8')) as EndToEndState;
}