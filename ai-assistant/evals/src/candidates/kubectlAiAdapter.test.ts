import assert from 'node:assert/strict';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadScenario } from '../scenarios/loader.js';
import { diagnosisInstruction } from './holmesGptAdapter.js';
import {
  buildKubectlAiPrompt,
  createKubectlAiCandidate,
  createKubectlAiQualificationTarget,
  type KubectlAiProcessRunner,
  parseKubectlAiSession,
} from './kubectlAiAdapter.js';
import { qualifyReferenceAdapter } from './referenceQualification.js';

const options = {
  image: `sha256:${'a'.repeat(64)}`,
  model: 'gpt-4o',
  apiKey: 'test-private-key',
  endpoint: 'https://example.openai.azure.com',
};
const input = {
  packet: loadScenario('core-service-selector-fault-v1').candidatePacket,
  observations: [],
  evidence_digest: 'b'.repeat(64),
};
const submission = '{"schema_version":"1.0.0"}';

test('kubectl-ai qualifies its actual session normalizer and rejects changed evidence or failed lifecycle controls', async () => {
  const evidenceInput = {
    ...input,
    observations: [
      {
        evidence_id: 'exact-event',
        resource_ref: 'service/web',
        field_path: 'spec.selector',
        value: '{"tier":"frontend"}',
      },
    ],
  };
  const diagnosis = {
    schema_version: '1.0.0',
    cause_facts: [
      {
        resource_ref: 'service/web',
        field_path: 'spec.selector',
        observed_value: '{"tier":"frontend"}',
      },
    ],
    resource_refs: ['service/web'],
    evidence_refs: ['exact-event'],
    alternative_dispositions: [],
    uncertainty: { is_uncertain: false },
    proposed_actions: [{ operation: 'no_action', description: 'Read-only diagnosis' }],
  };
  for (const mode of [
    'valid',
    'wrong-input',
    'changed-evidence',
    'native-error',
    'startup',
    'health',
    'cleanup',
  ] as const) {
    const calls: string[][] = [];
    const runner: KubectlAiProcessRunner = (_command, args) => {
      calls.push(args);
      const failed =
        (mode === 'startup' && args[0] === 'image') || (mode === 'cleanup' && args[0] === 'rm');
      return {
        status: failed ? 1 : 0,
        stderr: '',
        stdout:
          mode === 'health'
            ? 'wrong version'
            : 'version: 0.0.31\ncommit: 08cf256aa2f5749958f76659134625fe70a19a15',
      };
    };
    const output = structuredClone(diagnosis);
    if (mode === 'changed-evidence') output.evidence_refs = ['altered-event'];
    const messages = [
      {
        Source: 'user',
        Type: 'text',
        Payload: mode === 'wrong-input' ? 'other input' : buildKubectlAiPrompt(evidenceInput),
      },
      { Source: 'model', Type: 'text', Payload: `\`\`\`json\n${JSON.stringify(output)}\n\`\`\`` },
    ];
    if (mode === 'native-error')
      messages.push({ Source: 'agent', Type: 'error', Payload: 'denied' });
    const result = await qualifyReferenceAdapter(
      createKubectlAiQualificationTarget(options.image, runner),
      evidenceInput,
      {
        native_output: messages.map(message => JSON.stringify(message)).join('\n'),
        expected_submission: JSON.stringify(diagnosis),
      }
    );
    assert.equal(result.status, mode === 'valid' ? 'eligible' : 'ineligible', mode);
    if (mode !== 'startup') assert.ok(calls.some(args => args[0] === 'rm'));
    if (mode === 'changed-evidence')
      assert.match(result.reasons.join(' '), /changed the fixed structured submission/);
  }
});

test('kubectl-ai validates immutable identity and bounded provider configuration', () => {
  for (const changed of [
    { image: 'example:latest' },
    { model: '' },
    { apiKey: '' },
    { endpoint: 'http://example.com' },
    { endpoint: 'https://key@example.com' },
    { timeoutMs: 0 },
    { timeoutMs: 90_001 },
  ]) {
    assert.throws(() => createKubectlAiCandidate({ ...options, ...changed }));
  }
});

test('kubectl-ai rejects missing, malformed, and non-text final sessions', () => {
  for (const history of ['', 'null', '{}', '{"Source":"model","Type":"text","Payload":12}']) {
    assert.throws(() => parseKubectlAiSession(history));
  }
  const session = parseKubectlAiSession(
    JSON.stringify({ Source: 'user', Type: 'text', Payload: 'prompt' })
  );
  assert.equal(session.finalText, null);
});

