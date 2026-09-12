import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256OfJson, type JsonValue } from '../canonicalJson.js';
import type { BehavioralStratum } from '../contracts/evaluationContracts.js';
import { loadSchema } from '../contracts/schemas.js';
import { assertValid } from '../contracts/validate.js';
import { loadAllScenarios, type LoadedScenario } from '../scenarios/loader.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultComparisonRegistrationPath = path.resolve(
  here,
  '..',
  '..',
  'registrations',
  'phase2-comparison-v1.json'
);

export const comparisonSystems = [
  'headlamp_plugin',
  'headlamp_cli',
  'holmesgpt',
  'k8sgpt',
] as const;

export type ComparisonSystem = (typeof comparisonSystems)[number];
export type AssignmentDisposition = 'pending' | 'eligible' | 'ineligible' | 'unsupported';

export interface ComparisonRosterEntry {
  scenario_id: string;
  behavioral_stratum: BehavioralStratum;
  family_id: string;
  lineage_id: string;
  assignments: Record<ComparisonSystem, AssignmentDisposition>;
  disposition_basis: string;
}

export interface ComparisonRegistration {
  schema_version: '1.1.0';
  registration_id: string;
  authored_at: string;
  design_status: 'draft' | 'locked';
  confirmatory_execution: 'blocked' | 'allowed';
  roster_status: 'frozen';
  adapter_qualification: Record<ComparisonSystem, 'pending' | 'passed' | 'failed'>;
  estimand: {
    population: string;
    outcome: string;
    effect_measure: 'matched_risk_difference';
    direction: 'higher_is_better';
  };
  repeat_targets_by_stratum: Record<BehavioralStratum, number | null>;
  practical_margin: number | null;
  dependence_unit: 'lineage_id';
  resampling_unit: 'lineage_id';
  missing_pair_rule: {
    valid_pair: 'include_task_quality_and_reliability';
    invalid_pair: 'exclude_task_quality_retain_reliability';
    censored_pair: 'exclude_task_quality_retain_reliability';
    missing_pair: 'exclude_task_quality_retain_reliability';
    unsupported_assignment: 'terminal_exclusion';
    ineligible_assignment: 'terminal_exclusion';
    pending_assignment: 'block_execution';
  };
  multiplicity_policy: {
    method: 'fixed_sequence';
    familywise_alpha: number;
    primary_contrasts: ['headlamp_cli_vs_holmesgpt', 'headlamp_cli_vs_k8sgpt'];
    secondary_analyses: 'descriptive_only';
  };
  dataset_splits: string[];
  private_holdouts: {
    target_count: 25;
    identities_in_public_registration: false;
    storage: 'outside_checkout';
    access_policy: string;
    access_control_verification: 'pending' | 'passed' | 'failed';
  };
  roster: ComparisonRosterEntry[];
  limitations: string[];
}

export interface LoadedComparisonRegistration {
  registration: ComparisonRegistration;
  digest: string;
  family_count: number;
  lineage_count: number;
  jointly_eligible_count: number;
}

export interface ComparisonRegistrationStatus {
  registration_id: string;
  digest: string;
  design_status: ComparisonRegistration['design_status'];
  confirmatory_execution: ComparisonRegistration['confirmatory_execution'];
  scenario_count: number;
  family_count: number;
  lineage_count: number;
  jointly_eligible_count: number;
  assignment_counts: Record<ComparisonSystem, Record<AssignmentDisposition, number>>;
  blockers: string[];
}

const strata: BehavioralStratum[] = [
  'fault_diagnosis',
  'healthy_control',
  'insufficient_evidence',
  'approved_repair',
  'security_prompt_injection',
  'multi_turn_tool_failure',
];

function assertRosterEntry(entry: ComparisonRosterEntry, scenario: LoadedScenario): void {
  const portfolio = scenario.manifest.portfolio;
  if (portfolio.phase !== 2 || portfolio.visibility !== 'public') {
    throw new Error(`${entry.scenario_id}: comparison roster requires a public Phase 2 scenario`);
  }
  if (
    entry.behavioral_stratum !== portfolio.behavioral_stratum ||
    entry.family_id !== portfolio.family_id ||
    entry.lineage_id !== portfolio.lineage_id
  ) {
    throw new Error(
      `${entry.scenario_id}: frozen roster metadata does not match scenario manifest`
    );
  }
}

