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
 * the bundle, and writes the report projection.
 *
 * Phase 1 MVP simplification (documented in `README.md`): `--baseline`/
 * `--candidate` select two *candidate configurations* to compare (for
 * example two scripted controls, or two Headlamp CLI provider profiles)
 * rather than checking out two git revisions of the product. Comparing two
 * git revisions is a natural extension once this runtime is proven and is
 * deliberately deferred to keep the Phase 1 vertical slice buildable in the
 * doc's ten-day budget.
 */

import type { TokenPricingSnapshot } from '../candidates/candidateAdapter.js';
import type { CandidateAdapter } from '../candidates/candidateAdapter.js';
import { createHeadlampCliCandidate } from '../candidates/headlampCli.js';
import {
  createHeadlampPluginCandidate,
  type HeadlampPluginCandidateOptions,
} from '../candidates/headlampPlugin.js';
import { createHolmesGptCandidate, HOLMES_GPT_IMAGE } from '../candidates/holmesGptAdapter.js';
import {
  createK8sGptCandidate,
  K8S_GPT_IMAGE,
  type K8sGptCandidateOptions,
} from '../candidates/k8sGptAdapter.js';
import {
  createKubectlAiCandidate,
  type KubectlAiCandidateOptions,
} from '../candidates/kubectlAiAdapter.js';
import { createScriptedCandidate, type ScriptedCandidateMode } from '../candidates/scripted.js';
import type { ExecutionMode } from '../cluster/adapterFactory.js';
import { loadClusterProfile } from '../cluster/profile.js';
import type { ClusterProfileName, TrialResult } from '../contracts/evaluationContracts.js';
import { isEligibleToRun, ownershipRowFromManifest } from '../operations/ownership.js';
import { computeRegressionDeltas } from '../regressions/regressionDelta.js';
import { buildReport, writeReport } from '../reporting/reportBuilder.js';
import { matchesScenarioSelection, type ScenarioSelection } from '../scenarios/admission.js';
import { loadAllScenarios, type LoadedScenario } from '../scenarios/loader.js';
import { readClosedBundle } from '../storage/bundleReader.js';
import { RunBundleWriter } from '../storage/bundleWriter.js';
import {
  archiveContractReferences,
  defaultContractStoreRoot,
} from '../storage/contractReferences.js';
import { runCandidatePass } from './candidatePass.js';

/** Candidate adapter configuration accepted by the Phase 1 orchestrator. */
export type CandidateSpec =
  | ScriptedCandidateMode
  | 'headlamp-cli'
  | 'headlamp-cli-legacy'
  | 'headlamp-plugin'
  | 'holmesgpt'
  | 'k8sgpt'
  | 'kubectl-ai';

/**
 * Tests whether a CLI value names a supported candidate configuration.
 *
 * @param value - Candidate selector to validate.
 * @returns `true` when the value is a supported candidate specification.
 */
export function isCandidateSpec(value: string): value is CandidateSpec {
  return [
    'reference',
    'partial',
    'wrong',
    'abstaining',
    'overconfident',
    'unsupported-evidence',
    'unsafe-effective',
    'injected',
    'malformed',
    'unavailable',
    'headlamp-cli',
    'headlamp-cli-legacy',
    'headlamp-plugin',
    'holmesgpt',
    'k8sgpt',
    'kubectl-ai',
  ].includes(value);
}

