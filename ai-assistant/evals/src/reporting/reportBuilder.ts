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
 * Builds `projections/reports/<report_id>/report.json` and its rendered
 * `report.md` from a closed bundle's trial results. Missing or unsupported
 * capabilities are declared in the coverage matrix and limitations rather
 * than represented as measured zeros.
 *
 * A report is a queryable, human-oriented view, not the evidence authority.
 * It may summarize, group, and duplicate canonical fields for convenience,
 * but it always records the source bundle digest and can be regenerated
 * without running the candidate again. New report layouts therefore do not
 * require rewriting historical bundles.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalStringify, sha256OfJson, type JsonValue } from '../canonicalJson.js';
import { computeHealthSummary, type HealthSummary } from '../lifecycle/health.js';
import type { OwnershipRow } from '../operations/ownership.js';
import {
  PHASE_ONE_SCENARIO_IDS,
  type RegressionDelta,
  type TrialResult,
} from '../contracts/evaluationContracts.js';
import { LANGSMITH_MAPPING_VERSION } from '../exporters/langsmith.js';
import { GENAI_SEMCONV_VERSION, OTLP_MAPPING_VERSION } from '../exporters/otlp.js';
import { assertValid } from '../contracts/validate.js';
import { loadSchema } from '../contracts/schemas.js';

const REPORT_SCHEMA_VERSION = '2.0.0';
const GENERATOR_VERSION = '2.0.0';

type CoverageDisposition =
  | 'implemented'
  | 'qualification_pending'
  | `deferred_to_phase_${number}`
  | 'not_applicable';

interface BestPracticeCoverageRow {
  best_practice: string;
  disposition: CoverageDisposition;
  evidence_artifact_links: string[];
  owner: string;
  next_review_date: string;
  expansion_phase?: number;
}

export interface ReportSummary {
  run_id: string;
  total_trials: number;
  assigned: number;
  started: number;
  run_eligibility: Record<string, number>;
  run_eligibility_denominator: number;
  task_outcomes_root_cause: Record<string, number>;
  task_outcomes_root_cause_denominator: number;
  safety_outcomes: Record<string, number>;
  safety_outcomes_denominator: number;
  lifecycle_validity: Record<string, number>;
  lifecycle_validity_denominator: number;
}

export interface ReportPopulations {
  by_scenario: Record<string, number>;
}

export interface ReportSlices {
  by_cluster_profile: Record<string, number>;
  by_candidate: Record<string, number>;
}

export interface ReportFailure {
  trial_id: string;
  scenario_id: string;
  first_failure_owner: string | null;
  root_cause_outcome: string;
  safety_outcome: string;
}

export interface ReportProvenance {
  ownership: OwnershipRow[];
  health_summary: HealthSummary;
  regression_deltas: RegressionDelta[];
}

export interface ExporterCoverage {
  status: string;
  mappings: string[];
  deferred: string[];
  losses_declared: boolean;
}

/** Canonical bundle data required to construct a report projection. */
export interface ReportInput {
  /** Stable identifier of the source run. */
  runId: string;
  /** Content digest of the closed source bundle. */
  bundleDigest: string;
  /** Canonical trial results included in the report. */
  trials: TrialResult[];
  /** Baseline-to-candidate deltas associated with the run. */
  regressionDeltas: RegressionDelta[];
  /** Scenario ownership and maintenance metadata. */
  ownership: OwnershipRow[];
}

/** Machine-readable report projection derived from a closed canonical bundle. */
export interface ReportJson {
  /** Stable identifier of the generated report. */
  report_id: string;
  /** Canonical schema version represented by the report. */
  schema_version: string;
  /** ISO timestamp when the report was generated. */
  generated_at: string;
  /** Version of the report generator. */
  generator_version: string;
  /** Digest of the closed bundle used to build the report. */
  as_of_bundle_digest: string;
  /** Canonical bundle digests contributing data to the report. */
  source_bundle_digests: string[];
  /** Evaluation phases and capabilities represented by the report. */
  phase_capabilities: string[];
  /** Top-level trial counts, outcomes, and denominators. */
  summary: ReportSummary;
  /** Counts describing the evaluated scenario populations. */
  populations: ReportPopulations;
  /** Counts grouped by declared reporting dimensions. */
  slices: ReportSlices;
  /** Report rows for trials requiring attention. */
  failures: ReportFailure[];
  /** Canonical trial results embedded for traceability. */
  trials: TrialResult[];
  /** Ownership, health, and regression provenance. */
  provenance: ReportProvenance;
  /**
   * Intended use of the evidence. Phase 1 always emits
   * `development_diagnostic`: diagnosis-only coverage is not a release,
   * deployment, or repair-authorization gate.
   */
  decision: string;
  /** Declared constraints on interpreting the report. */
  limitations: string[];
  /** Coverage status for evaluation best practices. */
  best_practice_gap_analysis: BestPracticeCoverageRow[];
  /** Destination mappings and declared exporter losses. */
  exporter_coverage: ExporterCoverage;
}

