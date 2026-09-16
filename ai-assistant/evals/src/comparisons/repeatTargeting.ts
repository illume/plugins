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

export interface FiniteRosterRepeatDesign {
  population: 'fixed_public_roster';
  target_basis: 'fixed_budget_not_power';
  rounds: 10;
  weighting: 'equal_lineages_equal_cases_within_lineage';
  sampling_unit: 'full_roster_round';
  sampling_assumption: 'independent_rounds_fixed_configuration';
  interval_method: 'hoeffding_bonferroni';
  familywise_alpha: 0.05;
  contrasts: 2;
  case_selection: 'all_non_repair_roster_cases';
  execution_order: 'rotate_system_order_by_round_and_case';
  missing_pairs: 'inconclusive_no_replacement';
  exploratory_reuse: false;
  early_stopping: false;
  stratum_inference: 'descriptive_only';
}

export const FINITE_ROSTER_REPEAT_DESIGN: Readonly<FiniteRosterRepeatDesign> = Object.freeze({
  population: 'fixed_public_roster',
  target_basis: 'fixed_budget_not_power',
  rounds: 10,
  weighting: 'equal_lineages_equal_cases_within_lineage',
  sampling_unit: 'full_roster_round',
  sampling_assumption: 'independent_rounds_fixed_configuration',
  interval_method: 'hoeffding_bonferroni',
  familywise_alpha: 0.05,
  contrasts: 2,
  case_selection: 'all_non_repair_roster_cases',
  execution_order: 'rotate_system_order_by_round_and_case',
  missing_pairs: 'inconclusive_no_replacement',
  exploratory_reuse: false,
  early_stopping: false,
  stratum_inference: 'descriptive_only',
});

export function finiteRosterBudget(caseCount: number) {
  if (!Number.isSafeInteger(caseCount) || caseCount < 1) throw new Error('Invalid roster size');
  const design = FINITE_ROSTER_REPEAT_DESIGN;
  return {
    rounds: design.rounds,
    invocations_per_system: caseCount * design.rounds,
    cli_invocations: caseCount * design.rounds * 3,
    matched_pairs_per_contrast: caseCount * design.rounds,
    simultaneous_confidence_level: 1 - design.familywise_alpha,
    worst_case_half_width: Math.sqrt(
      (2 * Math.log((2 * design.contrasts) / design.familywise_alpha)) / design.rounds
    ),
    precision_guaranteed_at_practical_margin: false,
  };
}

export interface FiniteRosterRound {
  round: number;
  pairs: ExploratoryAttempt[];
}

