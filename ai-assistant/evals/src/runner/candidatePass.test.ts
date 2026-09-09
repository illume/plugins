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
import type { ClusterAdapter } from '../cluster/clusterAdapter.js';
import type { RunBundleWriter } from '../storage/bundleWriter.js';
import { runCandidatePass } from './candidatePass.js';

test('runCandidatePass disposes the cluster when preflight throws', async () => {
  let disposed = false;
  const cluster = {
    preflight: async () => {
      throw new Error('preflight failed');
    },
    dispose: async () => {
      disposed = true;
    },
  } as unknown as ClusterAdapter;

  await assert.rejects(
    runCandidatePass({
      runId: 'run-1',
      scenarios: [],
      bundleWriter: {} as RunBundleWriter,
      profile: 'local-kwok',
      mode: 'dry-run',
      createCandidate: () => {
        throw new Error('candidate should not be created');
      },
      createCluster: () => cluster,
    }),
    /preflight failed/
  );
  assert.equal(disposed, true);
});
