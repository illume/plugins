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

import { describe, expect, it, rs } from '@rstest/core';
import { buildEventDiagnosisPrompt, discoverActionableEvents } from './eventDiagnosis.ts';

describe('discoverActionableEvents', () => {
  it('keeps recent warnings, ranks by time, and deduplicates root workloads', async () => {
    const run = rs.fn(async () =>
      JSON.stringify({
        items: [
          event('new-pod', 'app-7b8d9c5f6d-xk4z2', '2026-09-19T10:00:00Z', 2),
          event('same-app', 'app-7b8d9c5f6d', '2026-09-19T09:59:00Z', 10),
          event('old', 'old-app', '2026-09-19T08:00:00Z', 1),
          { ...event('normal', 'healthy-app', '2026-09-19T10:05:00Z', 1), type: 'Normal' },
        ],
      })
    );

    const result = await discoverActionableEvents({
      sinceMs: 30 * 60 * 1000,
      limit: 10,
      now: Date.parse('2026-09-19T10:10:00Z'),
      run,
    });

    expect(result.map(item => item.uid)).toEqual(['new-pod']);
    expect(run).toHaveBeenCalledWith(
      ['get', '--raw', '/api/v1/events?fieldSelector=type%21%3DNormal&limit=50'],
      undefined,
      undefined
    );
    expect(buildEventDiagnosisPrompt(result[0]!)).toContain('Do not mutate the cluster');
  });
});

function event(uid: string, objectName: string, lastTimestamp: string, count: number) {
  return {
    metadata: { uid, name: uid, namespace: 'default' },
    type: 'Warning',
    reason: 'Failed',
    message: 'Something failed',
    count,
    lastTimestamp,
    involvedObject: { kind: 'Pod', name: objectName, namespace: 'default' },
  };
}
