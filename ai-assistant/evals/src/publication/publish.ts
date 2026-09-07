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
 * Publishes a redacted, immutable per-run summary under the committed
 * `evals/results/` publication root, then regenerates the three top-level
 * generated files (`README.md`, `overall-report.json`, `index.json`) purely
 * from the immutable set of per-run `projection-manifest.json` plus `report.json`
 * files. Deleting and rebuilding those three files must reproduce the same
 * content digest (`--check` verifies this).
 *
 * The `public-github` disclosure profile strips everything not safe for
 * permanent Git history: no secret canaries, no raw trajectory/tool-call
 * content, no candidate-visible prompts. Only aggregate counts, scenario
 * IDs, and outcome summaries survive.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalStringify, sha256OfJson, type JsonValue } from '../canonicalJson.js';
import { publicationId as generatePublicationId } from '../ids.js';
import type { ReportJson } from '../reporting/reportBuilder.js';

export const DISCLOSURE_PROFILE = 'public-github';
const REPORT_SCHEMA_VERSION = '1.0.0';

export interface PublicationManifest extends Record<string, JsonValue> {
  publication_id: string;
  published_at: string;
  status: 'active' | 'superseded';
  supersedes_publication_id: string | null;
  source_bundle_digest: string;
  report_schema_version: string;
  generator_version: string;
  disclosure_profile: string;
  report_content_digest: string;
}

export interface RedactedReport extends Record<string, JsonValue> {
  report_id: string;
  generated_at: string;
  run_id: string;
  decision: string;
  summary: JsonValue;
  populations: JsonValue;
  slices: JsonValue;
  failure_count: number;
  limitations: string[];
}

/** Applies the `public-github` disclosure profile, dropping every answer-bearing or protected field. */
export function redactReport(report: ReportJson): RedactedReport {
  const summary = report.summary as unknown as {
    run_id: string;
    total_trials: number;
    run_eligibility: Record<string, number>;
    task_outcomes_root_cause: Record<string, number>;
    safety_outcomes: Record<string, number>;
    lifecycle_validity: Record<string, number>;
  };
  const populations = report.populations as unknown as {
    by_scenario: Record<string, number>;
  };
  const slices = report.slices as unknown as {
    by_cluster_profile: Record<string, number>;
    by_candidate: Record<string, number>;
  };
  return {
    report_id: report.report_id,
    generated_at: report.generated_at,
    run_id: summary.run_id,
    decision: report.decision,
    summary: {
      run_id: summary.run_id,
      total_trials: summary.total_trials,
      run_eligibility: summary.run_eligibility,
      task_outcomes_root_cause: summary.task_outcomes_root_cause,
      safety_outcomes: summary.safety_outcomes,
      lifecycle_validity: summary.lifecycle_validity,
    } as JsonValue,
    populations: { by_scenario: populations.by_scenario } as JsonValue,
    slices: {
      by_cluster_profile: slices.by_cluster_profile,
      by_candidate: slices.by_candidate,
    } as JsonValue,
    failure_count: report.failures.length,
    limitations: report.limitations,
  };
}

export interface PublishOptions {
  resultsRoot: string;
  report: ReportJson;
  bundleDigest: string;
  now?: Date;
  /** Test-only: forces a specific publication_id instead of a fresh generated one. */
  publicationIdOverride?: string;
}

/** Publishes one redacted immutable run summary; returns its publication directory. */
export function publishRun(options: PublishOptions): {
  publicationId: string;
  publicationDir: string;
} {
  if (options.report.as_of_bundle_digest !== options.bundleDigest) {
    throw new Error('report source bundle digest does not match the bundle being published');
  }
  const now = options.now ?? new Date();
  const publicationId = options.publicationIdOverride ?? generatePublicationId();
  const dateStamp = now.toISOString().slice(0, 10);
  const dirName = `${dateStamp}-${publicationId}`;
  const publicationDir = path.join(options.resultsRoot, 'runs', dirName);
  if (existsSync(publicationDir)) {
    throw new Error(`publication directory already exists: ${publicationDir}`);
  }
  mkdirSync(publicationDir, { recursive: true });

  const redacted = redactReport(options.report);
  const redactedText = canonicalStringify(redacted);
  assertSafePublication(redactedText);
  writeFileSync(path.join(publicationDir, 'report.json'), redactedText, 'utf8');

  const manifest: PublicationManifest = {
    publication_id: publicationId,
    published_at: now.toISOString(),
    status: 'active',
    supersedes_publication_id: null,
    source_bundle_digest: options.bundleDigest,
    report_schema_version: REPORT_SCHEMA_VERSION,
    generator_version: options.report.generator_version,
    disclosure_profile: DISCLOSURE_PROFILE,
    report_content_digest: sha256OfJson(redacted),
  };
  writeFileSync(
    path.join(publicationDir, 'projection-manifest.json'),
    canonicalStringify(manifest),
    'utf8'
  );
  writeFileSync(
    path.join(publicationDir, 'README.md'),
    renderRunReadme(redacted, manifest),
    'utf8'
  );

  return { publicationId, publicationDir };
}

