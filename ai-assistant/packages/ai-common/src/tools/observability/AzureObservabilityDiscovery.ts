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

import {
  type CommandRunner,
  fetchAzureApi,
  getAzureManagementToken,
  listAzureSubscriptionsWithApi,
} from '../../providers/detectProvider';

/** Azure observability service supported by endpoint discovery. */
export type AzureObservabilityProvider = 'grafana' | 'prometheus';

/** A managed observability endpoint discovered from an accessible Azure subscription. */
export interface AzureObservabilityEndpoint {
  /** Service that can use the endpoint. */
  provider: AzureObservabilityProvider;
  /** Azure resource name. */
  name: string;
  /** Azure resource group containing the resource. */
  resourceGroup: string;
  /** Azure subscription containing the resource. */
  subscriptionId: string;
  /** HTTP API endpoint to save in observability settings. */
  url: string;
}

interface AzureResourceGraphRow {
  name?: unknown;
  resourceGroup?: unknown;
  provider?: unknown;
  subscriptionId?: unknown;
  url?: unknown;
}

interface AzureResourceGraphResponse {
  /** Resources returned in the current page. */
  data?: AzureResourceGraphRow[];
  /** Opaque continuation token for the next page. */
  $skipToken?: string;
}

/**
 * Discovers managed Grafana and Azure Monitor workspace endpoints through Azure APIs.
 *
 * Azure CLI is used only to obtain an ARM token. All accessible enabled subscriptions
 * are queried through Azure Resource Manager and Resource Graph. Discovery only reads
 * resource metadata; it does not return or persist access tokens.
 *
 * @param runCommand - Host-provided command runner capable of executing `az`.
 * @param signal - Optional cancellation signal.
 * @returns Managed endpoints across accessible subscriptions.
 * @throws When authentication or Azure resource discovery fails.
 */
export async function discoverAzureObservabilityEndpoints(
  runCommand: CommandRunner,
  signal?: AbortSignal
): Promise<AzureObservabilityEndpoint[]> {
  const token = await getAzureManagementToken(runCommand, signal);
  if (!token) {
    throw new Error('Azure CLI is not signed in. Run az login, then try again.');
  }
  const subscriptions = await listAzureSubscriptionsWithApi(token, signal);
  if (!subscriptions) {
    throw new Error('Azure API could not list accessible subscriptions.');
  }
  const subscriptionIds = subscriptions.flatMap(subscription =>
    subscription.state === 'Enabled' && subscription.subscriptionId
      ? [subscription.subscriptionId]
      : []
  );
  if (subscriptionIds.length === 0) return [];

  return queryAzureObservabilityResources(token, subscriptionIds, signal);
}

/**
 * Queries Azure Resource Graph for managed observability resources.
 *
 * @param token - ARM bearer token.
 * @param subscriptions - Subscription IDs included in the query.
 * @param signal - Optional cancellation signal.
 * @returns Resources containing a valid HTTP(S) endpoint.
 */
async function queryAzureObservabilityResources(
  token: string,
  subscriptions: string[],
  signal?: AbortSignal
): Promise<AzureObservabilityEndpoint[]> {
  const query = [
    'Resources',
    "| where type in~ ('microsoft.dashboard/grafana', 'microsoft.monitor/accounts')",
    "| extend provider=iff(type =~ 'microsoft.dashboard/grafana', 'grafana', 'prometheus')",
    "| extend url=iff(provider == 'grafana', tostring(properties.endpoint), tostring(properties.metrics.prometheusQueryEndpoint))",
    '| where isnotempty(url)',
    '| project name, resourceGroup, subscriptionId, provider, url',
    '| order by provider asc, name asc',
  ].join(' ');
  const endpoints: AzureObservabilityEndpoint[] = [];
  let skipToken: string | undefined;

  do {
    const response = await fetchAzureApi(
      'https://management.azure.com/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01',
      {
        method: 'POST',
        headers: {
          Authorization: ['Bearer', token].join(' '),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscriptions,
          query,
          options: {
            resultFormat: 'objectArray',
            $top: 1000,
            ...(skipToken ? { $skipToken: skipToken } : {}),
          },
        }),
      },
      signal
    );
    if (!response.ok) {
      throw new Error(
        `Azure API could not discover managed observability resources (${response.status}).`
      );
    }
    const page: AzureResourceGraphResponse = await response.json();
    if (!Array.isArray(page.data)) {
      throw new Error('Azure API returned invalid observability resource data.');
    }
    endpoints.push(...page.data.flatMap(parseResource));
    skipToken = page.$skipToken;
  } while (skipToken);

  return endpoints;
}

/**
 * Converts one Resource Graph row into an observability endpoint.
 *
 * @param resource - Projected Resource Graph row.
 * @returns A single validated endpoint, or an empty array for malformed rows.
 */
function parseResource(resource: AzureResourceGraphRow): AzureObservabilityEndpoint[] {
  if (
    (resource.provider !== 'grafana' && resource.provider !== 'prometheus') ||
    typeof resource.name !== 'string' ||
    typeof resource.resourceGroup !== 'string' ||
    typeof resource.subscriptionId !== 'string' ||
    typeof resource.url !== 'string' ||
    !isHttpUrl(resource.url)
  ) {
    return [];
  }
  return [
    {
      provider: resource.provider,
      name: resource.name,
      resourceGroup: resource.resourceGroup,
      subscriptionId: resource.subscriptionId,
      url: resource.url.replace(/\/+$/, ''),
    },
  ];
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
