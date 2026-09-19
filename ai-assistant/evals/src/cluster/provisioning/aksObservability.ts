import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import type { CommandRunner } from '../commandRunner.js';
import { parseCpuCores } from '../../scenarios/cases/schedulingCases.js';
import {
  aksObservabilityScenarios as observabilityScenarios,
  type ObservabilityScenarioId,
} from '../../scenarios/observabilityScenarios.js';

const ownerTag = 'headlamp-observability-owner';
const namespace = 'observability-eval';
const backendIp = '10.240.1.4';

interface KubernetesObject {
  metadata?: { name?: string };
  status?: {
    phase?: string;
    allocatable?: { cpu?: string };
    conditions?: Array<{ type: string; status: string }>;
  };
  reason?: string;
  message?: string;
}

interface EffectiveNsgs {
  value?: Array<{ effectiveSecurityRules?: Array<Record<string, unknown>> }>;
}

export function hasEffectiveAksDeny(value: EffectiveNsgs): boolean {
  return (
    value.value?.some(group =>
      group.effectiveSecurityRules?.some(
        rule =>
          rule.name === 'securityRules/block-aks' &&
          rule.access === 'Deny' &&
          rule.direction === 'Inbound' &&
          rule.protocol === 'Tcp' &&
          rule.priority === 100 &&
          rule.sourceAddressPrefix === '10.240.0.0/24' &&
          ['10.240.1.4', '10.240.1.4/32'].includes(String(rule.destinationAddressPrefix)) &&
          ['8080', '8080-8080'].includes(String(rule.destinationPortRange))
      )
    ) === true
  );
}

export interface AksObservabilityOptions {
  scenario: ObservabilityScenarioId;
  subscription: string;
  location: string;
  stateDirectory: string;
  workloadImage: string;
  nodeVmSize?: string;
  acceptAzureCosts: boolean;
  runner?: CommandRunner;
  wait?: (milliseconds: number) => Promise<void>;
}

export interface AksObservabilityState {
  version: 1;
  owner: string;
  subscription: string;
  location: string;
  resourceGroup: string;
  nodeResourceGroup: string;
  clusterId: string;
  scenario: ObservabilityScenarioId;
  cleanup: 'pending' | 'passed' | 'failed';
}

export interface LiveAksEvidence {
  task: string;
  clusterId: string;
  resourceId: string;
  tool: 'azure_network_config_read' | 'azure_cost_capacity_read';
  args: Record<string, unknown>;
  kubernetesSnapshot: unknown;
  baseline: unknown;
  fault: unknown;
}

export function boundedAzureRunner(): CommandRunner {
  return (command, args) => {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      timeout: 35 * 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.error ? 'Command timed out or could not start' : result.stderr ?? '',
    };
  };
}

function command(runner: CommandRunner, executable: string, args: string[]): string {
  const result = runner(executable, args);
  if (result.status !== 0)
    throw new Error(`${executable} ${args.slice(0, 2).join(' ')} failed (exit ${result.status})`);
  return result.stdout.trim();
}

function azure(
  runner: CommandRunner,
  state: Pick<AksObservabilityState, 'subscription'>,
  args: string[]
): string {
  return command(runner, 'az', [
    ...args,
    '--subscription',
    state.subscription,
    '--only-show-errors',
    '-o',
    'json',
  ]);
}

function saveState(directory: string, state: AksObservabilityState): void {
  writeFileSync(path.join(directory, 'state.json'), JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
}

export async function eventually<T>(
  name: string,
  read: () => T,
  predicate: (value: T) => boolean,
  wait: (milliseconds: number) => Promise<void>,
  attempts = 60
): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = read();
    if (predicate(value)) return value;
    if (attempt + 1 < attempts) await wait(10_000);
  }
  throw new Error(`${name} did not converge within ${attempts} observations`);
}

