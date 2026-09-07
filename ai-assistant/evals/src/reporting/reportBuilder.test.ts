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
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildReport, writeReport } from './reportBuilder.js';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratchDir.js';
import { SCHEMA_VERSION } from '../contracts/types.js';
import type { TrialResult } from '../contracts/types.js';

function fakeTrial(overrides: Partial<TrialResult>): TrialResult {
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
    ...overrides,
  };
}

test('buildReport: summary counts match the underlying trial set', () => {
  const trials = [
    fakeTrial({ trial_id: 't1' }),
    fakeTrial({
      trial_id: 't2',
      dimensions: {
        root_cause: { applicable: true, outcome: 'fail', grader_result_ids: [] },
        recommended_fix: { applicable: true, outcome: 'pass', grader_result_ids: [] },
      },
      root_cause_found: false,
    }),
  ];
  const report = buildReport({
    runId: 'run_x',
    bundleDigest: 'sha256:abc',
    trials,
    regressionDeltas: [],
    ownership: [],
  });
  assert.equal(report.decision, 'development_diagnostic');
  const summary = report.summary as unknown as {
    total_trials: number;
    task_outcomes_root_cause: Record<string, number>;
  };
  assert.equal(summary.total_trials, 2);
  assert.equal(summary.task_outcomes_root_cause.pass, 1);
  assert.equal(summary.task_outcomes_root_cause.fail, 1);
});

test('buildReport: failures section lists only non-eligible or failing trials', () => {
  const trials = [
    fakeTrial({ trial_id: 't1' }),
    fakeTrial({ trial_id: 't2', run_eligibility: 'invalid' }),
  ];
  const report = buildReport({
    runId: 'run_x',
    bundleDigest: 'sha256:abc',
    trials,
    regressionDeltas: [],
    ownership: [],
  });
  assert.equal(report.failures.length, 1);
  assert.equal((report.failures[0] as unknown as { trial_id: string }).trial_id, 't2');
});

test('buildReport: always lists the Phase 1 no-tool-comparison limitation', () => {
  const report = buildReport({
    runId: 'run_x',
    bundleDigest: 'sha256:abc',
    trials: [fakeTrial({})],
    regressionDeltas: [],
    ownership: [],
  });
  assert.ok(report.limitations.some(l => l.includes('no relative claim about another tool')));
});

test('writeReport: writes report.json, report.md, and projection-manifest.json', () => {
  const dir = makeScratchDir('report-write');
  try {
    const report = buildReport({
      runId: 'run_x',
      bundleDigest: 'sha256:abc',
      trials: [fakeTrial({})],
      regressionDeltas: [],
      ownership: [],
    });
    const { reportDir, reportDigest } = writeReport(dir, report);
    assert.ok(existsSync(path.join(reportDir, 'report.json')));
    assert.ok(existsSync(path.join(reportDir, 'report.md')));
    assert.ok(existsSync(path.join(reportDir, 'projection-manifest.json')));
    const manifest = JSON.parse(
      readFileSync(path.join(reportDir, 'projection-manifest.json'), 'utf8')
    );
    assert.equal(manifest.report_content_digest, reportDigest);
    const md = readFileSync(path.join(reportDir, 'report.md'), 'utf8');
    assert.match(md, /^# Headlamp AI Assistant evaluation report/);
    assert.match(md, /## Summary/);
    assert.match(md, /## Failures/);
    assert.match(md, /## Decision/);
    assert.match(md, /## Limitations/);
  } finally {
    removeScratchDir(dir);
  }
});

test('buildReport: identical input at the same instant produces identical summary/trials content', () => {
  const trials = [fakeTrial({ trial_id: 't1' })];
  const now = new Date('2024-01-01T00:00:00Z');
  const a = buildReport(
    { runId: 'run_x', bundleDigest: 'sha256:abc', trials, regressionDeltas: [], ownership: [] },
    now
  );
  const b = buildReport(
    { runId: 'run_x', bundleDigest: 'sha256:abc', trials, regressionDeltas: [], ownership: [] },
    now
  );
  assert.deepEqual(a.summary, b.summary);
  assert.deepEqual(a.trials, b.trials);
  assert.notEqual(a.report_id, b.report_id); // report_id is a fresh identity per generation, by design
});
