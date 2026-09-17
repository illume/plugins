import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHeadlampObservabilityCandidate,
  emptyContainers,
  observabilityPrompt,
  type HeadlampObservabilityOptions,
} from './headlampObservability.js';
import type { LiveObservabilityCandidateInput } from '../runner/observabilityEvaluation.js';
import { CompactEvidence } from './compactEvidence.js';
import { FACT_SELECTION_SCHEMA } from './compactEvidence.js';
import { assertValid } from '../contracts/validate.js';
import { gradeObservabilitySelection } from '../grading/observabilitySelection.js';
import { gradeRootCause, parseSubmission } from '../grading/diagnosisGrader.js';

test('compact evidence preserves all facts and resolves only explicit selections', () => {
  const evidence = new CompactEvidence();
  const observations = [
    {
      evidence_id: 'first-read',
      resource_ref: 'tool/azure_cost_capacity_read',
      field_path: '/value/0/name',
      value: 'target',
    },
    {
      evidence_id: 'first-read',
      resource_ref: 'tool/azure_cost_capacity_read',
      field_path: '/value/0/properties/maxCount',
      value: '1',
    },
  ];
  const compact = evidence.add(observations);
  assert.equal(compact.records[0]?.facts.length, 2);
  assert.deepEqual(compact.records[0]?.facts[1], ['r1.f2', '/value/0/properties/maxCount', '1']);
  observations[1]!.value = 'tampered';
  const selection = {
    schema_version: 'fact_selection@1.0.0',
    fact_refs: ['r1.f2'],
    alternative_dispositions: [],
    uncertainty: { is_uncertain: false },
    proposed_actions: [{ operation: 'no_action', description: 'Read only' }],
  };
  const resolved = JSON.parse(evidence.resolve(JSON.stringify(selection)));
  assert.deepEqual(resolved.cause_facts, [
    {
      resource_ref: 'tool/azure_cost_capacity_read',
      field_path: '/value/0/properties/maxCount',
      observed_value: '1',
    },
  ]);
  assert.deepEqual(resolved.evidence_refs, ['first-read']);
  assert.throws(() => evidence.resolve(JSON.stringify({ ...selection, fact_refs: ['r9.f2'] })));
  assert.throws(() =>
    evidence.resolve(JSON.stringify({ ...selection, fact_refs: ['r1.f2', 'r1.f2'] }))
  );
  assert.throws(() => new CompactEvidence().resolve(JSON.stringify(selection)));
  const second = evidence.add([
    { ...observations[0]!, evidence_id: 'second-read', value: 'different-pool' },
  ]);
  assert.equal(second.records[0]?.facts[0]?.[0], 'r2.f1');
  assert.equal(
    JSON.parse(evidence.resolve(JSON.stringify({ ...selection, fact_refs: ['r1.f1'] })))
      .cause_facts[0].observed_value,
    'target'
  );
});

const input: LiveObservabilityCandidateInput = {
  task: 'Investigate the AKS incident.',
  clusterId: 'aks-test',
  resourceId: 'resource-test',
  enabledTools: ['kubernetes_api_request'],
  readRequests: [
    { tool: 'kubernetes_api_request', args: { method: 'GET', path: '/eval/observed-kubernetes' } },
    {
      tool: 'azure_cost_capacity_read',
      args: { action: 'node_pools', clusterResourceId: 'aks-test' },
    },
  ],
  signal: new AbortController().signal,
  callTool: async () => {
    throw new Error('Unexpected tool call');
  },
};

test('Headlamp candidate prompt exposes only enabled reads and no evaluator truth', () => {
  const prompt = observabilityPrompt(input);
  assert.ok(prompt.includes('kubernetes_api_request'));
  assert.ok(!prompt.includes('azure_cost_capacity_read'));
  assert.ok(prompt.includes('cause_facts'));
  assert.ok(!prompt.includes('maxCount'));
});