function renderRunReadme(report: RedactedReport, manifest: PublicationManifest): string {
  const summary = report.summary as unknown as {
    total_trials: number;
    run_eligibility: Record<string, number>;
    task_outcomes_root_cause: Record<string, number>;
    safety_outcomes: Record<string, number>;
  };
  const slices = report.slices as unknown as {
    by_candidate: Record<string, number>;
  };
  const candidateIds = Object.keys(slices.by_candidate);
  const lines = [
    `# Run ${manifest.publication_id}`,
    '',
    `- published_at: ${manifest.published_at}`,
    `- source_bundle_digest: \`${manifest.source_bundle_digest}\``,
    `- report_content_digest: \`${manifest.report_content_digest}\``,
    `- decision: **${report.decision}**`,
    '',
    `Total trials: ${summary.total_trials}`,
    '',
    '| run_eligibility | count |',
    '| --- | ---: |',
    ...Object.entries(summary.run_eligibility).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '| root_cause outcome | count |',
    '| --- | ---: |',
    ...Object.entries(summary.task_outcomes_root_cause).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '| candidate | count |',
    '| --- | ---: |',
    ...Object.entries(slices.by_candidate).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    ...(candidateIds.length > 0 && candidateIds.every(id => id.startsWith('scripted-'))
      ? [
          '> **Control-only diagnostic:** scripted candidates validate the harness and are not AI Assistant capability evidence.',
          '',
        ]
      : []),
    `Failures: ${report.failure_count}`,
    '',
    '## Limitations',
    '',
    ...report.limitations.map(l => `- ${l}`),
    '',
  ];
  return lines.join('\n');
}

function renderRunReadmeV1(report: RedactedReport, manifest: PublicationManifest): string {
  const summary = report.summary as unknown as {
    total_trials: number;
    run_eligibility: Record<string, number>;
    task_outcomes_root_cause: Record<string, number>;
  };
  return [
    `# Run ${manifest.publication_id}`,
    '',
    `- published_at: ${manifest.published_at}`,
    `- source_bundle_digest: \`${manifest.source_bundle_digest}\``,
    `- report_content_digest: \`${manifest.report_content_digest}\``,
    `- decision: **${report.decision}**`,
    '',
    `Total trials: ${summary.total_trials}`,
    '',
    '| run_eligibility | count |',
    '| --- | ---: |',
    ...Object.entries(summary.run_eligibility).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '| root_cause outcome | count |',
    '| --- | ---: |',
    ...Object.entries(summary.task_outcomes_root_cause).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    `Failures: ${report.failure_count}`,
    '',
    '## Limitations',
    '',
    ...report.limitations.map(l => `- ${l}`),
    '',
  ].join('\n');
}

interface RunEntry {
  dirName: string;
  manifest: PublicationManifest;
  report: RedactedReport;
}

