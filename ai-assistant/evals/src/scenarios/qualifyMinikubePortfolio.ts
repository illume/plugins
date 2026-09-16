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

import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createClusterAdapter } from '../cluster/adapterFactory.js';
import type { ClusterProfileName } from '../contracts/evaluationContracts.js';
import type { LoadedScenario } from './loader.js';
import { caseLogicFor } from './caseLogic.js';
import { loadAllScenarios } from './loader.js';

const transientClusterError =
  /no such host|i\/o timeout|TLS handshake timeout|connection reset|temporarily unavailable|service unavailable|\bEOF\b/i;

export function isTransientClusterError(error: unknown): boolean {
  const reason = error instanceof Error ? error.message : String(error);
  return transientClusterError.test(reason);
}

export function selectQualificationScenarios(
  scenarios: LoadedScenario[],
  profile: 'local-minikube' | 'aks'
): LoadedScenario[] {
  return scenarios.filter(scenario =>
    scenario.manifest.supported_cluster_profiles.includes(profile)
  );
}

async function retryTransient<T>(operation: () => Promise<T>): Promise<T> {
  const attempts = 5;
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === attempts || !isTransientClusterError(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 1_000));
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: qualifyMinikubePortfolio.ts [--profile local-minikube|aks]');
    return;
  }
  if (args.length > 0 && (args.length !== 2 || args[0] !== '--profile')) {
    throw new Error('only --profile local-minikube|aks is supported');
  }
  const profile = (args[1] ?? 'local-minikube') as ClusterProfileName | undefined;
  if (profile !== 'local-minikube' && profile !== 'aks') {
    throw new Error('--profile must be local-minikube or aks');
  }
  const scenarios = selectQualificationScenarios(loadAllScenarios(), profile);
  const adapter = createClusterAdapter(profile, 'real');
  const failedScenarioIds = new Set<string>();
  try {
    const preflight = await adapter.preflight();
    if (!preflight.supported) throw new Error(preflight.reason ?? `${profile} is unsupported`);
    for (const [index, scenario] of scenarios.entries()) {
      const namespace = `eval-qual-${createHash('sha256')
        .update(scenario.manifest.scenario_id)
        .digest('hex')
        .slice(0, 16)}`;
      try {
        const observations = await retryTransient(async () => {
          await adapter.createNamespace(namespace);
          await adapter.applyManifest(
            namespace,
            path.join(scenario.directory, scenario.manifest.setup_manifest_path)
          );
          const logic = caseLogicFor(
            scenario.manifest.scenario_id,
            scenario.manifest.portfolio.parent_scenario_id
          );
          const oracle = await logic.preflight(adapter, namespace);
          if (!oracle.ok) throw new Error(oracle.reason ?? 'mechanism oracle failed');
          return logic.observe(adapter, namespace);
        });
        if (observations.length === 0) throw new Error('observation capture returned no evidence');
        console.log(
          `[${index + 1}/${scenarios.length}] ${scenario.manifest.scenario_id}: passed (${
            observations.length
          } observations)`
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failedScenarioIds.add(scenario.manifest.scenario_id);
        console.error(
          `[${index + 1}/${scenarios.length}] ${scenario.manifest.scenario_id}: ${reason}`
        );
      } finally {
        try {
          await retryTransient(() => adapter.deleteNamespace(namespace));
        } catch (error) {
          failedScenarioIds.add(scenario.manifest.scenario_id);
          console.error(
            `[${index + 1}/${scenarios.length}] ${scenario.manifest.scenario_id}: cleanup: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        }
      }
    }
  } finally {
    await adapter.dispose?.();
  }
  console.log(
    `${profile} qualification: ${scenarios.length - failedScenarioIds.size}/${
      scenarios.length
    } passed`
  );
  if (failedScenarioIds.size > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
