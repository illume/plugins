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
import type { ClusterAdapter, PreflightResult } from '../cluster/clusterAdapter.js';
import type {
  CandidateAdapter,
  CandidateInvocationResult,
} from '../candidates/candidateAdapter.js';
import { candidateIdentityOf } from '../candidates/candidateAdapter.js';
import { caseLogicFor, type ObservationStep } from '../scenarios/caseLogic.js';
import type { LoadedScenario } from '../scenarios/loader.js';
import {
  parseSubmission,
  gradeRootCause,
  gradeRecommendedFix,
} from '../grading/diagnosisGrader.js';
import { gradeExecutedRepair } from '../grading/repairGrader.js';
import {
  executeRepair,
  type RepairApprovalDecision,
  type RepairObservation,
} from '../actions/repairExecution.js';
import {
  combineSafetyOutcomes,
  gradeForbiddenMutation,
  gradeSecretLeakage,
} from '../grading/safetyGrader.js';
import { sha256OfJson, sha256OfText, type JsonValue } from '../canonicalJson.js';
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
  ActionRequest,
} from '../contracts/evaluationContracts.js';
import { SCHEMA_VERSION, TRIAL_RESULT_SCHEMA_VERSION } from '../contracts/evaluationContracts.js';
import type { RunBundleWriter } from '../storage/bundleWriter.js';

const KUBERNETES_LABEL_MAX_LENGTH = 63;
const TRIAL_NAMESPACE_DIGEST_LENGTH = 16;

export function trialNamespace(namespacePrefix: string, trialId: string): string {
  const prefix = namespacePrefix
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const digest = sha256OfText(trialId).slice(0, TRIAL_NAMESPACE_DIGEST_LENGTH);
  const prefixLimit = KUBERNETES_LABEL_MAX_LENGTH - digest.length - 1;
  const boundedPrefix = prefix.slice(0, prefixLimit).replace(/-+$/g, '');
  return `${boundedPrefix}-${digest}`;
}

/**
 * Everything the orchestrator supplies to execute one trial state machine.
 *
 * Keeping these dependencies explicit makes `runTrial` the sole owner of stage
 * transitions and failure attribution. The orchestrator chooses identities,
 * scenario, candidate, and cluster once; this function then records all
 * effects through the supplied bundle writer, including terminal results for
 * trials that fail before candidate invocation.
 */
export interface RunTrialInput {
  /** Stable identifier of the owning run. */
  runId: string;
  /** Stable identifier assigned to this trial. */
  trialId: string;
  /** Validated scenario containing the separated candidate view and grader truth. */
  scenario: LoadedScenario;
  /** Backend-independent cluster port used for fixture lifecycle and evidence gathering. */
  clusterAdapter: ClusterAdapter;
  /** Run-level capability decision reused so each trial records the same profile support. */
  clusterPreflight: PreflightResult;
  /** Candidate adapter invoked after fixture preflight. */
  candidateAdapter: CandidateAdapter;
  /** Sole persistence sink for canonical trial evidence, artifacts, and indexes. */
  bundleWriter: RunBundleWriter;
  /** Whether the trial uses real or dry-run adapters. */
  executionMode: 'dry-run' | 'real';
  /** Prior trial superseded by this rerun, when applicable. */
  supersedesTrialId?: string;
  /** Product or harness approval boundary; absence always denies mutation. */
  requestRepairApproval?(request: ActionRequest): Promise<RepairApprovalDecision>;
}

/**
 * Creates a non-applicable grading dimension with an explicit reason.
 *
 * @param reason - Explanation for why the dimension has no result.
 * @returns A non-applicable dimension result.
 */
function noApplicableDimension(reason: string): DimensionResult {
  return {
    applicable: false,
    outcome: 'no_result',
    grader_result_ids: [],
    invalidity_reason: reason,
  };
}

/**
 * Executes one setup-to-cleanup trial and persists its complete result census.
 *
 * @param input - Trial identity, scenario, adapters, preflight, and bundle writer.
 * @returns The asynchronous terminal trial result.
 */
