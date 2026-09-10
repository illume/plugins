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
import type { ActionRequest, CandidatePacket } from '../contracts/evaluationContracts.js';

/** Candidate implementation families supported by the shared trial pipeline. */
export type CandidateKind = 'scripted' | 'headlamp-cli' | 'reference-system';

export type UsageRateCategory =
  | 'uncached_input_tokens'
  | 'cache_read_input_tokens'
  | 'cache_write_input_tokens'
  | 'cache_write_5m_input_tokens'
  | 'cache_write_1h_input_tokens'
  | 'output_tokens'
  | 'requests';

/** One configured rate in an operator-supplied pricing snapshot. */
export interface ConfiguredUsageRate {
  category: UsageRateCategory;
  amount: string;
  per: number;
}

/** Reproducible usage-price snapshot supplied by the evaluation operator. */
export interface TokenPricingSnapshot {
  /** Accounting unit such as `USD` or `github_ai_credit`. */
  unit?: string;
  /** Legacy shorthand accepted for existing USD CLI flags. */
  currency?: 'USD';
  source: string;
  effective_at?: string;
  provider?: string;
  model?: string;
  service_tier?: string;
  billing_mode?: string;
  rates?: ConfiguredUsageRate[];
  input_per_million?: string;
  output_per_million?: string;
  cache_read_input_per_million?: string;
  cache_creation_input_per_million?: string;
}

/** One auditable component of a configured usage estimate. */
export interface ConfiguredUsageLineItem {
  category: UsageRateCategory;
  quantity: number;
  rate: string;
  rate_denominator: number;
  amount: string;
}

/** Estimate derived from observed usage and a retained operator configuration. */
export interface ConfiguredUsageEstimate {
  amount: string;
  unit: string;
  basis: 'configured_usage_pricing';
  pricing_source: string;
  pricing_effective_at?: string;
  provider?: string;
  model?: string;
  service_tier?: string;
  billing_mode?: string;
  line_items: ConfiguredUsageLineItem[];
}

/** Non-secret candidate configuration frozen into trial and run manifests. */
export interface CandidateIdentity extends Record<string, JsonValue> {
  candidate_id: string;
  kind: CandidateKind;
  configuration_digest: string;
}

/**
 * Boundary between the evaluation harness and the system being evaluated.
 *
 * Inputs contain only the candidate packet, observations the harness actually
 * retrieved, and ephemeral connection data. Grader-only `EvaluatorPacket`
 * truth is intentionally absent, which makes this type part of the answer-leak
 * boundary rather than a convenience DTO. Implementations normalize a real
 * subprocess or a deterministic harness control into the same result shape so
 * the trial state machine does not need candidate-specific branches.
 */

/** One fact the harness actually retrieved during setup/preflight, with its evidence ID. */
export interface RetrievedObservation {
  /** Stable identifier for the retained evidence record. */
  evidence_id: string;
  /** Kubernetes resource identity that was observed. */
  resource_ref: string;
  /** Field within the resource that supplied the value. */
  field_path: string;
  /** String representation exposed to the candidate. */
  value: string;
}

/**
 * Complete information the harness is allowed to reveal for one invocation.
 *
 * @example An invocation with one recorded selector observation and an
 * ephemeral, namespace-restricted kubeconfig:
 * ```ts
 * const input = {
 *   packet: candidatePacket,
 *   observations: [
 *     {
 *       evidence_id: 'event_selector',
 *       resource_ref: 'service/web',
 *       field_path: 'spec.selector',
 *       value: '{"app":"web","tier":"frontend"}',
 *     },
 *   ],
 *   evidence_digest: '4b8c...64 lowercase hexadecimal characters...',
 *   environment: { KUBECONFIG: '/tmp/headlamp-eval-candidate/kubeconfig' },
 * } satisfies CandidateInvocationInput;
 * ```
 */
export interface CandidateInvocationInput {
  /** Scenario instructions and permitted context. */
  packet: CandidatePacket;
  /** Facts retrieved by the harness before invocation. */
  observations: RetrievedObservation[];
  /** Canonical digest of the complete retrieved observation array. */
  evidence_digest: string;
  /** Live identities for the exact policy targets available to a repair proposal. */
  action_targets?: ActionRequest['target'][];
  /** Ephemeral values such as a restricted kubeconfig path; never retained. */
  environment?: Record<string, string>;
}

