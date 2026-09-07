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

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (command: string, args: string[]) => CommandResult;

/** Real process execution via `spawnSync`. Used only for opt-in real runs. */
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

/** Returns whether `command` resolves on `PATH` without spawning anything else. */
export function commandExists(
  command: string,
  runner: CommandRunner = createRealCommandRunner()
): boolean {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const result = runner(locator, [command]);
  return result.status === 0;
}

export interface FakeCommandRunnerCall {
  command: string;
  args: string[];
}

/**
 * A recording, canned-response command runner for tests. Responses are
 * matched by the first N argument tokens supplied in `responses`; unmatched
 * calls return a non-zero status so a test notices a missing fixture instead
 * of silently succeeding.
 */
export function createFakeCommandRunner(
  responses: Array<{ match: string[]; result: CommandResult }>
): { runner: CommandRunner; calls: FakeCommandRunnerCall[] } {
  const calls: FakeCommandRunnerCall[] = [];
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
