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

    const response = await session.userSend('debug my pod');

    expect(response.content).toContain('Skill: pod-debug');
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
});
