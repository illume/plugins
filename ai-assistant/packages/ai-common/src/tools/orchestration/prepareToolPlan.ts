/**
 * Pure helpers for tool orchestration, approval filtering, caching, and error
 * responses.
 */

import type { ConversationMessage as Prompt } from '../../conversation/types';
import type { RecommendedTool } from '../langchain/ToolPlanner';
import type { ToolResult } from '../results/formatToolResults';

// ---------------------------------------------------------------------------
// shouldCacheResponse
// ---------------------------------------------------------------------------

/**
 * Returns `true` when a completed assistant response should be written to the
 * in-memory response cache.
 *
 * Responses that contain tool calls are never cached because they depend on
 * live cluster state and must be re-fetched on every request.
 *
 * @param response - Completed assistant response to inspect.
 * @returns Whether the response is independent of live tool execution.
 */
export function shouldCacheResponse(response: Prompt): boolean {
  return !response.toolCalls || response.toolCalls.length === 0;
}

// ---------------------------------------------------------------------------
// filterApprovedOrchestrationTools
// ---------------------------------------------------------------------------

/** Shape of a prepared orchestration tool entry (before approval). */
export interface PreparedOrchestrationTool {
  /** Orchestration identifier used by approval responses. */
  id: string;
  /** Tool identifier recommended for execution. */
  name: string;
  /** Optional arguments prepared for the tool. */
  arguments?: Record<string, unknown>;
  /** Additional planner metadata retained through approval. */
  [key: string]: unknown;
}

/**
 * Filters `recommendedTools` to only those whose orchestration ID was included
 * in `approvedIds`.
 *
 * Orchestration IDs have the form `orchestrated-<toolName>-<timestamp>`, so
 * the match uses `id.startsWith('orchestrated-<toolName>-')` as well as an
 * exact `id === toolName` fallback for built-in tools that were auto-approved
 * by name.
 *
 * @param recommendedTools   - The full list of recommended tools from the orchestrator.
 * @param approvedIds        - IDs (or tool names) that the user approved.
 * @returns Recommended tools whose name or orchestration prefix was approved.
 */
export function filterApprovedOrchestrationTools(
  recommendedTools: RecommendedTool[],
  approvedIds: string[]
): RecommendedTool[] {
  return recommendedTools.filter(tool => {
    const prefix = `orchestrated-${tool.name}-`;
    return approvedIds.some(id => id === tool.name || id.startsWith(prefix));
  });
}

// ---------------------------------------------------------------------------
// buildOrchestrationToolError
// ---------------------------------------------------------------------------

/**
 * Builds the error-result object stored in `toolResults` when a single tool
 * in an orchestrated execution batch throws.
 *
 * The returned object is stored under the tool name key and later passed to
 * `formatToolResultsForLLM` / `generateResponseFromToolResults`.
 *
 * @param toolName - Name of the tool that failed.
 * @param error    - The caught error (may be `null`/`undefined` in some JS runtimes).
 * @returns A structured failed-result payload for the tool.
 */
export function buildOrchestrationToolError(
  toolName: string,
  error: Error | null | undefined
): {
  /** Constant error flag consumed by result formatting. */
  error: true;
  /** Human-readable tool failure message. */
  message: string;
} {
  return {
    error: true,
    message: `Failed to execute ${toolName}: ${error?.message ?? 'Unknown error'}`,
  };
}

// ---------------------------------------------------------------------------
// buildMultiToolErrorPrompt
// ---------------------------------------------------------------------------

/**
 * Builds the fallback assistant message returned when multi-tool coordination
 * throws an unexpected error.
 *
 * @param error - The caught error.
 * @returns An assistant error message that asks the user to retry or simplify.
 */
export function buildMultiToolErrorPrompt(error: Error | null | undefined): Prompt {
  return {
    role: 'assistant',
    content: `I encountered an error coordinating multiple tools: ${
      error?.message ?? 'Unknown error'
    }.\n\nPlease try your request again or ask a simpler question.`,
    error: true,
  };
}

// ---------------------------------------------------------------------------
// buildPendingToolPlaceholder
// ---------------------------------------------------------------------------

/**
 * Builds the placeholder result recorded for an optional tool that was still
 * running when the assistant decided to respond without waiting for it.
 *
 * @param toolName - Name of the tool that had not finished yet.
 * @returns A `pending: true` result consumed by `formatToolResultsForLLM`.
 */
export function buildPendingToolPlaceholder(toolName: string): ToolResult {
  return {
    pending: true,
    message: `${toolName} was still running and was not waited on; its result was not available in time for this response.`,
  };
}

// ---------------------------------------------------------------------------
// waitForOrchestrationResults
// ---------------------------------------------------------------------------

/** Default ceiling on how long an "any required" batch waits with no required tool to gate it. */
export const DEFAULT_OPTIONAL_TOOL_TIMEOUT_MS = 15_000;