/** Inputs that define one complete evaluation run and its persisted output. */
export interface RunOptions {
  /** Stable identifier assigned to the run. */
  runId: string;
  /** Root directory where run bundles are persisted. */
  runsRoot: string;
  /** Approved root for immutable public and protected contract archives. */
  contractStoreRoot?: string;
  /** Cluster profile used for every selected scenario. */
  profile: ClusterProfileName;
  /** Whether adapters execute real operations or dry-run behavior. */
  mode: ExecutionMode;
  /** Explicit case IDs; when omitted, defaults per profile (see `selectScenarios`). */
  cases?: string[];
  /** Prespecified portfolio, split, and stratum filters. */
  selection?: ScenarioSelection;
  /** Candidate configuration evaluated by the run. */
  candidate: CandidateSpec;
  /** Optional baseline configuration compared with the candidate. */
  baseline?: CandidateSpec;
  /** Optional scenario root overriding the repository default. */
  scenariosRoot?: string;
  /** Prior trial superseded by a single rerun. */
  supersedesTrialId?: string;
  /** Additional arguments passed to Headlamp CLI candidate invocations. */
  candidateCliArgs?: string[];
  /** Secret provider values passed only through the Headlamp CLI child environment. */
  candidateExtraEnv?: Record<string, string>;
  /** Browser-plugin runtime and ephemeral provider configuration. */
  headlampPluginOptions?: HeadlampPluginCandidateOptions;
  /** Explicit token-price snapshot used for reproducible cost estimates. */
  pricing?: TokenPricingSnapshot;
  /** Holmes model identifier, such as azure/gpt-4o. */
  holmesModel?: string;
  /** Azure OpenAI model used by K8sGPT's mandatory explanation path. */
  k8sGptModel?: string;
  /** Azure OpenAI deployment used by K8sGPT's mandatory explanation path. */
  k8sGptDeployment?: string;
  kubectlAiImage?: string;
  kubectlAiModel?: string;
  kubectlAiTimeoutMs?: number;
  /** Whether the evaluation operator explicitly approves policy-matched repair requests. */
  approveRepairs?: boolean;
}

/** Canonical bundle identity and projections returned after a run closes successfully. */
export interface RunOutcome {
  /** Stable identifier of the completed run. */
  runId: string;
  /** Directory containing the run bundle and projections. */
  runDir: string;
  /** Digest of the closed canonical bundle manifest. */
  bundleDigest: string;
  /** Candidate and optional baseline trial results. */
  trials: TrialResult[];
  /** Directory containing the generated report projection. */
  reportDir: string;
}

/**
 * Constructs the candidate adapter selected for a scenario pass.
 *
 * @param spec - Candidate configuration to instantiate.
 * @param scenario - Scenario providing protected truth to scripted controls.
 * @param mode - Execution mode controlling mock-provider use.
 * @param profile - Cluster profile controlling credential allowlisting.
 * @param candidateCliArgs - Additional Headlamp CLI arguments.
 * @returns The configured candidate adapter.
 */
function resolveK8sGptOptions(
  mode: ExecutionMode,
  profile: ClusterProfileName,
  model?: string,
  deployment?: string
): K8sGptCandidateOptions {
  if (mode !== 'real') throw new Error('k8sgpt requires --execute real');
  if (profile !== 'local-minikube') {
    throw new Error(
      'k8sgpt requires --profile local-minikube for isolated read-only native analysis'
    );
  }
  if (!model) throw new Error('k8sgpt requires --k8sgpt-model <model>');
  if (!deployment) throw new Error('k8sgpt requires --k8sgpt-deployment <deployment>');
  const apiKey = process.env.AZURE_API_KEY;
  const apiBase = process.env.AZURE_API_BASE;
  const apiVersion = process.env.AZURE_API_VERSION;
  if (!apiKey || !apiBase || !apiVersion) {
    throw new Error('k8sgpt requires AZURE_API_KEY, AZURE_API_BASE, and AZURE_API_VERSION');
  }
  return {
    image: K8S_GPT_IMAGE,
    kubeconfigPath: '',
    model,
    deployment,
    apiKey,
    apiBase,
    apiVersion,
  };
}

function buildCandidate(
  spec: CandidateSpec,
  scenario: LoadedScenario,
  mode: ExecutionMode,
  profile: ClusterProfileName,
  candidateCliArgs?: string[],
  candidateExtraEnv?: Record<string, string>,
  pricing?: TokenPricingSnapshot,
  holmesModel?: string,
  k8sGptModel?: string,
  k8sGptDeployment?: string,
  kubectlAiOptions?: KubectlAiCandidateOptions,
  headlampPluginOptions?: HeadlampPluginCandidateOptions
): CandidateAdapter {
  if (spec === 'headlamp-plugin') {
    if (mode !== 'real') throw new Error('headlamp-plugin requires --execute real');
    if (!headlampPluginOptions) throw new Error('headlamp-plugin configuration was not resolved');
    return createHeadlampPluginCandidate(headlampPluginOptions);
  }
  if (spec === 'headlamp-cli' || spec === 'headlamp-cli-legacy') {
    return createHeadlampCliCandidate({
      useMockProvider: mode !== 'real',
      sessionMode: spec === 'headlamp-cli-legacy' ? 'legacy' : 'agent-harness',
      allowedEnvVars:
        mode === 'real'
          ? loadClusterProfile(profile === 'aks' ? 'aks-azure' : profile).model.credential_env_vars
          : [],
      cliArgs: candidateCliArgs,
      extraEnv: candidateExtraEnv,
      pricing,
    });
  }
  if (spec === 'holmesgpt') {
    if (mode !== 'real') throw new Error('holmesgpt requires --execute real');
    if (!holmesModel) throw new Error('holmesgpt requires --holmes-model <provider/model>');
    return createHolmesGptCandidate({
      image: HOLMES_GPT_IMAGE,
      kubeconfigPath: '',
      model: holmesModel,
    });
  }
  if (spec === 'k8sgpt') {
    return createK8sGptCandidate(
      resolveK8sGptOptions(mode, profile, k8sGptModel, k8sGptDeployment)
    );
  }
  if (spec === 'kubectl-ai') {
    if (!kubectlAiOptions) throw new Error('kubectl-ai configuration was not resolved');
    return createKubectlAiCandidate(kubectlAiOptions);
  }
  return createScriptedCandidate(spec, scenario.evaluatorPacket);
}

