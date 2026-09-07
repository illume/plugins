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
 * The Phase 1 trial state machine: setup -> preflight -> candidate ->
 * grader -> verifier -> cleanup. Every stage's outcome is recorded
 * separately (`stage_status`); the first stage that fails owns the trial's
 * `first_failure_owner`, and every trial — even one that never reaches the
 * candidate — still gets a complete trial-census row and terminal
 * `result.json`.
 */

import path from 'node:path';
import type { ClusterAdapter, PreflightResult } from '../cluster/types.js';
import type { CandidateAdapter } from '../candidates/types.js';
import { caseLogicFor, type ObservationStep } from '../scenarios/caseLogic.js';
import type { LoadedScenario } from '../scenarios/loader.js';
import {
  parseSubmission,
  gradeRootCause,
  gradeRecommendedFix,
} from '../grading/diagnosisGrader.js';
import { combineSafetyOutcomes, gradeSecretLeakage } from '../grading/safetyGrader.js';
import { sha256OfText } from '../canonicalJson.js';
import {
  attemptId as generateAttemptId,
  eventId as generateEventId,
  recordId as generateRecordId,
} from '../ids.js';
import type {
  DimensionResult,
  LifecycleValidity,
  OperationStatus,
  RunEligibility,
  StageStatus,
  TrialResult,
} from '../contracts/types.js';
import { SCHEMA_VERSION } from '../contracts/types.js';
import type { RunBundleWriter } from '../storage/bundleWriter.js';

export interface RunTrialInput {
  runId: string;
  trialId: string;
  scenario: LoadedScenario;
  clusterAdapter: ClusterAdapter;
  clusterPreflight: PreflightResult;
  candidateAdapter: CandidateAdapter;
  bundleWriter: RunBundleWriter;
}

function noApplicableDimension(reason: string): DimensionResult {
  return {
    applicable: false,
    outcome: 'no_result',
    grader_result_ids: [],
    invalidity_reason: reason,
  };
}

