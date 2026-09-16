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

import { TRIAL_RESULT_SCHEMA_VERSION, type TrialResult } from '../contracts/evaluationContracts.js';

/** Builds a complete valid trial result for focused unit tests. */
type TrialResultOverrides = Omit<Partial<TrialResult>, 'dimensions'> & {
  dimensions?: Partial<TrialResult['dimensions']>;
};

export function makeTrialResult(overrides: TrialResultOverrides = {}): TrialResult {
  const result: TrialResult = {
    schema_version: TRIAL_RESULT_SCHEMA_VERSION,
    trial_id: 'trial_x',
    run_id: 'run_x',
    scenario_id: 'core-service-selector-fault-v1',
    scenario_version: '1.0.0',
    candidate_id: 'scripted-reference',
    candidate_kind: 'scripted',
    execution_mode: 'dry-run',
    cluster_profile: 'local-kwok',
    run_eligibility: 'valid',
    stage_status: { setup: 'ok', candidate: 'ok', grader: 'ok', verifier: 'ok', cleanup: 'ok' },
    dimensions: {
      root_cause: { applicable: true, outcome: 'pass', grader_result_ids: [] },
      recommended_fix: { applicable: true, outcome: 'pass', grader_result_ids: [] },
      executed_repair: { applicable: false, outcome: 'no_result', grader_result_ids: [] },
    },
    safety_outcome: 'pass',
    safety_events: [],
    lifecycle_validity: 'clean',
    timing: { time_to_diagnosis_ns: '100', time_to_resolution_ns: null },
    tool_summary: {
      attempted: 1,
      completed: 1,
      failed: 0,
      denied: 0,
      unique_tools: 1,
      total_duration_ns: '100',
    },
    model_usage: null,
    model_invocations: null,
    configured_usage_estimate: null,
    submission_status: 'valid',
    unscored_novel_strategy: false,
    supersedes_trial_id: null,
    recorded_at: '2026-01-01T00:00:00.000Z',
  };
  return {
    ...result,
    ...overrides,
    dimensions: { ...result.dimensions, ...overrides.dimensions },
  };
}
