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

import { runKubectl } from './kubectl.ts';

interface KubernetesEventList {
  items?: unknown[];
}

/** Normalized actionable Kubernetes Warning event used as one batch issue. */
export interface ActionableKubernetesEvent {
  uid: string;
  name: string;
  namespace: string;
  reason: string;
  message: string;
  count: number;
  lastSeen: string;
  objectKind: string;
  objectName: string;
  objectNamespace: string;
  eventType: string;
}

export interface EventDiscoveryOptions {
  sinceMs: number;
  limit: number;
  now?: number;
  run?: typeof runKubectl;
  signal?: AbortSignal;
}

const generatedSuffix = /-[a-z0-9]{4,10}$/;

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function rootResourceName(name: string): string {
  let result = name;
  while (generatedSuffix.test(result) && /\d/.test(result.slice(result.lastIndexOf('-') + 1))) {
    result = result.replace(generatedSuffix, '');
  }
  return result;
}

/** Fetches, ranks, and deduplicates recent Warning events from the active context. */
export async function discoverActionableEvents(
  options: EventDiscoveryOptions
): Promise<ActionableKubernetesEvent[]> {
  const run = options.run ?? runKubectl;
  const output = await run(
    ['get', '--raw', '/api/v1/events?fieldSelector=type%21%3DNormal&limit=50'],
    undefined,
    options.signal
  );
  const parsed = JSON.parse(output) as KubernetesEventList;
  if (!Array.isArray(parsed.items))
    throw new Error('Kubernetes events response has no items array');
  const cutoff = (options.now ?? Date.now()) - options.sinceMs;
  const normalized = parsed.items
    .map(item => {
      const event = record(item);
      const metadata = record(event.metadata);
      const involvedObject = record(event.involvedObject);
      const series = record(event.series);
      const lastSeen =
        text(series.lastObservedTime) ||
        text(event.eventTime) ||
        text(event.lastTimestamp) ||
        text(metadata.creationTimestamp);
      return {
        uid: text(metadata.uid) || text(metadata.name),
        name: text(metadata.name),
        namespace: text(metadata.namespace),
        reason: text(event.reason),
        message: text(event.message),
        count:
          typeof event.count === 'number' && Number.isSafeInteger(event.count) ? event.count : 1,
        lastSeen,
        objectKind: text(involvedObject.kind),
        objectName: text(involvedObject.name),
        objectNamespace: text(involvedObject.namespace),
        eventType: text(event.type),
      } satisfies ActionableKubernetesEvent;
    })
    .filter(
      event => event.eventType === 'Warning' && event.uid && Date.parse(event.lastSeen) >= cutoff
    )
    .sort((left, right) => {
      const timeDifference = Date.parse(right.lastSeen) - Date.parse(left.lastSeen);
      return timeDifference || right.count - left.count || left.uid.localeCompare(right.uid);
    });

  const seen = new Set<string>();
  return normalized
    .filter(event => {
      const key = `${event.objectNamespace || '_'}/${rootResourceName(event.objectName)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, options.limit);
}

/** Builds an investigation prompt for one event without granting mutation authority. */
export function buildEventDiagnosisPrompt(event: ActionableKubernetesEvent): string {
  return [
    'Diagnose this recent Kubernetes Warning event.',
    'Use read-only Kubernetes API requests to inspect the involved object and related resources.',
    'State the supported root cause, impact, evidence, uncertainty, and safe remediation steps.',
    'Do not mutate the cluster.',
    '',
    JSON.stringify(event, null, 2),
  ].join('\n');
}
