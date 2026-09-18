import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import type { CommandRunner } from '../commandRunner.js';
import { corednsCandidateResources } from '../../scenarios/aksCandidateReproductions.js';

type PhaseStatus = 'not-run' | 'running' | 'passed' | 'failed';
interface ReproductionState {
  schema_version: 'aks-component-reproduction@1.0.0';
  scenario: 'aks-c059-v1';
  owner: string;
  namespace: string;
  namespaceUid: string | null;
  kubeconfig: string;
  context: string;
  server: string;
  images: { coredns: string; probe: string };
  phases: Record<'baseline' | 'fault' | 'recovery' | 'cleanup', PhaseStatus>;
  qualification: 'pending';
  modelInvocations: 0;
  error: string | null;
}

const realRunner: CommandRunner = (command, args) => {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.error ? 'Command failed or timed out' : result.stderr ?? '',
  };
};

function save(directory: string, name: string, value: unknown) {
  const target = path.join(directory, name);
  writeFileSync(`${target}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600, flush: true });
  renameSync(`${target}.tmp`, target);
}

function client(state: Pick<ReproductionState, 'kubeconfig' | 'context'>, runner: CommandRunner) {
  assert.ok(path.isAbsolute(state.kubeconfig), 'An absolute kubeconfig path is required');
  assert.ok(
    typeof state.context === 'string' && state.context.length > 0 && !state.context.startsWith('-'),
    'An explicit context is required'
  );
  return (args: string[]) =>
    runner('kubectl', [
      '--kubeconfig',
      state.kubeconfig,
      '--context',
      state.context,
      '--request-timeout=10s',
      ...args,
    ]);
}

function serverFor(invoke: ReturnType<typeof client>) {
  const result = invoke([
    'config',
    'view',
    '--minify',
    '-o',
    'jsonpath={.clusters[0].cluster.server}',
  ]);
  assert.equal(result.status, 0, 'Cannot resolve the explicit cluster context');
  const server = result.stdout.trim();
  const url = new URL(server);
  assert.ok(
    url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  );
  assert.ok(!url.username && !url.password, 'Credential-bearing server URLs are not supported');
  return server;
}

export function cleanupAksCandidateReproduction(
  directory: string,
  runner: CommandRunner = realRunner
) {
  const state: ReproductionState = JSON.parse(
    readFileSync(path.join(directory, 'reproduction-state.json'), 'utf8')
  );
  assert.equal(state.schema_version, 'aks-component-reproduction@1.0.0');
  assert.equal(state.scenario, 'aks-c059-v1');
  assert.match(state.owner, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(state.namespace, `hl-aks-c059-${state.owner}`);
  const invoke = client(state, runner);
  try {
    assert.equal(serverFor(invoke), state.server, 'Kubeconfig now points at a different cluster');
    const read = invoke(['get', 'namespace', state.namespace, '--ignore-not-found', '-o', 'json']);
    assert.equal(read.status, 0, 'Cannot verify namespace ownership');
    if (read.stdout.trim()) {
      const namespace = JSON.parse(read.stdout);
      assert.equal(
        namespace.metadata?.labels?.['headlamp-research-owner'],
        state.owner,
        'Namespace ownership changed'
      );
      if (state.namespaceUid)
        assert.equal(namespace.metadata?.uid, state.namespaceUid, 'Namespace UID changed');
      const removed = invoke([
        'delete',
        'namespace',
        state.namespace,
        '--wait=true',
        '--timeout=60s',
      ]);
      assert.equal(removed.status, 0, 'Namespace cleanup failed');
    }
    const absent = invoke([
      'get',
      'namespace',
      state.namespace,
      '--ignore-not-found',
      '-o',
      'json',
    ]);
    assert.equal(absent.status, 0, 'Cannot verify namespace deletion');
    assert.equal(absent.stdout.trim(), '', 'Owned namespace remains after cleanup');
    state.phases.cleanup = 'passed';
  } catch (error) {
    state.phases.cleanup = 'failed';
    throw error;
  } finally {
    save(directory, 'reproduction-state.json', state);
  }
}

export async function verifyAksCandidateReproduction(options: {
  scenario: string;
  stateDirectory: string;
  kubeconfig: string;
  context: string;
  acceptClusterMutations: boolean;
  corednsImage: string;
  probeImage: string;
  runner?: CommandRunner;
  wait?: (milliseconds: number) => Promise<void>;
}) {
  assert.equal(
    options.scenario,
    'aks-c059-v1',
    'No reproduction implementation for this candidate'
  );
  assert.equal(
    options.acceptClusterMutations,
    true,
    'Explicit cluster mutation acknowledgement is required'
  );
  const runner = options.runner ?? realRunner;
  const wait = options.wait ?? setTimeout;
  const owner = randomUUID();
  const namespace = `hl-aks-c059-${owner}`;
  const resources = (phase: 'baseline' | 'fault' | 'recovery') =>
    corednsCandidateResources({
      namespace,
      owner,
      phase,
      corednsImage: options.corednsImage,
      probeImage: options.probeImage,
    });
  const baseline = resources('baseline');
  const invoke = client(
    { kubeconfig: path.resolve(options.kubeconfig), context: options.context },
    runner
  );
  const server = serverFor(invoke);
  const run = (args: string[]) => {
    const result = invoke(args);
    assert.equal(result.status, 0, `kubectl ${args[0]} failed`);
    return result.stdout;
  };
  const permission = run(['auth', 'can-i', 'create', 'namespaces']).trim();
  assert.equal(permission, 'yes', 'Namespace creation is not authorized');
  mkdirSync(options.stateDirectory, { mode: 0o700 });
  const state: ReproductionState = {
    schema_version: 'aks-component-reproduction@1.0.0',
    scenario: 'aks-c059-v1',
    owner,
    namespace,
    namespaceUid: null,
    kubeconfig: path.resolve(options.kubeconfig),
    context: options.context,
    server,
    images: { coredns: options.corednsImage, probe: options.probeImage },
    phases: { baseline: 'not-run', fault: 'not-run', recovery: 'not-run', cleanup: 'not-run' },
    qualification: 'pending',
    modelInvocations: 0,
    error: null,
  };
  const persist = () => save(options.stateDirectory, 'reproduction-state.json', state);
  const create = (name: string, resource: unknown, replace = false) => {
    save(options.stateDirectory, `${name}.json`, resource);
    run([replace ? 'replace' : 'create', '-f', path.join(options.stateDirectory, `${name}.json`)]);
  };
  const scoped = (args: string[]) => ['--namespace', namespace, ...args];
  const read = (kind: string, name: string) =>
    JSON.parse(run(scoped(['get', kind, name, '-o', 'json'])));
  const ready = (pod: any) =>
    pod.status?.conditions?.some(
      (condition: any) => condition.type === 'Ready' && condition.status === 'True'
    );
  const poll = async <Result>(
    operation: () => Result,
    accept: (result: Result) => boolean,
    message: string
  ) => {
    const deadline = Date.now() + 60_000;
    for (let attempt = 0; attempt < 60 && Date.now() < deadline; attempt++) {
      const result = operation();
      if (accept(result)) return result;
      if (attempt < 59) await wait(1000);
    }
    throw new Error(message);
  };
  const snapshot = (phase: string) => {
    const pod = read('pod', 'dns');
    const config = read('configmap', 'corefile');
    const logs = invoke(scoped(['logs', 'dns', '--tail=80']));
    const data = { pod, config, logs: logs.stdout, logStatus: logs.status };
    save(options.stateDirectory, `${phase}-evidence.json`, data);
    return data;
  };
  let current: 'baseline' | 'fault' | 'recovery' = 'baseline';
  let failure: unknown;
  persist();
  try {
    create('namespace', {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: namespace, labels: { 'headlamp-research-owner': owner } },
    });
    const created = JSON.parse(run(['get', 'namespace', namespace, '-o', 'json']));
    assert.equal(created.metadata?.labels?.['headlamp-research-owner'], owner);
    assert.ok(typeof created.metadata?.uid === 'string' && created.metadata.uid.length > 0);
    state.namespaceUid = created.metadata.uid;
    persist();
    create('probe', baseline.probe);
    create('service', baseline.service);
    const address = read('service', 'dns').spec?.clusterIP;
    assert.ok(typeof address === 'string' && isIP(address), 'A DNS Service address is required');
    await poll(() => read('pod', 'probe'), ready, 'Probe workload did not become ready');
    for (const phase of ['baseline', 'fault', 'recovery'] as const) {
      current = phase;
      state.phases[phase] = 'running';
      persist();
      assert.equal(serverFor(invoke), server, 'Kubeconfig now points at a different cluster');
      const spec = resources(phase);
      create('corefile', spec.config, phase !== 'baseline');
      if (phase !== 'baseline')
        run(scoped(['delete', 'pod', 'dns', '--wait=true', '--timeout=30s']));
      create('dns', spec.pod);
      if (phase === 'fault') {
        const captured = await poll(
          () => snapshot(phase),
          data => {
            const container = data.pod.status?.containerStatuses?.find(
              (item: any) => item.name === 'coredns'
            );
            return (
              data.logStatus === 0 &&
              !ready(data.pod) &&
              container?.restartCount >= 1 &&
              /zone is not a valid domain name:\s*\.example\.test\b/i.test(data.logs)
            );
          },
          'The leading-dot CoreDNS fault was not reproduced'
        );
        assert.equal(captured.config.data?.Corefile, spec.config.data.Corefile);
        save(options.stateDirectory, 'candidate-evidence.json', {
          scenario_id: state.scenario,
          task: 'DNS Pods crash after loading a custom zone configuration. Determine which configuration element prevents startup.',
          observations: captured,
        });
        save(options.stateDirectory, 'evaluator-evidence.json', {
          scenario_id: state.scenario,
          qualification: 'pending',
          faultChecks: [
            'container restarted and is not Ready',
            'invalid leading-dot zone startup error',
          ],
          required: [
            {
              resource_ref: `configmap/${namespace}/corefile`,
              field_path: '/data/Corefile',
              observed_value: captured.config.data.Corefile,
            },
          ],
        });
      } else {
        await poll(() => read('pod', 'dns'), ready, `${phase} DNS workload did not become ready`);
        const queries: string[] = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          const answer = await poll(
            () =>
              invoke(
                scoped([
                  'exec',
                  'probe',
                  '--',
                  'nslookup',
                  '-type=A',
                  'answer.example.test',
                  address,
                ])
              ),
            result => result.status === 0 && /\b192\.0\.2\.10\b/.test(result.stdout),
            `${phase} DNS query failed`
          );
          queries.push(answer.stdout);
        }
        const captured = snapshot(phase);
        assert.equal(captured.config.data?.Corefile, spec.config.data.Corefile);
        save(options.stateDirectory, `${phase}-queries.json`, queries);
      }
      state.phases[phase] = 'passed';
      persist();
    }
  } catch (error) {
    state.phases[current] = 'failed';
    state.error = error instanceof Error ? error.message : 'Reproduction failed';
    failure = error;
    persist();
    try {
      snapshot(`${current}-failed`);
    } catch {}
  }
  try {
    cleanupAksCandidateReproduction(options.stateDirectory, runner);
  } catch (error) {
    if (failure)
      throw new AggregateError(
        [failure, error],
        'Reproduction and cleanup failed; retain the state directory'
      );
    throw error;
  }
  if (failure) throw failure;
  return JSON.parse(
    readFileSync(path.join(options.stateDirectory, 'reproduction-state.json'), 'utf8')
  ) as ReproductionState;
}
