import { describe, expect, it, vi } from 'vitest';
import type { RecommendedTool } from '../langchain/ToolPlanner';
import type { ToolResult } from '../results/formatToolResults';
import {
  buildMultiToolErrorPrompt,
  buildOrchestrationToolError,
  buildPendingToolPlaceholder,
  filterApprovedOrchestrationTools,
  OrchestrationTask,
  shouldCacheResponse,
  waitForOrchestrationResults,
} from './prepareToolPlan';

const makeTool = (name: string, extra: Partial<RecommendedTool> = {}): RecommendedTool => ({
  name,
  description: `${name} description`,
  arguments: {},
  priority: 'medium',
  reason: 'test',
  ...extra,
});

// =============================================================================
// shouldCacheResponse
// =============================================================================

describe('shouldCacheResponse', () => {
  it('returns true when toolCalls is absent', () => {
    expect(shouldCacheResponse({ role: 'assistant', content: 'hello' })).toBe(true);
  });

  it('returns true when toolCalls is undefined', () => {
    expect(shouldCacheResponse({ role: 'assistant', content: 'hi', toolCalls: undefined })).toBe(
      true
    );
  });

  it('returns true when toolCalls is an empty array', () => {
    expect(shouldCacheResponse({ role: 'assistant', content: 'hi', toolCalls: [] })).toBe(true);
  });

  it('returns false when toolCalls has entries', () => {
    const prompt = {
      role: 'assistant' as const,
      content: '',
      toolCalls: [
        { id: 'c1', type: 'function' as const, function: { name: 't', arguments: '{}' } },
      ],
    };
    expect(shouldCacheResponse(prompt)).toBe(false);
  });

  it('returns false for error responses that contain tool calls', () => {
    const prompt = {
      role: 'assistant' as const,
      content: '',
      error: true,
      toolCalls: [
        { id: 'c1', type: 'function' as const, function: { name: 't', arguments: '{}' } },
      ],
    };
    expect(shouldCacheResponse(prompt)).toBe(false);
  });
});

// =============================================================================
// filterApprovedOrchestrationTools
// =============================================================================

describe('filterApprovedOrchestrationTools', () => {
  it('returns a tool whose exact name was approved (built-in auto-approve path)', () => {
    const tools = [makeTool('kubernetes_api_request')];
    const result = filterApprovedOrchestrationTools(tools, ['kubernetes_api_request']);
    expect(result).toHaveLength(1);
  });

  it('returns a tool whose orchestrated-<name>-<ts> id prefix was approved', () => {
    const tools = [makeTool('my_mcp_tool')];
    const approvedIds = ['orchestrated-my_mcp_tool-1720000000000'];
    expect(filterApprovedOrchestrationTools(tools, approvedIds)).toHaveLength(1);
  });

  it('excludes a tool whose name is not in approvedIds and has no matching prefix', () => {
    const tools = [makeTool('denied_tool')];
    expect(filterApprovedOrchestrationTools(tools, ['other_tool'])).toHaveLength(0);
  });

  it('handles a mix of approved and denied tools', () => {
    const tools = [makeTool('tool_a'), makeTool('tool_b'), makeTool('tool_c')];
    const approved = ['tool_a', 'orchestrated-tool_c-123'];
    const result = filterApprovedOrchestrationTools(tools, approved);
    expect(result.map(t => t.name)).toEqual(['tool_a', 'tool_c']);
  });

  it('returns empty array when approvedIds is empty', () => {
    expect(filterApprovedOrchestrationTools([makeTool('t')], [])).toHaveLength(0);
  });

  it('returns empty array when recommendedTools is empty', () => {
    expect(filterApprovedOrchestrationTools([], ['orchestrated-t-1'])).toHaveLength(0);
  });

  it('does not match a partial name prefix (tool_a should not match tool_ab)', () => {
    const tools = [makeTool('tool_ab')];
    // Approved id has prefix for "tool_a" not "tool_ab"
    expect(filterApprovedOrchestrationTools(tools, ['orchestrated-tool_a-123'])).toHaveLength(0);
  });
});

// =============================================================================
// buildOrchestrationToolError
// =============================================================================

describe('buildOrchestrationToolError', () => {
  it('sets error to true', () => {
    expect(buildOrchestrationToolError('my_tool', null).error).toBe(true);
  });

  it('includes the tool name in the message', () => {
    const result = buildOrchestrationToolError('kubernetes_api', null);
    expect(result.message).toContain('kubernetes_api');
  });

  it('includes the error message when an Error is provided', () => {
    const err = new Error('timeout');
    expect(buildOrchestrationToolError('t', err).message).toContain('timeout');
  });

  it('falls back to "Unknown error" when error is null', () => {
    expect(buildOrchestrationToolError('t', null).message).toContain('Unknown error');
  });

  it('falls back to "Unknown error" when error is undefined', () => {
    expect(buildOrchestrationToolError('t', undefined).message).toContain('Unknown error');
  });

  it('produces a message in the form "Failed to execute <name>: <reason>"', () => {
    const result = buildOrchestrationToolError('exec_tool', new Error('disk full'));
    expect(result.message).toMatch(/^Failed to execute exec_tool: disk full/);
  });
});

