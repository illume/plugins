#!/usr/bin/env node
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
 * Phase 1 eval CLI: run, export, publication, and rerun commands.
 *
 * Kept intentionally thin: all real behavior lives in `runner/orchestrate.ts`,
 * `publication/publish.ts`, and `storage/*`, so this file is easy to keep in
 * sync with the doc-driven root `npm run eval*` scripts.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isCandidateSpec,
  runEvaluation,
  selectScenarios,
  type CandidateSpec,
} from './runner/orchestrate.js';
import { runId as generateRunId } from './ids.js';
import { readClosedBundle } from './storage/bundleReader.js';
import { buildReport, writeReport } from './reporting/reportBuilder.js';
import { ownershipRowFromManifest } from './operations/ownership.js';
import { publishRun, regenerateOverallViews, checkOverallViews } from './publication/publish.js';
import type { ClusterProfileName } from './contracts/evaluationContracts.js';
import { createRealCommandRunner } from './cluster/commandRunner.js';
import { defaultAksKubeconfigPath, deleteAks, setupAks } from './cluster/provisioning/aks.js';
import { parseProviderDetectionOutput } from './candidates/providerDetection.js';
import { writeExportProjections } from './exporters/writeExports.js';
import type { TokenPricingSnapshot } from './candidates/candidateAdapter.js';
import { validateTokenPricingSnapshot } from './candidates/headlampCli.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const evalsRoot = path.resolve(here, '..');
const aiCliEntry = path.resolve(evalsRoot, '..', 'packages', 'ai-cli', 'src', 'cli.ts');
const tsxBin = path.resolve(evalsRoot, 'node_modules', '.bin', 'tsx');

/**
 * Resolves the run storage root from the environment or repository default.
 *
 * @returns The absolute directory where run bundles are stored.
 */
function defaultRunsRoot(): string {
  return process.env.HEADLAMP_AI_EVAL_RUNS_DIR || path.resolve(evalsRoot, '..', '.eval-runs');
}

/**
 * Resolves the repository directory containing published evaluation results.
 *
 * @returns The absolute published-results directory.
 */
function defaultResultsRoot(): string {
  return path.resolve(evalsRoot, 'results');
}

/** Parsed long-form CLI flags, including repeated scenario selections. */
interface Flags {
  [key: string]: string | boolean | string[] | undefined;
}

