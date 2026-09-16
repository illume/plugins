import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type JsonValue, sha256OfJson } from '../canonicalJson.js';
import type { BehavioralStratum } from '../contracts/evaluationContracts.js';
import { loadSchema } from '../contracts/schemas.js';
import { assertValid } from '../contracts/validate.js';
import { loadAllScenarios, type LoadedScenario } from '../scenarios/loader.js';
import { finiteRosterBudget, type FiniteRosterRepeatDesign } from './repeatTargeting.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const defaultComparisonRegistrationPath = path.resolve(
  here,
  '..',
  '..',
  'registrations',
  'phase2-comparison-v2.json'
);
export const legacyComparisonRegistrationPath = path.join(
  path.dirname(defaultComparisonRegistrationPath),
  'phase2-comparison-v1.json'
);

export const comparisonSystems = [
  'headlamp_plugin',
  'headlamp_cli',
  'holmesgpt',
  'k8sgpt',
  'kubectl-ai',
] as const;

export type ComparisonSystem = (typeof comparisonSystems)[number];
export type AssignmentDisposition = 'pending' | 'eligible' | 'ineligible' | 'unsupported';

export interface ComparisonRosterEntry {
  scenario_id: string;
  behavioral_stratum: BehavioralStratum;
  family_id: string;
  lineage_id: string;
  assignments: Partial<Record<ComparisonSystem, AssignmentDisposition>>;
  disposition_basis: string;
}

