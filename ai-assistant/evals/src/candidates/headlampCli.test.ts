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
import { existsSync, writeFileSync } from 'node:fs';
import {
  createHeadlampCliCandidate,
  estimateConfiguredUsage,
  extractJsonBlock,
  parseCliTelemetry,
  validateTokenPricingSnapshot,
} from './headlampCli.js';
import { loadScenario } from '../scenarios/loader.js';
import type { ProcessRunResult } from './headlampCli.js';

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

test('parseCliTelemetry aggregates numeric usage and accepts only sanitized tool events', () => {
  const telemetry = parseCliTelemetry(
    [
      JSON.stringify({
        type: 'model_usage',
        provider: 'openai',
        input_token_semantics: 'total_including_cache',
        input_tokens: 10,
        output_tokens: 2,
        total_tokens: 12,
        cache_read_input_tokens: 4,
        cache_creation_input_tokens: 1,
      }),
      JSON.stringify({
        type: 'model_usage',
        provider: 'copilot',
        input_token_semantics: 'total_including_cache',
        input_tokens: 5,
        output_tokens: 3,
        total_tokens: 8,
      }),
      JSON.stringify({
        type: 'tool_call',
        tool_name: 'kubernetes_api_request',
        mutating: false,
        status: 'success',
        duration_ns: '10',
        url: '/must-not-survive',
      }),
      JSON.stringify({ type: 'turn_complete' }),
    ].join('\n')
  );
  assert.deepEqual(telemetry.tokenUsage, {
    input_tokens: 15,
    uncached_input_tokens: 10,
    output_tokens: 5,
    total_tokens: 20,
    request_count: 2,
    cache_read_input_tokens: 4,
    cache_creation_input_tokens: 1,
    cache_write_input_tokens: 1,
  });
  assert.deepEqual(telemetry.toolEvents, [
    {
      tool_name: 'kubernetes_api_request',
      mutating: false,
      status: 'success',
      duration_ns: '10',
    },
  ]);
  assert.equal(telemetry.toolEventsObserved, true);
  assert.equal(telemetry.tokenUsageObserved, true);
  assert.equal(JSON.stringify(telemetry).includes('/must-not-survive'), false);
});

test('parseCliTelemetry keeps a truncated tool stream unobserved', () => {
  const telemetry = parseCliTelemetry(
    JSON.stringify({
      type: 'tool_call',
      tool_name: 'kubernetes_api_request',
      mutating: false,
      status: 'success',
      duration_ns: '10',
    })
  );

  assert.equal(telemetry.toolEventsObserved, false);
  assert.equal(telemetry.toolEvents.length, 1);
});

test('parseCliTelemetry keeps a completed stream with malformed JSON unobserved', () => {
  const telemetry = parseCliTelemetry(
    ['{"type":"tool_call"', JSON.stringify({ type: 'turn_complete' })].join('\n')
  );

  assert.equal(telemetry.toolEventsObserved, false);
});

test('parseCliTelemetry keeps a completed stream with a malformed tool event unobserved', () => {
  const telemetry = parseCliTelemetry(
    [
      JSON.stringify({
        type: 'tool_call',
        tool_name: 'kubernetes_api_request',
        mutating: false,
      }),
      JSON.stringify({ type: 'turn_complete' }),
    ].join('\n')
  );

  assert.equal(telemetry.toolEventsObserved, false);
});

test('parseCliTelemetry does not turn malformed model usage into observed zeros', () => {
  const telemetry = parseCliTelemetry(
    [
      JSON.stringify({
        type: 'model_usage',
        provider: 'openai',
        input_token_semantics: 'total_including_cache',
        input_tokens: -1,
        output_tokens: '2',
        total_tokens: 1,
      }),
      JSON.stringify({ type: 'turn_complete' }),
    ].join('\n')
  );

  assert.equal(telemetry.tokenUsageObserved, false);
});

test('parseCliTelemetry records an observed zero-tool turn only after completion', () => {
  const telemetry = parseCliTelemetry(JSON.stringify({ type: 'turn_complete' }));

  assert.equal(telemetry.toolEventsObserved, true);
  assert.deepEqual(telemetry.toolEvents, []);
  assert.equal(telemetry.tokenUsageObserved, false);
});

