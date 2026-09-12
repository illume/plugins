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
  constructor(runner: CommandRunner) {
    super('local-minikube', runner, {
      clusterName: 'test',
      kubeconfigPath: '/tmp/test-kubeconfig',
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
    applied = readFileSync(args[fileIndex + 1]!, 'utf8');
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
