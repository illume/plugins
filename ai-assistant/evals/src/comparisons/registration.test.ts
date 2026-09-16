import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadAllScenarios } from '../scenarios/loader.js';
import {
  assertComparisonRegistration,
  type ComparisonRegistration,
  comparisonRegistrationStatus,
  legacyComparisonRegistrationPath,
  loadComparisonRegistration,
} from './registration.js';
import { FINITE_ROSTER_REPEAT_DESIGN } from './repeatTargeting.js';

function cloneRegistration(): ComparisonRegistration {
  return structuredClone(loadComparisonRegistration(legacyComparisonRegistrationPath).registration);
}

function revisedRegistration(): ComparisonRegistration {
  const registration = cloneRegistration();
  registration.schema_version = '1.2.0';
  registration.supersedes = {
    registration_id: registration.registration_id,
    digest: loadComparisonRegistration(legacyComparisonRegistrationPath).digest,
    reason: 'Separate supplied-evidence diagnosis from repair.',
  };
  registration.registration_id = 'test-diagnosis-v2';
  registration.comparison_scope = {
    mode: 'supplied_evidence_diagnosis',
    required_strata: [
      'fault_diagnosis',
      'healthy_control',
      'insufficient_evidence',
      'security_prompt_injection',
      'multi_turn_tool_failure',
    ],
    minimum_jointly_eligible_cells: 20,
    minimum_jointly_eligible_families: 10,
    repair_evidence: 'separate_headlamp_gate',
  };
  delete registration.adapter_qualification.k8sgpt;
  registration.adapter_qualification['kubectl-ai'] = 'passed';
  registration.multiplicity_policy.primary_contrasts[1] = 'headlamp_cli_vs_kubectl-ai';
  for (const entry of registration.roster) {
    delete entry.assignments.k8sgpt;
    entry.assignments['kubectl-ai'] =
      entry.behavioral_stratum === 'approved_repair' ? 'unsupported' : 'eligible';
  }
  registration.practical_margin = 0.1;
  registration.repeat_design = { ...FINITE_ROSTER_REPEAT_DESIGN };
  registration.dependence_unit = 'full_roster_round';
  registration.resampling_unit = 'full_roster_round';
  for (const stratum of registration.comparison_scope.required_strata)
    registration.repeat_targets_by_stratum[stratum] = 10;
  registration.private_holdouts.required_in_phase = 3;
  registration.design_status = 'locked';
  registration.confirmatory_execution = 'allowed';
  return registration;
}

test('revised diagnosis design can lock without a cross-system repair repeat target', () => {
  const loaded = assertComparisonRegistration(revisedRegistration());
  const status = comparisonRegistrationStatus(loaded);
  assert.equal(loaded.jointly_eligible_count, 25);
  assert.equal(status.in_scope_scenario_count, 25);
  assert.ok(loaded.jointly_eligible_family_count >= 10);
  assert.equal(status.comparison_systems.includes('k8sgpt'), false);
  assert.equal(loaded.registration.repeat_targets_by_stratum.approved_repair, null);
  assert.deepEqual(status.blockers, []);
});

test('revised diagnosis lock rejects missing qualification, evidence gates, scope coverage, or valid margin', () => {
  const mutations: Array<(registration: ComparisonRegistration) => void> = [
    registration => {
      delete registration.repeat_design;
      registration.dependence_unit = 'lineage_id';
      registration.resampling_unit = 'lineage_id';
    },
    registration => {
      registration.repeat_targets_by_stratum.healthy_control = 11;
    },
    registration => {
      registration.dependence_unit = 'lineage_id';
    },
    registration => {
      registration.multiplicity_policy.familywise_alpha = 0.1;
    },
    registration => {
      registration.adapter_qualification['kubectl-ai'] = 'pending';
    },
    registration => {
      registration.repeat_targets_by_stratum.healthy_control = null;
    },
    registration => {
      registration.practical_margin = 0;
    },
    registration => {
      registration.practical_margin = 1;
    },
    registration => {
      registration.practical_margin = null;
    },
    registration => {
      for (const entry of registration.roster.filter(
        entry => entry.behavioral_stratum === 'insufficient_evidence'
      ))
        entry.assignments['kubectl-ai'] = 'unsupported';
    },
    registration => {
      registration.roster.find(
        entry => entry.behavioral_stratum === 'approved_repair'
      )!.assignments['kubectl-ai'] = 'eligible';
    },
  ];
  for (const mutate of mutations) {
    const registration = revisedRegistration();
    mutate(registration);
    assert.throws(() => assertComparisonRegistration(registration));
  }
});

