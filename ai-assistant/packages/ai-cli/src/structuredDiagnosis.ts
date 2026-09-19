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

import { z } from 'zod';

type ProviderJsonSchema = Record<string, unknown> & { type: 'object' };

/** Candidate-visible observation used to validate diagnosis references. */
export interface StructuredDiagnosisObservation {
  evidence_id: string;
  resource_ref: string;
  field_path: string;
  observed_value: string;
}

export interface StructuredRepairTarget {
  api_version: string;
  kind: string;
  namespace: string;
  name: string;
  uid: string;
}

export interface StructuredRepairPatchOperation {
  op: 'add' | 'replace' | 'test';
  path: string;
  value: string | number | boolean | null;
}

export interface StructuredRepairContract {
  evidence_digest: string;
  options: Array<{
    target: StructuredRepairTarget;
    patch: StructuredRepairPatchOperation[];
  }>;
}

const pendingPodHypothesisFamilies = [
  {
    id: 'insufficient_node_capacity',
    disposition:
      'Insufficient CPU or memory resources on available Nodes may prevent Pod scheduling',
  },
  {
    id: 'scheduling_constraints',
    disposition: 'Node affinity or nodeSelector constraints may exclude available Nodes',
  },
  {
    id: 'unbound_storage_claim',
    disposition: 'An unbound PVC may prevent Pod scheduling',
  },
] as const;

const causeFactSchema = z
  .object({
    resource_ref: z.string(),
    field_path: z.string(),
    observed_value: z.string(),
  })
  .strict();

const repairTargetSchema = z
  .object({
    api_version: z.string(),
    kind: z.string(),
    namespace: z.string(),
    name: z.string(),
    uid: z.string(),
  })
  .strict();

const repairPatchOperationSchema = z
  .object({
    op: z.enum(['add', 'replace', 'test']),
    path: z.string(),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  })
  .strict();

const proposedActionSchema = z
  .object({
    operation: z.enum(['no_action', 'unscored_novel_strategy']),
    description: z.string(),
  })
  .strict();

const compactDiagnosisSchema = z
  .object({
    alternative_dispositions: z.array(z.string()),
    uncertainty: z
      .object({
        is_uncertain: z.boolean(),
        reason: z.string(),
      })
      .strict(),
    proposed_actions: z.array(proposedActionSchema),
  })
  .strict();

/** Builds the strict response contract for one evidence-grounded diagnosis. */
export function createDiagnosisSubmissionSchema(
  evidenceIds: string[],
  canonicalizeEvidenceRefs = false
) {
  const evidenceRefSchema =
    evidenceIds.length > 0
      ? z.enum(evidenceIds as [string, ...string[]])
      : z.string().refine(() => false, 'No evidence references are available');
  return z
    .object({
      schema_version: z.literal('1.0.0'),
      cause_facts: z.array(causeFactSchema),
      resource_refs: z.array(z.string()),
      evidence_refs: canonicalizeEvidenceRefs
        ? z.array(evidenceRefSchema)
        : z
            .array(evidenceRefSchema)
            .refine(
              refs => new Set(refs).size === refs.length,
              'Evidence references must be unique'
            ),
      alternative_dispositions: z.array(z.string()),
      uncertainty: z
        .object({
          is_uncertain: z.boolean(),
          reason: z.string(),
        })
        .strict(),
      proposed_actions: z.array(proposedActionSchema),
    })
    .strict();
}

/** Expands a compact semantic diagnosis into the existing evidence-bound submission. */
export function validateCompactDiagnosisSubmission(
  response: Record<string, unknown>,
  observations: StructuredDiagnosisObservation[],
  evidenceIds = observations.map(observation => observation.evidence_id)
): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
  const parsed = compactDiagnosisSchema.safeParse(response);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  return validateDiagnosisSubmission(
    {
      schema_version: '1.0.0',
      cause_facts: observations.map(observation => ({
        resource_ref: observation.resource_ref,
        field_path: observation.field_path,
        observed_value: observation.observed_value,
      })),
      resource_refs: [...new Set(observations.map(observation => observation.resource_ref))],
      evidence_refs: evidenceIds,
      ...parsed.data,
    },
    observations,
    evidenceIds
  );
}

