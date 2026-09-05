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

import type { CommandRunner } from '../../providers/detectProvider';

/** Azure observability service supported by endpoint discovery. */
export type AzureObservabilityProvider = 'grafana' | 'prometheus';

/** A managed observability endpoint discovered from the active Azure subscription. */
export interface AzureObservabilityEndpoint {
  /** Service that can use the endpoint. */
  provider: AzureObservabilityProvider;
  /** Azure resource name. */
  name: string;
  /** Azure resource group containing the resource. */
  resourceGroup: string;
  /** HTTP API endpoint to save in observability settings. */
  url: string;
}

interface AzureResource {
  name?: unknown;
  resourceGroup?: unknown;
  properties?: {
    endpoint?: unknown;
    prometheusQueryEndpoint?: unknown;
    metrics?: {
      prometheusQueryEndpoint?: unknown;
    };
  };
}

/**
 * Discovers managed Grafana and Azure Monitor workspace endpoints with Azure CLI.
 *
 * The active `az` account and subscription are used. Discovery only reads resource
 * metadata; it does not request, return, or persist service access tokens.
 *
 * @param runCommand - Host-provided command runner capable of executing `az`.
 * @returns Managed endpoints in the active subscription.
 * @throws When Azure CLI is unavailable, unauthenticated, or returns malformed output.
 */
export async function discoverAzureObservabilityEndpoints(
  runCommand: CommandRunner
): Promise<AzureObservabilityEndpoint[]> {
  const account = await runCommand('az', ['account', 'show', '--output', 'json']);
  if (account.exitCode !== 0) {
    throw new Error('Azure CLI is not signed in. Run az login, then try again.');
  }

  const [grafanaResult, prometheusResult] = await Promise.all([
    runCommand('az', [
      'resource',
      'list',
      '--resource-type',
      'Microsoft.Dashboard/grafana',
      '--output',
      'json',
    ]),
    runCommand('az', [
      'resource',
      'list',
      '--resource-type',
      'Microsoft.Monitor/accounts',
      '--output',
      'json',
    ]),
  ]);
  if (grafanaResult.exitCode !== 0 || prometheusResult.exitCode !== 0) {
    throw new Error('Azure CLI could not list managed observability resources.');
  }

  return [
    ...parseResources(grafanaResult.stdout, 'grafana'),
    ...parseResources(prometheusResult.stdout, 'prometheus'),
  ];
}

/**
 * Converts an Azure resource-list response into usable observability endpoints.
 *
 * @param stdout - JSON emitted by `az resource list`.
 * @param provider - Provider whose endpoint property should be selected.
 * @returns Resources that contain a valid HTTP(S) endpoint.
 */
function parseResources(
  stdout: string,
  provider: AzureObservabilityProvider
): AzureObservabilityEndpoint[] {
  let resources: AzureResource[];
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) {
      throw new Error('response is not an array');
    }
    resources = parsed;
  } catch {
    throw new Error(`Azure CLI returned invalid ${provider} resource data.`);
  }

  return resources.flatMap(resource => {
    const endpoint =
      provider === 'grafana'
        ? resource.properties?.endpoint
        : resource.properties?.metrics?.prometheusQueryEndpoint ??
          resource.properties?.prometheusQueryEndpoint;
    if (
      typeof resource.name !== 'string' ||
      typeof resource.resourceGroup !== 'string' ||
      typeof endpoint !== 'string' ||
      !isHttpUrl(endpoint)
    ) {
      return [];
    }
    return [
      {
        provider,
        name: resource.name,
        resourceGroup: resource.resourceGroup,
        url: endpoint.replace(/\/+$/, ''),
      },
    ];
  });
}

/**
 * Checks whether a discovered endpoint uses an HTTP transport.
 *
 * @param value - Candidate endpoint.
 * @returns Whether the endpoint is a valid HTTP(S) URL.
 */
function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