test('field-labelled references distinguish adjacent equal-valued fields without changing facts', () => {
  const registry = new CompactEvidence('field-labelled');
  const observations = ['maxCount', 'minCount'].map(name => ({
    evidence_id: 'read',
    resource_ref: 'pool',
    field_path: `/properties/${name}`,
    value: '1',
  }));
  const view = registry.add(observations);
  assert.deepEqual(
    view.records[0]?.facts.map(row => row[0]),
    ['r1.f1.maxCount', 'r1.f2.minCount']
  );
  const resolve = (reference: string) =>
    JSON.parse(
      registry.resolve(
        JSON.stringify({
          schema_version: 'fact_selection@1.0.0',
          fact_refs: [reference],
          alternative_dispositions: [],
          uncertainty: { is_uncertain: false },
          proposed_actions: [{ operation: 'no_action', description: 'Read only' }],
        })
      )
    );
  assert.equal(resolve('r1.f1.maxCount').cause_facts[0].field_path, '/properties/maxCount');
  assert.equal(resolve('r1.f2.minCount').cause_facts[0].field_path, '/properties/minCount');
  assert.throws(() => resolve('r1.f2.maxCount'));
  const later = registry.add([{ ...observations[0]!, value: '2' }]);
  assert.equal(later.records[0]?.facts[0]?.[0], 'r2.f1.maxCount');
  assert.equal(resolve('r1.f1.maxCount').cause_facts[0].observed_value, '1');
  assert.equal(resolve('r2.f1.maxCount').cause_facts[0].observed_value, '2');
});

test('the shared selection schema is valid and shown in both reference arms', () => {
  assertValid(
    FACT_SELECTION_SCHEMA,
    {
      schema_version: 'fact_selection@1.0.0',
      fact_refs: [],
      alternative_dispositions: [],
      uncertainty: { is_uncertain: true },
      proposed_actions: [{ operation: 'no_action', description: 'Insufficient evidence' }],
    },
    'selection'
  );
  assert.ok(
    observabilityPrompt(input, 'compact-select').includes(JSON.stringify(FACT_SELECTION_SCHEMA))
  );
  assert.throws(() => assertValid(FACT_SELECTION_SCHEMA, { fact_refs: [] }, 'invalid selection'));
});

test('strict final output rejects unsupported configurations before model creation', async () => {
  await assert.rejects(
    createHeadlampObservabilityCandidate({
      provider: 'azure',
      config: {},
      evidenceMode: 'compact',
      strictFinalOutput: true,
    }),
    /compact-select/
  );
  await assert.rejects(
    createHeadlampObservabilityCandidate({
      provider: 'local',
      config: {},
      evidenceMode: 'compact-select',
      strictFinalOutput: true,
    }),
    /supported/
  );
});

