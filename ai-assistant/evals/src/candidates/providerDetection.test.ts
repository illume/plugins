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
import { parseProviderDetectionOutput } from './providerDetection.js';

test('parseProviderDetectionOutput accepts diagnostics before the JSON payload', () => {
  const providers = parseProviderDetectionOutput(
    'Detecting available AI providers...\n[ai-assistant] scanning\n' +
      '[{"providerId":"azure","config":{"deploymentName":"gpt-4.1"}}]\n'
  );
  assert.equal(providers[0]?.providerId, 'azure');
  assert.equal(providers[0]?.config.deploymentName, 'gpt-4.1');
});

test('parseProviderDetectionOutput rejects output without a provider array', () => {
  assert.throws(
    () => parseProviderDetectionOutput('Detecting available AI providers...'),
    /did not emit a valid JSON array/
  );
});

test('parseProviderDetectionOutput rejects null and array provider configs', () => {
  for (const config of ['null', '[]']) {
    assert.throws(
      () => parseProviderDetectionOutput(`[{"providerId":"azure","config":${config}}]`),
      /did not emit a valid JSON array/
    );
  }
});
