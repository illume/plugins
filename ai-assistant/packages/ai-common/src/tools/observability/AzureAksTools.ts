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

import { z } from 'zod';
import { getAzureAccessToken } from '../../providers/detectProvider';
import type { ToolConfig, ToolHandler } from '../langchain/LangChainTool';
import {
  assertMaximumRange,
  isLoopbackHostname,
  ObservabilityTool,
  type ObservabilityToolContext,
  readBoundedJson,
  toolResult,
  traceTime,
  validateWorkspaceKql,
} from './ObservabilityTools';

const ARM_AUDIENCE = 'https://management.azure.com/';
const LOGS_AUDIENCE = 'https://api.loganalytics.azure.com';
const ARM_ORIGIN = 'https://management.azure.com';
const HOUR = 60 * 60 * 1000;

type AzureAudience = 'arm' | 'logs';

function validateResourceId(value: unknown, resourceType?: string): string {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    !/^\/subscriptions\/[^/?#]+\/resourceGroups\/[^/?#]+\/providers\/[^/?#]+\/[^/?#]+\/[^/?#]+(?:\/[^/?#]+\/[^/?#]+)*$/i.test(
      value
    ) ||
    /%(?:2f|5c)|['"|\\\u0000-\u001f]|(?:^|\/)\.{1,2}(?:\/|$)/i.test(value)
  ) {
    throw new Error('A valid Azure resource ID is required');
  }
  const segments = value.split('/').filter(Boolean);
  validateSubscriptionId(segments[1]);
  if (resourceType) {
    const actualType = `${segments[5]}/${segments[6]}`;
    if (actualType.toLowerCase() !== resourceType.toLowerCase()) {
      throw new Error(`Resource ID must identify ${resourceType}`);
    }
  }
  return value.replace(/\/+$/, '');
}

function validateSubscriptionId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error('A valid Azure subscription ID is required');
  }
  return value;
}

function subscriptionFromResourceId(resourceId: string): string {
  const subscriptionId = resourceId.split('/')[2];
  return validateSubscriptionId(subscriptionId);
}

function escapeKql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function azureToken(
  context: ObservabilityToolContext,
  audience: AzureAudience
): Promise<string> {
  const configured = context.config.azureMonitor ?? {};
  const saved = audience === 'arm' ? configured.managementToken : configured.token;
  if (saved) return saved;
  if (context.commandRunner) {
    const token = await getAzureAccessToken(
      context.commandRunner,
      audience === 'arm' ? ARM_AUDIENCE : LOGS_AUDIENCE
    );
    if (token) return token;
  }
  throw new Error(
    audience === 'arm'
      ? 'Azure Resource Manager requires an access token or an authenticated Azure CLI'
      : 'Azure Monitor Logs requires an access token or an authenticated Azure CLI'
  );
}

