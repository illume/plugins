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
import { projectToLangSmith } from './langsmith.js';
import { projectToOtlp } from './otlp.js';
import { SCHEMA_VERSION } from '../contracts/types.js';
import type { TrialResult } from '../contracts/types.js';

function fakeTrial(overrides: Partial<TrialResult> = {}): TrialResult {
  return {
    schema_version: SCHEMA_VERSION,
    trial_id: 'trial_x',
    run_id: 'run_x',
    scenario_id: 'core-service-selector-fault-v1',
    scenario_version: '1.0.0',
    candidate_id: 'scripted-reference',
    candidate_kind: 'scripted',
    execution_mode: 'dry-run',
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
    timing: { time_to_diagnosis_ns: '12345', time_to_resolution_ns: null },
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
    supersedes_trial_id: null,
    recorded_at: new Date().toISOString(),
    ...overrides,
  };
}

test('projectToLangSmith: maps trial_id/scenario identity and declares unsupported/dropped fields', () => {
  const projection = projectToLangSmith([fakeTrial()]);
  assert.equal(projection.runs.length, 1);
  assert.equal(projection.runs[0]?.id, 'trial_x');
  assert.equal(projection.runs[0]?.name, 'core-service-selector-fault-v1');
  assert.equal(projection.feedback[0]?.score, 1);
  assert.equal(projection.runs[0]?.extra.metadata.run_id, 'run_x');
  assert.equal(projection.feedback.length, 3);
});

test('projectToLangSmith: a null root_cause_found becomes a null score, never a fabricated 0', () => {
  const projection = projectToLangSmith([fakeTrial({ root_cause_found: null })]);
  assert.equal(projection.feedback[0]?.score, null);
});

test('projectToLangSmith: a false root_cause_found becomes score 0', () => {
  const projection = projectToLangSmith([fakeTrial({ root_cause_found: false })]);
  assert.equal(projection.feedback[0]?.score, 0);
});

test('projectToOtlp: maps every trial to one span with namespaced headlamp.eval attributes', () => {
  const projection = projectToOtlp([fakeTrial()]);
  const span = projection.resource_spans[0]?.spans[0];
  assert.match(span?.trace_id ?? '', /^[a-f0-9]{32}$/);
  assert.match(span?.span_id ?? '', /^[a-f0-9]{16}$/);
  assert.ok(BigInt(span?.end_time_unix_nano ?? '0') >= BigInt(span?.start_time_unix_nano ?? '0'));
  assert.equal(span?.attributes['headlamp.eval.scenario_id'], 'core-service-selector-fault-v1');
  assert.equal(span?.attributes['headlamp.eval.root_cause_found'], 'true');
  assert.ok(projection.unsupported_fields.length > 0);
});

test('projectToOtlp: a null root_cause_found is stringified as the literal "null", not dropped silently', () => {
  const projection = projectToOtlp([fakeTrial({ root_cause_found: null })]);
  assert.equal(
    projection.resource_spans[0]?.spans[0]?.attributes['headlamp.eval.root_cause_found'],
    'null'
  );
});

test('exporter projections are deterministic for identical input', () => {
  const trials = [fakeTrial()];
  assert.deepEqual(projectToLangSmith(trials), projectToLangSmith(trials));
  assert.deepEqual(projectToOtlp(trials), projectToOtlp(trials));
});
