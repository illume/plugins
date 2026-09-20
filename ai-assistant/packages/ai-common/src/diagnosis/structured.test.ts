import { describe, expect, it } from 'vitest';
import {
  createCompactDiagnosisProviderSchema,
  validateCompactDiagnosisSubmission,
} from './structured.ts';

describe('shared structured diagnosis', () => {
  it('expands compact output without adding semantic hypotheses', () => {
    const result = validateCompactDiagnosisSubmission(
      {
        alternative_dispositions: ['A taint may exclude the Pod'],
        uncertainty: { is_uncertain: true, reason: 'Only Pod phase was supplied.' },
        proposed_actions: [{ operation: 'no_action', description: 'Inspect scheduling evidence.' }],
      },
      [
        {
          evidence_id: 'pod-phase',
          resource_ref: 'pod/web',
          field_path: 'status.phase',
          observed_value: 'Pending',
        },
      ]
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.evidence_refs).toEqual(['pod-phase']);
    expect(result.data.alternative_dispositions).toEqual(['A taint may exclude the Pod']);
    expect(createCompactDiagnosisProviderSchema().required).toEqual([
      'alternative_dispositions',
      'uncertainty',
      'proposed_actions',
    ]);
  });

  it('rejects extra semantic fields before trusted evidence reconstruction', () => {
    expect(
      validateCompactDiagnosisSubmission(
        {
          alternative_dispositions: [],
          uncertainty: { is_uncertain: false, reason: '' },
          proposed_actions: [{ operation: 'no_action', description: 'Read only.' }],
          evidence_refs: ['invented'],
        },
        []
      ).success
    ).toBe(false);
  });
});
