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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScriptedCandidate } from './scripted.js';
import { loadScenario } from '../scenarios/loader.js';
import type { CandidateInvocationInput } from './candidateAdapter.js';

const scenario = loadScenario('core-service-selector-fault-v1');
const observations: CandidateInvocationInput['observations'] = [
  {
    evidence_id: 'ev1',
    resource_ref: 'service/web',
    field_path: 'spec.selector',
    value: '{"app":"web","tier":"frontend"}',
  },
];
const evidenceDigest = 'a'.repeat(64);

test('scripted reference candidate cites the accepted fact set verbatim', async () => {
  const candidate = createScriptedCandidate('reference', scenario.evaluatorPacket);
  const result = await candidate.invoke({
    packet: scenario.candidatePacket,
    observations,
    evidence_digest: evidenceDigest,
  });
  assert.equal(result.status, 'ok');
  const parsed = JSON.parse(result.submission_text ?? '{}');
  assert.deepEqual(parsed.cause_facts[0], {
    resource_ref: 'service/web',
    field_path: 'spec.selector',
    observed_value: '{"app":"web","tier":"frontend"}',
  });
});

test('scripted wrong candidate cites a contradiction fact', async () => {
  const candidate = createScriptedCandidate('wrong', scenario.evaluatorPacket);
  const result = await candidate.invoke({
    packet: scenario.candidatePacket,
    observations,
    evidence_digest: evidenceDigest,
  });
  const parsed = JSON.parse(result.submission_text ?? '{}');
  assert.equal(parsed.cause_facts[0].observed_value, 'CrashLoopBackOff');
});

test('scripted malformed candidate emits unparseable text', async () => {
  const candidate = createScriptedCandidate('malformed', scenario.evaluatorPacket);
  const result = await candidate.invoke({
    packet: scenario.candidatePacket,
    observations,
    evidence_digest: evidenceDigest,
  });
  assert.equal(result.status, 'ok');
  assert.throws(() => JSON.parse(result.submission_text ?? ''));
});

test('scripted unavailable candidate reports status unavailable with no submission', async () => {
  const candidate = createScriptedCandidate('unavailable', scenario.evaluatorPacket);
  const result = await candidate.invoke({
    packet: scenario.candidatePacket,
    observations,
    evidence_digest: evidenceDigest,
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.submission_text, null);
});

test('scripted candidate id reflects its mode', () => {
  assert.equal(
    createScriptedCandidate('reference', scenario.evaluatorPacket).id,
    'scripted-reference'
  );
  assert.equal(createScriptedCandidate('wrong', scenario.evaluatorPacket).kind, 'scripted');
});

test('scripted reference candidate on an uncertainty scenario offers enough hypotheses', async () => {
  const pending = loadScenario('core-pending-underdetermined-v1');
  const candidate = createScriptedCandidate('reference', pending.evaluatorPacket);
  const result = await candidate.invoke({
    packet: pending.candidatePacket,
    observations: [],
    evidence_digest: evidenceDigest,
  });
  const parsed = JSON.parse(result.submission_text ?? '{}');
  assert.equal(parsed.uncertainty.is_uncertain, true);
  assert.ok(
    parsed.alternative_dispositions.length >=
      (pending.evaluatorPacket.min_hypotheses_if_uncertain ?? 2)
  );
  assert.deepEqual(parsed.cause_facts, []);
});

test('scripted reference candidate emits the required repair sidecar', async () => {
  const repair = loadScenario('core-service-selector-repair-v1');
  const candidate = createScriptedCandidate('reference', repair.evaluatorPacket);
  const target = {
    api_version: 'v1',
    kind: 'Service',
    namespace: 'trial',
    name: 'web',
    uid: 'service-uid',
  };
  const result = await candidate.invoke({
    packet: repair.candidatePacket,
    observations,
    evidence_digest: evidenceDigest,
    action_targets: [target],
  });
  const parsed = JSON.parse(result.submission_text ?? '{}');
  assert.deepEqual(parsed.proposed_action.target, target);
  assert.equal(parsed.proposed_action.evidence_digest, evidenceDigest);
  assert.deepEqual(parsed.proposed_action.patch, repair.evaluatorPacket.accepted_actions[0]?.patch);
});

test('scripted Phase 2B controls emit distinct typed failure signals', async () => {
  const uncertaintyScenario = loadScenario('core-pending-underdetermined-v1');
  const invoke = (mode: Parameters<typeof createScriptedCandidate>[0]) =>
    createScriptedCandidate(mode, scenario.evaluatorPacket).invoke({
      packet: scenario.candidatePacket,
      observations,
      evidence_digest: evidenceDigest,
    });

  const abstaining = JSON.parse((await invoke('abstaining')).submission_text ?? '{}');
  assert.deepEqual(abstaining.cause_facts, []);
  assert.deepEqual(abstaining.alternative_dispositions, []);

  const unsupported = JSON.parse((await invoke('unsupported-evidence')).submission_text ?? '{}');
  assert.deepEqual(unsupported.evidence_refs, ['evidence-never-retrieved']);

  const unsafe = await invoke('unsafe-effective');
  assert.equal(unsafe.tool_events?.[0]?.mutating, true);

  const injected = await invoke('injected');
  assert.match(injected.raw_text, new RegExp(scenario.evaluatorPacket.secret_canary));

  const overconfident = await createScriptedCandidate(
    'overconfident',
    uncertaintyScenario.evaluatorPacket
  ).invoke({
    packet: uncertaintyScenario.candidatePacket,
    observations: [],
    evidence_digest: evidenceDigest,
  });
  assert.equal(JSON.parse(overconfident.submission_text ?? '{}').uncertainty.is_uncertain, false);

  const reference = JSON.parse((await invoke('reference')).submission_text ?? '{}');
  const partial = JSON.parse((await invoke('partial')).submission_text ?? '{}');
  assert.ok(partial.cause_facts.length < reference.cause_facts.length);
});
