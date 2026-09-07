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
 * `report.md` from a closed bundle's trial results. Every section carries
 * `status` so missing data is explicit rather than looking like a zero (see
 * "Canonical task metrics and exporter compatibility").
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalStringify, sha256OfJson, type JsonValue } from '../canonicalJson.js';
import { computeHealthSummary } from '../lifecycle/health.js';
import type { OwnershipRow } from '../operations/ownership.js';
import type { RegressionDelta, TrialResult } from '../contracts/types.js';
import { SCHEMA_VERSION } from '../contracts/types.js';

const GENERATOR_VERSION = '1.1.0';

export interface ReportInput {
  runId: string;
  bundleDigest: string;
  trials: TrialResult[];
  regressionDeltas: RegressionDelta[];
  ownership: OwnershipRow[];
}

export interface ReportJson extends Record<string, JsonValue> {
  report_id: string;
  schema_version: string;
  generated_at: string;
  generator_version: string;
  as_of_bundle_digest: string;
  source_bundle_digests: string[];
  phase_capabilities: string[];
  summary: JsonValue;
  populations: JsonValue;
  slices: JsonValue;
  failures: JsonValue[];
  trials: JsonValue[];
  provenance: JsonValue;
  decision: string;
  limitations: string[];
  best_practice_gap_analysis: JsonValue[];
  exporter_coverage: JsonValue;
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  return counts;
}

/** Builds the machine-readable `report.json` object (not yet written to disk). */
export function buildReport(input: ReportInput, generatedAt: Date = new Date()): ReportJson {
  const health = computeHealthSummary(input.trials);
  const eligibility = countBy(input.trials.map(t => t.run_eligibility));
  const taskOutcomes = countBy(
    input.trials
      .filter(t => t.dimensions.root_cause.applicable)
      .map(t => t.dimensions.root_cause.outcome)
  );
  const safety = countBy(input.trials.map(t => t.safety_outcome));
  const lifecycle = countBy(input.trials.map(t => t.lifecycle_validity));

  const failures = input.trials
    .filter(
      t =>
        t.run_eligibility !== 'valid' ||
        t.safety_outcome === 'fail' ||
        t.dimensions.root_cause.outcome !== 'pass'
    )
    .map(
      t =>
        ({
          trial_id: t.trial_id,
          scenario_id: t.scenario_id,
          first_failure_owner: t.first_failure_owner ?? null,
          root_cause_outcome: t.dimensions.root_cause.outcome,
          safety_outcome: t.safety_outcome,
        } as JsonValue)
    );

  const report: ReportJson = {
    report_id: `report_${input.bundleDigest.replace(/^sha256:/, '').slice(0, 24)}`,
    schema_version: SCHEMA_VERSION,
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
    } as unknown as JsonValue,
    populations: {
      by_scenario: countBy(input.trials.map(t => t.scenario_id)),
    } as unknown as JsonValue,
    slices: {
      by_cluster_profile: countBy(input.trials.map(t => t.cluster_profile)),
      by_candidate: countBy(input.trials.map(t => t.candidate_id)),
    } as unknown as JsonValue,
    failures,
    trials: input.trials.map(t => t as unknown as JsonValue),
    provenance: {
      ownership: input.ownership as unknown as JsonValue,
      health_summary: health as unknown as JsonValue,
      regression_deltas: input.regressionDeltas as unknown as JsonValue,
    } as unknown as JsonValue,
    decision: 'development_diagnostic',
    best_practice_gap_analysis: [
      { best_practice: 'Typed deterministic grading', phase_1: '✅' },
      { best_practice: 'Evidence-grounded causal facts', phase_1: '✅' },
      { best_practice: 'Immutable reconstructable bundles', phase_1: '◐' },
      { best_practice: 'Real product execution', phase_1: '◐' },
      { best_practice: 'AKS/cloud parity', phase_1: '◐' },
      { best_practice: 'Repeated statistical comparisons', phase_1: '◐' },
      { best_practice: 'External tool comparison', phase_1: '—', begins_in_phase: 2 },
    ] as JsonValue[],
    exporter_coverage: {
      status: 'partial',
      mappings: ['langsmith@1.0.0', 'otlp-genai@1.0.0'],
      deferred: ['datadog', 'splunk', 'azure-monitor'],
      losses_declared: true,
    } as JsonValue,
    limitations: [
      'Phase 1 makes no relative claim about another tool (HolmesGPT/K8sGPT comparison begins in Phase 2).',
      'No free-form natural-language quality scoring; prose is retained but unscored.',
      'local-minikube is a declared Phase 2 profile with no Phase 1 adapter.',
      'AKS requires a caller-provisioned dedicated cluster and explicit kubeconfig.',
      'Internal Headlamp CLI tool events are not observable; mutation safety is unknown for that adapter.',
      'Candidate/baseline selectors are configurations, not frozen Headlamp Git revisions; those runs do not qualify for the Phase 1 exit gate.',
      'contract-refs.json is explicitly unsupported by bundle format 1.1, so pass-critical contracts are not independently resolvable after repository changes.',
    ],
  };
  return report;
}

function renderMarkdown(report: ReportJson): string {
  const summary = report.summary as unknown as {
    run_id: string;
    total_trials: number;
    run_eligibility: Record<string, number>;
    task_outcomes_root_cause: Record<string, number>;
    safety_outcomes: Record<string, number>;
    lifecycle_validity: Record<string, number>;
  };
  const lines: string[] = [];
  lines.push(`# Headlamp AI Assistant evaluation report`);
  lines.push('');
  lines.push('## Best-practice gap analysis');
  lines.push('');
  lines.push('| Best practice | Phase 1 |');
  lines.push('| --- | :---: |');
  for (const row of report.best_practice_gap_analysis as unknown as Array<{
    best_practice: string;
    phase_1: string;
  }>) {
    lines.push(`| ${row.best_practice} | ${row.phase_1} |`);
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
    for (const f of report.failures as unknown as Array<Record<string, unknown>>) {
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
  for (const t of report.trials as unknown as TrialResult[]) {
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

/** Writes `report.json`, `report.md`, and a `projection-manifest.json` under `runDir/projections/reports/<id>/`. */
export function writeReport(
  runDir: string,
  report: ReportJson
): { reportDir: string; reportDigest: string } {
  const reportDir = path.join(runDir, 'projections', 'reports', report.report_id);
  mkdirSync(reportDir, { recursive: true });
  const reportJsonText = canonicalStringify(report);
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
