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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ActionJournalEvent,
  ActionRequest,
  CandidateActionPolicy,
} from '../contracts/evaluationContracts.js';
import {
  actionEffectDigest,
  actionRequestDigest,
  assertNoDuplicateActionEffects,
  assertValidActionJournal,
  authorizeAction,
  createActionApproval,
  type ActionExecutionContext,
} from './approval.js';

const request: ActionRequest = {
  schema_version: '1.0.0',
  action_id: 'repair-selector',
  trial_id: 'trial-1',
  scenario_id: 'core-service-selector-repair-v1',
  candidate_id: 'candidate-a',
  cluster_profile: 'local-minikube',
  cluster_identity_digest: 'a'.repeat(64),
  evidence_digest: 'b'.repeat(64),
  target: {
    api_version: 'v1',
    kind: 'Service',
    namespace: 'trial',
    name: 'web',
    uid: 'service-uid',
  },
  operation: 'json_patch',
  patch: [{ op: 'replace', path: '/spec/selector/tier', value: 'backend' }],
};
const policy: CandidateActionPolicy = {
  approval_required: true,
  allowed_operations: ['json_patch'],
  allowed_resource_refs: ['service/web'],
  allowed_patches: [{ resource_ref: 'service/web', patch: request.patch }],
  deny_on_stale_evidence: true,
};
const current: ActionExecutionContext = {
  candidate_id: request.candidate_id,
  cluster_identity_digest: request.cluster_identity_digest,
  evidence_digest: request.evidence_digest,
  trial_namespace: request.target.namespace,
  target: request.target,
};

test('approval binds the exact request and current evidence', () => {
  const approval = createActionApproval(request, {
    approvalId: 'approval-1',
    decision: 'approved',
    decidedAt: '2026-09-09T00:00:00Z',
  });
  assert.deepEqual(authorizeAction(request, approval, policy, current), {
    authorized: true,
    request_digest: actionRequestDigest(request),
  });
});

test('authorization fails closed for stale evidence and changed requests', () => {
  const approval = createActionApproval(request, {
    approvalId: 'approval-1',
    decision: 'approved',
    decidedAt: '2026-09-09T00:00:00Z',
  });
  const stale = authorizeAction(request, approval, policy, {
    ...current,
    evidence_digest: 'c'.repeat(64),
  });
  assert.equal(stale.authorized, false);
  if (stale.authorized) assert.fail('stale evidence was authorized');
  assert.equal(stale.reason, 'stale_evidence');
  const changed = {
    ...request,
    patch: [{ op: 'replace' as const, path: '/spec/selector/tier', value: 'other' }],
  };
  const changedRequest = authorizeAction(changed, approval, policy, current);
  assert.equal(changedRequest.authorized, false);
  if (changedRequest.authorized) assert.fail('changed request was authorized');
  assert.equal(changedRequest.reason, 'request_digest_mismatch');
});

test('denied approvals can never authorize execution', () => {
  const approval = createActionApproval(request, {
    approvalId: 'approval-1',
    decision: 'denied',
    decidedAt: '2026-09-09T00:00:00Z',
  });
  const authorization = authorizeAction(request, approval, policy, current);
  assert.equal(authorization.authorized, false);
  if (authorization.authorized) assert.fail('denied approval was authorized');
  assert.equal(authorization.reason, 'approval_denied');
});

test('action requests enforce operation-specific JSON Patch values', () => {
  assert.throws(
    () =>
      actionRequestDigest({
        ...request,
        patch: [{ op: 'replace', path: '/spec/selector/tier' }],
      } as unknown as ActionRequest),
    /action request failed schema validation/
  );
  assert.throws(
    () =>
      actionRequestDigest({
        ...request,
        patch: [{ op: 'remove', path: '/spec/selector/tier', value: 'frontend' }],
      } as unknown as ActionRequest),
    /action request failed schema validation/
  );
  assert.throws(
    () =>
      actionRequestDigest({
        ...request,
        patch: [{ op: 'remove', path: '/metadata/~2invalid' }],
      }),
    /action request failed schema validation/
  );
});

