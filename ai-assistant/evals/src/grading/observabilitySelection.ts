import type { AcceptedFact, DiagnosisSubmission } from '../contracts/evaluationContracts.js';
import type { RootCauseGradingInput } from './diagnosisGrader.js';

export const OBSERVABILITY_SELECTION_LIMIT = 12;

export function gradeObservabilitySelection(
  submission: DiagnosisSubmission | null,
  observations: RootCauseGradingInput['retrievedObservations'],
  required: AcceptedFact[],
  maximumFacts = OBSERVABILITY_SELECTION_LIMIT
) {
  const selected = submission?.cause_facts ?? [];
  const identity = (fact: { resource_ref: string; field_path: string; observed_value: string }) =>
    JSON.stringify([fact.resource_ref, fact.field_path, fact.observed_value]);
  const selectedIds = new Set(selected.map(identity));
  const observedIds = new Set(
    observations.map(fact => identity({ ...fact, observed_value: fact.value }))
  );
  const citedIds = new Set(
    observations
      .filter(fact => submission?.evidence_refs.includes(fact.evidence_id))
      .map(fact => identity({ ...fact, observed_value: fact.value }))
  );
  const requiredIds = new Set(required.map(identity));
  const covered = [...requiredIds].filter(id => selectedIds.has(id)).length;
  const unsupported = [...selectedIds].filter(id => !citedIds.has(id)).length;
  const echoAll =
    observedIds.size > requiredIds.size &&
    observedIds.size > 0 &&
    [...observedIds].every(id => selectedIds.has(id));
  const withinBudget = selected.length <= maximumFacts;
  return {
    schema_version: 'observability_selection_controls@1.0.0',
    maximumFacts,
    selectedFacts: selected.length,
    duplicateFacts: selected.length - selectedIds.size,
    observedFacts: observedIds.size,
    requiredFacts: requiredIds.size,
    requiredFactsCovered: covered,
    requiredFactCoverage: requiredIds.size ? covered / requiredIds.size : null,
    unsupportedFacts: unsupported,
    echoAll,
    withinBudget,
    passesControls:
      submission !== null &&
      withinBudget &&
      !echoAll &&
      unsupported === 0 &&
      selected.length === selectedIds.size,
  };
}
