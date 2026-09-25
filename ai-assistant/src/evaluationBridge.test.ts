/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { AssistantTelemetryEvent } from '@headlamp-k8s/ai-common/assistant/telemetry';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserEvaluationBridge, installBrowserEvaluationBridge } from './evaluationBridge';

describe('browser evaluation bridge', () => {
  afterEach(() => {
    delete window.__headlampAiEvaluator;
  });

  it('invokes one harness session and returns sanitized telemetry', async () => {
    const abort = vi.fn();
    const userSend = vi.fn(async () => ({ content: '{"schema_version":"1.0.0"}' }));
    const setContext = vi.fn();
    const observations = [
      {
        evidence_id: 'pod-phase',
        resource_ref: 'pod/web',
        field_path: 'status.phase',
        observed_value: 'Pending',
      },
    ];
    const createSession = vi.fn((_providerId, _config, _observations, observe) => {
      observe({ type: 'turn_complete' } satisfies AssistantTelemetryEvent);
      return { userSend, abort, setContext };
    });
    const bridge = createBrowserEvaluationBridge(createSession);

    await expect(
      bridge.invoke({
        providerId: 'copilot',
        config: { apiKey: 'secret' },
        prompt: 'diagnose',
        observations,
      })
    ).resolves.toEqual({
      response: '{"schema_version":"1.0.0"}',
      telemetry: [{ type: 'turn_complete' }],
    });
    expect(createSession).toHaveBeenCalledWith(
      'copilot',
      { apiKey: 'secret' },
      observations,
      expect.any(Function)
    );
    expect(setContext).toHaveBeenCalledWith(
      expect.stringContaining('complete authorized evidence')
    );
    expect(userSend).toHaveBeenCalledWith('diagnose');
  });

  it('aborts the active invocation and rejects overlapping work', async () => {
    let finish!: (value: { content: string }) => void;
    const abort = vi.fn();
    const bridge = createBrowserEvaluationBridge(() => ({
      abort,
      setContext: vi.fn(),
      userSend: () => new Promise(resolve => (finish = resolve)),
    }));
    const running = bridge.invoke({
      providerId: 'copilot',
      config: {},
      prompt: 'first',
      observations: [],
    });

    await expect(
      bridge.invoke({
        providerId: 'copilot',
        config: {},
        prompt: 'second',
        observations: [],
      })
    ).rejects.toThrow('already running');
    bridge.abort();
    expect(abort).toHaveBeenCalledOnce();
    finish({ content: 'done' });
    await running;
  });

  it('installs only when evaluator mode is explicit', () => {
    installBrowserEvaluationBridge('?other=1');
    expect(window.__headlampAiEvaluator).toBeUndefined();

    installBrowserEvaluationBridge('?headlamp-ai-eval=1');
    expect(window.__headlampAiEvaluator).toBeDefined();
  });
});
