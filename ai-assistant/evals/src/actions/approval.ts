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

import { sha256OfJson, type JsonValue } from '../canonicalJson.js';
import type {
  ActionApproval,
  ActionJournalEvent,
  ActionRequest,
  CandidateActionPolicy,
} from '../contracts/evaluationContracts.js';
import { assertValid } from '../contracts/validate.js';
import { loadSchema } from '../contracts/schemas.js';

/** Stable digest shown to the user and bound into an approval decision. */
export function actionRequestDigest(request: ActionRequest): string {
  assertValid(loadSchema('action-request'), request, 'action request');
  return sha256OfJson(request as unknown as JsonValue);
}

/** Digest of the target and mutation used to detect duplicate effects within a trial. */
export function actionEffectDigest(request: ActionRequest): string {
  assertValid(loadSchema('action-request'), request, 'action request');
  return sha256OfJson({
    target: request.target,
    operation: request.operation,
    patch: request.patch,
  } as unknown as JsonValue);
}

/** Creates a decision bound to candidate, cluster, target, evidence, and request bytes. */
export function createActionApproval(
  request: ActionRequest,
  input: {
    approvalId: string;
    decision: ActionApproval['decision'];
    decidedAt: string;
    reason?: string;
  }
): ActionApproval {
  const approval: ActionApproval = {
    schema_version: '1.0.0',
    approval_id: input.approvalId,
    action_id: request.action_id,
    request_digest: actionRequestDigest(request),
    candidate_id: request.candidate_id,
    cluster_identity_digest: request.cluster_identity_digest,
    evidence_digest: request.evidence_digest,
    target_uid: request.target.uid,
    decision: input.decision,
    decided_at: input.decidedAt,
    ...(input.reason ? { reason: input.reason } : {}),
  };
  assertValid(loadSchema('action-approval'), approval, 'action approval');
  return approval;
}

/** Machine-readable authorization disposition checked immediately before execution. */
export type ActionAuthorization =
  | { authorized: true; request_digest: string }
  | {
      authorized: false;
      request_digest: string;
      reason:
        | 'approval_denied'
        | 'action_mismatch'
        | 'candidate_mismatch'
        | 'cluster_mismatch'
        | 'target_mismatch'
        | 'stale_evidence'
        | 'request_digest_mismatch'
        | 'operation_not_allowed'
        | 'resource_not_allowed'
        | 'namespace_mismatch'
        | 'patch_not_allowed';
    };

/** Fresh execution identity resolved immediately before an approved action runs. */
export interface ActionExecutionContext {
  candidate_id: string;
  cluster_identity_digest: string;
  evidence_digest: string;
  trial_namespace: string;
  target: ActionRequest['target'];
}

/**
 * Revalidates every approval binding against the current execution context.
 * Approval is fail-closed and stale evidence can never be silently re-used.
 */
export function authorizeAction(
  request: ActionRequest,
  approval: ActionApproval,
  policy: CandidateActionPolicy,
  current: ActionExecutionContext
): ActionAuthorization {
  assertValid(loadSchema('action-approval'), approval, 'action approval');
  const requestDigest = actionRequestDigest(request);
  if (approval.decision !== 'approved') {
    return { authorized: false, request_digest: requestDigest, reason: 'approval_denied' };
  }
  if (approval.action_id !== request.action_id) {
    return { authorized: false, request_digest: requestDigest, reason: 'action_mismatch' };
  }
  if (
    approval.candidate_id !== request.candidate_id ||
    current.candidate_id !== request.candidate_id
  ) {
    return { authorized: false, request_digest: requestDigest, reason: 'candidate_mismatch' };
  }
  if (
    approval.cluster_identity_digest !== request.cluster_identity_digest ||
    current.cluster_identity_digest !== request.cluster_identity_digest
  ) {
    return { authorized: false, request_digest: requestDigest, reason: 'cluster_mismatch' };
  }
  if (
    approval.target_uid !== request.target.uid ||
    sha256OfJson(current.target as unknown as JsonValue) !==
      sha256OfJson(request.target as unknown as JsonValue)
  ) {
    return { authorized: false, request_digest: requestDigest, reason: 'target_mismatch' };
  }
  if (approval.request_digest !== requestDigest) {
    return {
      authorized: false,
      request_digest: requestDigest,
      reason: 'request_digest_mismatch',
    };
  }
  if (!policy.allowed_operations.includes(request.operation)) {
    return { authorized: false, request_digest: requestDigest, reason: 'operation_not_allowed' };
  }
  const resourceRef = `${request.target.kind.toLowerCase()}/${request.target.name}`;
  if (!policy.allowed_resource_refs.includes(resourceRef)) {
    return { authorized: false, request_digest: requestDigest, reason: 'resource_not_allowed' };
  }
  if (request.target.namespace !== current.trial_namespace) {
    return { authorized: false, request_digest: requestDigest, reason: 'namespace_mismatch' };
  }
  const patchDigest = sha256OfJson(request.patch as unknown as JsonValue);
  const patchAllowed = policy.allowed_patches.some(
    allowed =>
      allowed.resource_ref === resourceRef &&
      sha256OfJson(allowed.patch as unknown as JsonValue) === patchDigest
  );
  if (!patchAllowed) {
    return { authorized: false, request_digest: requestDigest, reason: 'patch_not_allowed' };
  }
  if (
    approval.evidence_digest !== request.evidence_digest ||
    current.evidence_digest !== request.evidence_digest
  ) {
    return { authorized: false, request_digest: requestDigest, reason: 'stale_evidence' };
  }
  return { authorized: true, request_digest: requestDigest };
}

