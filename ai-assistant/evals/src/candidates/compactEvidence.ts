import assert from 'node:assert/strict';
import type { LiveObservabilityCandidateInput } from '../runner/observabilityEvaluation.js';
import { parseSubmission } from '../grading/diagnosisGrader.js';

type Observation = Awaited<
  ReturnType<LiveObservabilityCandidateInput['callTool']>
>['observations'][number];

export type FactReferenceStyle = 'numeric' | 'field-labelled';

export const FACT_SELECTION_SCHEMA = {
  type: 'object',
  properties: {
    schema_version: { type: 'string', enum: ['fact_selection@1.0.0'] },
    fact_refs: { type: 'array', items: { type: 'string' } },
    alternative_dispositions: { type: 'array', items: { type: 'string' } },
    uncertainty: {
      type: 'object',
      properties: { is_uncertain: { type: 'boolean' } },
      required: ['is_uncertain'],
      additionalProperties: false,
    },
    proposed_actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          operation: { type: 'string', enum: ['no_action', 'unscored_novel_strategy'] },
          description: { type: 'string' },
        },
        required: ['operation', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: [
    'schema_version',
    'fact_refs',
    'alternative_dispositions',
    'uncertainty',
    'proposed_actions',
  ],
  additionalProperties: false,
};

export class CompactEvidence {
  private reads = 0;
  private facts = new Map<string, Observation>();

  constructor(private readonly referenceStyle: FactReferenceStyle = 'numeric') {}

  add(observations: Observation[]) {
    const read = `r${++this.reads}`;
    const groups = new Map<
      string,
      { read: string; resource: string; evidence_id: string; facts: string[][] }
    >();
    for (const [index, observation] of observations.entries()) {
      const field = observation.field_path.split('/').at(-1) ?? '';
      const label = encodeURIComponent(field.replaceAll('~1', '/').replaceAll('~0', '~'));
      const reference = `${read}.f${index + 1}${
        this.referenceStyle === 'field-labelled' ? `.${label || 'root'}` : ''
      }`;
      this.facts.set(reference, structuredClone(observation));
      const key = JSON.stringify([observation.evidence_id, observation.resource_ref]);
      let group = groups.get(key);
      if (!group) {
        group = {
          read,
          resource: observation.resource_ref,
          evidence_id: observation.evidence_id,
          facts: [],
        };
        groups.set(key, group);
      }
      group.facts.push([reference, observation.field_path, observation.value]);
    }
    return {
      columns: ['reference', 'field_path', 'observed_value'],
      records: [...groups.values()],
    };
  }

  resolve(text: string): string {
    const selected: unknown = JSON.parse(text);
    assert.ok(selected && typeof selected === 'object' && !Array.isArray(selected));
    const value = selected as Record<string, unknown>;
    assert.deepEqual(
      Object.keys(value).sort(),
      [
        'alternative_dispositions',
        'fact_refs',
        'proposed_actions',
        'schema_version',
        'uncertainty',
      ].sort(),
      'Unexpected fact-selection fields'
    );
    assert.equal(value.schema_version, 'fact_selection@1.0.0');
    assert.ok(Array.isArray(value.fact_refs));
    assert.equal(
      new Set(value.fact_refs).size,
      value.fact_refs.length,
      'Duplicate fact references'
    );
    const facts = value.fact_refs.map(reference => {
      assert.equal(typeof reference, 'string');
      const fact = this.facts.get(reference);
      assert.ok(fact, 'Fact reference was not retrieved in this session');
      return fact;
    });
    const resolved = JSON.stringify({
      schema_version: '1.0.0',
      cause_facts: facts.map(fact => ({
        resource_ref: fact.resource_ref,
        field_path: fact.field_path,
        observed_value: fact.value,
      })),
      resource_refs: [...new Set(facts.map(fact => fact.resource_ref))],
      evidence_refs: [...new Set(facts.map(fact => fact.evidence_id))],
      alternative_dispositions: value.alternative_dispositions,
      uncertainty: value.uncertainty,
      proposed_actions: value.proposed_actions,
    });
    assert.equal(parseSubmission(resolved).status, 'valid', 'Invalid fact-selection submission');
    return resolved;
  }
}