test('registration schema enforces versioned systems and the exact contrast order', () => {
  for (const revised of [false, true]) {
    const registration = revised ? revisedRegistration() : cloneRegistration();
    registration.multiplicity_policy.primary_contrasts.reverse();
    assert.throws(() => assertComparisonRegistration(registration), /schema validation/);
  }
  const registration = revisedRegistration();
  registration.adapter_qualification.k8sgpt = 'passed';
  assert.throws(() => assertComparisonRegistration(registration), /schema validation/);
});

test('Phase 3 holdouts do not block Phase 2 while historical holdout gates remain enforced', () => {
  for (const verification of ['pending', 'failed'] as const) {
    const registration = revisedRegistration();
    registration.private_holdouts.access_control_verification = verification;
    const status = comparisonRegistrationStatus(assertComparisonRegistration(registration));
    assert.equal(status.private_holdouts_required_in_phase, 3);
    assert.deepEqual(status.blockers, []);
    delete registration.private_holdouts.required_in_phase;
    assert.throws(() => assertComparisonRegistration(registration), /incomplete Phase 2B\/2C/);
  }
  const legacy = cloneRegistration();
  legacy.private_holdouts.required_in_phase = 3;
  assert.throws(() => assertComparisonRegistration(legacy), /schema validation/);
  const current = structuredClone(loadComparisonRegistration().registration);
  current.repeat_targets_by_stratum.healthy_control = null;
  current.design_status = 'locked';
  current.confirmatory_execution = 'allowed';
  assert.throws(() => assertComparisonRegistration(current), /incomplete Phase 2B\/2C/);
});

test('revised design rejects insufficient family coverage even with 25 eligible cases', () => {
  const registration = revisedRegistration();
  const scenarios = structuredClone(loadAllScenarios());
  for (const entry of registration.roster) {
    entry.family_id = 'one-family';
    scenarios.find(
      scenario => scenario.manifest.scenario_id === entry.scenario_id
    )!.manifest.portfolio.family_id = 'one-family';
  }
  assert.throws(
    () => assertComparisonRegistration(registration, scenarios),
    /incomplete Phase 2B\/2C exit controls/
  );
  registration.design_status = 'draft';
  registration.confirmatory_execution = 'blocked';
  const status = comparisonRegistrationStatus(
    assertComparisonRegistration(registration, scenarios)
  );
  assert.equal(status.jointly_eligible_count, 25);
  assert.ok(status.blockers.includes('fewer than 10 jointly eligible families'));
});

test('loads the frozen 30-case roster with terminal capability dispositions', () => {
  const loaded = loadComparisonRegistration(legacyComparisonRegistrationPath);

  assert.equal(loaded.registration.roster.length, 30);
  assert.equal(loaded.registration.design_status, 'draft');
  assert.equal(loaded.registration.confirmatory_execution, 'blocked');
  assert.equal(loaded.registration.multiplicity_policy.method, 'fixed_sequence');
  assert.equal(loaded.registration.multiplicity_policy.familywise_alpha, 0.05);
  assert.equal(
    loaded.registration.missing_pair_rule.invalid_pair,
    'exclude_task_quality_retain_reliability'
  );
  assert.equal(loaded.family_count, 22);
  assert.equal(loaded.lineage_count, 7);
  assert.equal(loaded.jointly_eligible_count, 0);
  assert.equal(loaded.registration.adapter_qualification.k8sgpt, 'failed');
  assert.match(loaded.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    new Set(loaded.registration.roster.map(entry => entry.behavioral_stratum)).size,
    6
  );
});

test('rejects an eligible cell while scenario or adapter qualification is pending', () => {
  const registration = cloneRegistration();
  registration.adapter_qualification.headlamp_cli = 'pending';

  assert.throws(
    () => assertComparisonRegistration(registration),
    /eligible requires qualified scenario and adapter/
  );
});

test('rejects duplicate roster identities', () => {
  const registration = cloneRegistration();
  registration.roster[1]!.scenario_id = registration.roster[0]!.scenario_id;

  assert.throws(() => assertComparisonRegistration(registration), /duplicate comparison scenario/);
});

test('rejects a locked design until every exit control is complete', () => {
  const registration = cloneRegistration();
  registration.design_status = 'locked';
  registration.confirmatory_execution = 'allowed';

  assert.throws(
    () => assertComparisonRegistration(registration),
    /incomplete Phase 2B\/2C exit controls/
  );
});

