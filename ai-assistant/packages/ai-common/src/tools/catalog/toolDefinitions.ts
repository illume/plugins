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

/** Describes a tool exposed to the assistant and settings UI. */
export interface ToolInfo {
  /** Stable identifier used to configure and invoke the tool. */
  id: string;
  /** Human-readable tool name shown in settings. */
  name: string;
  /** Summary of the operations the tool performs. */
  description: string;
  /** Catalog source that provides the tool. */
  source: 'built-in' | 'mcp';
}

const AVAILABLE_TOOLS: readonly ToolInfo[] = [
  {
    id: 'kubernetes_api_request',
    name: 'Kubernetes API Request',
    description:
      'Make requests to the Kubernetes API server to fetch, create, update or delete resources.',
    source: 'built-in',
  },
  {
    id: 'datadog_read',
    name: 'Datadog Read',
    description: 'Query Datadog logs, metrics, and monitors without changing data.',
    source: 'built-in',
  },
  {
    id: 'splunk_read',
    name: 'Splunk Read',
    description: 'Run guarded Splunk searches and inspect indexes or saved searches.',
    source: 'built-in',
  },
  {
    id: 'grafana_read',
    name: 'Grafana Read',
    description: 'Search and inspect Grafana dashboards and datasources.',
    source: 'built-in',
  },
  {
    id: 'prometheus_read',
    name: 'Prometheus Read',
    description: 'Query Prometheus metrics, metadata, and active targets.',
    source: 'built-in',
  },
  {
    id: 'azure_monitor_traces_read',
    name: 'Azure Monitor Traces Read',
    description: 'Query bounded AKS and application traces from Azure Monitor Logs.',
    source: 'built-in',
  },
  {
    id: 'azure_metrics_read',
    name: 'Azure Metrics Read',
    description: 'Read bounded Azure Monitor metric values for Azure resources.',
    source: 'built-in',
  },
  {
    id: 'azure_resource_health_read',
    name: 'Azure Resource Health Read',
    description: 'Inspect current and historical Azure resource availability.',
    source: 'built-in',
  },
  {
    id: 'azure_application_insights_read',
    name: 'Azure Application Insights Read',
    description: 'Run bounded KQL over Application Insights telemetry.',
    source: 'built-in',
  },
  {
    id: 'azure_diagnostics_read',
    name: 'Azure Diagnostics Read',
    description: 'Inspect AKS diagnostic settings and supported categories.',
    source: 'built-in',
  },
  {
    id: 'azure_control_plane_logs_read',
    name: 'Azure Control Plane Logs Read',
    description: 'Query bounded AKS control-plane and audit logs.',
    source: 'built-in',
  },
  {
    id: 'azure_network_config_read',
    name: 'Azure Network Config Read',
    description: 'Inspect AKS network topology, effective routes, and effective NSGs.',
    source: 'built-in',
  },
  {
    id: 'azure_cost_capacity_read',
    name: 'Azure Cost Capacity Read',
    description: 'Inspect AKS node capacity, quotas, autoscaler state, and utilization.',
    source: 'built-in',
  },
  {
    id: 'azure_security_posture_read',
    name: 'Azure Security Posture Read',
    description: 'Inspect Defender recommendations and Azure Policy compliance.',
    source: 'built-in',
  },
  {
    id: 'azure_deployment_changes_read',
    name: 'Azure Deployment Changes Read',
    description: 'Inspect bounded Azure Resource Graph change history.',
    source: 'built-in',
  },
];

const OBSERVABILITY_TOOL_IDS = new Set([
  'datadog_read',
  'splunk_read',
  'grafana_read',
  'prometheus_read',
  'azure_monitor_traces_read',
  'azure_metrics_read',
  'azure_resource_health_read',
  'azure_application_insights_read',
  'azure_diagnostics_read',
  'azure_control_plane_logs_read',
  'azure_network_config_read',
  'azure_cost_capacity_read',
  'azure_security_posture_read',
  'azure_deployment_changes_read',
]);

/**
 * Returns a copy of the built-in tool catalog.
 *
 * @returns A new array containing all built-in tool definitions.
 */
export function getAllAvailableTools(): ToolInfo[] {
  return [...AVAILABLE_TOOLS];
}

/**
 * Checks whether a tool identifier belongs to the built-in catalog.
 *
 * @param toolName - Tool identifier to check.
 * @returns Whether the catalog contains an exact identifier match.
 */
export function isBuiltInTool(toolName: string): boolean {
  return AVAILABLE_TOOLS.some(tool => tool.id === toolName);
}

/**
 * Checks whether a tool is one of the native read-only observability tools.
 *
 * @param toolName - Tool identifier to check.
 * @returns Whether the tool is in the observability catalog.
 */
export function isObservabilityBuiltInTool(toolName: string): boolean {
  return OBSERVABILITY_TOOL_IDS.has(toolName);
}

/**
 * Determines whether a built-in tool call touches sensitive resources and must
 * not be silently auto-approved.
 *
 * Built-in tool calls are normally auto-approved for a smooth read experience,
 * but access to Kubernetes `Secret` objects can expose credential material to
 * the model provider, so those calls are routed through the human approval gate
 * as defense-in-depth (secret values are also redacted before reaching the LLM).
 *
 * @param toolName - Tool identifier being invoked.
 * @param args - Arguments the model supplied for the call.
 * @returns Whether the call should require explicit approval.
 */
export function isSensitiveBuiltInToolCall(toolName: string, args: unknown): boolean {
  if (isObservabilityBuiltInTool(toolName)) {
    return true;
  }
  if (toolName !== 'kubernetes_api_request') {
    return false;
  }
  const url = (args as { url?: unknown } | null | undefined)?.url;
  if (typeof url !== 'string') {
    return false;
  }
  try {
    const parsed = new URL(url, 'https://kubernetes.invalid');
    const segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map(segment => decodeURIComponent(segment).toLowerCase());
    return segments.includes('secrets');
  } catch {
    return true;
  }
}
