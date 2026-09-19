/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createHeadlampPluginCandidate,
  isDirtyGitStatus,
  type BrowserPluginRunRequest,
} from './headlampPlugin.js';
import { loadScenario } from '../scenarios/loader.js';

const scenario = loadScenario('core-service-selector-fault-v1');
const input = {
  packet: scenario.candidatePacket,
  observations: [
    {
      evidence_id: 'service-selector',
      resource_ref: 'service/web',
      field_path: 'spec.selector',
      value: '{"app":"wrong"}',
    },
  ],
  evidence_digest: 'a'.repeat(64),
};

test('browser candidate provenance distinguishes a clean tree from git failure', () => {
  assert.equal(isDirtyGitStatus(''), false);
  assert.equal(isDirtyGitStatus(' M src/index.tsx'), true);
  assert.equal(isDirtyGitStatus(null), true);
});

test('headlamp-plugin reconstructs a scoreable diagnosis from browser structured output', async () => {
  let request: BrowserPluginRunRequest | undefined;
  const candidate = createHeadlampPluginCandidate({
    url: 'http://127.0.0.1:4466',
    providerId: 'copilot',
    providerConfig: { apiKey: 'secret-token', model: 'gpt-5.4' },
    browserRunner: async value => {
      request = value;
      return {
        response:
          '```json\n{"schema_version":"attacker","cause_facts":[{"resource_ref":"secret","field_path":"hidden","observed_value":"truth"}],"evidence_refs":["hidden"],"alternative_dispositions":[],"uncertainty":{"is_uncertain":false,"reason":""},"proposed_actions":[{"operation":"no_action","description":"Read only"}]}\n```',
        telemetry: [
          {
            type: 'model_usage',
            provider: 'copilot',
            model: 'gpt-5.4',
            input_token_semantics: 'total_including_cache',
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
          { type: 'turn_complete' },
        ],
        timedOut: false,
      };
    },
  });

  const result = await candidate.invoke(input);

  assert.equal(result.status, 'ok');
  assert.deepEqual(JSON.parse(result.submission_text!), {
    schema_version: '1.0.0',
    cause_facts: [
      {
        resource_ref: 'service/web',
        field_path: 'spec.selector',
        observed_value: '{"app":"wrong"}',
      },
    ],
    resource_refs: ['service/web'],
    evidence_refs: ['service-selector'],
    alternative_dispositions: [],
    uncertainty: { is_uncertain: false, reason: '' },
    proposed_actions: [{ operation: 'no_action', description: 'Read only' }],
  });
  assert.equal(result.token_usage?.total_tokens, 15);
  assert.deepEqual(result.tool_events, []);
  assert.equal(request?.providerConfig.apiKey, 'secret-token');
  assert.match(request?.prompt ?? '', /Observed context/);
  assert.equal(JSON.stringify(candidate.identity).includes('secret-token'), false);
  assert.equal(candidate.identity?.candidate_id, 'headlamp-plugin');
});

test('headlamp-plugin reports browser deadline expiry as timeout', async () => {
  const candidate = createHeadlampPluginCandidate({
    url: 'http://127.0.0.1:4466',
    providerId: 'copilot',
    providerConfig: { apiKey: 'secret-token' },
    browserRunner: async () => ({ response: '', telemetry: [], timedOut: true }),
  });

  const result = await candidate.invoke(input);

  assert.equal(result.status, 'timeout');
  assert.equal(result.submission_text, null);
});

test('headlamp-plugin reports browser launch and bridge failures as unavailable', async () => {
  const candidate = createHeadlampPluginCandidate({
    url: 'http://127.0.0.1:4466',
    providerId: 'copilot',
    providerConfig: { apiKey: 'secret-token' },
    browserRunner: async () => ({
      response: '',
      telemetry: [],
      timedOut: false,
      error: 'bridge unavailable',
    }),
  });

  const result = await candidate.invoke(input);

  assert.equal(result.status, 'unavailable');
  assert.equal(result.submission_text, null);
  assert.equal(result.raw_text, 'bridge unavailable');
});

test('headlamp-plugin normalizes a thrown browser failure as unavailable', async () => {
  const candidate = createHeadlampPluginCandidate({
    url: 'http://127.0.0.1:4466',
    providerId: 'copilot',
    providerConfig: { apiKey: 'secret-token' },
    browserRunner: async () => {
      throw new Error('chromium failed to launch');
    },
  });

  const result = await candidate.invoke(input);

  assert.equal(result.status, 'unavailable');
  assert.equal(result.submission_text, null);
  assert.equal(result.raw_text, 'chromium failed to launch');
});

test('headlamp-plugin rejects unsafe URLs and invalid deadlines before browser launch', () => {
  assert.throws(
    () =>
      createHeadlampPluginCandidate({
        url: 'https://user:secret@example.com',
        providerId: 'copilot',
        providerConfig: {},
      }),
    /without embedded credentials/
  );
  assert.throws(
    () =>
      createHeadlampPluginCandidate({
        url: 'http://127.0.0.1:4466',
        providerId: 'copilot',
        providerConfig: {},
        timeoutMs: 0,
      }),
    /positive integer/
  );
});
