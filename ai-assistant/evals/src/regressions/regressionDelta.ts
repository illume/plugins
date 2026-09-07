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
 * Phase 1 Headlamp baseline-versus-candidate regression deltas. This is
 * internal-only (`internal_regression` in the Phase 2 comparison-class
 * table): it answers only "did this Headlamp change improve or regress?",
 * never a cross-system claim.
 */

import { recordId } from '../ids.js';
import { SCHEMA_VERSION } from '../contracts/types.js';
import type { RegressionDelta, TrialResult } from '../contracts/types.js';

function directionFor(
  baseline: boolean | null,
  candidate: boolean | null
): RegressionDelta['direction'] {
  if (baseline === null || candidate === null) return 'undefined';
  if (baseline === candidate) return 'unchanged';
  return candidate ? 'improved' : 'regressed';
}

/**
 * Computes per-scenario regression deltas between a baseline and candidate
 * trial covering the same scenario. Trials are matched by `scenario_id`;
 * callers are responsible for supplying exactly one baseline and one
 * candidate trial per scenario (Phase 1 has no repeated-pair statistics —
 * that begins in Phase 2).
 */
export function computeRegressionDeltas(
  baseline: TrialResult[],
  candidate: TrialResult[]
): RegressionDelta[] {
  const deltas: RegressionDelta[] = [];
  const candidateByScenario = new Map(candidate.map(t => [t.scenario_id, t]));

  for (const base of baseline) {
    const cand = candidateByScenario.get(base.scenario_id);
    if (!cand) continue;

    deltas.push({
      schema_version: SCHEMA_VERSION,
      record_id: recordId(),
      scenario_id: base.scenario_id,
      dimension: 'root_cause',
      baseline_trial_id: base.trial_id,
      candidate_trial_id: cand.trial_id,
      baseline_value: base.root_cause_found,
      candidate_value: cand.root_cause_found,
      direction: directionFor(base.root_cause_found, cand.root_cause_found),
    });

    deltas.push({
      schema_version: SCHEMA_VERSION,
      record_id: recordId(),
      scenario_id: base.scenario_id,
      dimension: 'safety',
      baseline_trial_id: base.trial_id,
      candidate_trial_id: cand.trial_id,
      baseline_value: base.safety_outcome,
      candidate_value: cand.safety_outcome,
      direction:
        base.safety_outcome === cand.safety_outcome
          ? 'unchanged'
          : cand.safety_outcome === 'fail'
          ? 'regressed'
          : base.safety_outcome === 'fail'
          ? 'improved'
          : 'undefined',
    });
  }

  return deltas;
}
