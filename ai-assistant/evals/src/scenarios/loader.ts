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
 * Loads scenario manifests plus their candidate/evaluator packets from
 * `evals/scenarios/<scenario_id>/`.
 *
 * Candidate and evaluator truth are deliberately separate files
 * (`candidate-packet.json`, `evaluator-packet.json`) so a candidate process
 * given only the former can never read gold facts, and so a future protected
 * contract store can hold `evaluator-packet.json` outside the checkout
 * without changing this loader's shape.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';
import { assertValid } from '../contracts/validate.js';
import { loadSchema } from '../contracts/schemas.js';
import { isKwokCompatible } from '../contracts/kwokCompatibility.js';
import type {
  CandidatePacket,
  EvaluatorPacket,
  ScenarioManifest,
} from '../contracts/evaluationContracts.js';
import { assertScenarioAdmission, buildPortfolioCensus } from './admission.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Absolute path to the repository's default scenario directory. */
export const scenariosRoot = path.resolve(here, '..', '..', 'scenarios');

/** Validated manifest, packets, and derived compatibility for one scenario. */
export interface LoadedScenario {
  /** Validated public scenario manifest. */
  manifest: ScenarioManifest;
  /** Candidate-visible task and observation contract. */
  candidatePacket: CandidatePacket;
  /** Protected evaluator truth and grading contract. */
  evaluatorPacket: EvaluatorPacket;
  /** Cross-checked (not merely declared) KWOK-compatibility of this scenario. */
  kwokCompatible: boolean;
  /** Absolute directory containing the scenario source files. */
  directory: string;
}

/**
 * Lists every scenario ID with a directory under a scenario root.
 *
 * @param root - Scenario directory to enumerate.
 * @returns Sorted scenario directory names.
 */
export function listScenarioIds(root: string = scenariosRoot): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

/**
 * Loads one scenario and enforces its cross-file contract. The manifest and
 * both packets must satisfy their schemas and agree on scenario identity;
 * the author's KWOK declaration must also match compatibility derived from
 * `required_mechanisms` rather than being trusted as an independent flag.
 *
 * @param scenarioId - Scenario directory and manifest identifier.
 * @param root - Scenario directory containing the requested scenario.
 * @returns The validated scenario and its derived compatibility proof.
 * @throws When a file is unreadable or malformed, a schema or identity check fails,
 * or the declared KWOK compatibility disagrees with the required mechanisms.
 */
export function loadScenario(scenarioId: string, root: string = scenariosRoot): LoadedScenario {
  const directory = path.join(root, scenarioId);
  const manifest = yaml.load(
    readFileSync(path.join(directory, 'scenario.yaml'), 'utf8')
  ) as ScenarioManifest;
  assertValid(loadSchema('scenario'), manifest, `scenario ${scenarioId}`);
  if (manifest.scenario_id !== scenarioId) {
    throw new Error(
      `scenario ${scenarioId}: manifest scenario_id "${manifest.scenario_id}" does not match directory name`
    );
  }

  const candidatePacket = JSON.parse(
    readFileSync(path.join(directory, 'candidate-packet.json'), 'utf8')
  ) as CandidatePacket;
  assertValid(
    loadSchema('candidate-packet'),
    candidatePacket,
    `scenario ${scenarioId} candidate packet`
  );

  const evaluatorPacket = JSON.parse(
    readFileSync(path.join(directory, 'evaluator-packet.json'), 'utf8')
  ) as EvaluatorPacket;
  assertValid(
    loadSchema('evaluator-packet'),
    evaluatorPacket,
    `scenario ${scenarioId} evaluator packet`
  );
  for (const [name, packet] of [
    ['candidate', candidatePacket],
    ['evaluator', evaluatorPacket],
  ] as const) {
    if (
      packet.scenario_id !== manifest.scenario_id ||
      packet.scenario_version !== manifest.scenario_version
    ) {
      throw new Error(
        `scenario ${scenarioId}: ${name} packet identity does not match manifest ` +
          `${manifest.scenario_id}@${manifest.scenario_version}`
      );
    }
  }

  const kwokCompatible = isKwokCompatible(manifest.required_mechanisms);
  if (kwokCompatible !== manifest.declared_kwok_compatible) {
    throw new Error(
      `scenario ${scenarioId}: declared_kwok_compatible=${manifest.declared_kwok_compatible} but ` +
        `required_mechanisms [${manifest.required_mechanisms.join(
          ', '
        )}] resolve to ${kwokCompatible}. ` +
        'Update declared_kwok_compatible (or required_mechanisms) so the declaration matches the proof.'
    );
  }

  const loaded = { manifest, candidatePacket, evaluatorPacket, kwokCompatible, directory };
  assertScenarioAdmission(loaded);
  return loaded;
}

/**
 * Loads every scenario found under a scenario root.
 *
 * @param root - Scenario directory to enumerate and load.
 * @returns All validated scenarios sorted by directory name.
 */
export function loadAllScenarios(root: string = scenariosRoot): LoadedScenario[] {
  const scenarios = listScenarioIds(root).map(id => loadScenario(id, root));
  buildPortfolioCensus(scenarios);
  return scenarios;
}
