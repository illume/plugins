/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import type { CommandRunner } from '../commandRunner.js';
import { makeScratchDir, removeScratchDir } from '../../test-helpers/scratchDir.js';
import { KubectlClusterAdapter } from './kubectlAdapter.js';

class TestKubectlAdapter extends KubectlClusterAdapter {
  constructor(runner: CommandRunner, kubeconfigPath = '/tmp/test-kubeconfig') {
    super('local-minikube', runner, {
      clusterName: 'test',
      kubeconfigPath,
    });
  }

  async preflight() {
    return { supported: true };
  }

  async dispose() {}
}

test('applyManifest replaces namespace placeholders without changing the source fixture', async () => {
  const directory = makeScratchDir('kubectl-fixture');
  const fixturePath = path.join(directory, 'setup.yaml');
  const source = 'metadata:\n  namespace: __EVAL_NAMESPACE__\n';
  writeFileSync(fixturePath, source);
  let applied = '';
  const runner: CommandRunner = (_command, args) => {
    const fileIndex = args.indexOf('-f');
    if (fileIndex >= 0) applied = readFileSync(args[fileIndex + 1]!, 'utf8');
    return { status: 0, stdout: '', stderr: '' };
  };
  try {
    await new TestKubectlAdapter(runner).applyManifest('trial-namespace', fixturePath);
    assert.equal(applied, 'metadata:\n  namespace: trial-namespace\n');
    assert.equal(readFileSync(fixturePath, 'utf8'), source);
  } finally {
    removeScratchDir(directory);
  }
});

test('applyManifest patches fixture-authored status through the status subresource', async () => {
  const directory = makeScratchDir('kubectl-status-fixture');
  const fixturePath = path.join(directory, 'setup.yaml');
  writeFileSync(
    fixturePath,
    [
      'apiVersion: v1',
      'kind: Node',
      'metadata:',
      '  name: synthetic',
      'status:',
      '  conditions:',
      '    - type: Ready',
      '      status: "False"',
      '',
    ].join('\n')
  );
  const calls: string[][] = [];
  const runner: CommandRunner = (_command, args) => {
    calls.push(args);
    return { status: 0, stdout: '', stderr: '' };
  };
  try {
    await new TestKubectlAdapter(runner).applyManifest('trial', fixturePath);
    assert.deepEqual(calls[1]?.slice(2, 8), [
      'patch',
      'node/synthetic',
      '-n',
      'trial',
      '--subresource=status',
      '--type=merge',
    ]);
    assert.equal(
      calls[1]?.at(-1),
      JSON.stringify({ status: { conditions: [{ type: 'Ready', status: 'False' }] } })
    );
  } finally {
    removeScratchDir(directory);
  }
});

test('applyManifest denies authored CSRs through the approval subresource', async () => {
  const directory = makeScratchDir('kubectl-csr-fixture');
  const fixturePath = path.join(directory, 'setup.yaml');
  writeFileSync(
    fixturePath,
    [
      'apiVersion: certificates.k8s.io/v1',
      'kind: CertificateSigningRequest',
      'metadata:',
      '  name: denied-renewal',
      'spec:',
      '  request: request',
      'status:',
      '  conditions:',
      '    - type: Denied',
      '      status: "True"',
      '      reason: FixtureRenewalDenied',
      '      message: controlled denial',
      '',
    ].join('\n')
  );
  const calls: string[][] = [];
  const runner: CommandRunner = (_command, args) => {
    calls.push(args);
    return { status: 0, stdout: '', stderr: '' };
  };
  try {
    await new TestKubectlAdapter(runner).applyManifest('trial', fixturePath);
    assert.deepEqual(calls[1]?.slice(2), ['certificate', 'deny', 'denied-renewal']);
  } finally {
    removeScratchDir(directory);
  }
});

test('exerciseClientCertificate uses the issued certificate with its matching key', async () => {
  const directory = makeScratchDir('kubectl-client-certificate');
  const kubeconfigPath = path.join(directory, 'source-kubeconfig.json');
  writeFileSync(
    kubeconfigPath,
    JSON.stringify({
      'current-context': 'test',
      clusters: [{ name: 'cluster', cluster: { server: 'https://cluster.example' } }],
      contexts: [{ name: 'test', context: { cluster: 'cluster' } }],
    })
  );
  const calls: string[][] = [];
  const runner: CommandRunner = (_command, args) => {
    calls.push(args);
    if (args.includes('certificatesigningrequest')) {
      return {
        status: 0,
        stdout: JSON.stringify({
          status: { certificate: Buffer.from('certificate').toString('base64') },
        }),
        stderr: '',
      };
    }
    return { status: 0, stdout: '{}', stderr: '' };
  };
  try {
    assert.equal(
      await new TestKubectlAdapter(runner, kubeconfigPath).exerciseClientCertificate(
        'short-lived',
        'private-key'
      ),
      true
    );
    const exercise = calls.find(call => call.includes('/version'));
    assert.ok(exercise?.[1]?.endsWith('kubeconfig.json'));
  } finally {
    removeScratchDir(directory);
  }
});

