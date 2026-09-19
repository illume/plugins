import assert from 'node:assert/strict';
import type { LiveObservabilityCandidateInput } from '../runner/observabilityEvaluation.js';
import { parseSubmission } from '../grading/diagnosisGrader.js';

type Observation = Awaited<
  ReturnType<LiveObservabilityCandidateInput['callTool']>
>['observations'][number];

export type FactReferenceStyle = 'numeric' | 'field-labelled';
export type EvidenceGrouping = 'read' | 'object';
export type EvidenceLayout = 'rows' | 'fields';
export type SelectionContract = 'facts' | 'claims';

export function objectFieldEvidence(evidence: ReturnType<CompactEvidence['add']>) {
  return {
    columns: ['reference', 'observed_value'],
    records: evidence.records.map(({ facts, ...record }) => {
      assert.equal(typeof record.object_path, 'string', 'Field layout requires object grouping');
      const prefix = record.object_path!;
      const fields = new Map<string, string[][]>();
      for (const [reference, pointer, value] of facts) {
        assert.ok(reference !== undefined && pointer !== undefined && value !== undefined);
        assert.ok(
          pointer === prefix || pointer.startsWith(`${prefix}/`),
          'Field path must belong to its object'
        );
        const relativePath = pointer.slice(prefix.length);
        const entries = fields.get(relativePath) ?? [];
        entries.push([reference, value]);
        fields.set(relativePath, entries);
      }
      return { ...record, fields: Object.fromEntries(fields) };
    }),
  };
}

function objectPath(pointer: string): string {
  const rule = pointer.match(/^\/value\/\d+\/effectiveSecurityRules\/\d+(?=\/|$)/);
  const resource = pointer.match(/^\/(?:value|(?:pods|events|nodes)\/items)\/\d+(?=\/|$)/);
  return rule?.[0] ?? resource?.[0] ?? '';
}

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

export const CLAIM_SELECTION_SCHEMA = {
  type: 'object',
  properties: {
    schema_version: { type: 'string', enum: ['claim_selection@1.0.0'] },
    disposition: { type: 'string', enum: ['cause', 'healthy', 'insufficient'] },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          identity_ref: { type: 'string' },
          fact_refs: { type: 'array', items: { type: 'string' } },
        },
        required: ['identity_ref', 'fact_refs'],
        additionalProperties: false,
      },
    },
    alternative_dispositions: FACT_SELECTION_SCHEMA.properties.alternative_dispositions,
    proposed_actions: FACT_SELECTION_SCHEMA.properties.proposed_actions,
  },
  required: [
    'schema_version',
    'disposition',
    'claims',
    'alternative_dispositions',
    'proposed_actions',
  ],
  additionalProperties: false,
};

export class CompactEvidence {
  private reads = 0;
  private facts = new Map<string, Observation>();
  private factGroups = new Map<string, string>();

  constructor(
    private readonly referenceStyle: FactReferenceStyle = 'numeric',
    private readonly grouping: EvidenceGrouping = 'read'
  ) {}

  add(observations: Observation[]) {
    const read = `r${++this.reads}`;
    const groups = new Map<
      string,
      {
        read: string;
        resource: string;
        evidence_id: string;
        object_path?: string;
        facts: string[][];
      }
    >();
    for (const [index, observation] of observations.entries()) {
      const field = observation.field_path.split('/').at(-1) ?? '';
      const label = encodeURIComponent(field.replaceAll('~1', '/').replaceAll('~0', '~'));
      const reference = `${read}.f${index + 1}${
        this.referenceStyle === 'field-labelled' ? `.${label || 'root'}` : ''
      }`;
      this.facts.set(reference, structuredClone(observation));
      const pointer = this.grouping === 'object' ? objectPath(observation.field_path) : '';
      const key = JSON.stringify([observation.evidence_id, observation.resource_ref, pointer]);
      this.factGroups.set(reference, `${read}:${key}`);
      let group = groups.get(key);
      if (!group) {
        group = {
          read,
          resource: observation.resource_ref,
          evidence_id: observation.evidence_id,
          ...(this.grouping === 'object' ? { object_path: pointer } : {}),
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

  resolveClaims(text: string): string {
    assert.equal(this.grouping, 'object', 'Claims require object grouping');
    const selected: unknown = JSON.parse(text);
    assert.ok(selected && typeof selected === 'object' && !Array.isArray(selected));
    const value = selected as Record<string, unknown>;
    assert.deepEqual(Object.keys(value).sort(), [...CLAIM_SELECTION_SCHEMA.required].sort());
    assert.equal(value.schema_version, 'claim_selection@1.0.0');
    assert.ok(['cause', 'healthy', 'insufficient'].includes(String(value.disposition)));
    assert.ok(Array.isArray(value.claims));
    assert.equal(
      value.claims.length > 0,
      value.disposition === 'cause',
      'Cause requires claims; healthy and insufficient require no claims'
    );
    const references: string[] = [];
    for (const claim of value.claims) {
      assert.ok(claim && typeof claim === 'object' && !Array.isArray(claim));
      assert.deepEqual(Object.keys(claim).sort(), ['fact_refs', 'identity_ref']);
      assert.equal(typeof claim.identity_ref, 'string');
      const identity = this.facts.get(claim.identity_ref);
      assert.ok(identity, 'Claim identity was not retrieved in this session');
      const relativePath = identity.field_path.slice(objectPath(identity.field_path).length);
      assert.ok(
        ['/name', '/id', '/metadata/name', '/metadata/uid'].includes(relativePath),
        'Claim identity must reference an observed object name or ID'
      );
      assert.ok(Array.isArray(claim.fact_refs) && claim.fact_refs.length > 0);
      references.push(claim.identity_ref);
      for (const reference of claim.fact_refs) {
        assert.equal(typeof reference, 'string');
        assert.ok(this.facts.has(reference), 'Claim fact was not retrieved in this session');
        assert.equal(
          this.factGroups.get(reference),
          this.factGroups.get(claim.identity_ref),
          'Claim facts must belong to the same read, resource, evidence, and object as identity'
        );
        references.push(reference);
      }
    }
    return this.resolve(
      JSON.stringify({
        schema_version: 'fact_selection@1.0.0',
        fact_refs: references,
        alternative_dispositions: value.alternative_dispositions,
        uncertainty: { is_uncertain: value.disposition === 'insufficient' },
        proposed_actions: value.proposed_actions,
      })
    );
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
