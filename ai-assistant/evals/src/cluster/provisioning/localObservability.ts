import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { boundedAzureRunner } from './aksObservability.js';
import type { CommandRunner } from '../commandRunner.js';
import { localObservabilityScenarios } from '../../scenarios/observabilityScenarios.js';

const prometheusImage =
  'prom/prometheus:v3.5.0@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996';
const grafanaImage =
  'grafana/grafana:12.1.0@sha256:6ac590e7cabc2fbe8d7b8fc1ce9c9f0582177b334e0df9c927ebd9670469440f';
const label = 'headlamp-observability-owner';

interface LocalTool {
  setContext: (context: {
    config: Record<string, { baseUrl: string; token?: string }>;
    fetch: typeof fetch;
  }) => void;
  handler: (args: Record<string, unknown>) => Promise<{ success: boolean; data?: any }>;
}

async function readLocalTool(
  provider: 'prometheus' | 'grafana',
  baseUrl: string,
  args: Record<string, unknown>,
  transport: typeof fetch,
  token?: string
) {
  const source = new URL(
    '../../../../packages/ai-common/src/tools/observability/ObservabilityTools.ts',
    import.meta.url
  );
  const modules: Record<string, new () => LocalTool> = await import(source.href);
  const Tool = modules[provider === 'prometheus' ? 'PrometheusTool' : 'GrafanaTool'];
  assert.ok(Tool);
  const tool = new Tool();
  tool.setContext({ config: { [provider]: { baseUrl, token } }, fetch: transport });
  const result = await tool.handler(args);
  assert.ok(result.success && result.data !== undefined);
  return result.data;
}

