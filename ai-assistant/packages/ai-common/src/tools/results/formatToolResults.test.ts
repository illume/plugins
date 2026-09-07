import { describe, expect, it } from 'vitest';
import { aggregateToolResults, formatToolResultsForLLM } from './formatToolResults';

describe('aggregateToolResults', () => {
  it('shows Error section when result.error is set', () => {
    const out = aggregateToolResults({ my_tool: { error: true, message: 'something went wrong' } });
    expect(out).toContain('### my_tool');
    expect(out).toContain('**Error**: something went wrong');
    expect(out).not.toContain('Successfully executed');
  });

  it('shows Success section when result.success is set', () => {
    const out = aggregateToolResults({ my_tool: { success: true, data: { count: 3 } } });
    expect(out).toContain('**Status**: Successfully executed');
    expect(out).toContain('"count": 3');
  });

  it('falls through to raw Result JSON when neither error nor success flag', () => {
    const out = aggregateToolResults({ my_tool: { pods: ['a', 'b'] } });
    expect(out).toContain('**Result**:');
    expect(out).toContain('"pods"');
  });

  it('includes a section for every tool in the map', () => {
    const out = aggregateToolResults({
      tool_a: { success: true, data: null },
      tool_b: { error: true, message: 'oops' },
    });
    expect(out).toContain('### tool_a');
    expect(out).toContain('### tool_b');
  });

  it('returns the header even for an empty results map', () => {
    const out = aggregateToolResults({});
    expect(out).toContain('## Tool Execution Results');
  });

  it('redacts structured Kubernetes Secret data before Markdown serialization', () => {
    const out = aggregateToolResults({
      kubernetes: {
        success: true,
        data: { kind: 'Secret', data: { DATABASE_URL: 'cG9zdGdyZXM6Ly8=' } },
      },
    });
    expect(out).not.toContain('cG9zdGdyZXM6Ly8=');
    expect(out).toContain('[REDACTED]');
  });

  it('shows a still-running indicator for a pending result instead of Error/Success/raw JSON', () => {
    const out = aggregateToolResults({
      slow_tool: { pending: true, message: 'slow_tool was still running and was not waited on.' },
    });
    expect(out).toContain('### slow_tool');
    expect(out).toContain('⏳ Still running');
    expect(out).toContain('slow_tool was still running');
    expect(out).not.toContain('**Error**:');
    expect(out).not.toContain('Successfully executed');
  });

  it('treats a pending result as pending even when it also carries an error flag', () => {
    // Defensive: pending must take precedence so a placeholder is never
    // mistaken for a genuine failure of a tool that is still in flight.
    const out = aggregateToolResults({ slow_tool: { pending: true, error: true } });
    expect(out).toContain('⏳ Still running');
    expect(out).not.toContain('**Error**:');
  });
});

describe('formatToolResultsForLLM', () => {
  it('renders ❌ and the error message when result.error is truthy', () => {
    const out = formatToolResultsForLLM({ my_tool: { error: true, message: 'network fail' } });
    expect(out).toContain('❌ Error');
    expect(out).toContain('network fail');
  });

  it('also treats result.isError as an error indicator', () => {
    const out = formatToolResultsForLLM({ my_tool: { isError: true, message: 'alt flag' } });
    expect(out).toContain('❌ Error');
    expect(out).toContain('alt flag');
  });

  it('renders ✅ and JSON-encodes result.data when present', () => {
    const out = formatToolResultsForLLM({ my_tool: { data: { items: [1, 2] } } });
    expect(out).toContain('✅ Success');
    expect(out).toContain('"items"');
    expect(out).toContain('**Data**:');
  });

  it('prefers result.content over raw JSON when data is absent', () => {
    const out = formatToolResultsForLLM({ my_tool: { content: 'plain output' } });
    expect(out).toContain('plain output');
    expect(out).not.toContain('**Result**:');
  });

  it('falls back to full JSON when neither data nor content is present', () => {
    const out = formatToolResultsForLLM({ my_tool: { foo: 'bar' } });
    expect(out).toContain('**Result**:');
    expect(out).toContain('"foo"');
  });

  it('uses "Unknown error" when error has no message', () => {
    const out = formatToolResultsForLLM({ my_tool: { error: true } });
    expect(out).toContain('Unknown error');
  });

  it('data: undefined does not trigger the data branch (falls through to result branch)', () => {
    const out = formatToolResultsForLLM({ my_tool: { data: undefined, other: 42 } });
    // data is undefined → should not show "**Data**:" for a json block
    expect(out).toContain('**Result**:');
    expect(out).toContain('"other": 42');
  });

  it('renders a section for every tool', () => {
    const out = formatToolResultsForLLM({
      alpha: { data: { x: 1 } },
      beta: { error: true, message: 'boom' },
    });
    expect(out).toContain('### alpha');
    expect(out).toContain('### beta');
  });

  it('includes the header even for an empty map', () => {
    const out = formatToolResultsForLLM({});
    expect(out).toContain('## Tool Execution Results');
  });

  it('redacts Secret data nested in structured LLM results', () => {
    const out = formatToolResultsForLLM({
      kubernetes: {
        data: {
          kind: 'List',
          items: [{ kind: 'Secret', stringData: { password: 'hunter2' } }],
        },
      },
    });
    expect(out).not.toContain('hunter2');
    expect(out).toContain('[REDACTED]');
  });

  it('renders a still-running status and default message for a pending result', () => {
    const out = formatToolResultsForLLM({ slow_tool: { pending: true } });
    expect(out).toContain('⏳ Still running');
    expect(out.toLowerCase()).toContain('still being gathered');
    expect(out).not.toContain('❌ Error');
    expect(out).not.toContain('✅ Success');
  });

  it('renders the pending placeholder message when provided', () => {
    const out = formatToolResultsForLLM({
      slow_tool: { pending: true, message: 'slow_tool was still running and was not waited on.' },
    });
    expect(out).toContain('slow_tool was still running');
  });

  it('treats a pending result as pending even when it also carries data/error flags', () => {
    const out = formatToolResultsForLLM({
      slow_tool: { pending: true, error: true, data: { partial: true } },
    });
    expect(out).toContain('⏳ Still running');
    expect(out).not.toContain('❌ Error');
    expect(out).not.toContain('✅ Success');
  });
});