test('status projection preserves every terminal eligible and unsupported assignment', () => {
  const status = comparisonRegistrationStatus(
    loadComparisonRegistration(legacyComparisonRegistrationPath)
  );

  assert.equal(status.assignment_counts.headlamp_plugin.eligible, 30);
  assert.equal(status.assignment_counts.headlamp_cli.eligible, 30);
  assert.equal(status.assignment_counts.holmesgpt.eligible, 25);
  assert.equal(status.assignment_counts.holmesgpt.unsupported, 5);
  assert.equal(status.assignment_counts.k8sgpt.eligible, 0);
  assert.equal(status.assignment_counts.k8sgpt.unsupported, 30);
  assert.deepEqual(status.blockers, [
    'adapter qualification incomplete',
    'practical margin unset',
    'repeat targets unset',
    'private holdout access controls unverified',
    'fewer than 20 jointly eligible cells',
  ]);
});

test('locked finite-roster plan preserves historical identity without reusing exploratory evidence', () => {
  const legacy = loadComparisonRegistration(legacyComparisonRegistrationPath);
  const loaded = loadComparisonRegistration();
  const status = comparisonRegistrationStatus(loaded);
  assert.equal(loaded.registration.registration_id, 'phase2-comparison-v2');
  assert.equal(loaded.registration.supersedes?.digest, legacy.digest);
  assert.equal(legacy.digest, '0187235ef8da8b6f3f2dcd13e5261cbbd4a139781626bb3af73c3ca3ced8bb25');
  const identities = (registration: ComparisonRegistration) =>
    registration.roster.map(entry => ({
      scenario_id: entry.scenario_id,
      behavioral_stratum: entry.behavioral_stratum,
      family_id: entry.family_id,
      lineage_id: entry.lineage_id,
    }));
  assert.deepEqual(identities(loaded.registration), identities(legacy.registration));
  assert.equal(status.confirmatory_execution, 'allowed');
  assert.equal(status.design_status, 'locked');
  assert.deepEqual(loaded.registration.repeat_design, FINITE_ROSTER_REPEAT_DESIGN);
  assert.equal(status.repeat_budget?.cli_invocations, 750);
  assert.equal(status.repeat_budget?.precision_guaranteed_at_practical_margin, false);
  assert.equal(status.in_scope_scenario_count, 25);
  assert.equal(status.assignment_counts['kubectl-ai'].pending, 0);
  assert.equal(status.assignment_counts['kubectl-ai'].eligible, 25);
  assert.equal(status.assignment_counts['kubectl-ai'].unsupported, 5);
  assert.equal(status.assignment_counts.k8sgpt, undefined);
  assert.equal(status.jointly_eligible_count, 25);
  assert.equal(status.jointly_eligible_family_count, 17);
  assert.equal(loaded.registration.practical_margin, 0.05);
  assert.equal(status.private_holdouts_required_in_phase, 3);
  assert.equal(loaded.registration.private_holdouts.access_control_verification, 'pending');
  assert.deepEqual(status.blockers, []);
});

test('qualified kubectl-ai draft links passing controls to the reviewed source and image', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const receiptText = readFileSync(
    path.join(root, 'registrations/kubectl-ai-qualification-20260915.json'),
    'utf8'
  );
  const receipt = JSON.parse(receiptText);
  const receiptDigest = createHash('sha256').update(receiptText).digest('hex');
  const registration = loadComparisonRegistration().registration;
  assert.ok(registration.limitations.some(text => text.includes(receiptDigest)));
  assert.equal(receipt.parity.status, 'eligible');
  assert.deepEqual(Object.values(receipt.parity.stages), ['passed', 'passed', 'passed', 'passed']);
  assert.equal(receipt.provider_failure.outcome, 'timeout');
  assert.equal(receipt.provider_failure.submission, null);
  assert.equal(receipt.provider_failure.observed_http_status, 401);
  assert.equal(receipt.cleanup.containers_remaining, 0);
  assert.equal(receipt.cleanup.private_mounts_remaining, 0);
  assert.ok(receipt.absent_executables.includes('/bin/bash'));
  for (const [file, expected] of Object.entries(receipt.sources)) {
    assert.equal(
      createHash('sha256')
        .update(readFileSync(path.join(root, file)))
        .digest('hex'),
      expected,
      `Qualification needs refresh: ${file}`
    );
  }
});
