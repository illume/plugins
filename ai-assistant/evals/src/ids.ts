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
 * Returns a lexicographically sortable, monotonically increasing ID with the
 * given prefix. The sortable wall-clock/counter prefix preserves local
 * ordering, while UUID entropy prevents collisions between concurrent
 * processes.
 */
export function generateId(prefix: string): string {
  counter += 1;
  const time = Date.now().toString(36).padStart(9, '0');
  const seq = counter.toString(36).padStart(6, '0');
  return `${prefix}_${time}${seq}_${randomUUID()}`;
}

/** Returns a random opaque UUID-based ID with the given prefix. */
export function generateOpaqueId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function runId(): string {
  return generateId('run');
}

export function trialId(): string {
  return generateId('trial');
}

export function attemptId(): string {
  return generateId('attempt');
}

export function eventId(): string {
  return generateId('event');
}

export function recordId(): string {
  return generateId('record');
}

export function artifactId(): string {
  return generateId('artifact');
}

export function reportId(): string {
  return generateId('report');
}

export function exportId(): string {
  return generateId('export');
}

export function publicationId(): string {
  return generateId('pub');
}
