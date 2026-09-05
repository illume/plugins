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

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { AgentToolAdapter } from '../agents/langchain/AgentToolAdapter';
import { createAgentHarness } from '../agents/langchain/createAgentHarness';
import type { ConversationMessage } from '../conversation/types';
import type { ToolClient } from '../mcp/client/ToolClient';
import type { ProviderSettings } from '../providers/savedConfigs';
import { inlineToolApprovalManager } from '../tools/approval/InlineToolApprovalManager';
import type { LangChainToolRuntime } from './langchain/LangChainToolBinding';
import LangChainAssistantSession from './LangChainAssistantSession';

/** Options accepted by the createAgent-backed assistant session. */
export interface AgentHarnessSessionOptions {
  /** Optional replacement tool runtime for tests, CLI, or demos. */
  toolManager?: LangChainToolRuntime;
  /** Host MCP bridge used to discover and execute MCP tools. */
  mcpClient?: ToolClient;
  /** Model override used by deterministic tests and embedded hosts. */
  model?: BaseChatModel;
}

/**
 * `AssistantSession` adapter backed by LangChain's first-party `createAgent`.
 *
 * It inherits the established configuration and UI compatibility surface while
 * replacing the model/tool loop with the bounded LangGraph-backed agent.
 */
export default class AgentHarnessSession extends LangChainAssistantSession {
  constructor(
    providerId: string,
    config: ProviderSettings,
    enabledTools?: string[],
    options?: AgentHarnessSessionOptions
  ) {
    super(providerId, config, enabledTools, options);
    if (options?.model) {
      this.model = options.model;
    }
  }

  /** Runs one complete createAgent model/tool loop. */
  override async userSend(message: string): Promise<ConversationMessage> {
    await inlineToolApprovalManager.loadAndApplyAutoApproveSettings();

    const userPrompt: ConversationMessage = { role: 'user', content: message };
    this.history.push(userPrompt);
    this.currentAbortController = new AbortController();

    try {
      await this.toolManager.waitForMCPToolsInitialization();
      this.currentSkillsPromptText = await this.getSkillsPromptForQuery(message);

      const toolAdapter = new AgentToolAdapter(this.toolManager, {
        approvalContext: this,
        extraTools: Array.from(this.extraTools.values()) as StructuredToolInterface[],
        clearToolConfirmation: () => this.clearToolConfirmation(),
      });
      const adaptedTools = toolAdapter.createTools();
      const agent = await createAgentHarness({
        model: this.model,
        toolRuntime: {
          waitForMCPToolsInitialization: async () => undefined,
          getLangChainTools: () => adaptedTools,
        },
        systemPrompt: this.createSystemPrompt(),
      });
      const inputMessages = this.prepareChatHistory();
      const result = await agent.invoke(
        { messages: inputMessages },
        { signal: this.currentAbortController.signal }
      );

      this.appendAgentMessages(
        this.getGeneratedMessages(result.messages as BaseMessage[], inputMessages)
      );
      this.currentAbortController = null;
      return this.lastAssistantMessage();
    } catch (error) {
      return this.handleUserSendError(error);
    }
  }

  /**
   * Preserves the streaming session contract while the agent owns its complete
   * multi-step loop. The final answer is emitted as one chunk.
   */
  override async *userSendStream(
    message: string
  ): AsyncGenerator<string, ConversationMessage, undefined> {
    const result = await this.userSend(message);
    yield result.content;
    return result;
  }

  /** Registers host-provided tools for the next agent invocation. */
  override async enableDirectToolCalling(extraTools?: StructuredToolInterface[]): Promise<void> {
    await this.toolManager.waitForMCPToolsInitialization();
    for (const extraTool of extraTools ?? []) {
      this.extraTools.set(extraTool.name, extraTool);
    }
  }

  /**
   * Agent tool results are consumed within the same invocation, so callers that
   * explicitly request follow-up processing receive the latest assistant answer.
   */
  override async processToolResponses(): Promise<ConversationMessage> {
    return this.lastAssistantMessage();
  }

  private appendAgentMessages(messages: BaseMessage[]): void {
    for (const message of messages) {
      if (AIMessage.isInstance(message)) {
        const toolCalls = message.tool_calls?.map(toolCall => ({
          type: 'function',
          id: toolCall.id,
          function: {
            name: toolCall.name,
            arguments: JSON.stringify(toolCall.args ?? {}),
          },
        }));
        this.history.push({
          role: 'assistant',
          content: this.extractTextContent(message.content),
          toolCalls: toolCalls?.length ? toolCalls : undefined,
        });
      } else if (ToolMessage.isInstance(message)) {
        this.history.push({
          role: 'tool',
          content: this.extractTextContent(message.content),
          toolCallId: message.tool_call_id,
          name: message.name,
          error: message.status === 'error',
        });
      } else if (HumanMessage.isInstance(message)) {
        this.history.push({
          role: 'user',
          content: this.extractTextContent(message.content),
        });
      }
    }
  }

  private getGeneratedMessages(
    resultMessages: BaseMessage[],
    inputMessages: BaseMessage[]
  ): BaseMessage[] {
    if (inputMessages.length === 0) {
      return resultMessages;
    }

    const lastInputMessage = inputMessages[inputMessages.length - 1];
    for (let resultIndex = resultMessages.length - 1; resultIndex >= 0; resultIndex--) {
      const resultMessage = resultMessages[resultIndex];
      if (
        resultMessage === lastInputMessage ||
        (resultMessage.getType() === lastInputMessage.getType() &&
          JSON.stringify(resultMessage.content) === JSON.stringify(lastInputMessage.content))
      ) {
        return resultMessages.slice(resultIndex + 1);
      }
    }

    let latestHumanIndex = -1;
    for (let index = resultMessages.length - 1; index >= 0; index--) {
      if (HumanMessage.isInstance(resultMessages[index])) {
        latestHumanIndex = index;
        break;
      }
    }
    return latestHumanIndex >= 0
      ? resultMessages.slice(latestHumanIndex + 1)
      : resultMessages.filter(
          message => AIMessage.isInstance(message) || ToolMessage.isInstance(message)
        );
  }

  private lastAssistantMessage(): ConversationMessage {
    return (
      this.history
        .slice()
        .reverse()
        .find(
          historyMessage => historyMessage.role === 'assistant' && !historyMessage.isDisplayOnly
        ) ?? {
        role: 'assistant',
        content: 'No response was produced.',
        error: true,
      }
    );
  }
}
