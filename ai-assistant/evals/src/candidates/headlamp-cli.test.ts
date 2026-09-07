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
import { createHeadlampCliCandidate, extractJsonBlock } from './headlamp-cli.js';
import { loadScenario } from '../scenarios/loader.js';
import type { ProcessRunResult } from './headlamp-cli.js';

const scenario = loadScenario('core-service-selector-fault-v1');

test('extractJsonBlock: extracts a fenced json block from surrounding prose', () => {
  const text = 'Here is my answer.\nCODEFENCEjson\n{"a":1}\nCODEFENCE\nThanks.'.replace(
    /CODEFENCE/g,
    '```'
  );
  assert.equal(extractJsonBlock(text), '{"a":1}');
});

test('extractJsonBlock: returns null when no fenced block is present', () => {
  assert.equal(extractJsonBlock('just plain prose, no code block'), null);
});

test('createHeadlampCliCandidate: invokes the injected process runner with the constructed prompt', async () => {
  let capturedArgs: string[] = [];
  const fakeResult: ProcessRunResult = {
    stdout: 'plain answer, no sidecar',
    stderr: '',
    exitCode: 0,
    timedOut: false,
  };
  const candidate = createHeadlampCliCandidate({
    processRunner: async (command, args) => {
      capturedArgs = args;
      return fakeResult;
    },
  });
  const result = await candidate.invoke({
    packet: scenario.candidatePacket,
    observations: [
      { evidence_id: 'ev1', resource_ref: 'service/web', field_path: 'spec.selector', value: '{}' },
    ],
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.submission_text, null);
  assert.ok(capturedArgs.some(arg => arg.includes(scenario.candidatePacket.task_prompt)));
});

test('createHeadlampCliCandidate: a non-zero exit code is reported as unavailable, not a silent pass', async () => {
  const candidate = createHeadlampCliCandidate({
    processRunner: async () => ({ stdout: '', stderr: 'boom', exitCode: 1, timedOut: false }),
  });
  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations: [] });
  assert.equal(result.status, 'unavailable');
});

test('createHeadlampCliCandidate: a timeout is reported as status timeout', async () => {
  const candidate = createHeadlampCliCandidate({
    processRunner: async () => ({ stdout: '', stderr: '', exitCode: 1, timedOut: true }),
  });
  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations: [] });
  assert.equal(result.status, 'timeout');
});

test('createHeadlampCliCandidate: extracts and preserves a valid fenced json sidecar', async () => {
  const jsonSidecar = JSON.stringify({
    schema_version: '1.0.0',
    cause_facts: [],
    resource_refs: [],
    evidence_refs: [],
    alternative_dispositions: [],
    uncertainty: { is_uncertain: false },
    proposed_actions: [],
  });
  const fence = '```';
  const candidate = createHeadlampCliCandidate({
    processRunner: async () => ({
      stdout: `My investigation...\n${fence}json\n${jsonSidecar}\n${fence}\n`,
      stderr: '',
      exitCode: 0,
      timedOut: false,
    }),
  });
  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations: [] });
  assert.equal(result.status, 'ok');
  assert.equal(JSON.parse(result.submission_text ?? '{}').schema_version, '1.0.0');
});

test('createHeadlampCliCandidate: does not forward disallowed env vars to the child process', async () => {
  let observedEnv: NodeJS.ProcessEnv = {};
  const candidate = createHeadlampCliCandidate({
    allowedEnvVars: ['SOME_SAFE_VAR'],
    processRunner: async (_command, _args, env) => {
      observedEnv = env;
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
    },
  });
  process.env.HEADLAMP_AI_EVAL_TEST_SECRET = 'should-not-leak';
  try {
    await candidate.invoke({ packet: scenario.candidatePacket, observations: [] });
  } finally {
    delete process.env.HEADLAMP_AI_EVAL_TEST_SECRET;
  }
  assert.equal(observedEnv.HEADLAMP_AI_EVAL_TEST_SECRET, undefined);
  assert.equal(observedEnv.HEADLAMP_AI_MOCK_ALL, '1');
});
