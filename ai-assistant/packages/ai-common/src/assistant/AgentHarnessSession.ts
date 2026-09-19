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
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ResponseFormat } from 'langchain';
import { MultipleStructuredOutputsError, StructuredOutputParsingError } from 'langchain';
import { AgentToolAdapter, AgentToolExecutionHalt } from '../agents/langchain/AgentToolAdapter.ts';
import { createAgentHarness } from '../agents/langchain/createAgentHarness.ts';
import type { ConversationMessage } from '../conversation/types.ts';
import type { ToolClient } from '../mcp/client/ToolClient.ts';
import type { ProviderSettings } from '../providers/savedConfigs.ts';
import { redactSecrets } from '../security/redactSecrets.ts';
import { inlineToolApprovalManager } from '../tools/approval/InlineToolApprovalManager.ts';
import { buildConfirmationPlaceholderJson } from '../tools/results/buildToolResponse.ts';
import type { ToolExecutionResult } from '../tools/ToolRuntime.ts';
import type { LangChainToolRuntime } from './langchain/LangChainToolBinding.ts';
import LangChainAssistantSession from './LangChainAssistantSession.ts';
import type { AssistantTelemetryObserver, AssistantTelemetryStage } from './telemetry.ts';

/** Options accepted by the createAgent-backed assistant session. */
export interface AgentHarnessSessionOptions {
  /** Optional replacement tool runtime for tests, CLI, or demos. */
  toolManager?: LangChainToolRuntime;
  /** Host MCP bridge used to discover and execute MCP tools. */
  mcpClient?: ToolClient;
  /** Model override used by deterministic tests and embedded hosts. */
  model?: BaseChatModel;
  /** Receives sanitized model-usage and tool-completion events. */
  telemetryObserver?: AssistantTelemetryObserver;
  /** Optional provider-enforced response contract for this session. */
  responseFormat?: ResponseFormat;
  /** External semantic validation applied after provider schema enforcement. */
  validateStructuredResponse?: (
    response: Record<string, unknown>
  ) => { success: true; data: Record<string, unknown> } | { success: false; error: string };
}

/**
 * `AssistantSession` adapter backed by LangChain's first-party `createAgent`.
 *
 * It inherits the established configuration and UI compatibility surface while
 * replacing the model/tool loop with the bounded LangGraph-backed agent.
 */
export default class AgentHarnessSession extends LangChainAssistantSession {
  private readonly responseFormat?: ResponseFormat;
  private readonly validateStructuredResponse?: AgentHarnessSessionOptions['validateStructuredResponse'];
  private readonly stageTelemetryEnabled: boolean;

  constructor(
    providerId: string,
    config: ProviderSettings,
    enabledTools?: string[],
    options?: AgentHarnessSessionOptions
  ) {
    super(providerId, config, enabledTools, options);
    this.responseFormat = options?.responseFormat;
    this.validateStructuredResponse = options?.validateStructuredResponse;
    this.stageTelemetryEnabled = options?.telemetryObserver !== undefined;
  }

