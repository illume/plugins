import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHeadlampObservabilityCandidate,
  emptyContainers,
  observabilityPrompt,
  summarizeObservabilityUsage,
  type HeadlampObservabilityOptions,
  type HeadlampObservabilityRecord,
} from './headlampObservability.js';
import type { LiveObservabilityCandidateInput } from '../runner/observabilityEvaluation.js';
import { CompactEvidence } from './compactEvidence.js';
import { FACT_SELECTION_SCHEMA } from './compactEvidence.js';
import { assertValid } from '../contracts/validate.js';
import {
  gradeObservabilitySelection,
  gradeObservabilityCausality,
} from '../grading/observabilitySelection.js';
import { gradeRootCause, parseSubmission } from '../grading/diagnosisGrader.js';

test('usage summaries distinguish missing measurements, partial usage, and reported zero', () => {
  const usage = {
    type: 'model_usage',
    input_token_semantics: 'total_including_cache',
    input_tokens: 10,
    output_tokens: 5,
  };
  const unknown = summarizeObservabilityUsage();
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.observedInputTokens, null);
  assert.equal(unknown.observedOutputTokens, null);
  assert.equal(unknown.observedUsageEvents, 0);
  for (const status of ['running', 'failed', 'cancelled'] as const) {
    const partial = summarizeObservabilityUsage({ status, telemetry: [usage] });
    assert.equal(partial.status, 'partial');
    assert.equal(partial.observedInputTokens, 10);
    assert.equal(partial.observedOutputTokens, 5);
    assert.equal(partial.observedUsageEvents, 1);
  }
  const reported = summarizeObservabilityUsage({
    status: 'completed',
    telemetry: [usage, { ...usage, input_tokens: 20, output_tokens: 0 }, { type: 'turn_complete' }],
  });
  assert.equal(reported.status, 'reported');
  assert.equal(reported.observedInputTokens, 30);
  assert.equal(reported.observedOutputTokens, 5);
  assert.equal(reported.observedUsageEvents, 2);
  const zero = summarizeObservabilityUsage({
    status: 'completed',
    telemetry: [{ ...usage, input_tokens: 0, output_tokens: 0 }],
  });
  assert.equal(zero.status, 'reported');
  assert.equal(zero.observedInputTokens, 0);
  assert.equal(zero.observedOutputTokens, 0);
  const missing = summarizeObservabilityUsage({
    status: 'completed',
    telemetry: [
      usage,
      { type: 'model_usage', input_token_semantics: 'total_including_cache', output_tokens: 3 },
    ],
  });
  assert.equal(missing.status, 'partial');
  assert.equal(missing.missingInputCounts, 1);
  assert.equal(missing.observedInputTokens, 10);
  assert.equal(missing.observedOutputTokens, 8);
  for (const invalid of [null, '5', -1, Infinity, NaN, 0.5]) {
    assert.equal(
      summarizeObservabilityUsage({
        status: 'completed',
        telemetry: [
          null,
          [],
          { type: 'tool_call' },
          { ...usage, input_tokens: invalid, output_tokens: invalid },
        ],
      }).status,
      'unknown'
    );
  }
  const mixed = summarizeObservabilityUsage({
    status: 'completed',
    telemetry: [usage, { ...usage, input_token_semantics: 'uncached_only' }],
  });
  assert.equal(mixed.inputTokenSemantics, 'mixed-or-unknown');
  assert.equal(mixed.observedInputTokens, null);
  assert.equal(mixed.observedOutputTokens, 10);
  assert.equal(mixed.status, 'partial');
  assert.equal(
    summarizeObservabilityUsage({
      status: 'completed',
      telemetry: [{ ...usage, input_token_semantics: 'uncached_only' }],
    }).inputTokenSemantics,
    'uncached_only'
  );
});

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