// =============================================================================
// buildMultiToolErrorPrompt
// =============================================================================

describe('buildMultiToolErrorPrompt', () => {
  it('returns a prompt with role assistant', () => {
    expect(buildMultiToolErrorPrompt(null).role).toBe('assistant');
  });

  it('sets error to true', () => {
    expect(buildMultiToolErrorPrompt(null).error).toBe(true);
  });

  it('includes the error message when provided', () => {
    const result = buildMultiToolErrorPrompt(new Error('something broke'));
    expect(result.content).toContain('something broke');
  });

  it('uses "Unknown error" when error is null', () => {
    expect(buildMultiToolErrorPrompt(null).content).toContain('Unknown error');
  });

  it('uses "Unknown error" when error is undefined', () => {
    expect(buildMultiToolErrorPrompt(undefined).content).toContain('Unknown error');
  });

  it('suggests the user try again', () => {
    expect(buildMultiToolErrorPrompt(null).content.toLowerCase()).toContain('try');
  });
});

// =============================================================================
// buildPendingToolPlaceholder
// =============================================================================

describe('buildPendingToolPlaceholder', () => {
  it('marks the result as pending', () => {
    expect(buildPendingToolPlaceholder('get_pods').pending).toBe(true);
  });

  it('includes the tool name in the message', () => {
    expect(buildPendingToolPlaceholder('get_pods').message).toContain('get_pods');
  });
});

// =============================================================================
// waitForOrchestrationResults
// =============================================================================

