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
import { basePrompt } from '../../prompts/baseAssistantPrompt';
import {
  createAgentHarness,
  getAgentSystemPrompt,
  parallelToolCallInstruction,
} from './createAgentHarness';

describe('createAgentHarness', () => {
  it('uses the base prompt when no custom prompt is supplied', () => {
    expect(getAgentSystemPrompt()).toBe(`${basePrompt}\n\n${parallelToolCallInstruction}`);
  });

  it('instructs the agent to parallelize independent tool calls', () => {
    expect(getAgentSystemPrompt('Troubleshoot Kubernetes.')).toBe(
      `Troubleshoot Kubernetes.\n\n${parallelToolCallInstruction}`
    );
  });

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

  it('does not construct an agent when tool discovery fails', async () => {
    const discoveryError = new Error('MCP discovery failed');
    const getLangChainTools = vi.fn();

    await expect(
      createAgentHarness({
        model: new FakeToolCallingModel(),
        toolRuntime: {
          waitForMCPToolsInitialization: async () => {
            throw discoveryError;
          },
          getLangChainTools,
        },
      })
    ).rejects.toBe(discoveryError);
    expect(getLangChainTools).not.toHaveBeenCalled();
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

  it('executes parallel tool calls and returns every result', async () => {
    let activeCalls = 0;
    let maximumConcurrentCalls = 0;
    const completedCalls: string[] = [];
    let resolveBothStarted!: () => void;
    const bothStarted = new Promise<void>(resolve => {
      resolveBothStarted = resolve;
    });
    const inspectPods = vi.fn(async ({ namespace }: { namespace: string }) => {
      // Tool callbacks run on the JavaScript event loop, so these synchronous
      // counter updates happen atomically before either callback awaits.
      activeCalls += 1;
      maximumConcurrentCalls = Math.max(maximumConcurrentCalls, activeCalls);
      if (activeCalls === 2) {
        resolveBothStarted();
      }
      await bothStarted;
      completedCalls.push(namespace);
      activeCalls -= 1;
      return `pods in ${namespace}`;
    });
    const model = new FakeToolCallingModel({
      toolCalls: [
        [
          { id: 'call-default', name: 'inspect_pods', args: { namespace: 'default' } },
          { id: 'call-system', name: 'inspect_pods', args: { namespace: 'kube-system' } },
        ],
        [],
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
    });

    const result = await agent.invoke({
      messages: [{ role: 'user', content: 'Compare both namespaces' }],
    });

    expect(maximumConcurrentCalls).toBe(2);
    expect(completedCalls).toEqual(expect.arrayContaining(['default', 'kube-system']));
    expect(
      result.messages
        .filter(message => ToolMessage.isInstance(message))
        .map(message => message.content)
    ).toEqual(expect.arrayContaining(['pods in default', 'pods in kube-system']));
  }, 2000);

  it('handles high fan-out parallel calls with staggered completion', async () => {
    const namespaces = Array.from({ length: 8 }, (_, index) => `namespace-${index}`);
    let activeCalls = 0;
    let maximumConcurrentCalls = 0;
    const completedCalls: string[] = [];
    const inspectPods = vi.fn(async ({ namespace }: { namespace: string }) => {
      activeCalls += 1;
      maximumConcurrentCalls = Math.max(maximumConcurrentCalls, activeCalls);
      await new Promise(resolve => setTimeout(resolve, (8 - Number(namespace.at(-1))) * 3));
      completedCalls.push(namespace);
      activeCalls -= 1;
      return `pods in ${namespace}`;
    });
    const model = new FakeToolCallingModel({
      toolCalls: [
        namespaces.map((namespace, index) => ({
          id: `call-${index}`,
          name: 'inspect_pods',
          args: { namespace },
        })),
        [],
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
    });

    const result = await agent.invoke({
      messages: [{ role: 'user', content: 'Compare all namespaces' }],
    });

    expect(maximumConcurrentCalls).toBe(8);
    expect(completedCalls).toHaveLength(8);
    expect(result.messages.filter(message => ToolMessage.isInstance(message))).toHaveLength(8);
  });
});
