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
 * Phase 1 eval CLI: `run`, `report:publish`, `report:overall`, and `rerun`.
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
import { ownershipRow } from './operations/ownership.js';
import { loadAllScenarios } from './scenarios/loader.js';
import { publishRun, regenerateOverallViews, checkOverallViews } from './publication/publish.js';
import type { ClusterProfileName } from './contracts/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const evalsRoot = path.resolve(here, '..');

function defaultRunsRoot(): string {
  return process.env.HEADLAMP_AI_EVAL_RUNS_DIR || path.resolve(evalsRoot, '..', '.eval-runs');
}

function defaultResultsRoot(): string {
  return path.resolve(evalsRoot, 'results');
}

interface Flags {
  [key: string]: string | boolean | string[] | undefined;
}

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
  const runId = generateRunId();

  console.log(
    `Running eval: run_id=${runId} profile=${profile} mode=${mode} candidate=${candidate}${
      baseline ? ` baseline=${baseline}` : ''
    }`
  );
  const outcome = await runEvaluation({
    runId,
    runsRoot,
    profile,
    mode,
    cases,
    candidate,
    baseline,
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

async function commandReportPublish(flags: Flags): Promise<void> {
  const runId = flags.run;
  if (typeof runId !== 'string') throw new Error('--run <run_id> is required');
  const runsRoot = typeof flags['runs-dir'] === 'string' ? flags['runs-dir'] : defaultRunsRoot();
  const resultsRoot =
    typeof flags['results-dir'] === 'string' ? flags['results-dir'] : defaultResultsRoot();

  const bundle = readClosedBundle(runsRoot, runId);
  const scenarioIds = [...new Set(bundle.trials.map(t => t.scenario_id))];
  const scenarios = loadAllScenarios().filter(s => scenarioIds.includes(s.manifest.scenario_id));
  const ownership = scenarios.map(s => ownershipRow(s));
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

async function commandRerun(flags: Flags): Promise<void> {
  const sourceRunId = flags.run;
  const sourceTrialId = flags.trial;
  if (typeof sourceRunId !== 'string' || typeof sourceTrialId !== 'string') {
    throw new Error('--run <run_id> and --trial <trial_id> are required');
  }
  const runsRoot = defaultRunsRoot();
  const bundle = readClosedBundle(runsRoot, sourceRunId);
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
    profile: source.cluster_profile,
    mode: 'dry-run',
    cases: [source.scenario_id],
    candidate,
  });
  console.log(
    `Rerun complete: run_id=${outcome.runId} (supersedes ${sourceRunId}/${sourceTrialId})`
  );
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  const flags = parseFlags(rest);

  switch (command) {
    case 'run':
      await commandRun(flags);
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
        'Usage: headlamp-ai-eval <run|report:publish|report:overall|rerun|list-scenarios> [--flags...]'
      );
      process.exit(command ? 1 : 0);
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
