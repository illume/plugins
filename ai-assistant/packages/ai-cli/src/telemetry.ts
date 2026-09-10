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

import type { AssistantTelemetryObserver } from '@headlamp-k8s/ai-common/assistant/telemetry';
import { appendFileSync, chmodSync, writeFileSync } from 'node:fs';

/** Creates a private JSONL sink containing sanitized runtime metadata only. */
export function createJsonlTelemetryObserver(filePath: string): AssistantTelemetryObserver {
  writeFileSync(filePath, '', { encoding: 'utf8', mode: 0o600 });
  chmodSync(filePath, 0o600);
  return event => appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf8');
}