async function azureRequest(
  context: ObservabilityToolContext,
  audience: AzureAudience,
  url: URL,
  init?: RequestInit
): Promise<unknown> {
  const deadline = Date.now() + 30_000;
  const method = init?.method?.toUpperCase() ?? 'GET';
  if (method !== 'GET' && method !== 'POST') {
    throw new Error('Azure troubleshooting tools only allow GET and read-only POST operations');
  }
  if (
    (audience === 'arm' && url.origin !== ARM_ORIGIN) ||
    (audience === 'logs' &&
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && isLoopbackHostname(url.hostname)))
  ) {
    throw new Error('Azure request URL is not allowed');
  }
  if (
    audience === 'logs' &&
    !context.config.azureMonitor?.token &&
    url.hostname !== 'api.loganalytics.azure.com'
  ) {
    throw new Error(
      'Azure CLI tokens can only be sent to api.loganalytics.azure.com; configure a token explicitly for a trusted proxy'
    );
  }
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  headers.set('Authorization', ['Bearer', await azureToken(context, audience)].join(' '));
  let response = await (context.fetch ?? fetch)(url, {
    ...init,
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
  });
  for (let poll = 0; response.status === 202 && poll < 6; poll++) {
    const location =
      response.headers.get('location') ?? response.headers.get('azure-asyncoperation');
    if (!location) break;
    const pollUrl = new URL(location);
    if (pollUrl.origin !== ARM_ORIGIN) throw new Error('Azure polling URL is not allowed');
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterValue = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
    const retryAfter = Math.min(Number.isFinite(retryAfterValue) ? retryAfterValue : 1, 5);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    const wait = Math.min(retryAfter * 1000, remaining);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    response = await (context.fetch ?? fetch)(pollUrl, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    });
    if (response.ok && response.status !== 202) {
      const result = await readBoundedJson(response, 'Azure');
      const status =
        result && typeof result === 'object' && 'status' in result
          ? String((result as { status: unknown }).status).toLowerCase()
          : '';
      if (status === 'inprogress' || status === 'running') {
        response = new Response('', {
          status: 202,
          headers: {
            location: pollUrl.toString(),
            'retry-after': response.headers.get('retry-after') ?? '1',
          },
        });
      } else if (status === 'failed' || status === 'canceled' || status === 'cancelled') {
        throw new Error(`Azure read operation ${status}`);
      } else {
        return result;
      }
    }
  }
  if (response.status === 202) throw new Error('Azure read operation did not complete in time');
  return readBoundedJson(response, 'Azure');
}

function armUrl(resourceId: string, suffix: string, apiVersion: string): URL {
  const url = new URL(`${ARM_ORIGIN}${resourceId}${suffix}`);
  url.searchParams.set('api-version', apiVersion);
  return url;
}

function queryWindow(args: Record<string, unknown>, label: string): [number, number] {
  const end = traceTime(args.end, Date.now());
  const start = traceTime(args.start, end - HOUR);
  assertMaximumRange(start, end, label);
  return [start, end];
}

