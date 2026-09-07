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
 * Phase 1 canonical contract types.
 *
 * These mirror `evals/docs/implementation-phases.md`'s "Stable foundation
 * across all phases" and "Result bundle and report evolution contract"
 * sections, simplified to the fields Phase 1 actually populates. Every
 * schema-bearing object below carries `schema_version` so a later phase can
 * add fields under semver rules (additive = minor, breaking = major) without
 * losing backward-compatible readers.
 */

export const SCHEMA_VERSION = '1.0.0';

/** Cluster mechanisms a scenario's scored truth may depend on. */
export type RequiredMechanism =
  | 'api-server'
  | 'endpointslice-controller'
  | 'scheduler'
  | 'kubelet'
  | 'cni'
  | 'csi'
  | 'admission-controller'
  | 'operator-reconciliation';

/** Cluster profiles a scenario declares it can run against. */
export type ClusterProfileName = 'local-kwok' | 'local-minikube' | 'aks';

export type LifecycleState = 'active' | 'draft' | 'quarantined' | 'retired';

export interface QuarantineMetadata {
  issue: string;
  reason: string;
  entered_at: string;
  expires_at: string;
  requalification_criteria: string;
}

/** Owner/provenance/review/quarantine metadata every scenario must declare. */
export interface ScenarioProvenance {
  owner: string;
  source: 'synthetic' | 'reference-implementation' | 'product-bug' | 'support-incident';
  license: string;
  admission_date: string;
  last_review: string;
  review_due: string;
  lifecycle_state: LifecycleState;
  quarantine?: QuarantineMetadata;
}

export interface ScenarioManifest {
  schema_version: string;
  scenario_id: string;
  scenario_version: string;
  family: string;
  /** `diagnose_only` (Phase 1) or `repair` (Phase 2+). */
  mode: 'diagnose_only' | 'repair';
  /** Short human summary; never contains answer-bearing gold facts. */
  title: string;
  description: string;
  provenance: ScenarioProvenance;
  supported_cluster_profiles: ClusterProfileName[];
  required_mechanisms: RequiredMechanism[];
  /**
   * Whether the generated `kwok-compatible` fast subset may include this
   * case. Derived at load time from `required_mechanisms` against the set of
   * mechanisms KWOK is independently proved to provide
   * (`KWOK_PROVEN_MECHANISMS` in `contracts/kwokCompatibility.ts`); stored
   * here only as the scenario author's declared expectation, which the
   * loader cross-checks and never silently overrides.
   */
  declared_kwok_compatible: boolean;
  /** Relative path (from the scenario directory) to setup Kubernetes manifests. */
  setup_manifest_path: string;
  /** Namespace created/deleted for this scenario's trials. */
  namespace_prefix: string;
  artifact_policy: {
    retain_raw_tool_output: boolean;
  };
}

/** The candidate-visible packet: task instructions plus non-answer-bearing context. */
export interface CandidatePacket {
  schema_version: string;
  scenario_id: string;
  scenario_version: string;
  /** The natural-language task presented to the candidate. */
  task_prompt: string;
  /** Resource identities the candidate may freely reference (never gold answers). */
  visible_resource_refs: string[];
  allowed_observation_kinds: string[];
  /** Read-only in Phase 1; always false until Phase 2 introduces repair mode. */
  allow_mutations: boolean;
  /** Structured sidecar the candidate must emit alongside natural-language prose. */
  required_submission_schema: 'diagnosis_submission@1.0.0';
}

export interface AcceptedFact {
  fact_id: string;
  resource_ref: string;
  field_path: string;
  observed_value: string;
  description?: string;
}

export interface AcceptedAction {
  action_id: string;
  description: string;
  /** Phase 1 is read-only; `no_action` is the only accepted action id. */
  operation: 'no_action';
}

/** The grader-only evaluator packet. Never sent to the candidate process. */
export interface EvaluatorPacket {
  schema_version: string;
  scenario_id: string;
  scenario_version: string;
  /** At least one of these fact sets must be fully cited for a `pass`. */
  accepted_fact_sets: AcceptedFact[][];
  accepted_actions: AcceptedAction[];
  /**
   * Plausible-but-wrong facts (invented cause, guessed field). Citing any of
   * these instead of an accepted fact set is an overdiagnosis/contradiction
   * failure, and they seed the machine-authored `wrong` control candidate.
   */
  contradiction_facts: AcceptedFact[];
  /** True when the correct behavior is bounded uncertainty, not a unique cause. */
  expects_uncertainty: boolean;
  min_hypotheses_if_uncertain?: number;
  /** Canary token that must never appear in candidate-visible output. */
  secret_canary: string;
}

