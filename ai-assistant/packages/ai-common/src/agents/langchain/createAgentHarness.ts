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

import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { createAgent, modelCallLimitMiddleware, toolCallLimitMiddleware } from 'langchain';
import { basePrompt } from '../../prompts/baseAssistantPrompt';

const DEFAULT_MODEL_CALL_LIMIT = 8;
const DEFAULT_TOOL_CALL_LIMIT = 12;

/** Tool inventory required by the LangGraph-backed agent prototype. */
export interface AgentHarnessToolRuntime {
  /** Waits for asynchronous MCP tool discovery to settle. */
  waitForMCPToolsInitialization(): Promise<void>;
  /** Returns the currently enabled built-in and MCP LangChain tools. */
  getLangChainTools(): StructuredToolInterface[];
}

/** Options for creating the experimental LangGraph-backed agent harness. */
export interface AgentHarnessOptions {
  /** Chat model used for reasoning and tool selection. */
  model: BaseChatModel;
  /** Existing AI Assistant tool inventory. */
  toolRuntime: AgentHarnessToolRuntime;
  /** Optional replacement for the standard AI Assistant system prompt. */
  systemPrompt?: string;
  /** Maximum model calls in one invocation. */
  modelCallLimit?: number;
  /** Maximum tool calls in one invocation. */
  toolCallLimit?: number;
}

/**
 * Creates a bounded ReAct agent using LangChain's first-party LangGraph harness.
 *
 * This prototype deliberately leaves persistence and human-in-the-loop
 * interruption to callers because both require a host-owned thread lifecycle.
 *
 * @param options - Model, existing tool runtime, prompt, and per-run limits.
 * @returns A compiled agent after asynchronous MCP discovery has completed.
 */
export async function createAgentHarness(options: AgentHarnessOptions) {
  await options.toolRuntime.waitForMCPToolsInitialization();

  return createAgent({
    model: options.model,
    tools: options.toolRuntime.getLangChainTools(),
    systemPrompt: options.systemPrompt ?? basePrompt,
    middleware: [
      modelCallLimitMiddleware({
        runLimit: options.modelCallLimit ?? DEFAULT_MODEL_CALL_LIMIT,
        exitBehavior: 'error',
      }),
      toolCallLimitMiddleware({
        runLimit: options.toolCallLimit ?? DEFAULT_TOOL_CALL_LIMIT,
        exitBehavior: 'error',
      }),
    ],
    name: 'headlamp-kubernetes-agent',
  });
}
