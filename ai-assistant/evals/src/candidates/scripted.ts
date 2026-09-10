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
 * Unlike a real candidate, `reference` and `wrong` are allowed to read
 * `EvaluatorPacket` truth: their entire purpose is to prove the deterministic
 * grader assigns `pass`/`fail` correctly, so they must be able to construct
 * an exactly-correct or exactly-wrong submission.
 */

import type { AcceptedFact, EvaluatorPacket } from '../contracts/evaluationContracts.js';
import type {
  CandidateAdapter,
  CandidateInvocationInput,
  CandidateInvocationResult,
} from './candidateAdapter.js';
import { sha256OfJson } from '../canonicalJson.js';

/** Fixed behavior used by a deterministic harness-control candidate. */
export type ScriptedCandidateMode = 'reference' | 'wrong' | 'malformed' | 'unavailable';

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

/**
 * Builds a scripted candidate for the given fixed mode. `evaluatorPacket` is
 * required only for `reference`/`wrong`, whose job is to exercise the
 * deterministic grader against known-correct or known-incorrect truth.
 *
 * @param mode - Fixed behavior the control candidate should exhibit.
 * @param evaluatorPacket - Grader truth used to construct reference and wrong answers.
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
        status: CandidateInvocationResult['status'] = 'ok'
      ) => {
        const durationNs = (process.hrtime.bigint() - start).toString();
        return { raw_text, submission_text, status, duration_ns: durationNs, tool_events: [] };
      };

      switch (mode) {
        case 'reference': {
          const facts = [
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
          const submission = factsToSubmissionText(
            facts,
            evidenceIds,
            evaluatorPacket.expects_uncertainty,
            evaluatorPacket.accepted_hypotheses_if_uncertain?.slice(
              0,
              evaluatorPacket.min_hypotheses_if_uncertain ?? 2
            ) ?? []
          );
          return finish(submission, 'Reference control: cites the accepted fact set verbatim.');
        }
        case 'wrong': {
          const submission = factsToSubmissionText(
            evaluatorPacket.contradiction_facts,
            evidenceIds,
            false
          );
          return finish(submission, 'Wrong control: cites a plausible but incorrect cause.');
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