/** The typed structured sidecar every candidate must emit (Phase 1 boundary). */
export interface DiagnosisSubmission {
  schema_version: string;
  cause_facts: Array<{ resource_ref: string; field_path: string; observed_value: string }>;
  resource_refs: string[];
  evidence_refs: string[];
  alternative_dispositions: string[];
  uncertainty: {
    is_uncertain: boolean;
    reason?: string;
  };
  proposed_actions: Array<{
    operation: 'no_action' | 'unscored_novel_strategy';
    description: string;
  }>;
}

export type SubmissionParseStatus = 'valid' | 'malformed' | 'missing';

export interface TrajectoryToolEvent {
  event_id: string;
  trial_id: string;
  attempt_id: string;
  sequence: number;
  recorded_at: string;
  type: 'tool_call';
  tool_name: string;
  operation: string;
  target_resource: string;
  argument_digest: string;
  duration_ns: string;
  status: 'success' | 'error' | 'denied';
  error_class?: string;
  result_digest: string;
  evidence_ids: string[];
  mutating: boolean;
}

export type OperationStatus = 'ok' | 'error' | 'skipped' | 'unsupported';

export interface StageStatus {
  setup: OperationStatus;
  candidate: OperationStatus;
  grader: OperationStatus;
  verifier: OperationStatus;
  cleanup: OperationStatus;
}

export type RunEligibility = 'valid' | 'invalid' | 'inconclusive' | 'quarantined';
export type TaskOutcome = 'pass' | 'fail' | 'partial' | 'abstain' | 'no_result';
export type SafetyOutcome = 'pass' | 'fail' | 'unknown' | 'not_applicable';
export type LifecycleValidity =
  | 'clean'
  | 'cleanup_pending'
  | 'cleanup_failed'
  | 'contamination_detected'
  | 'contamination_unresolved';

export interface DimensionResult {
  applicable: boolean;
  outcome: TaskOutcome;
  accepted_fact_ids?: string[];
  evidence_ids?: string[];
  grader_result_ids: string[];
  invalidity_reason?: string;
}

/** Nullable boolean projection: `true`/`false` only when `applicable` and eligible. */
export function projectBoolean(dimension: DimensionResult): boolean | null {
  if (!dimension.applicable) return null;
  if (dimension.outcome === 'pass') return true;
  if (dimension.outcome === 'fail') return false;
  return null;
}

export interface TimingResult {
  time_to_diagnosis_ns: string | null;
  time_to_resolution_ns: null; // Phase 1 has no repair mode; always censored.
  censoring_reason?: string;
}

export interface ToolSummary {
  attempted: number;
  completed: number;
  failed: number;
  denied: number;
  unique_tools: number;
  total_duration_ns: string;
}

export interface TrialResult {
  schema_version: string;
  trial_id: string;
  run_id: string;
  scenario_id: string;
  scenario_version: string;
  candidate_id: string;
  candidate_kind: 'scripted' | 'headlamp-cli';
  cluster_profile: ClusterProfileName;
  run_eligibility: RunEligibility;
  first_failure_owner?: 'setup' | 'candidate' | 'grader' | 'verifier' | 'cleanup' | 'harness';
  stage_status: StageStatus;
  dimensions: {
    root_cause: DimensionResult;
    recommended_fix: DimensionResult;
  };
  root_cause_found: boolean | null;
  recommended_fix_correct: boolean | null;
  safety_outcome: SafetyOutcome;
  safety_events: string[];
  lifecycle_validity: LifecycleValidity;
  timing: TimingResult;
  tool_summary: ToolSummary;
  submission_status: SubmissionParseStatus;
  unscored_novel_strategy: boolean;
  recorded_at: string;
}

export interface RegressionDelta {
  schema_version: string;
  record_id: string;
  scenario_id: string;
  dimension: 'root_cause' | 'recommended_fix' | 'safety' | 'latency_ns';
  baseline_trial_id: string;
  candidate_trial_id: string;
  baseline_value: string | number | boolean | null;
  candidate_value: string | number | boolean | null;
  direction: 'improved' | 'regressed' | 'unchanged' | 'undefined';
  named_change?: string;
}
