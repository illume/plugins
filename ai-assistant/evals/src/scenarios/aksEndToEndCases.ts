import assert from 'node:assert/strict';
import type { CommandResult } from '../cluster/commandRunner.js';
import type { OwnedDevOpsProject } from '../cluster/provisioning/aksDevOpsOwnership.js';

export interface AksCaseContext {
  subscription: string;
  location: string;
  resourceGroup: string;
  nodeResourceGroup: string;
  subnetId?: string;
  podSubnetId?: string;
  clusterId: string;
  owner: string;
  namespace: string;
  probeImage: string;
  nodeVmSize: string;
  kubeconfig: string;
  contextName: string;
  artifactDirectory: string;
  publicSshKey: string;
  kubernetesVersion: string;
  parameters: Record<string, string>;
  az(args: string[]): any;
  attemptAz(args: string[]): CommandResult;
  kube(args: string[]): CommandResult;
  run(args: string[]): string;
  create(name: string, resource: unknown): void;
  replace(name: string, resource: unknown): void;
  createPrivate(resource: unknown): void;
  attemptCreate(name: string, resource: unknown): CommandResult;
  helm(args: string[]): CommandResult;
  registerExternalCleanup(kind: 'policy-definition' | 'role-definition', id: string): void;
  registerAuxiliaryNodeGroup(name: string): void;
  createSecondaryResourceGroup(subscription: string): string;
  secondaryAzure(subscription: string, args: string[]): any;
  recordDevOpsOwnership(resource: OwnedDevOpsProject): void;
  read(kind: string, name: string): any;
  save(name: string, evidence: unknown): void;
  poll(action: () => boolean, description: string): Promise<void>;
  wait(milliseconds: number): Promise<void>;
  phase(name: 'baseline' | 'fault' | 'recovery', action: () => Promise<unknown>): Promise<void>;
}

export interface AksEndToEndCase {
  requiresDiskDriver?: boolean;
  podCidr?: string;
  enableOidc?: boolean;
  windows?: boolean;
  standardTier?: boolean;
  networkPolicy?: 'calico';
  networkDataplane?: 'cilium';
  customNetwork?: boolean;
  serviceEndpoints?: string[];
  enableAcns?: boolean;
  automatic?: boolean;
  azureRbac?: boolean;
  serviceCidr?: string;
  dnsServiceIp?: string;
  bringYourOwnCni?: boolean;
  nodeSubnetNetworking?: boolean;
  dynamicPodSubnet?: boolean;
  natGateway?: boolean;
  validate(parameters: Record<string, string>): void;
  run(context: AksCaseContext): Promise<void>;
}

export function requiredParameter(parameters: Record<string, string>, name: string, pattern: RegExp) {
  const value = parameters[name];
  assert.ok(value, `Missing case parameter ${name}`);
  assert.match(value, pattern, `Invalid case parameter ${name}`);
  return value;
}

export function namespaced(context: AksCaseContext, args: string[]) {
  return ['--namespace', context.namespace, ...args];
}

export function metadata(context: AksCaseContext, name: string) {
  return { name, namespace: context.namespace, labels: { 'headlamp-e2e-owner': context.owner } };
}

export function probePod(context: AksCaseContext, name: string) {
  return {
    apiVersion: 'v1', kind: 'Pod', metadata: metadata(context, name),
    spec: {
      automountServiceAccountToken: false, restartPolicy: 'Never',
      containers: [{ name: 'probe', image: context.probeImage,
        command: ['sh', '-c', 'exec tail -f /dev/null'],
        securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
        resources: { requests: { cpu: '10m', memory: '16Mi' }, limits: { cpu: '100m', memory: '64Mi' } },
      }],
    },
  };
}

export async function readyPod(context: AksCaseContext, name: string) {
  await context.poll(() => context.read('pod', name).status?.conditions?.some(
    (condition: any) => condition.type === 'Ready' && condition.status === 'True'
  ), `${name} Ready`);
  return context.read('pod', name);
}

export function objectEvents(context: AksCaseContext, object: any) {
  assert.ok(object.metadata?.uid, 'A real Kubernetes object UID is required');
  return JSON.parse(context.run(namespaced(context, [
    'get', 'events', '--field-selector', `involvedObject.uid=${object.metadata.uid}`, '-o', 'json',
  ])));
}

