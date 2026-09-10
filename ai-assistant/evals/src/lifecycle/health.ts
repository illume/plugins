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

import type { TrialResult } from '../contracts/evaluationContracts.js';

/** Aggregate measurements of evaluation-system lifecycle health. */
export interface HealthSummary {
  /** Number of trials included in the aggregate. */
  total_trials: number;
  /** Number of trials whose setup stage succeeded. */
  setup_ok: number;
  /** Number of trials whose setup stage failed. */
  setup_failed: number;
  /** Number of trials whose cleanup stage succeeded. */
  cleanup_ok: number;
  /** Number of trials whose cleanup stage failed. */
  cleanup_failed: number;
  /** Number of invalid submissions that reached a successful grader stage. */
  invalid_grader_count: number;
  /** Number of trials excluded from valid-run aggregates. */
  excluded_count: number;
  /** Failure counts grouped by the component that first failed. */
  by_first_failure_owner: Record<string, number>;
  /** Trials with an observed diagnosis duration. */
  diagnosis_duration_observed_count: number;
  /** Combined observed diagnosis duration in nanoseconds. */
  diagnosis_duration_total_ns: string;
  /** Combined tool execution duration in nanoseconds. */
  tool_duration_total_ns: string;
  /** Combined attempted tool calls. */
  tool_calls_attempted: number;
  /** Combined failed or policy-denied tool calls. */
  tool_calls_failed_or_denied: number;
  /** Trials with provider-reported model token usage. */
  model_usage_observed_count: number;
  /** Combined provider-reported input tokens. */
  model_input_tokens: number;
  /** Combined provider-reported output tokens. */
  model_output_tokens: number;
  /** Combined provider-reported total tokens. */
  model_total_tokens: number;
  /** Trials with provider-reported prompt-cache usage details. */
  model_cache_usage_observed_count: number;
  /** Combined provider-reported input tokens served from cache. */
  model_cache_read_input_tokens: number;
  /** Combined provider-reported input tokens written to cache. */
  model_cache_creation_input_tokens: number;
  /** Trials with a configured usage estimate. */
  configured_usage_estimate_observed_count: number;
  /** Configured estimate totals grouped by accounting unit. */
  configured_usage_totals_by_unit: Record<string, string>;
}

const USD_SCALE = 1_000_000_000_000_000n;

function scaledAmount(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,15}))?$/.exec(value);
  if (!match) throw new Error(`invalid configured usage amount: ${value}`);
  return BigInt(match[1] ?? '0') * USD_SCALE + BigInt((match[2] ?? '').padEnd(15, '0'));
}

function amountText(value: bigint): string {
  const whole = value / USD_SCALE;
  const fraction = (value % USD_SCALE).toString().padStart(15, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * Computes Phase 1 descriptive evaluation-system health from trial results.
 *
 * @param trials - Trial results to aggregate.
 * @returns Descriptive lifecycle health measurements for the trials.
 */
export function computeHealthSummary(trials: TrialResult[]): HealthSummary {
  const byOwner: Record<string, number> = {};
  let setupOk = 0;
  let setupFailed = 0;
  let cleanupOk = 0;
  let cleanupFailed = 0;
  let invalidGrader = 0;
  let excluded = 0;
  let diagnosisDurationObserved = 0;
  let diagnosisDurationNs = 0n;
  let toolDurationNs = 0n;
  let toolCallsAttempted = 0;
  let toolCallsFailedOrDenied = 0;
  let modelUsageObserved = 0;
  let modelInputTokens = 0;
  let modelOutputTokens = 0;
  let modelTotalTokens = 0;
  let modelCacheUsageObserved = 0;
  let modelCacheReadInputTokens = 0;
  let modelCacheCreationInputTokens = 0;
  let configuredUsageObserved = 0;
  const configuredUsageTotals = new Map<string, bigint>();

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
    if (trial.timing.time_to_diagnosis_ns !== null) {
      diagnosisDurationObserved += 1;
      diagnosisDurationNs += BigInt(trial.timing.time_to_diagnosis_ns);
    }
    toolDurationNs += BigInt(trial.tool_summary.total_duration_ns);
    toolCallsAttempted += trial.tool_summary.attempted;
    toolCallsFailedOrDenied += trial.tool_summary.failed + trial.tool_summary.denied;
    if (trial.model_usage !== null) {
      modelUsageObserved += 1;
      modelInputTokens += trial.model_usage.input_tokens;
      modelOutputTokens += trial.model_usage.output_tokens;
      modelTotalTokens += trial.model_usage.total_tokens;
      if (
        trial.model_usage.cache_read_input_tokens !== undefined ||
        trial.model_usage.cache_creation_input_tokens !== undefined
      ) {
        modelCacheUsageObserved += 1;
        modelCacheReadInputTokens += trial.model_usage.cache_read_input_tokens ?? 0;
        modelCacheCreationInputTokens += trial.model_usage.cache_creation_input_tokens ?? 0;
      }
    }
    if (trial.configured_usage_estimate !== null) {
      configuredUsageObserved += 1;
      configuredUsageTotals.set(
        trial.configured_usage_estimate.unit,
        (configuredUsageTotals.get(trial.configured_usage_estimate.unit) ?? 0n) +
          scaledAmount(trial.configured_usage_estimate.amount)
      );
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
    diagnosis_duration_observed_count: diagnosisDurationObserved,
    diagnosis_duration_total_ns: diagnosisDurationNs.toString(),
    tool_duration_total_ns: toolDurationNs.toString(),
    tool_calls_attempted: toolCallsAttempted,
    tool_calls_failed_or_denied: toolCallsFailedOrDenied,
    model_usage_observed_count: modelUsageObserved,
    model_input_tokens: modelInputTokens,
    model_output_tokens: modelOutputTokens,
    model_total_tokens: modelTotalTokens,
    model_cache_usage_observed_count: modelCacheUsageObserved,
    model_cache_read_input_tokens: modelCacheReadInputTokens,
    model_cache_creation_input_tokens: modelCacheCreationInputTokens,
    configured_usage_estimate_observed_count: configuredUsageObserved,
    configured_usage_totals_by_unit: Object.fromEntries(
      [...configuredUsageTotals.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([unit, total]) => [unit, amountText(total)])
    ),
  };
}