test('deleteManifest removes namespaced and cluster-scoped fixture resources', async () => {
  const directory = makeScratchDir('kubectl-delete-fixture');
  const fixturePath = path.join(directory, 'setup.yaml');
  writeFileSync(fixturePath, 'metadata:\n  namespace: __EVAL_NAMESPACE__\n');
  let invokedArgs: string[] = [];
  const runner: CommandRunner = (_command, args) => {
    invokedArgs = args;
    return { status: 0, stdout: '', stderr: '' };
  };
  try {
    await new TestKubectlAdapter(runner).deleteManifest('trial-namespace', fixturePath);
    assert.deepEqual(invokedArgs.slice(2, 5), ['delete', '-n', 'trial-namespace']);
    assert.ok(invokedArgs.includes('--ignore-not-found'));
    assert.equal(readFileSync(fixturePath, 'utf8'), 'metadata:\n  namespace: __EVAL_NAMESPACE__\n');
  } finally {
    removeScratchDir(directory);
  }
});

test('getDeployment distinguishes absence from operational failures', async () => {
  const notFoundRunner: CommandRunner = () => ({
    status: 1,
    stdout: '',
    stderr: 'Error from server (NotFound): deployments.apps "missing" not found',
  });
  assert.deepEqual(await new TestKubectlAdapter(notFoundRunner).getDeployment('trial', 'missing'), {
    found: false,
  });

  const dnsFailureRunner: CommandRunner = () => ({
    status: 1,
    stdout: '',
    stderr: 'Unable to connect to the server: dial tcp: lookup cluster.example: no such host',
  });
  await assert.rejects(
    () => new TestKubectlAdapter(dnsFailureRunner).getDeployment('trial', 'cpu-hog'),
    /no such host/
  );
});

test('listResourceSnapshots returns a namespaced inventory', async () => {
  const runner: CommandRunner = (_command, args) => {
    assert.deepEqual(args.slice(-6), ['get', 'poddisruptionbudget', '-n', 'trial', '-o', 'json']);
    return {
      status: 0,
      stdout: JSON.stringify({ items: [{ metadata: { name: 'web' } }] }),
      stderr: '',
    };
  };
  assert.deepEqual(
    await new TestKubectlAdapter(runner).listResourceSnapshots('trial', 'poddisruptionbudget'),
    [{ metadata: { name: 'web' } }]
  );
});

test('getPodLogs reads all containers through the isolated kubeconfig', async () => {
  const runner: CommandRunner = (_command, args) => {
    assert.deepEqual(args.slice(-5), ['logs', 'probe-abc', '-n', 'trial', '--all-containers=true']);
    return { status: 0, stdout: 'probe failed\n', stderr: '' };
  };
  assert.equal(
    await new TestKubectlAdapter(runner).getPodLogs('trial', 'probe-abc'),
    'probe failed'
  );
});

test('getNodeProxyHealth reports kubelet proxy connection failures', async () => {
  const runner: CommandRunner = (_command, args) => {
    assert.deepEqual(args.slice(-3), [
      'get',
      '--raw',
      '/api/v1/nodes/synthetic-node/proxy/healthz',
    ]);
    return { status: 1, stdout: '', stderr: 'service unavailable' };
  };
  assert.deepEqual(await new TestKubectlAdapter(runner).getNodeProxyHealth('synthetic-node'), {
    reachable: false,
    detail: 'service unavailable',
  });
});

test('probeApiPath issues a read-only raw API-server request', async () => {
  let invokedArgs: string[] = [];
  const runner: CommandRunner = (_command, args) => {
    invokedArgs = args;
    return { status: 1, stdout: '', stderr: 'service unavailable' };
  };
  await new TestKubectlAdapter(runner).probeApiPath('/apis/unavailable.example.test/v1alpha1');
  assert.deepEqual(invokedArgs.slice(-3), [
    'get',
    '--raw',
    '/apis/unavailable.example.test/v1alpha1',
  ]);
});

test('applyJsonPatch passes an exact RFC 6902 document and verifies target identity', async () => {
  let invokedArgs: string[] = [];
  const runner: CommandRunner = (_command, args) => {
    invokedArgs = args;
    return {
      status: 0,
      stdout: JSON.stringify({ metadata: { uid: 'uid-1' }, spec: { replicas: 2 } }),
      stderr: '',
    };
  };
  const patch = [
    { op: 'test' as const, path: '/spec/replicas', value: 1 },
    { op: 'replace' as const, path: '/spec/replicas', value: 2 },
  ];
  const result = await new TestKubectlAdapter(runner).applyJsonPatch(
    {
      api_version: 'apps/v1',
      kind: 'Deployment',
      namespace: 'trial',
      name: 'web',
      uid: 'uid-1',
    },
    patch
  );

  assert.equal(invokedArgs[invokedArgs.indexOf('--patch') + 1], JSON.stringify(patch));
  assert.equal((result as { spec: { replicas: number } }).spec.replicas, 2);
});
