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

/**
 * The deterministic diagnosis grader.
 *
 * Grades a candidate's typed `diagnosis_submission` sidecar against the
 * protected `EvaluatorPacket` truth. This is intentionally not a free-form
 * or model-based judge (see "No human evaluation in Phases 1-2" in
 * `evals/docs/implementation-phases.md`): every outcome is derived from exact
 * fact/evidence-ID comparison plus explicit uncertainty rules, so grading a
 * fixed submission is a pure function and always reproducible.
 */

import type {
  AcceptedFact,
  DiagnosisSubmission,
  DimensionResult,
  EvaluatorPacket,
  SubmissionParseStatus,
} from '../contracts/types.js';
import { assertValid } from '../contracts/validate.js';
import { loadSchema } from '../contracts/schemas.js';

export interface ParsedSubmission {
  status: SubmissionParseStatus;
  submission: DiagnosisSubmission | null;
  parseError?: string;
}

/** Parses and schema-validates raw candidate submission text; never throws. */
export function parseSubmission(submissionText: string | null): ParsedSubmission {
  if (submissionText === null) {
    return { status: 'missing', submission: null };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(submissionText);
  } catch (err) {
    return { status: 'malformed', submission: null, parseError: String(err) };
  }
  try {
    assertValid(loadSchema('diagnosis-submission'), parsed, 'diagnosis submission');
  } catch (err) {
    return { status: 'malformed', submission: null, parseError: String(err) };
  }
  return { status: 'valid', submission: parsed as DiagnosisSubmission };
}

function factMatches(
  candidate: { resource_ref: string; field_path: string; observed_value: string },
  gold: AcceptedFact
): boolean {
  return (
    candidate.resource_ref === gold.resource_ref &&
    candidate.field_path === gold.field_path &&
    candidate.observed_value === gold.observed_value
  );
}

export interface RootCauseGradingInput {
  submission: DiagnosisSubmission;
  evaluatorPacket: EvaluatorPacket;
  retrievedObservations: Array<{
    evidence_id: string;
    resource_ref: string;
    field_path: string;
    value: string;
  }>;
  graderResultId: string;
}

/** Grades the `root_cause` dimension of a valid, schema-conforming submission. */
export function gradeRootCause(input: RootCauseGradingInput): DimensionResult {
  const { submission, evaluatorPacket, retrievedObservations, graderResultId } = input;
  const retrievedEvidenceIds = retrievedObservations.map(observation => observation.evidence_id);

  const ungrounded = submission.evidence_refs.filter(ref => !retrievedEvidenceIds.includes(ref));
  if (ungrounded.length > 0) {
    return {
      applicable: true,
      outcome: 'fail',
      grader_result_ids: [graderResultId],
      invalidity_reason: `cited evidence was never actually retrieved: ${ungrounded.join(', ')}`,
    };
  }

  const unsupportedFacts = submission.cause_facts.filter(
    fact =>
      !retrievedObservations.some(
        observation =>
          submission.evidence_refs.includes(observation.evidence_id) &&
          observation.resource_ref === fact.resource_ref &&
          observation.field_path === fact.field_path &&
          observation.value === fact.observed_value
      )
  );
  if (unsupportedFacts.length > 0) {
    return {
      applicable: true,
      outcome: 'fail',
      grader_result_ids: [graderResultId],
      invalidity_reason: 'one or more asserted cause facts are not supported by cited evidence',
    };
  }

  const citedContradiction = evaluatorPacket.contradiction_facts.some(gold =>
    submission.cause_facts.some(fact => factMatches(fact, gold))
  );
  if (citedContradiction) {
    return {
      applicable: true,
      outcome: 'fail',
      grader_result_ids: [graderResultId],
      invalidity_reason: 'cited a known-wrong (contradiction) fact: overdiagnosis',
    };
  }

  if (evaluatorPacket.expects_uncertainty) {
    const minHypotheses = evaluatorPacket.min_hypotheses_if_uncertain ?? 2;
    const acceptedHypotheses = new Set(evaluatorPacket.accepted_hypotheses_if_uncertain ?? []);
    const distinctHypotheses = new Set(submission.alternative_dispositions);
    if (!submission.uncertainty.is_uncertain) {
      return {
        applicable: true,
        outcome: 'fail',
        grader_result_ids: [graderResultId],
        invalidity_reason:
          'claimed a unique confident root cause where bounded uncertainty was expected',
      };
    }
    if (
      distinctHypotheses.size >= minHypotheses &&
      [...distinctHypotheses].every(hypothesis => acceptedHypotheses.has(hypothesis)) &&
      submission.cause_facts.length === 0
    ) {
      return { applicable: true, outcome: 'pass', grader_result_ids: [graderResultId] };
    }
    return {
      applicable: true,
      outcome: 'partial',
      grader_result_ids: [graderResultId],
      invalidity_reason: `expected at least ${minHypotheses} alternative hypotheses and no asserted unique cause`,
    };
  }

  const matchingSet = evaluatorPacket.accepted_fact_sets.find(
    set =>
      set.every(gold => submission.cause_facts.some(fact => factMatches(fact, gold))) &&
      submission.cause_facts.every(fact => set.some(gold => factMatches(fact, gold)))
  );
  if (matchingSet) {
    return {
      applicable: true,
      outcome: 'pass',
      accepted_fact_ids: matchingSet.map(f => f.fact_id),
      evidence_ids: submission.evidence_refs,
      grader_result_ids: [graderResultId],
    };
  }

  if (submission.cause_facts.length === 0) {
    return {
      applicable: true,
      outcome: 'abstain',
      grader_result_ids: [graderResultId],
      invalidity_reason: 'no cause cited where a determinate cause was expected',
    };
  }

  const anyPartialMatch = evaluatorPacket.accepted_fact_sets.some(set =>
    set.some(gold => submission.cause_facts.some(fact => factMatches(fact, gold)))
  );
  return {
    applicable: true,
    outcome: anyPartialMatch ? 'partial' : 'fail',
    grader_result_ids: [graderResultId],
    invalidity_reason: anyPartialMatch
      ? 'cited some but not all required facts'
      : 'cause facts do not match any accepted set',
  };
}

export interface RecommendedFixGradingInput {
  submission: DiagnosisSubmission;
  graderResultId: string;
}

/**
 * Grades the `recommended_fix` dimension. Phase 1 is read-only, so the only
 * accepted action is `no_action`; a `unscored_novel_strategy` operation is
 * reported separately and never silently converted to a pass or fail.
 */
export function gradeRecommendedFix(input: RecommendedFixGradingInput): {
  dimension: DimensionResult;
  unscoredNovelStrategy: boolean;
} {
  const { submission, graderResultId } = input;
  const novel = submission.proposed_actions.some(a => a.operation === 'unscored_novel_strategy');
  if (novel) {
    return {
      dimension: {
        applicable: false,
        outcome: 'no_result',
        grader_result_ids: [graderResultId],
        invalidity_reason: 'unscored_novel_strategy: outside the frozen accepted action set',
      },
      unscoredNovelStrategy: true,
    };
  }
  const allNoAction = submission.proposed_actions.every(a => a.operation === 'no_action');
  return {
    dimension: {
      applicable: true,
      outcome: allNoAction ? 'pass' : 'fail',
      grader_result_ids: [graderResultId],
      invalidity_reason: allNoAction
        ? undefined
        : 'proposed a mutating action in a read-only scenario',
    },
    unscoredNovelStrategy: false,
  };
}
