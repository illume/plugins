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
import { makeTrialResult as fakeTrial } from '../test-helpers/trialResult.js';
import { assertValid, validate } from '../contracts/validate.js';
import { loadSchema } from '../contracts/schemas.js';
import { PHASE_ONE_SCENARIO_IDS } from '../contracts/evaluationContracts.js';

test('buildReport: summary counts match the underlying trial set', () => {
  const trials = [
    fakeTrial({ trial_id: 't1' }),
    fakeTrial({
      trial_id: 't2',
      dimensions: {
        root_cause: { applicable: true, outcome: 'fail', grader_result_ids: [] },
        recommended_fix: { applicable: true, outcome: 'pass', grader_result_ids: [] },
      },
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
  const summary = report.summary;
  assert.equal(summary.total_trials, 2);
  assert.equal(summary.task_outcomes_root_cause.pass, 1);
  assert.equal(summary.task_outcomes_root_cause.fail, 1);
});

test('buildReport: task outcomes exclude invalid trials from counts and denominator', () => {
  const report = buildReport({
    runId: 'run_x',
    bundleDigest: 'sha256:abc',
    trials: [
      fakeTrial({ trial_id: 'valid' }),
      fakeTrial({
        trial_id: 'invalid',
        run_eligibility: 'invalid',
        dimensions: {
          root_cause: { applicable: true, outcome: 'fail', grader_result_ids: [] },
          recommended_fix: { applicable: true, outcome: 'pass', grader_result_ids: [] },
        },
      }),
    ],
    regressionDeltas: [],
    ownership: [],
  });

  assert.deepEqual(report.summary.task_outcomes_root_cause, { pass: 1 });
  assert.equal(report.summary.task_outcomes_root_cause_denominator, 1);
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
  assert.equal(report.failures[0]?.trial_id, 't2');
});

test('buildReport: failures include valid trials with every non-pass root-cause outcome', () => {
  const trials = (['partial', 'abstain', 'no_result'] as const).map((outcome, index) =>
    fakeTrial({
      trial_id: `t${index}`,
      dimensions: {
        root_cause: { applicable: true, outcome, grader_result_ids: [] },
        recommended_fix: { applicable: true, outcome: 'pass', grader_result_ids: [] },
      },
    })
  );
  const report = buildReport({
    runId: 'run_x',
    bundleDigest: 'sha256:abc',
    trials,
    regressionDeltas: [],
    ownership: [],
  });
  assert.equal(report.failures.length, 3);
});

test('buildReport: failures include valid trials with unknown safety outcomes', () => {
  const report = buildReport({
    runId: 'run_x',
    bundleDigest: 'sha256:abc',
    trials: [fakeTrial({ trial_id: 'unknown-safety', safety_outcome: 'unknown' })],
    regressionDeltas: [],
    ownership: [],
  });
  assert.equal(report.failures.length, 1);
  assert.equal(report.failures[0]?.trial_id, 'unknown-safety');
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

test('buildReport: treats omitted pricing as the normal optional-enrichment path', () => {
  const report = buildReport({
    runId: 'run_x',
    bundleDigest: 'sha256:abc',
    trials: [fakeTrial({ configured_usage_estimate: null })],
    regressionDeltas: [],
    ownership: [],
  });
  const pricingNote = report.limitations.find(l => l.includes('Pricing enrichment'));
  assert.match(pricingNote ?? '', /not requested/);
  assert.doesNotMatch(pricingNote ?? '', /unavailable/i);
});

test('buildReport: coverage metadata is evidence-linked and schema-valid', () => {
  const report = buildReport({
    runId: 'run_x',
    bundleDigest: 'sha256:abc',
    trials: [fakeTrial({})],
    regressionDeltas: [],
    ownership: [],
  });
  assertValid(loadSchema('report'), report, 'report');
  assert.ok(
    report.best_practice_gap_analysis.every(
      row => row.owner && row.next_review_date && Array.isArray(row.evidence_artifact_links)
    )
  );
  assert.equal(
    report.best_practice_gap_analysis.find(row => row.best_practice === 'Real product execution')
      ?.disposition,
    'qualification_pending'
  );
  assert.deepEqual(report.exporter_coverage.mappings, [
    'langsmith@2.0.0',
    'otlp-genai@2.0.0+semconv.1.29.0',
  ]);
  assert.deepEqual(
    report.best_practice_gap_analysis.map(row => row.best_practice),
    [
      'Decision, construct, acceptance criteria, reference',
      'Candidate/truth separation and immutable evidence',
      'Export and observability portability',
      'Eval-system health and failure ownership',
      'Case ownership, provenance, review, and quarantine',
      'Real product execution',
      'Dataset lifecycle',
      'Repeats and uncertainty',
      'Continuous evaluation',
      'Repair, approval, and least privilege',
      'External tool comparison',
      'Interaction and robustness',
      'Distribution coverage',
      'SME audit and case maintenance',
      'Grader portfolio',
      'Adversarial safety',
      'Production feedback and validity',
      'Human reliance or usability',
      'AKS/cloud parity',
    ]
  );
});

test('buildReport: only valid real CLI execution satisfies real-product coverage', () => {
  const coverage = (run_eligibility: 'valid' | 'invalid') => {
    const report = buildReport({
      runId: 'run_x',
      bundleDigest: 'sha256:abc',
      trials: [
        fakeTrial({
          candidate_kind: 'headlamp-cli',
          execution_mode: 'real',
          run_eligibility,
        }),
      ],
      regressionDeltas: [],
      ownership: [],
    });
    return report.best_practice_gap_analysis.find(
      row => row.best_practice === 'Real product execution'
    )?.disposition;
  };

  assert.equal(coverage('invalid'), 'qualification_pending');
  assert.equal(coverage('valid'), 'implemented');
});

test('buildReport: invalid trials do not satisfy four-case coverage', () => {
  const report = buildReport({
    runId: 'run_x',
    bundleDigest: 'sha256:abc',
    trials: PHASE_ONE_SCENARIO_IDS.map((scenario_id, index) =>
      fakeTrial({ trial_id: `invalid-${index}`, scenario_id, run_eligibility: 'invalid' })
    ),
    regressionDeltas: [],
    ownership: [],
  });

  for (const bestPractice of [
    'Decision, construct, acceptance criteria, reference',
    'Interaction and robustness',
  ]) {
    assert.equal(
      report.best_practice_gap_analysis.find(row => row.best_practice === bestPractice)
        ?.disposition,
      'qualification_pending'
    );
  }
});

test('report schema rejects malformed report-owned aggregates', () => {
  const report = buildReport({
    runId: 'run_x',
    bundleDigest: 'sha256:abc',
    trials: [fakeTrial({})],
    regressionDeltas: [],
    ownership: [],
  });
  const malformed = structuredClone(report);
  malformed.summary.total_trials = -1;

  const result = validate(loadSchema('report'), malformed);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.path === '$.summary.total_trials'));
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
    assert.match(md, /\[evidence\]\(\.\.\/\.\.\/\.\.\/bundle\/manifest\.json\)/);
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
  assert.equal(a.report_id, b.report_id);
});

test('writeReport: volatile generation time does not change the report content digest', () => {
  const dir = makeScratchDir('report-deterministic');
  try {
    const input = {
      runId: 'run_x',
      bundleDigest: 'sha256:abc',
      trials: [fakeTrial({ recorded_at: '2024-01-01T00:00:00Z' })],
      regressionDeltas: [],
      ownership: [],
    };
    const a = writeReport(dir, buildReport(input, new Date('2024-01-01T00:00:00Z')));
    const b = writeReport(dir, buildReport(input, new Date('2025-01-01T00:00:00Z')));
    assert.equal(a.reportDigest, b.reportDigest);
  } finally {
    removeScratchDir(dir);
  }
});
