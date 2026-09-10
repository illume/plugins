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

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { PreflightResult } from '../clusterAdapter.js';
import { commandExists, type CommandRunner } from '../commandRunner.js';
import { KubectlClusterAdapter } from './kubectlAdapter.js';

const profileName = 'headlamp-ai-evals';
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultKubeconfigPath = path.resolve(
  here,
  '..',
  '..',
  '..',
  '.private',
  'evals-minikube.kubeconfig'
);

/** Real Kubernetes adapter backed by a dedicated local Minikube profile. */
export class MinikubeAdapter extends KubectlClusterAdapter {
  constructor(runner: CommandRunner, kubeconfigPath = defaultKubeconfigPath) {
    super('local-minikube', runner, { clusterName: profileName, kubeconfigPath });
  }

  /** Starts or reuses the named profile and exports an isolated kubeconfig. */
  override async preflight(): Promise<PreflightResult> {
    for (const tool of ['kubectl', 'minikube', 'docker']) {
      if (!commandExists(tool, this.runner)) {
        return { supported: false, reason: `required tool "${tool}" is not on PATH` };
      }
    }
    const status = this.runner('minikube', ['status', '--profile', profileName, '--output=json']);
    if (status.status !== 0 || !isRunning(status.stdout)) {
      const start = this.runner('minikube', ['start', '--profile', profileName, '--driver=docker']);
      if (start.status !== 0) {
        return {
          supported: false,
          reason: `failed to start Minikube profile ${profileName}: ${start.stderr}`,
        };
      }
    }
    const exported = this.runner('kubectl', [
      'config',
      'view',
      '--raw',
      '--flatten',
      '--minify',
      '--context',
      profileName,
      '-o',
      'json',
    ]);
    if (exported.status !== 0) {
      return {
        supported: false,
        reason: `failed to export Minikube kubeconfig: ${exported.stderr}`,
      };
    }
    const config = JSON.parse(exported.stdout) as Record<string, unknown>;
    config['current-context'] = profileName;
    mkdirSync(path.dirname(this.kubeconfigPath), { recursive: true });
    writeFileSync(this.kubeconfigPath, JSON.stringify(config), {
      encoding: 'utf8',
      mode: 0o600,
    });
    const version = this.runner('kubectl', this.kubectl(['version']));
    return version.status === 0
      ? { supported: true }
      : { supported: false, reason: 'Minikube is not reachable with the isolated kubeconfig' };
  }

  /** Removes only the exported kubeconfig; the reusable named profile remains. */
  override async dispose(): Promise<void> {
    rmSync(this.kubeconfigPath, { force: true });
  }
}

function isRunning(output: string): boolean {
  try {
    const status = JSON.parse(output) as { Host?: string; APIServer?: string };
    return status.Host === 'Running' && status.APIServer === 'Running';
  } catch {
    return false;
  }
}