  /** Runs one complete createAgent model/tool loop. */
  override async userSend(message: string): Promise<ConversationMessage> {
    const turnStartedAt = performance.now();
    const preparationStartedAt = performance.now();
    await inlineToolApprovalManager.loadAndApplyAutoApproveSettings();

    const userPrompt: ConversationMessage = { role: 'user', content: message };
    this.history.push(userPrompt);
    const abortController = new AbortController();
    this.currentAbortController = abortController;
    const runtimeResults = new Map<string, ToolExecutionResult>();
    let inputMessages: BaseMessage[] = [];
    let historyLengthBeforeRun = this.history.length;
    let latestMessages: BaseMessage[] = [];
    let structuredResponse: Record<string, unknown> | undefined;
    let structuredRepairAttempted = false;
    const completeTurn = (
      response: ConversationMessage,
      outcome: 'success' | 'error' = 'success'
    ) => {
      this.recordStageTiming('turn_total', turnStartedAt, outcome);
      this.recordTelemetry({ type: 'turn_complete' });
      return response;
    };

    try {
      let systemPrompt: string;
      try {
        await this.toolManager.waitForMCPToolsInitialization();
        this.currentSkillsPromptText = await this.getSkillsPromptForQuery(message);
        systemPrompt = this.createSystemPrompt();
        this.recordStageTiming('turn_preparation', preparationStartedAt, 'success');
      } catch (error) {
        this.recordStageTiming('turn_preparation', preparationStartedAt, 'error');
        throw error;
      }

      const toolAdaptationStartedAt = performance.now();
      let toolAdapter: AgentToolAdapter;
      let adaptedTools: StructuredToolInterface[];
      try {
        toolAdapter = new AgentToolAdapter(this.toolManager, {
          approvalContext: this,
          extraTools: Array.from(this.extraTools.values()) as StructuredToolInterface[],
          clearToolConfirmation: () => this.clearToolConfirmation(),
          onRuntimeResult: (toolCallId, result, context) => {
            runtimeResults.set(toolCallId, result);
            this.recordTelemetry({
              type: 'tool_call',
              tool_name: context.toolName,
              mutating: this.isMutatingToolCall(context.toolName, context.args),
              status: context.status,
              duration_ns: context.durationNs,
            });
          },
          signal: abortController.signal,
        });
        adaptedTools = toolAdapter.createTools();
        this.recordStageTiming('tool_adaptation', toolAdaptationStartedAt, 'success');
      } catch (error) {
        this.recordStageTiming('tool_adaptation', toolAdaptationStartedAt, 'error');
        throw error;
      }
      const agentConstructionStartedAt = performance.now();
      let agent: Awaited<ReturnType<typeof createAgentHarness>>;
      try {
        agent = await createAgentHarness({
          model: this.model,
          toolRuntime: {
            waitForMCPToolsInitialization: async () => undefined,
            getLangChainTools: () => adaptedTools,
          },
          systemPrompt,
          middleware: [toolAdapter.getHaltMiddleware()],
          responseFormat: this.responseFormat,
        });
        this.recordStageTiming('agent_construction', agentConstructionStartedAt, 'success');
      } catch (error) {
        this.recordStageTiming('agent_construction', agentConstructionStartedAt, 'error');
        throw error;
      }
      const historyPreparationStartedAt = performance.now();
      try {
        inputMessages = this.prepareChatHistory();
        historyLengthBeforeRun = this.history.length;
        this.recordStageTiming('history_preparation', historyPreparationStartedAt, 'success');
      } catch (error) {
        this.recordStageTiming('history_preparation', historyPreparationStartedAt, 'error');
        throw error;
      }
      const modelTiming = this.stageTelemetryEnabled
        ? this.createModelTimingCallbacks()
        : undefined;
      const streamStartedAt = performance.now();
      let streamOutcome: 'success' | 'error' = 'success';
      try {
        const stream = await agent.stream(
          { messages: inputMessages },
          {
            signal: abortController.signal,
            streamMode: 'values',
            ...(modelTiming ? { callbacks: [modelTiming.callbacks] } : {}),
          }
        );
        for await (const state of stream) {
          latestMessages = state.messages as BaseMessage[];
          structuredResponse = (state as { structuredResponse?: Record<string, unknown> })
            .structuredResponse;
        }
      } catch (error) {
        streamOutcome = 'error';
        throw error;
      } finally {
        const streamDurationMs = performance.now() - streamStartedAt;
        this.recordStageDuration(
          'agent_stream_processing',
          Math.max(0, streamDurationMs - (modelTiming?.totalDurationMs() ?? 0)),
          streamOutcome
        );
      }
      for (const generatedMessage of this.getGeneratedMessages(latestMessages, inputMessages)) {
        if (AIMessage.isInstance(generatedMessage)) this.recordModelUsage(generatedMessage);
      }

      this.appendRunMessages(latestMessages, inputMessages, runtimeResults, historyLengthBeforeRun);
      const deferredResult = this.getDeferredResultsContent(runtimeResults);
      if (deferredResult) {
        this.currentAbortController = null;
        return completeTurn({ role: 'assistant', content: deferredResult });
      }
      if (structuredResponse) {
        const validated = await this.validateOrRepairStructuredResponse(
          message,
          latestMessages,
          structuredResponse,
          abortController.signal,
          () => {
            structuredRepairAttempted = true;
          }
        );
        this.currentAbortController = null;
        return completeTurn(this.storeStructuredResponse(validated));
      }
      this.currentAbortController = null;
      return completeTurn(this.lastAssistantMessage());
    } catch (error) {
      this.appendRunMessages(latestMessages, inputMessages, runtimeResults, historyLengthBeforeRun);
      let finalError = error;
      if (
        this.responseFormat &&
        this.isStructuredOutputError(error) &&
        !structuredRepairAttempted &&
        !abortController.signal.aborted
      ) {
        try {
          structuredRepairAttempted = true;
          const repaired = await this.runStructuredRepair(() =>
            this.repairStructuredResponse(
              message,
              latestMessages,
              undefined,
              error,
              abortController.signal
            )
          );
          const validated = this.validateStructuredResponseOnce(repaired);
          this.currentAbortController = null;
          return completeTurn(this.storeStructuredResponse(validated, true));
        } catch (repairError) {
          finalError = repairError;
        }
      }
      const halt = this.asToolExecutionHalt(finalError);
      if (halt) {
        this.currentAbortController = null;
        if (halt.requiresConfirmation) {
          return completeTurn(this.lastAssistantMessage());
        }
        const deferredResult =
          this.getDeferredResultsContent(runtimeResults, true) ?? halt.resultContent;
        if (deferredResult) {
          return completeTurn({ role: 'assistant', content: deferredResult });
        }
        return completeTurn(this.lastAssistantMessage());
      }

      this.currentAbortController = null;
      return completeTurn(await this.handleUserSendError(finalError), 'error');
    }
  }