test('estimateConfiguredUsage applies configured cache tiers with exact decimal output', () => {
  const cost = estimateConfiguredUsage(
    {
      input_tokens: 1_000_000,
      uncached_input_tokens: 700_000,
      output_tokens: 100_000,
      total_tokens: 1_100_000,
      request_count: 1,
      cache_read_input_tokens: 200_000,
      cache_creation_input_tokens: 100_000,
    },
    {
      currency: 'USD',
      source: 'provider-price-page@2026-09-08',
      input_per_million: '2.50',
      output_per_million: '10',
      cache_read_input_per_million: '0.25',
      cache_creation_input_per_million: '3.125',
    }
  );

  assert.deepEqual(cost, {
    amount: '3.1125',
    unit: 'USD',
    basis: 'configured_usage_pricing',
    pricing_source: 'provider-price-page@2026-09-08',
    line_items: [
      {
        category: 'uncached_input_tokens',
        quantity: 700_000,
        rate: '2.50',
        rate_denominator: 1_000_000,
        amount: '1.75',
      },
      {
        category: 'output_tokens',
        quantity: 100_000,
        rate: '10',
        rate_denominator: 1_000_000,
        amount: '1',
      },
      {
        category: 'cache_read_input_tokens',
        quantity: 200_000,
        rate: '0.25',
        rate_denominator: 1_000_000,
        amount: '0.05',
      },
      {
        category: 'cache_write_input_tokens',
        quantity: 100_000,
        rate: '3.125',
        rate_denominator: 1_000_000,
        amount: '0.3125',
      },
    ],
  });
});

test('parseCliTelemetry normalizes Anthropic exclusive input and TTL cache writes', () => {
  const telemetry = parseCliTelemetry(
    JSON.stringify({
      type: 'model_usage',
      provider: 'anthropic',
      input_token_semantics: 'uncached_only',
      input_tokens: 10,
      output_tokens: 2,
      total_tokens: 24,
      cache_read_input_tokens: 8,
      cache_creation_input_tokens: 4,
      cache_write_5m_input_tokens: 3,
      cache_write_1h_input_tokens: 1,
    })
  );

  assert.deepEqual(telemetry.tokenUsage, {
    input_tokens: 22,
    uncached_input_tokens: 10,
    output_tokens: 2,
    total_tokens: 24,
    request_count: 1,
    cache_read_input_tokens: 8,
    cache_creation_input_tokens: 4,
    cache_write_input_tokens: 4,
    cache_write_5m_input_tokens: 3,
    cache_write_1h_input_tokens: 1,
  });
});

test('parseCliTelemetry does not double count inclusive LangChain Anthropic input', () => {
  const telemetry = parseCliTelemetry(
    JSON.stringify({
      type: 'model_usage',
      provider: 'anthropic',
      input_token_semantics: 'total_including_cache',
      input_tokens: 22,
      output_tokens: 2,
      total_tokens: 24,
      cache_read_input_tokens: 8,
      cache_creation_input_tokens: 4,
      cache_write_5m_input_tokens: 3,
      cache_write_1h_input_tokens: 1,
    })
  );

  assert.deepEqual(telemetry.tokenUsage, {
    input_tokens: 22,
    uncached_input_tokens: 10,
    output_tokens: 2,
    total_tokens: 24,
    request_count: 1,
    cache_read_input_tokens: 8,
    cache_creation_input_tokens: 4,
    cache_write_input_tokens: 4,
    cache_write_5m_input_tokens: 3,
    cache_write_1h_input_tokens: 1,
  });
});

test('estimateConfiguredUsage supports Copilot request accounting without treating credits as USD', () => {
  const estimate = estimateConfiguredUsage(
    {
      input_tokens: 100,
      uncached_input_tokens: 100,
      output_tokens: 20,
      total_tokens: 120,
      request_count: 2,
    },
    {
      unit: 'github_ai_credit',
      source: 'copilot-plan-policy@2026-09-09',
      provider: 'copilot',
      billing_mode: 'subscription_allowance_estimate',
      rates: [{ category: 'requests', amount: '1', per: 1 }],
    }
  );

  assert.deepEqual(estimate, {
    amount: '2',
    unit: 'github_ai_credit',
    basis: 'configured_usage_pricing',
    pricing_source: 'copilot-plan-policy@2026-09-09',
    provider: 'copilot',
    billing_mode: 'subscription_allowance_estimate',
    line_items: [
      { category: 'requests', quantity: 2, rate: '1', rate_denominator: 1, amount: '2' },
    ],
  });
});

test('validateTokenPricingSnapshot rejects overlapping aggregate and TTL cache-write rates', () => {
  assert.throws(
    () =>
      validateTokenPricingSnapshot({
        unit: 'USD',
        source: 'invalid-overlap',
        rates: [
          { category: 'cache_write_input_tokens', amount: '1', per: 1_000_000 },
          { category: 'cache_write_5m_input_tokens', amount: '1.25', per: 1_000_000 },
        ],
      }),
    /aggregate and TTL-specific cache-write rates cannot be combined/
  );
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
  assert.ok(
    capturedArgs.some(arg =>
      arg.includes('operation must be exactly "no_action" or "unscored_novel_strategy"')
    )
  );
});

