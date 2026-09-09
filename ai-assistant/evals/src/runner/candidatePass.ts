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

import { candidateIdentityOf, type CandidateAdapter } from '../candidates/candidateAdapter.js';
import { createClusterAdapter, type ExecutionMode } from '../cluster/adapterFactory.js';
import type { ClusterAdapter } from '../cluster/clusterAdapter.js';
import type { ClusterProfileName, TrialResult } from '../contracts/evaluationContracts.js';
import { trialId as generateTrialId } from '../ids.js';
import type { LoadedScenario } from '../scenarios/loader.js';
import type { RunBundleWriter } from '../storage/bundleWriter.js';
import { runTrial } from './trialRunner.js';

/** Inputs for one candidate configuration attempted once per scenario. */
export interface CandidatePassOptions {
  runId: string;
  scenarios: LoadedScenario[];
  bundleWriter: RunBundleWriter;
  profile: ClusterProfileName;
  mode: ExecutionMode;
  createCandidate: (scenario: LoadedScenario) => CandidateAdapter;
  createCluster?: (profile: ClusterProfileName, mode: ExecutionMode) => ClusterAdapter;
  supersedesTrialId?: string;
}

/**
 * Runs one candidate pass while owning exactly one cluster adapter lifecycle.
 * Repeat scheduling and balanced comparison assignment can invoke this unit
 * without duplicating trial or cluster cleanup behavior.
 */
export async function runCandidatePass(options: CandidatePassOptions): Promise<TrialResult[]> {
  const clusterAdapter = (options.createCluster ?? createClusterAdapter)(
    options.profile,
    options.mode
  );
  const results: TrialResult[] = [];
  try {
    const clusterPreflight = await clusterAdapter.preflight();
    for (const scenario of options.scenarios) {
      const candidateAdapter = options.createCandidate(scenario);
      options.bundleWriter.registerCandidateIdentity(candidateIdentityOf(candidateAdapter));
      const result = await runTrial({
        runId: options.runId,
        trialId: generateTrialId(),
        scenario,
        clusterAdapter,
        clusterPreflight,
        candidateAdapter,
        bundleWriter: options.bundleWriter,
        executionMode: options.mode,
        supersedesTrialId: options.supersedesTrialId,
      });
      results.push(result);
    }
  } finally {
    await clusterAdapter.dispose?.();
  }
  return results;
}
