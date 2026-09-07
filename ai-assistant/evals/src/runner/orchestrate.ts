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
 * Orchestrates one `eval run`: resolves the cluster profile, selects
 * scenarios, runs one trial per scenario per requested candidate spec, closes
 * the bundle, and writes the report + offline exporter projections.
 *
 * Phase 1 MVP simplification (documented in `README.md`): `--baseline`/
 * `--candidate` select two *candidate configurations* to compare (for
 * example two scripted controls, or two Headlamp CLI provider profiles)
 * rather than checking out two git revisions of the product. Comparing two
 * git revisions is a natural extension once this runtime is proven and is
 * deliberately deferred to keep the Phase 1 vertical slice buildable in the
 * doc's ten-day budget.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createClusterAdapter, type ExecutionMode } from '../cluster/adapterFactory.js';
import type { ClusterProfileName, TrialResult } from '../contracts/types.js';
import { createHeadlampCliCandidate } from '../candidates/headlampCli.js';
import { createScriptedCandidate, type ScriptedCandidateMode } from '../candidates/scripted.js';
import type { CandidateAdapter } from '../candidates/types.js';
import { loadAllScenarios, type LoadedScenario } from '../scenarios/loader.js';
import { isEligibleToRun, ownershipRow } from '../operations/ownership.js';
import { computeRegressionDeltas } from '../regressions/regressionDelta.js';
import { runTrial } from './trialRunner.js';
import { RunBundleWriter } from '../storage/bundleWriter.js';
import { buildReport, writeReport } from '../reporting/reportBuilder.js';
import { writeExportProjections } from '../exporters/writeExports.js';
import { computeHealthSummary } from '../lifecycle/health.js';
import { trialId as generateTrialId } from '../ids.js';
import { sha256OfText } from '../canonicalJson.js';
import { loadClusterProfile } from '../cluster/profile.js';

export type CandidateSpec = ScriptedCandidateMode | 'headlamp-cli';

export function isCandidateSpec(value: string): value is CandidateSpec {
  return ['reference', 'wrong', 'malformed', 'unavailable', 'headlamp-cli'].includes(value);
}

export interface RunOptions {
  runId: string;
  runsRoot: string;
  profile: ClusterProfileName;
  mode: ExecutionMode;
  /** Explicit case IDs; when omitted, defaults per profile (see `selectScenarios`). */
  cases?: string[];
  candidate: CandidateSpec;
  baseline?: CandidateSpec;
  scenariosRoot?: string;
  supersedesTrialId?: string;
}

export interface RunOutcome {
  runId: string;
  runDir: string;
  bundleDigest: string;
  trials: TrialResult[];
  reportDir: string;
}

function buildCandidate(
  spec: CandidateSpec,
  scenario: LoadedScenario,
  mode: ExecutionMode,
  profile: ClusterProfileName
): CandidateAdapter {
  if (spec === 'headlamp-cli') {
    return createHeadlampCliCandidate({
      useMockProvider: mode !== 'real',
      allowedEnvVars:
        mode === 'real'
          ? loadClusterProfile(profile === 'aks' ? 'aks-azure' : profile).model.credential_env_vars
          : [],
    });
  }
  return createScriptedCandidate(spec, scenario.evaluatorPacket);
}

/**
 * Selects which scenarios a profile runs by default. `local-kwok` restricts
 * to the generated KWOK-compatible subset; requesting an incompatible case
 * explicitly is a hard error rather than a silent substitution.
 */