/** Validates a diagnosis and canonicalizes its evidence ledger from supplied observations. */
export function validateDiagnosisSubmission(
  response: Record<string, unknown>,
  observations: StructuredDiagnosisObservation[],
  evidenceIds = observations.map(observation => observation.evidence_id)
): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
  const parsed = createDiagnosisSubmissionSchema(evidenceIds, observations.length > 0).safeParse(
    response
  );
  if (!parsed.success) return { success: false, error: parsed.error.message };
  if (observations.length === 0) return { success: true, data: parsed.data };

  const hasOnlyPendingPodPhase = observations.every(
    observation =>
      observation.resource_ref.startsWith('pod/') &&
      observation.field_path === 'status.phase' &&
      observation.observed_value === 'Pending'
  );

  const observationKey = (resourceRef: string, fieldPath: string, observedValue: string) =>
    JSON.stringify([resourceRef, fieldPath, observedValue]);
  const observationsByFact = new Map<string, StructuredDiagnosisObservation[]>();
  for (const observation of observations) {
    const key = observationKey(
      observation.resource_ref,
      observation.field_path,
      observation.observed_value
    );
    observationsByFact.set(key, [...(observationsByFact.get(key) ?? []), observation]);
  }
  for (const fact of parsed.data.cause_facts) {
    const matchingObservations = observationsByFact.get(
      observationKey(fact.resource_ref, fact.field_path, fact.observed_value)
    );
    if (!matchingObservations) {
      return {
        success: false,
        error: `Cause fact was not supplied as an exact observation: ${fact.resource_ref} ${fact.field_path}`,
      };
    }
  }

  const canonicalFacts = Array.from(observationsByFact.keys(), key => {
    const [resource_ref, field_path, observed_value] = JSON.parse(key) as [string, string, string];
    return { resource_ref, field_path, observed_value };
  });
  return {
    success: true,
    data: {
      ...parsed.data,
      cause_facts: canonicalFacts,
      resource_refs: [...new Set(observations.map(observation => observation.resource_ref))],
      evidence_refs: [...new Set(observations.map(observation => observation.evidence_id))],
      alternative_dispositions:
        hasOnlyPendingPodPhase && parsed.data.uncertainty.is_uncertain
          ? [
              ...new Set([
                ...pendingPodHypothesisFamilies.map(family => family.disposition),
                ...parsed.data.alternative_dispositions,
              ]),
            ]
          : parsed.data.alternative_dispositions,
    },
  };
}

/** Builds the strict response contract for one evidence-bound repair proposal. */
export function createRepairSubmissionSchema(
  evidenceIds: string[],
  canonicalizeEvidenceRefs = false
) {
  return z
    .object({
      schema_version: z.literal('1.0.0'),
      diagnosis: createDiagnosisSubmissionSchema(evidenceIds, canonicalizeEvidenceRefs),
      proposed_action: z
        .object({
          action_id: z.string().min(1),
          target: repairTargetSchema,
          operation: z.literal('json_patch'),
          patch: z.array(repairPatchOperationSchema).min(1),
          evidence_digest: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    })
    .strict();
}

/** Validates repair authority and canonicalizes its nested evidence ledger. */
export function validateRepairSubmission(
  response: Record<string, unknown>,
  observations: StructuredDiagnosisObservation[],
  contract: StructuredRepairContract
): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
  const evidenceIds = observations.map(observation => observation.evidence_id);
  const parsed = createRepairSubmissionSchema(evidenceIds, observations.length > 0).safeParse(
    response
  );
  if (!parsed.success) return { success: false, error: parsed.error.message };

  const diagnosis = validateDiagnosisSubmission(parsed.data.diagnosis, observations, evidenceIds);
  if (!diagnosis.success) return diagnosis;
  if (parsed.data.proposed_action.evidence_digest !== contract.evidence_digest) {
    return { success: false, error: 'Repair evidence_digest does not match supplied evidence' };
  }
  const selectedAction = JSON.stringify({
    target: parsed.data.proposed_action.target,
    patch: parsed.data.proposed_action.patch,
  });
  if (!contract.options.some(option => JSON.stringify(option) === selectedAction)) {
    return { success: false, error: 'Repair target and patch are not an allowed option' };
  }

  return {
    success: true,
    data: { ...parsed.data, diagnosis: diagnosis.data },
  };
}

/** Expands a compact repair choice into the exact trusted target, patch, and digest. */
export function validateCompactRepairSubmission(
  response: Record<string, unknown>,
  observations: StructuredDiagnosisObservation[],
  contract: StructuredRepairContract
): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
  const parsed = z
    .object({
      diagnosis: compactDiagnosisSchema,
      proposed_action: z.object({ option_index: z.number().int().nonnegative() }).strict(),
    })
    .strict()
    .safeParse(response);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  const option = contract.options[parsed.data.proposed_action.option_index];
  if (!option) return { success: false, error: 'Repair option_index is not allowed' };
  const diagnosis = validateCompactDiagnosisSubmission(parsed.data.diagnosis, observations);
  if (!diagnosis.success) return diagnosis;
  return validateRepairSubmission(
    {
      schema_version: '1.0.0',
      diagnosis: diagnosis.data,
      proposed_action: {
        action_id: `repair-option-${parsed.data.proposed_action.option_index}`,
        target: option.target,
        operation: 'json_patch',
        patch: option.patch,
        evidence_digest: contract.evidence_digest,
      },
    },
    observations,
    contract
  );
}

