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
import { createFakeCommandRunner } from '../commandRunner.js';
import { defaultAksKubeconfigPath } from '../provisioning/aks.js';
import { AksAdapter } from './aksAdapter.js';

const expectKubeconfig = process.env.AKS_KUBECONFIG_PATH ?? defaultAksKubeconfigPath;

test('AksAdapter runtime preflight requires kubectl but not az', async () => {
  const { runner, calls } = createFakeCommandRunner([
    {
      match: ['which', 'kubectl'],
      result: { status: 0, stdout: '/usr/local/bin/kubectl\n', stderr: '' },
    },
    {
      match: ['kubectl', '--kubeconfig', expectKubeconfig, 'version'],
      result: { status: 0, stdout: 'ok', stderr: '' },
    },
    {
      match: ['kubectl', '--kubeconfig', expectKubeconfig, 'get', 'nodes', '-o', 'json'],
      result: {
        status: 0,
        stdout: JSON.stringify({
          items: [{ status: { conditions: [{ type: 'Ready', status: 'True' }] } }],
        }),
        stderr: '',
      },
    },
  ]);

  const adapter = new AksAdapter([], runner);
  assert.deepEqual(await adapter.preflight(), { supported: true });
  assert.equal(
    calls.some(call => call.args.includes('az')),
    false
  );
});

test('AksAdapter runtime preflight rejects a cluster without a Ready schedulable node', async () => {
  const { runner } = createFakeCommandRunner([
    {
      match: ['which', 'kubectl'],
      result: { status: 0, stdout: '/usr/local/bin/kubectl\n', stderr: '' },
    },
    {
      match: ['kubectl', '--kubeconfig', expectKubeconfig, 'version'],
      result: { status: 0, stdout: 'ok', stderr: '' },
    },
    {
      match: ['kubectl', '--kubeconfig', expectKubeconfig, 'get', 'nodes', '-o', 'json'],
      result: {
        status: 0,
        stdout: JSON.stringify({
          items: [{ status: { conditions: [{ type: 'Ready', status: 'Unknown' }] } }],
        }),
        stderr: '',
      },
    },
  ]);

  const adapter = new AksAdapter([], runner);
  assert.deepEqual(await adapter.preflight(), {
    supported: false,
    reason: 'AKS has no Ready schedulable nodes',
  });
});
