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
 * A profile-validation boundary for the `aks` cluster axis.
 *
 * Phase 1 declares AKS as a required portability profile in
 * `evals/docs/implementation-phases.md`, but this repository does not
 * provision or fake a real Azure Kubernetes Service cluster. This adapter's
 * only real behavior is `preflight`: it checks whether the declared
 * credential environment variables and the `az`/`kubectl` binaries are
 * present, and reports a clear `unsupported` result with a specific reason
 * when they are not — never a fabricated success. Every other method throws,
 * because the runner must never call them after an unsupported preflight.
 */

import type { ClusterProfileName } from '../contracts/types.js';
import { commandExists, createRealCommandRunner } from './command-runner.js';
import type { ClusterAdapter, PreflightResult } from './types.js';

export class AksStubAdapter implements ClusterAdapter {
  readonly profile: ClusterProfileName = 'aks';
  readonly mode = 'real' as const;

  constructor(private readonly credentialEnvVars: string[]) {}

  async preflight(): Promise<PreflightResult> {
    const missingEnv = this.credentialEnvVars.filter(name => !process.env[name]);
    if (missingEnv.length > 0) {
      return {
        supported: false,
        reason: `missing required environment variable(s): ${missingEnv.join(', ')}`,
      };
    }
    const runner = createRealCommandRunner();
    for (const tool of ['az', 'kubectl']) {
      if (!commandExists(tool, runner)) {
        return { supported: false, reason: `required tool "${tool}" is not on PATH` };
      }
    }
    return {
      supported: false,
      reason:
        'AKS cluster provisioning is a declared Phase 1 portability profile but is not yet ' +
        'implemented; this adapter only validates credential/tool presence and never provisions ' +
        'or fakes a real cluster run.',
    };
  }

  private unimplemented(): never {
    throw new Error(
      'AksStubAdapter: not implemented; preflight() must be checked before any other call'
    );
  }

  async createNamespace(): Promise<void> {
    this.unimplemented();
  }
  async applyManifest(): Promise<void> {
    this.unimplemented();
  }
  async getServiceSelector(): Promise<never> {
    this.unimplemented();
  }
  async listPodsByLabelSelector(): Promise<never> {
    this.unimplemented();
  }
  async computeEndpoints(): Promise<never> {
    this.unimplemented();
  }
  async getPodResourceRequests(): Promise<never> {
    this.unimplemented();
  }
  async listNodeAllocatable(): Promise<never> {
    this.unimplemented();
  }
  async getSchedulingObservation(): Promise<never> {
    this.unimplemented();
  }
  async deleteNamespace(): Promise<void> {
    this.unimplemented();
  }
}