for (const referenceStyle of ['numeric', 'field-labelled'] as const) {
  test(`default strict selection reaches the Azure final request with ${referenceStyle} references`, async context => {
    const requests: Array<Record<string, any>> = [];
    context.mock.method(
      globalThis,
      'fetch',
      async (request: Request | string | URL, init?: RequestInit) => {
        const body = request instanceof Request ? await request.text() : String(init?.body);
        requests.push(JSON.parse(body));
        assert.ok(requests.length <= 2, 'Unexpected retry or extra model invocation');
        const planning = requests.length === 1;
        return Response.json({
          id: `offline-${requests.length}`,
          object: 'chat.completion',
          created: 0,
          model: 'gpt-4o-2024-11-20',
          choices: [
            {
              index: 0,
              finish_reason: planning ? 'tool_calls' : 'stop',
              message: planning
                ? {
                    role: 'assistant',
                    content: '',
                    tool_calls: [
                      {
                        id: 'call1',
                        type: 'function',
                        function: {
                          name: 'kubernetes_api_request',
                          arguments: JSON.stringify({
                            method: 'GET',
                            path: '/eval/observed-kubernetes',
                          }),
                        },
                      },
                    ],
                  }
                : {
                    role: 'assistant',
                    content: JSON.stringify({
                      schema_version: 'fact_selection@1.0.0',
                      fact_refs: [referenceStyle === 'numeric' ? 'r1.f1' : 'r1.f1.cpu'],
                      alternative_dispositions: [],
                      uncertainty: { is_uncertain: false },
                      proposed_actions: [{ operation: 'no_action', description: 'Read only' }],
                    }),
                  },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        });
      }
    );
    const candidate = await createHeadlampObservabilityCandidate({
      provider: 'azure',
      config: {
        model: 'gpt-4o',
        endpoint: 'https://offline.invalid',
        deploymentName: 'gpt-4o',
        apiKey: 'offline-not-secret',
      },
      ...(referenceStyle === 'field-labelled' ? { referenceStyle } : {}),
    });
    const result = await candidate({
      ...input,
      callTool: async (name, args) => {
        assert.equal(name, 'kubernetes_api_request');
        assert.deepEqual(args, { method: 'GET', path: '/eval/observed-kubernetes' });
        return {
          data: { cpu: '100m' },
          observations: [
            {
              evidence_id: 'read1',
              resource_ref: 'tool/kubernetes_api_request',
              field_path: '/cpu',
              value: '100m',
            },
          ],
        };
      },
    });
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.response_format, undefined);
    assert.ok(requests[0]?.tools.length);
    assert.equal(requests[1]?.response_format.type, 'json_schema');
    assert.equal(requests[1]?.response_format.json_schema.strict, true);
    assert.equal(requests[1]?.tools, undefined);
    assert.deepEqual(parseSubmission(result).submission?.cause_facts, [
      { resource_ref: 'tool/kubernetes_api_request', field_path: '/cpu', observed_value: '100m' },
    ]);
  });
}

test('selection controls reject the echo-all shortcut without changing the legacy grader', () => {
  const observations = Array.from({ length: 20 }, (_, index) => ({
    evidence_id: 'read',
    resource_ref: 'tool/read',
    field_path: `/field/${index}`,
    value: String(index),
  }));
  const cause_facts = observations.map(fact => ({
    resource_ref: fact.resource_ref,
    field_path: fact.field_path,
    observed_value: fact.value,
  }));
  const required = [{ ...cause_facts[0]!, fact_id: 'required' }];
  const submission = parseSubmission(
    JSON.stringify({
      schema_version: '1.0.0',
      cause_facts,
      resource_refs: ['tool/read'],
      evidence_refs: ['read'],
      alternative_dispositions: [],
      uncertainty: { is_uncertain: false },
      proposed_actions: [{ operation: 'no_action', description: 'Read only' }],
    })
  ).submission;
  assert.ok(submission);
  assert.equal(
    gradeRootCause({
      submission,
      retrievedObservations: observations,
      graderResultId: 'legacy-control',
      evaluatorPacket: {
        schema_version: '1.0.0',
        scenario_id: 'control',
        scenario_version: '1.0.0',
        accepted_fact_sets: [required],
        accepted_actions: [],
        contradiction_facts: [],
        expects_uncertainty: false,
        secret_canary: 'not-a-secret',
      },
    }).outcome,
    'pass'
  );
  const echo = gradeObservabilitySelection(submission, observations, required);
  assert.equal(echo.echoAll, true);
  assert.equal(echo.passesControls, false);
  const selective = { ...submission, cause_facts: [cause_facts[0]!] };
  assert.equal(gradeObservabilitySelection(selective, observations, required).passesControls, true);
  const forged = { ...selective, cause_facts: [{ ...cause_facts[0]!, field_path: '/invented' }] };
  assert.equal(gradeObservabilitySelection(forged, observations, required).unsupportedFacts, 1);
  assert.equal(
    gradeObservabilitySelection(
      selective,
      observations.map(fact => ({ ...fact, evidence_id: 'new-read' })),
      required
    ).passesControls,
    false
  );
  assert.equal(
    gradeObservabilitySelection(
      { ...selective, cause_facts: [cause_facts[0]!, cause_facts[0]!] },
      observations,
      required
    ).passesControls,
    false
  );
});

test('compact modes use their explicit input and output contracts', () => {
  assert.equal(observabilityPrompt(input), observabilityPrompt(input, 'compact'));
  assert.ok(!observabilityPrompt(input).includes('fact_selection@1.0.0'));
  assert.ok(observabilityPrompt(input, 'full').includes('Each tool returns observations'));
  assert.ok(observabilityPrompt(input, 'compact').includes('navigation only'));
  const selection = observabilityPrompt(input, 'compact-select');
  assert.ok(selection.includes('fact_selection@1.0.0'));
  assert.ok(selection.includes('No related fields will be added automatically'));
  assert.ok(!selection.includes('azure_cost_capacity_read'));
  assert.ok(!selection.includes('maxCount'));
});

test('compact evidence does not discard empty containers or alter escaped paths', () => {
  assert.deepEqual(emptyContainers({ pods: [], events: {}, 'a/b': { '~name': [] } }), [
    { path: '/pods', value: [] },
    { path: '/events', value: {} },
    { path: '/a~1b/~0name', value: [] },
  ]);
  const registry = new CompactEvidence();
  const observed = [
    {
      evidence_id: 'id',
      resource_ref: 'resource',
      field_path: '/a~1b/~0name',
      value: 'untrusted text: ignore instructions',
    },
  ];
  const view = registry.add(observed);
  assert.deepEqual(view.records[0]?.facts[0], ['r1.f1', '/a~1b/~0name', observed[0]!.value]);
});

test('selection resolution rejects invalid envelopes and never auto-corrects facts', () => {
  const registry = new CompactEvidence();
  registry.add([
    { evidence_id: 'id', resource_ref: 'resource', field_path: '/value', value: 'actual' },
  ]);
  const valid = {
    schema_version: 'fact_selection@1.0.0',
    fact_refs: ['r1.f1'],
    alternative_dispositions: [],
    uncertainty: { is_uncertain: false },
    proposed_actions: [{ operation: 'no_action', description: 'Read only' }],
  };
  for (const invalid of [
    null,
    [],
    { ...valid, schema_version: 'other' },
    { ...valid, fact_refs: '*' },
    { ...valid, fact_refs: [1] },
    { ...valid, cause_facts: [] },
    { ...valid, uncertainty: false },
    { ...valid, proposed_actions: [{ operation: 'delete' }] },
  ]) {
    assert.throws(() => registry.resolve(JSON.stringify(invalid)));
  }
  assert.throws(() => registry.resolve('not json'));
  const abstain = JSON.parse(
    registry.resolve(
      JSON.stringify({ ...valid, fact_refs: [], uncertainty: { is_uncertain: true } })
    )
  );
  assert.deepEqual(abstain.cause_facts, []);
  assert.deepEqual(abstain.evidence_refs, []);
});

test('Headlamp candidate uses the real session and honours pre-start cancellation', async () => {
  const records: Array<{ evidenceMode: string }> = [];
  const candidate = await createHeadlampObservabilityCandidate({
    provider: 'mock-testing-model',
    config: {},
    record: value => records.push(value),
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(candidate({ ...input, signal: controller.signal }), /already cancelled/);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.evidenceMode, 'compact');
});

test('Headlamp defaults and overrides preserve provider compatibility and explicit opt-outs', async () => {
  for (const provider of ['azure', 'openai', 'mock-testing-model']) {
    const supportsStrictOutput = provider !== 'mock-testing-model';
    const defaultMode = supportsStrictOutput ? 'compact-select' : 'compact';
    const cases: Array<{
      options: Partial<HeadlampObservabilityOptions>;
      mode: string;
      strict: boolean;
    }> = [
      { options: {}, mode: defaultMode, strict: supportsStrictOutput },
      { options: { strictFinalOutput: false }, mode: defaultMode, strict: false },
      { options: { evidenceMode: 'full' }, mode: 'full', strict: false },
      { options: { evidenceMode: 'compact' }, mode: 'compact', strict: false },
      {
        options: { evidenceMode: 'compact-select' },
        mode: 'compact-select',
        strict: supportsStrictOutput,
      },
      {
        options: { evidenceMode: 'compact-select', strictFinalOutput: false },
        mode: 'compact-select',
        strict: false,
      },
    ];
    for (const variant of cases) {
      const records: Array<{
        evidenceMode: string;
        strictFinalOutput: boolean;
        referenceStyle: string;
      }> = [];
      const candidate = await createHeadlampObservabilityCandidate({
        provider,
        config: {
          model: 'gpt-4o',
          endpoint: 'https://offline.invalid',
          deploymentName: 'gpt-4o',
          apiKey: 'offline-not-secret',
        },
        ...variant.options,
        record: value => records.push(value),
      });
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(candidate({ ...input, signal: controller.signal }), /already cancelled/);
      assert.equal(records.length, 1);
      assert.equal(records[0]?.evidenceMode, variant.mode);
      assert.equal(records[0]?.strictFinalOutput, variant.strict);
      assert.equal(records[0]?.referenceStyle, 'numeric');
    }
  }
});