test('object grouping preserves facts, numeric IDs, and per-read pool/rule identity', () => {
  const paths = [
    '/value/0/name',
    '/value/0/properties/maxCount',
    '/value/1/name',
    '/value/1/properties/maxCount',
    '/value/1/properties/minCount',
    '/value/1/properties/enableAutoScaling',
    '/value/0/effectiveSecurityRules/0/name',
    '/value/0/effectiveSecurityRules/0/access',
    '/value/0/effectiveSecurityRules/1/name',
    '/pods/items/0/metadata/name',
    '/pods/items/0/spec/containers/0/resources/requests/cpu',
    '/pods/items/1/metadata/name',
    '/events/items/0/message',
    '/nodes/items/0/metadata/name',
    '/value/other~1key/0/name',
  ];
  const observations = paths.map(field_path => ({
    evidence_id: 'first',
    resource_ref: 'tool/read',
    field_path,
    value: '1',
  }));
  const baseline = new CompactEvidence();
  const grouped = new CompactEvidence('numeric', 'object');
  const original = baseline.add(observations);
  const view = grouped.add(observations);
  assert.deepEqual(
    view.records.map(record => record.object_path),
    [
      '/value/0',
      '/value/1',
      '/value/0/effectiveSecurityRules/0',
      '/value/0/effectiveSecurityRules/1',
      '/pods/items/0',
      '/pods/items/1',
      '/events/items/0',
      '/nodes/items/0',
      '',
    ]
  );
  assert.deepEqual(
    view.records.flatMap(record => record.facts),
    original.records.flatMap(record => record.facts)
  );
  assert.ok(original.records.every(record => !('object_path' in record)));
  const selection = JSON.stringify({
    schema_version: 'fact_selection@1.0.0',
    fact_refs: ['r1.f4'],
    alternative_dispositions: [],
    uncertainty: { is_uncertain: false },
    proposed_actions: [{ operation: 'no_action', description: 'Read only' }],
  });
  assert.equal(grouped.resolve(selection), baseline.resolve(selection));
  assert.equal(JSON.parse(grouped.resolve(selection)).cause_facts.length, 1);
  observations[3]!.value = 'changed';
  grouped.add(observations.map(fact => ({ ...fact, evidence_id: 'later' })));
  assert.equal(JSON.parse(grouped.resolve(selection)).cause_facts[0].observed_value, '1');
  assert.throws(() => grouped.resolve(selection.replace('r1.f4', '/value/1')));
});

test('causal controls reject wrong-pool, equal-valued fields, irrelevant facts and false abstention', () => {
  const facts = [
    ['/value/1/name', 'target'],
    ['/value/1/properties/enableAutoScaling', 'true'],
    ['/value/1/properties/count', '1'],
    ['/value/1/properties/maxCount', '1'],
    ['/value/1/properties/minCount', '1'],
    ['/value/0/properties/enableAutoScaling', 'false'],
    ['/pods/items/0/spec/priority', '0'],
    ['/value/2/name', 'alternative'],
  ].map(([field_path, observed_value], index) => ({
    fact_id: `fact-${index}`,
    resource_ref: 'resource',
    field_path: field_path!,
    observed_value: observed_value!,
  }));
  const observations = facts.map(fact => ({
    ...fact,
    value: fact.observed_value,
    evidence_id: 'read',
  }));
  const submission = (indices: number[], uncertain = false) =>
    parseSubmission(
      JSON.stringify({
        schema_version: '1.0.0',
        cause_facts: indices.map(index => {
          const { fact_id, ...fact } = facts[index]!;
          return fact;
        }),
        resource_refs: indices.length ? ['resource'] : [],
        evidence_refs: indices.length ? ['read'] : [],
        alternative_dispositions: [],
        uncertainty: { is_uncertain: uncertain },
        proposed_actions: [{ operation: 'no_action', description: 'Read only' }],
      })
    ).submission!;
  const contract = {
    expectation: 'cause' as const,
    acceptedCauses: [{ required: facts.slice(0, 4), supporting: [] }],
  };
  assert.equal(
    gradeObservabilityCausality(submission([0, 1, 2, 3]), observations, contract).passes,
    true
  );
  for (const indices of [
    [0, 1, 2, 4],
    [0, 5, 2, 3],
    [0, 1, 2],
    [0, 1, 2, 3, 6],
    [0, 1, 2, 3, 3],
    [7],
  ]) {
    assert.equal(
      gradeObservabilityCausality(submission(indices), observations, contract).passes,
      false
    );
  }
  assert.equal(
    gradeObservabilityCausality(
      submission([0, 1, 2, 3]),
      observations.map(fact => ({ ...fact, evidence_id: 'later' })),
      contract
    ).passes,
    false
  );
  assert.equal(
    gradeObservabilityCausality(submission([7]), observations, {
      ...contract,
      acceptedCauses: [...contract.acceptedCauses, { required: [facts[7]!], supporting: [] }],
    }).passes,
    true
  );
  for (const expectation of ['healthy', 'insufficient'] as const) {
    const noCause = { expectation, acceptedCauses: [] };
    assert.equal(
      gradeObservabilityCausality(submission([], expectation === 'insufficient'), [], noCause)
        .passes,
      false
    );
    assert.equal(
      gradeObservabilityCausality(
        submission([], expectation === 'insufficient'),
        observations,
        noCause
      ).passes,
      true
    );
    assert.equal(
      gradeObservabilityCausality(
        submission([], expectation !== 'insufficient'),
        observations,
        noCause
      ).passes,
      false
    );
    assert.equal(
      gradeObservabilityCausality(submission([6], true), observations, noCause)
        .uncertaintyWithCauses,
      true
    );
    assert.equal(
      gradeObservabilityCausality(submission([6], true), observations, noCause).passes,
      false
    );
    assert.equal(
      gradeObservabilityCausality(submission([0, 1, 2, 3]), observations, noCause).passes,
      false
    );
    assert.equal(gradeObservabilityCausality(null, observations, noCause).passes, false);
  }
  assert.throws(() =>
    gradeObservabilityCausality(submission([]), observations, {
      expectation: 'cause',
      acceptedCauses: [],
    })
  );
});

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
  for (const evidenceGrouping of ['read', 'object'] as const) {
    test(`default strict selection reaches Azure with ${referenceStyle} references and ${evidenceGrouping} grouping`, async context => {
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
        evidenceGrouping,
        record: value => {
          assert.equal(value.status, 'completed');
          assert.equal(value.error, null);
          assert.ok(value.resolvedSubmission);
          assert.equal(
            value.telemetry.filter(event => (event as { type: string }).type === 'model_usage')
              .length,
            2
          );
          assert.deepEqual(
            value.telemetry
              .filter((event: any) => event.type === 'model_invocation')
              .map((event: any) => [event.invocation_id, event.phase, event.status]),
            [
              [1, 'planning', 'started'],
              [1, 'planning', 'completed'],
              [2, 'synthesis', 'started'],
              [2, 'synthesis', 'completed'],
            ]
          );
        },
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
      assert.equal(
        JSON.stringify(requests[1]?.messages).includes('object_path'),
        evidenceGrouping === 'object'
      );
      assert.deepEqual(parseSubmission(result).submission?.cause_facts, [
        { resource_ref: 'tool/kubernetes_api_request', field_path: '/cpu', observed_value: '100m' },
      ]);
    });
  }
}