/** Creates a promise plus external resolve/reject controls for deterministic tests. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const successResult: ToolResult = { success: true, data: { ok: true } };

describe('waitForOrchestrationResults', () => {
  it('waits for all tasks when every task is required (default/no optional tools)', async () => {
    const a = deferred<ToolResult>();
    const b = deferred<ToolResult>();
    const tasks: OrchestrationTask[] = [
      { name: 'a', required: true, run: () => a.promise },
      { name: 'b', required: true, run: () => b.promise },
    ];

    let settled = false;
    const resultPromise = waitForOrchestrationResults(tasks).then(r => {
      settled = true;
      return r;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    a.resolve(successResult);
    await Promise.resolve();
    expect(settled).toBe(false); // still waiting on b

    b.resolve(successResult);
    const results = await resultPromise;
    expect(results.a).toEqual(successResult);
    expect(results.b).toEqual(successResult);
  });

  it('does not wait for a slow optional tool once required tools have settled', async () => {
    const required = deferred<ToolResult>();
    const optional = deferred<ToolResult>(); // never resolves in this test
    const tasks: OrchestrationTask[] = [
      { name: 'required_tool', required: true, run: () => required.promise },
      { name: 'optional_tool', required: false, run: () => optional.promise },
    ];

    const resultsPromise = waitForOrchestrationResults(tasks);
    required.resolve(successResult);

    const results = await resultsPromise;
    expect(results.required_tool).toEqual(successResult);
    expect(results.optional_tool).toEqual(buildPendingToolPlaceholder('optional_tool'));
  });

  it('uses an optional tool result if it happens to settle before required tools do', async () => {
    const required = deferred<ToolResult>();
    const optional = deferred<ToolResult>();
    const tasks: OrchestrationTask[] = [
      { name: 'required_tool', required: true, run: () => required.promise },
      { name: 'optional_tool', required: false, run: () => optional.promise },
    ];

    const resultsPromise = waitForOrchestrationResults(tasks);
    const optionalResult: ToolResult = { success: true, data: { fast: true } };
    optional.resolve(optionalResult);
    await Promise.resolve();
    await Promise.resolve();

    required.resolve(successResult);
    const results = await resultsPromise;
    expect(results.optional_tool).toEqual(optionalResult);
  });

  it('races for the first successful result when every task is optional', async () => {
    const slow = deferred<ToolResult>();
    const fast = deferred<ToolResult>();
    const tasks: OrchestrationTask[] = [
      { name: 'slow_tool', required: false, run: () => slow.promise },
      { name: 'fast_tool', required: false, run: () => fast.promise },
    ];

    const resultsPromise = waitForOrchestrationResults(tasks, 5_000);
    fast.resolve(successResult);

    const results = await resultsPromise;
    expect(results.fast_tool).toEqual(successResult);
    expect(results.slow_tool).toEqual(buildPendingToolPlaceholder('slow_tool'));
  });

  it('returns immediately once every optional task has failed, without waiting the full deadline', async () => {
    vi.useFakeTimers();
    try {
      const failingA = deferred<ToolResult>();
      const failingB = deferred<ToolResult>();
      const tasks: OrchestrationTask[] = [
        { name: 'a', required: false, run: () => failingA.promise },
        { name: 'b', required: false, run: () => failingB.promise },
      ];

      const resultsPromise = waitForOrchestrationResults(tasks, 60_000);

      failingA.resolve({ error: true, message: 'boom a' });
      failingB.resolve({ error: true, message: 'boom b' });

      // Let the microtask queue drain the resolved promises without advancing
      // the 60s timer — proves we don't wait out the deadline when nothing
      // left could possibly succeed.
      await vi.advanceTimersByTimeAsync(0);

      const results = await resultsPromise;
      expect(results.a).toEqual({ error: true, message: 'boom a' });
      expect(results.b).toEqual({ error: true, message: 'boom b' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up at the deadline when every optional task is genuinely stuck', async () => {
    vi.useFakeTimers();
    try {
      const stuck = new Promise<ToolResult>(() => {}); // never settles
      const tasks: OrchestrationTask[] = [{ name: 'stuck_tool', required: false, run: () => stuck }];

      const resultsPromise = waitForOrchestrationResults(tasks, 10_000);

      let settled = false;
      resultsPromise.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(9_999);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const results = await resultsPromise;
      expect(settled).toBe(true);
      expect(results.stuck_tool).toEqual(buildPendingToolPlaceholder('stuck_tool'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('records a rejected task run() as an orchestration error rather than throwing', async () => {
    const tasks: OrchestrationTask[] = [
      {
        name: 'broken_tool',
        required: true,
        run: () => Promise.reject(new Error('exploded')),
      },
    ];

    const results = await waitForOrchestrationResults(tasks);
    expect(results.broken_tool).toEqual(buildOrchestrationToolError('broken_tool', new Error('exploded')));
  });

  it('records a synchronous throw from run() as an orchestration error rather than crashing', async () => {
    const tasks: OrchestrationTask[] = [
      {
        name: 'sync_throw_tool',
        required: true,
        run: () => {
          throw new Error('threw before returning a promise');
        },
      },
    ];

    const results = await waitForOrchestrationResults(tasks);
    expect(results.sync_throw_tool).toEqual(
      buildOrchestrationToolError('sync_throw_tool', new Error('threw before returning a promise'))
    );
  });

  it('completes with error-shaped results and no hang when every required task fails', async () => {
    const tasks: OrchestrationTask[] = [
      { name: 'a', required: true, run: () => Promise.resolve({ error: true, message: 'a failed' }) },
      { name: 'b', required: true, run: () => Promise.reject(new Error('b failed')) },
    ];

    const results = await waitForOrchestrationResults(tasks);
    expect(results.a).toEqual({ error: true, message: 'a failed' });
    expect(results.b).toEqual(buildOrchestrationToolError('b', new Error('b failed')));
  });

  it('reports a partial required failure alongside a still-pending optional tool', async () => {
    const requiredOk = deferred<ToolResult>();
    const requiredFail = deferred<ToolResult>();
    const optional = deferred<ToolResult>(); // never resolves in this test
    const tasks: OrchestrationTask[] = [
      { name: 'required_ok', required: true, run: () => requiredOk.promise },
      { name: 'required_fail', required: true, run: () => requiredFail.promise },
      { name: 'optional_tool', required: false, run: () => optional.promise },
    ];

    const resultsPromise = waitForOrchestrationResults(tasks);
    requiredOk.resolve(successResult);
    requiredFail.resolve({ error: true, message: 'required_fail broke' });

    const results = await resultsPromise;
    expect(results.required_ok).toEqual(successResult);
    expect(results.required_fail).toEqual({ error: true, message: 'required_fail broke' });
    expect(results.optional_tool).toEqual(buildPendingToolPlaceholder('optional_tool'));
  });

  it('does not end the all-optional race on an early failure, only on a later success', async () => {
    const early = deferred<ToolResult>();
    const later = deferred<ToolResult>();
    const tasks: OrchestrationTask[] = [
      { name: 'early_fail', required: false, run: () => early.promise },
      { name: 'later_success', required: false, run: () => later.promise },
    ];

    const resultsPromise = waitForOrchestrationResults(tasks, 60_000);

    early.resolve({ error: true, message: 'early failure' });
    await Promise.resolve();
    await Promise.resolve();

    later.resolve(successResult);
    const results = await resultsPromise;
    expect(results.early_fail).toEqual({ error: true, message: 'early failure' });
    expect(results.later_success).toEqual(successResult);
  });

  it('returns an empty map for an empty task list', async () => {
    const results = await waitForOrchestrationResults([]);
    expect(results).toEqual({});
  });
});