/**
 * Counts string values by their exact value.
 *
 * @param values - String values to aggregate.
 * @returns Counts keyed by each distinct value.
 */
function countBy<T extends string>(values: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  return counts;
}

/**
 * Builds the machine-readable report object without writing it to disk.
 *
 * @param input - Closed-bundle data to aggregate into the report.
 * @param generatedAt - Timestamp recorded as the report generation time.
 * @returns The complete machine-readable report projection.
 */
export function buildReport(input: ReportInput, generatedAt: Date = new Date()): ReportJson {
  const health = computeHealthSummary(input.trials);
  const eligibility = countBy(input.trials.map(t => t.run_eligibility));
  const taskOutcomes = countBy(
    input.trials
      .filter(t => t.run_eligibility === 'valid' && t.dimensions.root_cause.applicable)
      .map(t => t.dimensions.root_cause.outcome)
  );
  const safety = countBy(input.trials.map(t => t.safety_outcome));
  const lifecycle = countBy(input.trials.map(t => t.lifecycle_validity));
  const coverageOwner =
    [...new Set(input.ownership.map(row => row.owner))].join(', ') || 'Headlamp AI maintainers';
  const nextReviewDate =
    input.ownership.map(row => row.review_due).sort()[0] ??
    input.trials.map(trial => trial.recorded_at.slice(0, 10)).sort()[0] ??
    '1970-01-01';
  const trialArtifacts = (fileName: string) =>
    input.trials.map(trial => `bundle/trials/${trial.trial_id}/${fileName}`);
  const hasRealProductExecution = input.trials.some(
    trial =>
      trial.candidate_kind === 'headlamp-cli' &&
      trial.execution_mode === 'real' &&
      trial.run_eligibility === 'valid' &&
      trial.stage_status.candidate === 'ok'
  );
  const validAksScenarios = new Set(
    input.trials
      .filter(
        trial =>
          trial.cluster_profile === 'aks' &&
          trial.execution_mode === 'real' &&
          trial.run_eligibility === 'valid'
      )
      .map(trial => trial.scenario_id)
  );
  const coveredScenarioIds = new Set(
    input.trials.filter(trial => trial.run_eligibility === 'valid').map(trial => trial.scenario_id)
  );
  const hasFourCaseCoverage = PHASE_ONE_SCENARIO_IDS.every(id => coveredScenarioIds.has(id));
  const hasCurrentOwnership =
    PHASE_ONE_SCENARIO_IDS.every(id => input.ownership.some(row => row.scenario_id === id)) &&
    input.ownership.every(row => !row.review_overdue && !row.quarantined);
  const coverageRow = (
    bestPractice: string,
    disposition: CoverageDisposition,
    evidenceArtifactLinks: string[] = [],
    expansionPhase?: number
  ): BestPracticeCoverageRow => ({
    best_practice: bestPractice,
    disposition,
    evidence_artifact_links: evidenceArtifactLinks,
    owner: coverageOwner,
    next_review_date: nextReviewDate,
    ...(expansionPhase === undefined ? {} : { expansion_phase: expansionPhase }),
  });

  const failures = input.trials
    .filter(
      t =>
        t.run_eligibility !== 'valid' ||
        t.safety_outcome === 'fail' ||
        t.safety_outcome === 'unknown' ||
        t.dimensions.root_cause.outcome !== 'pass'
    )
    .map(t => ({
      trial_id: t.trial_id,
      scenario_id: t.scenario_id,
      first_failure_owner: t.first_failure_owner ?? null,
      root_cause_outcome: t.dimensions.root_cause.outcome,
      safety_outcome: t.safety_outcome,
    }));

  const report: ReportJson = {
    report_id: `report_${input.bundleDigest.replace(/^sha256:/, '').slice(0, 24)}`,
    schema_version: REPORT_SCHEMA_VERSION,
    generated_at: generatedAt.toISOString(),
    generator_version: GENERATOR_VERSION,
    as_of_bundle_digest: input.bundleDigest,
    source_bundle_digests: [input.bundleDigest],
    phase_capabilities: ['phase-1-diagnose-only'],
    summary: {
      run_id: input.runId,
      total_trials: input.trials.length,
      assigned: input.trials.length,
      started: input.trials.filter(t => t.stage_status.setup !== 'skipped').length,
      run_eligibility: eligibility,
      run_eligibility_denominator: input.trials.length,
      task_outcomes_root_cause: taskOutcomes,
      task_outcomes_root_cause_denominator: input.trials.filter(
        t => t.run_eligibility === 'valid' && t.dimensions.root_cause.applicable
      ).length,
      safety_outcomes: safety,
      safety_outcomes_denominator: input.trials.length,
      lifecycle_validity: lifecycle,
      lifecycle_validity_denominator: input.trials.length,
    },
    populations: {
      by_scenario: countBy(input.trials.map(t => t.scenario_id)),
    },
    slices: {
      by_cluster_profile: countBy(input.trials.map(t => t.cluster_profile)),
      by_candidate: countBy(input.trials.map(t => t.candidate_id)),
    },
    failures,
    trials: input.trials,
    provenance: {
      ownership: input.ownership,
      health_summary: health,
      regression_deltas: input.regressionDeltas,
    },
    decision: 'development_diagnostic',
    best_practice_gap_analysis: [
      coverageRow(
        'Decision, construct, acceptance criteria, reference',
        hasFourCaseCoverage ? 'implemented' : 'qualification_pending',
        trialArtifacts('grader-results.jsonl')
      ),
      coverageRow('Candidate/truth separation and immutable evidence', 'implemented', [
        'bundle/manifest.json',
        ...trialArtifacts('scenario-ref.json'),
      ]),
      coverageRow('Export and observability portability', 'qualification_pending'),
      coverageRow(
        'Eval-system health and failure ownership',
        'qualification_pending',
        trialArtifacts('result.json')
      ),
      coverageRow(
        'Case ownership, provenance, review, and quarantine',
        hasCurrentOwnership ? 'implemented' : 'qualification_pending',
        ['bundle/contract-refs.json']
      ),
      coverageRow(
        'Real product execution',
        hasRealProductExecution ? 'implemented' : 'qualification_pending',
        trialArtifacts('environment-manifest.json')
      ),
      coverageRow('Dataset lifecycle', 'qualification_pending'),
      coverageRow('Repeats and uncertainty', 'qualification_pending'),
      coverageRow('Continuous evaluation', 'implemented', ['bundle/manifest.json']),
      coverageRow(
        'Repair, approval, and least privilege',
        'qualification_pending',
        trialArtifacts('grader-results.jsonl')
      ),
      coverageRow('External tool comparison', 'deferred_to_phase_2', [], 2),
      coverageRow(
        'Interaction and robustness',
        hasFourCaseCoverage ? 'implemented' : 'qualification_pending',
        [...trialArtifacts('trajectory.jsonl'), ...trialArtifacts('submissions.jsonl')]
      ),
      coverageRow(
        'Distribution coverage',
        'implemented',
        trialArtifacts('environment-manifest.json')
      ),
      coverageRow(
        'SME audit and case maintenance',
        hasCurrentOwnership ? 'implemented' : 'qualification_pending',
        ['bundle/contract-refs.json']
      ),
      coverageRow('Grader portfolio', 'implemented', trialArtifacts('grader-results.jsonl')),
      coverageRow(
        'Adversarial safety',
        'qualification_pending',
        trialArtifacts('grader-results.jsonl')
      ),
      coverageRow('Production feedback and validity', 'deferred_to_phase_5', [], 5),
      coverageRow('Human reliance or usability', 'deferred_to_phase_5', [], 5),
      coverageRow(
        'AKS/cloud parity',
        validAksScenarios.size === PHASE_ONE_SCENARIO_IDS.length
          ? 'implemented'
          : 'qualification_pending',
        input.trials
          .filter(trial => trial.cluster_profile === 'aks')
          .map(trial => `bundle/trials/${trial.trial_id}/environment-manifest.json`)
      ),
    ],
    exporter_coverage: {
      status: 'partial',
      mappings: [
        `langsmith@${LANGSMITH_MAPPING_VERSION}`,
        `otlp-genai@${OTLP_MAPPING_VERSION}+semconv.${GENAI_SEMCONV_VERSION}`,
      ],
      deferred: ['datadog', 'splunk', 'azure-monitor'],
      losses_declared: true,
    },
    limitations: [
      'Phase 1 makes no relative claim about another tool (HolmesGPT/K8sGPT comparison begins in Phase 2).',
      'No free-form natural-language quality scoring; prose is retained but unscored.',
      'local-minikube requires real execution and a local Docker runtime; dry-run covers only the two KWOK-compatible cases.',
      'AKS requires the dedicated non-production cluster and private kubeconfig managed by eval:aks:setup.',
      'Missing or malformed Headlamp CLI telemetry keeps mutation safety unknown; metadata-only telemetry excludes prompts, responses, arguments, results, and credentials.',
      'Candidate/baseline selectors are configurations, not frozen Headlamp Git revisions; those runs do not qualify for the Phase 1 exit gate.',
      health.configured_usage_estimate_observed_count === 0
        ? 'Pricing enrichment was not requested; normalized model usage remains the durable evidence and can be priced later without rerunning the evaluation.'
        : 'Optional configured usage estimates retain their accounting units and line items; they are not provider invoices or billing records.',
    ],
  };
  return report;
}

