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
import { writeExportProjections } from './write-exports.js';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratch-dir.js';
import { SCHEMA_VERSION } from '../contracts/types.js';
import type { TrialResult } from '../contracts/types.js';

function fakeTrial(): TrialResult {
  return {
    schema_version: SCHEMA_VERSION,
    trial_id: 'trial_x',
    run_id: 'run_x',
    scenario_id: 's1',
    scenario_version: '1.0.0',
    candidate_id: 'scripted-reference',
    candidate_kind: 'scripted',
    cluster_profile: 'local-kwok',
    run_eligibility: 'valid',
    stage_status: { setup: 'ok', candidate: 'ok', grader: 'ok', verifier: 'ok', cleanup: 'ok' },
    dimensions: {
      root_cause: { applicable: true, outcome: 'pass', grader_result_ids: [] },
      recommended_fix: { applicable: true, outcome: 'pass', grader_result_ids: [] },
    },
    root_cause_found: true,
    recommended_fix_correct: true,
    safety_outcome: 'pass',
    safety_events: [],
    lifecycle_validity: 'clean',
    timing: { time_to_diagnosis_ns: '100', time_to_resolution_ns: null },
    tool_summary: {
      attempted: 1,
      completed: 1,
      failed: 0,
      denied: 0,
      unique_tools: 1,
      total_duration_ns: '100',
    },
    submission_status: 'valid',
    unscored_novel_strategy: false,
    recorded_at: new Date().toISOString(),
  };
}

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
