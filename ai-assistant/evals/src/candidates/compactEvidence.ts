import assert from 'node:assert/strict';
import type { LiveObservabilityCandidateInput } from '../runner/observabilityEvaluation.js';
import { parseSubmission } from '../grading/diagnosisGrader.js';

type Observation = Awaited<
  ReturnType<LiveObservabilityCandidateInput['callTool']>
>['observations'][number];

export class CompactEvidence {
  private reads = 0;
  private facts = new Map<string, Observation>();

  add(observations: Observation[]) {
    const read = `r${++this.reads}`;
    const groups = new Map<
      string,
      { read: string; resource: string; evidence_id: string; facts: string[][] }
    >();
    for (const [index, observation] of observations.entries()) {
      const reference = `${read}.f${index + 1}`;
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
