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
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildReport } from '../reporting/reportBuilder.js';
import { checkOverallViews, publishRun, redactReport, regenerateOverallViews } from './publish.js';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratchDir.js';
import { makeTrialResult as fakeTrial } from '../test-helpers/trialResult.js';

test('redactReport: never carries a secret canary or raw trial payload, only aggregate fields', () => {
  const report = buildReport({
    runId: 'run_x',
    bundleDigest: 'sha256:abc',
    trials: [fakeTrial()],
    regressionDeltas: [],
    ownership: [],
  });
  const redacted = redactReport(report);
  const text = JSON.stringify(redacted);
  assert.ok(!text.includes('EVAL-CANARY'));
  assert.equal(redacted.failure_count, 0);
  assert.equal((redacted as Record<string, unknown>).trials, undefined);
});

test('regenerateOverallViews: with no publications yet, README explains there is nothing published', () => {
  const dir = makeScratchDir('publish-empty');
  try {
    regenerateOverallViews(dir, new Date('2024-01-01T00:00:00Z'));
    const readme = readFileSync(path.join(dir, 'README.md'), 'utf8');
    assert.match(readme, /No runs have been published yet/);
    const overall = JSON.parse(readFileSync(path.join(dir, 'overall-report.json'), 'utf8'));
    assert.equal(overall.publication_count, 0);
  } finally {
    removeScratchDir(dir);
  }
});

test('publishRun + regenerateOverallViews: writes an immutable run directory and a consistent overall view', () => {
  const dir = makeScratchDir('publish-one');
  try {
    const report = buildReport({
      runId: 'run_x',
      bundleDigest: 'sha256:abc',
      trials: [fakeTrial()],
      regressionDeltas: [],
      ownership: [],
    });
    report.summary.task_outcomes_root_cause = { fail: 1, abstain: 1 };
    const { publicationDir } = publishRun({
      resultsRoot: dir,
      report,
      bundleDigest: 'sha256:abc',
      now: new Date('2024-06-01T00:00:00Z'),
    });
    assert.ok(existsSync(path.join(publicationDir, 'report.json')));
    assert.ok(existsSync(path.join(publicationDir, 'projection-manifest.json')));
    assert.ok(existsSync(path.join(publicationDir, 'README.md')));

    regenerateOverallViews(dir, new Date('2024-06-02T00:00:00Z'));
    const overall = JSON.parse(readFileSync(path.join(dir, 'overall-report.json'), 'utf8'));
    assert.equal(overall.publication_count, 1);
    const readme = readFileSync(path.join(dir, 'README.md'), 'utf8');
    assert.match(readme, /Latest publication/);
    assert.match(readme, /scripted-reference/);
    assert.match(readme, /Control-only diagnostic/);
    assert.ok(readme.indexOf('| abstain | 1 |') < readme.indexOf('| fail | 1 |'));
  } finally {
    removeScratchDir(dir);
  }
});

test('regenerateOverallViews: rejects an invalid publication manifest', () => {
  const dir = makeScratchDir('publish-invalid-manifest');
  try {
    const report = buildReport({
      runId: 'run_x',
      bundleDigest: 'sha256:abc',
      trials: [fakeTrial()],
      regressionDeltas: [],
      ownership: [],
    });
    const { publicationDir } = publishRun({
      resultsRoot: dir,
      report,
      bundleDigest: 'sha256:abc',
      now: new Date('2024-06-01T00:00:00Z'),
    });
    const manifestPath = path.join(publicationDir, 'projection-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      report_content_digest: string;
    };
    manifest.report_content_digest = 'not-a-digest';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    assert.throws(() => regenerateOverallViews(dir), /invalid report_content_digest/);
  } finally {
    removeScratchDir(dir);
  }
});

test('publishRun: refuses to publish into a directory that already exists', () => {
  const dir = makeScratchDir('publish-twice');
  try {
    const report = buildReport({
      runId: 'run_x',
      bundleDigest: 'sha256:abc',
      trials: [fakeTrial()],
      regressionDeltas: [],
      ownership: [],
    });
    const now = new Date('2024-06-01T00:00:00Z');
    publishRun({
      resultsRoot: dir,
      report,
      bundleDigest: 'sha256:abc',
      now,
      publicationIdOverride: 'pub_fixed',
    });
    assert.throws(
      () =>
        publishRun({
          resultsRoot: dir,
          report,
          bundleDigest: 'sha256:abc',
          now,
          publicationIdOverride: 'pub_fixed',
        }),
      /already exists/
    );
  } finally {
    removeScratchDir(dir);
  }
});

test('checkOverallViews: passes immediately after regenerateOverallViews, fails after a stale edit', () => {
  const dir = makeScratchDir('publish-check');
  try {
    const report = buildReport({
      runId: 'run_x',
      bundleDigest: 'sha256:abc',
      trials: [fakeTrial()],
      regressionDeltas: [],
      ownership: [],
    });
    publishRun({
      resultsRoot: dir,
      report,
      bundleDigest: 'sha256:abc',
      now: new Date('2024-06-01T00:00:00Z'),
    });
    regenerateOverallViews(dir, new Date('2024-06-02T00:00:00Z'));

    const okResult = checkOverallViews(dir, new Date('2024-06-02T00:00:00Z'));
    assert.equal(okResult.ok, true);

    rmSync(path.join(dir, 'index.json'));
    const staleResult = checkOverallViews(dir, new Date('2024-06-02T00:00:00Z'));
    assert.equal(staleResult.ok, false);
    assert.ok(staleResult.issues.some(i => i.includes('index.json')));
  } finally {
    removeScratchDir(dir);
  }
});

test('deleting and rebuilding the three generated files reproduces the same overall-report.json content (minus generated_at)', () => {
  const dir = makeScratchDir('publish-rebuild');
  try {
    const report = buildReport({
      runId: 'run_x',
      bundleDigest: 'sha256:abc',
      trials: [fakeTrial()],
      regressionDeltas: [],
      ownership: [],
    });
    publishRun({
      resultsRoot: dir,
      report,
      bundleDigest: 'sha256:abc',
      now: new Date('2024-06-01T00:00:00Z'),
    });
    regenerateOverallViews(dir, new Date('2024-06-02T00:00:00Z'));
    const before = JSON.parse(readFileSync(path.join(dir, 'overall-report.json'), 'utf8'));

    rmSync(path.join(dir, 'overall-report.json'));
    rmSync(path.join(dir, 'index.json'));
    rmSync(path.join(dir, 'README.md'));
    regenerateOverallViews(dir, new Date('2024-06-03T00:00:00Z'));
    const after = JSON.parse(readFileSync(path.join(dir, 'overall-report.json'), 'utf8'));

    before.generated_at = 'volatile';
    after.generated_at = 'volatile';
    assert.deepEqual(before, after);
  } finally {
    removeScratchDir(dir);
  }
});