export function analyzeFiniteRosterContrast(input: {
  roster: Array<{ scenario_id: string; lineage_id: string; behavioral_stratum: BehavioralStratum }>;
  rounds: FiniteRosterRound[];
  system: 'holmesgpt' | 'kubectl-ai';
  practicalMargin: number;
  roundAssumptionsVerified: boolean;
}) {
  if (!(input.practicalMargin > 0 && input.practicalMargin < 1))
    throw new Error('Invalid practical margin');
  const budget = finiteRosterBudget(input.roster.length);
  const byScenario = new Map(input.roster.map(entry => [entry.scenario_id, entry]));
  if (
    byScenario.size !== input.roster.length ||
    input.roster.some(
      entry =>
        !entry.scenario_id || !entry.lineage_id || entry.behavioral_stratum === 'approved_repair'
    )
  ) {
    throw new Error('Invalid or duplicate diagnosis roster identity');
  }
  const lineageSizes = new Map<string, number>();
  for (const entry of input.roster)
    lineageSizes.set(entry.lineage_id, (lineageSizes.get(entry.lineage_id) ?? 0) + 1);
  const seenRounds = new Set<number>();
  const seenTrials = new Set<string>();
  const pairs = input.rounds.flatMap(round => round.pairs);
  assertValidExploratoryAttempts(pairs);
  let completeRounds = 0;
  const roundDifferences: number[] = [];
  for (const round of input.rounds) {
    if (
      !Number.isSafeInteger(round.round) ||
      round.round < 1 ||
      round.round > budget.rounds ||
      seenRounds.has(round.round)
    ) {
      throw new Error('Duplicate or out-of-budget round');
    }
    seenRounds.add(round.round);
    const seenCases = new Set<string>();
    let difference = 0;
    let valid = true;
    for (const pair of round.pairs) {
      const entry = byScenario.get(pair.scenario_id);
      if (
        !entry ||
        seenCases.has(pair.scenario_id) ||
        pair.system !== input.system ||
        entry.lineage_id !== pair.lineage_id ||
        entry.behavioral_stratum !== pair.behavioral_stratum
      ) {
        throw new Error('Pair does not match the frozen roster or comparator');
      }
      seenCases.add(pair.scenario_id);
      for (const trial of [pair.baseline_trial_id, pair.candidate_trial_id]) {
        if (seenTrials.has(trial)) throw new Error('A trial was reused across matched pairs');
        seenTrials.add(trial);
      }
      if (pair.pair_eligibility !== 'valid') valid = false;
      difference +=
        (Number(pair.baseline_outcome === 'pass') - Number(pair.candidate_outcome === 'pass')) /
        (lineageSizes.size * lineageSizes.get(entry.lineage_id)!);
    }
    if (valid && seenCases.size === byScenario.size) {
      completeRounds++;
      roundDifferences.push(difference);
    }
  }
  const complete = completeRounds === budget.rounds && input.roundAssumptionsVerified;
  const estimate = complete
    ? roundDifferences.reduce((total, value) => total + value, 0) / budget.rounds
    : null;
  const lower = estimate === null ? -1 : Math.max(-1, estimate - budget.worst_case_half_width);
  const upper = estimate === null ? 1 : Math.min(1, estimate + budget.worst_case_half_width);
  const decision = !complete
    ? 'inconclusive'
    : lower > input.practicalMargin
    ? 'ahead'
    : upper < -input.practicalMargin
    ? 'behind'
    : lower >= -input.practicalMargin && upper <= input.practicalMargin
    ? 'within_margin'
    : 'inconclusive';
  return {
    system: input.system,
    method: FINITE_ROSTER_REPEAT_DESIGN.interval_method,
    sampling_unit: FINITE_ROSTER_REPEAT_DESIGN.sampling_unit,
    assigned_rounds: budget.rounds,
    complete_rounds: completeRounds,
    complete,
    estimate,
    lower,
    upper,
    decision,
    interval_available: complete,
    blocker: complete
      ? null
      : 'All ten complete valid rounds and verified sampling assumptions are required; no replacement or early decision.',
  };
}

export function analyzeFiniteRosterComparison(input: {
  roster: Parameters<typeof analyzeFiniteRosterContrast>[0]['roster'];
  rounds: Record<'holmesgpt' | 'kubectl-ai', FiniteRosterRound[]>;
  practicalMargin: number;
  roundAssumptionsVerified: boolean;
  safetyPassed: boolean;
}) {
  const holmes = analyzeFiniteRosterContrast({
    ...input,
    rounds: input.rounds.holmesgpt,
    system: 'holmesgpt',
  });
  const kubectl = analyzeFiniteRosterContrast({
    ...input,
    rounds: input.rounds['kubectl-ai'],
    system: 'kubectl-ai',
  });
  const baselines = new Map(
    input.rounds.holmesgpt.flatMap(round =>
      round.pairs.map(
        pair => [`${round.round}\0${pair.scenario_id}`, pair.baseline_trial_id] as const
      )
    )
  );
  for (const round of input.rounds['kubectl-ai']) {
    for (const pair of round.pairs) {
      const baseline = baselines.get(`${round.round}\0${pair.scenario_id}`);
      if (baseline !== undefined && baseline !== pair.baseline_trial_id) {
        throw new Error('Contrasts must use the same Headlamp trial for each round and case');
      }
    }
  }
  const holmesClaim = input.safetyPassed && holmes.decision === 'ahead';
  return {
    contrasts: { holmesgpt: holmes, 'kubectl-ai': kubectl },
    superiority_claims: {
      holmesgpt: holmesClaim,
      'kubectl-ai': holmesClaim && kubectl.decision === 'ahead',
    },
    sequence: ['headlamp_cli_vs_holmesgpt', 'headlamp_cli_vs_kubectl-ai'],
    safety_veto: !input.safetyPassed,
  };
}

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
  lineage_mean_success_difference: number | null;
  lineage_standard_error: number | null;
  method: 'equal_lineage_descriptive';
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
  const trialPairs = new Set<string>();
  for (const attempt of attempts) {
    if (pairIds.has(attempt.attempt_pair_id)) {
      throw new Error(`duplicate exploratory attempt pair: ${attempt.attempt_pair_id}`);
    }
    pairIds.add(attempt.attempt_pair_id);
    if (!attempt.baseline_trial_id || !attempt.candidate_trial_id) {
      throw new Error(`${attempt.attempt_pair_id}: matched trial identities are required`);
    }
    if (attempt.baseline_trial_id === attempt.candidate_trial_id) {
      throw new Error(`${attempt.attempt_pair_id}: cannot compare a trial with itself`);
    }
    const trialPair = `${attempt.system}\0${attempt.baseline_trial_id}\0${attempt.candidate_trial_id}`;
    if (trialPairs.has(trialPair)) throw new Error('duplicate matched trial pair');
    trialPairs.add(trialPair);
    const dependence = `${attempt.lineage_id}\0${attempt.behavioral_stratum}`;
    const previous = scenarioDependence.get(attempt.scenario_id);
    if (previous !== undefined && previous !== dependence) {
      throw new Error(`${attempt.scenario_id}: lineage or behavioral stratum changed across pairs`);
    }
    scenarioDependence.set(attempt.scenario_id, dependence);
  }
}

