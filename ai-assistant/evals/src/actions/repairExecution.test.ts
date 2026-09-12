/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { sha256OfText } from '../canonicalJson.js';
import { SimulatedKwokAdapter } from '../cluster/adapters/simulatedAdapter.js';
import type { ActionRequest, CandidateActionPolicy } from '../contracts/evaluationContracts.js';
import { gradeExecutedRepair } from '../grading/repairGrader.js';
import { executeRepair } from './repairExecution.js';

const fixture = path.resolve('scenarios/core-service-selector-repair-v1/setup.yaml');
const patch = [
  { op: 'test' as const, path: '/spec/selector/tier', value: 'frontend' },
  { op: 'replace' as const, path: '/spec/selector/tier', value: 'backend' },
];

async function repairInput(decision: 'approved' | 'denied' = 'approved') {
  const adapter = new SimulatedKwokAdapter('local-kwok');
  await adapter.applyManifest('trial-ns', fixture);
  const target = await adapter.getResourceIdentity('trial-ns', 'service/web');
  assert.ok(target);
  const request: ActionRequest = {
    schema_version: '1.0.0',
    action_id: 'repair-selector-tier',
    trial_id: 'trial-1',
    scenario_id: 'scenario-1',
    candidate_id: 'candidate-1',
    cluster_profile: 'local-kwok',
    cluster_identity_digest: sha256OfText('cluster-1'),
    evidence_digest: sha256OfText('evidence-1'),
    target,
    operation: 'json_patch',
    patch,
  };
  const policy: CandidateActionPolicy = {
    approval_required: true,
    allowed_operations: ['json_patch'],
    allowed_resource_refs: ['service/web'],
    allowed_patches: [{ resource_ref: 'service/web', patch }],
    deny_on_stale_evidence: true,
  };
  return {
    request,
    policy,
    acceptedAction: {
      action_id: request.action_id,
      description: 'repair selector',
      operation: 'json_patch' as const,
      target_resource: 'service/web',
      patch,
      allowed_diff_paths: ['/service/web/spec/selector/tier'],
      postconditions: [
        {
          fact_id: 'selector-repaired',
          resource_ref: 'service/web',
          field_path: 'spec.selector',
          observed_value: JSON.stringify({ app: 'web', tier: 'backend' }),
        },
      ],
      rollback_patch: [
        { op: 'test' as const, path: '/spec/selector/tier', value: 'backend' },
        { op: 'replace' as const, path: '/spec/selector/tier', value: 'frontend' },
      ],
    },
    clusterAdapter: adapter,
    beforeObservations: [
      {
        resource_ref: 'service/web',
        field_path: 'spec.selector',
        value: JSON.stringify({ app: 'web', tier: 'frontend' }),
      },
    ],
    currentEvidenceDigest: async () => request.evidence_digest,
    observeAfter: async () => {
      const selector = await adapter.getServiceSelector('trial-ns', 'web');
      return [
        {
          resource_ref: 'service/web',
          field_path: 'spec.selector',
          value: JSON.stringify(selector.selector),
        },
      ];
    },
    requestApproval: async () => ({ decision }),
  };
}

test('executeRepair produces a passing journal for an approved exact patch', async () => {
  const result = await executeRepair(await repairInput());
  assert.deepEqual(result.changedPaths, ['/service/web/spec/selector/tier']);
  assert.equal(
    gradeExecutedRepair({ request: result.request, events: result.events, graderResultId: 'g1' })
      .outcome,
    'pass'
  );
});

test('executeRepair never mutates after denied approval', async () => {
  const input = await repairInput('denied');
  const result = await executeRepair(input);
  assert.equal(
    result.events.some(event => event.type === 'action_executed'),
    false
  );
  assert.equal(
    gradeExecutedRepair({ request: result.request, events: result.events, graderResultId: 'g2' })
      .outcome,
    'abstain'
  );
});

test('executeRepair rolls back a failed postcondition and grades the attempt failed', async () => {
  const input = await repairInput();
  input.acceptedAction.postconditions![0]!.observed_value = 'unexpected';
  const result = await executeRepair(input);
  assert.equal(result.events.at(-1)?.type, 'rollback_executed');
  assert.equal(result.events.at(-1)?.status, 'success');
  assert.deepEqual(await input.clusterAdapter.getServiceSelector('trial-ns', 'web'), {
    found: true,
    selector: { app: 'web', tier: 'frontend' },
  });
  assert.equal(
    gradeExecutedRepair({ request: result.request, events: result.events, graderResultId: 'g3' })
      .outcome,
    'fail'
  );
});