test('authorization enforces the scenario resource and namespace policy', () => {
  const otherResource = {
    ...request,
    target: { ...request.target, name: 'other' },
  };
  const resourceApproval = createActionApproval(otherResource, {
    approvalId: 'approval-resource',
    decision: 'approved',
    decidedAt: '2026-09-09T00:00:00Z',
  });
  const resourceAuthorization = authorizeAction(otherResource, resourceApproval, policy, {
    ...current,
    target: otherResource.target,
  });
  assert.equal(resourceAuthorization.authorized, false);
  if (resourceAuthorization.authorized) assert.fail('out-of-policy resource was authorized');
  assert.equal(resourceAuthorization.reason, 'resource_not_allowed');

  const namespaceAuthorization = authorizeAction(
    request,
    createActionApproval(request, {
      approvalId: 'approval-namespace',
      decision: 'approved',
      decidedAt: '2026-09-09T00:00:00Z',
    }),
    policy,
    { ...current, trial_namespace: 'another-trial' }
  );
  assert.equal(namespaceAuthorization.authorized, false);
  if (namespaceAuthorization.authorized) assert.fail('cross-namespace request was authorized');
  assert.equal(namespaceAuthorization.reason, 'namespace_mismatch');
});

test('authorization rejects a changed live identity and patch outside the exact policy', () => {
  const approval = createActionApproval(request, {
    approvalId: 'approval-live-context',
    decision: 'approved',
    decidedAt: '2026-09-09T00:00:00Z',
  });
  const recreated = authorizeAction(request, approval, policy, {
    ...current,
    target: { ...current.target, uid: 'recreated-service-uid' },
  });
  assert.equal(recreated.authorized, false);
  if (recreated.authorized) assert.fail('recreated target was authorized');
  assert.equal(recreated.reason, 'target_mismatch');

  const narrowerPolicy = { ...policy, allowed_patches: [] };
  const outOfScope = authorizeAction(request, approval, narrowerPolicy, current);
  assert.equal(outOfScope.authorized, false);
  if (outOfScope.authorized) assert.fail('out-of-policy patch was authorized');
  assert.equal(outOfScope.reason, 'patch_not_allowed');
});

function journalEvent(
  sequence: number,
  type: ActionJournalEvent['type'],
  status: ActionJournalEvent['status']
): ActionJournalEvent {
  return {
    schema_version: '1.0.0',
    event_id: `event-${sequence}`,
    trial_id: request.trial_id,
    action_id: request.action_id,
    sequence,
    recorded_at: '2026-09-09T00:00:00Z',
    type,
    request_digest: actionRequestDigest(request),
    status,
    ...(type === 'action_executed'
      ? {
          effect_digest: actionEffectDigest(request),
          ...(status === 'success' ? { result_digest: 'c'.repeat(64) } : {}),
        }
      : {}),
    ...(sequence >= 3 ? { approval_id: 'approval-1' } : {}),
  };
}

test('action journal accepts an authorized execution lifecycle', () => {
  assert.doesNotThrow(() =>
    assertValidActionJournal(
      [
        journalEvent(1, 'action_proposed', 'pending'),
        journalEvent(2, 'action_displayed', 'pending'),
        journalEvent(3, 'approval_decided', 'approved'),
        journalEvent(4, 'authorization_checked', 'approved'),
        journalEvent(5, 'action_executed', 'success'),
        journalEvent(6, 'postcondition_checked', 'success'),
        journalEvent(7, 'collateral_checked', 'success'),
      ],
      request
    )
  );
});

