import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clusterName = process.env.E2E_CLUSTER_NAME || 'ai-assistant-e2e';
const kwokVersion = process.env.KWOK_VERSION || 'v0.8.0';
const headlampUrl = process.env.HEADLAMP_URL || 'http://127.0.0.1:4466';
const commandSuffix = process.platform === 'win32' ? '.cmd' : '';
let portForward: ChildProcess | undefined;
let portForwardLog: number | undefined;

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
  for (const command of ['docker', 'kind', 'kubectl', 'npm']) {
    const result = spawnSync(locator, [executable(command)], { stdio: 'ignore' });
    if (result.status !== 0) {
      throw new Error(`Missing required command: ${command}`);
    }
  }
}

function deleteCluster(): void {
  spawnSync('kind', ['delete', 'cluster', '--name', clusterName], {
    cwd: rootDir,
    stdio: 'ignore',
  });
}

function cleanup(): void {
  portForward?.kill();
  if (portForwardLog !== undefined) {
    closeSync(portForwardLog);
    portForwardLog = undefined;
  }
  if (process.env.KEEP_E2E_CLUSTER !== 'true') {
    deleteCluster();
  }
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

async function main(): Promise<void> {
  ensureCommands();

  run('npm', ['run', 'build']);
  run('npx', ['playwright', 'install', 'chromium']);

  deleteCluster();
  run('kind', ['create', 'cluster', '--name', clusterName, '--config', 'e2e/kind.yaml']);
  const controlPlaneIp = run(
    'kubectl',
    [
      'get',
      'node',
      `${clusterName}-control-plane`,
      '-o',
      'jsonpath={.status.addresses[?(@.type=="InternalIP")].address}',
    ],
    true
  );

  const kwokImage = `registry.k8s.io/kwok/kwok:${kwokVersion}`;
  const kwokReleaseUrl = `https://github.com/kubernetes-sigs/kwok/releases/download/${kwokVersion}`;
  run('docker', ['pull', kwokImage]);
  run('kind', ['load', 'docker-image', '--name', clusterName, kwokImage]);
  run('kubectl', ['apply', '-f', `${kwokReleaseUrl}/kwok.yaml`]);
  run('kubectl', ['apply', '-f', `${kwokReleaseUrl}/stage-fast.yaml`]);
  run('kubectl', [
    '-n',
    'kube-system',
    'patch',
    'deployment',
    'kwok-controller',
    '--type=strategic',
    '-p',
    JSON.stringify({
      spec: {
        template: {
          spec: {
            hostNetwork: true,
            dnsPolicy: 'ClusterFirstWithHostNet',
            nodeSelector: { 'e2e.headlamp.dev/real-node': 'true' },
            containers: [
              {
                name: 'kwok-controller',
                env: [
                  { name: 'KUBERNETES_SERVICE_HOST', value: controlPlaneIp },
                  { name: 'KUBERNETES_SERVICE_PORT', value: '6443' },
                ],
              },
            ],
            tolerations: [
              {
                key: 'node-role.kubernetes.io/control-plane',
                operator: 'Exists',
                effect: 'NoSchedule',
              },
            ],
          },
        },
      },
    }),
  ]);
  run('kubectl', [
    '-n',
    'kube-system',
    'rollout',
    'status',
    'deployment/kwok-controller',
    '--timeout=180s',
  ]);
  run('kubectl', ['apply', '-f', 'e2e/kwok-fixtures.yaml']);
  run('kubectl', ['wait', 'node/kwok-worker', '--for=condition=Ready', '--timeout=120s']);

  run('docker', ['build', '-f', 'e2e/Dockerfile.headlamp', '-t', 'headlamp-ai-e2e:local', '.']);
  run('kind', ['load', 'docker-image', '--name', clusterName, 'headlamp-ai-e2e:local']);
  run('kubectl', ['apply', '-f', 'e2e/headlamp.yaml']);
  run('kubectl', [
    '-n',
    'headlamp',
    'set',
    'env',
    'deployment/headlamp',
    `KUBERNETES_SERVICE_HOST=${controlPlaneIp}`,
    'KUBERNETES_SERVICE_PORT=6443',
  ]);
  run('kubectl', ['-n', 'headlamp', 'scale', 'deployment/headlamp', '--replicas=1']);
  run('kubectl', ['-n', 'headlamp', 'rollout', 'status', 'deployment/headlamp', '--timeout=180s']);

  portForwardLog = openSync(path.join(tmpdir(), 'headlamp-e2e-port-forward.log'), 'w');
  portForward = spawn(
    'kubectl',
    ['-n', 'headlamp', 'port-forward', 'service/headlamp', '4466:80'],
    {
      cwd: rootDir,
      stdio: ['ignore', portForwardLog, portForwardLog],
    }
  );
  await waitForHeadlamp();

  const result = spawnSync(executable('npm'), ['run', 'e2e:playwright'], {
    cwd: rootDir,
    env: { ...process.env, HEADLAMP_URL: headlampUrl },
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
