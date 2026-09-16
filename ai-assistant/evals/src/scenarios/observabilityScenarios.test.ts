import assert from 'node:assert/strict';
import test from 'node:test';
import { observabilityCandidatePacket, observabilityScenarios } from './observabilityScenarios.js';
import {
  observabilityControlSubmission,
  runObservabilityTrial,
  verifyObservabilityScenarios,
} from '../runner/observabilityEvaluation.js';

test('observability twins have indistinguishable Kubernetes evidence but different external truth', () => {
  assert.equal(observabilityScenarios.length, 12);
  const families = new Set(observabilityScenarios.map(scenario => scenario.family));
  assert.equal(families.size, 6);
  for (const family of families) {
    const twins = observabilityScenarios.filter(scenario => scenario.family === family);
    assert.equal(twins.length, 2);
    const [first, second] = twins;
    assert.ok(first && second);
    assert.deepEqual(observabilityCandidatePacket(first), observabilityCandidatePacket(second));
    assert.notDeepEqual(first.response, second.response);
    assert.notDeepEqual(first.expectedFacts, second.expectedFacts);
    for (const scenario of twins) {
      const candidate = JSON.stringify(observabilityCandidatePacket(scenario));
      assert.ok(!candidate.includes('expectedFacts'));
      assert.ok(!candidate.includes(scenario.id));
      assert.equal(scenario.lifecycle, 'draft');
      assert.equal(scenario.qualification, 'pending');
    }
  }
});

test('all observability fixtures execute through production tools and require enabled retrieval', async context => {
  const network = context.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Unexpected network access during fixture verification');
  });
  const result = await verifyObservabilityScenarios();
  assert.equal(result.scenarios.length, 12);
  assert.equal(result.modelInvocations, 0);
  assert.equal(result.qualification, 'pending');
  assert.equal(network.mock.callCount(), 0);
});

test('correct guessed facts cannot pass without retrieving external evidence', async () => {
  for (const scenario of observabilityScenarios) {
    const result = await runObservabilityTrial(scenario, 'kubernetes-only', async () =>
      observabilityControlSubmission(
        scenario.expectedFacts.map(fact => ({
          evidence_id: 'invented',
          resource_ref: `tool/${scenario.requiredTool}`,
          field_path: fact.field_path,
          value: fact.observed_value,
        }))
      )
    );
    assert.equal(result.passed, false);
    assert.equal(result.rootCause?.outcome, 'fail');
    assert.equal(result.providerRequests, 0);
  }
});

test('evidence citations cannot be replayed between trials or twins', async () => {
  const [first, second] = observabilityScenarios;
  assert.ok(first && second);
  let saved = '';
  const original = await runObservabilityTrial(first, 'enabled', async input => {
    const read = input.packet.readRequests[0];
    assert.ok(read);
    const output = await input.callTool(read.tool, read.args);
    saved = observabilityControlSubmission(output.observations);
    return saved;
  });
  assert.equal(original.passed, true);
  for (const scenario of [first, second]) {
    const replay = await runObservabilityTrial(scenario, 'enabled', async input => {
      const read = input.packet.readRequests[0];
      assert.ok(read);
      await input.callTool(read.tool, read.args);
      return saved;
    });
    assert.equal(replay.passed, false);
    assert.match(replay.rootCause?.invalidity_reason ?? '', /never actually retrieved/);
  }
});

test('mutations, unknown tools, and disabled tools cannot retrieve external evidence', async () => {
  const scenario = observabilityScenarios[0];
  assert.ok(scenario);
  for (const [name, args] of [
    ['kubernetes_api_request', { method: 'PATCH', path: '/eval/kubernetes-snapshot' }],
    ['shell', { command: 'kubectl get secrets' }],
    [scenario.requiredTool, scenario.investigation],
  ] as const) {
    const result = await runObservabilityTrial(scenario, 'kubernetes-only', async input => {
      await assert.rejects(input.callTool(name, args));
      return observabilityControlSubmission([]);
    });
    assert.equal(result.passed, false);
    assert.equal(result.rejectedCalls, 1);
    assert.equal(result.providerRequests, 0);
  }
});