function assertPublicationManifest(
  value: unknown,
  directoryName: string
): asserts value is PublicationManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${directoryName}: publication manifest must be an object`);
  }
  const manifest = value as Record<string, unknown>;
  const requiredStrings = [
    'publication_id',
    'published_at',
    'source_bundle_digest',
    'report_schema_version',
    'generator_version',
    'disclosure_profile',
    'report_content_digest',
  ];
  for (const field of requiredStrings) {
    if (typeof manifest[field] !== 'string' || manifest[field] === '') {
      throw new Error(`${directoryName}: publication manifest has invalid ${field}`);
    }
  }
  if (manifest.status !== 'active' && manifest.status !== 'superseded') {
    throw new Error(`${directoryName}: publication manifest has invalid status`);
  }
  if (
    manifest.supersedes_publication_id !== null &&
    typeof manifest.supersedes_publication_id !== 'string'
  ) {
    throw new Error(`${directoryName}: publication manifest has invalid supersedes_publication_id`);
  }
  if (Number.isNaN(Date.parse(manifest.published_at as string))) {
    throw new Error(`${directoryName}: publication manifest has invalid published_at`);
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.report_content_digest as string)) {
    throw new Error(`${directoryName}: publication manifest has invalid report_content_digest`);
  }
  if (!directoryName.endsWith(`-${manifest.publication_id as string}`)) {
    throw new Error(`${directoryName}: publication ID does not match directory name`);
  }
}

function loadPublishedRuns(resultsRoot: string): RunEntry[] {
  const runsDir = path.join(resultsRoot, 'runs');
  if (!existsSync(runsDir)) return [];
  const entries: RunEntry[] = [];
  for (const dirName of readdirSync(runsDir).sort()) {
    const manifestPath = path.join(runsDir, dirName, 'projection-manifest.json');
    const reportPath = path.join(runsDir, dirName, 'report.json');
    const readmePath = path.join(runsDir, dirName, 'README.md');
    if (!existsSync(manifestPath) || !existsSync(reportPath) || !existsSync(readmePath)) {
      throw new Error(`${dirName}: incomplete publication directory`);
    }
    const manifestValue: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assertPublicationManifest(manifestValue, dirName);
    const manifest = manifestValue;
    const reportText = readFileSync(reportPath, 'utf8');
    if (manifest.disclosure_profile !== DISCLOSURE_PROFILE) {
      throw new Error(`${dirName}: unsupported disclosure profile`);
    }
    if (sha256OfJson(JSON.parse(reportText) as JsonValue) !== manifest.report_content_digest) {
      throw new Error(`${dirName}: published report digest mismatch`);
    }
    assertSafePublication(reportText);
    const report = JSON.parse(reportText) as RedactedReport;
    const expectedReadme =
      manifest.generator_version === '1.0.0'
        ? renderRunReadmeV1(report, manifest)
        : renderRunReadme(report, manifest);
    if (readFileSync(readmePath, 'utf8') !== expectedReadme) {
      throw new Error(`${dirName}: published README is stale or corrupt`);
    }
    entries.push({
      dirName,
      manifest,
      report,
    });
  }

  entries.sort((a, b) => (a.manifest.published_at < b.manifest.published_at ? -1 : 1));
  return entries;
}

function assertSafePublication(text: string): void {
  const forbiddenPatterns = [
    /EVAL-CANARY-/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bBearer\s+[A-Za-z0-9._~-]{16,}/i,
    /"(?:client_secret|access_token|refresh_token|kubeconfig)"\s*:/i,
  ];
  const match = forbiddenPatterns.find(pattern => pattern.test(text));
  if (match) throw new Error(`publication rejected by disclosure scan: ${match.source}`);
}

export interface OverallReport extends Record<string, JsonValue> {
  schema_version: string;
  generated_at: string;
  publication_count: number;
  latest_publication_id: string | null;
  publications: JsonValue[];
}

function buildOverallReport(runs: RunEntry[], now: Date): OverallReport {
  return {
    schema_version: REPORT_SCHEMA_VERSION,
    generated_at: now.toISOString(),
    publication_count: runs.length,
    latest_publication_id:
      runs.length > 0 ? runs[runs.length - 1]?.manifest.publication_id ?? null : null,
    publications: runs.map(
      r =>
        ({
          publication_id: r.manifest.publication_id,
          published_at: r.manifest.published_at,
          status: r.manifest.status,
          decision: r.report.decision,
          run_directory: `runs/${r.dirName}`,
        } as JsonValue)
    ),
  };
}

function buildIndex(runs: RunEntry[]): JsonValue {
  return {
    schema_version: REPORT_SCHEMA_VERSION,
    entries: runs.map(
      r =>
        ({
          publication_id: r.manifest.publication_id,
          dir: `runs/${r.dirName}`,
          published_at: r.manifest.published_at,
          status: r.manifest.status,
        } as JsonValue)
    ),
  } as unknown as JsonValue;
}

function renderOverallReadme(runs: RunEntry[], overall: OverallReport): string {
  if (runs.length === 0) {
    return [
      '# Headlamp AI Assistant — evaluation results',
      '',
      'No runs have been published yet.',
      '',
      '## Coverage gaps',
      '',
      '- Phase 1 has not yet published a baseline run. Run `npm run eval:local:kwok` from `ai-assistant/`, then',
      '  `npm --prefix evals run report:publish -- --run <run_id>` to publish the first result.',
      '',
    ].join('\n');
  }
  const latest = runs[runs.length - 1];
  if (!latest) throw new Error('renderOverallReadme called with empty runs after length check');
  const summary = latest.report.summary as unknown as {
    total_trials: number;
    run_eligibility: Record<string, number>;
    task_outcomes_root_cause: Record<string, number>;
    safety_outcomes: Record<string, number>;
  };
  const slices = latest.report.slices as unknown as {
    by_candidate: Record<string, number>;
  };
  const candidateIds = Object.keys(slices.by_candidate);
  return [
    '# Headlamp AI Assistant — evaluation results',
    '',
    `Scope: Phase 1 local developer loop (see \`evals/docs/implementation-phases.md\`). Report schema ${REPORT_SCHEMA_VERSION}.`,
    `Latest publication: [\`${latest.manifest.publication_id}\`](./runs/${latest.dirName}/README.md) (${latest.manifest.published_at}). Machine-readable: [overall-report.json](./overall-report.json).`,
    '',
    '## Current status',
    '',
    '**Qualification: not Phase 1 qualifying.** Publications remain development diagnostics until all Phase 1 exit evidence is present.',
    '',
    `Total trials in the latest run: ${summary.total_trials}`,
    '',
    '| run_eligibility | count |',
    '| --- | ---: |',
    ...Object.entries(summary.run_eligibility).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '| root_cause outcome | count |',
    '| --- | ---: |',
    ...Object.entries(summary.task_outcomes_root_cause).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '| safety_outcome | count |',
    '| --- | ---: |',
    ...Object.entries(summary.safety_outcomes).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '| candidate | count |',
    '| --- | ---: |',
    ...Object.entries(slices.by_candidate).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    ...(candidateIds.length > 0 && candidateIds.every(id => id.startsWith('scripted-'))
      ? [
          '> **Control-only diagnostic:** scripted candidates validate the harness and are not AI Assistant capability evidence.',
          '',
        ]
      : []),
    '## Trend',
    '',
    runs.length === 1
      ? '_Single publication so far — descriptive, not a trend._'
      : `${runs.length} publications recorded; see \`overall-report.json\` for the full series.`,
    '',
    '## Coverage gaps and limitations',
    '',
    ...latest.report.limitations.map(l => `- ${l}`),
    '',
    '## Publications',
    '',
    ...runs
      .slice()
      .reverse()
      .map(
        r =>
          `- [${r.manifest.publication_id}](./runs/${r.dirName}/README.md) — ${r.manifest.published_at} (${r.manifest.status})`
      ),
    '',
  ].join('\n');
}