/** Validates registration semantics that JSON Schema cannot express. */
export function assertComparisonRegistration(
  registration: ComparisonRegistration,
  scenarios: LoadedScenario[] = loadAllScenarios()
): LoadedComparisonRegistration {
  assertValid(loadSchema('comparison-registration'), registration, 'comparison registration');
  const byId = new Map(scenarios.map(scenario => [scenario.manifest.scenario_id, scenario]));
  const seen = new Set<string>();

  for (const entry of registration.roster) {
    if (seen.has(entry.scenario_id)) {
      throw new Error(`duplicate comparison scenario: ${entry.scenario_id}`);
    }
    seen.add(entry.scenario_id);
    const scenario = byId.get(entry.scenario_id);
    if (!scenario) throw new Error(`unknown comparison scenario: ${entry.scenario_id}`);
    assertRosterEntry(entry, scenario);
    for (const system of comparisonSystems) {
      if (
        entry.assignments[system] === 'eligible' &&
        (scenario.manifest.portfolio.qualification_status !== 'qualified' ||
          registration.adapter_qualification[system] !== 'passed')
      ) {
        throw new Error(
          `${entry.scenario_id}/${system}: eligible requires qualified scenario and adapter`
        );
      }
    }
  }

  for (const stratum of strata) {
    if (!registration.roster.some(entry => entry.behavioral_stratum === stratum)) {
      throw new Error(`comparison roster does not represent ${stratum}`);
    }
  }

  const jointlyEligibleCount = registration.roster.filter(entry =>
    comparisonSystems.every(system => entry.assignments[system] === 'eligible')
  ).length;
  if (registration.design_status === 'locked') {
    if (registration.confirmatory_execution !== 'allowed') {
      throw new Error('locked comparison design must allow confirmatory execution');
    }
    if (
      registration.practical_margin === null ||
      Object.values(registration.repeat_targets_by_stratum).some(target => target === null) ||
      Object.values(registration.adapter_qualification).some(status => status !== 'passed') ||
      registration.private_holdouts.access_control_verification !== 'passed' ||
      registration.roster.some(entry =>
        Object.values(entry.assignments).some(status => status === 'pending')
      ) ||
      jointlyEligibleCount < 20
    ) {
      throw new Error('locked comparison design has incomplete Phase 2B/2C exit controls');
    }
  } else if (registration.confirmatory_execution !== 'blocked') {
    throw new Error('draft comparison design must block confirmatory execution');
  }

  return {
    registration,
    digest: sha256OfJson(registration as unknown as JsonValue),
    family_count: new Set(registration.roster.map(entry => entry.family_id)).size,
    lineage_count: new Set(registration.roster.map(entry => entry.lineage_id)).size,
    jointly_eligible_count: jointlyEligibleCount,
  };
}

/** Loads the checked-in Phase 2 comparison registration and returns its canonical identity. */
export function loadComparisonRegistration(
  registrationPath: string = defaultComparisonRegistrationPath,
  scenarios?: LoadedScenario[]
): LoadedComparisonRegistration {
  const registration = JSON.parse(readFileSync(registrationPath, 'utf8')) as ComparisonRegistration;
  return assertComparisonRegistration(registration, scenarios);
}

/** Builds a stable, non-claiming status projection for CI and human review. */
export function comparisonRegistrationStatus(
  loaded: LoadedComparisonRegistration
): ComparisonRegistrationStatus {
  const assignmentCounts = Object.fromEntries(
    comparisonSystems.map(system => [
      system,
      Object.fromEntries(
        (['pending', 'eligible', 'ineligible', 'unsupported'] as const).map(status => [
          status,
          loaded.registration.roster.filter(entry => entry.assignments[system] === status).length,
        ])
      ),
    ])
  ) as ComparisonRegistrationStatus['assignment_counts'];
  const blockers: string[] = [];
  if (
    Object.values(loaded.registration.adapter_qualification).some(status => status !== 'passed')
  ) {
    blockers.push('adapter qualification incomplete');
  }
  if (loaded.registration.practical_margin === null) blockers.push('practical margin unset');
  if (
    Object.values(loaded.registration.repeat_targets_by_stratum).some(target => target === null)
  ) {
    blockers.push('repeat targets unset');
  }
  if (loaded.registration.private_holdouts.access_control_verification !== 'passed') {
    blockers.push('private holdout access controls unverified');
  }
  if (loaded.jointly_eligible_count < 20) blockers.push('fewer than 20 jointly eligible cells');

  return {
    registration_id: loaded.registration.registration_id,
    digest: loaded.digest,
    design_status: loaded.registration.design_status,
    confirmatory_execution: loaded.registration.confirmatory_execution,
    scenario_count: loaded.registration.roster.length,
    family_count: loaded.family_count,
    lineage_count: loaded.lineage_count,
    jointly_eligible_count: loaded.jointly_eligible_count,
    assignment_counts: assignmentCounts,
    blockers,
  };
}
