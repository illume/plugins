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
 * Offline golden projection for OpenTelemetry GenAI semantic conventions.
 * Run/attempt becomes a root span; canonical eval fields become namespaced
 * `headlamp.eval.*` attributes since GenAI conventions do not encode
 * Headlamp's eligibility/lifecycle/safety semantics.
 *
 * The projection is an offline compatibility proof, not telemetry export.
 * Deterministic trace/span IDs make repeated inspection stable, while
 * `unsupported_fields` and `dropped_fields` expose information that OTLP
 * cannot represent instead of allowing silent loss.
 */

import type { TrialResult } from '../contracts/evaluationContracts.js';
import { createHash } from 'node:crypto';

/** Version of the canonical-to-OTLP field mapping. */
export const OTLP_MAPPING_VERSION = '2.0.0';
/** OpenTelemetry GenAI semantic-convention version targeted by the projection. */
export const GENAI_SEMCONV_VERSION = '1.29.0';

/** A canonical trial projected into an OpenTelemetry span. */
export interface OtlpSpan {
  /** Deterministic trace identifier derived from run and trial identity. */
  trace_id: string;
  /** Deterministic span identifier derived from trial identity. */
  span_id: string;
  /** Human-readable trial span name. */
  name: string;
  /** Span start time in Unix nanoseconds. */
  start_time_unix_nano: string;
  /** Span end time in Unix nanoseconds. */
  end_time_unix_nano: string;
  /** GenAI and Headlamp evaluation attributes retained by the projection. */
  attributes: Record<string, string | number | boolean>;
}

/** Complete offline OTLP projection with explicit mapping losses. */
export interface OtlpProjection {
  /** Version of the canonical-to-OTLP mapping. */
  mapping_version: string;
  /** GenAI semantic-convention version used by the projection. */
  semconv_version: string;
  /** Resource metadata and trial spans emitted by the projection. */
  resource_spans: Array<{ resource: { attributes: Record<string, string> }; spans: OtlpSpan[] }>;
  /** Canonical data unsupported by the destination schema. */
  unsupported_fields: string[];
  /** Canonical data intentionally omitted from this projection. */
  dropped_fields: string[];
}

/**
 * Deterministically maps trial results to an OTLP resource and span shape.
 *
 * @param trials - Canonical trial results to project.
 * @returns An offline OTLP projection with declared field losses.
 */
export function projectToOtlp(trials: TrialResult[]): OtlpProjection {
  const spans: OtlpSpan[] = trials.map(t => {
    const startNs = BigInt(Date.parse(t.timing.diagnosis_started_at ?? t.recorded_at)) * 1_000_000n;
    const durationNs = BigInt(t.timing.time_to_diagnosis_ns ?? '0');
    return {
      trace_id: createHash('sha256').update(`${t.run_id}:${t.trial_id}`).digest('hex').slice(0, 32),
      span_id: createHash('sha256').update(t.trial_id).digest('hex').slice(0, 16),
      name: `headlamp.eval.trial ${t.scenario_id}`,
      start_time_unix_nano: startNs.toString(),
      end_time_unix_nano: (startNs + durationNs).toString(),
      attributes: {
        'gen_ai.system': 'headlamp-ai',
        ...(t.model_usage === null
          ? {}
          : {
              'gen_ai.usage.input_tokens': t.model_usage.input_tokens,
              'gen_ai.usage.output_tokens': t.model_usage.output_tokens,
              ...(t.model_usage.cache_read_input_tokens === undefined
                ? {}
                : {
                    'headlamp.eval.model.cache_read_input_tokens':
                      t.model_usage.cache_read_input_tokens,
                  }),
              ...(t.model_usage.cache_creation_input_tokens === undefined
                ? {}
                : {
                    'headlamp.eval.model.cache_creation_input_tokens':
                      t.model_usage.cache_creation_input_tokens,
                  }),
            }),
        ...(t.configured_usage_estimate === null
          ? {}
          : {
              'headlamp.eval.configured_usage.amount': t.configured_usage_estimate.amount,
              'headlamp.eval.configured_usage.unit': t.configured_usage_estimate.unit,
              'headlamp.eval.configured_usage.basis': t.configured_usage_estimate.basis,
              'headlamp.eval.configured_usage.pricing_source':
                t.configured_usage_estimate.pricing_source,
              ...(t.configured_usage_estimate.provider
                ? { 'gen_ai.provider.name': t.configured_usage_estimate.provider }
                : {}),
              ...(t.configured_usage_estimate.model
                ? { 'gen_ai.response.model': t.configured_usage_estimate.model }
                : {}),
              ...(t.configured_usage_estimate.service_tier
                ? { 'gen_ai.response.service_tier': t.configured_usage_estimate.service_tier }
                : {}),
            }),
        'headlamp.eval.run_id': t.run_id,
        'headlamp.eval.scenario_id': t.scenario_id,
        'headlamp.eval.candidate_id': t.candidate_id,
        'headlamp.eval.run_eligibility': t.run_eligibility,
        'headlamp.eval.safety_outcome': t.safety_outcome,
        'headlamp.eval.root_cause.outcome': t.dimensions.root_cause.outcome,
        'headlamp.eval.recommended_fix.outcome': t.dimensions.recommended_fix.outcome,
        'headlamp.eval.tool_calls.attempted': t.tool_summary.attempted,
        'headlamp.eval.tool_calls.failed': t.tool_summary.failed,
      },
    };
  });

  return {
    mapping_version: OTLP_MAPPING_VERSION,
    semconv_version: GENAI_SEMCONV_VERSION,
    resource_spans: [{ resource: { attributes: { 'service.name': 'headlamp-ai-evals' } }, spans }],
    unsupported_fields: ['provider-reported billing cost (not exposed by Phase 1 providers)'],
    dropped_fields: ['individual tool events (canonical bundle remains authoritative)'],
  };
}