export function selectScenarios(
  profile: ClusterProfileName,
  requestedCases: string[] | undefined,
  scenariosRoot?: string
): LoadedScenario[] {
  const all = loadAllScenarios(scenariosRoot).filter(isEligibleToRun);

  if (requestedCases && requestedCases.length > 0) {
    return requestedCases.map(id => {
      const scenario = all.find(s => s.manifest.scenario_id === id);
      if (!scenario) throw new Error(`unknown or inactive scenario: ${id}`);
      if (profile === 'local-kwok' && !scenario.kwokCompatible) {
        throw new Error(
          `${id} is not in the generated KWOK-compatible subset (required_mechanisms: ` +
            `${scenario.manifest.required_mechanisms.join(
              ', '
            )}); eval:local:kwok never silently ` +
            'substitutes simulated state for a case that needs a real mechanism. Select --profile aks instead.'
        );
      }
      if (!scenario.manifest.supported_cluster_profiles.includes(profile)) {
        throw new Error(`${id} does not declare "${profile}" in supported_cluster_profiles`);
      }
      return scenario;
    });
  }

  if (profile === 'local-kwok') {
    return all.filter(
      scenario =>
        scenario.kwokCompatible &&
        scenario.manifest.supported_cluster_profiles.includes('local-kwok')
    );
  }
  return all.filter(s => s.manifest.supported_cluster_profiles.includes(profile));
}

async function runOneCandidatePass(
  spec: CandidateSpec,
  scenarios: LoadedScenario[],
  runId: string,
  bundleWriter: RunBundleWriter,
  profile: ClusterProfileName,
  mode: ExecutionMode,
  supersedesTrialId?: string
): Promise<TrialResult[]> {
  const clusterAdapter = createClusterAdapter(profile, mode);
  const clusterPreflight = await clusterAdapter.preflight();
  const results: TrialResult[] = [];
  try {
    for (const scenario of scenarios) {
      const candidateAdapter = buildCandidate(spec, scenario, mode, profile);
      const trialId = generateTrialId();
      const result = await runTrial({
        runId,
        trialId,
        scenario,
        clusterAdapter,
        clusterPreflight,
        candidateAdapter,
        bundleWriter,
        executionMode: mode,
        supersedesTrialId,
      });
      results.push(result);
    }
  } finally {
    await clusterAdapter.dispose?.();
  }
  return results;
}

/** Runs a full `eval run` invocation end to end and returns its outcome summary. */
export async function runEvaluation(options: RunOptions): Promise<RunOutcome> {
  const scenarios = selectScenarios(options.profile, options.cases, options.scenariosRoot);
  if (scenarios.length === 0) {
    throw new Error('no scenarios selected: check --profile/--case and scenario lifecycle_state');
  }

  const bundleWriter = new RunBundleWriter(options.runsRoot, options.runId);

  const candidateResults = await runOneCandidatePass(
    options.candidate,
    scenarios,
    options.runId,
    bundleWriter,
    options.profile,
    options.mode,
    options.supersedesTrialId
  );

  let allTrials = candidateResults;
  if (options.baseline) {
    const baselineResults = await runOneCandidatePass(
      options.baseline,
      scenarios,
      options.runId,
      bundleWriter,
      options.profile,
      options.mode
    );
    const deltas = computeRegressionDeltas(baselineResults, candidateResults);
    for (const delta of deltas) bundleWriter.recordRegressionDelta(delta);
    allTrials = [...baselineResults, ...candidateResults];
  }

  const candidateLabel = options.baseline
    ? `${options.baseline}->${options.candidate}`
    : options.candidate;
  bundleWriter.close(candidateLabel, options.profile);

  const manifestPath = path.join(bundleWriter.bundleDir, 'manifest.json');
  const bundleDigest = sha256OfText(readFileSync(manifestPath, 'utf8'));

  const ownership = scenarios.map(s => ownershipRow(s));
  const report = buildReport({
    runId: options.runId,
    bundleDigest,
    trials: allTrials,
    regressionDeltas: bundleWriter.readRegressionDeltas(),
    ownership,
  });
  const { reportDir } = writeReport(bundleWriter.runDir, report);
  writeExportProjections(bundleWriter.runDir, bundleDigest, allTrials);

  return {
    runId: options.runId,
    runDir: bundleWriter.runDir,
    bundleDigest,
    trials: allTrials,
    reportDir,
  };
}

export { computeHealthSummary };
