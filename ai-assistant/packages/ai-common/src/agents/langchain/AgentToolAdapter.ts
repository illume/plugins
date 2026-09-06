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

import { ToolMessage } from '@langchain/core/messages';
import type { StructuredToolInterface, ToolRunnableConfig } from '@langchain/core/tools';
import { tool } from '@langchain/core/tools';
import { extractTextContent } from '../../conversation/content';
import type { ConversationMessage } from '../../conversation/types';
import { redactSecrets } from '../../security/redactSecrets';
import type { ApprovalManagerContext } from '../../tools/approval/InlineToolApprovalManager';
import { inlineToolApprovalManager } from '../../tools/approval/InlineToolApprovalManager';
import { isBuiltInTool, isSensitiveBuiltInToolCall } from '../../tools/catalog/toolDefinitions';
import type { ToolRuntime } from '../../tools/ToolRuntime';
import type { ToolExecutionResult } from '../../tools/ToolRuntime';
import type { ToolCall } from '../../tools/types';

/** Runtime surface needed to expose existing tools through `createAgent`. */
export interface AgentToolRuntime extends ToolRuntime {
  /** Returns model-facing definitions for all enabled built-in and MCP tools. */
  getLangChainTools(): StructuredToolInterface[];
}

/** Hooks supplied by the session that owns adapted tool calls. */
export interface AgentToolAdapterOptions {
  /** Session state used to populate approval context. */
  approvalContext: ApprovalManagerContext;
  /** Additional LangChain tools supplied by a non-plugin host such as the CLI. */
  extraTools?: StructuredToolInterface[];
  /** Clears the inline approval placeholder after a call has settled. */
  clearToolConfirmation?: () => void;
  /** Records runtime result policy for session-history reconciliation. */
  onRuntimeResult?: (toolCallId: string, result: ToolExecutionResult) => void;
  /** Signal used to cancel approval waits and prevent post-cancel execution. */
  signal?: AbortSignal;
}

/**
 * Adapts the existing tool runtime to LangChain's agent callback contract.
 *
 * Built-in and MCP calls continue through `ToolRuntime.executeTool`, retaining
 * the model's tool-call ID and the repository's approval policy. Host-provided
 * tools are invoked directly with the same call metadata.
 */
export class AgentToolAdapter {
  private approvalTail: Promise<void> = Promise.resolve();
  private readonly pendingExecutions = new Set<Promise<void>>();
  private haltRequested = false;
  private readonly descriptions = new Map<string, string>();

  constructor(
    private readonly runtime: AgentToolRuntime,
    private readonly options: AgentToolAdapterOptions
  ) {}

  /** Creates agent-compatible wrappers for the current runtime inventory. */
  createTools(): StructuredToolInterface[] {
    this.haltRequested = false;
    const runtimeTools = this.runtime.getLangChainTools();
    const runtimeToolNames = new Set(runtimeTools.map(runtimeTool => runtimeTool.name));
    const extraTools = (this.options.extraTools ?? []).filter(
      extraTool => !runtimeToolNames.has(extraTool.name)
    );
    for (const availableTool of [...runtimeTools, ...extraTools]) {
      this.descriptions.set(
        availableTool.name,
        availableTool.description ?? `Execute ${availableTool.name}`
      );
    }

    return [
      ...runtimeTools.map(runtimeTool => this.wrapRuntimeTool(runtimeTool)),
      ...extraTools.map(extraTool => this.wrapExtraTool(extraTool)),
    ];
  }

  private wrapRuntimeTool(source: StructuredToolInterface): StructuredToolInterface {
    return tool(
      async (args, config) => {
        const normalizedArgs = args as Record<string, unknown>;
        const toolCallId = this.getToolCallId(source.name, config);
        const approved = await this.requestApproval(
          source.name,
          normalizedArgs,
          toolCallId,
          config?.signal ?? this.options.signal,
          true
        );
        if (!approved) {
          return this.deniedResult(source.name, toolCallId);
        }

        let releaseExecution!: () => void;
        const execution = new Promise<void>(resolve => {
          releaseExecution = resolve;
        });
        this.pendingExecutions.add(execution);
        try {
          const result = await this.runtime.executeTool(
            source.name,
            normalizedArgs,
            toolCallId,
            this.createPendingPrompt(source.name, normalizedArgs, toolCallId)
          );
          this.options.onRuntimeResult?.(toolCallId, result);
          const content = redactSecrets(result.content);
          if (
            result.metadata?.requiresConfirmation === true ||
            result.shouldProcessFollowUp === false
          ) {
            await this.haltAfterPendingExecutions(execution);
            throw new AgentToolExecutionHalt(
              content,
              result.metadata?.requiresConfirmation === true
            );
          }
          return content;
        } finally {
          releaseExecution();
          this.pendingExecutions.delete(execution);
        }
      },
      {
        name: source.name,
        description: source.description,
        schema: source.schema,
      }
    );
  }

