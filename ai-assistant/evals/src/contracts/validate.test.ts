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

const schema = {
  type: 'object',
  required: ['name', 'kind'],
  properties: {
    name: { type: 'string' },
    kind: { type: 'string', enum: ['a', 'b'] },
    count: { type: 'number' },
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