export function pricingFromFlags(flags: Flags): TokenPricingSnapshot | undefined {
  const source = flags['pricing-source'];
  const unit = flags['pricing-unit'];
  const input = flags['uncached-input-rate-per-million'] ?? flags['input-usd-per-million'];
  const output = flags['output-rate-per-million'] ?? flags['output-usd-per-million'];
  const cacheRead =
    flags['cache-read-rate-per-million'] ?? flags['cache-read-input-usd-per-million'];
  const cacheWrite =
    flags['cache-write-rate-per-million'] ?? flags['cache-creation-input-usd-per-million'];
  const cacheWrite5m = flags['cache-write-5m-rate-per-million'];
  const cacheWrite1h = flags['cache-write-1h-rate-per-million'];
  const requestRate = flags['request-rate'];
  const supplied = [
    source,
    unit,
    input,
    output,
    cacheRead,
    cacheWrite,
    cacheWrite5m,
    cacheWrite1h,
    requestRate,
  ].some(value => value !== undefined);
  if (!supplied) return undefined;
  if (typeof source !== 'string') {
    throw new Error('--pricing-source is required when configured usage rates are supplied');
  }
  const usingLegacyUsdFlags =
    flags['input-usd-per-million'] !== undefined || flags['output-usd-per-million'] !== undefined;
  if (
    usingLegacyUsdFlags &&
    (typeof flags['input-usd-per-million'] !== 'string' ||
      typeof flags['output-usd-per-million'] !== 'string')
  ) {
    throw new Error(
      '--pricing-source, --input-usd-per-million, and --output-usd-per-million are required together'
    );
  }
  if (typeof unit !== 'string' && !usingLegacyUsdFlags) {
    throw new Error('--pricing-unit is required for provider-neutral usage rates');
  }
  const rates: NonNullable<TokenPricingSnapshot['rates']> = [];
  const addRate = (
    category: NonNullable<TokenPricingSnapshot['rates']>[number]['category'],
    amount: unknown,
    per: number
  ) => {
    if (typeof amount === 'string') rates.push({ category, amount, per });
  };
  addRate('uncached_input_tokens', input, 1_000_000);
  addRate('output_tokens', output, 1_000_000);
  addRate('cache_read_input_tokens', cacheRead, 1_000_000);
  addRate('cache_write_input_tokens', cacheWrite, 1_000_000);
  addRate('cache_write_5m_input_tokens', cacheWrite5m, 1_000_000);
  addRate('cache_write_1h_input_tokens', cacheWrite1h, 1_000_000);
  addRate('requests', requestRate, 1);
  const pricing: TokenPricingSnapshot = {
    unit: typeof unit === 'string' ? unit : 'USD',
    source,
    rates,
    ...(typeof flags['pricing-effective-at'] === 'string'
      ? { effective_at: flags['pricing-effective-at'] }
      : {}),
    ...(typeof flags['pricing-provider'] === 'string'
      ? { provider: flags['pricing-provider'] }
      : {}),
    ...(typeof flags['pricing-model'] === 'string' ? { model: flags['pricing-model'] } : {}),
    ...(typeof flags['pricing-service-tier'] === 'string'
      ? { service_tier: flags['pricing-service-tier'] }
      : {}),
    ...(typeof flags['pricing-billing-mode'] === 'string'
      ? { billing_mode: flags['pricing-billing-mode'] }
      : {}),
  };
  validateTokenPricingSnapshot(pricing);
  return pricing;
}

/**
 * Parses space-separated long-form flags. Repeated `--case` values accumulate
 * so callers can select several scenarios; every other repeated flag uses its
 * last value. A flag with no following value becomes `true`, and positional
 * tokens are ignored here because subcommand parsing happens earlier.
 *
 * @param argv - Command arguments following the subcommand.
 * @returns Flag names mapped to values, booleans, or repeated values.
 */
function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token?.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[name] = true;
      continue;
    }
    if (name === 'case') {
      const existing = flags[name];
      const list = Array.isArray(existing) ? existing : [];
      list.push(next);
      flags[name] = list;
    } else {
      flags[name] = next;
    }
    i += 1;
  }
  return flags;
}

/**
 * Validates a candidate-related flag as a supported candidate specification.
 *
 * @param value - Parsed flag value to validate.
 * @param flagName - Flag name used in validation errors.
 * @returns The validated candidate specification.
 */
function requireCandidateSpec(
  value: string | boolean | string[] | undefined,
  flagName: string
): CandidateSpec {
  if (typeof value !== 'string' || !isCandidateSpec(value)) {
    throw new Error(
      `--${flagName} must be one of reference|wrong|malformed|unavailable|headlamp-cli`
    );
  }
  return value;
}

/**
 * Builds Headlamp CLI provider arguments, resolving requested credentials when needed.
 *
 * @param flags - Parsed provider, model, and credential flags.
 * @returns Provider CLI arguments, or `undefined` when no provider was selected.
 */
