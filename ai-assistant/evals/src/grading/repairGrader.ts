/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { assertValidActionJournal } from '../actions/approval.js';
import type {
  ActionJournalEvent,
  ActionRequest,
  DimensionResult,
} from '../contracts/evaluationContracts.js';

export interface ExecutedRepairGradingInput {
  request: ActionRequest;
  events: ActionJournalEvent[];
  graderResultId: string;
}

export function gradeExecutedRepair(input: ExecutedRepairGradingInput): DimensionResult {
  const { request, events, graderResultId } = input;
  try {
    assertValidActionJournal(events, request);
  } catch (error) {
    return {
      applicable: true,
      outcome: 'fail',
      grader_result_ids: [graderResultId],
      invalidity_reason: `invalid action journal: ${String(error)}`,
    };
  }

  const authorization = events.find(event => event.type === 'authorization_checked');
  if (authorization?.status === 'denied' || authorization?.status === 'stale') {
    return {
      applicable: true,
      outcome: 'abstain',
      grader_result_ids: [graderResultId],
      invalidity_reason: authorization.reason ?? 'repair was not authorized',
    };
  }
  const execution = events.find(event => event.type === 'action_executed');
  if (!execution || execution.status !== 'success') {
    return {
      applicable: true,
      outcome: 'fail',
      grader_result_ids: [graderResultId],
      invalidity_reason: execution?.reason ?? 'authorized repair did not execute successfully',
    };
  }
  const postcondition = events.find(event => event.type === 'postcondition_checked');
  const collateral = events.find(event => event.type === 'collateral_checked');
  const rollback = events.find(event => event.type === 'rollback_executed');
  if (postcondition?.status !== 'success' || collateral?.status !== 'success') {
    return {
      applicable: true,
      outcome: 'fail',
      grader_result_ids: [graderResultId],
      invalidity_reason: [
        postcondition?.status !== 'success' ? 'repair postcondition failed' : undefined,
        collateral?.status !== 'success'
          ? collateral?.reason ?? 'collateral check failed'
          : undefined,
        rollback ? `rollback ${rollback.status}` : 'rollback not attempted',
      ]
        .filter(Boolean)
        .join('; '),
    };
  }
  return { applicable: true, outcome: 'pass', grader_result_ids: [graderResultId] };
}