async function logsQuery(
  context: ObservabilityToolContext,
  query: string,
  start: number,
  end: number
): Promise<unknown> {
  const baseUrl = context.config.azureMonitor?.baseUrl;
  if (!baseUrl) throw new Error('Azure Monitor Logs workspace is not configured');
  const url = new URL(baseUrl);
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) ||
    url.username ||
    url.password
  ) {
    throw new Error('Azure Monitor Logs URL must use HTTPS, or HTTP for localhost');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/query`;
  return azureRequest(context, 'logs', url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `${query}\n| take 100`,
      timespan: `${new Date(start).toISOString()}/${new Date(end).toISOString()}`,
    }),
  });
}

async function resourceGraphQuery(
  context: ObservabilityToolContext,
  subscriptions: string[],
  query: string
): Promise<unknown> {
  const url = new URL(
    `${ARM_ORIGIN}/providers/Microsoft.ResourceGraph/resources?api-version=2022-10-01`
  );
  return azureRequest(context, 'arm', url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscriptions,
      query,
      options: { resultFormat: 'objectArray', $top: 100 },
    }),
  });
}

/** Read-only Azure Monitor metric values for an Azure resource. */
export class AzureMetricsTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'azure_metrics_read',
    shortDescription: 'Read Azure resource metrics',
    description: 'List bounded Azure Monitor metric values for one resource over at most 24 hours.',
    schema: z.object({
      resourceId: z.string().describe('Full Azure resource ID'),
      metricNames: z
        .array(z.string().regex(/^[A-Za-z0-9_.-]+$/))
        .min(1)
        .max(20)
        .describe('One to twenty Azure Monitor metric names'),
      aggregation: z
        .enum(['Average', 'Minimum', 'Maximum', 'Total', 'Count'])
        .optional()
        .describe('Aggregation; defaults to Average'),
      interval: z
        .string()
        .regex(/^PT(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?$/)
        .describe('ISO 8601 time grain such as PT5M')
        .optional(),
      start: z.string().optional().describe('Timestamp; defaults to one hour before end'),
      end: z.string().optional().describe('Timestamp; defaults to now, maximum range 24 hours'),
    }),
  };

  handler: ToolHandler = async args => {
    const context = this.getContext();
    const resourceId = validateResourceId(args.resourceId);
    const [start, end] = queryWindow(args, 'Azure metrics');
    const url = armUrl(resourceId, '/providers/microsoft.insights/metrics', '2023-10-01');
    url.searchParams.set('metricnames', (args.metricNames as string[]).join(','));
    url.searchParams.set(
      'timespan',
      `${new Date(start).toISOString()}/${new Date(end).toISOString()}`
    );
    url.searchParams.set('aggregation', String(args.aggregation ?? 'Average'));
    if (typeof args.interval === 'string') url.searchParams.set('interval', args.interval);
    return toolResult(await azureRequest(context, 'arm', url));
  };
}

/** Read-only current or historical Azure Resource Health status. */
export class AzureResourceHealthTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'azure_resource_health_read',
    shortDescription: 'Read Azure resource health',
    description: 'Retrieve current or historical Azure Resource Health availability statuses.',
    schema: z.object({
      resourceId: z.string().describe('Full Azure resource ID'),
      action: z
        .enum(['current', 'history'])
        .optional()
        .describe('Current status or availability history; defaults to current'),
    }),
  };

  handler: ToolHandler = async args => {
    const resourceId = validateResourceId(args.resourceId);
    if (args.action !== undefined && args.action !== 'current' && args.action !== 'history') {
      throw new Error('Unsupported Azure Resource Health action');
    }
    const suffix =
      args.action === 'history'
        ? '/providers/Microsoft.ResourceHealth/availabilityStatuses'
        : '/providers/Microsoft.ResourceHealth/availabilityStatuses/current';
    const url = armUrl(resourceId, suffix, '2025-05-01');
    return toolResult(await azureRequest(this.getContext(), 'arm', url));
  };
}

/** Read-only bounded KQL over Application Insights telemetry. */
export class AzureApplicationInsightsTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'azure_application_insights_read',
    shortDescription: 'Query Application Insights telemetry',
    description:
      'Run bounded KQL against Application Insights request, dependency, exception, and trace telemetry.',
    schema: z.object({
      query: z.string().min(1).max(10_000).describe('Workspace-local Application Insights KQL'),
      start: z.string().optional().describe('Timestamp; defaults to one hour before end'),
      end: z.string().optional().describe('Timestamp; defaults to now, maximum range 24 hours'),
    }),
  };

  handler: ToolHandler = async args => {
    const [start, end] = queryWindow(args, 'Application Insights');
    return toolResult(
      await logsQuery(this.getContext(), validateWorkspaceKql(args.query), start, end)
    );
  };
}

/** Read-only AKS diagnostic settings and supported categories. */
export class AzureDiagnosticsTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'azure_diagnostics_read',
    shortDescription: 'Inspect AKS diagnostic settings',
    description:
      'List configured AKS diagnostic settings or the supported diagnostic categories without changing them.',
    schema: z.object({
      clusterResourceId: z.string().describe('Full AKS managed cluster resource ID'),
      action: z
        .enum(['settings', 'categories'])
        .optional()
        .describe('Configured settings or supported categories; defaults to settings'),
    }),
  };

  handler: ToolHandler = async args => {
    const clusterId = validateResourceId(
      args.clusterResourceId,
      'Microsoft.ContainerService/managedClusters'
    );
    if (args.action !== undefined && args.action !== 'settings' && args.action !== 'categories') {
      throw new Error('Unsupported Azure diagnostics action');
    }
    const suffix =
      args.action === 'categories'
        ? '/providers/microsoft.insights/diagnosticSettingsCategories'
        : '/providers/microsoft.insights/diagnosticSettings';
    return toolResult(
      await azureRequest(this.getContext(), 'arm', armUrl(clusterId, suffix, '2021-05-01-preview'))
    );
  };
}

const CONTROL_PLANE_CATEGORIES = [
  'kube-apiserver',
  'kube-controller-manager',
  'kube-scheduler',
  'cluster-autoscaler',
  'cloud-controller-manager',
  'guard',
] as const;

/** Read-only, fixed-shape AKS control-plane log queries. */
export class AzureControlPlaneLogsTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'azure_control_plane_logs_read',
    shortDescription: 'Query AKS control-plane logs',
    description: 'Query a bounded AKS control-plane or audit log category over at most 24 hours.',
    schema: z.object({
      clusterResourceId: z.string().describe('Full AKS managed cluster resource ID'),
      category: z
        .enum([...CONTROL_PLANE_CATEGORIES, 'kube-audit', 'kube-audit-admin'])
        .describe('Exact AKS diagnostic log category'),
      start: z.string().optional().describe('Timestamp; defaults to one hour before end'),
      end: z.string().optional().describe('Timestamp; defaults to now, maximum range 24 hours'),
    }),
  };

  handler: ToolHandler = async args => {
    const clusterId = validateResourceId(
      args.clusterResourceId,
      'Microsoft.ContainerService/managedClusters'
    );
    const [start, end] = queryWindow(args, 'AKS control-plane logs');
    const category = String(args.category);
    const table =
      category === 'kube-audit'
        ? 'AKSAudit'
        : category === 'kube-audit-admin'
        ? 'AKSAuditAdmin'
        : 'AKSControlPlane';
    const categoryFilter =
      table === 'AKSControlPlane'
        ? `Category =~ '${escapeKql(category)}'`
        : `SourceTable == '${table}' or Category =~ '${escapeKql(category)}'`;
    const query = `union isfuzzy=true withsource=SourceTable ${table}, AzureDiagnostics\n| where _ResourceId =~ '${escapeKql(
      clusterId
    )}'\n| where ${categoryFilter}\n| order by TimeGenerated desc`;
    return toolResult(await logsQuery(this.getContext(), query, start, end));
  };
}