async function providerCliArgs(flags: Flags): Promise<string[] | undefined> {
  if (flags.provider === undefined) return undefined;
  if (typeof flags.provider !== 'string') throw new Error('--provider <id> requires a value');

  if (flags.provider === 'azure-auto') {
    const runner = createRealCommandRunner();
    const account = runner('az', ['account', 'show', '--query', 'id', '-o', 'tsv']);
    const subscriptionId = account.stdout.trim();
    if (account.status !== 0 || !subscriptionId) {
      throw new Error(
        'could not read the current Azure subscription; install az and run `az login`'
      );
    }
    const detection = runner(tsxBin, [aiCliEntry, '--auto-detect', '--json']);
    if (detection.status !== 0) {
      throw new Error(detection.stderr.trim() || 'Azure model auto-detection failed');
    }
    const providers = parseProviderDetectionOutput(detection.stdout);
    const detected = providers.find(
      provider =>
        provider.providerId === 'azure' && provider.config.azSubscriptionId === subscriptionId
    );
    if (!detected) {
      throw new Error(`no Azure OpenAI or Foundry chat deployment detected in ${subscriptionId}`);
    }
    const config = detected.config;
    const keyResult = runner('az', [
      'cognitiveservices',
      'account',
      'keys',
      'list',
      '--resource-group',
      String(config.azResourceGroup ?? ''),
      '--name',
      String(config.azAccountName ?? ''),
      '--subscription',
      subscriptionId,
      '--query',
      'key1',
      '-o',
      'tsv',
    ]);
    const apiKey = keyResult.stdout.trim();
    if (keyResult.status !== 0 || !apiKey) {
      throw new Error(keyResult.stderr.trim() || 'could not read the Azure model key');
    }
    if (!apiKey || !config.endpoint || !config.deploymentName) {
      throw new Error('auto-detected Azure model configuration is incomplete');
    }
    return [
      '--provider',
      'azure',
      '--api-key',
      String(apiKey),
      '--endpoint',
      String(config.endpoint),
      '--deployment-name',
      String(config.deploymentName),
      '--model',
      String(config.model ?? config.deploymentName),
    ];
  }

  let apiKey = flags['api-key'];
  if (apiKey === undefined && flags.provider === 'copilot') {
    const result = createRealCommandRunner()('gh', ['auth', 'token']);
    if (result.status !== 0 || !result.stdout.trim()) {
      throw new Error('could not get a GitHub token; install gh and run `gh auth login`');
    }
    apiKey = result.stdout.trim();
  }
  if (typeof apiKey !== 'string') {
    throw new Error(`--api-key <key> is required for provider ${flags.provider}`);
  }

  const args = ['--provider', flags.provider, '--api-key', apiKey];
  if (typeof flags.model === 'string') args.push('--model', flags.model);
  return args;
}

/**
 * Executes the `run` command and prints its trial summary.
 *
 * @param flags - Parsed run configuration flags.
 * @returns A promise that resolves after the run and summary output complete.
 */
async function commandRun(flags: Flags): Promise<void> {
  const profile = (
    typeof flags.profile === 'string' ? flags.profile : 'local-kwok'
  ) as ClusterProfileName;
  const mode = flags.execute === 'real' ? 'real' : 'dry-run';
  const candidate = requireCandidateSpec(flags.candidate ?? 'reference', 'candidate');
  const baseline =
    flags.baseline !== undefined ? requireCandidateSpec(flags.baseline, 'baseline') : undefined;
  const cases = Array.isArray(flags.case) ? flags.case : undefined;
  const runsRoot = typeof flags['runs-dir'] === 'string' ? flags['runs-dir'] : defaultRunsRoot();
  const contractStoreRoot =
    typeof flags['contracts-dir'] === 'string' ? flags['contracts-dir'] : undefined;
  const runId = generateRunId();
  const candidateCliArgs = await providerCliArgs(flags);
  const pricing = pricingFromFlags(flags);

  console.log(
    `Running eval: run_id=${runId} profile=${profile} mode=${mode} candidate=${candidate}${
      baseline ? ` baseline=${baseline}` : ''
    }`
  );
  const outcome = await runEvaluation({
    runId,
    runsRoot,
    contractStoreRoot,
    profile,
    mode,
    cases,
    candidate,
    baseline,
    candidateCliArgs,
    pricing,
  });

  console.log(`\nrun_id: ${outcome.runId}`);
  console.log(`bundle: ${outcome.runDir}`);
  console.log(`report: ${outcome.reportDir}`);
  console.log(`trials: ${outcome.trials.length}`);
  for (const trial of outcome.trials) {
    console.log(
      `  - ${trial.scenario_id} [${trial.candidate_id}]: eligibility=${trial.run_eligibility} ` +
        `root_cause=${trial.dimensions.root_cause.outcome} safety=${trial.safety_outcome}`
    );
  }
}

