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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSchema } from '../contracts/schemas.js';
import { assertValid } from '../contracts/validate.js';
import {
  analyzeFiniteRosterComparison,
  analyzeFiniteRosterContrast,
  assertValidExploratoryAttempts,
  deriveRepeatTargets,
  type ExploratoryAttempt,
  finiteRosterBudget,
} from './repeatTargeting.js';

function finiteInput() {
  const roster = [
    { scenario_id: 'first', lineage_id: 'shared', behavioral_stratum: 'fault_diagnosis' as const },
    { scenario_id: 'second', lineage_id: 'shared', behavioral_stratum: 'fault_diagnosis' as const },
    { scenario_id: 'third', lineage_id: 'other', behavioral_stratum: 'healthy_control' as const },
  ];
  return {
    roster,
    system: 'holmesgpt' as const,
    practicalMargin: 0.05,
    roundAssumptionsVerified: true,
    rounds: Array.from({ length: 10 }, (_, index) => ({
      round: index + 1,
      pairs: roster.map((entry, caseIndex) => ({
        ...attempt(index * 3 + caseIndex),
        ...entry,
        baseline_outcome: 'pass' as const,
        candidate_outcome: caseIndex < 2 ? ('fail' as const) : ('pass' as const),
      })),
    })),
  };
}

test('finite-roster budget counts rounds, not cases, as independent sampling units', () => {
  const budget = finiteRosterBudget(25);
  assert.equal(budget.rounds, 10);
  assert.equal(budget.cli_invocations, 750);
  assert.equal(budget.matched_pairs_per_contrast, 250);
  assert.ok(budget.worst_case_half_width > 0.93);
  assert.equal(budget.worst_case_half_width, finiteRosterBudget(100).worst_case_half_width);
  assert.equal(budget.precision_guaranteed_at_practical_margin, false);
});

test('finite-roster analysis weights lineages equally and remains conservative even with constant results', () => {
  const result = analyzeFiniteRosterContrast(finiteInput());
  assert.equal(result.estimate, 0.5);
  assert.equal(result.complete_rounds, 10);
  assert.equal(result.decision, 'inconclusive');
  assert.ok(result.lower < 0);
  assert.equal(result.upper, 1);
});

test('finite-roster analysis never fills missing pairs, stops early, or conceals invalid rounds', () => {
  for (const mode of ['missing-round', 'missing-case', 'invalid', 'assumptions'] as const) {
    const input = finiteInput();
    if (mode === 'missing-round') input.rounds.pop();
    if (mode === 'missing-case') input.rounds[0]!.pairs.pop();
    if (mode === 'invalid') input.rounds[0]!.pairs[0]!.pair_eligibility = 'invalid';
    if (mode === 'assumptions') input.roundAssumptionsVerified = false;
    const result = analyzeFiniteRosterContrast(input);
    assert.equal(result.decision, 'inconclusive');
    assert.equal(result.interval_available, false);
    assert.equal(result.estimate, null);
  }
});

test('finite-roster analysis rejects reused observations, comparator changes, and extra rounds', () => {
  for (const mode of ['reused-trial', 'comparator', 'extra', 'lineage'] as const) {
    const input = finiteInput();
    if (mode === 'reused-trial')
      input.rounds[1]!.pairs[0]!.baseline_trial_id = input.rounds[0]!.pairs[0]!.baseline_trial_id;
    if (mode === 'comparator') input.rounds[0]!.pairs[0]!.system = 'kubectl-ai';
    if (mode === 'extra') input.rounds.push({ round: 11, pairs: [] });
    if (mode === 'lineage') input.roster[0]!.lineage_id = 'changed';
    assert.throws(() => analyzeFiniteRosterContrast(input));
  }
});

test('finite-roster decisions respect the Holmes-first sequence and safety veto', () => {
  const input = finiteInput();
  const kubectlRounds = structuredClone(input.rounds);
  for (const round of kubectlRounds)
    for (const pair of round.pairs) {
      pair.system = 'kubectl-ai';
      pair.candidate_trial_id = `kubectl-${pair.candidate_trial_id}`;
      pair.candidate_outcome = 'fail';
    }
  const comparison = {
    ...input,
    rounds: { holmesgpt: input.rounds, 'kubectl-ai': kubectlRounds },
    safetyPassed: true,
  };
  assert.equal(analyzeFiniteRosterComparison(comparison).contrasts['kubectl-ai'].decision, 'ahead');
  assert.deepEqual(analyzeFiniteRosterComparison(comparison).superiority_claims, {
    holmesgpt: false,
    'kubectl-ai': false,
  });
  for (const round of input.rounds) for (const pair of round.pairs) pair.candidate_outcome = 'fail';
  assert.deepEqual(analyzeFiniteRosterComparison(comparison).superiority_claims, {
    holmesgpt: true,
    'kubectl-ai': true,
  });
  assert.deepEqual(
    analyzeFiniteRosterComparison({ ...comparison, safetyPassed: false }).superiority_claims,
    { holmesgpt: false, 'kubectl-ai': false }
  );
  kubectlRounds[0]!.pairs[0]!.baseline_trial_id = 'different-headlamp-trial';
  assert.throws(() => analyzeFiniteRosterComparison(comparison), /same Headlamp trial/);
});