const NETWORK_TYPES = [
  'microsoft.network/networkinterfaces',
  'microsoft.network/networksecuritygroups',
  'microsoft.network/routetables',
  'microsoft.network/loadbalancers',
  'microsoft.network/natgateways',
  'microsoft.network/privateendpoints',
  'microsoft.network/privatednszones',
].map(type => `'${type}'`);

/** Read-only AKS network topology and effective NIC configuration. */
export class AzureNetworkConfigTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'azure_network_config_read',
    shortDescription: 'Inspect AKS network configuration',
    description:
      'Read AKS network topology or effective routes and security groups for a network interface.',
    schema: z.object({
      action: z
        .enum(['topology', 'effective_routes', 'effective_nsgs'])
        .describe('Read-only network operation'),
      resourceId: z
        .string()
        .describe('Full AKS cluster ID for topology, or network interface ID for effective data'),
    }),
  };

  handler: ToolHandler = async args => {
    const context = this.getContext();
    const action = String(args.action);
    if (action === 'topology') {
      const clusterId = validateResourceId(
        args.resourceId,
        'Microsoft.ContainerService/managedClusters'
      );
      const cluster = (await azureRequest(context, 'arm', armUrl(clusterId, '', '2024-07-01'))) as {
        properties?: { nodeResourceGroup?: unknown };
      };
      const nodeResourceGroup = cluster.properties?.nodeResourceGroup;
      if (typeof nodeResourceGroup !== 'string' || !nodeResourceGroup) {
        return toolResult({ cluster });
      }
      const subscriptionId = subscriptionFromResourceId(clusterId);
      const query = [
        'Resources',
        `| where subscriptionId =~ '${escapeKql(subscriptionId)}'`,
        `| where resourceGroup =~ '${escapeKql(
          nodeResourceGroup
        )}' or type =~ 'microsoft.network/privatednszones'`,
        `| where type in~ (${NETWORK_TYPES.join(', ')})`,
        '| project id, name, type, location, resourceGroup, properties',
        '| limit 100',
      ].join(' ');
      return toolResult({
        cluster,
        relatedResources: await resourceGraphQuery(context, [subscriptionId], query),
      });
    }
    if (action !== 'effective_routes' && action !== 'effective_nsgs') {
      throw new Error('Unsupported Azure network action');
    }
    const nicId = validateResourceId(args.resourceId, 'Microsoft.Network/networkInterfaces');
    const suffix =
      action === 'effective_routes' ? '/effectiveRouteTable' : '/effectiveNetworkSecurityGroups';
    const apiVersion = action === 'effective_routes' ? '2023-09-01' : '2024-09-01';
    return toolResult(
      await azureRequest(context, 'arm', armUrl(nicId, suffix, apiVersion), {
        method: 'POST',
      })
    );
  };
}

