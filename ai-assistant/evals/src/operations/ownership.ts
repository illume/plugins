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

/**
 * Owner/provenance/review/quarantine metadata helpers, applied to loaded
 * scenarios. See "Case ownership, provenance, review, and quarantine" in the
 * best-practice coverage contract.
 */

import type { LoadedScenario } from '../scenarios/loader.js';

export interface OwnershipRow {
  scenario_id: string;
  owner: string;
  source: string;
  license: string;
  admission_date: string;
  last_review: string;
  review_due: string;
  lifecycle_state: string;
  review_overdue: boolean;
  quarantined: boolean;
  quarantine_reason?: string;
  quarantine_expires_at?: string;
}

/** Builds the ownership/provenance/quarantine report row for one loaded scenario. */
export function ownershipRow(scenario: LoadedScenario, now: Date = new Date()): OwnershipRow {
  const provenance = scenario.manifest.provenance;
  const reviewDue = new Date(provenance.review_due);
  const quarantine = provenance.quarantine;
  return {
    scenario_id: scenario.manifest.scenario_id,
    owner: provenance.owner,
    source: provenance.source,
    license: provenance.license,
    admission_date: provenance.admission_date,
    last_review: provenance.last_review,
    review_due: provenance.review_due,
    lifecycle_state: provenance.lifecycle_state,
    review_overdue: now.getTime() > reviewDue.getTime(),
    quarantined: provenance.lifecycle_state === 'quarantined',
    quarantine_reason: quarantine?.reason,
    quarantine_expires_at: quarantine?.expires_at,
  };
}

/** A scenario is eligible to run only when active (or draft, explicitly marked as such elsewhere). */
export function isEligibleToRun(scenario: LoadedScenario): boolean {
  return scenario.manifest.provenance.lifecycle_state === 'active';
}
