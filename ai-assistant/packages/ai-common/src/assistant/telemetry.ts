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

/** Sanitized runtime events exposed to trusted CLI callers. */
export type AssistantTelemetryEvent =
  | {
      /** Marks a fully handled user turn after all model and tool events were emitted. */
      type: 'turn_complete';
    }
  | {
      type: 'model_usage';
      provider: string;
      input_token_semantics: 'total_including_cache' | 'uncached_only';
      model?: string;
      service_tier?: string;
      inference_geo?: string;
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_write_input_tokens?: number;
      cache_write_5m_input_tokens?: number;
      cache_write_1h_input_tokens?: number;
      reasoning_output_tokens?: number;
    }
  | {
      type: 'tool_call';
      tool_name: string;
      mutating: boolean;
      status: 'success' | 'error' | 'denied';
      duration_ns: string;
    };

/** Optional observer invoked synchronously after sanitized runtime events. */
export type AssistantTelemetryObserver = (event: AssistantTelemetryEvent) => void;
