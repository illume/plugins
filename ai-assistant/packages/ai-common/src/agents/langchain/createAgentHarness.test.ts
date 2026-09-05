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

import { ToolMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { FakeToolCallingModel } from 'langchain';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAgentHarness } from './createAgentHarness';

describe('createAgentHarness', () => {
  it('waits for tool discovery and runs the model-tool loop', async () => {
    const inspectPods = vi.fn(async () => '{"pods":["api-0"]}');
    const tools = [
      tool(inspectPods, {
        name: 'inspect_pods',
        description: 'Inspect Kubernetes pods',
        schema: z.object({ namespace: z.string() }),
      }),
    ];
    const events: string[] = [];
    const toolRuntime = {
      waitForMCPToolsInitialization: vi.fn(async () => {
        events.push('ready');
      }),
      getLangChainTools: vi.fn(() => {
        events.push('tools');
        return tools;
      }),
    };
    const model = new FakeToolCallingModel({
      toolCalls: [[{ id: 'call-1', name: 'inspect_pods', args: { namespace: 'default' } }], []],
    });

    const agent = await createAgentHarness({
      model,
      toolRuntime,
      systemPrompt: 'Troubleshoot Kubernetes.',
    });
    const result = await agent.invoke({
      messages: [{ role: 'user', content: 'Why is my pod failing?' }],
    });

    expect(events).toEqual(['ready', 'tools']);
    expect(inspectPods).toHaveBeenCalledWith(
      { namespace: 'default' },
      expect.objectContaining({ toolCall: expect.objectContaining({ id: 'call-1' }) })
    );
    expect(result.messages.some(message => ToolMessage.isInstance(message))).toBe(true);
  });

  it('stops when the model-call limit is exceeded', async () => {
    const model = new FakeToolCallingModel({
      toolCalls: [[{ id: 'call-1', name: 'inspect_pods', args: { namespace: 'default' } }], []],
    });
    const inspectPods = vi.fn(async () => 'ok');
    const agent = await createAgentHarness({
      model,
      toolRuntime: {
        waitForMCPToolsInitialization: async () => undefined,
        getLangChainTools: () => [
          tool(inspectPods, {
            name: 'inspect_pods',
            description: 'Inspect Kubernetes pods',
            schema: z.object({ namespace: z.string() }),
          }),
        ],
      },
      modelCallLimit: 0,
    });

    await expect(
      agent.invoke({ messages: [{ role: 'user', content: 'Inspect pods' }] })
    ).rejects.toThrow();
    expect(inspectPods).not.toHaveBeenCalled();
  });

  it('stops when the tool-call limit is exceeded', async () => {
    const inspectPods = vi.fn(async () => 'ok');
    const model = new FakeToolCallingModel({
      toolCalls: [
        [
          { id: 'call-1', name: 'inspect_pods', args: { namespace: 'default' } },
          { id: 'call-2', name: 'inspect_pods', args: { namespace: 'kube-system' } },
        ],
      ],
    });
    const agent = await createAgentHarness({
      model,
      toolRuntime: {
        waitForMCPToolsInitialization: async () => undefined,
        getLangChainTools: () => [
          tool(inspectPods, {
            name: 'inspect_pods',
            description: 'Inspect Kubernetes pods',
            schema: z.object({ namespace: z.string() }),
          }),
        ],
      },
      toolCallLimit: 0,
    });

    await expect(
      agent.invoke({ messages: [{ role: 'user', content: 'Inspect pods' }] })
    ).rejects.toThrow();
    expect(inspectPods).not.toHaveBeenCalled();
  });
});