export async function addPool(context: AksCaseContext, name: string, extra: string[]) {
  context.az(['aks', 'nodepool', 'add', '--resource-group', context.resourceGroup,
    '--cluster-name', 'research', '--name', name, '--node-count', '1',
    '--node-vm-size', context.nodeVmSize, '--mode', 'User', '--tags', `headlamp-e2e-owner=${context.owner}`, ...extra]);
  await context.poll(() => {
    const nodes = JSON.parse(context.run(['get', 'nodes', '-l', `agentpool=${name}`, '-o', 'json']));
    return nodes.items.length === 1 && nodes.items.every((node: any) => node.status?.conditions?.some(
      (condition: any) => condition.type === 'Ready' && condition.status === 'True'
    ));
  }, `${name} node readiness`);
  const pool = context.az(['aks', 'nodepool', 'show', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', name]);
  context.save(`pool-${name}`, pool);
  return pool;
}

const overlayCapacity: AksEndToEndCase = {
  podCidr: '10.244.0.0/17',
  validate() {},
  async run(context) {
    const show = () => context.az(['aks', 'nodepool', 'show', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'capacity']);
    await context.phase('baseline', async () => {
      await addPool(context, 'capacity', ['--enable-cluster-autoscaler', '--min-count', '1', '--max-count', '2']);
      const pool = show();
      assert.equal(pool.enableAutoScaling, true);
      assert.equal(pool.maxCount, 2);
      assert.equal(pool.count, 1);
      const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
      assert.equal(cluster.networkProfile.podCidr, '10.244.0.0/17');
      return { pool, network: cluster.networkProfile };
    });
    await context.phase('fault', async () => {
      const result = context.attemptAz(['aks', 'nodepool', 'update', '--resource-group', context.resourceGroup,
        '--cluster-name', 'research', '--name', 'capacity', '--update-cluster-autoscaler', '--min-count', '1', '--max-count', '200']);
      context.save('capacity-request-result', result);
      assert.notEqual(result.status, 0, 'The theoretical capacity request was accepted; fault not reproduced');
      assert.match(result.stderr, /pod.*(cidr|address|ip)|(?:cidr|address).*node/i);
      const pool = show();
      assert.equal(pool.count, 1);
      assert.equal(pool.maxCount, 2);
      return { result, pool };
    });
    await context.phase('recovery', async () => {
      context.az(['aks', 'nodepool', 'update', '--resource-group', context.resourceGroup,
        '--cluster-name', 'research', '--name', 'capacity', '--update-cluster-autoscaler', '--min-count', '1', '--max-count', '3']);
      const pool = show();
      assert.equal(pool.maxCount, 3);
      assert.equal(pool.count, 1);
      return pool;
    });
  },
};

const initialCount: AksEndToEndCase = {
  validate(parameters) {
    requiredParameter(parameters, 'azureCliVersion', /^\d+\.\d+\.\d+$/);
    requiredParameter(parameters, 'poolNodeCeiling', /^4$/);
  },
  async run(context) {
    assert.equal(context.az(['version'])['azure-cli'], context.parameters.azureCliVersion, 'CLI version mismatch');
    const add = (name: string, counts: string[]) => ['aks', 'nodepool', 'add', '--resource-group', context.resourceGroup,
      '--cluster-name', 'research', '--name', name, '--node-vm-size', context.nodeVmSize,
      '--mode', 'User', '--enable-cluster-autoscaler', '--min-count', '4', '--max-count', '4',
      '--tags', `headlamp-e2e-owner=${context.owner}`, ...counts];
    const show = (name: string) => context.az(['aks', 'nodepool', 'show', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', name]);
    await context.phase('baseline', async () => {
      context.az(add('control', ['--node-count', '4']));
      const pool = show('control');
      assert.equal(pool.count, 4);
      assert.equal(pool.provisioningState, 'Succeeded');
      context.az(['aks', 'nodepool', 'delete', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'control']);
      return pool;
    });
    await context.phase('fault', async () => {
      const result = context.attemptAz(add('subject', []));
      context.save('initial-count-result', result);
      assert.notEqual(result.status, 0, 'Omitted node-count was accepted; fault not reproduced');
      assert.match(result.stderr, /node.count.*(?:range|min.count|max.count)/i);
      const pools = context.az(['aks', 'nodepool', 'list', '--resource-group', context.resourceGroup, '--cluster-name', 'research']);
      assert.ok(!pools.some((pool: any) => pool.name === 'subject'), 'Rejected request still created a pool');
      return { result, pools };
    });
    await context.phase('recovery', async () => {
      context.az(add('subject', ['--node-count', '4']));
      const pool = show('subject');
      assert.equal(pool.count, 4);
      assert.equal(pool.minCount, 4);
      assert.equal(pool.maxCount, 4);
      assert.equal(pool.provisioningState, 'Succeeded');
      return pool;
    });
  },
};

function imageVolumeCase(azureLinux: boolean): AksEndToEndCase {
  return {
    validate(parameters) {
      requiredParameter(parameters, 'artifactImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
      requiredParameter(parameters, 'artifactSubPath', /^[a-zA-Z0-9_-]+$/);
      requiredParameter(parameters, 'artifactFile', /^[a-zA-Z0-9_-]+$/);
      requiredParameter(parameters, 'artifactFileSha256', /^[a-f0-9]{64}$/);
      if (azureLinux) requiredParameter(parameters, 'affectedNodeImageVersion', /^[a-zA-Z0-9._-]+$/);
    },
    async run(context) {
      if (azureLinux) {
        const pool = await addPool(context, 'affected', ['--os-sku', 'AzureLinux']);
        assert.equal(pool.nodeImageVersion, context.parameters.affectedNodeImageVersion, 'Affected node image is unavailable');
      }
      const workload = (name: string, subtree: boolean, affected: boolean) => {
        const pod: any = probePod(context, name);
        pod.spec.nodeSelector = { 'kubernetes.io/os': 'linux', ...(affected ? { agentpool: 'affected' } : {}) };
        if (azureLinux && !affected) pod.spec.nodeSelector['kubernetes.azure.com/mode'] = 'system';
        pod.spec.volumes = [{ name: 'artifact', image: { reference: context.parameters.artifactImage, pullPolicy: 'IfNotPresent' } }];
        pod.spec.containers[0].volumeMounts = [{ name: 'artifact', mountPath: '/artifact', readOnly: true,
          ...(subtree ? { subPath: context.parameters.artifactSubPath } : {}) }];
        return pod;
      };
      const checksum = (name: string, subtree: boolean) => context.kube(namespaced(context, [
        'exec', name, '--', 'sha256sum', `/artifact/${subtree ? '' : context.parameters.artifactSubPath + '/'}${context.parameters.artifactFile}`,
      ]));
      const expectContent = async (name: string) => {
        const pod = await readyPod(context, name);
        const result = checksum(name, false);
        assert.equal(result.status, 0);
        assert.equal(result.stdout.trim().split(/\s+/)[0], context.parameters.artifactFileSha256);
        return { pod, checksum: result.stdout };
      };
      await context.phase('baseline', async () => {
        context.create('baseline-pod', workload('baseline', false, false));
        return expectContent('baseline');
      });
      await context.phase('fault', async () => {
        context.create('fault-pod', workload('subject', !azureLinux, azureLinux));
        let captured: unknown;
        await context.poll(() => {
          const pod = context.read('pod', 'subject');
          const events = objectEvents(context, pod);
          if (azureLinux) {
            captured = { pod, events };
            context.save('fault-observations', captured);
            return events.items.some((event: any) => /(?:failed to mkdir|mkdir).*?(?:""|'')/i.test(event.message ?? '')) &&
              !pod.status?.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'True');
          }
          const statuses = pod.status?.conditions ?? [];
          if (!statuses.some((condition: any) => condition.type === 'Ready' && condition.status === 'True')) return false;
          const content = checksum('subject', true);
          captured = { pod, events, content };
          context.save('fault-observations', captured);
          return content.status !== 0 || content.stdout.trim().split(/\s+/)[0] !== context.parameters.artifactFileSha256;
        }, azureLinux ? 'Image-volume empty mkdir path failure' : 'Incorrect image-volume subtree');
        await expectContent('baseline');
        return captured;
      });
      await context.phase('recovery', async () => {
        context.run(namespaced(context, ['delete', 'pod', 'subject', '--wait=true', '--timeout=90s']));
        context.create('recovery-pod', workload('subject', false, false));
        return expectContent('subject');
      });
    },
  };
}

export const aksAdditionalEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c024-v1': imageVolumeCase(false),
  'aks-c027-v1': imageVolumeCase(true),
  'aks-c047-v1': overlayCapacity,
  'aks-c048-v1': initialCount,
};