  private wrapExtraTool(source: StructuredToolInterface): StructuredToolInterface {
    return tool(
      async (args, config) => {
        const normalizedArgs = args as Record<string, unknown>;
        const toolCallId = this.getToolCallId(source.name, config);
        const approved = await this.requestApproval(
          source.name,
          normalizedArgs,
          toolCallId,
          config?.signal ?? this.options.signal,
          false
        );
        if (!approved) {
          return this.deniedResult(source.name, toolCallId);
        }

        const result = await source.invoke(normalizedArgs, {
          ...config,
          toolCall: { id: toolCallId, name: source.name, args: normalizedArgs, type: 'tool_call' },
        });
        const content = ToolMessage.isInstance(result)
          ? extractTextContent(result.content)
          : typeof result === 'string'
          ? result
          : JSON.stringify(result);
        const redactedContent = redactSecrets(content);
        const parsedContent = this.parseObject(redactedContent);
        const isError =
          (ToolMessage.isInstance(result) && result.status === 'error') ||
          (parsedContent !== undefined && parsedContent.error === true);
        return isError
          ? new ToolMessage({
              status: 'error',
              content: redactedContent,
              tool_call_id: toolCallId,
              name: source.name,
            })
          : redactedContent;
      },
      {
        name: source.name,
        description: source.description,
        schema: source.schema,
      }
    );
  }

  private getToolCallId(toolName: string, config?: ToolRunnableConfig): string {
    return config?.toolCall?.id ?? `agent-${toolName}-${globalThis.crypto.randomUUID()}`;
  }

  private createPendingPrompt(
    toolName: string,
    args: Record<string, unknown>,
    toolCallId: string
  ): ConversationMessage {
    return {
      role: 'assistant',
      content: '',
      toolCalls: [
        {
          type: 'function',
          id: toolCallId,
          function: {
            name: toolName,
            arguments: JSON.stringify(args),
          },
        },
      ],
    };
  }

  private async requestApproval(
    toolName: string,
    args: Record<string, unknown>,
    toolCallId: string,
    signal?: AbortSignal,
    isRuntimeTool = false
  ): Promise<boolean> {
    if (signal?.aborted) return false;
    if (
      (!isRuntimeTool && isBuiltInTool(toolName) && !isSensitiveBuiltInToolCall(toolName, args)) ||
      (!isRuntimeTool && toolName === 'kubectl' && args.method === 'GET') ||
      (isRuntimeTool && isBuiltInTool(toolName) && args.method === 'GET')
    ) {
      return true;
    }

    const call: ToolCall = {
      id: toolCallId,
      name: toolName,
      description: this.findDescription(toolName),
      arguments: args,
      type: this.runtime.getMCPTools().some(mcpTool => mcpTool.name === toolName)
        ? 'mcp'
        : 'regular',
    };

    let releaseApproval!: () => void;
    const predecessor = this.approvalTail;
    this.approvalTail = new Promise<void>(resolve => {
      releaseApproval = resolve;
    });
    try {
      await this.waitForApprovalOrAbort(predecessor, signal);
      const approval = inlineToolApprovalManager.requestApproval(
        [call],
        this.options.approvalContext
      );
      const approvedIds = await this.waitForApprovalOrAbort(approval, signal);
      return !signal?.aborted && approvedIds.includes(toolCallId);
    } catch {
      return false;
    } finally {
      this.options.clearToolConfirmation?.();
      releaseApproval();
    }
  }

  private async haltAfterPendingExecutions(current: Promise<void>): Promise<void> {
    if (this.haltRequested) return;
    this.haltRequested = true;
    const siblings = [...this.pendingExecutions].filter(execution => execution !== current);
    // Once the first deferred result requests a halt, sibling callbacks skip
    // waiting here and settle their own execution promises for the leader.
    if (siblings.length > 0) {
      const drain = Promise.allSettled(siblings);
      const signal = this.options.signal;
      if (!signal) {
        await drain;
        return;
      }
      if (signal.aborted) return;
      let onAbort!: () => void;
      const aborted = new Promise<void>(resolve => {
        onAbort = resolve;
        signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        await Promise.race([drain, aborted]);
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }

  private parseObject(content: string): Record<string, unknown> | undefined {
    try {
      const parsed: unknown = JSON.parse(content);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  private async waitForApprovalOrAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    if (signal.aborted) throw new Error('Tool approval cancelled');
    let onAbort!: () => void;
    const abortPromise = new Promise<T>((_, reject) => {
      onAbort = () => reject(new Error('Tool approval cancelled'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([promise, abortPromise]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  private findDescription(toolName: string): string {
    return this.descriptions.get(toolName) ?? `Execute ${toolName}`;
  }

  private deniedResult(toolName: string, toolCallId: string): ToolMessage {
    return new ToolMessage({
      status: 'error',
      tool_call_id: toolCallId,
      name: toolName,
      content: JSON.stringify({
        error: true,
        message: 'Tool execution denied by user',
        userFriendlyMessage: `The execution of ${toolName} was denied by the user.`,
      }),
    });
  }
}

/** Stops the graph before a deferred runtime result reaches another model turn. */
export class AgentToolExecutionHalt extends Error {
  constructor(readonly resultContent?: string, readonly requiresConfirmation = false) {
    super('Tool execution requested that the agent stop before follow-up.');
    this.name = 'AgentToolExecutionHalt';
  }
}
