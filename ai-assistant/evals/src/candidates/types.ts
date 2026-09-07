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

import type { CandidatePacket } from '../contracts/types.js';

/** One fact the harness actually retrieved during setup/preflight, with its evidence ID. */
export interface RetrievedObservation {
  evidence_id: string;
  resource_ref: string;
  field_path: string;
  value: string;
}

export interface CandidateInvocationInput {
  packet: CandidatePacket;
  observations: RetrievedObservation[];
}

export interface CandidateInvocationResult {
  /** Natural-language prose, retained as a diagnostic artifact but never scored (Phase 1–2). */
  raw_text: string;
  /** Raw text the candidate emitted for its structured sidecar, or null if none was produced. */
  submission_text: string | null;
  status: 'ok' | 'unavailable' | 'timeout';
  duration_ns: string;
}

export interface CandidateAdapter {
  readonly id: string;
  readonly kind: 'scripted' | 'headlamp-cli';
  invoke(input: CandidateInvocationInput): Promise<CandidateInvocationResult>;
}
