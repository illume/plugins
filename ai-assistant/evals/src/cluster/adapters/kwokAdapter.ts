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

import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PreflightResult } from '../clusterAdapter.js';
import { commandExists, type CommandRunner } from '../commandRunner.js';
import { KubectlClusterAdapter } from './kubectlAdapter.js';

const kwokWorkerManifest = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'profiles',
  'kwokWorker.yaml'
);

/** Real local-KWOK adapter that owns its isolated cluster lifecycle. */
export class KwokAdapter extends KubectlClusterAdapter {
  private clusterCreated = false;

  constructor(runner: CommandRunner, isolation?: { clusterName: string; kubeconfigPath: string }) {
    super('local-kwok', runner, isolation);
  }

  /** Verifies local tools and prepares an isolated, reachable KWOK cluster. */
  override async preflight(): Promise<PreflightResult> {
    for (const tool of ['kubectl', 'kwokctl', 'docker']) {
      if (!commandExists(tool, this.runner)) {
        return { supported: false, reason: `required tool "${tool}" is not on PATH` };
      }
    }
    const create = this.runner('kwokctl', [
      'create',
      'cluster',
      '--name',
      this.clusterName,
      '--runtime',
      'docker',
      '--kubeconfig',
      this.kubeconfigPath,
    ]);
    if (create.status !== 0) {
      return {
        supported: false,
        reason: `failed to create isolated KWOK cluster: ${create.stderr}`,
      };
    }
    this.clusterCreated = true;
    const result = this.runner('kubectl', this.kubectl(['version']));
    if (result.status !== 0) {
      await this.dispose();
      return { supported: false, reason: 'isolated KWOK cluster is not reachable with kubectl' };
    }
    const applyWorker = this.runner('kubectl', this.kubectl(['apply', '-f', kwokWorkerManifest]));
    const waitWorker = this.runner(
      'kubectl',
      this.kubectl(['wait', 'node/kwok-worker', '--for=condition=Ready', '--timeout=120s'])
    );
    if (applyWorker.status !== 0 || waitWorker.status !== 0) {
      await this.dispose();
      return {
        supported: false,
        reason: `failed to prepare KWOK worker: ${
          applyWorker.stderr || waitWorker.stderr || applyWorker.stdout || waitWorker.stdout
        }`,
      };
    }
    return { supported: true };
  }

  /** Deletes the isolated KWOK cluster created during preflight. */
  override async dispose(): Promise<void> {
    if (!this.clusterCreated) return;
    const result = this.runner('kwokctl', ['delete', 'cluster', '--name', this.clusterName]);
    if (result.status !== 0) {
      throw new Error(`failed to delete KWOK cluster ${this.clusterName}: ${result.stderr}`);
    }
    this.clusterCreated = false;
    rmSync(this.kubeconfigPath, { force: true });
  }
}
