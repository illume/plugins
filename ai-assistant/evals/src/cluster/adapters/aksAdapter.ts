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
 * Connects the generic trial lifecycle to a dedicated AKS cluster.
 *
 * Provisioning is deliberately outside this adapter: `provisioning/aks.ts` owns
 * Azure resource creation and deletion, while this class only decides whether
 * an existing cluster is safe and reachable for a run. It inherits the
 * kubectl-backed namespace, fixture, and observation operations from
 * `KubectlClusterAdapter`.
 *
 * Keeping provisioning separate lets preflight fail without changing Azure
 * resources and lets tests inject a command runner without contacting AKS.
 * Every operation is pinned to `AKS_KUBECONFIG_PATH` (or the eval-specific
 * default), avoiding accidental use of the workstation's current context.
 */

import { commandExists, createRealCommandRunner, type CommandRunner } from '../commandRunner.js';
import { defaultAksKubeconfigPath } from '../provisioning/aks.js';
import type { PreflightResult } from '../clusterAdapter.js';
import { KubectlClusterAdapter } from './kubectlAdapter.js';

/** Read/write trial harness bound to one already-provisioned AKS cluster. */
export class AksAdapter extends KubectlClusterAdapter {
  /**
   * Creates an AKS adapter with the profile's credential contract.
   *
   * @param credentialEnvVars - Environment variables required before cluster access.
   * @param runner - Injectable command boundary for Azure and kubectl checks.
   */
  constructor(
    private readonly credentialEnvVars: string[],
    runner: CommandRunner = createRealCommandRunner()
  ) {
    super('aks', runner, {
      clusterName: 'caller-provisioned-aks',
      kubeconfigPath: process.env.AKS_KUBECONFIG_PATH ?? defaultAksKubeconfigPath,
    });
  }

  /**
   * Verifies required credentials, tools, and kubeconfig connectivity.
   *
   * @returns The AKS support decision and any missing prerequisite.
   */
  override async preflight(): Promise<PreflightResult> {
    const missingEnv = this.credentialEnvVars.filter(name => !process.env[name]);
    if (missingEnv.length > 0) {
      return {
        supported: false,
        reason: `missing required environment variable(s): ${missingEnv.join(', ')}`,
      };
    }
    if (!commandExists('kubectl', this.runner)) {
      return { supported: false, reason: 'required tool "kubectl" is not on PATH' };
    }
    const version = this.runner('kubectl', this.kubectl(['version']));
    if (version.status !== 0) {
      return {
        supported: false,
        reason: `AKS kubeconfig is not reachable: ${version.stderr || version.stdout}`,
      };
    }
    const nodes = this.runner('kubectl', this.kubectl(['get', 'nodes', '-o', 'json']));
    if (nodes.status !== 0) {
      return {
        supported: false,
        reason: `AKS nodes are not reachable: ${nodes.stderr || nodes.stdout}`,
      };
    }
    const nodeList = JSON.parse(nodes.stdout) as {
      items?: Array<{
        spec?: { unschedulable?: boolean };
        status?: { conditions?: Array<{ status?: string; type?: string }> };
      }>;
    };
    const hasReadyNode = nodeList.items?.some(
      node =>
        !node.spec?.unschedulable &&
        node.status?.conditions?.some(
          condition => condition.type === 'Ready' && condition.status === 'True'
        )
    );
    return hasReadyNode
      ? { supported: true }
      : { supported: false, reason: 'AKS has no Ready schedulable nodes' };
  }

  /** Leaves the operator-managed AKS cluster and kubeconfig in place. */
  override async dispose(): Promise<void> {}
}
