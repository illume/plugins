import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import type { CommandRunner } from '../commandRunner.js';
import { aksCandidateReproductions } from '../../scenarios/aksCandidateReproductions.js';

export interface BatchOptions {
  scenario: string;
  stateDirectory: string;
  kubeconfig: string;
  context: string;
  acceptClusterMutations: boolean;
  probeImage: string;
  runner?: CommandRunner;
  wait?: (milliseconds: number) => Promise<void>;
}

const ownerLabel = 'headlamp-research-owner';
const clientId = '11111111-1111-4111-8111-111111111111';
const secondClientId = '22222222-2222-4222-8222-222222222222';
const identityLabel = 'azure.workload.identity/use';
const proxyAnnotation = 'azure.workload.identity/inject-proxy-sidecar';
const clientAnnotation = 'azure.workload.identity/client-id';

const realRunner: CommandRunner = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.error ? 'Process failed or timed out' : result.stderr ?? '',
  };
};

function save(directory: string, name: string, value: unknown) {
  const file = path.join(directory, `${name}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600, flush: true });
  renameSync(`${file}.tmp`, file);
}

interface BatchState {
  schema_version: 'aks-component-batch@1.0.0';
  scenario: string;
  owner: string;
  namespace: string;
  kubeconfig: string;
  context: string;
  server: string;
  owned: Array<{ kind: string; name: string; uid: string | null }>;
  phases: Record<string, 'not-run' | 'running' | 'passed' | 'failed'>;
  qualification: 'pending';
  error: string | null;
  modelInvocations: 0;
  probeImage: string;
  scope: string;
}

function client(config: { kubeconfig: string; context: string }, runner: CommandRunner) {
  assert.ok(path.isAbsolute(config.kubeconfig));
  assert.ok(config.context && !config.context.startsWith('-'));
  return (args: string[]) =>
    runner('kubectl', [
      '--kubeconfig',
      config.kubeconfig,
      '--context',
      config.context,
      '--request-timeout=10s',
      ...args,
    ]);
}

function server(invoke: ReturnType<typeof client>) {
  const result = invoke([
    'config',
    'view',
    '--minify',
    '-o',
    'jsonpath={.clusters[0].cluster.server}',
  ]);
  assert.equal(result.status, 0);
  const address = result.stdout.trim();
  const url = new URL(address);
  assert.ok(url.protocol === 'https:' && !url.username && !url.password);
  return address;
}

export function cleanupAksCandidateBatch(directory: string, runner: CommandRunner = realRunner) {
  const state: BatchState = JSON.parse(
    readFileSync(path.join(directory, 'reproduction-state.json'), 'utf8')
  );
  assert.equal(state.schema_version, 'aks-component-batch@1.0.0');
  assert.match(state.owner, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.ok(aksCandidateReproductions.some(item => item.id === state.scenario));
  const prefix = `hl-${state.scenario.slice(0, -3)}-${state.owner}`;
  assert.equal(state.namespace, prefix);
  const invoke = client(state, runner);
  const failures: string[] = [];
  try {
    assert.equal(server(invoke), state.server, 'Cluster endpoint changed');
    for (const resource of [...state.owned].reverse()) {
      assert.ok(
        resource.kind === 'namespace' ||
          (state.scenario === 'aks-c001-v1' && resource.kind === 'customresourcedefinition')
      );
      assert.ok(
        resource.kind === 'namespace'
          ? resource.name === prefix
          : ['a', 'b'].some(
              suffix => resource.name === `widgets.${suffix}-${state.owner}.research.example`
            )
      );
      const read = invoke([
        'get',
        resource.kind,
        resource.name,
        '--ignore-not-found',
        '-o',
        'json',
      ]);
      if (read.status !== 0) {
        failures.push(resource.name);
        continue;
      }
      if (!read.stdout.trim()) continue;
      const object = JSON.parse(read.stdout);
      if (
        object.metadata?.labels?.[ownerLabel] !== state.owner ||
        (resource.uid && object.metadata?.uid !== resource.uid)
      ) {
        failures.push(resource.name);
        continue;
      }
      const deleted = invoke([
        'delete',
        resource.kind,
        resource.name,
        '--wait=true',
        '--timeout=60s',
      ]);
      const absent = invoke([
        'get',
        resource.kind,
        resource.name,
        '--ignore-not-found',
        '-o',
        'json',
      ]);
      if (deleted.status !== 0 || absent.status !== 0 || absent.stdout.trim())
        failures.push(resource.name);
    }
    assert.deepEqual(failures, [], 'Owned-resource cleanup failed; retain state');
    state.phases.cleanup = 'passed';
  } catch (error) {
    state.phases.cleanup = 'failed';
    throw error;
  } finally {
    save(directory, 'reproduction-state', state);
  }
}

export async function verifyAksCandidateBatch(options: BatchOptions) {
  const definition = aksCandidateReproductions.find(
    item => item.id === options.scenario && item.id !== 'aks-c059-v1'
  );
  assert.ok(definition, 'Unsupported batch candidate');
  assert.equal(
    options.acceptClusterMutations,
    true,
    'Explicit cluster mutation acknowledgement required'
  );
  assert.match(options.probeImage, /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
  const runner = options.runner ?? realRunner;
  const invoke = client({ ...options, kubeconfig: path.resolve(options.kubeconfig) }, runner);
  const endpoint = server(invoke);
  const owner = randomUUID();
  const namespace = `hl-${options.scenario.slice(0, -3)}-${owner}`;
  mkdirSync(options.stateDirectory, { mode: 0o700 });
  const state: BatchState = {
    schema_version: 'aks-component-batch@1.0.0',
    scenario: options.scenario,
    owner,
    namespace,
    kubeconfig: path.resolve(options.kubeconfig),
    context: options.context,
    server: endpoint,
    owned: [],
    phases: { baseline: 'not-run', fault: 'not-run', recovery: 'not-run', cleanup: 'not-run' },
    qualification: 'pending',
    error: null,
    modelInvocations: 0,
    probeImage: options.probeImage,
    scope: definition.scope!,
  };
  const persist = () => save(options.stateDirectory, 'reproduction-state', state);
  const run = (args: string[]) => {
    const result = invoke(args);
    assert.equal(result.status, 0, `kubectl ${args[0]}: ${result.stderr.slice(0, 1500)}`);
    return result.stdout;
  };
  const scoped = (args: string[]) => ['-n', namespace, ...args];
  const read = (kind: string, name: string) =>
    JSON.parse(run(scoped(['get', kind, name, '-o', 'json'])));
  let serial = 0;
  const request = (
    resource: any,
    operation: 'create' | 'replace' | 'apply' = 'create',
    extra: string[] = []
  ) => {
    const file = `request-${++serial}`;
    save(options.stateDirectory, file, resource);
    return invoke([operation, '-f', path.join(options.stateDirectory, `${file}.json`), ...extra]);
  };
  const put = (resource: any, operation: 'create' | 'replace' | 'apply' = 'create') => {
    const result = request(resource, operation);
    assert.equal(result.status, 0, result.stderr.slice(0, 1500));
  };
  const own = (resource: any, kind: string) => {
    state.owned.push({ kind, name: resource.metadata.name, uid: null });
    persist();
    put(resource);
    const object = JSON.parse(run(['get', kind, resource.metadata.name, '-o', 'json']));
    assert.equal(object.metadata.labels[ownerLabel], owner);
    state.owned.at(-1)!.uid = object.metadata.uid;
    persist();
  };
  const metadata = (name: string) => ({
    name,
    namespace,
    labels: { [ownerLabel]: owner } as Record<string, string>,
  });
  const poll = async (
    operation: () => any,
    accept: (value: any) => boolean,
    description: string
  ) => {
    const deadline = Date.now() + 90_000;
    for (let attempt = 0; attempt < 90 && Date.now() < deadline; attempt++) {
      const value = operation();
      if (accept(value)) return value;
      await (options.wait ?? setTimeout)(1000);
    }
    throw new Error(`${description} did not converge`);
  };
  const podReady = (pod: any) =>
    pod.status?.conditions?.some((item: any) => item.type === 'Ready' && item.status === 'True');
  const ready = (name: string) => poll(() => read('pod', name), podReady, `${name} Ready`);
  const app = (name: string, enabled = false, proxy?: string) => ({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      ...metadata(name),
      labels: { ...metadata(name).labels, ...(enabled ? { [identityLabel]: 'true' } : {}) },
      annotations: proxy === undefined ? {} : { [proxyAnnotation]: proxy },
    },
    spec: {
      serviceAccountName: 'identity-a',
      restartPolicy: 'Never',
      securityContext: { runAsUser: 1000 },
      containers: [
        {
          name: 'app',
          image: options.probeImage,
          command: ['sh', '-c', 'exec tail -f /dev/null'],
          resources: {
            requests: { cpu: '10m', memory: '16Mi' },
            limits: { cpu: '100m', memory: '64Mi' },
          },
        },
      ],
    },
  });
  const admission = (pod: any) => {
    const result = request(pod, 'create', ['--dry-run=server', '-o', 'json']);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const environment = (pod: any, name: string) =>
    pod.spec.containers
      .find((container: any) => container.name === 'app')
      ?.env?.find((variable: any) => variable.name === name)?.value;
  const hasProxy = (pod: any) =>
    pod.spec.containers.some((container: any) => container.name === 'azwi-proxy');
  const phase = async (name: 'baseline' | 'fault' | 'recovery', action: () => Promise<any>) => {
    state.phases[name] = 'running';
    persist();
    assert.equal(server(invoke), endpoint, 'Cluster endpoint changed');
    const observations = await action();
    save(options.stateDirectory, `${name}-evidence`, observations);
    state.phases[name] = 'passed';
    persist();
  };
  let failure: unknown;
  persist();
  try {
    own(
      {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name: namespace,
          labels: { [ownerLabel]: owner, 'headlamp-research-batch': 'true' },
        },
      },
      'namespace'
    );
    put({
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: { ...metadata('identity-a'), annotations: { [clientAnnotation]: clientId } },
    });
    if (options.scenario >= 'aks-c094-v1') {
      const webhook = JSON.parse(
        run([
          'get',
          'mutatingwebhookconfiguration',
          'azure-wi-webhook-mutating-webhook-configuration',
          '-o',
          'json',
        ])
      );
      assert.ok(
        webhook.webhooks.every(
          (item: any) => item.namespaceSelector?.matchLabels?.['headlamp-research-batch'] === 'true'
        ),
        'Webhook must be restricted to owned research namespaces'
      );
      const deployment = JSON.parse(
        run([
          '-n',
          'azure-workload-identity-system',
          'get',
          'deployment',
          'azure-wi-webhook-controller-manager',
          '-o',
          'json',
        ])
      );
      assert.match(deployment.spec.template.spec.containers[0].image, /@sha256:[a-f0-9]{64}$/);
      save(options.stateDirectory, 'component', {
        image: deployment.spec.template.spec.containers[0].image,
        webhook,
      });
      const control = await poll(
        () => admission(app('admission-check', true)),
        pod => environment(pod, 'AZURE_CLIENT_ID') === clientId,
        'Identity admission'
      );
      save(options.stateDirectory, 'admission-preflight', control);
    }
    const number = options.scenario.slice(5, 8);
    if (number === '001') {
      const groups = ['a', 'b'].map(suffix => `${suffix}-${owner}.research.example`);
      const short = `hr${owner.replaceAll('-', '').slice(0, 12)}`;
      const crd = (group: string) => ({
        apiVersion: 'apiextensions.k8s.io/v1',
        kind: 'CustomResourceDefinition',
        metadata: { name: `widgets.${group}`, labels: { [ownerLabel]: owner } },
        spec: {
          group,
          scope: 'Namespaced',
          names: { plural: 'widgets', singular: 'widget', kind: 'Widget', shortNames: [short] },
          versions: [
            {
              name: 'v1',
              served: true,
              storage: true,
              schema: {
                openAPIV3Schema: {
                  type: 'object',
                  properties: {
                    spec: { type: 'object', 'x-kubernetes-preserve-unknown-fields': true },
                  },
                },
              },
            },
          ],
        },
      });
      const lookup = (resource: string, name: string) =>
        invoke(
          scoped([
            'get',
            resource,
            name,
            '-o',
            'json',
            '--cache-dir',
            path.join(options.stateDirectory, `discovery-${++serial}`),
          ])
        );
      await phase('baseline', async () => {
        own(crd(groups[0]!), 'customresourcedefinition');
        run(['wait', '--for=condition=Established', `crd/widgets.${groups[0]}`, '--timeout=60s']);
        put({
          apiVersion: `${groups[0]}/v1`,
          kind: 'Widget',
          metadata: metadata('original'),
          spec: {},
        });
        const result = lookup(short, 'original');
        assert.equal(result.status, 0, result.stderr);
        return JSON.parse(result.stdout);
      });
      let losing = '';
      await phase('fault', async () => {
        own(crd(groups[1]!), 'customresourcedefinition');
        run(['wait', '--for=condition=Established', `crd/widgets.${groups[1]}`, '--timeout=60s']);
        const choice = lookup(short, 'original');
        const chosenGroup =
          choice.status === 0 ? JSON.parse(choice.stdout).apiVersion.split('/')[0] : groups[1];
        losing = groups.find(group => group !== chosenGroup)!;
        put({
          apiVersion: `${losing}/v1`,
          kind: 'Widget',
          metadata: metadata('collision-target'),
          spec: {},
        });
        const unqualified = lookup(short, 'collision-target');
        const qualified = lookup(`widgets.${losing}`, 'collision-target');
        assert.notEqual(unqualified.status, 0);
        assert.match(unqualified.stderr, /not found|NotFound/);
        assert.equal(qualified.status, 0);
        return {
          unqualified,
          qualified: JSON.parse(qualified.stdout),
          groups,
          short,
          fidelity: 'Generated colliding API groups, not managed addon CRDs',
        };
      });
      await phase('recovery', async () => {
        const result = lookup(`widgets.${losing}`, 'collision-target');
        assert.equal(result.status, 0);
        return JSON.parse(result.stdout);
      });
    } else if (number === '029') {
      const deployment = (label: string) => ({
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: metadata('controller'),
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: label } },
          template: {
            metadata: { labels: { app: label } },
            spec: { ...app('unused').spec, restartPolicy: 'Always' },
          },
        },
      });
      const rollout = () =>
        run(scoped(['rollout', 'status', 'deployment/controller', '--timeout=60s']));
      await phase('baseline', async () => {
        put(deployment('old'));
        rollout();
        return read('deployment', 'controller');
      });
      await phase('fault', async () => {
        const object = read('deployment', 'controller');
        object.spec.selector.matchLabels.app = 'new';
        object.spec.template.metadata.labels.app = 'new';
        const result = request(object, 'replace');
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /selector.*immutable|field is immutable/s);
        return { result, unchanged: read('deployment', 'controller') };
      });
      await phase('recovery', async () => {
        run(scoped(['delete', 'deployment', 'controller', '--wait=true', '--timeout=60s']));
        put(deployment('new'));
        rollout();
        return read('deployment', 'controller');
      });
    } else if (number === '054') {
      const evict = (name: string) =>
        request({ apiVersion: 'policy/v1', kind: 'Eviction', metadata: metadata(name) }, 'create', [
          `--raw=/api/v1/namespaces/${namespace}/pods/${name}/eviction`,
        ]);
      await phase('baseline', async () => {
        const pod = app('available');
        pod.metadata.labels['budget' as keyof typeof pod.metadata.labels] = 'test';
        put(pod);
        await ready('available');
        put({
          apiVersion: 'policy/v1',
          kind: 'PodDisruptionBudget',
          metadata: metadata('budget'),
          spec: { minAvailable: 0, selector: { matchLabels: { budget: 'test' } } },
        });
        await poll(
          () => read('pdb', 'budget'),
          item => item.status?.disruptionsAllowed === 1,
          'Permissive PDB'
        );
        const result = evict('available');
        assert.equal(result.status, 0, result.stderr);
        run(scoped(['wait', '--for=delete', 'pod/available', '--timeout=60s']));
        return result;
      });
      await phase('fault', async () => {
        const budget = read('pdb', 'budget');
        budget.spec.minAvailable = 1;
        put(budget, 'replace');
        const pod = app('blocked');
        (pod.metadata.labels as Record<string, string>).budget = 'test';
        put(pod);
        await ready('blocked');
        await poll(
          () => read('pdb', 'budget'),
          item => item.status?.currentHealthy === 1 && item.status.disruptionsAllowed === 0,
          'Blocking PDB'
        );
        const result = evict('blocked');
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /disruption budget/i);
        return { result, budget: read('pdb', 'budget'), pod: read('pod', 'blocked') };
      });
      await phase('recovery', async () => {
        const budget = read('pdb', 'budget');
        budget.spec.minAvailable = 0;
        put(budget, 'replace');
        await poll(
          () => read('pdb', 'budget'),
          item => item.status?.disruptionsAllowed === 1,
          'Restored PDB'
        );
        const result = evict('blocked');
        assert.equal(result.status, 0, result.stderr);
        run(scoped(['wait', '--for=delete', 'pod/blocked', '--timeout=60s']));
        return result;
      });
    } else if (number === '094') {
      for (const name of ['baseline', 'fault', 'recovery'] as const)
        await phase(name, async () => {
          const pod = admission(app(`probe-${name}`, true, name === 'fault' ? 'false' : undefined));
          assert.equal(hasProxy(pod), name === 'fault');
          assert.equal(
            pod.spec.initContainers?.some(
              (container: any) => container.name === 'azwi-proxy-init'
            ) ?? false,
            name === 'fault'
          );
          return pod;
        });
    } else if (number === '095') {
      for (const name of ['baseline', 'fault', 'recovery'] as const)
        await phase(name, async () => {
          const pod = app(`probe-${name}`, true, 'true');
          pod.spec.securityContext.runAsUser = name === 'fault' ? 0 : 1000;
          put(pod);
          const actual =
            name === 'fault'
              ? await poll(
                  () => read('pod', pod.metadata.name),
                  item =>
                    item.status?.containerStatuses?.some(
                      (container: any) =>
                        container.name === 'azwi-proxy' &&
                        container.state?.waiting?.reason === 'CreateContainerConfigError' &&
                        /non-root/i.test(container.state.waiting.message)
                    ),
                  'Proxy non-root rejection'
                )
              : await ready(pod.metadata.name);
          assert.ok(hasProxy(actual));
          return actual;
        });
    } else if (number === '096') {
      for (const name of ['baseline', 'fault', 'recovery'] as const)
        await phase(name, async () => {
          const pod = app(`job-${name}`, true, name === 'fault' ? 'true' : undefined);
          pod.spec.containers[0]!.command = ['sh', '-c', 'exit 0'];
          put({
            apiVersion: 'batch/v1',
            kind: 'Job',
            metadata: metadata(`job-${name}`),
            spec: {
              backoffLimit: 0,
              template: {
                metadata: { labels: pod.metadata.labels, annotations: pod.metadata.annotations },
                spec: pod.spec,
              },
            },
          });
          const observe = () => ({
            job: read('job', `job-${name}`),
            pods: JSON.parse(
              run(scoped(['get', 'pods', '-l', `job-name=job-${name}`, '-o', 'json']))
            ),
          });
          if (name !== 'fault')
            return poll(observe, value => value.job.status?.succeeded === 1, 'Job completion');
          const stuck = (value: any) =>
            value.pods.items.some(
              (item: any) =>
                item.status?.containerStatuses?.some(
                  (container: any) =>
                    container.name === 'app' && container.state?.terminated?.exitCode === 0
                ) &&
                item.status?.containerStatuses?.some(
                  (container: any) => container.name === 'azwi-proxy' && container.state?.running
                )
            ) && !value.job.status?.succeeded;
          await poll(observe, stuck, 'Finished app with running proxy');
          const samples = [];
          for (let sample = 0; sample < 5; sample++) {
            const observed = observe();
            assert.ok(stuck(observed));
            samples.push(observed);
            await (options.wait ?? setTimeout)(1000);
          }
          return samples;
        });
    } else if (number === '097') {
      put({
        apiVersion: 'v1',
        kind: 'ResourceQuota',
        metadata: metadata('resources'),
        spec: {
          hard: {
            'requests.cpu': '2',
            'requests.memory': '2Gi',
            'limits.cpu': '4',
            'limits.memory': '4Gi',
          },
        },
      });
      await poll(
        () => read('resourcequota', 'resources'),
        item => item.status?.hard?.['requests.cpu'] === '2',
        'Quota controller'
      );
      for (const name of ['baseline', 'fault', 'recovery'] as const)
        await phase(name, async () => {
          const result = request(app(`quota-${name}`, true, name === 'fault' ? 'true' : undefined));
          if (name === 'fault') {
            assert.notEqual(result.status, 0);
            assert.match(result.stderr, /quota/i);
            assert.match(result.stderr, /must specify|requests.cpu|limits.cpu/);
          } else {
            assert.equal(result.status, 0, result.stderr);
            await ready(`quota-${name}`);
          }
          return { result, quota: read('resourcequota', 'resources') };
        });
    } else if (number === '098') {
      put({
        apiVersion: 'v1',
        kind: 'ServiceAccount',
        metadata: {
          ...metadata('identity-b'),
          annotations: { [clientAnnotation]: secondClientId },
        },
      });
      let first: any;
      await phase('baseline', async () => {
        first = admission(app('reinvoke', true));
        assert.equal(environment(first, 'AZURE_CLIENT_ID'), clientId);
        return first;
      });
      await phase('fault', async () => {
        const changed = structuredClone(first);
        changed.spec.serviceAccountName = 'identity-b';
        const actual = admission(changed);
        assert.equal(actual.spec.serviceAccountName, 'identity-b');
        assert.equal(environment(actual, 'AZURE_CLIENT_ID'), clientId);
        return {
          admitted: actual,
          intendedServiceAccount: read('serviceaccount', 'identity-b'),
          adaptation:
            'Two AdmissionReview requests separated by explicit ServiceAccount mutation; no ordering or Azure token-exchange claim',
        };
      });
      await phase('recovery', async () => {
        const fresh = app('reinvoke-fixed', true);
        fresh.spec.serviceAccountName = 'identity-b';
        const actual = await poll(
          () => admission(fresh),
          item => environment(item, 'AZURE_CLIENT_ID') === secondClientId,
          'Fresh final identity'
        );
        return actual;
      });
    } else if (number === '099') {
      for (const name of ['baseline', 'fault', 'recovery'] as const)
        await phase(name, async () => {
          const pod: any = app(`native-${name}`, name === 'fault');
          pod.spec.initContainers = [
            {
              name: 'native-sidecar',
              image: options.probeImage,
              restartPolicy: 'Always',
              command: ['sh', '-c', 'exec tail -f /dev/null'],
            },
          ];
          put(pod);
          if (name !== 'fault') {
            const actual = await ready(pod.metadata.name);
            assert.equal(actual.spec.initContainers[0].restartPolicy, 'Always');
            return actual;
          }
          const actual = await poll(
            () => read('pod', pod.metadata.name),
            item =>
              !item.spec.initContainers[0].restartPolicy &&
              item.status?.initContainerStatuses?.[0]?.state?.running &&
              item.status?.containerStatuses?.some(
                (container: any) =>
                  container.name === 'app' && container.state?.waiting?.reason === 'PodInitializing'
              ),
            'Stripped native sidecar policy'
          );
          return actual;
        });
    } else if (number === '100') {
      await phase('baseline', async () => {
        const pod = admission(app('metadata-baseline', true));
        assert.equal(environment(pod, 'AZURE_CLIENT_ID'), clientId);
        return pod;
      });
      await phase('fault', async () => {
        const account = read('serviceaccount', 'identity-a');
        delete account.metadata.annotations[clientAnnotation];
        put(account, 'replace');
        put({
          apiVersion: 'v1',
          kind: 'Service',
          metadata: { ...metadata('misplaced'), annotations: { [clientAnnotation]: clientId } },
          spec: { ports: [{ port: 80 }], selector: { app: 'unused' } },
        });
        const pod = await poll(
          () => admission(app('metadata-fault', true)),
          item => !environment(item, 'AZURE_CLIENT_ID') && !!environment(item, 'AZURE_TENANT_ID'),
          'Missing client ID with other identity variables'
        );
        return {
          pod,
          account: read('serviceaccount', 'identity-a'),
          service: read('service', 'misplaced'),
        };
      });
      await phase('recovery', async () => {
        const account = read('serviceaccount', 'identity-a');
        account.metadata.annotations ??= {};
        account.metadata.annotations[clientAnnotation] = clientId;
        put(account, 'replace');
        return poll(
          () => admission(app('metadata-recovery', true)),
          item => environment(item, 'AZURE_CLIENT_ID') === clientId,
          'Restored client ID'
        );
      });
    } else throw new Error('No case implementation');
  } catch (error) {
    for (const name of ['baseline', 'fault', 'recovery'])
      if (state.phases[name] === 'running') state.phases[name] = 'failed';
    state.error = error instanceof Error ? error.message : String(error);
    failure = error;
    persist();
    const pods = invoke(scoped(['get', 'pods', '-o', 'json']));
    save(options.stateDirectory, 'failure-pods', pods);
    const events = invoke(scoped(['get', 'events', '-o', 'json']));
    save(options.stateDirectory, 'failure-events', events);
  }
  try {
    cleanupAksCandidateBatch(options.stateDirectory, runner);
  } catch (error) {
    if (failure) throw new AggregateError([failure, error], 'Reproduction and cleanup failed');
    throw error;
  }
  if (failure) throw failure;
  return JSON.parse(
    readFileSync(path.join(options.stateDirectory, 'reproduction-state.json'), 'utf8')
  ) as BatchState;
}
