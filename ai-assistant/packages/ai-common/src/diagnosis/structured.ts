import { z } from 'zod';

export type ProviderJsonSchema = Record<string, unknown> & { type: 'object' };

/** Candidate-visible observation used to validate diagnosis references. */
export interface StructuredDiagnosisObservation {
  evidence_id: string;
  resource_ref: string;
  field_path: string;
  observed_value: string;
}

export const SUPPLIED_EVIDENCE_CONTEXT =
  'Supplied-evidence mode is active. Treat observations in the user request as the complete authorized evidence for this turn. Do not call tools. Produce the strongest supported answer from those observations, preserve explicit access or tool failures as evidence, and state uncertainty when the observations are insufficient.';

export const COMPACT_DIAGNOSIS_INSTRUCTION =
  '\n\nUse the native response schema to return only the semantic diagnosis fields: ' +
  'alternative_dispositions, uncertainty, and proposed_actions. Do not repeat evidence IDs, resource ' +
  'references, or observed facts; the trusted evidence ledger is reconstructed locally. Return exactly one ' +
  'proposed action with operation "no_action". If the evidence cannot determine one cause, set is_uncertain ' +
  'true and list distinct, independently testable mechanisms as separate concise alternatives.';

const proposedActionSchema = z
  .object({
    operation: z.enum(['no_action', 'unscored_novel_strategy']),
    description: z.string(),
  })
  .strict();

export const compactDiagnosisResponseSchema = z
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

/** Builds the compact provider schema shared by browser and CLI diagnosis. */
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

/** Expands and validates compact semantics against the exact supplied observations. */
export function validateCompactDiagnosisSubmission(
  response: Record<string, unknown>,
  observations: StructuredDiagnosisObservation[],
  evidenceIds = observations.map(observation => observation.evidence_id)
): { success: true; data: Record<string, unknown> } | { success: false; error: string } {
  const parsed = compactDiagnosisResponseSchema.safeParse(response);
  if (!parsed.success) return { success: false, error: parsed.error.message };
  return {
    success: true,
    data: {
      schema_version: '1.0.0',
      cause_facts: observations.map(observation => ({
        resource_ref: observation.resource_ref,
        field_path: observation.field_path,
        observed_value: observation.observed_value,
      })),
      resource_refs: [...new Set(observations.map(observation => observation.resource_ref))],
      evidence_refs: [...new Set(evidenceIds)],
      ...parsed.data,
    },
  };
}