test('action journal rejects execution without authorization and non-contiguous events', () => {
  assert.throws(
    () =>
      assertValidActionJournal(
        [
          journalEvent(1, 'action_proposed', 'pending'),
          journalEvent(2, 'action_executed', 'success'),
        ],
        request
      ),
    /must retain the approval_id|requires one approved authorization/
  );
  assert.throws(
    () =>
      assertValidActionJournal(
        [
          journalEvent(1, 'action_proposed', 'pending'),
          journalEvent(3, 'action_displayed', 'pending'),
        ],
        request
      ),
    /sequence must be contiguous/
  );
});

test('action journal rejects contradictory decisions and duplicate execution', () => {
  assert.throws(
    () =>
      assertValidActionJournal(
        [
          journalEvent(1, 'action_proposed', 'pending'),
          journalEvent(2, 'action_displayed', 'pending'),
          journalEvent(3, 'approval_decided', 'denied'),
          journalEvent(4, 'authorization_checked', 'approved'),
        ],
        request
      ),
    /denied approval cannot produce approved authorization/
  );

  assert.throws(
    () =>
      assertValidActionJournal(
        [
          journalEvent(1, 'action_proposed', 'pending'),
          journalEvent(2, 'action_displayed', 'pending'),
          journalEvent(3, 'approval_decided', 'approved'),
          journalEvent(4, 'authorization_checked', 'approved'),
          journalEvent(5, 'action_executed', 'success'),
          journalEvent(6, 'action_executed', 'success'),
        ],
        request
      ),
    /requires one approved authorization/
  );
});

test('action journal rejects a forged effect digest', () => {
  const executed = journalEvent(5, 'action_executed', 'success');
  assert.throws(
    () =>
      assertValidActionJournal(
        [
          journalEvent(1, 'action_proposed', 'pending'),
          journalEvent(2, 'action_displayed', 'pending'),
          journalEvent(3, 'approval_decided', 'approved'),
          journalEvent(4, 'authorization_checked', 'approved'),
          { ...executed, effect_digest: '0'.repeat(64) },
        ],
        request
      ),
    /effect digest does not match the canonical action request/
  );
});

test('action journal rejects successful execution without a result digest', () => {
  const executed = journalEvent(5, 'action_executed', 'success');
  delete executed.result_digest;
  assert.throws(
    () =>
      assertValidActionJournal(
        [
          journalEvent(1, 'action_proposed', 'pending'),
          journalEvent(2, 'action_displayed', 'pending'),
          journalEvent(3, 'approval_decided', 'approved'),
          journalEvent(4, 'authorization_checked', 'approved'),
          executed,
        ],
        request
      ),
    /result_digest/
  );
});

test('action journal requires an effect digest even when execution fails', () => {
  const executed = journalEvent(5, 'action_executed', 'failed');
  delete executed.effect_digest;
  assert.throws(
    () =>
      assertValidActionJournal(
        [
          journalEvent(1, 'action_proposed', 'pending'),
          journalEvent(2, 'action_displayed', 'pending'),
          journalEvent(3, 'approval_decided', 'approved'),
          journalEvent(4, 'authorization_checked', 'approved'),
          executed,
        ],
        request
      ),
    /effect_digest/
  );
});

test('trial-wide journals reject duplicate effects under different action IDs', () => {
  const first = [
    journalEvent(1, 'action_proposed', 'pending'),
    journalEvent(2, 'action_displayed', 'pending'),
    journalEvent(3, 'approval_decided', 'approved'),
    journalEvent(4, 'authorization_checked', 'approved'),
    journalEvent(5, 'action_executed', 'success'),
  ];
  const secondRequest = { ...request, action_id: 'repair-selector-again' };
  const second = first.map(event => ({
    ...event,
    event_id: `${event.event_id}-second`,
    action_id: secondRequest.action_id,
    request_digest: actionRequestDigest(secondRequest),
    ...(event.type === 'action_executed'
      ? { effect_digest: actionEffectDigest(secondRequest) }
      : {}),
  }));
  assert.throws(
    () =>
      assertNoDuplicateActionEffects([
        { request, events: first },
        { request: secondRequest, events: second },
      ]),
    /duplicate action effect/
  );
});