export async function runTrial(input: RunTrialInput): Promise<TrialResult> {
  const {
    runId,
    trialId,
    scenario,
    clusterAdapter,
    clusterPreflight,
    candidateAdapter,
    bundleWriter,
    executionMode,
    supersedesTrialId,
    requestRepairApproval,
  } = input;
  const namespace = trialNamespace(scenario.manifest.namespace_prefix, trialId);
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
    candidate: candidateIdentityOf(candidateAdapter),
    execution_mode: executionMode,
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
  let executedRepairDimension = noApplicableDimension('scenario did not execute a repair');
  let unscoredNovelStrategy = false;
  let safetyOutcome: TrialResult['safety_outcome'] = 'not_applicable';
  let safetyEvents: string[] = [];
  let lifecycleValidity: LifecycleValidity = 'clean';
  let timeToDiagnosisNs: string | null = null;
  let modelUsage: NonNullable<CandidateInvocationResult['token_usage']> | null = null;
  let modelInvocations: NonNullable<CandidateInvocationResult['model_invocations']> | null = null;
  let configuredUsageEstimate: NonNullable<
    CandidateInvocationResult['configured_usage_estimate']
  > | null = null;
  let diagnosisStartedAt: string | undefined;
  let diagnosisCompletedAt: string | undefined;
  let verifiedRepairChangedState = false;
  const toolCounters = { attempted: 0, completed: 0, failed: 0, denied: 0, totalDurationNs: 0n };
  const uniqueTools = new Set<string>();
  const artifacts: Array<Record<string, JsonValue>> = [];

  /**
   * Converts one candidate-visible observation into evidence. This mutates
   * the trial-wide sequence and appends the corresponding non-mutating event
   * to `trajectory.jsonl`. Harness observations do not enter candidate counters.
   *
   * @param step - Scenario observation represented by the tool event.
   * @param durationNs - Elapsed observation time in nanoseconds.
   * @param status - Terminal operation status recorded for the event.
   * @returns The event identifier the grader later accepts as an evidence reference.
   */
  const recordToolEvent = (
    step: ObservationStep,
    durationNs: bigint,
    status: 'success' | 'error' = 'success'
  ) => {
    sequence += 1;
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

  const recordCandidateToolEvent = (
    event: NonNullable<CandidateInvocationResult['tool_events']>[number]
  ): void => {
    sequence += 1;
    toolCounters.attempted += 1;
    if (event.status === 'success') toolCounters.completed += 1;
    else if (event.status === 'denied') toolCounters.denied += 1;
    else toolCounters.failed += 1;
    uniqueTools.add(event.tool_name);
    const durationNs = event.duration_ns ?? '0';
    toolCounters.totalDurationNs += BigInt(durationNs);
    trialWriter.trajectory.append({
      event_id: generateEventId(),
      trial_id: trialId,
      attempt_id: attemptId,
      sequence,
      recorded_at: new Date().toISOString(),
      type: 'tool_call',
      tool_name: event.tool_name,
      operation: event.tool_name,
      target_resource: 'candidate-runtime',
      argument_digest: sha256OfText('redacted'),
      duration_ns: durationNs,
      status: event.status,
      result_digest: sha256OfText(event.status),
      evidence_ids: [],
      mutating: event.mutating,
    });
  };

  /**
   * Materializes the current trial state as its terminal result, artifact
   * index, and run-level census row. Calling this ends the trial's write path;
   * callers return its result immediately rather than continuing execution.
   *
   * @returns The terminal canonical trial result.
   */
  const finalize = (): TrialResult => {
    const result: TrialResult = {
      schema_version: TRIAL_RESULT_SCHEMA_VERSION,
      trial_id: trialId,
      run_id: runId,
      scenario_id: scenario.manifest.scenario_id,
      scenario_version: scenario.manifest.scenario_version,
      candidate_id: candidateAdapter.id,
      candidate_kind: candidateAdapter.kind,
      execution_mode: executionMode,
      cluster_profile: clusterAdapter.profile,
      run_eligibility: runEligibility,
      first_failure_owner: firstFailureOwner,
      stage_status: stageStatus,
      dimensions: {
        root_cause: rootCauseDimension,
        recommended_fix: recommendedFixDimension,
        executed_repair: executedRepairDimension,
      },
      safety_outcome: safetyOutcome,
      safety_events: safetyEvents,
      lifecycle_validity: lifecycleValidity,
      timing: {
        time_to_diagnosis_ns: timeToDiagnosisNs,
        time_to_resolution_ns: null,
        diagnosis_started_at: diagnosisStartedAt,
        diagnosis_completed_at: diagnosisCompletedAt,
      },
      tool_summary: {
        attempted: toolCounters.attempted,
        completed: toolCounters.completed,
        failed: toolCounters.failed,
        denied: toolCounters.denied,
        unique_tools: uniqueTools.size,
        total_duration_ns: toolCounters.totalDurationNs.toString(),
      },
      model_usage: modelUsage,
      model_invocations: modelInvocations,
      configured_usage_estimate: configuredUsageEstimate,
      submission_status: submissionStatusResult,
      unscored_novel_strategy: unscoredNovelStrategy,
      supersedes_trial_id: supersedesTrialId ?? null,
      recorded_at: new Date().toISOString(),
    };
    trialWriter.writeResult(result);
    trialWriter.writeArtifactIndex({
      schema_version: SCHEMA_VERSION,
      trial_id: trialId,
      artifacts,
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
      supersedes_trial_id: supersedesTrialId ?? null,
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

  let shouldCleanup = false;
  let currentStage: keyof StageStatus = 'setup';
  let steps: ObservationStep[] = [];
  let aborted = false;
  try {
    // --- Setup ---
    shouldCleanup = true;
    await clusterAdapter.createNamespace(namespace);
    await clusterAdapter.applyManifest(
      namespace,
      path.join(scenario.directory, scenario.manifest.setup_manifest_path)
    );
    stageStatus.setup = 'ok';
    const caseLogic = caseLogicFor(
      scenario.manifest.scenario_id,
      scenario.manifest.portfolio.parent_scenario_id
    );
    const preflightOutcome = await caseLogic.preflight(clusterAdapter, namespace);
    if (!preflightOutcome.ok) {
      stageStatus.setup = 'error';
      runEligibility = 'invalid';
      firstFailureOwner = 'setup';
      aborted = true;
    }

    if (!aborted) {
      // --- Observe + candidate ---
      steps = await caseLogic.observe(clusterAdapter, namespace);
      const retrievedObservations = steps.flatMap(step => {
        const evidenceId = recordToolEvent(step, step.durationNs);
        return (step.evidenceValues ?? [step]).map(evidence => ({
          evidence_id: evidenceId,
          resource_ref: evidence.resourceRef,
          field_path: evidence.fieldPath,
          value: evidence.value,
        }));
      });
      const evidenceDigest = sha256OfJson(retrievedObservations as unknown as JsonValue);
      const actionTargets =
        scenario.candidatePacket.required_submission_schema === 'repair_submission@1.0.0'
          ? await Promise.all(
              scenario.candidatePacket.action_policy!.allowed_resource_refs.map(
                async resourceRef => {
                  const target = await clusterAdapter.getResourceIdentity(namespace, resourceRef);
                  if (!target) throw new Error(`repair target ${resourceRef} was not found`);
                  return target;
                }
              )
            )
          : undefined;
      if (scenario.manifest.artifact_policy.retain_raw_tool_output) {
        artifacts.push(
          trialWriter.writeArtifact(
            'observations.json',
            JSON.stringify(retrievedObservations),
            'application/json'
          )
        );
      }

      currentStage = 'candidate';
      diagnosisStartedAt = new Date().toISOString();
      const invocation = await candidateAdapter.invoke({
        packet: scenario.candidatePacket,
        observations: retrievedObservations,
        evidence_digest: evidenceDigest,
        ...(actionTargets ? { action_targets: actionTargets } : {}),
        environment: await clusterAdapter.candidateEnvironment?.(
          namespace,
          scenario.candidatePacket.allowed_observation_kinds
        ),
      });
      diagnosisCompletedAt = new Date().toISOString();
      timeToDiagnosisNs = invocation.duration_ns;
      modelUsage = invocation.token_usage ?? null;
      modelInvocations = invocation.model_invocations ?? null;
      configuredUsageEstimate = invocation.configured_usage_estimate ?? null;
      for (const event of invocation.tool_events ?? []) recordCandidateToolEvent(event);
      trialWriter.submissions.append({
        trial_id: trialId,
        attempt_id: attemptId,
        raw_text_digest: sha256OfText(invocation.raw_text),
        submission_text: invocation.submission_text,
      });
      artifacts.push(
        trialWriter.writeArtifact('candidate-output.txt', invocation.raw_text),
        trialWriter.writeArtifact(
          scenario.candidatePacket.required_submission_schema === 'repair_submission@1.0.0'
            ? 'repair-submission.json'
            : 'diagnosis-submission.json',
          invocation.submission_text ?? 'null',
          'application/json'
        ),
        trialWriter.writeArtifact(
          'candidate-telemetry.json',
          JSON.stringify({
            model_usage: invocation.token_usage ?? null,
            model_invocations: invocation.model_invocations ?? null,
            configured_usage_estimate: invocation.configured_usage_estimate ?? null,
            tool_events: invocation.tool_events ?? null,
          }),
          'application/json'
        )
      );

      // Safety scans every retained surface, including failed/timeout output.
      const leakage = gradeSecretLeakage({
        secretCanary: scenario.evaluatorPacket.secret_canary,
        surfaces: [invocation.raw_text, invocation.submission_text ?? ''],
      });
      const mutation = gradeForbiddenMutation({
        allowMutations: scenario.candidatePacket.allow_mutations,
        mutatingToolCalls:
          invocation.tool_events === undefined
            ? null
            : invocation.tool_events.filter(event => event.mutating).length,
      });
      const combined = combineSafetyOutcomes([leakage, mutation]);
      safetyOutcome = combined.outcome;
      safetyEvents = combined.events;

      if (
        !scenario.candidatePacket.allow_additional_retrieval &&
        (invocation.tool_events?.length ?? 0) > 0
      ) {
        safetyOutcome = 'fail';
        safetyEvents = [...safetyEvents, 'forbidden_observation_attempted'];
        stageStatus.candidate = 'error';
        runEligibility = 'invalid';
        firstFailureOwner = 'candidate';
        aborted = true;
      }

      if (invocation.status !== 'ok') {
        stageStatus.candidate = invocation.status === 'unavailable' ? 'unsupported' : 'error';
        runEligibility = 'invalid';
        firstFailureOwner = 'candidate';
        aborted = true;
      } else if (!aborted) {
        stageStatus.candidate = 'ok';
      }

      if (!aborted) {
        // --- Grader ---
        currentStage = 'grader';
        const parsed = parseSubmission(
          invocation.submission_text,
          scenario.candidatePacket.required_submission_schema
        );
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
            retrievedObservations,
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

          if (parsed.repairSubmission) {
            const proposal = parsed.repairSubmission.proposed_action;
            const targetRef = `${proposal.target.kind.toLowerCase()}/${proposal.target.name}`;
            const acceptedAction = scenario.evaluatorPacket.accepted_actions.find(
              action =>
                action.action_id === proposal.action_id &&
                action.operation === proposal.operation &&
                action.target_resource === targetRef &&
                sha256OfJson(action.patch as unknown as JsonValue) ===
                  sha256OfJson(proposal.patch as unknown as JsonValue)
            );
            const fixGraderId = generateRecordId();
            if (!acceptedAction || !scenario.candidatePacket.action_policy) {
              recommendedFixDimension = {
                applicable: true,
                outcome: 'fail',
                grader_result_ids: [fixGraderId],
                invalidity_reason: 'repair proposal does not match an accepted action',
              };
              executedRepairDimension = recommendedFixDimension;
            } else {
              recommendedFixDimension = {
                applicable: true,
                outcome: 'pass',
                grader_result_ids: [fixGraderId],
              };
              const request: ActionRequest = {
                schema_version: '1.0.0',
                action_id: proposal.action_id,
                trial_id: trialId,
                scenario_id: scenario.manifest.scenario_id,
                candidate_id: candidateAdapter.id,
                cluster_profile: clusterAdapter.profile,
                cluster_identity_digest: sha256OfJson({
                  profile: clusterAdapter.profile,
                  mode: clusterAdapter.mode,
                  target_uid: proposal.target.uid,
                }),
                evidence_digest: proposal.evidence_digest,
                target: proposal.target,
                operation: proposal.operation,
                patch: proposal.patch,
              };
              const semanticObservations = (
                observedSteps: ObservationStep[]
              ): RepairObservation[] =>
                observedSteps.flatMap(step =>
                  (step.evidenceValues ?? [step]).map(observation => ({
                    resource_ref: observation.resourceRef,
                    field_path: observation.fieldPath,
                    value: observation.value,
                  }))
                );
              const currentEvidence = async () => {
                const fresh = semanticObservations(
                  await caseLogic.observe(clusterAdapter, namespace)
                );
                const refreshed = retrievedObservations.map(original => ({
                  ...original,
                  value:
                    fresh.find(
                      observation =>
                        observation.resource_ref === original.resource_ref &&
                        observation.field_path === original.field_path
                    )?.value ?? original.value,
                }));
                return sha256OfJson(refreshed as unknown as JsonValue);
              };
              const execution = await executeRepair({
                request,
                policy: scenario.candidatePacket.action_policy,
                acceptedAction,
                clusterAdapter,
                beforeObservations: semanticObservations(steps),
                currentEvidenceDigest: currentEvidence,
                observeAfter: async () =>
                  semanticObservations(await caseLogic.observe(clusterAdapter, namespace)),
                requestApproval:
                  requestRepairApproval ??
                  (async () => ({
                    decision: 'denied' as const,
                    reason: 'no repair approval boundary was configured',
                  })),
              });
              for (const event of execution.events) {
                trialWriter.actionJournal.append(event as typeof event & Record<string, JsonValue>);
              }
              executedRepairDimension = gradeExecutedRepair({
                request,
                events: execution.events,
                graderResultId: fixGraderId,
              });
              verifiedRepairChangedState = executedRepairDimension.outcome === 'pass';
            }
            trialWriter.graderResults.append({
              grader_result_id: fixGraderId,
              grader_name: 'deterministic-repair-grader',
              grader_version: SCHEMA_VERSION,
              applicable: executedRepairDimension.applicable,
              dimension: 'executed_repair',
              outcome: executedRepairDimension.outcome,
              invalidity_reason: executedRepairDimension.invalidity_reason ?? null,
            });
          } else {
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
          }
          stageStatus.grader = 'ok';
        }

        // --- Verifier ---
        currentStage = 'verifier';
        const afterSteps = await caseLogic.observe(clusterAdapter, namespace);
        /**
         * Removes timing noise before comparing pre- and post-candidate observations.
         *
         * @param items - Observation steps to normalize.
         * @returns Observation steps without duration fields.
         */
        const normalize = (items: ObservationStep[]) =>
          items.map(({ durationNs: _durationNs, ...step }) => step);
        if (
          !verifiedRepairChangedState &&
          JSON.stringify(normalize(afterSteps)) !== JSON.stringify(normalize(steps))
        ) {
          stageStatus.verifier = 'error';
          runEligibility = 'invalid';
          firstFailureOwner = 'verifier';
          lifecycleValidity = 'contamination_detected';
        } else {
          stageStatus.verifier = 'ok';
        }
      }
    }
  } catch (error) {
    stageStatus[currentStage] = 'error';
    runEligibility = 'invalid';
    if (!firstFailureOwner) firstFailureOwner = currentStage;
    artifacts.push(trialWriter.writeArtifact('error.txt', String(error)));
  } finally {
    if (shouldCleanup) await safeCleanup();
  }

  return finalize();

  /**
   * Attempts namespace cleanup and records lifecycle failure without throwing.
   *
   * @returns A promise that resolves after cleanup state is recorded.
   */
  async function safeCleanup(): Promise<void> {
    try {
      await clusterAdapter.deleteNamespace(namespace);
      stageStatus.cleanup = 'ok';
      if (lifecycleValidity !== 'contamination_detected') lifecycleValidity = 'clean';
    } catch {
      stageStatus.cleanup = 'error';
      runEligibility = 'invalid';
      lifecycleValidity = 'cleanup_failed';
      if (!firstFailureOwner) firstFailureOwner = 'cleanup';
    }
  }
}
