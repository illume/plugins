/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { sha256OfJson, type JsonValue } from '../canonicalJson.js';
import type { ClusterAdapter } from '../cluster/clusterAdapter.js';
import type {
  AcceptedAction,
  ActionApproval,
  ActionJournalEvent,
  ActionRequest,
  CandidateActionPolicy,
} from '../contracts/evaluationContracts.js';
import { eventId, recordId } from '../ids.js';
import {
  actionEffectDigest,
  actionRequestDigest,
  assertValidActionJournal,
  authorizeAction,
  createActionApproval,
} from './approval.js';

export interface RepairObservation {
  resource_ref: string;
  field_path: string;
  value: string;
}

export interface RepairApprovalDecision {
  decision: ActionApproval['decision'];
  reason?: string;
}

export interface ExecuteRepairInput {
  request: ActionRequest;
  policy: CandidateActionPolicy;
  acceptedAction: AcceptedAction;
  clusterAdapter: ClusterAdapter;
  beforeObservations: RepairObservation[];
  currentEvidenceDigest(): Promise<string>;
  observeAfter(): Promise<RepairObservation[]>;
  requestApproval(request: ActionRequest): Promise<RepairApprovalDecision>;
}

export interface RepairExecutionResult {
  request: ActionRequest;
  approval: ActionApproval;
  events: ActionJournalEvent[];
  afterObservations?: RepairObservation[];
  changedPaths: string[];
}

function event(
  request: ActionRequest,
  events: ActionJournalEvent[],
  values: Omit<
    ActionJournalEvent,
    | 'schema_version'
    | 'event_id'
    | 'trial_id'
    | 'action_id'
    | 'sequence'
    | 'recorded_at'
    | 'request_digest'
  >
): ActionJournalEvent {
  const journalEvent = {
    schema_version: '1.0.0',
    event_id: eventId(),
    trial_id: request.trial_id,
    action_id: request.action_id,
    sequence: events.length + 1,
    recorded_at: new Date().toISOString(),
    request_digest: actionRequestDigest(request),
    ...values,
  };
  return Object.fromEntries(
    Object.entries(journalEvent).filter(([, value]) => value !== undefined)
  ) as unknown as ActionJournalEvent;
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function changedJsonPaths(before: JsonValue, after: JsonValue, prefix = ''): string[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (
    before === null ||
    after === null ||
    typeof before !== 'object' ||
    typeof after !== 'object' ||
    Array.isArray(before) !== Array.isArray(after)
  ) {
    return [prefix || '/'];
  }
  const beforeObject = before as Record<string, JsonValue>;
  const afterObject = after as Record<string, JsonValue>;
  return [...new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])].flatMap(key =>
    changedJsonPaths(
      beforeObject[key] ?? null,
      afterObject[key] ?? null,
      `${prefix}/${escapePointer(key)}`
    )
  );
}

function observationPath(observation: RepairObservation): string {
  return `/${observation.resource_ref}/${observation.field_path.replaceAll('.', '/')}`;
}

function pathAllowed(path: string, allowedPaths: string[]): boolean {
  return allowedPaths.some(allowed => path === allowed || path.startsWith(`${allowed}/`));
}

function postconditionMatches(
  expected: NonNullable<AcceptedAction['postconditions']>[number],
  actual: RepairObservation
): boolean {
  if (actual.resource_ref !== expected.resource_ref) return false;
  if (actual.field_path === expected.field_path) return actual.value === expected.observed_value;
  if (`${actual.field_path}.count` !== expected.field_path) return false;
  try {
    const value = JSON.parse(actual.value) as unknown;
    return Array.isArray(value) && String(value.length) === expected.observed_value;
  } catch {
    return false;
  }
}

function meaningfulTargetChanges(
  request: ActionRequest,
  before: JsonValue,
  after: JsonValue
): string[] {
  const ignored = ['/metadata/resourceVersion', '/metadata/generation', '/metadata/managedFields'];
  return changedJsonPaths(before, after)
    .filter(path => !pathAllowed(path, ignored))
    .map(path => `/${request.target.kind.toLowerCase()}/${request.target.name}${path}`);
}

function changedObservationPaths(
  request: ActionRequest,
  before: RepairObservation[],
  after: RepairObservation[]
): string[] {
  const targetRef = `${request.target.kind.toLowerCase()}/${request.target.name}`;
  const beforeByPath = new Map(before.map(item => [observationPath(item), item.value]));
  return after
    .filter(item => item.resource_ref !== targetRef)
    .filter(item => beforeByPath.get(observationPath(item)) !== item.value)
    .map(observationPath);
}