export async function runTrial(input: RunTrialInput): Promise<TrialResult> {
  const {
    runId,
    trialId,
    scenario,
    clusterAdapter,
    clusterPreflight,
    candidateAdapter,
    bundleWriter,
  } = input;
  const namespace = `${scenario.manifest.namespace_prefix}-${trialId}`.toLowerCase();
  const trialWriter = bundleWriter.newTrial(trialId);
  const attemptId = generateAttemptId();

  trialWriter.writeScenarioRef({
    scenario_id: scenario.manifest.scenario_id,
    scenario_version: scenario.manifest.scenario_version,
    family: scenario.manifest.family,
    candidate_view_digest: sha256OfText(JSON.stringify(scenario.candidatePacket)),
  });
  trialWriter.writeEnvironmentManifest({
    schema_version: SCHEMA_VERSION,
    trial_id: trialId,
    cluster_profile: clusterAdapter.profile,
    candidate: { id: candidateAdapter.id, kind: candidateAdapter.kind },
    observed_at: new Date().toISOString(),
  });

  const stageStatus: StageStatus = {
    setup: 'skipped',
    candidate: 'skipped',
    grader: 'skipped',
    verifier: 'skipped',
    cleanup: 'skipped',
  };
  let firstFailureOwner: TrialResult['first_failure_owner'];
  let runEligibility: RunEligibility = 'valid';
  let sequence = 0;
  let submissionStatusResult: TrialResult['submission_status'] = 'missing';
  let rootCauseDimension = noApplicableDimension('trial did not reach the grading stage');
  let recommendedFixDimension = noApplicableDimension('trial did not reach the grading stage');
  let unscoredNovelStrategy = false;
  let safetyOutcome: TrialResult['safety_outcome'] = 'not_applicable';
  let safetyEvents: string[] = [];
  let lifecycleValidity: LifecycleValidity = 'clean';
  let timeToDiagnosisNs: string | null = null;
  const toolCounters = { attempted: 0, completed: 0, failed: 0, denied: 0, totalDurationNs: 0n };
  const uniqueTools = new Set<string>();

  const recordToolEvent = (
    step: ObservationStep,
    durationNs: bigint,
    status: 'success' | 'error' = 'success'
  ) => {
    sequence += 1;
    toolCounters.attempted += 1;
    if (status === 'success') toolCounters.completed += 1;
    else toolCounters.failed += 1;
    toolCounters.totalDurationNs += durationNs;
    uniqueTools.add(step.toolName);
    const evidenceId = generateEventId();
    trialWriter.trajectory.append({
      event_id: evidenceId,
      trial_id: trialId,
      attempt_id: attemptId,
      sequence,
      recorded_at: new Date().toISOString(),
      type: 'tool_call',
      tool_name: step.toolName,
      operation: step.operation,
      target_resource: step.targetResource,
      argument_digest: sha256OfText(step.targetResource),
      duration_ns: durationNs.toString(),
      status,
      result_digest: sha256OfText(step.value),
      evidence_ids: [evidenceId],
      mutating: false,
    });
    return evidenceId;
  };

  const finalize = (): TrialResult => {
    const rootCauseFound =
      rootCauseDimension.applicable && rootCauseDimension.outcome === 'pass'
        ? true
        : rootCauseDimension.applicable && rootCauseDimension.outcome === 'fail'
        ? false
        : null;
    const recommendedFixCorrect =
      recommendedFixDimension.applicable && recommendedFixDimension.outcome === 'pass'
        ? true
        : recommendedFixDimension.applicable && recommendedFixDimension.outcome === 'fail'
        ? false
        : null;

    const result: TrialResult = {
      schema_version: SCHEMA_VERSION,
      trial_id: trialId,
      run_id: runId,
      scenario_id: scenario.manifest.scenario_id,
      scenario_version: scenario.manifest.scenario_version,
      candidate_id: candidateAdapter.id,
      candidate_kind: candidateAdapter.kind,
      cluster_profile: clusterAdapter.profile,
      run_eligibility: runEligibility,
      first_failure_owner: firstFailureOwner,
      stage_status: stageStatus,
      dimensions: { root_cause: rootCauseDimension, recommended_fix: recommendedFixDimension },
      root_cause_found: rootCauseFound,
      recommended_fix_correct: recommendedFixCorrect,
      safety_outcome: safetyOutcome,
      safety_events: safetyEvents,
      lifecycle_validity: lifecycleValidity,
      timing: { time_to_diagnosis_ns: timeToDiagnosisNs, time_to_resolution_ns: null },
      tool_summary: {
        attempted: toolCounters.attempted,
        completed: toolCounters.completed,
        failed: toolCounters.failed,
        denied: toolCounters.denied,
        unique_tools: uniqueTools.size,
        total_duration_ns: toolCounters.totalDurationNs.toString(),
      },
      submission_status: submissionStatusResult,
      unscored_novel_strategy: unscoredNovelStrategy,
      recorded_at: new Date().toISOString(),
    };
    trialWriter.writeResult(result);
    trialWriter.writeArtifactIndex({
      schema_version: SCHEMA_VERSION,
      trial_id: trialId,
      artifacts: [],
    });
    bundleWriter.recordTrialIndex({
      trial_id: trialId,
      run_id: runId,
      scenario_id: scenario.manifest.scenario_id,
      scenario_version: scenario.manifest.scenario_version,
      candidate_id: candidateAdapter.id,
      cluster_profile: clusterAdapter.profile,
      run_eligibility: runEligibility,
      first_failure_owner: firstFailureOwner ?? null,
      supersedes_trial_id: null,
    });
    return result;
  };

  // --- Cluster-level preflight (tool/credential availability) ---
  if (!clusterPreflight.supported) {
    stageStatus.setup = 'unsupported';
    runEligibility = 'invalid';
    firstFailureOwner = 'setup';
    lifecycleValidity = 'clean';
    return finalize();
  }

  // --- Setup ---
  try {
    await clusterAdapter.createNamespace(namespace);
    await clusterAdapter.applyManifest(
      namespace,
      path.join(scenario.directory, scenario.manifest.setup_manifest_path)
    );
    stageStatus.setup = 'ok';
  } catch (err) {
    stageStatus.setup = 'error';
    runEligibility = 'invalid';
    firstFailureOwner = 'setup';
    return finalize();
  }

  // --- Scenario preflight (case-specific hard truth check) ---
  const caseLogic = caseLogicFor(scenario.manifest.scenario_id);
  const preflightOutcome = await caseLogic.preflight(clusterAdapter, namespace);
  if (!preflightOutcome.ok) {
    stageStatus.setup = 'error';
    runEligibility = 'invalid';
    firstFailureOwner = 'setup';
    await safeCleanup();
    return finalize();
  }

  // --- Observe + candidate ---
  const diagnosisStart = process.hrtime.bigint();
  const steps = await caseLogic.observe(clusterAdapter, namespace);
  const retrievedObservations = steps.map(step => {
    const stepStart = process.hrtime.bigint();
    const evidenceId = recordToolEvent(step, process.hrtime.bigint() - stepStart);
    return {
      evidence_id: evidenceId,
      resource_ref: step.resourceRef,
      field_path: step.fieldPath,
      value: step.value,
    };
  });

  let invocation;
  try {
    invocation = await candidateAdapter.invoke({
      packet: scenario.candidatePacket,
      observations: retrievedObservations,
    });
  } catch (err) {
    stageStatus.candidate = 'error';
    runEligibility = 'invalid';
    firstFailureOwner = 'candidate';
    await safeCleanup();
    return finalize();
  }
  timeToDiagnosisNs = (process.hrtime.bigint() - diagnosisStart).toString();

  if (invocation.status !== 'ok') {
    stageStatus.candidate = invocation.status === 'unavailable' ? 'unsupported' : 'error';
    runEligibility = 'invalid';
    firstFailureOwner = 'candidate';
    await safeCleanup();
    return finalize();
  }
  stageStatus.candidate = 'ok';

  trialWriter.submissions.append({
    trial_id: trialId,
    attempt_id: attemptId,
    raw_text_digest: sha256OfText(invocation.raw_text),
    submission_text: invocation.submission_text,
  });

  // --- Grader ---
  const parsed = parseSubmission(invocation.submission_text);
  submissionStatusResult = parsed.status;
  if (parsed.status !== 'valid' || !parsed.submission) {
    stageStatus.grader = 'ok';
    rootCauseDimension = {
      applicable: true,
      outcome: 'no_result',
      grader_result_ids: [],
      invalidity_reason: `submission ${parsed.status}${
        parsed.parseError ? `: ${parsed.parseError}` : ''
      }`,
    };
    recommendedFixDimension = rootCauseDimension;
  } else {
    const rootCauseGraderId = generateRecordId();
    rootCauseDimension = gradeRootCause({
      submission: parsed.submission,
      evaluatorPacket: scenario.evaluatorPacket,
      retrievedEvidenceIds: retrievedObservations.map(o => o.evidence_id),
      graderResultId: rootCauseGraderId,
    });
    trialWriter.graderResults.append({
      grader_result_id: rootCauseGraderId,
      grader_name: 'deterministic-diagnosis-grader',
      grader_version: SCHEMA_VERSION,
      applicable: rootCauseDimension.applicable,
      dimension: 'root_cause',
      outcome: rootCauseDimension.outcome,
      invalidity_reason: rootCauseDimension.invalidity_reason ?? null,
    });

    const fixGraderId = generateRecordId();
    const fixResult = gradeRecommendedFix({
      submission: parsed.submission,
      graderResultId: fixGraderId,
    });
    recommendedFixDimension = fixResult.dimension;
    unscoredNovelStrategy = fixResult.unscoredNovelStrategy;
    trialWriter.graderResults.append({
      grader_result_id: fixGraderId,
      grader_name: 'deterministic-diagnosis-grader',
      grader_version: SCHEMA_VERSION,
      applicable: recommendedFixDimension.applicable,
      dimension: 'recommended_fix',
      outcome: recommendedFixDimension.outcome,
      invalidity_reason: recommendedFixDimension.invalidity_reason ?? null,
    });
    stageStatus.grader = 'ok';
  }

  // --- Safety (hard, orthogonal to task outcome) ---
  const surfaces = [invocation.raw_text, invocation.submission_text ?? ''];
  const leakage = gradeSecretLeakage({
    secretCanary: scenario.evaluatorPacket.secret_canary,
    surfaces,
  });
  const combined = combineSafetyOutcomes([leakage]);
  safetyOutcome = combined.outcome;
  safetyEvents = combined.events;

  // --- Verifier + cleanup ---
  stageStatus.verifier = 'ok';
  await safeCleanup();

  return finalize();

  async function safeCleanup(): Promise<void> {
    try {
      await clusterAdapter.deleteNamespace(namespace);
      stageStatus.cleanup = 'ok';
      lifecycleValidity = 'clean';
    } catch {
      stageStatus.cleanup = 'error';
      lifecycleValidity = 'cleanup_failed';
      if (!firstFailureOwner) firstFailureOwner = 'cleanup';
    }
  }
}
