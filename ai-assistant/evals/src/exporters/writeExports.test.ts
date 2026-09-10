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
import { writeExportProjections } from './writeExports.js';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratchDir.js';
import { makeTrialResult as fakeTrial } from '../test-helpers/trialResult.js';

test('writeExportProjections: writes both offline golden projections with manifests and receipts, no network', () => {
  const dir = makeScratchDir('exports-write');
  try {
    const { langsmithDir, otlpDir } = writeExportProjections(dir, 'sha256:abc', [fakeTrial()]);
    assert.ok(existsSync(path.join(langsmithDir, 'langsmith-projection.json')));
    assert.ok(existsSync(path.join(langsmithDir, 'projection-manifest.json')));
    assert.ok(existsSync(path.join(langsmithDir, 'export-receipts.jsonl')));
    assert.ok(existsSync(path.join(otlpDir, 'otlp-projection.json')));
    assert.ok(existsSync(path.join(otlpDir, 'projection-manifest.json')));
    assert.ok(existsSync(path.join(otlpDir, 'export-receipts.jsonl')));
  } finally {
    removeScratchDir(dir);
  }
});