/**
 * Candidate output normalized for persistence and deterministic grading.
 * Natural-language prose is retained for diagnosis, but only the structured
 * sidecar is task-scored. Harness completion status is separate from grading:
 * an unavailable or timed-out candidate still produces an auditable trial.
 *
 * @example A successful adapter result whose sidecar is ready for parsing:
 * ```ts
 * const invocationResult = {
 *   raw_text: 'The Service selector does not match the running Pod labels.',
 *   submission_text: JSON.stringify(submission),
 *   status: 'ok',
 *   duration_ns: '5432100000',
 *   tool_events: [
 *     { tool_name: 'kubectl.get', mutating: false, status: 'success' },
 *   ],
 * } satisfies CandidateInvocationResult;
 * ```
 */
export interface CandidateInvocationResult {
  /** Natural-language prose, retained as a diagnostic artifact but never scored (Phase 1–2). */
  raw_text: string;
  /** Raw text the candidate emitted for its structured sidecar, or null if none was produced. */
  submission_text: string | null;
  /** Harness-level completion status for the candidate process. */
  status: 'ok' | 'unavailable' | 'timeout';
  /** End-to-end candidate latency in nanoseconds. */
  duration_ns: string;
  /** Aggregate model usage observed across every model call in the invocation. */
  token_usage?: {
    /** Normalized total input including cache reads and writes. */
    input_tokens: number;
    /** Normalized input not served from or written to a provider cache. */
    uncached_input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    request_count: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_write_input_tokens?: number;
    cache_write_5m_input_tokens?: number;
    cache_write_1h_input_tokens?: number;
    reasoning_output_tokens?: number;
  };
  /** Sanitized usage and resolved metadata retained for each observed model call. */
  model_invocations?: Array<{
    provider: string;
    input_token_semantics: 'total_including_cache' | 'uncached_only';
    model?: string;
    service_tier?: string;
    inference_geo?: string;
    input_tokens: number;
    uncached_input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_read_input_tokens?: number;
    cache_write_input_tokens?: number;
    cache_write_5m_input_tokens?: number;
    cache_write_1h_input_tokens?: number;
    reasoning_output_tokens?: number;
  }>;
  /** Configured usage estimate; absent when no explicit pricing snapshot was configured. */
  configured_usage_estimate?: ConfiguredUsageEstimate;
  /**
   * Candidate-attributed tool events. `undefined` means the adapter cannot
   * observe them, which keeps mutation safety unknown rather than passing.
   */
  tool_events?: Array<{
    /** Tool boundary invoked by the candidate. */
    tool_name: string;
    /** Whether the invocation could change cluster state. */
    mutating: boolean;
    /** Harness-observed completion state of the invocation. */
    status: 'success' | 'error' | 'denied';
    /** Sanitized tool execution time in nanoseconds. */
    duration_ns?: string;
  }>;
}

/**
 * Product or harness control that can attempt a candidate-visible packet.
 *
 * The runner knows candidates only through this interface. Production
 * adapters preserve the candidate/grader separation above; scripted adapters
 * are explicitly privileged controls that use evaluator truth when they are
 * constructed to prove the harness recognizes known-good and known-bad output.
 */
export interface CandidateAdapter {
  /** Stable candidate implementation identifier. */
  readonly id: string;
  /** Adapter category written into trial results. */
  readonly kind: CandidateKind;
  /** Resolved, non-secret candidate and product identity for this run. */
  readonly identity?: CandidateIdentity;
  /**
   * Runs the candidate against one scenario packet.
   *
   * @param input - Candidate-visible packet, observations, and ephemeral environment.
   * @returns The candidate output and harness-observed execution status.
   */
  invoke(input: CandidateInvocationInput): Promise<CandidateInvocationResult>;
}

/** Returns an adapter's frozen identity or a deterministic minimal fallback. */
export function candidateIdentityOf(adapter: CandidateAdapter): CandidateIdentity {
  return (
    adapter.identity ?? {
      candidate_id: adapter.id,
      kind: adapter.kind,
      configuration_digest: sha256OfJson({ candidate_id: adapter.id, kind: adapter.kind }),
    }
  );
}
