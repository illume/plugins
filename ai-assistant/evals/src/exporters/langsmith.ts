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
 * Offline golden projection for LangSmith's native run/feedback shape (see
 * "Canonical task metrics and exporter compatibility"). This never contacts
 * a hosted LangSmith account; it only proves that canonical IDs, hierarchy,
 * outcomes, and durations survive a lossy destination mapping, with declared
 * losses recorded rather than silently dropped.
 *
 * This exists to test portability of the canonical contract, not to make
 * LangSmith another source of truth. A maintainer can inspect the generated
 * shape and mapping losses before any future network exporter is enabled;
 * destination availability can never affect an evaluation outcome.
 */

import type { TrialResult } from '../contracts/evaluationContracts.js';

/** Version of the canonical-to-LangSmith field mapping. */
export const LANGSMITH_MAPPING_VERSION = '2.0.0';

function scoreOutcome(outcome: TrialResult['dimensions']['root_cause']['outcome']): number | null {
  if (outcome === 'pass') return 1;
  if (outcome === 'fail') return 0;
  return null;
}

/** A canonical trial projected into LangSmith's run shape. */
export interface LangSmithRun {
  /** Canonical trial identifier used as the LangSmith run identifier. */
  id: string;
  /** Scenario identifier shown as the run name. */
  name: string;
  /** LangSmith run category used for complete evaluation trials. */
  run_type: 'chain';
  /** ISO timestamp when diagnosis started. */
  start_time: string;
  /** ISO timestamp when diagnosis ended. */
  end_time: string;
  /** Run status derived from canonical eligibility. */
  status: 'success' | 'error';
  /** Candidate outcomes retained by the projection. */
  outputs: Record<string, boolean | string | null>;
  /** Canonical identity and environment metadata retained by the projection. */
  extra: { metadata: Record<string, string> };
}

/** A canonical grading dimension projected into LangSmith feedback. */
export interface LangSmithFeedback {
  /** Identifier of the projected run receiving feedback. */
  run_id: string;
  /** Canonical grading dimension represented by the feedback. */
  key: string;
  /** Numeric score, or `null` when the dimension is not applicable. */
  score: number | null;
  /** Invalidity reason or safety detail associated with the score. */
  comment: string;
}

/** Complete offline LangSmith projection with explicit mapping losses. */
export interface LangSmithProjection {
  /** Version of the canonical-to-LangSmith mapping. */
  mapping_version: string;
  /** Trial records represented as LangSmith runs. */
  runs: LangSmithRun[];
  /** Dimension outcomes represented as LangSmith feedback. */
  feedback: LangSmithFeedback[];
  /** Canonical data unsupported by the destination schema. */
  unsupported_fields: string[];
  /** Canonical data intentionally omitted from this projection. */
  dropped_fields: string[];
}

/**
 * Deterministically maps trial results to LangSmith's native run and feedback shape.
 *
 * @param trials - Canonical trial results to project.
 * @returns An offline LangSmith projection with declared field losses.
 */
export function projectToLangSmith(trials: TrialResult[]): LangSmithProjection {
  const runs: LangSmithRun[] = trials.map(t => ({
    id: t.trial_id,
    name: t.scenario_id,
    run_type: 'chain',
    start_time: t.timing.diagnosis_started_at ?? t.recorded_at,
    end_time: new Date(
      Date.parse(t.timing.diagnosis_started_at ?? t.recorded_at) +
        Number(BigInt(t.timing.time_to_diagnosis_ns ?? '0') / 1_000_000n)
    ).toISOString(),
    status: t.run_eligibility === 'valid' ? 'success' : 'error',
    outputs: {
      root_cause_outcome: t.dimensions.root_cause.outcome,
      recommended_fix_outcome: t.dimensions.recommended_fix.outcome,
      safety_outcome: t.safety_outcome,
    },
    extra: {
      metadata: {
        run_id: t.run_id,
        scenario_id: t.scenario_id,
        scenario_version: t.scenario_version,
        candidate_id: t.candidate_id,
        cluster_profile: t.cluster_profile,
      },
    },
  }));

  const feedback: LangSmithFeedback[] = trials.flatMap(t => [
    {
      run_id: t.trial_id,
      key: 'root_cause',
      score: scoreOutcome(t.dimensions.root_cause.outcome),
      comment: t.dimensions.root_cause.invalidity_reason ?? '',
    },
    {
      run_id: t.trial_id,
      key: 'recommended_fix',
      score: scoreOutcome(t.dimensions.recommended_fix.outcome),
      comment: t.dimensions.recommended_fix.invalidity_reason ?? '',
    },
    {
      run_id: t.trial_id,
      key: 'safety',
      score: t.safety_outcome === 'pass' ? 1 : t.safety_outcome === 'fail' ? 0 : null,
      comment: t.safety_events.join(', '),
    },
  ]);

  return {
    mapping_version: LANGSMITH_MAPPING_VERSION,
    runs,
    feedback,
    // LangSmith feedback keys carry a single score; Headlamp's multi-axis
    // eligibility/lifecycle/safety fields do not have a native slot.
    unsupported_fields: ['provider-reported billing cost (not exposed by Phase 1 providers)'],
    dropped_fields: [
      'configured usage estimate and accounting unit (canonical bundle remains authoritative)',
      'model token usage (canonical bundle remains authoritative)',
      'individual tool events (canonical bundle remains authoritative)',
    ],
  };
}