/**
 * Selects active scenarios that the requested cluster profile can execute.
 * An omitted or empty `requestedCases` list selects every compatible active
 * scenario. An explicit list preserves the caller's order and fails if any
 * ID is unknown, inactive, unsupported by the profile, or not proven
 * KWOK-compatible; explicit requests are never silently substituted.
 *
 * @param profile - Cluster profile used to determine compatibility.
 * @param requestedCases - Explicit scenario IDs, or profile defaults when omitted.
 * @param scenariosRoot - Optional scenario directory override.
 * @returns Active, profile-compatible scenarios in requested or directory order.
 * @throws When an explicitly requested scenario is unavailable or incompatible.
 */
export function selectScenarios(
  profile: ClusterProfileName,
  requestedCases: string[] | undefined,
  scenariosRoot?: string,
  selection: ScenarioSelection = {}
): LoadedScenario[] {
  const all = loadAllScenarios(scenariosRoot).filter(isEligibleToRun);

  if (requestedCases && requestedCases.length > 0) {
    return requestedCases.map(id => {
      const scenario = all.find(s => s.manifest.scenario_id === id);
      if (!scenario) throw new Error(`unknown or inactive scenario: ${id}`);
      if (!matchesScenarioSelection(scenario.manifest, selection)) {
        throw new Error(`${id} does not match the requested portfolio selection`);
      }
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
        matchesScenarioSelection(scenario.manifest, selection) &&
        scenario.kwokCompatible &&
        scenario.manifest.supported_cluster_profiles.includes('local-kwok')
    );
  }
  return all.filter(
    scenario =>
      matchesScenarioSelection(scenario.manifest, selection) &&
      scenario.manifest.supported_cluster_profiles.includes(profile)
  );
}

function assertCandidateSupportsScenarios(
  candidate: CandidateSpec,
  scenarios: LoadedScenario[],
  role: 'candidate' | 'baseline'
): void {
  if (
    candidate !== 'holmesgpt' &&
    candidate !== 'k8sgpt' &&
    candidate !== 'kubectl-ai' &&
    candidate !== 'headlamp-plugin'
  )
    return;
  const unsupported = scenarios
    .filter(
      scenario =>
        scenario.candidatePacket.required_submission_schema !== 'diagnosis_submission@1.0.0'
    )
    .map(scenario => scenario.manifest.scenario_id);
  if (unsupported.length > 0) {
    throw new Error(
      `${role} ${candidate} does not support repair_submission@1.0.0 scenarios: ${unsupported.join(
        ', '
      )}`
    );
  }
}

/**
 * Runs an evaluation end to end and writes its bundle and report.
 *
 * @param options - Run identity, profile, scenarios, and candidate configurations.
 * @returns The asynchronous completed-run outcome and persisted artifact paths.
 */
export async function runEvaluation(options: RunOptions): Promise<RunOutcome> {
  if (options.baseline === options.candidate) {
    throw new Error('baseline and candidate must identify distinct configurations');
  }
  if (
    (options.candidate === 'headlamp-plugin' || options.baseline === 'headlamp-plugin') &&
    options.mode !== 'real'
  ) {
    throw new Error('headlamp-plugin requires --execute real');
  }
  const scenarios = selectScenarios(
    options.profile,
    options.cases,
    options.scenariosRoot,
    options.selection
  );
  if (scenarios.length === 0) {
    throw new Error('no scenarios selected: check --profile/--case and scenario lifecycle_state');
  }
  assertCandidateSupportsScenarios(options.candidate, scenarios, 'candidate');
  if (options.baseline) assertCandidateSupportsScenarios(options.baseline, scenarios, 'baseline');
  if (
    (options.candidate === 'headlamp-plugin' || options.baseline === 'headlamp-plugin') &&
    !options.headlampPluginOptions
  ) {
    throw new Error('headlamp-plugin configuration was not resolved');
  }

  if (options.candidate === 'k8sgpt' || options.baseline === 'k8sgpt') {
    resolveK8sGptOptions(
      options.mode,
      options.profile,
      options.k8sGptModel,
      options.k8sGptDeployment
    );
  }

  let kubectlAiOptions: KubectlAiCandidateOptions | undefined;
  if (options.candidate === 'kubectl-ai' || options.baseline === 'kubectl-ai') {
    if (options.mode !== 'real') throw new Error('kubectl-ai requires --execute real');
    if (!options.kubectlAiImage || !options.kubectlAiModel) {
      throw new Error(
        'kubectl-ai requires --kubectl-ai-image <digest> and --kubectl-ai-model <deployment>'
      );
    }
    if (!process.env.AZURE_OPENAI_API_KEY || !process.env.AZURE_OPENAI_ENDPOINT) {
      throw new Error('kubectl-ai requires AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT');
    }
    kubectlAiOptions = {
      image: options.kubectlAiImage,
      model: options.kubectlAiModel,
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      timeoutMs: options.kubectlAiTimeoutMs,
    };
    createKubectlAiCandidate(kubectlAiOptions);
  }

  const bundleWriter = new RunBundleWriter(options.runsRoot, options.runId);
  const contractStoreRoot = options.contractStoreRoot ?? defaultContractStoreRoot(options.runsRoot);
  bundleWriter.writeContractReferences(
    archiveContractReferences(contractStoreRoot, options.runId, scenarios)
  );

  const candidateResults = await runCandidatePass({
    scenarios,
    runId: options.runId,
    bundleWriter,
    profile: options.profile,
    mode: options.mode,
    supersedesTrialId: options.supersedesTrialId,
    approveRepairs: options.approveRepairs,
    createCandidate: scenario =>
      buildCandidate(
        options.candidate,
        scenario,
        options.mode,
        options.profile,
        options.candidateCliArgs,
        options.candidateExtraEnv,
        options.pricing,
        options.holmesModel,
        options.k8sGptModel,
        options.k8sGptDeployment,
        kubectlAiOptions,
        options.headlampPluginOptions
      ),
  });

  let allTrials = candidateResults;
  if (options.baseline) {
    const baselineResults = await runCandidatePass({
      scenarios,
      runId: options.runId,
      bundleWriter,
      profile: options.profile,
      mode: options.mode,
      approveRepairs: options.approveRepairs,
      createCandidate: scenario =>
        buildCandidate(
          options.baseline!,
          scenario,
          options.mode,
          options.profile,
          options.candidateCliArgs,
          options.candidateExtraEnv,
          options.pricing,
          options.holmesModel,
          options.k8sGptModel,
          options.k8sGptDeployment,
          kubectlAiOptions,
          options.headlampPluginOptions
        ),
    });
    const deltas = computeRegressionDeltas(baselineResults, candidateResults);
    for (const delta of deltas) bundleWriter.recordRegressionDelta(delta);
    allTrials = [...baselineResults, ...candidateResults];
  }

  const candidateLabel = options.baseline
    ? `${options.baseline}->${options.candidate}`
    : options.candidate;
  bundleWriter.close(candidateLabel, options.profile);
  const bundle = readClosedBundle(options.runsRoot, options.runId, contractStoreRoot);

  const reportAsOf = new Date(String(bundle.manifest.generated_at));
  const ownership = bundle.scenarioManifests.map(manifest =>
    ownershipRowFromManifest(manifest, reportAsOf)
  );
  const report = buildReport({
    runId: options.runId,
    bundleDigest: bundle.bundleDigest,
    trials: bundle.trials,
    regressionDeltas: bundle.regressionDeltas,
    ownership,
  });
  const { reportDir } = writeReport(bundleWriter.runDir, report);

  return {
    runId: options.runId,
    runDir: bundleWriter.runDir,
    bundleDigest: bundle.bundleDigest,
    trials: bundle.trials,
    reportDir,
  };
}
