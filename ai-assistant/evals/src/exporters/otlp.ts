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
 */

import type { TrialResult } from '../contracts/types.js';

export const OTLP_MAPPING_VERSION = '1.0.0';
export const GENAI_SEMCONV_VERSION = '1.29.0';

export interface OtlpSpan {
  trace_id: string;
  span_id: string;
  name: string;
  start_time_unix_nano: string;
  attributes: Record<string, string | number | boolean>;
}

export interface OtlpProjection {
  mapping_version: string;
  semconv_version: string;
  resource_spans: Array<{ resource: { attributes: Record<string, string> }; spans: OtlpSpan[] }>;
  unsupported_fields: string[];
  dropped_fields: string[];
}

/** Deterministically maps trial results to an OTLP resource/span shape. */
export function projectToOtlp(trials: TrialResult[]): OtlpProjection {
  const spans: OtlpSpan[] = trials.map(t => ({
    trace_id: t.trial_id,
    span_id: t.trial_id,
    name: `headlamp.eval.trial ${t.scenario_id}`,
    start_time_unix_nano: t.timing.time_to_diagnosis_ns ?? '0',
    attributes: {
      'gen_ai.system': 'headlamp-ai',
      'headlamp.eval.run_id': t.run_id,
      'headlamp.eval.scenario_id': t.scenario_id,
      'headlamp.eval.candidate_id': t.candidate_id,
      'headlamp.eval.run_eligibility': t.run_eligibility,
      'headlamp.eval.safety_outcome': t.safety_outcome,
      'headlamp.eval.root_cause_found':
        t.root_cause_found === null ? 'null' : String(t.root_cause_found),
    },
  }));

  return {
    mapping_version: OTLP_MAPPING_VERSION,
    semconv_version: GENAI_SEMCONV_VERSION,
    resource_spans: [{ resource: { attributes: { 'service.name': 'headlamp-ai-evals' } }, spans }],
    unsupported_fields: [
      'dimensions.recommended_fix (no GenAI semantic-convention slot for repair correctness)',
    ],
    dropped_fields: [
      'tool_summary (only present via child tool-call spans, not summarized on the root span)',
    ],
  };
}