/** Read-only AKS capacity, autoscaler, quota, and utilization data. */
export class AzureCostCapacityTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'azure_cost_capacity_read',
    shortDescription: 'Inspect AKS capacity and utilization',
    description:
      'Read AKS cluster and node-pool capacity, autoscaler configuration, regional compute quotas, utilization metrics, or node resource-group infrastructure costs.',
    schema: z.object({
      action: z
        .enum(['cluster', 'node_pools', 'quotas', 'utilization', 'costs'])
        .describe('Read-only capacity or cost operation'),
      clusterResourceId: z.string().describe('Full AKS managed cluster resource ID'),
      location: z
        .string()
        .regex(/^[A-Za-z0-9-]+$/)
        .optional()
        .describe('Required for quotas: Azure cluster region'),
      metricNames: z
        .array(z.string().regex(/^[A-Za-z0-9_.-]+$/))
        .min(1)
        .max(20)
        .optional()
        .describe('Optional utilization metrics; defaults to node CPU and memory usage'),
      start: z.string().optional().describe('Utilization or cost start timestamp'),
      end: z.string().optional().describe('Utilization or cost end; maximum range 24 hours'),
    }),
  };

  handler: ToolHandler = async args => {
    const context = this.getContext();
    const clusterId = validateResourceId(
      args.clusterResourceId,
      'Microsoft.ContainerService/managedClusters'
    );
    const action = String(args.action);
    if (action === 'cluster') {
      return toolResult(await azureRequest(context, 'arm', armUrl(clusterId, '', '2024-07-01')));
    }
    if (action === 'node_pools') {
      return toolResult(
        await azureRequest(context, 'arm', armUrl(clusterId, '/agentPools', '2024-07-01'))
      );
    }
    if (action === 'quotas') {
      if (typeof args.location !== 'string' || !/^[A-Za-z0-9-]+$/.test(args.location)) {
        throw new Error('A valid Azure region is required for quota queries');
      }
      const subscriptionId = subscriptionFromResourceId(clusterId);
      const url = new URL(
        `${ARM_ORIGIN}/subscriptions/${subscriptionId}/providers/Microsoft.Compute/locations/${args.location}/usages`
      );
      url.searchParams.set('api-version', '2024-03-01');
      return toolResult(await azureRequest(context, 'arm', url));
    }
    if (action === 'costs') {
      const [start, end] = queryWindow(args, 'AKS costs');
      const subscriptionId = subscriptionFromResourceId(clusterId);
      const cluster = (await azureRequest(context, 'arm', armUrl(clusterId, '', '2024-07-01'))) as {
        properties?: { nodeResourceGroup?: unknown };
      };
      const nodeResourceGroup = cluster.properties?.nodeResourceGroup;
      if (typeof nodeResourceGroup !== 'string' || !nodeResourceGroup) {
        throw new Error('AKS node resource group is unavailable');
      }
      const url = new URL(
        `${ARM_ORIGIN}/subscriptions/${subscriptionId}/resourceGroups/${encodeURIComponent(
          nodeResourceGroup
        )}/providers/Microsoft.CostManagement/query?api-version=2023-03-01`
      );
      return toolResult(
        await azureRequest(context, 'arm', url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'Usage',
            timeframe: 'Custom',
            timePeriod: {
              from: new Date(start).toISOString(),
              to: new Date(end).toISOString(),
            },
            dataset: {
              granularity: 'Daily',
              aggregation: {
                totalCost: { name: 'PreTaxCost', function: 'Sum' },
              },
            },
          }),
        })
      );
    }
    if (action !== 'utilization') throw new Error('Unsupported Azure cost or capacity action');
    const metricNames =
      Array.isArray(args.metricNames) && args.metricNames.length
        ? (args.metricNames as string[])
        : ['node_cpu_usage_percentage', 'node_memory_usage_percentage'];
    const [start, end] = queryWindow(args, 'AKS utilization');
    const url = armUrl(clusterId, '/providers/microsoft.insights/metrics', '2023-10-01');
    url.searchParams.set('metricnames', metricNames.join(','));
    url.searchParams.set(
      'timespan',
      `${new Date(start).toISOString()}/${new Date(end).toISOString()}`
    );
    url.searchParams.set('aggregation', 'Average');
    return toolResult(await azureRequest(context, 'arm', url));
  };
}

