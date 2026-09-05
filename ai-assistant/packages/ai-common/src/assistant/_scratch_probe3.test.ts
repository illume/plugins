/* scratch probe 3 - extra tool output through AgentHarnessSession */
import { tool } from '@langchain/core/tools';
import { FakeToolCallingModel } from 'langchain';
import { describe, it } from 'vitest';
import { z } from 'zod';
import { inlineToolApprovalManager } from '../tools/approval/InlineToolApprovalManager';
import { createMockApprovalManager } from '../tools/approval/testing/MockApprovalManager';
import { createMockToolManager } from '../tools/testing/MockToolManager';
import AgentHarnessSession from './AgentHarnessSession';

const log = (label: string, obj: unknown) =>
  process.stderr.write(`\nPROBE3 ${label}: ${JSON.stringify(obj, null, 2)}\n`);

describe('probe3', () => {
  it('cli tool output content in history', async () => {
    const kubectl = tool(async () => 'NAME  READY\napi-0  1/1', {
      name: 'kubectl',
      description: 'Run kubectl',
      schema: z.object({ command: z.string() }),
    });
    const model = new FakeToolCallingModel({
      toolCalls: [[{ id: 'cli-1', name: 'kubectl', args: { command: 'get pods' } }], []],
    });
    const session = new AgentHarnessSession('mock-testing-model', {}, undefined, {
      model,
      toolManager: createMockToolManager(),
    });
    inlineToolApprovalManager.setApprovalHandler(createMockApprovalManager({ mode: 'approve-all' }));
    await session.enableDirectToolCalling([kubectl]);
    await session.userSend('list pods');
    inlineToolApprovalManager.setApprovalHandler(null);
    const toolMsg = session.history.find(m => m.role === 'tool');
    log('CLI_TOOL_CONTENT', toolMsg?.content);
  });
});
