import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CandidateInvocationInput, CandidateInvocationResult } from './candidateAdapter.js';
import {
  qualifyReferenceAdapter,
  type ReferenceAdapterQualificationTarget,
} from './referenceQualification.js';
import { loadScenario } from '../scenarios/loader.js';

const input = {
  packet: loadScenario('core-service-selector-fault-v1').candidatePacket,
  observations: [],
  evidence_digest: 'a'.repeat(64),
} satisfies CandidateInvocationInput;

const fixedSubmission = JSON.stringify({ schema_version: '1.0.0', cause_facts: [] });

function result(submissionText: string | null): CandidateInvocationResult {
  return {
    raw_text: 'Unscored adapter prose.',
    submission_text: submissionText,
    status: 'ok',
    duration_ns: '1',
    tool_events: [],
  };
}

function target(
  overrides: Partial<ReferenceAdapterQualificationTarget> = {}
): ReferenceAdapterQualificationTarget {
  return {
    system: 'holmesgpt',
    async startup() {},
    async health() {
      return true;
    },
    async invokeFixedSubmission() {
      return result('{"cause_facts":[],"schema_version":"1.0.0"}');
    },
    async cleanup() {},
    ...overrides,
  };
}

test('qualifies lossless fixed-submission mapping regardless of JSON key order', async () => {
  const disposition = await qualifyReferenceAdapter(target(), input, fixedSubmission);

  assert.equal(disposition.status, 'eligible');
  assert.deepEqual(disposition.reasons, []);
  assert.deepEqual(Object.values(disposition.stages), ['passed', 'passed', 'passed', 'passed']);
});

test('fails closed when an adapter changes the structured submission', async () => {
  const disposition = await qualifyReferenceAdapter(
    target({
      async invokeFixedSubmission() {
        return result('{"schema_version":"1.0.0","cause_facts":[{"wrong":true}]}');
      },
    }),
    input,
    fixedSubmission
  );

  assert.equal(disposition.status, 'ineligible');
  assert.equal(disposition.stages.fixed_submission_parity, 'failed');
  assert.match(disposition.reasons[0] ?? '', /changed/);
});

test('does not invoke parity after an unhealthy adapter and still cleans up', async () => {
  let invoked = false;
  let cleaned = false;
  const disposition = await qualifyReferenceAdapter(
    target({
      async health() {
        return false;
      },
      async invokeFixedSubmission() {
        invoked = true;
        return result(fixedSubmission);
      },
      async cleanup() {
        cleaned = true;
      },
    }),
    input,
    fixedSubmission
  );

  assert.equal(disposition.status, 'ineligible');
  assert.equal(disposition.stages.health, 'failed');
  assert.equal(disposition.stages.fixed_submission_parity, 'not_run');
  assert.equal(invoked, false);
  assert.equal(cleaned, true);
});

test('attributes a thrown readiness probe to health', async () => {
  const disposition = await qualifyReferenceAdapter(
    target({
      async health() {
        throw new Error('probe timed out');
      },
    }),
    input,
    fixedSubmission
  );

  assert.equal(disposition.status, 'ineligible');
  assert.equal(disposition.stages.health, 'failed');
  assert.equal(disposition.stages.fixed_submission_parity, 'not_run');
  assert.match(disposition.reasons[0] ?? '', /probe timed out/);
});

test('cleanup failure makes an otherwise passing adapter ineligible', async () => {
  const disposition = await qualifyReferenceAdapter(
    target({
      system: 'k8sgpt',
      async cleanup() {
        throw new Error('namespace remains');
      },
    }),
    input,
    fixedSubmission
  );

  assert.equal(disposition.system, 'k8sgpt');
  assert.equal(disposition.status, 'ineligible');
  assert.equal(disposition.stages.cleanup, 'failed');
  assert.match(disposition.reasons.at(-1) ?? '', /namespace remains/);
});

test('startup failure records skipped controls and still attempts cleanup', async () => {
  let cleaned = false;
  const disposition = await qualifyReferenceAdapter(
    target({
      async startup() {
        throw new Error('container unavailable');
      },
      async cleanup() {
        cleaned = true;
      },
    }),
    input,
    fixedSubmission
  );

  assert.equal(disposition.status, 'ineligible');
  assert.equal(disposition.stages.startup, 'failed');
  assert.equal(disposition.stages.health, 'not_run');
  assert.equal(disposition.stages.fixed_submission_parity, 'not_run');
  assert.equal(cleaned, true);
});

test('mutating tool activity invalidates fixed-submission parity', async () => {
  const disposition = await qualifyReferenceAdapter(
    target({
      async invokeFixedSubmission() {
        return {
          ...result(fixedSubmission),
          tool_events: [{ tool_name: 'kubectl.patch', mutating: true, status: 'success' }],
        };
      },
    }),
    input,
    fixedSubmission
  );

  assert.equal(disposition.status, 'ineligible');
  assert.match(disposition.reasons[0] ?? '', /mutating/);
});
