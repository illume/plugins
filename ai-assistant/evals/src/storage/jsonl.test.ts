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
import path from 'node:path';
import { JsonlWriter, readJsonl, readJsonlPayloads } from './jsonl.js';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratchDir.js';

test('JsonlWriter: appends records with a monotonic sequence and hash-chained digests', () => {
  const dir = makeScratchDir('jsonl');
  try {
    const filePath = path.join(dir, 'stream.jsonl');
    const writer = new JsonlWriter<{ n: number }>(
      filePath,
      'https://example/schema.json',
      '1.0.0',
      'test'
    );
    const r1 = writer.append({ n: 1 });
    const r2 = writer.append({ n: 2 });
    assert.equal(r1.sequence, 1);
    assert.equal(r2.sequence, 2);
    assert.equal(r1.previous_record_digest, null);
    assert.equal(r2.previous_record_digest, r1.payload_digest);
    assert.equal(writer.recordCount, 2);

    const records = readJsonl<{ n: number }>(filePath);
    assert.equal(records.length, 2);
    assert.deepEqual(
      records.map(r => r.payload),
      [{ n: 1 }, { n: 2 }]
    );
  } finally {
    removeScratchDir(dir);
  }
});

test('readJsonl: returns an empty array for a stream that was never created', () => {
  const dir = makeScratchDir('jsonl-missing');
  try {
    const records = readJsonl(path.join(dir, 'does-not-exist.jsonl'));
    assert.deepEqual(records, []);
  } finally {
    removeScratchDir(dir);
  }
});

test('readJsonlPayloads: extracts only the payload field, discarding the envelope', () => {
  const dir = makeScratchDir('jsonl-payloads');
  try {
    const filePath = path.join(dir, 'stream.jsonl');
    const writer = new JsonlWriter<{ v: string }>(
      filePath,
      'https://example/schema.json',
      '1.0.0',
      'test'
    );
    writer.append({ v: 'a' });
    writer.append({ v: 'b' });
    assert.deepEqual(readJsonlPayloads<{ v: string }>(filePath), [{ v: 'a' }, { v: 'b' }]);
  } finally {
    removeScratchDir(dir);
  }
});

test('two writers producing the same payload sequence emit identical payload digests', () => {
  const dirA = makeScratchDir('jsonl-det-a');
  const dirB = makeScratchDir('jsonl-det-b');
  try {
    const writerA = new JsonlWriter<{ x: number }>(
      path.join(dirA, 's.jsonl'),
      'https://example/schema.json',
      '1.0.0',
      'p'
    );
    const writerB = new JsonlWriter<{ x: number }>(
      path.join(dirB, 's.jsonl'),
      'https://example/schema.json',
      '1.0.0',
      'p'
    );
    const a = writerA.append({ x: 42 });
    const b = writerB.append({ x: 42 });
    assert.equal(a.payload_digest, b.payload_digest);
  } finally {
    removeScratchDir(dirA);
    removeScratchDir(dirB);
  }
});