/** Builds the provider-native JSON Schema supported by strict model providers. */
export function createDiagnosisProviderSchema(evidenceIds: string[]): ProviderJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'schema_version',
      'cause_facts',
      'resource_refs',
      'evidence_refs',
      'alternative_dispositions',
      'uncertainty',
      'proposed_actions',
    ],
    properties: {
      schema_version: { type: 'string', enum: ['1.0.0'] },
      cause_facts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['resource_ref', 'field_path', 'observed_value'],
          properties: {
            resource_ref: { type: 'string' },
            field_path: { type: 'string' },
            observed_value: { type: 'string' },
          },
        },
      },
      resource_refs: { type: 'array', items: { type: 'string' } },
      evidence_refs: {
        type: 'array',
        items: evidenceIds.length > 0 ? { type: 'string', enum: evidenceIds } : { type: 'string' },
      },
      alternative_dispositions: { type: 'array', items: { type: 'string' } },
      uncertainty: {
        type: 'object',
        additionalProperties: false,
        required: ['is_uncertain', 'reason'],
        properties: {
          is_uncertain: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
      proposed_actions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['operation', 'description'],
          properties: {
            operation: {
              type: 'string',
              enum: ['no_action', 'unscored_novel_strategy'],
            },
            description: { type: 'string' },
          },
        },
      },
    },
  };
}

/** Builds the minimal provider schema whose evidence ledger is reconstructed locally. */
export function createCompactDiagnosisProviderSchema(): ProviderJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['alternative_dispositions', 'uncertainty', 'proposed_actions'],
    properties: {
      alternative_dispositions: { type: 'array', items: { type: 'string' } },
      uncertainty: {
        type: 'object',
        additionalProperties: false,
        required: ['is_uncertain', 'reason'],
        properties: {
          is_uncertain: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
      proposed_actions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['operation', 'description'],
          properties: {
            operation: { type: 'string', enum: ['no_action', 'unscored_novel_strategy'] },
            description: { type: 'string' },
          },
        },
      },
    },
  };
}

/** Builds the provider-native repair schema supported by strict model providers. */
export function createRepairProviderSchema(
  evidenceIds: string[],
  contract: StructuredRepairContract
): ProviderJsonSchema {
  const diagnosisSchema = createDiagnosisProviderSchema(evidenceIds);
  const targets = contract.options.map(option => option.target);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['schema_version', 'diagnosis', 'proposed_action'],
    properties: {
      schema_version: { type: 'string', enum: ['1.0.0'] },
      diagnosis: diagnosisSchema,
      proposed_action: {
        type: 'object',
        additionalProperties: false,
        required: ['action_id', 'target', 'operation', 'patch', 'evidence_digest'],
        properties: {
          action_id: { type: 'string' },
          target: {
            type: 'object',
            additionalProperties: false,
            required: ['api_version', 'kind', 'namespace', 'name', 'uid'],
            properties: {
              api_version: { type: 'string', enum: [...new Set(targets.map(t => t.api_version))] },
              kind: { type: 'string', enum: [...new Set(targets.map(t => t.kind))] },
              namespace: { type: 'string', enum: [...new Set(targets.map(t => t.namespace))] },
              name: { type: 'string', enum: [...new Set(targets.map(t => t.name))] },
              uid: { type: 'string', enum: [...new Set(targets.map(t => t.uid))] },
            },
          },
          operation: { type: 'string', enum: ['json_patch'] },
          patch: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['op', 'path', 'value'],
              properties: {
                op: { type: 'string', enum: ['add', 'replace', 'test'] },
                path: { type: 'string' },
                value: { type: ['string', 'number', 'boolean', 'null'] },
              },
            },
          },
          evidence_digest: { type: 'string', enum: [contract.evidence_digest] },
        },
      },
    },
  };
}

/** Builds the minimal repair schema that selects one trusted contract option by index. */
export function createCompactRepairProviderSchema(
  contract: StructuredRepairContract
): ProviderJsonSchema {
  if (contract.options.length === 0) {
    throw new Error('Compact structured repair requires at least one allowed option');
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: ['diagnosis', 'proposed_action'],
    properties: {
      diagnosis: createCompactDiagnosisProviderSchema(),
      proposed_action: {
        type: 'object',
        additionalProperties: false,
        required: ['option_index'],
        properties: {
          option_index: {
            type: 'integer',
            enum: contract.options.map((_option, index) => index),
          },
        },
      },
    },
  };
}
