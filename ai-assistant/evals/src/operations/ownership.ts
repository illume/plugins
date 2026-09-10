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

import type { ScenarioManifest } from '../contracts/evaluationContracts.js';
import type { LoadedScenario } from '../scenarios/loader.js';

/** Report-ready ownership, provenance, review, and quarantine metadata. */
export interface OwnershipRow {
  /** Stable identifier of the scenario. */
  scenario_id: string;
  /** Team or individual responsible for the scenario. */
  owner: string;
  /** Origin from which the scenario was admitted. */
  source: string;
  /** License governing the scenario source. */
  license: string;
  /** Date when the scenario entered the evaluation set. */
  admission_date: string;
  /** Date of the scenario's most recent review. */
  last_review: string;
  /** Date by which the scenario must be reviewed again. */
  review_due: string;
  /** Current maintenance lifecycle state. */
  lifecycle_state: string;
  /** Whether the review due date has passed. */
  review_overdue: boolean;
  /** Whether the scenario is currently quarantined. */
  quarantined: boolean;
  /** Reason the scenario was quarantined, when applicable. */
  quarantine_reason?: string;
  /** Time when the quarantine expires, when bounded. */
  quarantine_expires_at?: string;
}

/**
 * Builds the ownership, provenance, and quarantine row for a loaded scenario.
 *
 * @param scenario - Loaded scenario whose provenance is reported.
 * @param now - Time used to determine whether review is overdue.
 * @returns Report-ready ownership metadata for the scenario.
 */
export function ownershipRow(scenario: LoadedScenario, now: Date = new Date()): OwnershipRow {
  return ownershipRowFromManifest(scenario.manifest, now);
}

/**
 * Builds ownership metadata from an archived scenario manifest.
 *
 * @param manifest - Validated scenario manifest whose provenance is reported.
 * @param now - Time used to determine whether review is overdue.
 * @returns Report-ready ownership metadata for the scenario.
 */
export function ownershipRowFromManifest(
  manifest: ScenarioManifest,
  now: Date = new Date()
): OwnershipRow {
  const provenance = manifest.provenance;
  const reviewDue = new Date(provenance.review_due);
  const quarantine = provenance.quarantine;
  return {
    scenario_id: manifest.scenario_id,
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

/**
 * Determines whether a scenario is active and eligible to run.
 *
 * @param scenario - Loaded scenario to evaluate.
 * @returns `true` when the scenario lifecycle state is active.
 */
export function isEligibleToRun(scenario: LoadedScenario): boolean {
  return scenario.manifest.provenance.lifecycle_state === 'active';
}
