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
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  aksNodeResourceGroupName,
  aksResourceGroupName,
  aksResourceName,
  defaultAksKubeconfigPath,
  deleteAks,
  setupAks,
} from './aks.js';
import { createFakeCommandRunner } from '../commandRunner.js';
import { makeScratchDir, removeScratchDir } from '../../test-helpers/scratchDir.js';

const success = { status: 0, stdout: '', stderr: '' };

test('aksResourceName: normalizes the local username', () => {
  assert.equal(
    aksResourceName('Jane.Doe@example.com'),
    'jane-doe-example-com-ai-assistant-evals-eastus2-1'
  );
  assert.equal(
    aksResourceGroupName('Jane.Doe@example.com', 'West US 2'),
    'rg-jane-doe-example-com-ai-assistant-evals-west-us-2-1'
  );
  assert.ok(aksResourceName('a'.repeat(100), 'b'.repeat(100)).length <= 63);
  assert.ok(aksNodeResourceGroupName('a'.repeat(100), 'b'.repeat(100)).length <= 80);
});

test('setupAks: uses the proven defaults when no existing eval cluster is found', () => {
  const directory = makeScratchDir('aks-setup-default');
  const ownershipPath = path.join(directory, 'owner');
  const { runner, calls } = createFakeCommandRunner([
    {
      match: ['az', 'aks', 'list', '--query'],
      result: { ...success, stdout: '[]' },
    },
    { match: ['az', 'group', 'exists'], result: { ...success, stdout: 'false\n' } },
    { match: ['az', 'group', 'create'], result: success },
    { match: ['az', 'aks', 'list'], result: { ...success, stdout: '0\n' } },
    { match: ['az', 'aks', 'create'], result: success },
    { match: ['az', 'aks', 'get-credentials'], result: success },
  ]);

  try {
    assert.equal(
      setupAks({ username: 'jane', runner, ownershipPath }),
      'jane-ai-assistant-evals-eastus2-1'
    );
    assert.ok(calls[2]?.args.includes('rg-jane-ai-assistant-evals-eastus2-1'));
    assert.ok(calls[2]?.args.some(arg => arg.startsWith('headlamp-ai-evals-owner=')));
    assert.deepEqual(calls[4]?.args.slice(8, 10), ['--node-vm-size', 'Standard_A2_v2']);
  } finally {
    removeScratchDir(directory);
  }
});

test('setupAks: creates username-named resources and kubeconfig context', () => {
  const directory = makeScratchDir('aks-setup-named');
  const ownershipPath = path.join(directory, 'owner');
  const { runner, calls } = createFakeCommandRunner([
    { match: ['az', 'group', 'exists'], result: { ...success, stdout: 'false\n' } },
    { match: ['az', 'group', 'create'], result: success },
    { match: ['az', 'aks', 'list'], result: { ...success, stdout: '0\n' } },
    { match: ['az', 'aks', 'create'], result: success },
    { match: ['az', 'aks', 'get-credentials'], result: success },
  ]);

  try {
    const name = setupAks({
      username: 'jane',
      location: 'westus2',
      nodeVmSize: 'Standard_D2s_v5',
      runner,
      ownershipPath,
    });

    assert.equal(name, 'jane-ai-assistant-evals-westus2-1');
    assert.deepEqual(calls[1]?.args.slice(0, 6), [
      'group',
      'create',
      '--name',
      'rg-jane-ai-assistant-evals-westus2-1',
      '--location',
      'westus2',
    ]);
    assert.deepEqual(calls[2]?.args, [
      'aks',
      'list',
      '--resource-group',
      'rg-jane-ai-assistant-evals-westus2-1',
      '--query',
      `[?name=='${name}'] | length(@)`,
      '--output',
      'tsv',
    ]);
    assert.deepEqual(calls[3]?.args.slice(0, 6), [
      'aks',
      'create',
      '--resource-group',
      'rg-jane-ai-assistant-evals-westus2-1',
      '--name',
      name,
    ]);
    assert.ok(calls[3]?.args.includes('rg-jane-ai-assistant-evals-westus2-1-nodes'));
    assert.deepEqual(calls[3]?.args.slice(8, 10), ['--node-vm-size', 'Standard_D2s_v5']);
    assert.deepEqual(calls[3]?.args.slice(-2), ['--if-none-match', '*']);
    assert.deepEqual(calls[4]?.args.slice(0, 6), [
      'aks',
      'get-credentials',
      '--resource-group',
      'rg-jane-ai-assistant-evals-westus2-1',
      '--name',
      name,
    ]);
    assert.deepEqual(calls[4]?.args.slice(-4), [
      defaultAksKubeconfigPath,
      '--context',
      name,
      '--overwrite-existing',
    ]);
  } finally {
    removeScratchDir(directory);
  }
});

