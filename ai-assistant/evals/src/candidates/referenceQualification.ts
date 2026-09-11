import { canonicalStringify, type JsonValue } from '../canonicalJson.js';
import type { CandidateInvocationInput, CandidateInvocationResult } from './candidateAdapter.js';

export type ReferenceSystemId = 'holmesgpt' | 'k8sgpt';
export type QualificationCheckStatus = 'not_run' | 'passed' | 'failed';

export interface ReferenceAdapterQualificationStages {
  startup: QualificationCheckStatus;
  health: QualificationCheckStatus;
  fixed_submission_parity: QualificationCheckStatus;
  cleanup: QualificationCheckStatus;
}

export interface ReferenceAdapterEligibilityDisposition {
  system: ReferenceSystemId;
  status: 'eligible' | 'ineligible';
  stages: ReferenceAdapterQualificationStages;
  reasons: string[];
}

/** Qualification-only lifecycle implemented by each pinned external reference adapter. */
export interface ReferenceAdapterQualificationTarget {
  readonly system: ReferenceSystemId;
  startup(): Promise<void>;
  health(): Promise<boolean>;
  invokeFixedSubmission(
    input: CandidateInvocationInput,
    fixedSubmission: string
  ): Promise<CandidateInvocationResult>;
  cleanup(): Promise<void>;
}

function parseSubmission(text: string | null): JsonValue {
  if (text === null) throw new Error('adapter returned no structured submission');
  const parsed = JSON.parse(text) as JsonValue;
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('adapter submission must be a JSON object');
  }
  return parsed;
}

function parityFailure(
  expectedSubmission: string,
  result: CandidateInvocationResult
): string | undefined {
  if (result.status !== 'ok') return `adapter invocation status was ${result.status}`;
  if (result.tool_events?.some(event => event.mutating)) {
    return 'fixed-submission qualification attempted a mutating tool call';
  }
  try {
    const expected = canonicalStringify(parseSubmission(expectedSubmission));
    const actual = canonicalStringify(parseSubmission(result.submission_text));
    if (actual !== expected) return 'adapter changed the fixed structured submission';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

/**
 * Qualifies one external adapter without scoring model behavior. Cleanup is
 * attempted after every startup outcome, and any failed control is ineligible.
 */
export async function qualifyReferenceAdapter(
  target: ReferenceAdapterQualificationTarget,
  input: CandidateInvocationInput,
  fixedSubmission: string
): Promise<ReferenceAdapterEligibilityDisposition> {
  const stages: ReferenceAdapterQualificationStages = {
    startup: 'not_run',
    health: 'not_run',
    fixed_submission_parity: 'not_run',
    cleanup: 'not_run',
  };
  const reasons: string[] = [];

  try {
    await target.startup();
    stages.startup = 'passed';

    if (!(await target.health())) {
      stages.health = 'failed';
      reasons.push('health check did not report ready');
    } else {
      stages.health = 'passed';
      const result = await target.invokeFixedSubmission(input, fixedSubmission);
      const failure = parityFailure(fixedSubmission, result);
      if (failure) {
        stages.fixed_submission_parity = 'failed';
        reasons.push(failure);
      } else {
        stages.fixed_submission_parity = 'passed';
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedStage =
      stages.startup === 'not_run'
        ? 'startup'
        : stages.health === 'not_run'
        ? 'health'
        : 'fixed_submission_parity';
    stages[failedStage] = 'failed';
    reasons.push(`${failedStage}: ${message}`);
  } finally {
    try {
      await target.cleanup();
      stages.cleanup = 'passed';
    } catch (error) {
      stages.cleanup = 'failed';
      reasons.push(`cleanup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const eligible = Object.values(stages).every(status => status === 'passed');
  return {
    system: target.system,
    status: eligible ? 'eligible' : 'ineligible',
    stages,
    reasons,
  };
}
