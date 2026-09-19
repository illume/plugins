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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertCopilotModelAvailable,
  listCopilotChatModels,
  selectPreferredCopilotModel,
} from './copilotCatalog.js';

function catalogFetch(models: unknown[], status = 200): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ data: models }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

test('Copilot model preflight accepts an enabled chat model', async () => {
  await assert.doesNotReject(
    assertCopilotModelAvailable(
      'token',
      'claude-opus-4.7',
      catalogFetch([{ id: 'claude-opus-4.7', capabilities: { type: 'chat' } }])
    )
  );
});

test('Copilot model preflight rejects a removed model and lists enabled successors', async () => {
  await assert.rejects(
    assertCopilotModelAvailable(
      'token',
      'claude-opus-4.6',
      catalogFetch([
        { id: 'claude-opus-4.7', capabilities: { type: 'chat' } },
        { id: 'embedding-model', capabilities: { type: 'embeddings' } },
      ])
    ),
    /claude-opus-4\.6 is not enabled.*claude-opus-4\.7/
  );
});

test('Copilot model preflight fails closed when the catalog is unavailable', async () => {
  await assert.rejects(
    assertCopilotModelAvailable('token', 'claude-opus-4.7', catalogFetch([], 503)),
    /catalog returned HTTP 503/
  );
});

test('Copilot catalog listing excludes non-chat entries', async () => {
  const models = await listCopilotChatModels(
    'token',
    catalogFetch([
      { id: 'gpt-5.4', capabilities: { type: 'chat' } },
      { id: 'embedding-model', capabilities: { type: 'embeddings' } },
    ])
  );
  assert.deepEqual(models, ['gpt-5.4']);
});

test('preferred Copilot selection uses exact gpt-5.4 then existing family fallback', () => {
  assert.equal(selectPreferredCopilotModel(['claude-opus-5', 'gpt-5.4']), 'gpt-5.4');
  assert.equal(selectPreferredCopilotModel(['gpt-5.3-codex', 'claude-opus-5']), 'claude-opus-5');
});
