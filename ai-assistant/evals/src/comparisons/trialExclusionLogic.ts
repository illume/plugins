import type { RunEligibility } from '../contracts/evaluationContracts.js';
import type { AssignmentDisposition, ComparisonRegistration } from './registration.js';

export type ComparisonTrialState = RunEligibility | 'censored';

export interface ComparisonPairInput {
  pair_id: string;
  baseline_assignment: AssignmentDisposition;
  candidate_assignment: AssignmentDisposition;
  baseline_state?: ComparisonTrialState;
  candidate_state?: ComparisonTrialState;
}

export type ComparisonPairReason =
  | 'valid_pair'
  | 'invalid_pair'
  | 'censored_pair'
  | 'missing_pair'
  | 'unsupported_assignment'
  | 'ineligible_assignment'
  | 'pending_assignment';

export interface ComparisonPairDisposition {
  pair_id: string;
  reason: ComparisonPairReason;
  task_quality_included: boolean;
  reliability_included: boolean;
  execution_blocked: boolean;
  terminal_exclusion: boolean;
}

function disposition(
  pairId: string,
  reason: ComparisonPairReason,
  policy: ComparisonRegistration['missing_pair_rule']
): ComparisonPairDisposition {
  const action = policy[reason];
  return {
    pair_id: pairId,
    reason,
    task_quality_included: action === 'include_task_quality_and_reliability',
    reliability_included:
      action === 'include_task_quality_and_reliability' ||
      action === 'exclude_task_quality_retain_reliability',
    execution_blocked: action === 'block_execution',
    terminal_exclusion: action === 'terminal_exclusion',
  };
}

/** Applies the registered missingness rule without dropping assignment evidence. */
export function applyComparisonPairRule(
  pair: ComparisonPairInput,
  policy: ComparisonRegistration['missing_pair_rule']
): ComparisonPairDisposition {
  const assignments = [pair.baseline_assignment, pair.candidate_assignment];
  if (assignments.includes('pending'))
    return disposition(pair.pair_id, 'pending_assignment', policy);
  if (assignments.includes('unsupported')) {
    return disposition(pair.pair_id, 'unsupported_assignment', policy);
  }
  if (assignments.includes('ineligible')) {
    return disposition(pair.pair_id, 'ineligible_assignment', policy);
  }
  if (pair.baseline_state === undefined || pair.candidate_state === undefined) {
    return disposition(pair.pair_id, 'missing_pair', policy);
  }
  const states = [pair.baseline_state, pair.candidate_state];
  if (states.includes('censored')) return disposition(pair.pair_id, 'censored_pair', policy);
  if (states.some(state => state !== 'valid')) {
    return disposition(pair.pair_id, 'invalid_pair', policy);
  }
  return disposition(pair.pair_id, 'valid_pair', policy);
}
