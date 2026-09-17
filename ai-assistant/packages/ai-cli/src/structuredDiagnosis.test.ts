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

import { describe, expect, it } from 'vitest';
import {
  createDiagnosisProviderSchema,
  createDiagnosisSubmissionSchema,
  validateDiagnosisSubmission,
} from './structuredDiagnosis.js';

const submission = {
  schema_version: '1.0.0' as const,
  cause_facts: [
    {
      resource_ref: 'service/web',
      field_path: 'spec.selector',
      observed_value: '{"app":"web"}',
    },
  ],
  resource_refs: ['service/web'],
  evidence_refs: ['evidence-1'],
  alternative_dispositions: [],
  uncertainty: { is_uncertain: false, reason: 'The supplied evidence is decisive.' },
  proposed_actions: [{ operation: 'no_action' as const, description: 'No change required.' }],
};

describe('createDiagnosisSubmissionSchema', () => {
  it('accepts exact evidence references', () => {
    expect(createDiagnosisSubmissionSchema(['evidence-1']).safeParse(submission).success).toBe(
      true
    );
  });

  it('rejects a reconstructed or malformed evidence reference', () => {
    const result = createDiagnosisSubmissionSchema(['evidence-1']).safeParse({
      ...submission,
      evidence_refs: ['evidence-2'],
    });

    expect(result.success).toBe(false);
  });

  it('rejects additional response properties', () => {
    const result = createDiagnosisSubmissionSchema(['evidence-1']).safeParse({
      ...submission,
      unexpected: true,
    });

    expect(result.success).toBe(false);
  });

  it('requires exact evidence IDs in the provider schema', () => {
    const schema = createDiagnosisProviderSchema(['evidence-1', 'evidence-2']);
    const properties = schema.properties as Record<string, unknown>;
    const evidenceRefs = properties.evidence_refs as {
      items?: { enum?: string[] };
    };

    expect(evidenceRefs.items?.enum).toEqual(['evidence-1', 'evidence-2']);
  });

  it('does not emit a provider-invalid empty enum when no evidence is available', () => {
    const schema = createDiagnosisProviderSchema([]);
    const properties = schema.properties as Record<string, unknown>;
    const evidenceRefs = properties.evidence_refs as {
      items?: { enum?: string[] };
    };

    expect(evidenceRefs.items?.enum).toBeUndefined();
    expect(
      createDiagnosisSubmissionSchema([]).safeParse({ ...submission, evidence_refs: [] }).success
    ).toBe(true);
    expect(createDiagnosisSubmissionSchema([]).safeParse(submission).success).toBe(false);
  });

  it('rejects duplicate evidence references during external validation', () => {
    const result = createDiagnosisSubmissionSchema(['evidence-1']).safeParse({
      ...submission,
      evidence_refs: ['evidence-1', 'evidence-1'],
    });

    expect(result.success).toBe(false);
  });

  it('canonicalizes omitted facts and references from supplied observations', () => {
    const observations = [
      {
        evidence_id: 'deployment-evidence',
        resource_ref: 'deployment/web',
        field_path: 'status.availableReplicas',
        observed_value: '1',
      },
      {
        evidence_id: 'event-evidence',
        resource_ref: 'event/web-old-failure',
        field_path: 'eventTime',
        observed_value: '2025-01-01T00:00:00.000000Z',
      },
    ];
    const result = validateDiagnosisSubmission(
      {
        ...submission,
        cause_facts: [
          {
            resource_ref: 'deployment/web',
            field_path: 'status.availableReplicas',
            observed_value: '1',
          },
        ],
        resource_refs: ['deployment/web'],
        evidence_refs: ['deployment-evidence'],
      },
      observations
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.cause_facts).toEqual([
      {
        resource_ref: 'deployment/web',
        field_path: 'status.availableReplicas',
        observed_value: '1',
      },
      {
        resource_ref: 'event/web-old-failure',
        field_path: 'eventTime',
        observed_value: '2025-01-01T00:00:00.000000Z',
      },
    ]);
    expect(result.data.resource_refs).toEqual(['deployment/web', 'event/web-old-failure']);
    expect(result.data.evidence_refs).toEqual(['deployment-evidence', 'event-evidence']);
  });

  it('accepts exact coverage of all supplied observations', () => {
    const observations = [
      {
        evidence_id: 'deployment-evidence',
        resource_ref: 'deployment/web',
        field_path: 'status.availableReplicas',
        observed_value: '1',
      },
      {
        evidence_id: 'event-evidence',
        resource_ref: 'event/web-old-failure',
        field_path: 'eventTime',
        observed_value: '2025-01-01T00:00:00.000000Z',
      },
    ];
    const result = validateDiagnosisSubmission(
      {
        ...submission,
        cause_facts: observations.map(observation => ({
          resource_ref: observation.resource_ref,
          field_path: observation.field_path,
          observed_value: observation.observed_value,
        })),
        resource_refs: ['deployment/web', 'event/web-old-failure'],
        evidence_refs: ['deployment-evidence', 'event-evidence'],
      },
      observations
    );

    expect(result.success).toBe(true);
  });

  it('preserves exact-ID validation when no observation ledger is supplied', () => {
    const result = validateDiagnosisSubmission(submission, [], ['evidence-1', 'evidence-2']);

    expect(result).toEqual({ success: true, data: submission });
  });
});