export interface ComparisonRegistration {
  schema_version: '1.1.0' | '1.2.0';
  supersedes?: { registration_id: string; digest: string; reason: string };
  comparison_scope?: {
    mode: 'supplied_evidence_diagnosis';
    required_strata: BehavioralStratum[];
    minimum_jointly_eligible_cells: 20;
    minimum_jointly_eligible_families: 10;
    repair_evidence: 'separate_headlamp_gate';
  };
  registration_id: string;
  authored_at: string;
  design_status: 'draft' | 'locked';
  confirmatory_execution: 'blocked' | 'allowed';
  roster_status: 'frozen';
  adapter_qualification: Partial<Record<ComparisonSystem, 'pending' | 'passed' | 'failed'>>;
  estimand: {
    population: string;
    outcome: string;
    effect_measure: 'matched_risk_difference';
    direction: 'higher_is_better';
  };
  repeat_targets_by_stratum: Record<BehavioralStratum, number | null>;
  repeat_design?: FiniteRosterRepeatDesign;
  practical_margin: number | null;
  dependence_unit: 'lineage_id' | 'full_roster_round';
  resampling_unit: 'lineage_id' | 'full_roster_round';
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
    primary_contrasts: [
      'headlamp_cli_vs_holmesgpt',
      'headlamp_cli_vs_k8sgpt' | 'headlamp_cli_vs_kubectl-ai'
    ];
    secondary_analyses: 'descriptive_only';
  };
  dataset_splits: string[];
  private_holdouts: {
    required_in_phase?: 3;
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
  jointly_eligible_family_count: number;
  jointly_eligible_strata: BehavioralStratum[];
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
  jointly_eligible_family_count: number;
  jointly_eligible_strata: BehavioralStratum[];
  comparison_systems: ComparisonSystem[];
  comparison_scope: 'legacy_all_strata' | 'supplied_evidence_diagnosis';
  in_scope_scenario_count: number;
  private_holdouts_required_in_phase: 2 | 3;
  repeat_budget: ReturnType<typeof finiteRosterBudget> | null;
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

export function systemsForRegistration(registration: ComparisonRegistration): ComparisonSystem[] {
  return registration.schema_version === '1.2.0'
    ? ['headlamp_plugin', 'headlamp_cli', 'holmesgpt', 'kubectl-ai']
    : ['headlamp_plugin', 'headlamp_cli', 'holmesgpt', 'k8sgpt'];
}

function requiredStrata(registration: ComparisonRegistration): BehavioralStratum[] {
  return registration.comparison_scope?.required_strata ?? strata;
}

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
  const systems = systemsForRegistration(registration);
  if (registration.supersedes?.registration_id === registration.registration_id) {
    throw new Error('a comparison registration cannot supersede itself');
  }

  for (const entry of registration.roster) {
    if (seen.has(entry.scenario_id)) {
      throw new Error(`duplicate comparison scenario: ${entry.scenario_id}`);
    }
    seen.add(entry.scenario_id);
    const scenario = byId.get(entry.scenario_id);
    if (!scenario) throw new Error(`unknown comparison scenario: ${entry.scenario_id}`);
    assertRosterEntry(entry, scenario);
    if (
      registration.schema_version === '1.2.0' &&
      entry.behavioral_stratum === 'approved_repair' &&
      (entry.assignments.holmesgpt !== 'unsupported' ||
        entry.assignments['kubectl-ai'] !== 'unsupported')
    ) {
      throw new Error(
        `${entry.scenario_id}: reference repairs belong outside the diagnosis comparison`
      );
    }
    for (const system of systems) {
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

  const jointlyEligible = registration.roster.filter(
    entry =>
      requiredStrata(registration).includes(entry.behavioral_stratum) &&
      systems.every(system => entry.assignments[system] === 'eligible')
  );
  const loaded: LoadedComparisonRegistration = {
    registration,
    digest: sha256OfJson(registration as unknown as JsonValue),
    family_count: new Set(registration.roster.map(entry => entry.family_id)).size,
    lineage_count: new Set(registration.roster.map(entry => entry.lineage_id)).size,
    jointly_eligible_count: jointlyEligible.length,
    jointly_eligible_family_count: new Set(jointlyEligible.map(entry => entry.family_id)).size,
    jointly_eligible_strata: strata.filter(stratum =>
      jointlyEligible.some(entry => entry.behavioral_stratum === stratum)
    ),
  };
  if (registration.design_status === 'locked') {
    if (registration.confirmatory_execution !== 'allowed') {
      throw new Error('locked comparison design must allow confirmatory execution');
    }
    if (registrationBlockers(loaded).length > 0) {
      throw new Error('locked comparison design has incomplete Phase 2B/2C exit controls');
    }
  } else if (registration.confirmatory_execution !== 'blocked') {
    throw new Error('draft comparison design must block confirmatory execution');
  }

  return loaded;
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
    systemsForRegistration(loaded.registration).map(system => [
      system,
      Object.fromEntries(
        (['pending', 'eligible', 'ineligible', 'unsupported'] as const).map(status => [
          status,
          loaded.registration.roster.filter(entry => entry.assignments[system] === status).length,
        ])
      ),
    ])
  ) as ComparisonRegistrationStatus['assignment_counts'];
  return {
    registration_id: loaded.registration.registration_id,
    digest: loaded.digest,
    design_status: loaded.registration.design_status,
    confirmatory_execution: loaded.registration.confirmatory_execution,
    scenario_count: loaded.registration.roster.length,
    family_count: loaded.family_count,
    lineage_count: loaded.lineage_count,
    jointly_eligible_count: loaded.jointly_eligible_count,
    jointly_eligible_family_count: loaded.jointly_eligible_family_count,
    jointly_eligible_strata: loaded.jointly_eligible_strata,
    comparison_systems: systemsForRegistration(loaded.registration),
    comparison_scope: loaded.registration.comparison_scope?.mode ?? 'legacy_all_strata',
    private_holdouts_required_in_phase: loaded.registration.private_holdouts.required_in_phase ?? 2,
    repeat_budget: loaded.registration.repeat_design
      ? finiteRosterBudget(
          loaded.registration.roster.filter(entry =>
            requiredStrata(loaded.registration).includes(entry.behavioral_stratum)
          ).length
        )
      : null,
    in_scope_scenario_count: loaded.registration.roster.filter(entry =>
      requiredStrata(loaded.registration).includes(entry.behavioral_stratum)
    ).length,
    assignment_counts: assignmentCounts,
    blockers: registrationBlockers(loaded),
  };
}

function registrationBlockers(loaded: LoadedComparisonRegistration): string[] {
  const blockers: string[] = [];
  if (
    Object.values(loaded.registration.adapter_qualification).some(status => status !== 'passed')
  ) {
    blockers.push('adapter qualification incomplete');
  }
  if (loaded.registration.practical_margin === null) blockers.push('practical margin unset');
  else if (
    !(loaded.registration.practical_margin > 0 && loaded.registration.practical_margin < 1)
  ) {
    blockers.push('practical margin must be greater than zero and less than one');
  }
  if (
    requiredStrata(loaded.registration).some(
      stratum => loaded.registration.repeat_targets_by_stratum[stratum] === null
    )
  ) {
    blockers.push('repeat targets unset');
  }
  if (
    loaded.registration.private_holdouts.required_in_phase !== 3 &&
    loaded.registration.private_holdouts.access_control_verification !== 'passed'
  ) {
    blockers.push('private holdout access controls unverified');
  }
  if (loaded.jointly_eligible_count < 20) blockers.push('fewer than 20 jointly eligible cells');
  if (
    loaded.registration.roster.some(entry => Object.values(entry.assignments).includes('pending'))
  ) {
    blockers.push('assignment dispositions pending');
  }
  if (loaded.registration.schema_version === '1.2.0') {
    const design = loaded.registration.repeat_design;
    if (!design) blockers.push('repeat design unspecified');
    else {
      if (
        requiredStrata(loaded.registration).some(
          stratum => loaded.registration.repeat_targets_by_stratum[stratum] !== design.rounds
        )
      ) {
        blockers.push('repeat targets do not match the fixed round budget');
      }
      const inScope = loaded.registration.roster.filter(entry =>
        requiredStrata(loaded.registration).includes(entry.behavioral_stratum)
      );
      if (
        inScope.some(entry =>
          systemsForRegistration(loaded.registration).some(
            system => entry.assignments[system] !== 'eligible'
          )
        )
      ) {
        blockers.push('finite-roster plan requires every diagnosis case to be jointly eligible');
      }
    }
    if (loaded.jointly_eligible_family_count < 10)
      blockers.push('fewer than 10 jointly eligible families');
    for (const stratum of requiredStrata(loaded.registration)) {
      if (!loaded.jointly_eligible_strata.includes(stratum))
        blockers.push(`no jointly eligible ${stratum} cells`);
    }
  }
  return blockers;
}