test('createHeadlampCliCandidate: forwards provider configuration as CLI arguments', async () => {
  let capturedArgs: string[] = [];
  const candidate = createHeadlampCliCandidate({
    cliArgs: ['--provider', 'copilot', '--api-key', 'test-token'],
    processRunner: async (_command, args) => {
      capturedArgs = args;
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
    },
  });
  await candidate.invoke({ packet: scenario.candidatePacket, observations: [] });
  assert.deepEqual(capturedArgs.slice(1, 5), ['--provider', 'copilot', '--api-key', 'test-token']);
  assert.equal(candidate.identity?.provider, 'copilot');
  assert.equal(candidate.identity?.credential_configured, true);
  assert.equal(JSON.stringify(candidate.identity).includes('test-token'), false);
});

test('createHeadlampCliCandidate: a non-zero exit code is reported as unavailable, not a silent pass', async () => {
  const candidate = createHeadlampCliCandidate({
    processRunner: async () => ({ stdout: '', stderr: 'boom', exitCode: 1, timedOut: false }),
  });
  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations: [] });
  assert.equal(result.status, 'unavailable');
});

test('createHeadlampCliCandidate: an explicit CLI error with exit code zero is unavailable', async () => {
  const candidate = createHeadlampCliCandidate({
    processRunner: async () => ({
      stdout: '',
      stderr: 'Error: No AI provider configured.',
      exitCode: 0,
      timedOut: false,
    }),
  });
  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations: [] });
  assert.equal(result.status, 'unavailable');
  assert.match(result.raw_text, /No AI provider configured/);
});

test('createHeadlampCliCandidate: preserves successful diagnostic prose beginning with Error', async () => {
  const candidate = createHeadlampCliCandidate({
    processRunner: async () => ({
      stdout: 'Error: ImagePullBackOff detected on pod/x',
      stderr: '',
      exitCode: 0,
      timedOut: false,
    }),
  });
  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations: [] });
  assert.equal(result.status, 'ok');
});

test('createHeadlampCliCandidate: a timeout is reported as status timeout', async () => {
  const candidate = createHeadlampCliCandidate({
    processRunner: async () => ({
      stdout: 'partial output EVAL-CANARY',
      stderr: 'timed out',
      exitCode: 1,
      timedOut: true,
    }),
  });
  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations: [] });
  assert.equal(result.status, 'timeout');
  assert.equal(result.raw_text, 'partial output EVAL-CANARY\ntimed out');
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

test('createHeadlampCliCandidate: presents exact observation fields as JSON', async () => {
  let prompt = '';
  const candidate = createHeadlampCliCandidate({
    processRunner: async (_command, args) => {
      prompt = args.at(-1) ?? '';
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
    },
  });
  await candidate.invoke({
    packet: scenario.candidatePacket,
    observations: [
      {
        evidence_id: 'event_selector',
        resource_ref: 'service/web',
        field_path: 'spec.selector',
        value: '{"app":"web"}',
      },
    ],
  });
  assert.match(prompt, /"evidence_id": "event_selector"/);
  assert.match(prompt, /"observed_value": "{\\"app\\":\\"web\\"}"/);
  assert.doesNotMatch(prompt, /evidence:event_selector/);
  assert.match(prompt, /do not add prefixes, extract sub-fields, or reformat values/);
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
  assert.ok(observedEnv.KUBECONFIG);
  assert.equal(existsSync(observedEnv.KUBECONFIG ?? ''), false);
});

test('createHeadlampCliCandidate: preserves an explicitly supplied trial kubeconfig', async () => {
  let observedKubeconfig = '';
  const candidate = createHeadlampCliCandidate({
    processRunner: async (_command, _args, env) => {
      observedKubeconfig = env.KUBECONFIG ?? '';
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
    },
  });

  await candidate.invoke({
    packet: scenario.candidatePacket,
    observations: [],
    environment: { KUBECONFIG: '/trial/kubeconfig' },
  });
  assert.equal(observedKubeconfig, '/trial/kubeconfig');
});

test('createHeadlampCliCandidate: isolates and removes the child Headlamp data directory', async () => {
  let isolatedDataDir = '';
  const candidate = createHeadlampCliCandidate({
    processRunner: async (_command, _args, env) => {
      isolatedDataDir = env.HEADLAMP_DATA_DIR ?? '';
      assert.ok(isolatedDataDir);
      assert.equal(existsSync(isolatedDataDir), true);
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
    },
  });
  await candidate.invoke({
    packet: scenario.candidatePacket,
    observations: [],
    environment: { HEADLAMP_DATA_DIR: '/must-not-be-used' },
  });
  assert.equal(existsSync(isolatedDataDir), false);
});