for (const evidenceMode of ['compact-select', 'compact'] as const) {
  test(`cancelled ${evidenceMode} synthesis records partial usage immediately and settles once`, async context => {
    const controller = new AbortController();
    const records: HeadlampObservabilityRecord[] = [];
    const progress: HeadlampObservabilityRecord[] = [];
    let requests = 0;
    let releaseFinal: (response: Response) => void = () => {};
    const pendingFinal = new Promise<Response>(resolve => {
      releaseFinal = resolve;
    });
    context.after(() => releaseFinal(Response.json({ choices: [] })));
    context.mock.method(
      globalThis,
      'fetch',
      async (request: Request | string | URL, init?: RequestInit) => {
        requests++;
        if (requests === 1)
          return Response.json({
            id: 'offline',
            object: 'chat.completion',
            created: 0,
            model: 'gpt-4o',
            choices: [
              {
                index: 0,
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: 'read',
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
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          });
        assert.equal(requests, 2, 'Cancellation must not trigger fallback requests');
        assert.ok(
          progress.some(record =>
            record.telemetry.some(event => (event as { type: string }).type === 'model_usage')
          )
        );
        assert.equal(records.length, 0);
        const signal = request instanceof Request ? request.signal : init?.signal;
        assert.ok(signal instanceof AbortSignal);
        controller.abort();
        assert.equal(signal.aborted, true, 'Abort must reach the actual HTTP request');
        assert.equal(records.length, 1, 'Persist before an outer timeout can end the process');
        return pendingFinal;
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
      evidenceMode,
      recordProgress: value => progress.push(value),
      record: value => records.push(value),
    });
    await assert.rejects(
      candidate({
        ...input,
        signal: controller.signal,
        callTool: async () => ({
          data: { cpu: '100m' },
          observations: [
            {
              evidence_id: 'read',
              resource_ref: 'tool/kubernetes_api_request',
              field_path: '/cpu',
              value: '100m',
            },
          ],
        }),
      }),
      /cancelled|abort/i
    );
    assert.equal(records.length, 1);
    assert.equal(records[0]?.status, 'cancelled');
    assert.equal(records[0]?.resolvedSubmission, null);
    assert.ok(records[0]!.toolPayloadCharacters > 0);
    const usage = records[0]!.telemetry.filter(
      event => (event as { type: string }).type === 'model_usage'
    );
    assert.equal(usage.length, 1);
    assert.equal((usage[0] as { input_tokens: number }).input_tokens, 10);
    assert.deepEqual(
      records[0]!.telemetry
        .filter((event: any) => event.type === 'model_invocation')
        .map((event: any) => [event.invocation_id, event.phase, event.status]),
      [
        [1, 'planning', 'started'],
        [1, 'planning', 'completed'],
        [2, 'synthesis', 'started'],
        [2, 'synthesis', 'cancelled'],
      ]
    );
    assert.equal(progress[0]?.telemetry.length, 0, 'Earlier snapshots must not mutate');
  });
}

test('cancelled planning cannot fall back or save a late model answer', async context => {
  const controller = new AbortController();
  const records: HeadlampObservabilityRecord[] = [];
  let requests = 0;
  const progress: HeadlampObservabilityRecord[] = [];
  const callTool = context.mock.fn(async () => {
    throw new Error('Unexpected read');
  });
  context.mock.method(
    globalThis,
    'fetch',
    async (request: Request | string | URL, init?: RequestInit) => {
      assert.equal(++requests, 1, 'No retry after cancellation');
      const signal = request instanceof Request ? request.signal : init?.signal;
      assert.ok(signal instanceof AbortSignal);
      controller.abort();
      assert.equal(signal.aborted, true);
      assert.equal(records.length, 1);
      return Response.json({
        id: 'late',
        object: 'chat.completion',
        created: 0,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: '{"late":true}' },
          },
        ],
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
    record: value => records.push(value),
    recordProgress: value => progress.push(value),
  });
  await assert.rejects(
    candidate({ ...input, callTool, signal: controller.signal }),
    /cancelled|abort/i
  );
  const snapshot = JSON.stringify(records[0]);
  const progressCount = progress.length;
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(records.length, 1);
  assert.equal(JSON.stringify(records[0]), snapshot);
  assert.equal(progress.length, progressCount);
  assert.equal(records[0]?.status, 'cancelled');
  assert.equal(records[0]?.text, '');
  assert.deepEqual(
    records[0]!.telemetry
      .filter((event: any) => event.type === 'model_invocation')
      .map((event: any) => [event.invocation_id, event.phase, event.status]),
    [
      [1, 'planning', 'started'],
      [1, 'planning', 'cancelled'],
    ]
  );
  assert.equal(records[0]?.resolvedSubmission, null);
  assert.equal(callTool.mock.callCount(), 0);
});

test('cancelling a pending tool read settles immediately and ignores its late result', async context => {
  const controller = new AbortController();
  const records: HeadlampObservabilityRecord[] = [];
  let requests = 0;
  const output = {
    data: { value: 1 },
    observations: [
      {
        evidence_id: 'read',
        resource_ref: 'tool/kubernetes_api_request',
        field_path: '/value',
        value: '1',
      },
    ],
  };
  let finishRead: (value: typeof output) => void = () => {};
  const pending = new Promise<typeof output>(resolve => {
    finishRead = resolve;
  });
  context.after(() => finishRead(output));
  context.mock.method(globalThis, 'fetch', async () => {
    assert.equal(++requests, 1, 'No synthesis after a cancelled read');
    return Response.json({
      id: 'offline',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'read',
                type: 'function',
                function: {
                  name: 'kubernetes_api_request',
                  arguments: JSON.stringify({ method: 'GET', path: '/eval/observed-kubernetes' }),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  });
  const candidate = await createHeadlampObservabilityCandidate({
    provider: 'azure',
    config: {
      model: 'gpt-4o',
      endpoint: 'https://offline.invalid',
      deploymentName: 'gpt-4o',
      apiKey: 'offline-not-secret',
    },
    record: value => records.push(value),
  });
  await assert.rejects(
    candidate({
      ...input,
      signal: controller.signal,
      callTool: async () => {
        controller.abort();
        return pending;
      },
    }),
    /cancelled|abort/i
  );
  assert.equal(records.length, 1);
  assert.equal(records[0]?.status, 'cancelled');
  const snapshot = JSON.stringify(records[0]);
  finishRead(output);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(requests, 1);
  assert.equal(records.length, 1);
  assert.equal(JSON.stringify(records[0]), snapshot);
  assert.equal(records[0]?.toolPayloadCharacters, 0);
});

test('provider rejection records the synthesis phase without a new fallback invocation', async context => {
  let requests = 0;
  let record: HeadlampObservabilityRecord | undefined;
  const progress: HeadlampObservabilityRecord[] = [];
  context.mock.method(globalThis, 'fetch', async () => {
    assert.ok(++requests <= 2, 'Provider rejection must not start another request');
    if (requests === 2)
      return Response.json(
        {
          error: {
            message: 'private-provider-detail',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        },
        { status: 401 }
      );
    return Response.json({
      id: 'offline',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: 'read',
                type: 'function',
                function: {
                  name: 'kubernetes_api_request',
                  arguments: JSON.stringify({ method: 'GET', path: '/eval/observed-kubernetes' }),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  });
  const candidate = await createHeadlampObservabilityCandidate({
    provider: 'azure',
    config: {
      model: 'gpt-4o',
      endpoint: 'https://offline.invalid',
      deploymentName: 'gpt-4o',
      apiKey: 'offline-not-secret',
    },
    record: value => {
      record = value;
    },
    recordProgress: value => progress.push(value),
  });
  await assert.rejects(
    candidate({
      ...input,
      callTool: async () => ({
        data: { value: 1 },
        observations: [
          {
            evidence_id: 'read',
            resource_ref: 'tool/kubernetes_api_request',
            field_path: '/value',
            value: '1',
          },
        ],
      }),
    }),
    /Assistant session failed/
  );
  assert.ok(record);
  assert.equal(record.status, 'failed');
  const events = record.telemetry.filter(
    (event: any) => event.type === 'model_invocation'
  ) as Array<Record<string, unknown>>;
  assert.deepEqual(
    events.map(event => [event.invocation_id, event.phase, event.status]),
    [
      [1, 'planning', 'started'],
      [1, 'planning', 'completed'],
      [2, 'synthesis', 'started'],
      [2, 'synthesis', 'failed'],
    ]
  );
  assert.equal(events[3]?.http_status, 401);
  assert.ok(
    progress.some(value =>
      value.telemetry.some(
        (event: any) => event.type === 'model_invocation' && event.status === 'failed'
      )
    )
  );
  assert.ok(!JSON.stringify(events).includes('private-provider-detail'));
  assert.equal(summarizeObservabilityUsage(record).status, 'partial');
  assert.equal(requests, 2);
});

test('guidance is independent of grouping and has no incident-specific values', async () => {
  const plain = observabilityPrompt(input, 'compact-select');
  assert.equal(plain, observabilityPrompt(input, 'compact-select', 'none'));
  const guided = observabilityPrompt(input, 'compact-select', 'aks');
  assert.ok(guided.includes('maxPods is a per-node pod limit'));
  assert.ok(guided.includes('return no cause facts and is_uncertain=true'));
  assert.ok(guided.includes('a shadowed deny does not establish the cause'));
  assert.ok(!guided.includes('block-aks'));
  assert.ok(!guided.includes('10.240.1.4'));
  assert.ok(!guided.includes('maxCount=1'));
  assert.ok(!plain.includes('AKS diagnostic procedure'));
  await assert.rejects(
    createHeadlampObservabilityCandidate({
      provider: 'azure',
      config: {},
      evidenceMode: 'full',
      evidenceGrouping: 'object',
    }),
    /requires compact/
  );
});

test('shadowed NSG deny is not an accepted cause and complete alternatives remain separate', () => {
  const registry = new CompactEvidence();
  const facts = ['name', 'access', 'priority'].map((field, index) => ({
    fact_id: `rule-${index}`,
    resource_ref: 'nic',
    field_path: `/value/0/effectiveSecurityRules/1/${field}`,
    observed_value: ['deny-backend', 'Deny', '200'][index]!,
  }));
  const observations = facts.map(fact => ({
    ...fact,
    value: fact.observed_value,
    evidence_id: 'read',
  }));
  registry.add(observations);
  const selection = {
    schema_version: 'fact_selection@1.0.0',
    fact_refs: ['r1.f1', 'r1.f2', 'r1.f3'],
    alternative_dispositions: [],
    uncertainty: { is_uncertain: false },
    proposed_actions: [{ operation: 'no_action', description: 'Read only' }],
  };
  const selected = parseSubmission(registry.resolve(JSON.stringify(selection))).submission!;
  assert.equal(
    gradeObservabilityCausality(selected, observations, {
      expectation: 'healthy',
      acceptedCauses: [],
    }).passes,
    false
  );
  const other = facts.map(fact => ({ ...fact, field_path: fact.field_path.replace('/1/', '/2/') }));
  assert.equal(
    gradeObservabilityCausality(selected, observations, {
      expectation: 'cause',
      acceptedCauses: [{ required: other, supporting: [] }],
    }).passes,
    false
  );
  assert.equal(
    gradeObservabilityCausality(selected, observations, {
      expectation: 'cause',
      acceptedCauses: [{ required: facts, supporting: [] }],
    }).passes,
    true
  );
});

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
