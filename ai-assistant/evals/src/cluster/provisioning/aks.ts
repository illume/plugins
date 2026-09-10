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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealCommandRunner, type CommandRunner } from '../commandRunner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const aiAssistantRoot = path.resolve(here, '..', '..', '..');
const defaultAksLocation = 'eastus2';
const defaultAksNodeVmSize = 'Standard_A2_v2';
const ownershipTag = 'headlamp-ai-evals-owner';

/** Default private path used for the managed evaluation AKS kubeconfig. */
export const defaultAksKubeconfigPath = path.join(
  aiAssistantRoot,
  '.private',
  'evals-aks.kubeconfig'
);
const defaultAksOwnershipPath = path.join(aiAssistantRoot, '.private', 'evals-aks-owner');

/** Optional naming, location, and execution overrides for AKS lifecycle commands. */
export interface AksLifecycleOptions {
  /** Azure region for the managed evaluation cluster. */
  location?: string;
  /** VM size for the single evaluation node. */
  nodeVmSize?: string;
  /** Username component used to derive stable Azure resource names. */
  username?: string;
  /** Injectable Azure CLI command boundary. */
  runner?: CommandRunner;
  /** Injectable private ownership-token path used by tests. */
  ownershipPath?: string;
}

/**
 * Converts a user-controlled value into a bounded Azure name component.
 *
 * @param value - Source value to normalize.
 * @param maximumLength - Maximum number of characters to retain.
 * @returns A lowercase Azure-safe name component.
 */
function normalizeNamePart(value: string, maximumLength = 40): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maximumLength);
  if (!normalized) throw new Error(`could not derive an Azure resource name from ${value}`);
  return normalized;
}

/**
 * Derives the stable AKS cluster name for a user and region.
 *
 * @param username - Username used to isolate evaluation resources.
 * @param location - Azure region hosting the cluster.
 * @returns The managed evaluation cluster name.
 */
export function aksResourceName(
  username: string = userInfo().username,
  location = defaultAksLocation
): string {
  return `${normalizeNamePart(username, 20)}-ai-assistant-evals-${normalizeNamePart(
    location,
    20
  )}-1`;
}

/**
 * Derives the resource group containing a managed evaluation cluster.
 *
 * @param username - Username used to isolate evaluation resources.
 * @param location - Azure region hosting the cluster.
 * @returns The managed evaluation resource group name.
 */
export function aksResourceGroupName(username?: string, location?: string): string {
  return `rg-${aksResourceName(username, location)}`;
}

/** Derives the bounded resource group used for AKS-managed node resources. */
export function aksNodeResourceGroupName(username?: string, location?: string): string {
  return `rg-${aksResourceName(username, location)}-nodes`;
}

/**
 * Executes an Azure command and converts non-zero results into exceptions.
 *
 * @param runner - Command boundary used for execution.
 * @param command - Executable name or path.
 * @param args - Ordered command-line arguments.
 */
function runOrThrow(runner: CommandRunner, command: string, args: string[]): void {
  const result = runner(command, args);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `${command} failed`);
  }
}

/**
 * Checks whether a named AKS cluster exists in a resource group.
 *
 * @param runner - Azure CLI command boundary.
 * @param resourceGroup - Resource group to inspect.
 * @param name - AKS cluster name to match.
 * @returns Whether exactly one matching cluster exists.
 */
function aksClusterExists(runner: CommandRunner, resourceGroup: string, name: string): boolean {
  const result = runner('az', [
    'aks',
    'list',
    '--resource-group',
    resourceGroup,
    '--query',
    `[?name=='${name}'] | length(@)`,
    '--output',
    'tsv',
  ]);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'az failed');
  }
  const count = result.stdout.trim();
  if (count !== '0' && count !== '1') {
    throw new Error(`unexpected response while checking for AKS cluster ${name}: ${count}`);
  }
  return count === '1';
}

/** Minimal Azure metadata needed to reuse an existing evaluation cluster. */
interface ExistingAksCluster {
  /** AKS cluster resource name. */
  name: string;
  /** Resource group containing the cluster. */
  resourceGroup: string;
  /** Azure region hosting the cluster. */
  location: string;
}

/**
 * Finds the first stable evaluation cluster owned by a user.
 *
 * @param runner - Azure CLI command boundary.
 * @param username - Username prefix used by managed cluster names.
 * @returns Matching cluster metadata, or undefined when none exists.
 */
function findExistingAksCluster(
  runner: CommandRunner,
  username: string = userInfo().username
): ExistingAksCluster | undefined {
  const prefix = `${normalizeNamePart(username, 20)}-ai-assistant-evals-`;
  const result = runner('az', [
    'aks',
    'list',
    '--query',
    `[?starts_with(name, '${prefix}')].{name:name,resourceGroup:resourceGroup,location:location}`,
    '--output',
    'json',
  ]);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'az failed');
  }

  let clusters: ExistingAksCluster[];
  try {
    clusters = JSON.parse(result.stdout) as ExistingAksCluster[];
  } catch {
    throw new Error('could not parse existing AKS clusters returned by Azure CLI');
  }

  return clusters
    .filter(
      cluster =>
        cluster.name === aksResourceName(username, cluster.location) &&
        cluster.resourceGroup === aksResourceGroupName(username, cluster.location)
    )
    .sort((left, right) => left.location.localeCompare(right.location))[0];
}

