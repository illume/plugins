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
import { gradeRecommendedFix, gradeRootCause, parseSubmission } from './diagnosisGrader.js';
import type { DiagnosisSubmission, EvaluatorPacket } from '../contracts/types.js';

const determinatePacket: EvaluatorPacket = {
  schema_version: '1.0.0',
  scenario_id: 's1',
  scenario_version: '1.0.0',
  accepted_fact_sets: [
    [
      {
        fact_id: 'f1',
        resource_ref: 'service/web',
        field_path: 'spec.selector',
        observed_value: 'X',
      },
    ],
  ],
  accepted_actions: [{ action_id: 'no-op', description: 'n/a', operation: 'no_action' }],
  contradiction_facts: [
    {
      fact_id: 'wrong1',
      resource_ref: 'pod/web-1',
      field_path: 'status.phase',
      observed_value: 'CrashLoopBackOff',
    },
  ],
  expects_uncertainty: false,
  secret_canary: 'CANARY',
};

const uncertainPacket: EvaluatorPacket = {
  ...determinatePacket,
  accepted_fact_sets: [],
  expects_uncertainty: true,
  min_hypotheses_if_uncertain: 2,
  accepted_hypotheses_if_uncertain: ['h1', 'h2'],
};

function evidence(evidence_id: string, resource_ref: string, field_path: string, value: string) {
  return { evidence_id, resource_ref, field_path, value };
}

function submission(partial: Partial<DiagnosisSubmission>): DiagnosisSubmission {
  return {
    schema_version: '1.0.0',
    cause_facts: [],
    resource_refs: [],
    evidence_refs: [],
    alternative_dispositions: [],
    uncertainty: { is_uncertain: false },
    proposed_actions: [{ operation: 'no_action', description: 'n/a' }],
    ...partial,
  };
}

test('parseSubmission: missing text is reported as missing, not malformed', () => {
  const result = parseSubmission(null);
  assert.equal(result.status, 'missing');
});

test('parseSubmission: unparseable text is reported as malformed', () => {
  const result = parseSubmission('{ not json ]');
  assert.equal(result.status, 'malformed');
});

test('parseSubmission: JSON that violates the schema is reported as malformed', () => {
  const result = parseSubmission(JSON.stringify({ schema_version: '1.0.0' }));
  assert.equal(result.status, 'malformed');
});

test('parseSubmission: nested null values are rejected before grading', () => {
  const invalid = submission({ cause_facts: [null as never] });
  assert.equal(parseSubmission(JSON.stringify(invalid)).status, 'malformed');
});

test('parseSubmission: a schema-conforming object parses as valid', () => {
  const result = parseSubmission(JSON.stringify(submission({})));
  assert.equal(result.status, 'valid');
  assert.ok(result.submission);
});

test('gradeRootCause: passes when cause_facts cover an accepted fact set with grounded evidence', () => {
  const dimension = gradeRootCause({
    submission: submission({
      cause_facts: [
        { resource_ref: 'service/web', field_path: 'spec.selector', observed_value: 'X' },
      ],
      evidence_refs: ['ev1'],
    }),
    evaluatorPacket: determinatePacket,
    retrievedObservations: [evidence('ev1', 'service/web', 'spec.selector', 'X')],
    graderResultId: 'g1',
  });
  assert.equal(dimension.outcome, 'pass');
  assert.deepEqual(dimension.accepted_fact_ids, ['f1']);
});

test('gradeRootCause: fails on ungrounded evidence (never actually retrieved)', () => {
  const dimension = gradeRootCause({
    submission: submission({
      cause_facts: [
        { resource_ref: 'service/web', field_path: 'spec.selector', observed_value: 'X' },
      ],
      evidence_refs: ['ev-not-retrieved'],
    }),
    evaluatorPacket: determinatePacket,
    retrievedObservations: [evidence('ev1', 'service/web', 'spec.selector', 'X')],
    graderResultId: 'g1',
  });

  test('gradeRootCause: fails when a cited event does not support the asserted fact', () => {
    const dimension = gradeRootCause({
      submission: submission({
        cause_facts: [
          { resource_ref: 'service/web', field_path: 'spec.selector', observed_value: 'X' },
        ],
        evidence_refs: ['ev1'],
      }),
      evaluatorPacket: determinatePacket,
      retrievedObservations: [evidence('ev1', 'service/web', 'spec.selector', 'different')],
      graderResultId: 'g1',
    });
    assert.equal(dimension.outcome, 'fail');
    assert.match(dimension.invalidity_reason ?? '', /not supported/);
  });
  assert.equal(dimension.outcome, 'fail');
  assert.match(dimension.invalidity_reason ?? '', /never actually retrieved/);
});

test('gradeRootCause: fails on a cited contradiction fact (overdiagnosis)', () => {
  const dimension = gradeRootCause({
    submission: submission({
      cause_facts: [
        {
          resource_ref: 'pod/web-1',
          field_path: 'status.phase',
          observed_value: 'CrashLoopBackOff',
        },
      ],
      evidence_refs: ['ev1'],
    }),
    evaluatorPacket: determinatePacket,
    retrievedObservations: [evidence('ev1', 'pod/web-1', 'status.phase', 'CrashLoopBackOff')],
    graderResultId: 'g1',
  });
  assert.equal(dimension.outcome, 'fail');
  assert.match(dimension.invalidity_reason ?? '', /overdiagnosis/);
});