/**
 * Renders a machine-readable report as the human-readable Markdown view.
 *
 * @param report - Report projection to render.
 * @returns Markdown containing summary, failures, provenance, and limitations.
 */
function renderMarkdown(report: ReportJson): string {
  const summary = report.summary;
  const lines: string[] = [];
  lines.push(`# Headlamp AI Assistant evaluation report`);
  lines.push('');
  lines.push('## Best-practice gap analysis');
  lines.push('');
  lines.push('| Best practice | Disposition | Owner | Next review |');
  lines.push('| --- | --- | --- | --- |');
  for (const row of report.best_practice_gap_analysis) {
    lines.push(
      `| ${row.best_practice} | ${row.disposition} | ${row.owner} | ${row.next_review_date} |`
    );
  }
  lines.push('');
  lines.push('### Coverage evidence');
  lines.push('');
  for (const row of report.best_practice_gap_analysis) {
    if (row.evidence_artifact_links.length === 0) {
      lines.push(`- ${row.best_practice}: _pending_`);
      continue;
    }
    lines.push(
      `- ${row.best_practice}: ${row.evidence_artifact_links
        .map(artifact => `[evidence](../../../${artifact})`)
        .join(', ')}`
    );
  }
  lines.push('');
  lines.push(`- report_id: \`${report.report_id}\``);
  lines.push(`- run_id: \`${summary.run_id}\``);
  lines.push(`- generated_at: ${report.generated_at}`);
  lines.push(`- decision: **${report.decision}**`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`Total trials: ${summary.total_trials}`);
  lines.push('');
  lines.push('| run_eligibility | count |');
  lines.push('| --- | ---: |');
  for (const [key, value] of Object.entries(summary.run_eligibility))
    lines.push(`| ${key} | ${value} |`);
  lines.push('');
  lines.push('| root_cause outcome | count |');
  lines.push('| --- | ---: |');
  for (const [key, value] of Object.entries(summary.task_outcomes_root_cause))
    lines.push(`| ${key} | ${value} |`);
  lines.push('');
  lines.push('| safety_outcome | count |');
  lines.push('| --- | ---: |');
  for (const [key, value] of Object.entries(summary.safety_outcomes))
    lines.push(`| ${key} | ${value} |`);
  lines.push('');
  lines.push('## Populations / slices');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({ populations: report.populations, slices: report.slices }, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Failures');
  lines.push('');
  if (report.failures.length === 0) {
    lines.push('_none_');
  } else {
    lines.push(
      '| trial_id | scenario_id | first_failure_owner | root_cause outcome | safety_outcome |'
    );
    lines.push('| --- | --- | --- | --- | --- |');
    for (const f of report.failures) {
      lines.push(
        `| ${f.trial_id} | ${f.scenario_id} | ${f.first_failure_owner ?? '—'} | ${
          f.root_cause_outcome
        } | ${f.safety_outcome} |`
      );
    }
  }
  lines.push('');
  lines.push('## Trial / trace links');
  lines.push('');
  for (const t of report.trials) {
    lines.push(`- \`${t.trial_id}\` (${t.scenario_id}): bundle/trials/${t.trial_id}/result.json`);
  }
  lines.push('');
  lines.push('## Provenance');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(report.provenance, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Decision');
  lines.push('');
  lines.push(report.decision);
  lines.push('');
  lines.push('## Limitations');
  lines.push('');
  for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Writes report JSON, Markdown, and projection metadata under the run directory.
 *
 * @param runDir - Run directory that owns the report projection.
 * @param report - Complete machine-readable report to persist.
 * @returns The report directory and stable report-content digest.
 */
export function writeReport(
  runDir: string,
  report: ReportJson
): { reportDir: string; reportDigest: string } {
  assertValid(loadSchema('report'), report, 'report');
  const reportDir = path.join(runDir, 'projections', 'reports', report.report_id);
  mkdirSync(reportDir, { recursive: true });
  const reportJsonText = canonicalStringify(report as unknown as JsonValue);
  writeFileSync(path.join(reportDir, 'report.json'), reportJsonText, 'utf8');
  writeFileSync(path.join(reportDir, 'report.md'), renderMarkdown(report), 'utf8');
  const { generated_at: _generatedAt, ...stableReport } = report;
  void _generatedAt;
  const reportDigest = sha256OfJson(stableReport as unknown as JsonValue);
  writeFileSync(
    path.join(reportDir, 'projection-manifest.json'),
    canonicalStringify({
      report_id: report.report_id,
      generated_at: report.generated_at,
      generator_version: GENERATOR_VERSION,
      source_bundle_digest: report.as_of_bundle_digest,
      report_content_digest: reportDigest,
      volatile_fields: ['generated_at'],
    }),
    'utf8'
  );
  return { reportDir, reportDigest };
}
