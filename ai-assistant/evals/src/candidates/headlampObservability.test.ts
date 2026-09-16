import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHeadlampObservabilityCandidate,
  observabilityPrompt,
} from './headlampObservability.js';
import type { LiveObservabilityCandidateInput } from '../runner/observabilityEvaluation.js';

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

test('Headlamp candidate uses the real session and honours pre-start cancellation', async () => {
  const records: unknown[] = [];
  const candidate = await createHeadlampObservabilityCandidate({
    provider: 'mock-testing-model',
    config: {},
    record: value => records.push(value),
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(candidate({ ...input, signal: controller.signal }), /already cancelled/);
  assert.equal(records.length, 1);
});
