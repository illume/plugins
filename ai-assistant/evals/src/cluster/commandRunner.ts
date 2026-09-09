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

/**
 * A minimal, injectable process-execution boundary.
 *
 * Every real cluster adapter (kubectl/kwokctl/minikube) issues commands
 * through this interface instead of calling `child_process` directly. Tests
 * inject `createFakeCommandRunner`, which lets us exercise the adapter's
 * command construction and output-parsing logic deterministically without
 * requiring the real binaries — the "dry-run/testability" boundary the
 * adapter is built around. `createRealCommandRunner` is the only
 * implementation that touches an actual process and is what an opt-in real
 * run uses.
 */

import { spawnSync } from 'node:child_process';

/** Synchronous output captured from one cluster command. */
export interface CommandResult {
  /** Numeric process exit status. */
  status: number;
  /** Standard output emitted by the command. */
  stdout: string;
  /** Standard error emitted by the command. */
  stderr: string;
}

/**
 * Injectable synchronous command-execution boundary.
 *
 * @param command - Executable name or path.
 * @param args - Ordered command-line arguments.
 * @returns Captured status and output from the command.
 */
export type CommandRunner = (command: string, args: string[]) => CommandResult;

/**
 * Creates the real synchronous command runner used by opt-in executions.
 *
 * @returns A runner backed by `spawnSync`.
 */
export function createRealCommandRunner(): CommandRunner {
  return (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.error) {
      return { status: 127, stdout: '', stderr: String(result.error.message) };
    }
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  };
}

/**
 * Checks whether a command resolves on the current `PATH`.
 *
 * @param command - Executable name to locate.
 * @param runner - Command boundary used to invoke the platform locator.
 * @returns Whether the platform locator found the command.
 */
export function commandExists(
  command: string,
  runner: CommandRunner = createRealCommandRunner()
): boolean {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = runner(locator, [command]);
  return result.status === 0;
}

/** One invocation recorded by a fake command runner. */
export interface FakeCommandRunnerCall {
  /** Executable requested by the adapter. */
  command: string;
  /** Ordered arguments requested by the adapter. */
  args: string[];
}

/**
 * A recording, canned-response command runner for tests. Responses are
 * matched by the first N argument tokens supplied in `responses`; unmatched
 * calls return a non-zero status so a test notices a missing fixture instead
 * of silently succeeding.
 *
 * @param responses - Prefix-matched canned command results.
 * @returns A fake runner and its mutable invocation log.
 */
export function createFakeCommandRunner(
  responses: Array<{ match: string[]; result: CommandResult }>
): { runner: CommandRunner; calls: FakeCommandRunnerCall[] } {
  const calls: FakeCommandRunnerCall[] = [];
  /**
   * Records a command and returns its first matching canned response.
   *
   * @param command - Executable requested by the adapter.
   * @param args - Ordered arguments requested by the adapter.
   * @returns The matched result or a missing-fixture failure.
   */
  const runner: CommandRunner = (command, args) => {
    calls.push({ command, args });
    const full = [command, ...args];
    const hit = responses.find(r => r.match.every((token, i) => full[i] === token));
    if (!hit) {
      return {
        status: 127,
        stdout: '',
        stderr: `no fake response registered for: ${full.join(' ')}`,
      };
    }
    return hit.result;
  };
  return { runner, calls };
}
