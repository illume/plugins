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

import type { StructuredToolInterface, ToolRunnableConfig } from '@langchain/core/tools';
import { tool } from '@langchain/core/tools';
import type { ApprovalManagerContext } from '../../tools/approval/InlineToolApprovalManager';
import { inlineToolApprovalManager } from '../../tools/approval/InlineToolApprovalManager';
import { redactSecrets } from '../../security/redactSecrets';
import { isBuiltInTool, isSensitiveBuiltInToolCall } from '../../tools/catalog/toolDefinitions';
import type { ToolRuntime } from '../../tools/ToolRuntime';
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

  constructor(
    private readonly runtime: AgentToolRuntime,
    private readonly options: AgentToolAdapterOptions
  ) {}

  /** Creates agent-compatible wrappers for the current runtime inventory. */
  createTools(): StructuredToolInterface[] {
    const runtimeTools = this.runtime.getLangChainTools();
    const runtimeToolNames = new Set(runtimeTools.map(runtimeTool => runtimeTool.name));
    const extraTools = (this.options.extraTools ?? []).filter(
      extraTool => !runtimeToolNames.has(extraTool.name)
    );

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
        const approved = await this.requestApproval(source.name, normalizedArgs, toolCallId);
        if (!approved) {
          return this.deniedResult(source.name);
        }

        const result = await this.runtime.executeTool(
          source.name,
          normalizedArgs,
          toolCallId,
          undefined
        );
        return redactSecrets(result.content);
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
        const approved = await this.requestApproval(source.name, normalizedArgs, toolCallId);
        if (!approved) {
          return this.deniedResult(source.name);
        }

        const result = await source.invoke(normalizedArgs, {
          ...config,
          toolCall: { id: toolCallId, name: source.name, args: normalizedArgs, type: 'tool_call' },
        });
        return redactSecrets(typeof result === 'string' ? result : JSON.stringify(result));
      },
      {
        name: source.name,
        description: source.description,
        schema: source.schema,
      }
    );
  }

  private getToolCallId(toolName: string, config?: ToolRunnableConfig): string {
    return config?.toolCall?.id ?? `agent-${toolName}-${Date.now()}`;
  }

  private async requestApproval(
    toolName: string,
    args: Record<string, unknown>,
    toolCallId: string
  ): Promise<boolean> {
    if (isBuiltInTool(toolName) && !isSensitiveBuiltInToolCall(toolName, args)) {
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
    await predecessor;

    try {
      const approvedIds = await inlineToolApprovalManager.requestApproval(
        [call],
        this.options.approvalContext
      );
      return approvedIds.includes(toolCallId);
    } catch {
      return false;
    } finally {
      this.options.clearToolConfirmation?.();
      releaseApproval();
    }
  }

  private findDescription(toolName: string): string {
    const source = [...this.runtime.getLangChainTools(), ...(this.options.extraTools ?? [])].find(
      candidate => candidate.name === toolName
    );
    return source?.description ?? `Execute ${toolName}`;
  }

  private deniedResult(toolName: string): string {
    return JSON.stringify({
      error: true,
      message: 'Tool execution denied by user',
      userFriendlyMessage: `The execution of ${toolName} was denied by the user.`,
    });
  }
}
