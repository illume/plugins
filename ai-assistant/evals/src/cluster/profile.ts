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
 * Loads committed cluster/model profile configuration from `evals/profiles/`.
 *
 * Profiles never contain credentials: an `azure` or `aks` profile references
 * environment variable names to resolve at run time, and the loader refuses
 * to accept a literal secret-shaped value in `config.yaml`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import yaml from 'js-yaml';
import type { ClusterProfileName } from '../contracts/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const profilesRoot = path.resolve(here, '..', '..', 'profiles');

export interface ClusterProfileConfig {
  schema_version: string;
  profile_name: ClusterProfileName;
  cluster: {
    kind: 'kwok' | 'minikube' | 'aks';
    /** Names of environment variables the adapter may read; never literal secrets. */
    credential_env_vars: string[];
  };
  model: {
    kind: 'copilot-auto' | 'azure' | 'local';
    credential_env_vars: string[];
  };
}

const ENVIRONMENT_VARIABLE_NAME = /^[A-Z_][A-Z0-9_]*$/;

export function loadClusterProfile(
  name: string,
  root: string = profilesRoot
): ClusterProfileConfig {
  const filePath = path.join(root, `${name}.yaml`);
  const config = yaml.load(readFileSync(filePath, 'utf8')) as ClusterProfileConfig;
  for (const scope of [config.cluster, config.model]) {
    for (const envVar of scope.credential_env_vars) {
      if (!ENVIRONMENT_VARIABLE_NAME.test(envVar)) {
        throw new Error(
          `profile ${name}: credential_env_vars must name an environment variable, not a literal secret`
        );
      }
    }
  }
  return config;
}