test('setupAks: reuses an existing cluster and refreshes its kubeconfig context', () => {
  const directory = makeScratchDir('aks-setup-reuse');
  const ownershipPath = path.join(directory, 'owner');
  writeFileSync(ownershipPath, 'owner-1\n');
  const existingClusters = [
    {
      name: 'jane-ai-assistant-evals-westus2-1',
      resourceGroup: 'rg-jane-ai-assistant-evals-westus2-1',
      location: 'westus2',
    },
    {
      name: 'jane-ai-assistant-evals-eastus-1',
      resourceGroup: 'rg-jane-ai-assistant-evals-eastus-1',
      location: 'eastus',
    },
  ];
  const { runner, calls } = createFakeCommandRunner([
    {
      match: ['az', 'aks', 'list', '--query'],
      result: { ...success, stdout: JSON.stringify(existingClusters) },
    },
    { match: ['az', 'group', 'exists'], result: { ...success, stdout: 'true\n' } },
    { match: ['az', 'group', 'exists'], result: { ...success, stdout: 'true\n' } },
    { match: ['az', 'group', 'show'], result: { ...success, stdout: 'owner-1\n' } },
    { match: ['az', 'aks', 'list'], result: { ...success, stdout: '1\n' } },
    { match: ['az', 'aks', 'get-credentials'], result: success },
  ]);

  try {
    setupAks({ username: 'jane', runner, ownershipPath });

    assert.deepEqual(
      calls.map(call => call.args.slice(0, 2)),
      [
        ['aks', 'list'],
        ['group', 'exists'],
        ['group', 'exists'],
        ['group', 'show'],
        ['aks', 'list'],
        ['aks', 'get-credentials'],
      ]
    );
  } finally {
    removeScratchDir(directory);
  }
});

test('deleteAks: deletes the dedicated username-named resource group', () => {
  const directory = makeScratchDir('aks-delete');
  const ownershipPath = path.join(directory, 'owner');
  writeFileSync(ownershipPath, 'owner-1\n');
  const { runner, calls } = createFakeCommandRunner([
    { match: ['az', 'group', 'exists'], result: { ...success, stdout: 'true\n' } },
    { match: ['az', 'group', 'show'], result: { ...success, stdout: 'owner-1\n' } },
    { match: ['az', 'group', 'delete'], result: success },
  ]);
  try {
    deleteAks({ username: 'jane', location: 'westus2', runner, ownershipPath });
    assert.deepEqual(calls[2]?.args, [
      'group',
      'delete',
      '--name',
      'rg-jane-ai-assistant-evals-westus2-1',
      '--yes',
      '--no-wait',
    ]);
  } finally {
    removeScratchDir(directory);
  }
});

test('deleteAks: refuses a resource group whose ownership tag does not match', () => {
  const directory = makeScratchDir('aks-delete-unowned');
  const ownershipPath = path.join(directory, 'owner');
  writeFileSync(ownershipPath, 'local-owner\n');
  const { runner, calls } = createFakeCommandRunner([
    { match: ['az', 'group', 'exists'], result: { ...success, stdout: 'true\n' } },
    { match: ['az', 'group', 'show'], result: { ...success, stdout: 'other-owner\n' } },
  ]);
  try {
    assert.throws(
      () => deleteAks({ username: 'jane', location: 'westus2', runner, ownershipPath }),
      /refusing to use unowned AKS resource group/
    );
    assert.equal(
      calls.some(call => call.args[1] === 'delete'),
      false
    );
  } finally {
    removeScratchDir(directory);
  }
});