/** Read-only Defender for Cloud recommendations and Azure Policy compliance. */
export class AzureSecurityPostureTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'azure_security_posture_read',
    shortDescription: 'Inspect AKS security posture',
    description:
      'Read bounded Defender for Cloud recommendations or Azure Policy compliance records.',
    schema: z.object({
      action: z.enum(['defender', 'policy']).describe('Security posture source'),
      clusterResourceId: z.string().describe('Full AKS managed cluster resource ID'),
    }),
  };

  handler: ToolHandler = async args => {
    const clusterId = validateResourceId(
      args.clusterResourceId,
      'Microsoft.ContainerService/managedClusters'
    );
    if (args.action !== 'defender' && args.action !== 'policy') {
      throw new Error('Unsupported Azure security posture action');
    }
    const url =
      args.action === 'defender'
        ? armUrl(clusterId, '/providers/Microsoft.Security/assessments', '2021-06-01')
        : armUrl(
            clusterId,
            '/providers/Microsoft.PolicyInsights/policyStates/latest/queryResults',
            '2019-10-01'
          );
    if (args.action === 'policy') {
      url.searchParams.set('$filter', "complianceState eq 'NonCompliant'");
      url.searchParams.set('$top', '100');
    }
    return toolResult(
      await azureRequest(
        this.getContext(),
        'arm',
        url,
        args.action === 'policy' ? { method: 'POST' } : undefined
      )
    );
  };
}

/** Read-only Azure Resource Graph deployment change history. */
export class AzureDeploymentChangesTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'azure_deployment_changes_read',
    shortDescription: 'Inspect Azure resource changes',
    description:
      'Read bounded Azure Resource Graph change history for one resource over at most 24 hours.',
    schema: z.object({
      resourceId: z.string().describe('Full Azure resource ID'),
      start: z.string().optional().describe('Timestamp; defaults to one hour before end'),
      end: z.string().optional().describe('Timestamp; defaults to now, maximum range 24 hours'),
    }),
  };

  handler: ToolHandler = async args => {
    const resourceId = validateResourceId(args.resourceId);
    const [start, end] = queryWindow(args, 'Azure deployment changes');
    const url = new URL(
      `${ARM_ORIGIN}/providers/Microsoft.ResourceGraph/resourceChanges?api-version=2024-04-01`
    );
    return toolResult(
      await azureRequest(this.getContext(), 'arm', url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceIds: [resourceId],
          interval: {
            start: new Date(start).toISOString(),
            end: new Date(end).toISOString(),
          },
          fetchPropertyChanges: true,
          $top: 100,
        }),
      })
    );
  };
}
