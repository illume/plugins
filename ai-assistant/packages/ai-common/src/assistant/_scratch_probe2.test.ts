/* scratch probe 2 */
import { tool } from '@langchain/core/tools';
import { describe, it } from 'vitest';
import { z } from 'zod';

const log = (label: string, obj: unknown) =>
  process.stderr.write(`\nPROBE2 ${label}: ${JSON.stringify(obj)}\n`);

describe('probe2 extra tool invoke return', () => {
  it('string return with toolCall in config', async () => {
    const t = tool(async () => 'plain string output', {
      name: 'x',
      description: 'x',
      schema: z.object({ a: z.string() }),
    });
    const r = await t.invoke(
      { a: 'v' },
      { toolCall: { id: 'id1', name: 'x', args: { a: 'v' }, type: 'tool_call' } as any }
    );
    log('STRING_RESULT_TYPE', typeof r);
    log('STRING_RESULT', r);
  });

  it('object return with toolCall in config', async () => {
    const t = tool(async () => ({ foo: 'bar' }), {
      name: 'y',
      description: 'y',
      schema: z.object({ a: z.string() }),
    });
    const r = await t.invoke(
      { a: 'v' },
      { toolCall: { id: 'id2', name: 'y', args: { a: 'v' }, type: 'tool_call' } as any }
    );
    log('OBJ_RESULT_TYPE', typeof r);
    log('OBJ_RESULT_ISToolMessage', (r as any)?.constructor?.name);
    log('OBJ_RESULT', r);
    log('JSON_STRINGIFY', JSON.stringify(r));
  });
});
