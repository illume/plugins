import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadComparisonRegistration } from './registration.js';
import { applyComparisonPairRule, type ComparisonPairInput } from './trialExclusionLogic.js';

const policy = loadComparisonRegistration().registration.missing_pair_rule;

function pair(overrides: Partial<ComparisonPairInput> = {}): ComparisonPairInput {
  return {
    pair_id: 'pair-1',
    baseline_assignment: 'eligible',
    candidate_assignment: 'eligible',
    baseline_state: 'valid',
    candidate_state: 'valid',
    ...overrides,
  };
}

test('valid matched pairs contribute to task quality and reliability', () => {
  assert.deepEqual(applyComparisonPairRule(pair(), policy), {
    pair_id: 'pair-1',
    reason: 'valid_pair',
    task_quality_included: true,
    reliability_included: true,
    execution_blocked: false,
    terminal_exclusion: false,
  });
});

test('invalid, censored, and missing pairs retain reliability evidence only', () => {
  for (const [input, reason] of [
    [{ candidate_state: 'invalid' }, 'invalid_pair'],
    [{ candidate_state: 'censored' }, 'censored_pair'],
    [{ candidate_state: undefined }, 'missing_pair'],
  ] as const) {
    const result = applyComparisonPairRule(pair(input), policy);
    assert.equal(result.reason, reason);
    assert.equal(result.task_quality_included, false);
    assert.equal(result.reliability_included, true);
    assert.equal(result.execution_blocked, false);
    assert.equal(result.terminal_exclusion, false);
  }
});

test('unsupported and ineligible assignments become visible terminal exclusions', () => {
  for (const [candidate_assignment, reason] of [
    ['unsupported', 'unsupported_assignment'],
    ['ineligible', 'ineligible_assignment'],
  ] as const) {
    const result = applyComparisonPairRule(pair({ candidate_assignment }), policy);
    assert.equal(result.reason, reason);
    assert.equal(result.task_quality_included, false);
    assert.equal(result.reliability_included, false);
    assert.equal(result.execution_blocked, false);
    assert.equal(result.terminal_exclusion, true);
  }
});

test('pending assignments block execution before missing-trial handling', () => {
  const result = applyComparisonPairRule(
    pair({ candidate_assignment: 'pending', candidate_state: undefined }),
    policy
  );
  assert.equal(result.reason, 'pending_assignment');
  assert.equal(result.execution_blocked, true);
  assert.equal(result.terminal_exclusion, false);
});
