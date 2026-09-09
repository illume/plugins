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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createFakeCommandRunner } from '../commandRunner.js';
import { MinikubeAdapter } from './minikubeAdapter.js';
import { makeScratchDir, removeScratchDir } from '../../test-helpers/scratchDir.js';

test('MinikubeAdapter reuses a running profile and exports an isolated kubeconfig', async () => {
  const directory = makeScratchDir('minikube-adapter');
  const kubeconfigPath = path.join(directory, 'kubeconfig');
  try {
    const { runner, calls } = createFakeCommandRunner([
      ...['kubectl', 'minikube', 'docker'].map(tool => ({
        match: ['which', tool],
        result: { status: 0, stdout: `/usr/local/bin/${tool}\n`, stderr: '' },
      })),
      {
        match: ['minikube', 'status'],
        result: {
          status: 0,
          stdout: JSON.stringify({ Host: 'Running', APIServer: 'Running' }),
          stderr: '',
        },
      },
      {
        match: ['kubectl', 'config', 'view'],
        result: {
          status: 0,
          stdout: JSON.stringify({ apiVersion: 'v1', kind: 'Config' }),
          stderr: '',
        },
      },
      {
        match: ['kubectl', '--kubeconfig', kubeconfigPath, 'version'],
        result: { status: 0, stdout: 'ok', stderr: '' },
      },
    ]);
    const adapter = new MinikubeAdapter(runner, kubeconfigPath);
    assert.deepEqual(await adapter.preflight(), { supported: true });
    assert.equal(existsSync(kubeconfigPath), true);
    assert.equal(
      calls.some(call => call.command === 'minikube' && call.args[0] === 'start'),
      false
    );
    assert.deepEqual(await adapter.candidateEnvironment('trial-ns', ['pod_status']), {});
    await adapter.dispose();
    assert.equal(existsSync(kubeconfigPath), false);
  } finally {
    removeScratchDir(directory);
  }
});