/** One tool execution to run as part of an orchestrated batch. */
export interface OrchestrationTask {
  /** Tool name; used as the key in the returned results map. */
  name: string;
  /** Whether the batch must wait for this tool before proceeding. */
  required: boolean;
  /**
   * Starts tool execution and resolves with its result. Implementations are
   * expected to already catch tool errors into an error-shaped `ToolResult`
   * (matching the existing `buildOrchestrationToolError` pattern) so a
   * rejection here is treated as a last-resort, unexpected failure.
   */
  run: () => Promise<ToolResult>;
}

/**
 * Waits for `tasks` to settle enough to generate a response, without
 * necessarily waiting for every tool.
 *
 * Policy:
 * - Every task runs concurrently regardless of `required`; nothing is
 *   delayed or aborted.
 * - When at least one task is `required`, the batch waits only for the
 *   required tasks (`Promise.all`). Any optional task not yet settled by
 *   that point is recorded as pending via `buildPendingToolPlaceholder` — a
 *   slow "nice to have" tool never delays the response once the tools the
 *   answer actually needs have returned. Optional tasks keep running in the
 *   background; if they resolve after this function returns, the mutation to
 *   the returned map has no further effect on the current turn.
 * - When every task is optional (no required tool to gate on), the batch
 *   races for the first *successful* result instead, bounded by
 *   `optionalTimeoutMs` so a batch of entirely stuck/failing tools cannot
 *   block forever. Remaining unsettled tasks are recorded as pending.
 * - When `tasks` contains no optional entries at all (the default, since
 *   `RecommendedTool.required` defaults to `true`), this reduces to the
 *   original "wait for everything" behavior.
 *
 * @param tasks - Tool executions to run, each already wrapping its own
 *                error handling.
 * @param optionalTimeoutMs - Deadline used only in the all-optional case.
 * @returns Tool name → result map, including `pending` placeholders for any
 *          optional tool not waited on to completion.
 */
export async function waitForOrchestrationResults(
  tasks: OrchestrationTask[],
  optionalTimeoutMs: number = DEFAULT_OPTIONAL_TOOL_TIMEOUT_MS
): Promise<Record<string, ToolResult>> {
  const results: Record<string, ToolResult> = {};

  const requiredTasks = tasks.filter(task => task.required);
  const optionalTasks = tasks.filter(task => !task.required);

  // Launch every task immediately and track its settlement into `results`,
  // regardless of which wait strategy below ends up applying. `track()` never
  // rejects itself (both branches of `.then` just write to `results`), but a
  // defensive `.catch()` is attached below wherever a tracked promise is not
  // otherwise awaited, so an unexpected throw can't surface as an unhandled
  // rejection once the required-gated path stops waiting on optional tasks.
  const track = (task: OrchestrationTask): Promise<void> =>
    task.run().then(
      result => {
        results[task.name] = result;
      },
      error => {
        results[task.name] = buildOrchestrationToolError(task.name, error as Error | null);
      }
    );

  const requiredTracked = requiredTasks.map(track);
  const optionalTracked = optionalTasks.map(task => track(task).catch(() => {}));

  if (requiredTasks.length > 0 || optionalTasks.length === 0) {
    // Default / required-gated case.
    await Promise.all(requiredTracked);
  } else {
    // Every task is optional — race for the first success, bounded by a
    // deadline so a fully-stuck batch still returns.
    await Promise.race([
      firstSuccessOrAllSettled(optionalTasks, optionalTracked, results),
      delay(optionalTimeoutMs),
    ]);
  }

  for (const task of optionalTasks) {
    if (!(task.name in results)) {
      results[task.name] = buildPendingToolPlaceholder(task.name);
    }
  }

  return results;
}

/**
 * Resolves as soon as the first optional task succeeds, or once every
 * optional task has settled (so an all-failing batch doesn't wait out the
 * full deadline for nothing).
 *
 * @param tasks - Optional tasks being raced.
 * @param tracked - Settlement promises produced by `track()` for `tasks`, in order.
 * @param results - Shared results map mutated by `track()` as tasks settle.
 * @returns A promise resolved once the race is decided.
 */
function firstSuccessOrAllSettled(
  tasks: OrchestrationTask[],
  tracked: Promise<void>[],
  results: Record<string, ToolResult>
): Promise<void> {
  if (tasks.length === 0) return Promise.resolve();

  return new Promise<void>(resolve => {
    let settledCount = 0;
    tasks.forEach((task, index) => {
      tracked[index].then(() => {
        settledCount++;
        const result = results[task.name];
        const succeeded = !!result && !result.error && !result.isError && !result.pending;
        if (succeeded || settledCount === tasks.length) {
          resolve();
        }
      });
    });
  });
}

/**
 * Resolves after `ms` milliseconds. Used only as a bounded ceiling for the
 * all-optional wait race — never for the default/required-gated path.
 *
 * @param ms - Delay in milliseconds.
 * @returns A promise resolved after the delay.
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