function readOwnershipToken(ownershipPath: string): string | undefined {
  if (!existsSync(ownershipPath)) return undefined;
  const token = readFileSync(ownershipPath, 'utf8').trim();
  return token || undefined;
}

function resourceGroupExists(runner: CommandRunner, resourceGroup: string): boolean {
  const result = runner('az', ['group', 'exists', '--name', resourceGroup]);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'az group exists failed');
  }
  const exists = result.stdout.trim().toLowerCase();
  if (exists !== 'true' && exists !== 'false') {
    throw new Error(
      `unexpected response while checking resource group ${resourceGroup}: ${exists}`
    );
  }
  return exists === 'true';
}

function resourceGroupOwnership(runner: CommandRunner, resourceGroup: string): string {
  const result = runner('az', [
    'group',
    'show',
    '--name',
    resourceGroup,
    '--query',
    `tags.${ownershipTag}`,
    '--output',
    'tsv',
  ]);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'az group show failed');
  }
  return result.stdout.trim();
}

function requireOwnedResourceGroup(
  runner: CommandRunner,
  resourceGroup: string,
  ownershipPath: string
): string {
  if (!resourceGroupExists(runner, resourceGroup)) {
    throw new Error(`refusing to use missing AKS resource group ${resourceGroup}`);
  }
  const localToken = readOwnershipToken(ownershipPath);
  const remoteToken = resourceGroupOwnership(runner, resourceGroup);
  if (!localToken || !remoteToken || localToken !== remoteToken) {
    throw new Error(`refusing to use unowned AKS resource group ${resourceGroup}`);
  }
  return localToken;
}

/**
 * Creates or reuses a managed AKS cluster and writes its kubeconfig.
 *
 * @param options - Optional location, username, and command overrides.
 * @returns The stable AKS cluster name.
 */
export function setupAks(options: AksLifecycleOptions = {}): string {
  const runner = options.runner ?? createRealCommandRunner();
  const existing = options.location ? undefined : findExistingAksCluster(runner, options.username);
  const location = options.location ?? existing?.location ?? defaultAksLocation;
  const name = aksResourceName(options.username, location);
  const resourceGroup = aksResourceGroupName(options.username, location);
  const nodeResourceGroup = aksNodeResourceGroupName(options.username, location);
  const nodeVmSize = options.nodeVmSize ?? defaultAksNodeVmSize;
  const ownershipPath = options.ownershipPath ?? defaultAksOwnershipPath;

  mkdirSync(path.dirname(defaultAksKubeconfigPath), { recursive: true });
  let owner = readOwnershipToken(ownershipPath);
  if (resourceGroupExists(runner, resourceGroup)) {
    owner = requireOwnedResourceGroup(runner, resourceGroup, ownershipPath);
  } else {
    owner ??= randomUUID();
    mkdirSync(path.dirname(ownershipPath), { recursive: true });
    writeFileSync(ownershipPath, `${owner}\n`, { encoding: 'utf8', mode: 0o600 });
    runOrThrow(runner, 'az', [
      'group',
      'create',
      '--name',
      resourceGroup,
      '--location',
      location,
      '--tags',
      `${ownershipTag}=${owner}`,
    ]);
  }
  if (!aksClusterExists(runner, resourceGroup, name)) {
    runOrThrow(runner, 'az', [
      'aks',
      'create',
      '--resource-group',
      resourceGroup,
      '--name',
      name,
      '--node-resource-group',
      nodeResourceGroup,
      '--node-vm-size',
      nodeVmSize,
      '--node-count',
      '1',
      '--enable-managed-identity',
      '--generate-ssh-keys',
      '--if-none-match',
      '*',
    ]);
  }
  runOrThrow(runner, 'az', [
    'aks',
    'get-credentials',
    '--resource-group',
    resourceGroup,
    '--name',
    name,
    '--file',
    defaultAksKubeconfigPath,
    '--context',
    name,
    '--overwrite-existing',
  ]);
  return name;
}

/**
 * Starts deletion of the managed AKS resource group.
 *
 * @param options - Optional location, username, and command overrides.
 * @returns The resource group submitted for asynchronous deletion.
 */
export function deleteAks(options: AksLifecycleOptions = {}): string {
  const runner = options.runner ?? createRealCommandRunner();
  const existing = options.location ? undefined : findExistingAksCluster(runner, options.username);
  const location = options.location ?? existing?.location ?? defaultAksLocation;
  const resourceGroup = aksResourceGroupName(options.username, location);
  requireOwnedResourceGroup(
    runner,
    resourceGroup,
    options.ownershipPath ?? defaultAksOwnershipPath
  );
  runOrThrow(runner, 'az', ['group', 'delete', '--name', resourceGroup, '--yes', '--no-wait']);
  return resourceGroup;
}
