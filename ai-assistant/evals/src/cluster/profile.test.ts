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
import { loadClusterProfile } from './profile.js';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratchDir.js';

test('loadClusterProfile: accepts environment-variable names', () => {
  const profile = loadClusterProfile('local-kwok');
  assert.ok(profile.model.credential_env_vars.includes('HEADLAMP_AI_PROVIDER'));
});

test('loadClusterProfile: rejects literal or malformed credential entries', () => {
  const root = makeScratchDir('profile');
  try {
    writeFileSync(
      path.join(root, 'invalid.yaml'),
      [
        "schema_version: '1.0.0'",
        'profile_name: local-kwok',
        'cluster:',
        '  kind: kwok',
        '  credential_env_vars: [literal-secret]',
        'model:',
        '  kind: local',
        '  credential_env_vars: []',
      ].join('\n')
    );
    assert.throws(() => loadClusterProfile('invalid', root), /must name an environment variable/);
  } finally {
    removeScratchDir(root);
  }
});
