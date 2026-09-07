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
import type { CandidateInvocationInput } from './types.js';

const scenario = loadScenario('core-service-selector-fault-v1');
const observations: CandidateInvocationInput['observations'] = [
  {
    evidence_id: 'ev1',
    resource_ref: 'service/web',
    field_path: 'spec.selector',
    value: '{"app":"web","tier":"frontend"}',
  },
];

test('scripted reference candidate cites the accepted fact set verbatim', async () => {
  const candidate = createScriptedCandidate('reference', scenario.evaluatorPacket);
  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations });
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
  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations });
  const parsed = JSON.parse(result.submission_text ?? '{}');
  assert.equal(parsed.cause_facts[0].observed_value, 'CrashLoopBackOff');
});

test('scripted malformed candidate emits unparseable text', async () => {
  const candidate = createScriptedCandidate('malformed', scenario.evaluatorPacket);
  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations });
  assert.equal(result.status, 'ok');
  assert.throws(() => JSON.parse(result.submission_text ?? ''));
});

test('scripted unavailable candidate reports status unavailable with no submission', async () => {
  const candidate = createScriptedCandidate('unavailable', scenario.evaluatorPacket);
  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations });
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
  const result = await candidate.invoke({ packet: pending.candidatePacket, observations: [] });
  const parsed = JSON.parse(result.submission_text ?? '{}');
  assert.equal(parsed.uncertainty.is_uncertain, true);
  assert.ok(
    parsed.alternative_dispositions.length >=
      (pending.evaluatorPacket.min_hypotheses_if_uncertain ?? 2)
  );
  assert.deepEqual(parsed.cause_facts, []);
});
