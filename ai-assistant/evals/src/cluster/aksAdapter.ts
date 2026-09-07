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
 * Kubectl-backed adapter for a caller-provisioned, dedicated AKS cluster.
 * The adapter never provisions Azure resources; it validates the frozen
 * credential contract and then runs every operation against the explicitly
 * supplied AKS_KUBECONFIG_PATH.
 */

import { commandExists, createRealCommandRunner, type CommandRunner } from './commandRunner.js';
import type { PreflightResult } from './types.js';
import { KubectlKwokAdapter } from './kwokAdapter.js';

export class AksAdapter extends KubectlKwokAdapter {
  constructor(
    private readonly credentialEnvVars: string[],
    runner: CommandRunner = createRealCommandRunner()
  ) {
    super('aks', runner, {
      clusterName: 'caller-provisioned-aks',
      kubeconfigPath: process.env.AKS_KUBECONFIG_PATH ?? '',
    });
  }

  override async preflight(): Promise<PreflightResult> {
    const missingEnv = this.credentialEnvVars.filter(name => !process.env[name]);
    if (missingEnv.length > 0) {
      return {
        supported: false,
        reason: `missing required environment variable(s): ${missingEnv.join(', ')}`,
      };
    }
    for (const tool of ['az', 'kubectl']) {
      if (!commandExists(tool, this.runner)) {
        return { supported: false, reason: `required tool "${tool}" is not on PATH` };
      }
    }
    const result = this.runner('kubectl', this.kubectl(['version']));
    return result.status === 0
      ? { supported: true }
      : {
          supported: false,
          reason: `AKS kubeconfig is not reachable: ${result.stderr || result.stdout}`,
        };
  }
}
