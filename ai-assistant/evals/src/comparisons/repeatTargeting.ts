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

import type { BehavioralStratum } from '../contracts/evaluationContracts.js';
import type { ComparisonSystem } from './registration.js';

export interface ExploratoryAttempt {
  schema_version: '1.0.0';
  attempt_pair_id: string;
  scenario_id: string;
  lineage_id: string;
  behavioral_stratum: BehavioralStratum;
  system: ComparisonSystem;
  baseline_trial_id: string;
  candidate_trial_id: string;
  baseline_outcome: 'pass' | 'partial' | 'fail' | 'no_result';
  candidate_outcome: 'pass' | 'partial' | 'fail' | 'no_result';
  pair_eligibility: 'valid' | 'invalid' | 'censored';
}

export interface RepeatTargetDerivation {
  stratum: BehavioralStratum;
  valid_matched_pairs: number;
  independent_lineages: number;
  discordant_pairs: number;
  discordance_estimate: number | null;
  practical_margin: number;
  recommended_repeat_target: number | null;
  blocker: string | null;
}

const strata: BehavioralStratum[] = [
  'fault_diagnosis',
  'healthy_control',
  'insufficient_evidence',
  'approved_repair',
  'security_prompt_injection',
  'multi_turn_tool_failure',
];

/** Rejects duplicate pair identities and dependence metadata that changes within a scenario. */
export function assertValidExploratoryAttempts(attempts: ExploratoryAttempt[]): void {
  const pairIds = new Set<string>();
  const scenarioDependence = new Map<string, string>();
  for (const attempt of attempts) {
    if (pairIds.has(attempt.attempt_pair_id)) {
      throw new Error(`duplicate exploratory attempt pair: ${attempt.attempt_pair_id}`);
    }
    pairIds.add(attempt.attempt_pair_id);
    if (!attempt.baseline_trial_id || !attempt.candidate_trial_id) {
      throw new Error(`${attempt.attempt_pair_id}: matched trial identities are required`);
    }
    const dependence = `${attempt.lineage_id}\0${attempt.behavioral_stratum}`;
    const previous = scenarioDependence.get(attempt.scenario_id);
    if (previous !== undefined && previous !== dependence) {
      throw new Error(`${attempt.scenario_id}: lineage or behavioral stratum changed across pairs`);
    }
    scenarioDependence.set(attempt.scenario_id, dependence);
  }
}

/**
 * Derives prespecified matched-pair targets from exploratory discordance.
 * Sparse strata remain unset rather than receiving a guessed target.
 */
export function deriveRepeatTargets(
  attempts: ExploratoryAttempt[],
  practicalMargin: number,
  minimumPairs = 10,
  minimumLineages = 3
): Record<BehavioralStratum, RepeatTargetDerivation> {
  if (!(practicalMargin > 0 && practicalMargin < 1)) {
    throw new Error('practical margin must be greater than zero and less than one');
  }
  assertValidExploratoryAttempts(attempts);

  return Object.fromEntries(
    strata.map(stratum => {
      const valid = attempts.filter(
        attempt => attempt.behavioral_stratum === stratum && attempt.pair_eligibility === 'valid'
      );
      const lineageCount = new Set(valid.map(attempt => attempt.lineage_id)).size;
      const discordant = valid.filter(
        attempt => attempt.baseline_outcome !== attempt.candidate_outcome
      ).length;
      let blocker: string | null = null;
      if (valid.length < minimumPairs) blocker = `requires at least ${minimumPairs} valid pairs`;
      else if (lineageCount < minimumLineages) {
        blocker = `requires at least ${minimumLineages} independent lineages`;
      }
      const estimate = valid.length === 0 ? null : (discordant + 2) / (valid.length + 4);
      const recommended =
        blocker || estimate === null
          ? null
          : Math.max(
              valid.length,
              Math.ceil((1.96 ** 2 * estimate * (1 - estimate)) / practicalMargin ** 2)
            );
      return [
        stratum,
        {
          stratum,
          valid_matched_pairs: valid.length,
          independent_lineages: lineageCount,
          discordant_pairs: discordant,
          discordance_estimate: estimate,
          practical_margin: practicalMargin,
          recommended_repeat_target: recommended,
          blocker,
        } satisfies RepeatTargetDerivation,
      ];
    })
  ) as Record<BehavioralStratum, RepeatTargetDerivation>;
}
