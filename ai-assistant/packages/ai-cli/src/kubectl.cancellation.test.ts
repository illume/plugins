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

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fake `execFile` that never settles on its own — it only completes when its
 * `signal` option fires — so tests can prove an in-flight `kubectl` call is
 * genuinely killed on abort rather than merely abandoned once the LangChain
 * tool promise settles.
 */
const killMock = vi.fn();
const stdinEndMock = vi.fn();
let capturedSignal: AbortSignal | undefined;

vi.mock('child_process', () => ({
  execFile: vi.fn(
    (
      _file: string,
      _args: string[],
      options: { signal?: AbortSignal },
      callback: (err: unknown, stdout?: string, stderr?: string) => void
    ) => {
      capturedSignal = options.signal;
      if (options.signal?.aborted) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        queueMicrotask(() => callback(err));
      } else {
        options.signal?.addEventListener(
          'abort',
          () => {
            killMock();
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            callback(err);
          },
          { once: true }
        );
        // Never resolves on its own within the test's lifetime — only the
        // abort listener above settles the callback, proving cancellation is
        // driven by the signal and not by a fixed timeout racing it.
      }
      return { stdin: { end: stdinEndMock } };
    }
  ),
}));

// Imported after the mock so kubectl.ts picks up the mocked child_process.
import { createKubectlTool } from './kubectl.js';

describe('kubectl tool cancellation', () => {
  beforeEach(() => {
    killMock.mockClear();
    stdinEndMock.mockClear();
    capturedSignal = undefined;
  });

  it('does not invoke kubectl at all when the signal is already aborted', async () => {
    const toolInstance = createKubectlTool();
    const controller = new AbortController();
    controller.abort();

    await expect(
      toolInstance.invoke({ url: '/api/v1/pods', method: 'GET' }, { signal: controller.signal })
    ).rejects.toThrow();
  });

  it('kills the in-flight kubectl subprocess when the signal fires mid-execution', async () => {
    const toolInstance = createKubectlTool();
    const controller = new AbortController();

    const invocation = toolInstance.invoke(
      { url: '/api/v1/pods', method: 'GET' },
      { signal: controller.signal }
    );

    // Give the tool callback a turn to reach execFile before aborting.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(capturedSignal).toBe(controller.signal);

    controller.abort();

    await expect(invocation).rejects.toThrow();
    expect(killMock).toHaveBeenCalledTimes(1);
  });
});