export async function executeRepair(input: ExecuteRepairInput): Promise<RepairExecutionResult> {
  const { request, acceptedAction, clusterAdapter } = input;
  const events: ActionJournalEvent[] = [];
  events.push(event(request, events, { type: 'action_proposed', status: 'pending' }));
  events.push(event(request, events, { type: 'action_displayed', status: 'pending' }));

  const decision = await input.requestApproval(request);
  const approval = createActionApproval(request, {
    approvalId: recordId(),
    decision: decision.decision,
    decidedAt: new Date().toISOString(),
    reason: decision.reason,
  });
  events.push(
    event(request, events, {
      type: 'approval_decided',
      status: approval.decision,
      approval_id: approval.approval_id,
      reason: approval.reason,
    })
  );

  const currentTarget = await clusterAdapter.getResourceIdentity(
    request.target.namespace,
    `${request.target.kind.toLowerCase()}/${request.target.name}`
  );
  const currentEvidenceDigest = await input.currentEvidenceDigest();
  const authorization = authorizeAction(request, approval, input.policy, {
    candidate_id: request.candidate_id,
    cluster_identity_digest: request.cluster_identity_digest,
    evidence_digest: currentEvidenceDigest,
    trial_namespace: request.target.namespace,
    target: currentTarget ?? request.target,
  });
  events.push(
    event(request, events, {
      type: 'authorization_checked',
      status: authorization.authorized
        ? 'approved'
        : authorization.reason === 'stale_evidence'
        ? 'stale'
        : 'denied',
      approval_id: approval.approval_id,
      reason: authorization.authorized ? undefined : authorization.reason,
    })
  );
  if (!authorization.authorized) {
    assertValidActionJournal(events, request);
    return { request, approval, events, changedPaths: [] };
  }

  const beforeSnapshot = await clusterAdapter.getResourceSnapshot(request.target);
  if (!beforeSnapshot) throw new Error('authorized repair target disappeared before execution');
  let afterSnapshot: JsonValue;
  try {
    afterSnapshot = await clusterAdapter.applyJsonPatch(request.target, request.patch);
    events.push(
      event(request, events, {
        type: 'action_executed',
        status: 'success',
        approval_id: approval.approval_id,
        effect_digest: actionEffectDigest(request),
        result_digest: sha256OfJson(afterSnapshot),
      })
    );
  } catch (error) {
    events.push(
      event(request, events, {
        type: 'action_executed',
        status: 'failed',
        approval_id: approval.approval_id,
        effect_digest: actionEffectDigest(request),
        reason: String(error),
      })
    );
    assertValidActionJournal(events, request);
    return { request, approval, events, changedPaths: [] };
  }

  const afterObservations = await input.observeAfter();
  const postconditionsPass = (acceptedAction.postconditions ?? []).every(expected =>
    afterObservations.some(actual => postconditionMatches(expected, actual))
  );
  events.push(
    event(request, events, {
      type: 'postcondition_checked',
      status: postconditionsPass ? 'success' : 'failed',
      approval_id: approval.approval_id,
      result_digest: sha256OfJson(afterObservations as unknown as JsonValue),
    })
  );

  const changedPaths = [
    ...meaningfulTargetChanges(request, beforeSnapshot, afterSnapshot),
    ...changedObservationPaths(request, input.beforeObservations, afterObservations),
  ].sort();
  const collateralPass = changedPaths.every(path =>
    pathAllowed(path, acceptedAction.allowed_diff_paths ?? [])
  );
  events.push(
    event(request, events, {
      type: 'collateral_checked',
      status: collateralPass ? 'success' : 'failed',
      approval_id: approval.approval_id,
      result_digest: sha256OfJson(changedPaths),
      reason: collateralPass ? undefined : `unexpected changes: ${changedPaths.join(', ')}`,
    })
  );

  if ((!postconditionsPass || !collateralPass) && acceptedAction.rollback_patch) {
    try {
      const rollbackResult = await clusterAdapter.applyJsonPatch(
        request.target,
        acceptedAction.rollback_patch
      );
      events.push(
        event(request, events, {
          type: 'rollback_executed',
          status: 'success',
          approval_id: approval.approval_id,
          result_digest: sha256OfJson(rollbackResult),
        })
      );
    } catch (error) {
      events.push(
        event(request, events, {
          type: 'rollback_executed',
          status: 'failed',
          approval_id: approval.approval_id,
          reason: String(error),
        })
      );
    }
  }

  assertValidActionJournal(events, request);
  return { request, approval, events, afterObservations, changedPaths };
}
