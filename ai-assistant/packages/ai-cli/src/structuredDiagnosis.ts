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

const causeFactSchema = z
  .object({
    resource_ref: z.string(),
    field_path: z.string(),
    observed_value: z.string(),
  })
  .strict();

/** Builds the strict response contract for one evidence-grounded diagnosis. */
export function createDiagnosisSubmissionSchema(evidenceIds: string[]) {
  const evidenceRefSchema =
    evidenceIds.length > 0
      ? z.enum(evidenceIds as [string, ...string[]])
      : z.string().refine(() => false, 'No evidence references are available');
  return z
    .object({
      schema_version: z.literal('1.0.0'),
      cause_facts: z.array(causeFactSchema),
      resource_refs: z.array(z.string()),
      evidence_refs: z
        .array(evidenceRefSchema)
        .refine(refs => new Set(refs).size === refs.length, 'Evidence references must be unique'),
      alternative_dispositions: z.array(z.string()),
      uncertainty: z
        .object({
          is_uncertain: z.boolean(),
          reason: z.string(),
        })
        .strict(),
      proposed_actions: z.array(
        z
          .object({
            operation: z.enum(['no_action', 'unscored_novel_strategy']),
            description: z.string(),
          })
          .strict()
      ),
    })
    .strict();
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
