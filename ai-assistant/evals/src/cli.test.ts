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
 * End-to-end CLI tests: spawns `src/cli.ts` through the local `tsx` binary,
 * exactly like a developer running `npm run eval:local:kwok` would. Every
 * test uses a scratch runs/results directory rooted under
 * `evals/.test-scratch/` so nothing touches the real `.eval-runs`/`results`
 * trees.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeScratchDir, removeScratchDir } from './test-helpers/scratchDir.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const evalsRoot = path.resolve(here, '..');
const tsxBin = path.join(evalsRoot, 'node_modules', '.bin', 'tsx');
const cliPath = path.join(evalsRoot, 'src', 'cli.ts');

function runCli(args: string[]): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(tsxBin, [cliPath, ...args], { encoding: 'utf8' });
  return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', status: result.status ?? 1 };
}

test('cli run: local-kwok dry-run reference produces two passing trials', () => {
  const dir = makeScratchDir('cli-run');
  try {
    const result = runCli([
      'run',
      '--profile',
      'local-kwok',
      '--candidate',
      'reference',
      '--runs-dir',
      dir,
      '--contracts-dir',
      path.join(dir, 'contracts'),
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /trials: 2/);
    assert.match(result.stdout, /root_cause=pass/);
    const runId = /run_id: (\S+)/.exec(result.stdout)?.[1] ?? '';
    assert.equal(existsSync(path.join(dir, runId, 'projections', 'exports')), false);

    const exportResult = runCli([
      'export',
      '--run',
      runId,
      '--runs-dir',
      dir,
      '--contracts-dir',
      path.join(dir, 'contracts'),
    ]);
    assert.equal(exportResult.status, 0, exportResult.stderr);
    assert.match(exportResult.stdout, /Wrote LangSmith projection/);
    assert.match(exportResult.stdout, /Wrote OTLP projection/);
    assert.equal(readdirSync(path.join(dir, runId, 'projections', 'exports')).length, 2);
  } finally {
    removeScratchDir(dir);
  }
});

test('cli run: rejects an incompatible --case on local-kwok with a non-zero exit', () => {
  const dir = makeScratchDir('cli-run-incompatible');
  try {
    const result = runCli([
      'run',
      '--profile',
      'local-kwok',
      '--candidate',
      'reference',
      '--case',
      'core-unschedulable-capacity-v1',
      '--runs-dir',
      dir,
      '--contracts-dir',
      path.join(dir, 'contracts'),
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not in the generated KWOK-compatible subset/);
  } finally {
    removeScratchDir(dir);
  }
});

test('cli run: rejects incomplete pricing before creating a run', () => {
  const dir = makeScratchDir('cli-run-pricing');
  try {
    const result = runCli([
      'run',
      '--pricing-source',
      'test-prices',
      '--input-usd-per-million',
      '2.50',
      '--runs-dir',
      dir,
    ]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pricing-source.*input-usd-per-million.*output-usd-per-million/);
    assert.deepEqual(readdirSync(dir), []);
  } finally {
    removeScratchDir(dir);
  }
});

test('cli list-scenarios: local-kwok lists exactly the two kwok-compatible cases', () => {
  const result = runCli(['list-scenarios', '--profile', 'local-kwok']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /core-service-selector-fault-v1 \(kwok_compatible=true\)/);
  assert.match(result.stdout, /core-service-selector-healthy-v1 \(kwok_compatible=true\)/);
  assert.doesNotMatch(result.stdout, /core-unschedulable-capacity-v1/);
});

test('cli report:publish + report:overall --check: publish then verify a matching overall view', () => {
  const runsDir = makeScratchDir('cli-runs');
  const resultsDir = makeScratchDir('cli-results');
  const contractsDir = path.join(runsDir, 'contracts');
  try {
    const runResult = runCli([
      'run',
      '--profile',
      'local-kwok',
      '--candidate',
      'reference',
      '--runs-dir',
      runsDir,
      '--contracts-dir',
      contractsDir,
    ]);
    assert.equal(runResult.status, 0, runResult.stderr);
    const runIdMatch = /run_id: (\S+)/.exec(runResult.stdout);
    assert.ok(runIdMatch, 'expected run_id in CLI output');
    const runId = runIdMatch?.[1] ?? '';

    const publishResult = runCli([
      'report:publish',
      '--run',
      runId,
      '--runs-dir',
      runsDir,
      '--contracts-dir',
      contractsDir,
      '--results-dir',
      resultsDir,
    ]);
    assert.equal(publishResult.status, 0, publishResult.stderr);
    assert.match(publishResult.stdout, /Published pub_/);

    const checkResult = runCli(['report:overall', '--check', '--results-dir', resultsDir]);
    assert.equal(checkResult.status, 0, checkResult.stderr);
    assert.match(checkResult.stdout, /passed/);
  } finally {
    removeScratchDir(runsDir);
    removeScratchDir(resultsDir);
  }
});

test('cli with no command prints usage and exits 0', () => {
  const result = runCli([]);
  assert.equal(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});

test('cli with an unknown command prints usage and exits non-zero', () => {
  const result = runCli(['bogus-command']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
});
