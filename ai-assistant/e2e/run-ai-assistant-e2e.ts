import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { E2E_GRAFANA_ORIGIN, E2E_PROMETHEUS_ORIGIN } from './observability-services.ts';

interface Kubeconfig {
  clusters: Array<{ name: string; cluster: Record<string, unknown> }>;
  contexts: Array<{ name: string; context: { cluster: string } }>;
  'current-context': string;
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clusterName = process.env.E2E_CLUSTER_NAME || 'ai-assistant-e2e';
const headlampUrl = process.env.HEADLAMP_URL || 'http://127.0.0.1:4466';
const headlampPort = new URL(headlampUrl).port || '4466';
const headlampContainerName = `${clusterName}-headlamp`;
const prometheusContainerName = `${clusterName}-prometheus`;
const grafanaContainerName = `${clusterName}-grafana`;
const prometheusPort = new URL(E2E_PROMETHEUS_ORIGIN).port;
const grafanaPort = new URL(E2E_GRAFANA_ORIGIN).port;
const kubeconfigPath = path.join(tmpdir(), `${clusterName}-kubeconfig`);
const headlampKubeconfigPath = path.join(tmpdir(), `${clusterName}-headlamp-kubeconfig`);
const commandSuffix = process.platform === 'win32' ? '.cmd' : '';

function executable(command: string): string {
  return command === 'npm' || command === 'npx' ? `${command}${commandSuffix}` : command;
}

function run(command: string, args: string[], captureOutput = false): string {
  const result = spawnSync(executable(command), args, {
    cwd: rootDir,
    encoding: 'utf8',
    env: process.env,
    stdio: captureOutput ? 'pipe' : 'inherit',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    if (captureOutput && result.stderr) {
      process.stderr.write(result.stderr);
    }
    throw new Error(`${command} exited with status ${result.status}`);
  }

  return captureOutput ? result.stdout.trim() : '';
}

function ensureCommands(): void {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  for (const command of ['docker', 'kwokctl', 'kubectl', 'npm']) {
    const result = spawnSync(locator, [executable(command)], { stdio: 'ignore' });
    if (result.status !== 0) {
      throw new Error(`Missing required command: ${command}`);
    }
  }
}

function deleteCluster(): void {
  spawnSync('kwokctl', ['delete', 'cluster', '--name', clusterName], {
    cwd: rootDir,
    stdio: 'ignore',
  });
}

function deleteHeadlampContainer(): void {
  spawnSync('docker', ['rm', '--force', headlampContainerName], { stdio: 'ignore' });
}

/**
 * Removes observability service containers created by the E2E runner.
 *
 * @returns No value.
 */
function deleteObservabilityContainers(): void {
  for (const name of [prometheusContainerName, grafanaContainerName]) {
    spawnSync('docker', ['rm', '--force', name], { stdio: 'ignore' });
  }
}

function cleanup(): void {
  deleteHeadlampContainer();
  deleteObservabilityContainers();
  if (process.env.KEEP_E2E_CLUSTER !== 'true') {
    deleteCluster();
  }
  rmSync(kubeconfigPath, { force: true });
  rmSync(headlampKubeconfigPath, { force: true });
}

async function waitForHeadlamp(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(headlampUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Headlamp may not be ready yet.
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  throw new Error(`Headlamp did not become ready at ${headlampUrl}`);
}

/**
 * Waits for an HTTP service to return a successful response.
 *
 * @param url - Health endpoint to poll.
 * @param service - Service name used in errors.
 * @returns No value after the service becomes ready.
 */
async function waitForService(url: string, service: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // The container may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`${service} did not become ready at ${url}`);
}

/**
 * Starts the real Prometheus and Grafana services exercised by Playwright.
 *
 * @returns No value after both services become ready.
 */
async function startObservabilityServices(): Promise<void> {
  deleteObservabilityContainers();
  run('docker', [
    'run',
    '--detach',
    '--name',
    prometheusContainerName,
    '--publish',
    `127.0.0.1:${prometheusPort}:9090`,
    'prom/prometheus:v3.5.0@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996',
  ]);
  run('docker', [
    'run',
    '--detach',
    '--name',
    grafanaContainerName,
    '--publish',
    `127.0.0.1:${grafanaPort}:3000`,
    '--env',
    'GF_AUTH_ANONYMOUS_ENABLED=true',
    '--env',
    'GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer',
    '--env',
    'GF_AUTH_DISABLE_LOGIN_FORM=true',
    'grafana/grafana:12.1.0@sha256:6ac590e7cabc2fbe8d7b8fc1ce9c9f0582177b334e0df9c927ebd9670469440f',
  ]);
  await Promise.all([
    waitForService(`http://127.0.0.1:${prometheusPort}/-/ready`, 'Prometheus'),
    waitForService(`http://127.0.0.1:${grafanaPort}/api/health`, 'Grafana'),
  ]);
}

async function main(): Promise<void> {
  ensureCommands();

  run('npm', ['run', 'build']);
  run('npx', ['playwright', 'install', 'chromium']);
  await startObservabilityServices();

  deleteHeadlampContainer();
  deleteCluster();
  run('kwokctl', [
    'create',
    'cluster',
    '--name',
    clusterName,
    '--runtime',
    'docker',
    '--kubeconfig',
    kubeconfigPath,
  ]);
  process.env.KUBECONFIG = kubeconfigPath;
  run('kubectl', ['apply', '-f', 'e2e/kwok-fixtures.yaml']);
  run('kubectl', ['wait', 'node/kwok-worker', '--for=condition=Ready', '--timeout=120s']);
  const headlampToken = run(
    'kubectl',
    ['create', 'token', 'headlamp', '--namespace', 'headlamp-e2e', '--duration', '1h'],
    true
  );

  run('docker', ['build', '-f', 'e2e/Dockerfile.headlamp', '-t', 'headlamp-ai-e2e:local', '.']);
  const generatedContextName = `kwok-${clusterName}`;
  const headlampKubeconfig = yaml.load(
    run(
      'kwokctl',
      [
        'get',
        'kubeconfig',
        '--name',
        clusterName,
        '--host',
        'host.docker.internal',
        '--insecure-skip-tls-verify',
      ],
      true
    )
  ) as Kubeconfig;
  const cluster = headlampKubeconfig.clusters.find(item => item.name === generatedContextName);
  const context = headlampKubeconfig.contexts.find(item => item.name === generatedContextName);
  if (!cluster || !context) {
    throw new Error(`kwokctl kubeconfig does not contain context ${generatedContextName}`);
  }
  const { 'certificate-authority-data': unusedCertificateAuthority, ...headlampClusterConfig } =
    cluster.cluster;
  void unusedCertificateAuthority;
  cluster.cluster = headlampClusterConfig;
  cluster.name = 'main';
  context.name = 'main';
  context.context.cluster = 'main';
  headlampKubeconfig['current-context'] = 'main';
  writeFileSync(headlampKubeconfigPath, yaml.dump(headlampKubeconfig));
  run('docker', [
    'run',
    '--detach',
    '--name',
    headlampContainerName,
    '--add-host',
    'host.docker.internal:host-gateway',
    '--publish',
    `${headlampPort}:4466`,
    '--mount',
    `type=bind,source=${headlampKubeconfigPath},target=/tmp/kubeconfig,readonly`,
    'headlamp-ai-e2e:local',
    '-kubeconfig=/tmp/kubeconfig',
    '-plugins-dir=/headlamp/plugins',
  ]);
  try {
    await waitForHeadlamp();
  } catch (error) {
    run('docker', ['logs', headlampContainerName]);
    throw error;
  }

  const result = spawnSync(executable('npm'), ['run', 'e2e:playwright'], {
    cwd: rootDir,
    env: {
      ...process.env,
      HEADLAMP_URL: headlampUrl,
      HEADLAMP_TOKEN: headlampToken,
      E2E_PROMETHEUS_URL: E2E_PROMETHEUS_ORIGIN,
      E2E_GRAFANA_URL: E2E_GRAFANA_ORIGIN,
    },
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Playwright exited with status ${result.status}`);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    cleanup();
    process.exit(1);
  });
}

try {
  await main();
} finally {
  cleanup();
}
