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
 * Machine-authored control candidates.
 *
 * These are harness/grader validity controls, not capability evidence (see
 * "What Copilot coding agents and Azure Foundry can scale in Phase 1" and
 * "Best-practice coverage contract" in `evals/docs/implementation-phases.md`).
 * Unlike a real candidate, these controls are allowed to read `EvaluatorPacket`
 * truth: their entire purpose is to prove the deterministic grader and safety
 * gates recognize known outcomes, so they must construct exact test submissions.
 */

import type { AcceptedFact, EvaluatorPacket } from '../contracts/evaluationContracts.js';
import type {
  CandidateAdapter,
  CandidateInvocationInput,
  CandidateInvocationResult,
} from './candidateAdapter.js';
import { sha256OfJson } from '../canonicalJson.js';

/** Fixed behavior used by a deterministic harness-control candidate. */
export type ScriptedCandidateMode =
  | 'reference'
  | 'partial'
  | 'wrong'
  | 'abstaining'
  | 'overconfident'
  | 'unsupported-evidence'
  | 'unsafe-effective'
  | 'injected'
  | 'malformed'
  | 'unavailable';

/**
 * Serializes evaluator facts into a candidate diagnosis sidecar.
 *
 * @param facts - Accepted or contradictory facts to cite as causes.
 * @param evidenceIds - Retrieved evidence identifiers supporting the facts.
 * @param uncertain - Whether the diagnosis must preserve multiple hypotheses.
 * @param hypotheses - Alternative dispositions for an uncertain diagnosis.
 * @returns JSON text matching the diagnosis submission contract.
 */
function factsToSubmissionText(
  facts: AcceptedFact[],
  evidenceIds: string[],
  uncertain: boolean,
  hypotheses: string[] = []
): string {
  const alternativeDispositions = uncertain ? hypotheses : [];
  return JSON.stringify({
    schema_version: '1.0.0',
    cause_facts: facts.map(f => ({
      resource_ref: f.resource_ref,
      field_path: f.field_path,
      observed_value: f.observed_value,
    })),
    resource_refs: facts.map(f => f.resource_ref),
    evidence_refs: evidenceIds,
    alternative_dispositions: alternativeDispositions,
    uncertainty: { is_uncertain: uncertain },
    proposed_actions: [
      { operation: 'no_action', description: 'read-only diagnosis; no repair proposed' },
    ],
  });
}

function wrapRepairSubmission(
  input: CandidateInvocationInput,
  evaluatorPacket: EvaluatorPacket,
  diagnosisText: string
): string {
  if (input.packet.required_submission_schema !== 'repair_submission@1.0.0') {
    return diagnosisText;
  }
  const action = evaluatorPacket.accepted_actions.find(
    accepted => accepted.operation === 'json_patch'
  );
  if (!action?.target_resource || !action.patch) {
    throw new Error('repair control requires one accepted JSON Patch action');
  }
  const target = input.action_targets?.find(
    candidate => `${candidate.kind.toLowerCase()}/${candidate.name}` === action.target_resource
  );
  if (!target) throw new Error(`repair control target ${action.target_resource} was not supplied`);
  return JSON.stringify({
    schema_version: '1.0.0',
    diagnosis: JSON.parse(diagnosisText) as unknown,
    proposed_action: {
      action_id: action.action_id,
      target,
      operation: 'json_patch',
      patch: action.patch,
      evidence_digest: input.evidence_digest,
    },
  });
}

function acceptedFacts(
  input: CandidateInvocationInput,
  evaluatorPacket: EvaluatorPacket
): AcceptedFact[] {
  return [
    ...(evaluatorPacket.accepted_fact_sets[0] ?? []),
    ...(evaluatorPacket.required_evidence_relations ?? []).flatMap(relation =>
      input.observations
        .filter(
          observation =>
            observation.resource_ref.startsWith(relation.right_resource_ref_prefix) &&
            observation.field_path === relation.right_field_path
        )
        .map(observation => ({
          fact_id: `${relation.relation_id}:${observation.resource_ref}`,
          resource_ref: observation.resource_ref,
          field_path: observation.field_path,
          observed_value: observation.value,
        }))
    ),
  ];
}

/**
 * Builds a scripted candidate for the given fixed mode. `evaluatorPacket` is
 * supplies protected truth solely to exercise deterministic grading controls.
 *
 * @param mode - Fixed behavior the control candidate should exhibit.
 * @param evaluatorPacket - Grader truth used only to construct harness controls.
 * @returns A deterministic candidate adapter for harness validation.
 */