/** Generates offline destination projections from a verified closed run bundle. */
function commandExport(flags: Flags): void {
  const runId = flags.run;
  if (typeof runId !== 'string') throw new Error('--run <run_id> is required');
  const runsRoot = typeof flags['runs-dir'] === 'string' ? flags['runs-dir'] : defaultRunsRoot();
  const contractStoreRoot =
    typeof flags['contracts-dir'] === 'string' ? flags['contracts-dir'] : undefined;
  const bundle = readClosedBundle(runsRoot, runId, contractStoreRoot);
  const projections = writeExportProjections(bundle.runDir, bundle.bundleDigest, bundle.trials);
  console.log(`Wrote LangSmith projection: ${projections.langsmithDir}`);
  console.log(`Wrote OTLP projection: ${projections.otlpDir}`);
}

/**
 * Rebuilds and publishes the report for a closed run bundle.
 *
 * @param flags - Parsed run and destination-directory flags.
 * @returns A promise that resolves after publication and overall-view regeneration.
 */
async function commandReportPublish(flags: Flags): Promise<void> {
  const runId = flags.run;
  if (typeof runId !== 'string') throw new Error('--run <run_id> is required');
  const runsRoot = typeof flags['runs-dir'] === 'string' ? flags['runs-dir'] : defaultRunsRoot();
  const contractStoreRoot =
    typeof flags['contracts-dir'] === 'string' ? flags['contracts-dir'] : undefined;
  const resultsRoot =
    typeof flags['results-dir'] === 'string' ? flags['results-dir'] : defaultResultsRoot();

  const bundle = readClosedBundle(runsRoot, runId, contractStoreRoot);
  const scenarioVersions = new Set(
    bundle.trials.map(trial => `${trial.scenario_id}@${trial.scenario_version}`)
  );
  const reportAsOf = new Date(String(bundle.manifest.generated_at));
  const ownership = bundle.scenarioManifests
    .filter(manifest =>
      scenarioVersions.has(`${manifest.scenario_id}@${manifest.scenario_version}`)
    )
    .map(manifest => ownershipRowFromManifest(manifest, reportAsOf));
  const report = buildReport({
    runId,
    bundleDigest: bundle.bundleDigest,
    trials: bundle.trials,
    regressionDeltas: bundle.regressionDeltas,
    ownership,
  });
  writeReport(bundle.runDir, report);

  const { publicationId, publicationDir } = publishRun({
    resultsRoot,
    report,
    bundleDigest: bundle.bundleDigest,
  });
  regenerateOverallViews(resultsRoot);
  console.log(`Published ${publicationId} -> ${publicationDir}`);
}

/**
 * Regenerates or verifies aggregate views over published run reports.
 *
 * @param flags - Parsed results-directory and check-mode flags.
 */
function commandReportOverall(flags: Flags): void {
  const resultsRoot =
    typeof flags['results-dir'] === 'string' ? flags['results-dir'] : defaultResultsRoot();
  if (flags.check) {
    const result = checkOverallViews(resultsRoot);
    if (!result.ok) {
      console.error('report:overall --check failed:');
      for (const issue of result.issues) console.error(`  - ${issue}`);
      process.exit(1);
    }
    console.log('report:overall --check passed: generated views match published runs.');
    return;
  }
  regenerateOverallViews(resultsRoot);
  console.log(
    `Regenerated ${path.join(resultsRoot, 'README.md')}, overall-report.json, index.json`
  );
}