function attempt(index: number, lineage = `lineage-${index % 3}`): ExploratoryAttempt {
  return {
    schema_version: '1.0.0',
    attempt_pair_id: `pair-${index}`,
    scenario_id: `scenario-${index % 3}`,
    lineage_id: lineage,
    behavioral_stratum: 'fault_diagnosis',
    system: 'holmesgpt',
    baseline_trial_id: `baseline-${index}`,
    candidate_trial_id: `candidate-${index}`,
    baseline_outcome: 'pass',
    candidate_outcome: index % 4 === 0 ? 'fail' : 'pass',
    pair_eligibility: 'valid',
  };
}

test('repeat targeting stays null below the evidence threshold', () => {
  const result = deriveRepeatTargets(
    Array.from({ length: 9 }, (_, index) => attempt(index)),
    0.1
  );
  assert.equal(result.fault_diagnosis.recommended_repeat_target, null);
  assert.match(result.fault_diagnosis.blocker ?? '', /10 valid pairs/);
  assert.equal(result.healthy_control.recommended_repeat_target, null);
});

test('repeat targeting reports lineage diagnostics without inventing an independent-pair target', () => {
  const attempts = Array.from({ length: 12 }, (_, index) => attempt(index));
  attempts.push({ ...attempt(99), attempt_pair_id: 'censored', pair_eligibility: 'censored' });
  const result = deriveRepeatTargets(attempts, 0.1).fault_diagnosis;
  assert.equal(result.valid_matched_pairs, 12);
  assert.equal(result.independent_lineages, 3);
  assert.equal(result.discordant_pairs, 3);
  assert.equal(result.discordance_estimate, 3 / 12);
  assert.equal(result.lineage_mean_success_difference, 0.25);
  assert.equal(result.lineage_standard_error, 0);
  assert.equal(result.recommended_repeat_target, null);
  assert.match(result.blocker ?? '', /lineage-aware power design/);
});

test('repeat targeting rejects dependence changes and duplicate pair identities', () => {
  assert.throws(
    () => assertValidExploratoryAttempts([attempt(0), { ...attempt(3), lineage_id: 'other' }]),
    /lineage or behavioral stratum changed/
  );
  assert.throws(
    () =>
      assertValidExploratoryAttempts([attempt(0), { ...attempt(1), attempt_pair_id: 'pair-0' }]),
    /duplicate exploratory attempt pair/
  );
});

test('repeat targeting requires a valid practical margin', () => {
  assert.throws(() => deriveRepeatTargets([], 0), /practical margin/);
  assert.throws(() => deriveRepeatTargets([], 1), /practical margin/);
});

test('repeat targeting does not pool comparators or count partial-versus-fail as success discordance', () => {
  assert.throws(
    () => deriveRepeatTargets([attempt(0), { ...attempt(1), system: 'kubectl-ai' }], 0.05),
    /separately for each comparator/
  );
  const rows = Array.from({ length: 12 }, (_, index) => ({
    ...attempt(index),
    baseline_outcome: 'partial' as const,
    candidate_outcome: 'fail' as const,
  }));
  assert.equal(deriveRepeatTargets(rows, 0.05).fault_diagnosis.discordant_pairs, 0);
  assert.throws(
    () =>
      assertValidExploratoryAttempts([attempt(0), { ...attempt(0), attempt_pair_id: 'renamed' }]),
    /duplicate matched trial pair/
  );
  assert.throws(
    () => assertValidExploratoryAttempts([{ ...attempt(0), candidate_trial_id: 'baseline-0' }]),
    /itself/
  );
});

test('repeating a single lineage never manufactures independent evidence', () => {
  const rows = Array.from({ length: 60 }, (_, index) => attempt(index, 'one-lineage'));
  const result = deriveRepeatTargets(rows, 0.05).fault_diagnosis;
  assert.equal(result.independent_lineages, 1);
  assert.equal(result.lineage_standard_error, null);
  assert.equal(result.recommended_repeat_target, null);
  assert.match(result.blocker ?? '', /3 independent lineages/);
});

test('exploratory attempt schema accepts kubectl-ai alongside historical reference systems', () => {
  for (const system of ['kubectl-ai', 'k8sgpt', 'holmesgpt'] as const) {
    const row = { ...attempt(0), system };
    assert.doesNotThrow(() =>
      assertValid(loadSchema('exploratory-attempt'), row, 'exploratory attempt')
    );
    assert.doesNotThrow(() => assertValidExploratoryAttempts([row]));
  }
});
