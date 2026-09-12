import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertComparisonRegistration,
  comparisonRegistrationStatus,
  loadComparisonRegistration,
  type ComparisonRegistration,
} from './registration.js';

function cloneRegistration(): ComparisonRegistration {
  return structuredClone(loadComparisonRegistration().registration);
}

test('loads the frozen 30-case roster with terminal capability dispositions', () => {
  const loaded = loadComparisonRegistration();

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
  assert.equal(loaded.jointly_eligible_count, 12);
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
  const status = comparisonRegistrationStatus(loadComparisonRegistration());

  assert.equal(status.assignment_counts.headlamp_plugin.eligible, 30);
  assert.equal(status.assignment_counts.headlamp_cli.eligible, 30);
  assert.equal(status.assignment_counts.holmesgpt.eligible, 25);
  assert.equal(status.assignment_counts.holmesgpt.unsupported, 5);
  assert.equal(status.assignment_counts.k8sgpt.eligible, 12);
  assert.equal(status.assignment_counts.k8sgpt.unsupported, 18);
  assert.deepEqual(status.blockers, [
    'practical margin unset',
    'repeat targets unset',
    'private holdout access controls unverified',
    'fewer than 20 jointly eligible cells',
  ]);
});
