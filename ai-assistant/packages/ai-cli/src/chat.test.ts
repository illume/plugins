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

import AgentHarnessSession from '@headlamp-k8s/ai-common/assistant/AgentHarnessSession';
import LangChainAssistantSession from '@headlamp-k8s/ai-common/assistant/LangChainAssistantSession';
import { execFile } from 'child_process';
import { FakeToolCallingModel } from 'langchain';
import { describe, expect, it, vi } from 'vitest';
import { createManager, detectKubectlContext, query } from './chat.js';

vi.mock('child_process', () => ({
  // kubectl.ts no longer uses execFileSync (see kubectl.ts), but other
  // callers such as model.ts's provider detection still do, so this guards
  // against any of them unexpectedly shelling out during these tests.
  execFileSync: vi.fn(() => {
    throw new Error('real kubectl must not be invoked when --mock-tools is set');
  }),
  execFile: vi.fn(() => {
    throw new Error('real kubectl must not be invoked when --mock-tools is set');
  }),
}));

describe('chat', () => {
  it('exports a query function', () => {
    expect(typeof query).toBe('function');
  });

  it('reads the active cluster and namespace from structured kubeconfig output', () => {
    const run = vi.fn().mockReturnValue(
      JSON.stringify({
        contexts: [{ context: { cluster: 'trial', namespace: 'eval-selector-fault' } }],
      })
    );
    expect(detectKubectlContext(run)).toEqual({
      cluster: 'trial',
      namespace: 'eval-selector-fault',
    });
    expect(run).toHaveBeenCalledWith('kubectl', ['config', 'view', '--minify', '-o', 'json'], {
      encoding: 'utf8',
    });
  });

  it('uses the Kubernetes default namespace only when the context omits one', () => {
    const run = vi
      .fn()
      .mockReturnValue(JSON.stringify({ contexts: [{ context: { cluster: 'local' } }] }));
    expect(detectKubectlContext(run)).toEqual({ cluster: 'local', namespace: 'default' });
  });

  it('returns undefined when kubectl context detection fails', () => {
    const run = vi.fn().mockImplementation(() => {
      throw new Error('kubectl unavailable');
    });
    expect(detectKubectlContext(run)).toBeUndefined();
  });

  it('uses the agent harness by default and supports the legacy session explicitly', async () => {
    const harness = await createManager('mock-testing-model', {}, { mockTools: true });
    const legacy = await createManager(
      'mock-testing-model',
      {},
      {
        mockTools: true,
        legacySession: true,
      }
    );

    expect(harness).toBeInstanceOf(AgentHarnessSession);
    expect(legacy).toBeInstanceOf(LangChainAssistantSession);
  });

  it('routes kubernetes_api_request to the mock fixture instead of the real kubectl tool when --mock-tools is set', async () => {
    const model = new FakeToolCallingModel({
      toolCalls: [
        [
          {
            id: 'list-pods-call',
            name: 'kubernetes_api_request',
            args: { url: '/api/v1/pods', method: 'GET' },
          },
        ],
        [],
      ],
    });
    const manager = await createManager('mock-testing-model', {}, { mockTools: true, model });

    const response = await query(manager, 'List the pods');

    // The real kubectl tool is also registered via enableDirectToolCalling,
    // but the mock manager must win for the shared `kubernetes_api_request`
    // name so the CLI's --mock-tools flag actually takes effect.
    expect(execFile).not.toHaveBeenCalled();
    expect(response).toContain('nginx');
  });

  it('binds no host tools in supplied-evidence mode', async () => {
    const manager = await createManager(
      'mock-testing-model',
      {},
      {
        model: new FakeToolCallingModel(),
        suppliedEvidenceOnly: true,
      }
    );

    expect((manager as unknown as { extraTools: Map<string, unknown> }).extraTools.size).toBe(0);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('rejects structured diagnosis for a provider without native schema support', async () => {
    await expect(
      createManager('mock-testing-model', {}, { structuredDiagnosis: true })
    ).rejects.toThrow('requires a provider with native structured output');
  });

  it('requires an exact contract for structured repair', async () => {
    await expect(createManager('copilot', {}, { structuredRepair: true })).rejects.toThrow(
      'requires an exact repair contract'
    );
  });
});
