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
import { canonicalStringify, digestRef, sha256OfJson, sha256OfText } from './canonical-json.js';

test('canonicalStringify sorts object keys regardless of input order', () => {
  const a = canonicalStringify({ b: 1, a: 2, c: { z: 1, y: 2 } });
  const b = canonicalStringify({ c: { y: 2, z: 1 }, a: 2, b: 1 });
  assert.equal(a, b);
});

test('canonicalStringify recursively sorts array elements without reordering them', () => {
  const text = canonicalStringify([
    { b: 1, a: 2 },
    { d: 1, c: 2 },
  ]);
  assert.equal(text, '[{"a":2,"b":1},{"c":2,"d":1}]');
});

test('sha256OfJson is deterministic across key order', () => {
  const digestA = sha256OfJson({ x: 1, y: 2 });
  const digestB = sha256OfJson({ y: 2, x: 1 });
  assert.equal(digestA, digestB);
  assert.equal(digestA.length, 64);
});

test('sha256OfJson changes when a value changes', () => {
  const digestA = sha256OfJson({ x: 1 });
  const digestB = sha256OfJson({ x: 2 });
  assert.notEqual(digestA, digestB);
});

test('sha256OfText matches a known SHA-256 vector', () => {
  // echo -n "" | sha256sum
  assert.equal(
    sha256OfText(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
});

test('digestRef formats as sha256:<hex>', () => {
  assert.equal(digestRef('abc'), 'sha256:abc');
});