  private recordStageTiming(
    stage: AssistantTelemetryStage,
    startedAt: number,
    outcome: 'success' | 'error'
  ): void {
    if (!this.stageTelemetryEnabled) return;
    this.recordStageDuration(stage, performance.now() - startedAt, outcome);
  }

  private recordStageDuration(
    stage: AssistantTelemetryStage,
    durationMs: number,
    outcome: 'success' | 'error',
    timeToFirstTokenMs?: number
  ): void {
    if (!this.stageTelemetryEnabled) return;
    this.recordTelemetry({
      type: 'stage_timing',
      stage,
      outcome,
      duration_ns: String(Math.max(0, Math.round(durationMs * 1_000_000))),
      ...(timeToFirstTokenMs === undefined
        ? {}
        : {
            time_to_first_token_ns: String(Math.max(0, Math.round(timeToFirstTokenMs * 1_000_000))),
          }),
    });
  }

  private createModelTimingCallbacks(): {
    callbacks: {
      handleChatModelStart: (_model: unknown, _messages: unknown, runId: string) => void;
      handleLLMNewToken: (_token: string, _indices: unknown, runId: string) => void;
      handleLLMEnd: (_output: unknown, runId: string) => void;
      handleLLMError: (_error: unknown, runId: string) => void;
    };
    totalDurationMs: () => number;
  } {
    const requests = new Map<string, { startedAt: number; firstTokenAt?: number }>();
    let totalDurationMs = 0;
    const finish = (runId: string, outcome: 'success' | 'error') => {
      const request = requests.get(runId);
      if (!request) return;
      requests.delete(runId);
      const durationMs = performance.now() - request.startedAt;
      totalDurationMs += durationMs;
      this.recordStageDuration(
        'model_request',
        durationMs,
        outcome,
        request.firstTokenAt === undefined ? undefined : request.firstTokenAt - request.startedAt
      );
    };
    return {
      callbacks: {
        handleChatModelStart: (_model, _messages, runId) => {
          requests.set(runId, { startedAt: performance.now() });
        },
        handleLLMNewToken: (_token, _indices, runId) => {
          const request = requests.get(runId);
          if (request && request.firstTokenAt === undefined)
            request.firstTokenAt = performance.now();
        },
        handleLLMEnd: (_output, runId) => finish(runId, 'success'),
        handleLLMError: (_error, runId) => finish(runId, 'error'),
      },
      totalDurationMs: () => totalDurationMs,
    };
  }

  private isStructuredOutputError(
    error: unknown
  ): error is StructuredOutputParsingError | MultipleStructuredOutputsError {
    return (
      error instanceof StructuredOutputParsingError ||
      error instanceof MultipleStructuredOutputsError
    );
  }

  private async repairStructuredResponse(
    originalTask: string,
    messages: BaseMessage[],
    proposedResponse: Record<string, unknown> | undefined,
    error: Error,
    signal: AbortSignal
  ): Promise<Record<string, unknown>> {
    const proposedAnswer = messages
      .slice()
      .reverse()
      .find(message => AIMessage.isInstance(message));
    const repairAgent = await createAgentHarness({
      model: this.model,
      toolRuntime: {
        waitForMCPToolsInitialization: async () => undefined,
        getLangChainTools: () => [],
      },
      systemPrompt:
        'Repair a structured diagnosis after external schema validation failed. Use only the original task and evidence below. Do not call tools, invent evidence, or change supported claims. Return only a schema-valid response.',
      modelCallLimit: 1,
      toolCallLimit: 0,
      responseFormat: this.responseFormat,
    });
    const modelTiming = this.stageTelemetryEnabled ? this.createModelTimingCallbacks() : undefined;
    const result = await repairAgent.invoke(
      {
        messages: [
          {
            role: 'user',
            content: `Original task and evidence:\n${originalTask}\n\nProposed answer:\n${
              proposedResponse
                ? JSON.stringify(proposedResponse, null, 2)
                : proposedAnswer
                ? this.extractTextContent(proposedAnswer.content)
                : '(missing)'
            }\n\nValidation error:\n${error.message}`,
          },
        ],
      },
      { signal, ...(modelTiming ? { callbacks: [modelTiming.callbacks] } : {}) }
    );
    for (const generatedMessage of result.messages ?? []) {
      if (AIMessage.isInstance(generatedMessage)) this.recordModelUsage(generatedMessage);
    }
    const repaired = (result as { structuredResponse?: Record<string, unknown> })
      .structuredResponse;
    if (!repaired) throw error;
    return repaired;
  }