test('createHeadlampCliCandidate reads private telemetry before removing its data directory', async () => {
  let telemetryPath = '';
  const candidate = createHeadlampCliCandidate({
    pricing: {
      currency: 'USD',
      source: 'test-prices',
      input_per_million: '2',
      output_per_million: '10',
      cache_read_input_per_million: '0.2',
      cache_creation_input_per_million: '2.5',
    },
    processRunner: async (_command, args) => {
      const telemetryIndex = args.indexOf('--telemetry-file');
      telemetryPath = args[telemetryIndex + 1] ?? '';
      writeFileSync(
        telemetryPath,
        `${JSON.stringify({
          type: 'model_usage',
          provider: 'openai',
          input_token_semantics: 'total_including_cache',
          input_tokens: 12,
          output_tokens: 4,
          total_tokens: 16,
        })}\n${JSON.stringify({
          type: 'tool_call',
          tool_name: 'kubernetes_api_request',
          mutating: false,
          status: 'success',
          duration_ns: '1000',
        })}\n${JSON.stringify({ type: 'turn_complete' })}\n`,
        { mode: 0o600 }
      );
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
    },
  });

  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations: [] });
  assert.deepEqual(result.token_usage, {
    input_tokens: 12,
    uncached_input_tokens: 12,
    output_tokens: 4,
    total_tokens: 16,
    request_count: 1,
  });
  assert.deepEqual(result.configured_usage_estimate, {
    amount: '0.000064',
    unit: 'USD',
    basis: 'configured_usage_pricing',
    pricing_source: 'test-prices',
    line_items: [
      {
        category: 'uncached_input_tokens',
        quantity: 12,
        rate: '2',
        rate_denominator: 1_000_000,
        amount: '0.000024',
      },
      {
        category: 'output_tokens',
        quantity: 4,
        rate: '10',
        rate_denominator: 1_000_000,
        amount: '0.00004',
      },
      {
        category: 'cache_read_input_tokens',
        quantity: 0,
        rate: '0.2',
        rate_denominator: 1_000_000,
        amount: '0',
      },
      {
        category: 'cache_write_input_tokens',
        quantity: 0,
        rate: '2.5',
        rate_denominator: 1_000_000,
        amount: '0',
      },
    ],
  });
  assert.deepEqual(result.tool_events, [
    {
      tool_name: 'kubernetes_api_request',
      mutating: false,
      status: 'success',
      duration_ns: '1000',
    },
  ]);
  assert.equal(existsSync(telemetryPath), false);
});

test('createHeadlampCliCandidate keeps tool observability unknown without valid telemetry', async () => {
  const candidate = createHeadlampCliCandidate({
    processRunner: async () => ({ stdout: '', stderr: '', exitCode: 0, timedOut: false }),
  });
  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations: [] });
  assert.equal(result.tool_events, undefined);
  assert.equal(result.token_usage, undefined);
});

test('createHeadlampCliCandidate does not infer tool observability from model usage', async () => {
  const candidate = createHeadlampCliCandidate({
    processRunner: async (_command, args) => {
      const telemetryPath = args[args.indexOf('--telemetry-file') + 1] ?? '';
      writeFileSync(
        telemetryPath,
        `${JSON.stringify({
          type: 'model_usage',
          provider: 'copilot',
          input_token_semantics: 'total_including_cache',
          input_tokens: 12,
          output_tokens: 4,
          total_tokens: 16,
        })}\n`,
        { mode: 0o600 }
      );
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
    },
  });

  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations: [] });
  assert.deepEqual(result.token_usage, {
    input_tokens: 12,
    uncached_input_tokens: 12,
    output_tokens: 4,
    total_tokens: 16,
    request_count: 1,
  });
  assert.equal(result.tool_events, undefined);
});

test('createHeadlampCliCandidate reports zero tool calls for a completed telemetry stream', async () => {
  const candidate = createHeadlampCliCandidate({
    processRunner: async (_command, args) => {
      const telemetryPath = args[args.indexOf('--telemetry-file') + 1] ?? '';
      writeFileSync(telemetryPath, `${JSON.stringify({ type: 'turn_complete' })}\n`, {
        mode: 0o600,
      });
      return { stdout: '', stderr: '', exitCode: 0, timedOut: false };
    },
  });

  const result = await candidate.invoke({ packet: scenario.candidatePacket, observations: [] });

  assert.deepEqual(result.tool_events, []);
});
