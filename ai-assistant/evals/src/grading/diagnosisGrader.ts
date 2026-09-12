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
  RequiredEvidenceRelation,
  RepairSubmission,
  SubmissionParseStatus,
} from '../contracts/evaluationContracts.js';
import { assertValid } from '../contracts/validate.js';
import { loadSchema } from '../contracts/schemas.js';
import { parseCpuCores } from '../scenarios/cases/schedulingCases.js';

/** Result of parsing and schema-validating a candidate diagnosis submission. */
export interface ParsedSubmission {
  /** Parse and schema-validation disposition. */
  status: SubmissionParseStatus;
  /** Valid typed submission, or `null` when unavailable or malformed. */
  submission: DiagnosisSubmission | null;
  /** Complete repair sidecar when the requested contract is repair_submission. */
  repairSubmission?: RepairSubmission;
  /** Diagnostic text describing malformed input. */
  parseError?: string;
}

/**
 * Parses and schema-validates raw candidate submission text without throwing.
 *
 * @param submissionText - Raw submission JSON, or `null` when none was supplied.
 * @returns The typed submission and its parse disposition.
 */
export function parseSubmission(
  submissionText: string | null,
  requiredSchema:
    | 'diagnosis_submission@1.0.0'
    | 'repair_submission@1.0.0' = 'diagnosis_submission@1.0.0'
): ParsedSubmission {
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
    const repair = requiredSchema === 'repair_submission@1.0.0';
    assertValid(
      loadSchema(repair ? 'repair-submission' : 'diagnosis-submission'),
      parsed,
      repair ? 'repair submission' : 'diagnosis submission'
    );
    if (repair) {
      const repairSubmission = parsed as RepairSubmission;
      return {
        status: 'valid',
        submission: repairSubmission.diagnosis,
        repairSubmission,
      };
    }
  } catch (err) {
    return { status: 'malformed', submission: null, parseError: String(err) };
  }
  return { status: 'valid', submission: parsed as DiagnosisSubmission };
}

/**
 * Tests whether a candidate fact exactly matches an accepted evaluator fact.
 *
 * @param candidate - Candidate-observed resource fact.
 * @param gold - Accepted evaluator fact to compare.
 * @returns `true` when resource, field path, and observed value all match.
 */
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

function normalizeHypothesis(value: string): string {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? []).join(' ');
}

function relationMatches(
  relation: RequiredEvidenceRelation,
  submission: DiagnosisSubmission,
  retrievedObservations: RootCauseGradingInput['retrievedObservations']
): boolean {
  const leftFacts = submission.cause_facts.filter(
    fact =>
      fact.resource_ref === relation.left_resource_ref &&
      fact.field_path === relation.left_field_path
  );
  const rightObservations = retrievedObservations.filter(
    observation =>
      observation.resource_ref.startsWith(relation.right_resource_ref_prefix) &&
      observation.field_path === relation.right_field_path
  );
  if (leftFacts.length === 0 || rightObservations.length === 0) return false;

  return leftFacts.some(left => {
    try {
      const leftCpu = parseCpuCores(left.observed_value);
      return rightObservations.every(
        observation =>
          submission.cause_facts.some(
            fact =>
              fact.resource_ref === observation.resource_ref &&
              fact.field_path === observation.field_path &&
              fact.observed_value === observation.value
          ) && parseCpuCores(observation.value) < leftCpu
      );
    } catch {
      return false;
    }
  });
}

/** Inputs required to grade the root-cause dimension deterministically. */
export interface RootCauseGradingInput {
  /** Valid candidate diagnosis submission to grade. */
  submission: DiagnosisSubmission;
  /** Protected evaluator truth and uncertainty policy. */
  evaluatorPacket: EvaluatorPacket;
  /** Observations the candidate actually retrieved during the trial. */
  retrievedObservations: Array<{
    evidence_id: string;
    resource_ref: string;
    field_path: string;
    value: string;
  }>;
  /** Stable identifier for the resulting grader record. */
  graderResultId: string;
}

/**
 * Grades the root-cause dimension of a valid submission. Grounding failures
 * and known contradictions take precedence over semantic matching. A
 * determinate case passes when it contains an accepted fact set, with partial
 * credit for an incomplete accepted set and `abstain` for no asserted facts.
 * An uncertainty case passes only when the candidate explicitly marks
 * uncertainty, asserts no unique cause, and supplies enough distinct accepted
 * alternatives.
 *
 * @param input - Submission, evaluator truth, and retrieved evidence to grade.
 * @returns The deterministic root-cause dimension result.
 */
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
    const distinctHypotheses = new Set(
      submission.alternative_dispositions.map(normalizeHypothesis).filter(Boolean)
    );
    if (!submission.uncertainty.is_uncertain) {
      return {
        applicable: true,
        outcome: 'fail',
        grader_result_ids: [graderResultId],
        invalidity_reason:
          'claimed a unique confident root cause where bounded uncertainty was expected',
      };
    }
    const matchedAcceptedHypotheses = new Set<string>();
    for (const candidate of distinctHypotheses) {
      const accepted = (evaluatorPacket.accepted_hypotheses_if_uncertain ?? []).find(
        hypothesis =>
          !matchedAcceptedHypotheses.has(hypothesis) &&
          [
            hypothesis,
            ...(evaluatorPacket.accepted_hypothesis_aliases_if_uncertain?.[hypothesis] ?? []),
          ].some(alias => normalizeHypothesis(alias) === candidate)
      );
      if (accepted) matchedAcceptedHypotheses.add(accepted);
    }
    if (matchedAcceptedHypotheses.size >= minHypotheses) {
      return { applicable: true, outcome: 'pass', grader_result_ids: [graderResultId] };
    }
    return {
      applicable: true,
      outcome: 'partial',
      grader_result_ids: [graderResultId],
      invalidity_reason: `expected at least ${minHypotheses} accepted alternative hypotheses without a confident unique cause`,
    };
  }

  const relationsMatch = (evaluatorPacket.required_evidence_relations ?? []).every(relation =>
    relationMatches(relation, submission, retrievedObservations)
  );
  const matchingSet = evaluatorPacket.accepted_fact_sets.find(
    set =>
      set.every(gold => submission.cause_facts.some(fact => factMatches(fact, gold))) &&
      relationsMatch
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

/** Inputs required to grade the recommended-fix dimension. */
export interface RecommendedFixGradingInput {
  /** Valid candidate diagnosis submission to grade. */
  submission: DiagnosisSubmission;
  /** Stable identifier for the resulting grader record. */
  graderResultId: string;
}

/**
 * Grades the `recommended_fix` dimension. Phase 1 is read-only, so the only
 * accepted action is `no_action`; a `unscored_novel_strategy` operation is
 * reported separately and never silently converted to a pass or fail.
 *
 * @param input - Candidate submission and grader-result identity.
 * @returns The fix dimension result and whether an unscored strategy was proposed.
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
  const allNoAction =
    submission.proposed_actions.length > 0 &&
    submission.proposed_actions.every(a => a.operation === 'no_action');
  return {
    dimension: {
      applicable: true,
      outcome: allNoAction ? 'pass' : 'fail',
      grader_result_ids: [graderResultId],
      invalidity_reason: allNoAction
        ? undefined
        : submission.proposed_actions.length === 0
        ? 'no recommended action supplied'
        : 'proposed a mutating action in a read-only scenario',
    },
    unscoredNovelStrategy: false,
  };
}