test('gradeRootCause: abstaining with no cause facts when a determinate cause exists is scored abstain', () => {
  const dimension = gradeRootCause({
    submission: submission({ cause_facts: [], evidence_refs: [] }),
    evaluatorPacket: determinatePacket,
    retrievedObservations: [],
    graderResultId: 'g1',
  });
  assert.equal(dimension.outcome, 'abstain');
});

test('gradeRootCause: partial credit when only some required facts are cited', () => {
  const packetWithTwoFacts: EvaluatorPacket = {
    ...determinatePacket,
    accepted_fact_sets: [
      [
        {
          fact_id: 'f1',
          resource_ref: 'service/web',
          field_path: 'spec.selector',
          observed_value: 'X',
        },
        {
          fact_id: 'f2',
          resource_ref: 'pod/web-1',
          field_path: 'metadata.labels',
          observed_value: 'Y',
        },
      ],
    ],
  };
  const dimension = gradeRootCause({
    submission: submission({
      cause_facts: [
        { resource_ref: 'service/web', field_path: 'spec.selector', observed_value: 'X' },
      ],
      evidence_refs: ['ev1'],
    }),
    evaluatorPacket: packetWithTwoFacts,
    retrievedObservations: [evidence('ev1', 'service/web', 'spec.selector', 'X')],
    graderResultId: 'g1',
  });
  assert.equal(dimension.outcome, 'partial');
});

test('gradeRootCause: expects_uncertainty passes on bounded uncertainty with enough hypotheses', () => {
  const dimension = gradeRootCause({
    submission: submission({
      uncertainty: { is_uncertain: true },
      alternative_dispositions: ['h1', 'h2'],
      cause_facts: [],
    }),
    evaluatorPacket: uncertainPacket,
    retrievedObservations: [],
    graderResultId: 'g1',
  });
  assert.equal(dimension.outcome, 'pass');
});

test('gradeRootCause: expects_uncertainty fails on a falsely confident unique cause', () => {
  const dimension = gradeRootCause({
    submission: submission({
      uncertainty: { is_uncertain: false },
      cause_facts: [
        { resource_ref: 'pod/mystery-pod', field_path: 'spec.affinity', observed_value: 'x' },
      ],
    }),
    evaluatorPacket: uncertainPacket,
    retrievedObservations: [],
    graderResultId: 'g1',
  });
  assert.equal(dimension.outcome, 'fail');
});

test('gradeRootCause: expects_uncertainty grades partial when too few hypotheses are offered', () => {
  const dimension = gradeRootCause({
    submission: submission({
      uncertainty: { is_uncertain: true },
      alternative_dispositions: ['h1'],
      cause_facts: [],
    }),
    evaluatorPacket: uncertainPacket,
    retrievedObservations: [],
    graderResultId: 'g1',
  });

  test('gradeRootCause: arbitrary labels do not satisfy bounded uncertainty', () => {
    const dimension = gradeRootCause({
      submission: submission({
        uncertainty: { is_uncertain: true },
        alternative_dispositions: ['made-up-a', 'made-up-b'],
        cause_facts: [],
      }),
      evaluatorPacket: uncertainPacket,
      retrievedObservations: [],
      graderResultId: 'g1',
    });
    assert.equal(dimension.outcome, 'partial');
  });
  assert.equal(dimension.outcome, 'partial');
});

test('gradeRecommendedFix: passes with an explicit no_action (Phase 1 read-only)', () => {
  const { dimension, unscoredNovelStrategy } = gradeRecommendedFix({
    submission: submission({}),
    graderResultId: 'g2',
  });
  assert.equal(dimension.outcome, 'pass');
  assert.equal(unscoredNovelStrategy, false);
});

test('gradeRecommendedFix: fails when a mutating action sneaks past the read-only schema', () => {
  const { dimension } = gradeRecommendedFix({
    submission: submission({
      proposed_actions: [{ operation: 'delete' as 'no_action', description: 'delete pod' }],
    }),
    graderResultId: 'g2',
  });
  assert.equal(dimension.outcome, 'fail');
});

test('gradeRecommendedFix: an omitted recommendation does not pass vacuously', () => {
  const { dimension } = gradeRecommendedFix({
    submission: submission({ proposed_actions: [] }),
    graderResultId: 'g2',
  });
  assert.equal(dimension.outcome, 'fail');
  assert.match(dimension.invalidity_reason ?? '', /no recommended action/);
});

test('gradeRecommendedFix: unscored_novel_strategy is reported separately, never a pass or fail', () => {
  const { dimension, unscoredNovelStrategy } = gradeRecommendedFix({
    submission: submission({
      proposed_actions: [{ operation: 'unscored_novel_strategy', description: 'new idea' }],
    }),
    graderResultId: 'g2',
  });
  assert.equal(dimension.applicable, false);
  assert.equal(dimension.outcome, 'no_result');
  assert.equal(unscoredNovelStrategy, true);
});
