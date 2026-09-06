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

import { tool } from '@langchain/core/tools';
import { FakeToolCallingModel } from 'langchain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { validateToolCallAlignment } from '../conversation/history';
import { DEFAULT_SKILLS_CONFIG } from '../skills/config';
import type { SkillManager } from '../skills/SkillManager';
import { createMockSkillManager } from '../skills/testing/MockSkillManager';
import { inlineToolApprovalManager } from '../tools/approval/InlineToolApprovalManager';
import { createMockApprovalManager } from '../tools/approval/testing/MockApprovalManager';
import { createMockToolManager } from '../tools/testing/MockToolManager';
import type { ToolExecutionResult } from '../tools/ToolRuntime';
import AgentHarnessSession from './AgentHarnessSession';

describe('AgentHarnessSession', () => {
  afterEach(() => {
    inlineToolApprovalManager.setApprovalHandler(null);
  });

  it('uses createAgent and stores an aligned model-tool-model history', async () => {
    const execute = vi.fn();
    const toolManager = createMockToolManager({
      enabledToolNames: ['kubernetes_api_request'],
      toolResults: {
        kubernetes_api_request: (args: Record<string, unknown>, toolCallId?: string) => {
          execute(args, toolCallId);
          return { pods: ['api-0'] };
        },
      },
    });
    vi.spyOn(toolManager, 'getLangChainTools').mockReturnValue([
      tool(async () => '', {
        name: 'kubernetes_api_request',
        description: 'Read Kubernetes resources',
        schema: z.object({ method: z.string(), url: z.string() }),
      }),
    ]);
    const model = new FakeToolCallingModel({
      toolCalls: [
        [
          {
            id: 'call-1',
            name: 'kubernetes_api_request',
            args: { method: 'GET', url: '/api/v1/pods' },
          },
        ],
        [],
      ],
    });
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model,
      toolManager,
    });

    const response = await session.userSend('List pods');

    expect(execute).toHaveBeenCalledWith({ method: 'GET', url: '/api/v1/pods' }, 'call-1');
    expect(response.role).toBe('assistant');
    expect(session.history.some(message => message.role === 'tool')).toBe(true);
    expect(validateToolCallAlignment(session.history).aligned).toBe(true);
  });

  it('routes Skills into the createAgent system prompt', async () => {
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model: new FakeToolCallingModel(),
      toolManager: createMockToolManager(),
    });
    session.setSkillManager(
      createMockSkillManager({
        skillPrompt: '\n## Skill: pod-debug\nInspect pod events before logs.',
      }) as unknown as SkillManager,
      DEFAULT_SKILLS_CONFIG
    );
    const createSystemPrompt = vi.spyOn(session as any, 'createSystemPrompt');

    await session.userSend('debug my pod');

    expect(createSystemPrompt).toHaveReturnedWith(expect.stringContaining('Skill: pod-debug'));
  });

  it('discovers and approves MCP tools before runtime execution', async () => {
    const execute = vi.fn();
    const toolManager = createMockToolManager({
      enabledToolNames: ['metrics__query'],
      toolResults: {
        metrics__query: (args: Record<string, unknown>, toolCallId?: string) => {
          execute(args, toolCallId);
          return { value: 3 };
        },
      },
    });
    vi.spyOn(toolManager, 'getMCPTools').mockReturnValue([
      { name: 'metrics__query', description: 'Query metrics' },
    ]);
    vi.spyOn(toolManager, 'getLangChainTools').mockReturnValue([
      tool(async () => '', {
        name: 'metrics__query',
        description: 'Query metrics',
        schema: z.object({ query: z.string() }),
      }),
    ]);
    const model = new FakeToolCallingModel({
      toolCalls: [[{ id: 'mcp-call-1', name: 'metrics__query', args: { query: 'up' } }], []],
    });
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model,
      toolManager,
    });
    inlineToolApprovalManager.setApprovalHandler(
      createMockApprovalManager({ mode: 'approve-all' })
    );

    await session.userSend('Query metrics');

    expect(execute).toHaveBeenCalledWith({ query: 'up' }, 'mcp-call-1');
  });

  it('executes host-provided CLI tools with approval and call identity', async () => {
    const invoked = vi.fn(async () => 'kubectl output');
    const kubectl = tool(invoked, {
      name: 'kubectl',
      description: 'Run an approved kubectl operation',
      schema: z.object({ command: z.string() }),
    });
    const model = new FakeToolCallingModel({
      toolCalls: [[{ id: 'cli-call-1', name: 'kubectl', args: { command: 'get pods' } }], []],
    });
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model,
      toolManager: createMockToolManager(),
    });
    inlineToolApprovalManager.setApprovalHandler(
      createMockApprovalManager({ mode: 'approve-all' })
    );
    await session.enableDirectToolCalling([kubectl]);

    await session.userSend('List pods');

    expect(invoked).toHaveBeenCalledWith(
      { command: 'get pods' },
      expect.objectContaining({
        toolCall: expect.objectContaining({ id: 'cli-call-1', name: 'kubectl' }),
      })
    );
    expect(session.history.find(message => message.role === 'tool')?.content).toBe(
      'kubectl output'
    );
  });

  it('marks denied tool results as errors', async () => {
    const invoked = vi.fn(async () => 'must not execute');
    const externalTool = tool(invoked, {
      name: 'external_tool',
      description: 'Requires approval',
      schema: z.object({}),
    });

    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model: new FakeToolCallingModel({
        toolCalls: [[{ id: 'denied-call', name: 'external_tool', args: {} }], []],
      }),
      toolManager: createMockToolManager(),
    });

    inlineToolApprovalManager.setApprovalHandler(createMockApprovalManager({ mode: 'deny-all' }));
    await session.enableDirectToolCalling([externalTool]);

    await session.userSend('Use the external tool');

    expect(invoked).not.toHaveBeenCalled();
    expect(session.history.find(message => message.role === 'tool')).toEqual(
      expect.objectContaining({
        toolCallId: 'denied-call',
        error: true,
      })
    );
  });

  it('marks metadata tool failures as errors', async () => {
    const toolManager = createMockToolManager({
      enabledToolNames: ['metrics__query'],
    });
    vi.spyOn(toolManager, 'executeTool').mockResolvedValue({
      content: '{"value":3}',
      shouldAddToHistory: true,
      shouldProcessFollowUp: true,
      metadata: { isError: true },
    });
    vi.spyOn(toolManager, 'getLangChainTools').mockReturnValue([
      tool(async () => '', {
        name: 'metrics__query',
        description: 'Query metrics',
        schema: z.object({}),
      }),
    ]);
    inlineToolApprovalManager.setApprovalHandler(
      createMockApprovalManager({ mode: 'approve-all' })
    );
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model: new FakeToolCallingModel({
        toolCalls: [[{ id: 'failed-call', name: 'metrics__query', args: {} }], []],
      }),
      toolManager,
    });
    await session.userSend('Query metrics');

    expect(session.history.find(message => message.toolCallId === 'failed-call')).toEqual(
      expect.objectContaining({ error: true })
    );
  });

  it('does not execute an approval after the run is aborted', async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const toolManager = createMockToolManager({
      enabledToolNames: ['metrics__query'],
      toolResults: { metrics__query: execute },
    });
    vi.spyOn(toolManager, 'getLangChainTools').mockReturnValue([
      tool(async () => '', {
        name: 'metrics__query',
        description: 'Query metrics',
        schema: z.object({}),
      }),
    ]);
    inlineToolApprovalManager.setApprovalHandler({
      requestApproval: () => new Promise<string[]>(() => undefined),
    } as any);
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model: new FakeToolCallingModel({
        toolCalls: [[{ id: 'approval-call', name: 'metrics__query', args: {} }], []],
      }),
      toolManager,
    });

    const pendingRun = session.userSend('Query metrics');
    await Promise.resolve();
    session.abort();
    await pendingRun;

    expect(execute).not.toHaveBeenCalled();
  });

  it('preserves the streaming API', async () => {
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model: new FakeToolCallingModel(),
      toolManager: createMockToolManager(),
    });

    const chunks: string[] = [];
    for await (const chunk of session.userSendStream('Hello')) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toContain('Hello');
    session.abort();
    expect(session.history.at(-1)?.role).toBe('assistant');
  });

  it('preserves runtime-owned tool history without duplicating or reordering it', async () => {
    const toolManager = createMockToolManager({
      enabledToolNames: ['kubernetes_api_request'],
    });
    vi.spyOn(toolManager, 'getLangChainTools').mockReturnValue([
      tool(async () => '', {
        name: 'kubernetes_api_request',
        description: 'Read Kubernetes resources',
        schema: z.object({ method: z.string(), url: z.string() }),
      }),
    ]);
    const model = new FakeToolCallingModel({
      toolCalls: [
        [
          {
            id: 'get-call',
            name: 'kubernetes_api_request',
            args: { method: 'GET', url: '/api/v1/pods' },
          },
        ],
        [],
      ],
    });
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model,
      toolManager,
    });
    vi.spyOn(toolManager, 'executeTool').mockImplementation(
      async (_name, _args, toolCallId): Promise<ToolExecutionResult> => {
        session.history.push({
          role: 'tool',
          content: '{"items":[]}',
          toolCallId,
          name: 'kubernetes_api_request',
        });
        return {
          content: '{"items":[]}',
          shouldAddToHistory: false,
          shouldProcessFollowUp: true,
        };
      }
    );

    await session.userSend('List pods');

    expect(session.history.filter(message => message.role === 'tool')).toHaveLength(1);
    expect(session.history.map(message => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(validateToolCallAlignment(session.history).aligned).toBe(true);
  });

  it('suspends mutation follow-up and retains the initiating prompt for confirmation', async () => {
    const toolManager = createMockToolManager({
      enabledToolNames: ['kubernetes_api_request'],
    });
    vi.spyOn(toolManager, 'getLangChainTools').mockReturnValue([
      tool(async () => '', {
        name: 'kubernetes_api_request',
        description: 'Mutate Kubernetes resources',
        schema: z.object({ method: z.string(), url: z.string() }),
      }),
    ]);
    const model = new FakeToolCallingModel({
      toolCalls: [
        [
          {
            id: 'delete-call',
            name: 'kubernetes_api_request',
            args: { method: 'DELETE', url: '/api/v1/pods/api-0' },
          },
        ],
        [],
      ],
    });
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model,
      toolManager,
    });
    const executeTool = vi.spyOn(toolManager, 'executeTool').mockResolvedValue({
      content: '{"status":"pending_confirmation"}',
      shouldAddToHistory: false,
      shouldProcessFollowUp: false,
      metadata: { requiresConfirmation: true, method: 'DELETE' },
    });

    const response = await session.userSend('Delete pod api-0');

    expect(executeTool).toHaveBeenCalledWith(
      'kubernetes_api_request',
      { method: 'DELETE', url: '/api/v1/pods/api-0' },
      'delete-call',
      expect.objectContaining({
        role: 'assistant',
        toolCalls: [
          expect.objectContaining({
            id: 'delete-call',
            function: expect.objectContaining({ name: 'kubernetes_api_request' }),
          }),
        ],
      })
    );
    expect(response.toolCalls?.[0]?.id).toBe('delete-call');
    expect(session.history.at(-1)).toEqual(
      expect.objectContaining({
        role: 'tool',
        toolCallId: 'delete-call',
        isDisplayOnly: true,
      })
    );
    expect(validateToolCallAlignment(session.history).aligned).toBe(true);
  });

  it('processes tool results appended after the graph invocation', async () => {
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model: new FakeToolCallingModel(),
      toolManager: createMockToolManager(),
    });
    const firstResponse = await session.userSend('Initial request');
    session.history.push(
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            type: 'function',
            id: 'retry-call',
            function: { name: 'retry_tool', arguments: '{}' },
          },
        ],
      },
      {
        role: 'tool',
        content: '{"result":"retry succeeded"}',
        toolCallId: 'retry-call',
        name: 'retry_tool',
      }
    );

    const retryResponse = await session.processToolResponses();

    expect(retryResponse).not.toBe(firstResponse);
    expect(retryResponse.role).toBe('assistant');
    expect(session.history.at(-1)).toBe(retryResponse);
  });

  it('retains completed tool actions when the remaining run is aborted', async () => {
    const toolManager = createMockToolManager({
      enabledToolNames: ['kubernetes_api_request'],
    });
    vi.spyOn(toolManager, 'getLangChainTools').mockReturnValue([
      tool(async () => '', {
        name: 'kubernetes_api_request',
        description: 'Read Kubernetes resources',
        schema: z.object({ method: z.string(), url: z.string() }),
      }),
    ]);
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model: new FakeToolCallingModel({
        toolCalls: [
          [
            {
              id: 'completed-call',
              name: 'kubernetes_api_request',
              args: { method: 'GET', url: '/api/v1/pods' },
            },
          ],
          [],
        ],
      }),
      toolManager,
    });
    vi.spyOn(toolManager, 'executeTool').mockImplementation(async () => {
      session.abort();
      return {
        content: '{"items":[]}',
        shouldAddToHistory: true,
        shouldProcessFollowUp: true,
      };
    });

    const response = await session.userSend('List pods');

    expect(response.error).toBe(true);
    expect(session.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          toolCallId: 'completed-call',
          content: '{"items":[]}',
        }),
      ])
    );
    expect(validateToolCallAlignment(session.history).aligned).toBe(true);
  });
});