test('unsupported queries fail closed instead of returning the incident answer', async () => {
  const scenario = observabilityScenarios[0];
  assert.ok(scenario);
  const result = await runObservabilityTrial(scenario, 'enabled', async input => {
    await assert.rejects(
      input.callTool(scenario.requiredTool, {
        action: 'query',
        query: 'unrelated_metric',
        time: '2026-09-16T11:00:00Z',
      })
    );
    return observabilityControlSubmission([]);
  });
  assert.equal(result.valid, false);
  assert.equal(result.unsupportedRequests, 1);
  assert.equal(result.observations.length, 0);
});

test('Kubernetes-only observations cannot establish either twin cause', async () => {
  for (const scenario of observabilityScenarios) {
    const result = await runObservabilityTrial(scenario, 'kubernetes-only', async input => {
      const output = await input.callTool('kubernetes_api_request', {
        method: 'GET',
        path: '/eval/kubernetes-snapshot',
      });
      return observabilityControlSubmission(output.observations);
    });
    assert.equal(result.valid, true);
    assert.equal(result.passed, false);
    assert.equal(result.rootCause?.outcome, 'fail');
    assert.equal(result.providerRequests, 0);
  }
});

test('candidate-side evidence mutation cannot alter the grader record', async () => {
  const scenario = observabilityScenarios[0];
  assert.ok(scenario);
  const result = await runObservabilityTrial(scenario, 'enabled', async input => {
    const read = input.packet.readRequests[0];
    assert.ok(read);
    const output = await input.callTool(read.tool, read.args);
    const fact = output.observations[0];
    assert.ok(fact);
    fact.value = 'invented-value';
    input.packet.kubernetesEvidence = 'invented-snapshot';
    return observabilityControlSubmission(output.observations);
  });
  assert.equal(result.passed, false);
  assert.equal(result.rootCause?.outcome, 'fail');
  assert.ok(result.observations.every(observation => observation.value !== 'invented-value'));
  assert.notEqual(scenario.kubernetesEvidence, 'invented-snapshot');
});

test('call budgets and malformed submissions cannot produce a passing trial', async () => {
  const scenario = observabilityScenarios[0];
  assert.ok(scenario);
  const result = await runObservabilityTrial(scenario, 'enabled', async input => {
    for (let count = 0; count < 8; count++) {
      await input.callTool('kubernetes_api_request', {
        method: 'GET',
        path: '/eval/kubernetes-snapshot',
      });
    }
    await assert.rejects(input.callTool(scenario.requiredTool, scenario.investigation));
    return 'not a diagnosis submission';
  });
  assert.equal(result.valid, false);
  assert.equal(result.submissionStatus, 'malformed');
  assert.equal(result.calls.length, 8);
  assert.equal(result.rejectedCalls, 1);
  assert.equal(result.providerRequests, 0);
});

test('novel action proposals and uncertain unique causes do not pass', async () => {
  const scenario = observabilityScenarios[0];
  assert.ok(scenario);
  for (const change of ['action', 'uncertainty']) {
    const result = await runObservabilityTrial(scenario, 'enabled', async input => {
      const output = await input.callTool(scenario.requiredTool, scenario.investigation);
      const submission = JSON.parse(observabilityControlSubmission(output.observations));
      if (change === 'action') {
        submission.proposed_actions = [
          {
            operation: 'unscored_novel_strategy',
            description: 'Change the dependency configuration.',
          },
        ];
      } else {
        submission.uncertainty.is_uncertain = true;
      }
      return JSON.stringify(submission);
    });
    assert.equal(result.passed, false);
  }
});

test('late tool results cannot mutate a completed trial', async () => {
  const scenario = observabilityScenarios[0];
  assert.ok(scenario);
  let pending: Promise<unknown> | undefined;
  const result = await runObservabilityTrial(scenario, 'enabled', async input => {
    pending = assert.rejects(
      input.callTool(scenario.requiredTool, scenario.investigation),
      /Trial finished/
    );
    return observabilityControlSubmission([]);
  });
  assert.ok(pending);
  await pending;
  assert.equal(result.passed, false);
  assert.equal(result.observations.length, 0);
  assert.equal(result.calls[0]?.success, false);
});