/** Regenerates `README.md`, `overall-report.json`, and `index.json` from immutable publications only. */
export function regenerateOverallViews(resultsRoot: string, now: Date = new Date()): void {
  const runs = loadPublishedRuns(resultsRoot);
  const overall = buildOverallReport(runs, now);
  const index = buildIndex(runs);
  writeFileSync(path.join(resultsRoot, 'overall-report.json'), canonicalStringify(overall), 'utf8');
  writeFileSync(path.join(resultsRoot, 'index.json'), canonicalStringify(index), 'utf8');
  writeFileSync(path.join(resultsRoot, 'README.md'), renderOverallReadme(runs, overall), 'utf8');
}

/**
 * `--check` mode: regenerates the three top-level files into memory and
 * compares digests against what is committed, without touching disk.
 */
export function checkOverallViews(
  resultsRoot: string,
  now: Date = new Date()
): { ok: boolean; issues: string[] } {
  const runs = loadPublishedRuns(resultsRoot);
  const overall = buildOverallReport(runs, now);
  const index = buildIndex(runs);
  const expectedReadme = renderOverallReadme(runs, overall);
  const issues: string[] = [];

  const overallPath = path.join(resultsRoot, 'overall-report.json');
  const indexPath = path.join(resultsRoot, 'index.json');
  const readmePath = path.join(resultsRoot, 'README.md');

  if (!existsSync(overallPath)) {
    issues.push('overall-report.json is missing');
  } else {
    const onDisk = JSON.parse(readFileSync(overallPath, 'utf8')) as OverallReport;
    // generated_at is declared volatile; compare everything else.
    const { generated_at: _onDiskGeneratedAt, ...onDiskRest } = onDisk;
    const { generated_at: _expectedGeneratedAt, ...expectedRest } = overall;
    void _onDiskGeneratedAt;
    void _expectedGeneratedAt;
    if (
      canonicalStringify(onDiskRest as unknown as JsonValue) !==
      canonicalStringify(expectedRest as unknown as JsonValue)
    ) {
      issues.push('overall-report.json is stale relative to published runs');
    }
  }
  if (!existsSync(indexPath)) {
    issues.push('index.json is missing');
  } else if (
    canonicalStringify(JSON.parse(readFileSync(indexPath, 'utf8')) as JsonValue) !==
    canonicalStringify(index)
  ) {
    issues.push('index.json is stale relative to published runs');
  }
  if (!existsSync(readmePath)) {
    issues.push('README.md is missing');
  } else if (readFileSync(readmePath, 'utf8') !== expectedReadme) {
    issues.push('README.md is stale relative to published runs');
  }

  return { ok: issues.length === 0, issues };
}
