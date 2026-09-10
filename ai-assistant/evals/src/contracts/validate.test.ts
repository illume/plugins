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
import { assertValid, validate } from './validate.js';
import { makeTrialResult } from '../test-helpers/trialResult.js';
import { loadSchema } from './schemas.js';

const schema = {
  type: 'object',
  required: ['name', 'kind'],
  properties: {
    name: { type: 'string' },
    kind: { type: 'string', enum: ['a', 'b'] },
    count: { type: 'integer', minimum: 0 },
    tags: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
};

test('validate accepts a conforming object', () => {
  const result = validate(schema, { name: 'x', kind: 'a', count: 1, tags: ['t1'] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test('validate reports a missing required property', () => {
  const result = validate(schema, { kind: 'a' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.path === '$.name'));
});

test('validate reports a value outside its enum', () => {
  const result = validate(schema, { name: 'x', kind: 'z' });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.message.includes('enum')));
});

test('validate reports a wrong-typed field', () => {
  const result = validate(schema, { name: 'x', kind: 'a', count: 'not-a-number' });
  assert.equal(result.valid, false);
});

test('validate enforces integer and minimum constraints', () => {
  assert.equal(validate(schema, { name: 'x', kind: 'a', count: 1.5 }).valid, false);
  assert.equal(validate(schema, { name: 'x', kind: 'a', count: -1 }).valid, false);
  assert.equal(validate(schema, { name: 'x', kind: 'a', count: 0 }).valid, true);
});

test('validate reports an unexpected additional property when additionalProperties is false', () => {
  const result = validate(schema, { name: 'x', kind: 'a', extra: true });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.message.includes('additional')));
});

test('validate recurses into array items', () => {
  const result = validate(schema, { name: 'x', kind: 'a', tags: [1, 2] });
  assert.equal(result.valid, false);
});

test('assertValid throws with a descriptive message on failure', () => {
  assert.throws(
    () => assertValid(schema, { kind: 'a' }, 'my object'),
    /my object failed schema validation/
  );
});

test('assertValid does not throw on a valid object', () => {
  assert.doesNotThrow(() => assertValid(schema, { name: 'x', kind: 'b' }, 'my object'));
});

test('trial-result schema rejects retired aliases and invalid token counts', () => {
  const trialSchema = loadSchema('trial-result');
  const trial = makeTrialResult();
  assert.equal(validate(trialSchema, trial).valid, true);
  assert.equal(validate(trialSchema, { ...trial, root_cause_found: true }).valid, false);
  assert.equal(
    validate(trialSchema, {
      ...trial,
      model_usage: { input_tokens: 1.5, output_tokens: 0, total_tokens: -1 },
    }).valid,
    false
  );
});

test('trial-result schema requires configured usage estimate presence', () => {
  const trial = makeTrialResult();
  const { configured_usage_estimate: _configuredUsageEstimate, ...missingEstimate } = trial;
  assert.equal(validate(loadSchema('trial-result'), missingEstimate).valid, false);
});

test('trial-result schema rejects unsafe timing and tool summaries', () => {
  const trial = makeTrialResult();
  const schema = loadSchema('trial-result');
  assert.equal(validate(schema, { ...trial, timing: {} }).valid, false);
  assert.equal(
    validate(schema, {
      ...trial,
      timing: { time_to_diagnosis_ns: 'not-a-duration', time_to_resolution_ns: null },
    }).valid,
    false
  );
  assert.equal(
    validate(schema, {
      ...trial,
      timing: { time_to_diagnosis_ns: '100', time_to_resolution_ns: '200' },
    }).valid,
    false
  );
  assert.equal(
    validate(schema, {
      ...trial,
      timing: {
        time_to_diagnosis_ns: '100',
        time_to_resolution_ns: null,
        unexpected: true,
      },
    }).valid,
    false
  );
  assert.equal(validate(schema, { ...trial, tool_summary: {} }).valid, false);
  assert.equal(
    validate(schema, {
      ...trial,
      tool_summary: { ...trial.tool_summary, failed: -1, total_duration_ns: 'invalid' },
    }).valid,
    false
  );
  assert.equal(
    validate(schema, {
      ...trial,
      tool_summary: { ...trial.tool_summary, unexpected: true },
    }).valid,
    false
  );
});