export async function cleanupLocalObservability(
  directory: string,
  runner: CommandRunner = boundedAzureRunner()
): Promise<void> {
  const state: { owner: string; names: string[]; cleanup: string } = JSON.parse(
    readFileSync(path.join(directory, 'local-state.json'), 'utf8')
  );
  assert.match(state.owner, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  const failures: string[] = [];
  for (const name of [...state.names].reverse()) {
    assert.ok(
      ['prometheus', 'grafana', 'exporter'].some(role => name === `hl-obs-${state.owner}-${role}`)
    );
    const listed = runner('docker', [
      'container',
      'ls',
      '-a',
      '--filter',
      `name=^/${name}$`,
      '--format',
      '{{.Names}}',
    ]);
    if (listed.status !== 0) {
      failures.push(name);
      continue;
    }
    if (!listed.stdout.trim()) continue;
    const inspected = runner('docker', ['inspect', name]);
    if (
      inspected.status !== 0 ||
      JSON.parse(inspected.stdout)[0]?.Config?.Labels?.[label] !== state.owner
    ) {
      failures.push(name);
      continue;
    }
    if (runner('docker', ['rm', '--force', '--volumes', name]).status !== 0) failures.push(name);
  }
  state.cleanup = failures.length ? 'failed' : 'passed';
  writeFileSync(path.join(directory, 'local-state.json'), JSON.stringify(state, null, 2), {
    mode: 0o600,
  });
  assert.equal(
    failures.length,
    0,
    'Docker cleanup failed; retry cleanup-local with the same state directory'
  );
}

export async function verifyLocalObservability(options: {
  scenario: (typeof localObservabilityScenarios)[number]['id'];
  stateDirectory: string;
  exporterImage: string;
  runner?: CommandRunner;
  transport?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
}) {
  assert.match(
    options.exporterImage,
    /^[a-zA-Z0-9./:_-]+@sha256:[0-9a-f]{64}$/,
    'Use an immutable BusyBox-compatible exporter image'
  );
  const runner = options.runner ?? boundedAzureRunner();
  const transport = options.transport ?? fetch;
  const wait = options.wait ?? setTimeout;
  const run = (args: string[]) => {
    const result = runner('docker', args);
    assert.equal(result.status, 0, `docker ${args[0]} failed`);
    return result.stdout.trim();
  };
  run(['info', '--format', '{{.ServerVersion}}']);
  mkdirSync(options.stateDirectory, { mode: 0o700 });
  chmodSync(options.stateDirectory, 0o700);
  const owner = randomUUID();
  const names = [
    'exporter',
    'prometheus',
    ...(options.scenario === 'grafana-dashboard-datasource-drift-v1' ? ['grafana'] : []),
  ].map(role => `hl-obs-${owner}-${role}`);
  const exporter = names[0]!;
  const prometheus = names[1]!;
  const grafana = names[2];
  writeFileSync(
    path.join(options.stateDirectory, 'local-state.json'),
    JSON.stringify({ owner, names, cleanup: 'pending' }),
    { mode: 0o600 }
  );
  const evidence: Array<{ phase: string; data: unknown }> = [];
  const record = (phase: string, data: unknown) => {
    evidence.push({ phase, data });
    writeFileSync(
      path.join(options.stateDirectory, 'local-result.json'),
      JSON.stringify(evidence, null, 2),
      { mode: 0o600 }
    );
  };
  const poll = async (
    name: string,
    read: () => Promise<unknown>,
    accept: (value: any) => boolean
  ) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        const value = await read();
        if (accept(value)) return value;
      } catch {}
      if (attempt < 59) await wait(1000);
    }
    throw new Error(`${name} did not converge`);
  };
  const request = async (url: string, init?: RequestInit) =>
    transport(url, { ...init, signal: AbortSignal.timeout(10_000), redirect: 'error' });
  try {
    run([
      'run',
      '-d',
      '--name',
      exporter,
      '--label',
      `${label}=${owner}`,
      '--publish',
      '127.0.0.1::9090',
      options.exporterImage,
      'sh',
      '-c',
      'mkdir -p /tmp/www; printf "# TYPE eval_requests_total counter\neval_requests_total 10\n" > /tmp/www/metrics; httpd -p 8080 -h /tmp/www; exec tail -f /dev/null',
    ]);
    const configFile = path.join(options.stateDirectory, 'prometheus.json');
    writeFileSync(
      configFile,
      JSON.stringify({
        global: { scrape_interval: '1s', scrape_timeout: '500ms' },
        scrape_configs: [
          {
            job_name: 'backend',
            fallback_scrape_protocol: 'PrometheusText0.0.4',
            static_configs: [{ targets: ['127.0.0.1:8080'] }],
          },
        ],
      }),
      { mode: 0o644 }
    );
    run([
      'create',
      '--name',
      prometheus,
      '--label',
      `${label}=${owner}`,
      '--network',
      `container:${exporter}`,
      prometheusImage,
    ]);
    run(['cp', configFile, `${prometheus}:/etc/prometheus/prometheus.yml`]);
    run(['start', prometheus]);
    const promBinding = run(['port', exporter, '9090/tcp']);
    assert.match(promBinding, /^127\.0\.0\.1:[0-9]+$/);
    const promRead = () =>
      readLocalTool(
        'prometheus',
        `http://${promBinding}`,
        { action: 'query', query: 'up' },
        transport
      );
    const baseline = await poll('Prometheus healthy baseline', promRead, value =>
      value.data?.result?.some(
        (entry: any) => entry.metric?.job === 'backend' && entry.value?.[1] === '1'
      )
    );
    record('baseline-passed', baseline);
    if (!grafana) {
      run(['exec', exporter, 'killall', 'httpd']);
      const fault = await poll('Prometheus failed scrape', promRead, value =>
        value.data?.result?.some(
          (entry: any) => entry.metric?.job === 'backend' && entry.value?.[1] === '0'
        )
      );
      record('fault-observed', fault);
      run(['exec', exporter, 'httpd', '-p', '8080', '-h', '/tmp/www']);
      const recovery = await poll('Prometheus recovery', promRead, value =>
        value.data?.result?.some(
          (entry: any) => entry.metric?.job === 'backend' && entry.value?.[1] === '1'
        )
      );
      record('recovery-passed', recovery);
    } else {
      const password = randomUUID();
      const env = path.join(options.stateDirectory, 'grafana.env');
      writeFileSync(env, `GF_SECURITY_ADMIN_PASSWORD=${password}\n`, { mode: 0o600 });
      run([
        'run',
        '-d',
        '--name',
        grafana,
        '--label',
        `${label}=${owner}`,
        '--publish',
        '127.0.0.1::3000',
        '--env-file',
        env,
        '--add-host',
        'host.docker.internal:host-gateway',
        grafanaImage,
      ]);
      const binding = run(['port', grafana, '3000/tcp']);
      assert.match(binding, /^127\.0\.0\.1:[0-9]+$/);
      const base = `http://${binding}`;
      const auth = {
        Authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}`,
        'Content-Type': 'application/json',
      };
      await poll(
        'Grafana ready',
        async () => (await request(`${base}/api/health`)).json(),
        value => value.database === 'ok'
      );
      const serviceAccount = await request(`${base}/api/serviceaccounts`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ name: 'eval-reader', role: 'Viewer' }),
      });
      assert.ok(serviceAccount.ok);
      const account = await serviceAccount.json();
      assert.ok(
        account && typeof account === 'object' && 'id' in account && Number.isInteger(account.id)
      );
      const tokenResponse = await request(`${base}/api/serviceaccounts/${account.id}/tokens`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ name: 'eval', secondsToLive: 3600 }),
      });
      assert.ok(tokenResponse.ok);
      const tokenBody = await tokenResponse.json();
      assert.ok(
        tokenBody &&
          typeof tokenBody === 'object' &&
          'key' in tokenBody &&
          typeof tokenBody.key === 'string'
      );
      const readerToken = tokenBody.key;
      const readDashboard = () =>
        readLocalTool(
          'grafana',
          base,
          { action: 'get_dashboard', uid: 'eval' },
          transport,
          readerToken
        );
      const exporterAddress = JSON.parse(run(['inspect', exporter]))[0]?.NetworkSettings?.Networks
        ?.bridge?.IPAddress;
      assert.match(exporterAddress, /^172\.[0-9.]+$|^10\.[0-9.]+$/);
      const configured = await request(`${base}/api/datasources`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          name: 'eval',
          uid: 'eval-prometheus',
          type: 'prometheus',
          access: 'proxy',
          url: `http://${exporterAddress}:9090`,
        }),
      });
      assert.ok(configured.ok);
      const query = (uid: string) =>
        request(`${base}/api/datasources/proxy/uid/${uid}/api/v1/query?query=up`, {
          headers: auth,
        });
      assert.equal((await query('eval-prometheus')).status, 200);
      const dashboard = (uid: string) => ({
        dashboard: {
          uid: 'eval',
          title: 'Eval',
          schemaVersion: 39,
          panels: [
            {
              id: 1,
              type: 'timeseries',
              title: 'Backend health',
              datasource: { type: 'prometheus', uid },
              targets: [{ refId: 'A', expr: 'up' }],
            },
          ],
        },
        overwrite: true,
      });
      const save = async (uid: string) =>
        assert.ok(
          (
            await request(`${base}/api/dashboards/db`, {
              method: 'POST',
              headers: auth,
              body: JSON.stringify(dashboard(uid)),
            })
          ).ok
        );
      await save('eval-prometheus');
      const original = await readDashboard();
      assert.equal(original.dashboard?.panels?.[0]?.datasource?.uid, 'eval-prometheus');
      record('dashboard-baseline-passed', original);
      await save('missing-datasource');
      assert.equal((await query('missing-datasource')).status, 404);
      const drifted = await readDashboard();
      assert.equal(drifted.dashboard?.panels?.[0]?.datasource?.uid, 'missing-datasource');
      record('fault-observed', drifted);
      await save('eval-prometheus');
      assert.equal((await query('eval-prometheus')).status, 200);
      const repaired = await readDashboard();
      assert.equal(repaired.dashboard?.panels?.[0]?.datasource?.uid, 'eval-prometheus');
      record('recovery-passed', repaired);
    }
  } catch (error) {
    record('failed', { message: error instanceof Error ? error.message : 'Local service failure' });
    throw error;
  } finally {
    try {
      await cleanupLocalObservability(options.stateDirectory, runner);
      record('cleanup-passed', null);
    } catch (error) {
      record('cleanup-failed', null);
      throw error;
    }
  }
  return {
    kind: 'live-local-service-verification',
    scenario: options.scenario,
    modelInvocations: 0,
    lifecycle: 'passed',
    evidence,
  };
}