/**
 * Describes success differences by lineage without treating repeated calls as
 * independent incidents. A separate clustered power design must set targets.
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
  if (new Set(attempts.map(attempt => attempt.system)).size > 1) {
    throw new Error('derive repeat targets separately for each comparator');
  }
  if (
    !Number.isSafeInteger(minimumPairs) ||
    minimumPairs < 1 ||
    !Number.isSafeInteger(minimumLineages) ||
    minimumLineages < 2
  ) {
    throw new Error('invalid minimum pair or lineage threshold');
  }

  return Object.fromEntries(
    strata.map(stratum => {
      const valid = attempts.filter(
        attempt => attempt.behavioral_stratum === stratum && attempt.pair_eligibility === 'valid'
      );
      const lineageCount = new Set(valid.map(attempt => attempt.lineage_id)).size;
      const discordant = valid.filter(
        attempt => (attempt.baseline_outcome === 'pass') !== (attempt.candidate_outcome === 'pass')
      ).length;
      const byLineage = new Map<string, number[]>();
      for (const attempt of valid) {
        const differences = byLineage.get(attempt.lineage_id) ?? [];
        differences.push(
          Number(attempt.baseline_outcome === 'pass') - Number(attempt.candidate_outcome === 'pass')
        );
        byLineage.set(attempt.lineage_id, differences);
      }
      const lineageMeans = [...byLineage.values()].map(
        values => values.reduce((sum, value) => sum + value, 0) / values.length
      );
      const mean = lineageMeans.length
        ? lineageMeans.reduce((sum, value) => sum + value, 0) / lineageMeans.length
        : null;
      const standardError =
        mean !== null && lineageMeans.length >= minimumLineages
          ? Math.sqrt(
              lineageMeans.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
                (lineageMeans.length * (lineageMeans.length - 1))
            )
          : null;
      let blocker: string | null = null;
      if (valid.length < minimumPairs) blocker = `requires at least ${minimumPairs} valid pairs`;
      else if (lineageCount < minimumLineages) {
        blocker = `requires at least ${minimumLineages} independent lineages`;
      } else
        blocker =
          'requires a prespecified lineage-aware power design; repeated trials are not independent incidents';
      const estimate = valid.length === 0 ? null : discordant / valid.length;
      return [
        stratum,
        {
          stratum,
          valid_matched_pairs: valid.length,
          independent_lineages: lineageCount,
          discordant_pairs: discordant,
          discordance_estimate: estimate,
          lineage_mean_success_difference: mean,
          lineage_standard_error: standardError,
          method: 'equal_lineage_descriptive',
          practical_margin: practicalMargin,
          recommended_repeat_target: null,
          blocker,
        } satisfies RepeatTargetDerivation,
      ];
    })
  ) as Record<BehavioralStratum, RepeatTargetDerivation>;
}
