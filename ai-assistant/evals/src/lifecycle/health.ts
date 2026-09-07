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
 * Aggregates eval-system health separately from candidate quality (see
 * "Eval-system health and failure ownership" in the best-practice coverage
 * contract). These are Phase 1 descriptive baselines, never invented SLO
 * gates — Phase 2 is where they become observed SLOs with alerting.
 */

import type { TrialResult } from '../contracts/types.js';

export interface HealthSummary {
  total_trials: number;
  setup_ok: number;
  setup_failed: number;
  cleanup_ok: number;
  cleanup_failed: number;
  invalid_grader_count: number;
  excluded_count: number;
  by_first_failure_owner: Record<string, number>;
  observed_flake_rate: number | null;
}

/** Computes Phase 1 descriptive eval-system health from a set of trial results. */
export function computeHealthSummary(trials: TrialResult[]): HealthSummary {
  const byOwner: Record<string, number> = {};
  let setupOk = 0;
  let setupFailed = 0;
  let cleanupOk = 0;
  let cleanupFailed = 0;
  let invalidGrader = 0;
  let excluded = 0;

  for (const trial of trials) {
    if (trial.stage_status.setup === 'ok') setupOk += 1;
    else setupFailed += 1;
    if (trial.stage_status.cleanup === 'ok') cleanupOk += 1;
    else if (trial.stage_status.cleanup === 'error') cleanupFailed += 1;
    if (trial.submission_status !== 'valid' && trial.stage_status.grader === 'ok')
      invalidGrader += 1;
    if (trial.run_eligibility !== 'valid') excluded += 1;
    if (trial.first_failure_owner) {
      byOwner[trial.first_failure_owner] = (byOwner[trial.first_failure_owner] ?? 0) + 1;
    }
  }

  return {
    total_trials: trials.length,
    setup_ok: setupOk,
    setup_failed: setupFailed,
    cleanup_ok: cleanupOk,
    cleanup_failed: cleanupFailed,
    invalid_grader_count: invalidGrader,
    excluded_count: excluded,
    by_first_failure_owner: byOwner,
    // Phase 1 does not yet run repeated matched trials, so flake rate has no
    // valid denominator; Phase 2 populates this from registered repeats.
    observed_flake_rate: null,
  };
}