  private async validateOrRepairStructuredResponse(
    originalTask: string,
    messages: BaseMessage[],
    response: Record<string, unknown>,
    signal: AbortSignal,
    onRepairAttempt: () => void
  ): Promise<Record<string, unknown>> {
    const validation = this.runStructuredValidation(response);
    if (!validation || validation.success) return validation?.data ?? response;
    onRepairAttempt();
    const repaired = await this.runStructuredRepair(() =>
      this.repairStructuredResponse(
        originalTask,
        messages,
        response,
        new Error(validation.error),
        signal
      )
    );
    return this.validateStructuredResponseOnce(repaired);
  }

  private validateStructuredResponseOnce(
    response: Record<string, unknown>
  ): Record<string, unknown> {
    const validation = this.runStructuredValidation(response);
    if (!validation || validation.success) return validation?.data ?? response;
    throw new Error(validation.error);
  }

  private runStructuredValidation(response: Record<string, unknown>) {
    const startedAt = performance.now();
    try {
      const validation = this.validateStructuredResponse?.(response);
      this.recordStageTiming(
        'structured_validation',
        startedAt,
        !validation || validation.success ? 'success' : 'error'
      );
      return validation;
    } catch (error) {
      this.recordStageTiming('structured_validation', startedAt, 'error');
      throw error;
    }
  }

