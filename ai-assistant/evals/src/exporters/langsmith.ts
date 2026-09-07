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
 */

import type { TrialResult } from '../contracts/types.js';

export const LANGSMITH_MAPPING_VERSION = '1.0.0';

export interface LangSmithRun {
  id: string;
  name: string;
  run_type: 'chain';
  start_time: string;
  end_time: string;
  status: 'success' | 'error';
  outputs: Record<string, boolean | string | null>;
  extra: { metadata: Record<string, string> };
}

export interface LangSmithFeedback {
  run_id: string;
  key: string;
  score: number | null;
  comment: string;
}

export interface LangSmithProjection {
  mapping_version: string;
  runs: LangSmithRun[];
  feedback: LangSmithFeedback[];
  unsupported_fields: string[];
  dropped_fields: string[];
}

/** Deterministically maps trial results to LangSmith's native run/feedback shape. */
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
      root_cause_found: t.root_cause_found,
      recommended_fix_correct: t.recommended_fix_correct,
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
      key: 'root_cause_found',
      score: t.root_cause_found === null ? null : t.root_cause_found ? 1 : 0,
      comment: t.dimensions.root_cause.invalidity_reason ?? '',
    },
    {
      run_id: t.trial_id,
      key: 'recommended_fix_correct',
      score: t.recommended_fix_correct === null ? null : t.recommended_fix_correct ? 1 : 0,
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
    unsupported_fields: ['provider-native token usage and cost (not captured by Phase 1 adapters)'],
    dropped_fields: ['individual tool events (canonical bundle remains authoritative)'],
  };
}
