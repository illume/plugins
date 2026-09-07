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
import { isEligibleToRun, ownershipRow } from './ownership.js';
import { loadScenario } from '../scenarios/loader.js';

test('ownershipRow: surfaces owner/source/license/lifecycle metadata from the scenario manifest', () => {
  const scenario = loadScenario('core-service-selector-fault-v1');
  const row = ownershipRow(scenario, new Date('2025-01-10'));
  assert.equal(row.owner, 'ai-assistant-evals-team');
  assert.equal(row.source, 'synthetic');
  assert.equal(row.lifecycle_state, 'active');
  assert.equal(row.quarantined, false);
});

test('ownershipRow: review_overdue is true once "now" passes review_due', () => {
  const scenario = loadScenario('core-service-selector-fault-v1');
  const notOverdue = ownershipRow(scenario, new Date('2025-02-01'));
  const overdue = ownershipRow(scenario, new Date('2026-01-01'));
  assert.equal(notOverdue.review_overdue, false);
  assert.equal(overdue.review_overdue, true);
});

test('isEligibleToRun: true for an active scenario', () => {
  const scenario = loadScenario('core-service-selector-fault-v1');
  assert.equal(isEligibleToRun(scenario), true);
});

test('isEligibleToRun: false for a scenario manually marked quarantined', () => {
  const scenario = loadScenario('core-service-selector-fault-v1');
  const quarantined = {
    ...scenario,
    manifest: {
      ...scenario.manifest,
      provenance: { ...scenario.manifest.provenance, lifecycle_state: 'quarantined' as const },
    },
  };
  assert.equal(isEligibleToRun(quarantined), false);
});
