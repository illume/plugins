/* scratch probe - to be deleted */
import { tool } from '@langchain/core/tools';
import { FakeToolCallingModel } from 'langchain';
import { describe, it } from 'vitest';
import { z } from 'zod';
import { validateToolCallAlignment } from '../conversation/history';
import { inlineToolApprovalManager } from '../tools/approval/InlineToolApprovalManager';
import { createMockApprovalManager } from '../tools/approval/testing/MockApprovalManager';
import { createMockToolManager } from '../tools/testing/MockToolManager';
import AgentHarnessSession from './AgentHarnessSession';

const log = (label: string, obj: unknown) =>
  process.stderr.write(`\nPROBE ${label}: ${JSON.stringify(obj, null, 2)}\n`);

describe('probe', () => {
  it('multi-turn with tools', async () => {
    const toolManager = createMockToolManager({
      enabledToolNames: ['kubernetes_api_request'],
      toolResults: { kubernetes_api_request: () => ({ pods: ['api-0'] }) },
    });
    (toolManager as any).getLangChainTools = () => [
      tool(async () => '', {
        name: 'kubernetes_api_request',
        description: 'k',
        schema: z.object({ method: z.string(), url: z.string() }),
      }),
    ];
    const model = new FakeToolCallingModel({
      toolCalls: [
        [{ id: 'call-1', name: 'kubernetes_api_request', args: { method: 'GET', url: '/a' } }],
        [],
        [{ id: 'call-2', name: 'kubernetes_api_request', args: { method: 'GET', url: '/b' } }],
        [],
      ],
    });
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model,
      toolManager,
    });
    await session.userSend('turn one');
    await session.userSend('turn two');
    log(
      'HISTORY',
      session.history.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content.slice(0, 50) : m.content,
        toolCalls: (m as any).toolCalls?.map((t: any) => t.id),
        toolCallId: (m as any).toolCallId,
      }))
    );
    log('USER_COUNT', session.history.filter(m => m.role === 'user').length);
    log('ALIGNED', validateToolCallAlignment(session.history).aligned);
  });

  it('identical text twice', async () => {
    const toolManager = createMockToolManager();
    const model = new FakeToolCallingModel({ toolCalls: [[], []] });
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model,
      toolManager,
    });
    await session.userSend('same');
    await session.userSend('same');
    log('DUP_ROLES', session.history.map(m => m.role));
    log('DUP_USER_COUNT', session.history.filter(m => m.role === 'user').length);
  });

  it('denied tool', async () => {
    const toolManager = createMockToolManager({
      enabledToolNames: ['metrics__query'],
      toolResults: { metrics__query: () => ({ v: 1 }) },
    });
    (toolManager as any).getMCPTools = () => [{ name: 'metrics__query', description: 'q' }];
    (toolManager as any).getLangChainTools = () => [
      tool(async () => '', {
        name: 'metrics__query',
        description: 'q',
        schema: z.object({ query: z.string() }),
      }),
    ];
    const model = new FakeToolCallingModel({
      toolCalls: [[{ id: 'm1', name: 'metrics__query', args: { query: 'up' } }], []],
    });
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model,
      toolManager,
    });
    inlineToolApprovalManager.setApprovalHandler(createMockApprovalManager({ mode: 'deny-all' }));
    await session.userSend('q');
    inlineToolApprovalManager.setApprovalHandler(null);
    log(
      'DENIED_HISTORY',
      session.history.map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content.slice(0, 90) : m.content,
        error: (m as any).error,
      }))
    );
  });
});
