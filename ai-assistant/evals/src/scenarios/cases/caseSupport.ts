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

import type { ClusterAdapter } from '../../cluster/clusterAdapter.js';

/** One ordered cluster observation recorded in a trial trajectory. */
export interface ObservationStep {
  toolName: string;
  operation: string;
  targetResource: string;
  resourceRef: string;
  fieldPath: string;
  value: string;
  durationNs: bigint;
  evidenceValues?: Array<{
    resourceRef: string;
    fieldPath: string;
    value: string;
  }>;
}

/** Result of verifying that a scenario fixture reached its required state. */
export interface PreflightOutcome {
  ok: boolean;
  reason?: string;
}

/** Cluster-specific preflight and observation behavior for one scenario. */
export interface ScenarioCaseLogic {
  preflight(adapter: ClusterAdapter, namespace: string): Promise<PreflightOutcome>;
  observe(adapter: ClusterAdapter, namespace: string): Promise<ObservationStep[]>;
}

/** Measures one asynchronous observation with a monotonic clock. */
export async function measure<T>(operation: () => Promise<T>): Promise<[T, bigint]> {
  const start = process.hrtime.bigint();
  const value = await operation();
  return [value, process.hrtime.bigint() - start];
}

/** Polls real clusters for controller convergence; simulated adapters run once. */
export async function eventually<T>(
  adapter: ClusterAdapter,
  operation: () => Promise<T>,
  ready: (value: T) => boolean
): Promise<T> {
  const attempts = adapter.mode === 'real' ? 60 : 1;
  let value = await operation();
  for (let attempt = 1; attempt < attempts && !ready(value); attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    value = await operation();
  }
  return value;
}
