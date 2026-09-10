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

import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createJsonlTelemetryObserver } from './telemetry.js';

describe('createJsonlTelemetryObserver', () => {
  it('writes sanitized events to a private JSONL file', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'headlamp-ai-telemetry-'));
    const filePath = path.join(directory, 'events.jsonl');
    try {
      writeFileSync(filePath, 'old data', { mode: 0o644 });
      chmodSync(filePath, 0o644);
      const observe = createJsonlTelemetryObserver(filePath);
      observe({
        type: 'model_usage',
        provider: 'copilot',
        input_token_semantics: 'total_including_cache',
        input_tokens: 12,
        output_tokens: 3,
        total_tokens: 15,
      });
      observe({
        type: 'tool_call',
        tool_name: 'kubernetes_api_request',
        mutating: false,
        status: 'success',
        duration_ns: '1000',
      });

      const events = readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line));
      expect(events).toHaveLength(2);
      expect(events[0].total_tokens).toBe(15);
      expect(events[1].tool_name).toBe('kubernetes_api_request');
      expect(statSync(filePath).mode & 0o077).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
