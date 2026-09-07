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
 * Reads a closed canonical bundle back from disk. This is the "clean-room"
 * reader the report generator and `--check` publication verifier use: no
 * model/network access, no re-execution of any trial, only retained
 * immutable JSON/JSONL.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sha256OfText, type JsonValue } from '../canonicalJson.js';
import { readJsonlPayloads } from './jsonl.js';
import type { RegressionDelta, TrialResult } from '../contracts/types.js';
import type { TrialIndexRow } from './bundleWriter.js';

export interface ClosedBundle {
  runDir: string;
  bundleDir: string;
  manifest: Record<string, unknown>;
  bundleDigest: string;
  trialIndex: TrialIndexRow[];
  trials: TrialResult[];
  regressionDeltas: RegressionDelta[];
}

/** Reads and validates a closed bundle; throws if `manifest.json` is absent or not closed. */
export function readClosedBundle(runsRoot: string, runId: string): ClosedBundle {
  const runDir = path.join(runsRoot, runId);
  const bundleDir = path.join(runDir, 'bundle');
  const manifestPath = path.join(bundleDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`run ${runId} has no bundle/manifest.json — the bundle was never closed`);
  }
  const manifestText = readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  if (manifest.closed !== true) {
    throw new Error(`run ${runId} bundle/manifest.json exists but is not marked closed`);
  }

  const trialIndex = readJsonlPayloads<TrialIndexRow>(path.join(bundleDir, 'trials.jsonl'));
  const trials = trialIndex.map(row => {
    const resultPath = path.join(bundleDir, 'trials', row.trial_id, 'result.json');
    return JSON.parse(readFileSync(resultPath, 'utf8')) as TrialResult;
  });
  const regressionDeltas = readJsonlPayloads<RegressionDelta & Record<string, JsonValue>>(
    path.join(bundleDir, 'regression-deltas.jsonl')
  ) as unknown as RegressionDelta[];

  return {
    runDir,
    bundleDir,
    manifest,
    bundleDigest: sha256OfText(manifestText),
    trialIndex,
    trials,
    regressionDeltas,
  };
}