  private async runStructuredRepair<T>(repair: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await repair();
      this.recordStageTiming('structured_repair', startedAt, 'success');
      return result;
    } catch (error) {
      this.recordStageTiming('structured_repair', startedAt, 'error');
      throw error;
    }
  }

  private storeStructuredResponse(
    structuredResponse: Record<string, unknown>,
    preserveExisting = false
  ): ConversationMessage {
    const response: ConversationMessage = {
      role: 'assistant',
      content: `\`\`\`json\n${JSON.stringify(structuredResponse, null, 2)}\n\`\`\``,
    };
    if (!preserveExisting) {
      for (let index = this.history.length - 1; index >= 0; index--) {
        if (this.history[index]?.role === 'assistant') {
          this.history[index] = response;
          return response;
        }
      }
    }
    this.history.push(response);
    return response;
  }

  /**
   * Unwraps an `AgentToolExecutionHalt` from the halt-enforcement middleware.
   *
   * `createAgent`'s `ToolNode` wraps errors thrown by `wrapToolCall`
   * middleware in a `MiddlewareError`, preserving the original error on
   * `.cause`, so the halt signal must be recovered from there. When multiple
   * parallel tool calls halt in the same superstep, LangGraph aggregates them
   * into a single error exposing the individual failures on `.errors`.
   */
  private asToolExecutionHalt(error: unknown): AgentToolExecutionHalt | undefined {
    if (error instanceof AgentToolExecutionHalt) return error;
    const cause = (error as { cause?: unknown } | undefined)?.cause;
    if (cause instanceof AgentToolExecutionHalt) return cause;
    const errors = (error as { errors?: unknown[] } | undefined)?.errors;
    if (Array.isArray(errors)) {
      for (const nested of errors) {
        const halt = this.asToolExecutionHalt(nested);
        if (halt) return halt;
      }
    }
    return undefined;
  }

  /**
   * Combines every non-confirmation deferred result from a run into one
   * user-visible response.
   *
   * A single halt can be triggered by one call while parallel siblings (for
   * example concurrent MCP queries) also set `shouldProcessFollowUp: false`;
   * returning only the triggering call's content would silently drop the
   * others even though they are still recorded in session history.
   */
  private getDeferredResultsContent(
    runtimeResults: Map<string, ToolExecutionResult>,
    includeFollowUpResults = false
  ): string | undefined {
    const deferred = [...runtimeResults.values()].filter(
      result =>
        result.metadata?.requiresConfirmation !== true &&
        (includeFollowUpResults || result.shouldProcessFollowUp === false)
    );
    if (deferred.length === 0) return undefined;
    return deferred.map(result => redactSecrets(result.content)).join('\n\n');
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

  private appendRunMessages(
    resultMessages: BaseMessage[],
    inputMessages: BaseMessage[],
    runtimeResults: Map<string, ToolExecutionResult>,
    historyLengthBeforeRun: number
  ): void {
    const runtimeHistory = this.history.splice(historyLengthBeforeRun);
    if (resultMessages.length === 0) {
      this.history.push(...runtimeHistory);
      return;
    }
    this.appendAgentMessages(
      this.getGeneratedMessages(resultMessages, inputMessages),
      runtimeResults,
      runtimeHistory
    );
  }

  private appendAgentMessages(
    messages: BaseMessage[],
    runtimeResults: Map<string, ToolExecutionResult>,
    runtimeHistory: ConversationMessage[]
  ): void {
    let pendingToolCallIds = new Set<string>();
    let suspendAfterPendingResults = false;
    const toolNames = new Map<string, string>();
    const recordedToolCallIds = new Set<string>();

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
        pendingToolCallIds = new Set(
          toolCalls?.map(toolCall => toolCall.id).filter((id): id is string => Boolean(id)) ?? []
        );
        for (const toolCall of toolCalls ?? []) {
          if (toolCall.id) toolNames.set(toolCall.id, toolCall.function.name);
        }
      } else if (ToolMessage.isInstance(message)) {
        const runtimeResult = runtimeResults.get(message.tool_call_id);
        this.appendToolMessage(message, runtimeResult, runtimeHistory);
        recordedToolCallIds.add(message.tool_call_id);
        pendingToolCallIds.delete(message.tool_call_id);
        suspendAfterPendingResults ||= runtimeResult?.shouldProcessFollowUp === false;
        if (suspendAfterPendingResults && pendingToolCallIds.size === 0) {
          break;
        }
      } else if (HumanMessage.isInstance(message)) {
        this.history.push({
          role: 'user',
          content: this.extractTextContent(message.content),
        });
      }
    }

    for (const [toolCallId, runtimeResult] of runtimeResults) {
      if (recordedToolCallIds.has(toolCallId)) continue;
      this.appendToolMessage(
        new ToolMessage({
          content: runtimeResult.content,
          tool_call_id: toolCallId,
          name: toolNames.get(toolCallId),
        }),
        runtimeResult,
        runtimeHistory
      );
      recordedToolCallIds.add(toolCallId);
    }

    // Any call still pending here never produced a runtime result or tool
    // message, typically because the run aborted or halted while it was
    // still executing. Record an explicit not-executed result so history
    // stays aligned with the tool calls the model requested.
    for (const toolCallId of pendingToolCallIds) {
      if (recordedToolCallIds.has(toolCallId)) continue;
      this.history.push({
        role: 'tool',
        content: JSON.stringify({
          error: true,
          status: 'cancelled',
          message: 'Tool call did not complete before the run ended.',
        }),
        toolCallId,
        name: toolNames.get(toolCallId),
        error: true,
      });
      recordedToolCallIds.add(toolCallId);
    }
  }

  private appendToolMessage(
    message: ToolMessage,
    runtimeResult: ToolExecutionResult | undefined,
    runtimeHistory: ConversationMessage[]
  ): void {
    if (runtimeResult?.shouldAddToHistory === false) {
      const existingResult = runtimeHistory.find(
        historyMessage =>
          historyMessage.role === 'tool' && historyMessage.toolCallId === message.tool_call_id
      );
      if (existingResult) {
        // Runtime-owned history is captured before graph reconciliation and may
        // contain raw secret data from the host tool implementation.
        this.history.push({
          ...existingResult,
          content: redactSecrets(existingResult.content),
        });
      } else {
        this.history.push({
          role: 'tool',
          content: runtimeResult.metadata?.requiresConfirmation
            ? buildConfirmationPlaceholderJson(
                typeof runtimeResult.metadata.method === 'string'
                  ? runtimeResult.metadata.method
                  : undefined
              )
            : JSON.stringify({
                status: 'completed',
                shouldProcessFollowUp: runtimeResult.shouldProcessFollowUp,
              }),
          toolCallId: message.tool_call_id,
          name: message.name,
          isDisplayOnly: true,
        });
      }
    } else {
      this.history.push({
        role: 'tool',
        content: this.extractTextContent(message.content),
        toolCallId: message.tool_call_id,
        name: message.name,
        error:
          message.status === 'error' ||
          runtimeResult?.isError === true ||
          Boolean(runtimeResult?.error) ||
          Boolean(runtimeResult?.metadata?.isError || runtimeResult?.metadata?.error),
      });
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