test('kubectl-ai keeps exact answers, errors, timeouts, and unobservable sessions distinct', async () => {
  for (const mode of [
    'json',
    'fenced',
    'prose',
    'timeout',
    'exit-error',
    'permission',
    'tool',
    'missing',
    'malformed',
    'mismatch',
    'duplicate',
    'cleanup-error',
  ] as const) {
    let directory = '';
    let removed = false;
    const runner: KubectlAiProcessRunner = (_command, args, settings) => {
      if (args[0] === 'rm') {
        removed = true;
        return { status: mode === 'cleanup-error' ? 1 : 0, stdout: '', stderr: 'cleanup response' };
      }
      assert.ok(args.includes('--read-only'));
      assert.equal(args.includes('--rm'), false);
      assert.ok(args.includes('PATH=/unavailable'));
      assert.ok(args.includes('--interactive'));
      assert.equal(args.includes(options.apiKey), false);
      assert.equal(
        args.some(argument => argument.includes('--kubeconfig')),
        false
      );
      assert.ok(settings.input?.endsWith(diagnosisInstruction));
      assert.equal(settings.timeout, 90_000);
      assert.equal(settings.env?.AZURE_OPENAI_API_KEY, options.apiKey);
      directory = args[args.indexOf('--mount') + 1]!.slice('type=bind,src='.length).replace(
        ',dst=/output',
        ''
      );
      assert.equal(statSync(directory).mode & 0o777, 0o700);
      const messages = [
        {
          Source: 'user',
          Type: 'text',
          Payload: mode === 'mismatch' ? 'other prompt' : settings.input,
        },
      ];
      if (!['timeout', 'missing'].includes(mode))
        messages.push({
          Source: 'model',
          Type: 'text',
          Payload:
            mode === 'prose'
              ? 'No structured answer'
              : mode === 'fenced'
              ? `\`\`\`json\n${submission}\n\`\`\``
              : submission,
        });
      if (mode === 'permission')
        messages.push({
          Source: 'agent',
          Type: 'error',
          Payload: 'RunOnce mode cannot handle permission requests. Example',
        });
      if (mode === 'tool')
        messages.push({ Source: 'model', Type: 'tool-call-request', Payload: 'kubectl get pods' });
      if (mode !== 'missing') {
        const sessionPath = path.join(directory, '.kubectl-ai/sessions/one');
        mkdirSync(sessionPath, { recursive: true });
        writeFileSync(
          path.join(sessionPath, 'history.json'),
          mode === 'malformed'
            ? 'null'
            : messages.map(message => JSON.stringify(message)).join('\n')
        );
        if (mode === 'duplicate') {
          mkdirSync(path.join(directory, '.kubectl-ai/sessions/two'));
          writeFileSync(path.join(directory, '.kubectl-ai/sessions/two/history.json'), '');
        }
      }
      return {
        status: mode === 'exit-error' ? 1 : mode === 'timeout' ? null : 0,
        stdout: options.apiKey,
        stderr: '',
        ...(mode === 'timeout'
          ? { error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) }
          : {}),
      };
    };
    const invocation = createKubectlAiCandidate({ ...options, runner }).invoke(input);
    if (mode === 'cleanup-error') {
      await assert.rejects(invocation, /cleanup could not be verified/);
    } else {
      const result = await invocation;
      assert.equal(
        result.status,
        mode === 'timeout'
          ? 'timeout'
          : ['json', 'fenced', 'prose'].includes(mode)
          ? 'ok'
          : 'unavailable',
        mode
      );
      assert.equal(
        result.submission_text,
        ['json', 'fenced'].includes(mode) ? submission : null,
        mode
      );
      assert.equal(result.token_usage, undefined);
      assert.equal(result.model_invocations, undefined);
      assert.equal(result.raw_text.includes(options.apiKey), false);
      if (['missing', 'malformed', 'mismatch', 'duplicate'].includes(mode))
        assert.equal(result.tool_events, undefined);
      if (['permission', 'tool'].includes(mode))
        assert.deepEqual(result.tool_events, [
          { tool_name: 'kubectl-ai.local-tool', mutating: true, status: 'denied' },
        ]);
    }
    assert.equal(removed, true);
    assert.equal(existsSync(directory), false);
  }
});