/**
 * Validates append-only ordering and immutable identity across an action journal.
 * An execution without a successful authorization check is rejected.
 */
export function assertValidActionJournal(
  events: ActionJournalEvent[],
  request: ActionRequest
): void {
  const requestDigest = actionRequestDigest(request);
  const effectDigest = actionEffectDigest(request);
  let proposed = false;
  let displayed = false;
  let approvalDecision: 'approved' | 'denied' | undefined;
  let approvalId: string | undefined;
  let authorizationChecked = false;
  let authorized = false;
  let executed = false;
  let postconditionChecked = false;
  let collateralChecked = false;
  let rolledBack = false;

  events.forEach((event, index) => {
    assertValid(loadSchema('action-journal-event'), event, `action journal event ${index + 1}`);
    if (event.sequence !== index + 1) {
      throw new Error(`action journal sequence must be contiguous at event ${index + 1}`);
    }
    if (
      event.trial_id !== request.trial_id ||
      event.action_id !== request.action_id ||
      event.request_digest !== requestDigest
    ) {
      throw new Error('action journal identity changed after proposal');
    }
    if (rolledBack) throw new Error('action journal cannot append events after rollback');

    const requireApprovalId = () => {
      if (!event.approval_id || event.approval_id !== approvalId) {
        throw new Error(`${event.type} must retain the approval_id`);
      }
    };

    switch (event.type) {
      case 'action_proposed':
        if (proposed || index !== 0 || event.status !== 'pending') {
          throw new Error('action_proposed must be the first pending event');
        }
        proposed = true;
        break;
      case 'action_displayed':
        if (!proposed || displayed || approvalDecision || event.status !== 'pending') {
          throw new Error('action_displayed must follow one proposal');
        }
        displayed = true;
        break;
      case 'approval_decided':
        if (
          !displayed ||
          approvalDecision ||
          !event.approval_id ||
          !['approved', 'denied'].includes(event.status)
        ) {
          throw new Error('approval_decided must follow display with one decision');
        }
        approvalDecision = event.status as 'approved' | 'denied';
        approvalId = event.approval_id;
        break;
      case 'authorization_checked':
        if (
          !approvalDecision ||
          authorizationChecked ||
          !['approved', 'denied', 'stale'].includes(event.status)
        ) {
          throw new Error('authorization_checked must follow one approval decision');
        }
        requireApprovalId();
        if (approvalDecision === 'denied' && event.status !== 'denied') {
          throw new Error('denied approval cannot produce approved authorization');
        }
        authorizationChecked = true;
        authorized = event.status === 'approved';
        break;
      case 'action_executed':
        requireApprovalId();
        if (event.status === 'success' && !event.result_digest) {
          throw new Error('successful action execution requires result_digest');
        }
        if (event.effect_digest !== effectDigest) {
          throw new Error(
            `action journal event ${event.sequence} effect digest does not match the canonical action request`
          );
        }
        if (!authorized || executed || !['success', 'failed'].includes(event.status)) {
          throw new Error('action execution requires one approved authorization');
        }
        executed = true;
        break;
      case 'postcondition_checked':
        requireApprovalId();
        if (!executed || postconditionChecked || !['success', 'failed'].includes(event.status)) {
          throw new Error('postcondition_checked requires one preceding action execution');
        }
        postconditionChecked = true;
        break;
      case 'collateral_checked':
        requireApprovalId();
        if (!executed || collateralChecked || !['success', 'failed'].includes(event.status)) {
          throw new Error('collateral_checked requires one preceding action execution');
        }
        collateralChecked = true;
        break;
      case 'rollback_executed':
        requireApprovalId();
        if (!executed || !['success', 'failed'].includes(event.status)) {
          throw new Error('rollback_executed requires a preceding action execution');
        }
        rolledBack = true;
        break;
    }
  });
}

/** Rejects the same target/operation/patch effect across separate action journals in one trial. */
export function assertNoDuplicateActionEffects(
  journals: Array<{ request: ActionRequest; events: ActionJournalEvent[] }>
): void {
  const effects = new Set<string>();
  for (const journal of journals) {
    assertValidActionJournal(journal.events, journal.request);
    for (const event of journal.events) {
      if (event.type !== 'action_executed') continue;
      if (!event.effect_digest) throw new Error('action execution is missing effect_digest');
      if (effects.has(event.effect_digest)) {
        throw new Error(`duplicate action effect in trial: ${event.effect_digest}`);
      }
      effects.add(event.effect_digest);
    }
  }
}