/**
 * Replays one prior trial as a new run linked through supersession metadata.
 *
 * @param flags - Parsed source run, source trial, and run-directory flags.
 * @returns A promise that resolves after the replacement run completes.
 */
async function commandRerun(flags: Flags): Promise<void> {
  const sourceRunId = flags.run;
  const sourceTrialId = flags.trial;
  if (typeof sourceRunId !== 'string' || typeof sourceTrialId !== 'string') {
    throw new Error('--run <run_id> and --trial <trial_id> are required');
  }
  const runsRoot = typeof flags['runs-dir'] === 'string' ? flags['runs-dir'] : defaultRunsRoot();
  const contractStoreRoot =
    typeof flags['contracts-dir'] === 'string' ? flags['contracts-dir'] : undefined;
  const bundle = readClosedBundle(runsRoot, sourceRunId, contractStoreRoot);
  const source = bundle.trials.find(t => t.trial_id === sourceTrialId);
  if (!source) throw new Error(`trial ${sourceTrialId} not found in run ${sourceRunId}`);

  console.log(
    `Rerunning ${source.scenario_id} [${source.candidate_id}] from run ${sourceRunId}/${sourceTrialId} as a new run...`
  );
  const runId = generateRunId();
  const candidate =
    source.candidate_id.includes('-') &&
    isCandidateSpec(source.candidate_id.replace('scripted-', ''))
      ? (source.candidate_id.replace('scripted-', '') as CandidateSpec)
      : 'headlamp-cli';
  const outcome = await runEvaluation({
    runId,
    runsRoot,
    contractStoreRoot,
    profile: source.cluster_profile,
    mode: source.execution_mode ?? 'dry-run',
    cases: [source.scenario_id],
    candidate,
    supersedesTrialId: source.trial_id,
    candidateCliArgs: await providerCliArgs(flags),
    pricing: pricingFromFlags(flags),
  });
  console.log(
    `Rerun complete: run_id=${outcome.runId} (supersedes ${sourceRunId}/${sourceTrialId})`
  );
}

/**
 * Dispatches the requested evaluation CLI subcommand.
 *
 * @returns A promise that resolves after command handling completes.
 */
async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const flags = parseFlags(rest);

  switch (command) {
    case 'run':
      await commandRun(flags);
      break;
    case 'export':
      commandExport(flags);
      break;
    case 'report:publish':
      await commandReportPublish(flags);
      break;
    case 'report:overall':
      commandReportOverall(flags);
      break;
    case 'rerun':
      await commandRerun(flags);
      break;
    case 'aks:setup': {
      const location = typeof flags.location === 'string' ? flags.location : undefined;
      const nodeVmSize =
        typeof flags['node-vm-size'] === 'string' ? flags['node-vm-size'] : undefined;
      const name = setupAks({ location, nodeVmSize });
      console.log(`AKS cluster ready: ${name}`);
      console.log(`Kubeconfig: ${defaultAksKubeconfigPath}`);
      console.log(`Context: ${name}`);
      break;
    }
    case 'aks:delete': {
      const location = typeof flags.location === 'string' ? flags.location : undefined;
      const name = deleteAks({ location });
      console.log(`Deleting resource group ${name}.`);
      break;
    }
    case 'list-scenarios': {
      const profile = (
        typeof flags.profile === 'string' ? flags.profile : 'local-kwok'
      ) as ClusterProfileName;
      for (const s of selectScenarios(profile, undefined)) {
        console.log(`${s.manifest.scenario_id} (kwok_compatible=${s.kwokCompatible})`);
      }
      break;
    }
    default:
      console.error(
        'Usage: headlamp-ai-eval <run|export|aks:setup|aks:delete|report:publish|report:overall|rerun|list-scenarios> [--flags...]'
      );
      process.exit(command ? 1 : 0);
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
