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
import { commandExists, createFakeCommandRunner } from './commandRunner.js';

test('createFakeCommandRunner: records every call it receives', () => {
  const { runner, calls } = createFakeCommandRunner([
    { match: ['kubectl', 'version'], result: { status: 0, stdout: 'ok', stderr: '' } },
  ]);
  const result = runner('kubectl', ['version', '--client']);
  assert.equal(result.status, 0);
  assert.deepEqual(calls, [{ command: 'kubectl', args: ['version', '--client'] }]);
});

test('createFakeCommandRunner: an unmatched call fails loudly instead of silently succeeding', () => {
  const { runner } = createFakeCommandRunner([]);
  const result = runner('kubectl', ['get', 'pods']);
  assert.equal(result.status, 127);
  assert.match(result.stderr, /no fake response registered/);
});

test('commandExists: true when the fake locator reports success', () => {
  const { runner } = createFakeCommandRunner([
    { match: ['which', 'kubectl'], result: { status: 0, stdout: '/usr/bin/kubectl', stderr: '' } },
  ]);
  assert.equal(commandExists('kubectl', runner), true);
});

test('commandExists: false when the fake locator reports failure', () => {
  const { runner } = createFakeCommandRunner([
    { match: ['which', 'kwokctl'], result: { status: 1, stdout: '', stderr: '' } },
  ]);
  assert.equal(commandExists('kwokctl', runner), false);
});