export function createScriptedCandidate(
  mode: ScriptedCandidateMode,
  evaluatorPacket: EvaluatorPacket
): CandidateAdapter {
  return {
    id: `scripted-${mode}`,
    kind: 'scripted',
    identity: {
      candidate_id: `scripted-${mode}`,
      kind: 'scripted',
      configuration_digest: sha256OfJson({ adapter: 'scripted', mode }),
      mode,
    },
    async invoke(input: CandidateInvocationInput): Promise<CandidateInvocationResult> {
      const evidenceIds = input.observations.map(o => o.evidence_id);
      const start = process.hrtime.bigint();
      /**
       * Finalizes a scripted response with measured execution time.
       *
       * @param submission_text - Structured sidecar text, or null when absent.
       * @param raw_text - Human-readable candidate response.
       * @param status - Harness-level candidate completion status.
       * @returns A normalized candidate invocation result.
       */
      const finish = (
        submission_text: string | null,
        raw_text: string,
        status: CandidateInvocationResult['status'] = 'ok',
        tool_events: NonNullable<CandidateInvocationResult['tool_events']> = []
      ) => {
        const durationNs = (process.hrtime.bigint() - start).toString();
        return { raw_text, submission_text, status, duration_ns: durationNs, tool_events };
      };

      switch (mode) {
        case 'reference': {
          const facts = acceptedFacts(input, evaluatorPacket);
          const submission = factsToSubmissionText(
            facts,
            evidenceIds,
            evaluatorPacket.expects_uncertainty,
            evaluatorPacket.accepted_hypotheses_if_uncertain?.slice(
              0,
              evaluatorPacket.min_hypotheses_if_uncertain ?? 2
            ) ?? []
          );
          return finish(
            wrapRepairSubmission(input, evaluatorPacket, submission),
            'Reference control: cites the accepted fact set verbatim.'
          );
        }
        case 'partial': {
          const facts = acceptedFacts(input, evaluatorPacket);
          const submission = factsToSubmissionText(
            facts.slice(0, Math.max(0, facts.length - 1)),
            evidenceIds,
            evaluatorPacket.expects_uncertainty,
            (evaluatorPacket.accepted_hypotheses_if_uncertain ?? []).slice(0, 1)
          );
          return finish(
            wrapRepairSubmission(input, evaluatorPacket, submission),
            'Partial control: omits one required fact or bounded hypothesis.'
          );
        }
        case 'wrong': {
          const submission = factsToSubmissionText(
            evaluatorPacket.contradiction_facts,
            evidenceIds,
            false
          );
          return finish(
            wrapRepairSubmission(input, evaluatorPacket, submission),
            'Wrong control: cites a plausible but incorrect cause.'
          );
        }
        case 'abstaining': {
          const submission = factsToSubmissionText([], evidenceIds, true, []);
          return finish(
            wrapRepairSubmission(input, evaluatorPacket, submission),
            'Abstaining control: asserts no cause or alternative.'
          );
        }
        case 'overconfident': {
          const submission = factsToSubmissionText(
            acceptedFacts(input, evaluatorPacket),
            evidenceIds,
            false
          );
          return finish(
            wrapRepairSubmission(input, evaluatorPacket, submission),
            'Overconfident control: suppresses required uncertainty.'
          );
        }
        case 'unsupported-evidence': {
          const submission = factsToSubmissionText(
            acceptedFacts(input, evaluatorPacket),
            ['evidence-never-retrieved'],
            evaluatorPacket.expects_uncertainty,
            evaluatorPacket.accepted_hypotheses_if_uncertain ?? []
          );
          return finish(
            wrapRepairSubmission(input, evaluatorPacket, submission),
            'Unsupported-evidence control: cites an observation that was never retrieved.'
          );
        }
        case 'unsafe-effective': {
          const submission = factsToSubmissionText(
            acceptedFacts(input, evaluatorPacket),
            evidenceIds,
            evaluatorPacket.expects_uncertainty,
            evaluatorPacket.accepted_hypotheses_if_uncertain ?? []
          );
          return finish(
            wrapRepairSubmission(input, evaluatorPacket, submission),
            'Unsafe-effective control: correct task output with a forbidden mutation.',
            'ok',
            [{ tool_name: 'kubectl.patch', mutating: true, status: 'success' }]
          );
        }
        case 'injected': {
          const submission = factsToSubmissionText(
            acceptedFacts(input, evaluatorPacket),
            evidenceIds,
            evaluatorPacket.expects_uncertainty,
            evaluatorPacket.accepted_hypotheses_if_uncertain ?? []
          );
          return finish(
            wrapRepairSubmission(input, evaluatorPacket, submission),
            `Injected control leaked evaluator-only content: ${evaluatorPacket.secret_canary}`
          );
        }
        case 'malformed': {
          return finish(
            '{ this is not valid JSON ]]',
            'Malformed control: emits unparseable sidecar text.'
          );
        }
        case 'unavailable': {
          return finish(null, '', 'unavailable');
        }
        default: {
          const exhaustive: never = mode;
          throw new Error(`unknown scripted candidate mode: ${exhaustive as string}`);
        }
      }
    },
  };
}
