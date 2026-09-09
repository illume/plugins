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

/**
 * Stable-identity helpers for the canonical result bundle.
 *
 * The bundle's identity spine is
 * `experiment_id -> run_id -> trial_id -> attempt_id -> event_id`, with
 * sibling stable IDs for `scenario`, `candidate`, `environment`, and
 * `artifact`. IDs are opaque, monotonically-orderable strings; a display
 * name, array position, or filename is never a canonical identity.
 */

import { randomUUID } from 'node:crypto';

let counter = 0;

/**
 * Generates an ID whose wall-clock and process-local sequence prefix sorts
 * calls made by this process in creation order. UUID entropy prevents two
 * processes from relying on synchronized clocks for uniqueness; the ordering
 * guarantee itself is not a distributed coordination primitive.
 *
 * @param prefix - Domain prefix for the generated ID.
 * @returns `<prefix>_<base36 timestamp><base36 sequence>_<UUID>`.
 */
export function generateId(prefix: string): string {
  counter += 1;
  const time = Date.now().toString(36).padStart(9, '0');
  const seq = counter.toString(36).padStart(6, '0');
  return `${prefix}_${time}${seq}_${randomUUID()}`;
}

/**
 * Generates a stable run identifier.
 *
 * @returns A new run identifier.
 */
export function runId(): string {
  return generateId('run');
}

/**
 * Generates a stable trial identifier.
 *
 * @returns A new trial identifier.
 */
export function trialId(): string {
  return generateId('trial');
}

/**
 * Generates a stable attempt identifier.
 *
 * @returns A new attempt identifier.
 */
export function attemptId(): string {
  return generateId('attempt');
}

/**
 * Generates a stable trajectory event identifier.
 *
 * @returns A new trajectory event identifier.
 */
export function eventId(): string {
  return generateId('event');
}

/**
 * Generates a stable record identifier.
 *
 * @returns A new record identifier.
 */
export function recordId(): string {
  return generateId('record');
}

/**
 * Generates a stable artifact identifier.
 *
 * @returns A new artifact identifier.
 */
export function artifactId(): string {
  return generateId('artifact');
}

/**
 * Generates a stable export identifier.
 *
 * @returns A new export identifier.
 */
export function exportId(): string {
  return generateId('export');
}

/**
 * Generates a stable publication identifier.
 *
 * @returns A new publication identifier.
 */
export function publicationId(): string {
  return generateId('pub');
}