export function validateAksObservabilityState(value: unknown): AksObservabilityState {
  assert.ok(value && typeof value === 'object');
  const state = value as AksObservabilityState;
  assert.equal(state.version, 1);
  assert.match(state.owner, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.match(state.subscription, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  assert.equal(state.resourceGroup, `rg-hl-observability-${state.owner}`);
  assert.equal(state.nodeResourceGroup, `${state.resourceGroup}-nodes`);
  assert.equal(
    state.clusterId,
    `/subscriptions/${state.subscription}/resourceGroups/${state.resourceGroup}/providers/Microsoft.ContainerService/managedClusters/eval`
  );
  assert.ok(observabilityScenarios.some(scenario => scenario.id === state.scenario));
  return state;
}

export async function cleanupAksObservability(
  directory: string,
  runner = boundedAzureRunner(),
  wait: (milliseconds: number) => Promise<void> = setTimeout
): Promise<void> {
  const state = validateAksObservabilityState(
    JSON.parse(readFileSync(path.join(directory, 'state.json'), 'utf8'))
  );
  try {
    const exists = JSON.parse(
      azure(runner, state, ['group', 'exists', '--name', state.resourceGroup])
    );
    assert.equal(typeof exists, 'boolean');
    if (exists) {
      const group = JSON.parse(
        azure(runner, state, ['group', 'show', '--name', state.resourceGroup])
      );
      assert.equal(
        group.tags?.[ownerTag],
        state.owner,
        'Refusing to delete an unowned resource group'
      );
      azure(runner, state, ['group', 'delete', '--name', state.resourceGroup, '--yes']);
    }
    await eventually(
      'resource group deletion',
      () => JSON.parse(azure(runner, state, ['group', 'exists', '--name', state.resourceGroup])),
      value => value === false,
      wait
    );
    await eventually(
      'AKS managed node resource group deletion',
      () =>
        JSON.parse(azure(runner, state, ['group', 'exists', '--name', state.nodeResourceGroup])),
      value => value === false,
      wait
    );
    state.cleanup = 'passed';
    saveState(directory, state);
  } catch (error) {
    state.cleanup = 'failed';
    saveState(directory, state);
    throw error;
  }
}

export async function withAksObservabilityFault<T>(
  options: AksObservabilityOptions,
  investigate: (evidence: LiveAksEvidence) => Promise<T>
): Promise<{
  candidate: T;
  baseline: unknown;
  fault: unknown;
  recovery: unknown;
  cleanup: 'passed';
}> {
  assert.equal(options.acceptAzureCosts, true, 'Explicit --accept-azure-costs is required');
  assert.match(options.subscription, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
  assert.match(options.location, /^[a-z0-9]+$/);
  const nodeVmSize = options.nodeVmSize ?? 'Standard_D2s_v5';
  assert.match(nodeVmSize, /^Standard_[A-Za-z0-9_]+$/);
  assert.match(
    options.workloadImage,
    /^[a-zA-Z0-9./:_-]+@sha256:[0-9a-f]{64}$/,
    'Use an immutable BusyBox-compatible image'
  );
  const scenario = observabilityScenarios.find(item => item.id === options.scenario);
  assert.ok(scenario, 'Unknown AKS observability scenario');
  const runner = options.runner ?? boundedAzureRunner();
  const wait = options.wait ?? setTimeout;
  assert.equal(
    command(runner, 'az', ['cloud', 'show', '--query', 'name', '-o', 'tsv']),
    'AzureCloud',
    'Only public Azure is supported'
  );
  const account = JSON.parse(azure(runner, options, ['account', 'show']));
  assert.equal(account.id?.toLowerCase(), options.subscription.toLowerCase());
  mkdirSync(options.stateDirectory, { mode: 0o700 });
  chmodSync(options.stateDirectory, 0o700);
  const owner = randomUUID();
  const resourceGroup = `rg-hl-observability-${owner}`;
  const nodeResourceGroup = `${resourceGroup}-nodes`;
  const clusterId = `/subscriptions/${options.subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.ContainerService/managedClusters/eval`;
  const state: AksObservabilityState = {
    version: 1,
    owner,
    subscription: options.subscription,
    location: options.location,
    resourceGroup,
    nodeResourceGroup,
    clusterId,
    scenario: options.scenario,
    cleanup: 'pending',
  };
  const az = (args: string[]) => azure(runner, state, args);
  assert.equal(
    JSON.parse(az(['group', 'exists', '--name', resourceGroup])),
    false,
    'Refusing to reuse a resource group'
  );
  assert.equal(
    JSON.parse(az(['group', 'exists', '--name', nodeResourceGroup])),
    false,
    'Refusing to reuse a node resource group'
  );
  saveState(options.stateDirectory, state);
  const journal: Array<{ phase: string; at: string; evidence?: unknown }> = [];
  const record = (phase: string, evidence?: unknown) => {
    journal.push({ phase, at: new Date().toISOString(), evidence });
    writeFileSync(
      path.join(options.stateDirectory, 'lifecycle.json'),
      JSON.stringify(journal, null, 2),
      { mode: 0o600 }
    );
  };
  const kubeconfig = path.join(options.stateDirectory, 'kubeconfig');
  const kube = (args: string[]) =>
    command(runner, 'kubectl', [
      '--kubeconfig',
      kubeconfig,
      '--context',
      owner,
      args[0] === 'rollout' || args[0] === 'wait'
        ? '--request-timeout=910s'
        : '--request-timeout=60s',
      ...args,
    ]);
  const apply = (manifest: unknown) => {
    const filename = path.join(options.stateDirectory, 'workload.json');
    writeFileSync(filename, JSON.stringify(manifest), { mode: 0o600 });
    kube(['apply', '-f', filename]);
  };
  const deployment = (
    replicas: number,
    resources: unknown = {},
    selector: Record<string, string> = {}
  ) => ({
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: 'workload', namespace },
    spec: {
      replicas,
      selector: { matchLabels: { app: 'workload' } },
      template: {
        metadata: { labels: { app: 'workload' } },
        spec: {
          nodeSelector: selector,
          containers: [
            {
              name: 'workload',
              image: options.workloadImage,
              command: [
                'sh',
                '-c',
                'mkdir -p /tmp/www; echo ready > /tmp/www/index.html; httpd -f -p 8080 -h /tmp/www',
              ],
              resources,
              readinessProbe: {
                httpGet: { path: '/', port: 8080 },
                initialDelaySeconds: 2,
                periodSeconds: 2,
              },
            },
          ],
        },
      },
    },
  });
  const pods = (): { items: KubernetesObject[] } =>
    JSON.parse(kube(['get', 'pods', '-n', namespace, '-l', 'app=workload', '-o', 'json']));
  const ready = (pod: KubernetesObject) =>
    pod.status?.conditions?.some(
      condition => condition.type === 'Ready' && condition.status === 'True'
    );
  const rollout = () =>
    kube(['rollout', 'status', 'deployment/workload', '-n', namespace, '--timeout=900s']);
  const snapshot = () => ({
    pods: pods(),
    events: JSON.parse(kube(['get', 'events', '-n', namespace, '-o', 'json'])),
  });
  let groupCreated = false;
  let result:
    | { candidate: T; baseline: unknown; fault: unknown; recovery: unknown; cleanup: 'passed' }
    | undefined;
  try {
    record('setup-started');
    groupCreated = true;
    az([
      'group',
      'create',
      '--name',
      resourceGroup,
      '--location',
      options.location,
      '--tags',
      `${ownerTag}=${owner}`,
      'purpose=disposable-aks-fault-eval',
    ]);
    const key = path.join(options.stateDirectory, 'ssh');
    command(runner, 'ssh-keygen', ['-q', '-t', 'rsa', '-b', '4096', '-N', '', '-f', key]);
    az([
      'network',
      'vnet',
      'create',
      '-g',
      resourceGroup,
      '-n',
      'eval',
      '--address-prefixes',
      '10.240.0.0/16',
      '--subnet-name',
      'nodes',
      '--subnet-prefixes',
      '10.240.0.0/24',
    ]);
    const subnet = `/subscriptions/${state.subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/virtualNetworks/eval/subnets/nodes`;
    az([
      'aks',
      'create',
      '-g',
      resourceGroup,
      '-n',
      'eval',
      '--node-resource-group',
      nodeResourceGroup,
      '--node-count',
      '1',
      '--node-vm-size',
      nodeVmSize,
      '--enable-managed-identity',
      '--network-plugin',
      'azure',
      '--network-plugin-mode',
      'overlay',
      '--pod-cidr',
      '10.244.0.0/16',
      '--vnet-subnet-id',
      subnet,
      '--service-cidr',
      '10.250.0.0/16',
      '--dns-service-ip',
      '10.250.0.10',
      '--ssh-key-value',
      `${key}.pub`,
      '--tier',
      'free',
      '--if-none-match',
      '*',
    ]);
    az([
      'aks',
      'get-credentials',
      '-g',
      resourceGroup,
      '-n',
      'eval',
      '--file',
      kubeconfig,
      '--context',
      owner,
    ]);
    chmodSync(kubeconfig, 0o600);
    kube(['create', 'namespace', namespace]);
    let baseline: unknown;
    let fault: unknown;
    let recovery: unknown;
    let candidate: T;
    if (scenario.id === 'aks-private-backend-nsg-deny-v1') {
      az([
        'network',
        'vnet',
        'subnet',
        'create',
        '-g',
        resourceGroup,
        '--vnet-name',
        'eval',
        '-n',
        'backend',
        '--address-prefixes',
        '10.240.1.0/24',
      ]);
      az(['network', 'nsg', 'create', '-g', resourceGroup, '-n', 'backend']);
      az([
        'network',
        'nic',
        'create',
        '-g',
        resourceGroup,
        '-n',
        'backend',
        '--vnet-name',
        'eval',
        '--subnet',
        'backend',
        '--private-ip-address',
        backendIp,
        '--network-security-group',
        'backend',
      ]);
      const cloudInit = path.join(options.stateDirectory, 'cloud-init.yaml');
      writeFileSync(
        cloudInit,
        '#cloud-config\nruncmd:\n  - [sh, -c, "mkdir -p /srv/eval; echo ready > /srv/eval/index.html"]\n  - [sh, -c, "systemd-run --unit=eval-http --property=Restart=always /usr/bin/python3 -m http.server 8080 --directory /srv/eval"]\n',
        { mode: 0o600 }
      );
      az([
        'vm',
        'create',
        '-g',
        resourceGroup,
        '-n',
        'backend',
        '--nics',
        'backend',
        '--image',
        'Canonical:0001-com-ubuntu-server-jammy:22_04-lts:22.04.202608060',
        '--size',
        'Standard_B1s',
        '--admin-username',
        'evaluser',
        '--ssh-key-values',
        `${key}.pub`,
        '--custom-data',
        cloudInit,
      ]);
      apply(deployment(1));
      rollout();
      const pod = pods().items.find(ready)?.metadata?.name;
      assert.ok(typeof pod === 'string' && pod.length > 0);
      const probe = () =>
        runner('kubectl', [
          '--kubeconfig',
          kubeconfig,
          '--context',
          owner,
          '--request-timeout=30s',
          'exec',
          '-n',
          namespace,
          pod,
          '--',
          'sh',
          '-c',
          `wget -T 5 -qO- http://${backendIp}:8080/ >/dev/null && echo CONNECTED || echo BLOCKED`,
        ]);
      const checkConnectivity = async (expected: string) => {
        let consecutive = 0;
        return eventually(
          `Pod connectivity ${expected}`,
          probe,
          value => {
            assert.equal(value.status, 0, 'Pod exec failed, not a network-fault observation');
            consecutive = value.stdout.trim() === expected ? consecutive + 1 : 0;
            return consecutive >= 3;
          },
          wait
        );
      };
      baseline = await checkConnectivity('CONNECTED');
      record('baseline-passed', baseline);
      az([
        'network',
        'nsg',
        'rule',
        'create',
        '-g',
        resourceGroup,
        '--nsg-name',
        'backend',
        '-n',
        'block-aks',
        '--priority',
        '100',
        '--direction',
        'Inbound',
        '--access',
        'Deny',
        '--protocol',
        'Tcp',
        '--source-address-prefixes',
        '10.240.0.0/24',
        '--source-port-ranges',
        '*',
        '--destination-address-prefixes',
        backendIp,
        '--destination-port-ranges',
        '8080',
      ]);
      const blocked = await checkConnectivity('BLOCKED');
      assert.equal(
        pods().items.filter(ready).length,
        1,
        'Workload must remain Ready during the fault'
      );
      const local = JSON.parse(
        az([
          'vm',
          'run-command',
          'invoke',
          '-g',
          resourceGroup,
          '-n',
          'backend',
          '--command-id',
          'RunShellScript',
          '--scripts',
          "python3 -c \"import urllib.request; assert urllib.request.urlopen('http://127.0.0.1:8080',timeout=5).status == 200; print('BACKEND_HEALTHY')\"",
        ])
      );
      assert.ok(
        local.value?.some((item: { message?: string }) =>
          /(?:^|\n)BACKEND_HEALTHY(?:\r?\n|$)/.test(item.message ?? '')
        ),
        'Backend itself must be healthy'
      );
      const effective = await eventually(
        'effective deny propagation',
        (): EffectiveNsgs =>
          JSON.parse(
            az(['network', 'nic', 'list-effective-nsg', '-g', resourceGroup, '-n', 'backend'])
          ),
        hasEffectiveAksDeny,
        wait
      );
      fault = { blocked, backendHealthy: true, effective };
      record('fault-observed', fault);
      candidate = await investigate({
        task: 'A Ready AKS workload can no longer reach its private backend at 10.240.1.4:8080. Investigate the Azure networking cause without changing resources.',
        clusterId,
        resourceId: `/subscriptions/${state.subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/networkInterfaces/backend`,
        tool: scenario.tool,
        args: {
          action: 'effective_nsgs',
          resourceId: `/subscriptions/${state.subscription}/resourceGroups/${resourceGroup}/providers/Microsoft.Network/networkInterfaces/backend`,
        },
        kubernetesSnapshot: snapshot(),
        baseline,
        fault,
      });
      az([
        'network',
        'nsg',
        'rule',
        'delete',
        '-g',
        resourceGroup,
        '--nsg-name',
        'backend',
        '-n',
        'block-aks',
      ]);
      recovery = await checkConnectivity('CONNECTED');
    } else {
      az([
        'aks',
        'nodepool',
        'add',
        '-g',
        resourceGroup,
        '--cluster-name',
        'eval',
        '-n',
        'target',
        '--node-count',
        '1',
        '--node-vm-size',
        nodeVmSize,
        '--mode',
        'User',
        '--enable-cluster-autoscaler',
        '--min-count',
        '1',
        '--max-count',
        '1',
      ]);
      kube(['wait', 'nodes', '-l', 'agentpool=target', '--for=condition=Ready', '--timeout=900s']);
      const nodes: { items: KubernetesObject[] } = JSON.parse(
        kube(['get', 'nodes', '-l', 'agentpool=target', '-o', 'json'])
      );
      assert.equal(nodes.items.length, 1);
      const allocatable = nodes.items[0]?.status?.allocatable?.cpu;
      assert.ok(allocatable);
      const cpu = Math.floor(parseCpuCores(allocatable) * 600);
      assert.ok(cpu > 0);
      apply(
        deployment(1, { requests: { cpu: `${cpu}m`, memory: '32Mi' } }, { agentpool: 'target' })
      );
      rollout();
      baseline = snapshot();
      record('baseline-passed', baseline);
      kube(['scale', 'deployment/workload', '-n', namespace, '--replicas=2']);
      const pending = await eventually(
        'CPU-limited Pending replica',
        snapshot,
        value =>
          value.pods.items.filter(ready).length === 1 &&
          value.pods.items.some(pod => pod.status?.phase === 'Pending') &&
          value.events.items.some(
            (event: KubernetesObject) =>
              event.reason === 'FailedScheduling' && event.message?.includes('Insufficient cpu')
          ),
        wait
      );
      const pool = JSON.parse(
        az([
          'aks',
          'nodepool',
          'show',
          '-g',
          resourceGroup,
          '--cluster-name',
          'eval',
          '-n',
          'target',
        ])
      );
      assert.equal(pool.enableAutoScaling, true);
      assert.equal(pool.count, 1);
      assert.equal(pool.maxCount, 1);
      fault = { pending, pool };
      record('fault-observed', fault);
      candidate = await investigate({
        task: 'An AKS workload has a Pending replica with insufficient CPU while its existing replica is healthy. Determine why AKS is not adding the required node; use read-only evidence.',
        clusterId,
        resourceId: clusterId,
        tool: scenario.tool,
        args: { action: 'node_pools', clusterResourceId: clusterId },
        kubernetesSnapshot: pending,
        baseline,
        fault,
      });
      await eventually(
        'autoscaler maximum recovery update',
        () =>
          runner('az', [
            'aks',
            'nodepool',
            'update',
            '-g',
            resourceGroup,
            '--cluster-name',
            'eval',
            '-n',
            'target',
            '--update-cluster-autoscaler',
            '--min-count',
            '1',
            '--max-count',
            '2',
            '--subscription',
            state.subscription,
            '--only-show-errors',
            '-o',
            'json',
          ]),
        result => {
          if (result.status === 0) return true;
          if (
            /\bOperationNotAllowed\b/.test(result.stderr) &&
            /in-progress [^\r\n]+ operation/.test(result.stderr)
          )
            return false;
          throw new Error(`az aks nodepool recovery failed (exit ${result.status})`);
        },
        wait
      );
      rollout();
      const scaled = await eventually(
        'autoscaler scale-out',
        () => JSON.parse(kube(['get', 'nodes', '-l', 'agentpool=target', '-o', 'json'])),
        value => value.items.length === 2 && value.items.every(ready),
        wait
      );
      assert.equal(pods().items.filter(ready).length, 2);
      recovery = { nodes: scaled, snapshot: snapshot() };
    }
    record('recovery-passed', recovery);
    result = { candidate, baseline, fault, recovery, cleanup: 'passed' };
  } catch (error) {
    record('failed');
    throw error;
  } finally {
    if (groupCreated) {
      record('cleanup-started');
      try {
        await cleanupAksObservability(options.stateDirectory, runner, wait);
        record('cleanup-passed');
      } catch (error) {
        record('cleanup-failed');
        throw error;
      }
    }
  }
  assert.ok(result);
  return result;
}
