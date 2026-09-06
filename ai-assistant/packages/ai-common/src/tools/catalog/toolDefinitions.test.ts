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

import { describe, expect, it } from 'vitest';
import {
  getAllAvailableTools,
  isBuiltInTool,
  isObservabilityBuiltInTool,
  isSensitiveBuiltInToolCall,
} from './toolDefinitions';

describe('toolDefinitions', () => {
  it('returns the built-in tools', () => {
    expect(getAllAvailableTools()).toEqual([
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
    ]);
  });

  it('identifies tools in the built-in registry', () => {
    expect(isBuiltInTool('kubernetes_api_request')).toBe(true);
    expect(isBuiltInTool('prometheus_read')).toBe(true);
    expect(isBuiltInTool('azure_monitor_traces_read')).toBe(true);
    expect(isBuiltInTool('azure_metrics_read')).toBe(true);
    expect(isBuiltInTool('github__search')).toBe(false);
  });

  it('identifies only native observability tools for persistent approval', () => {
    expect(isObservabilityBuiltInTool('prometheus_read')).toBe(true);
    expect(isObservabilityBuiltInTool('azure_security_posture_read')).toBe(true);
    expect(isObservabilityBuiltInTool('kubernetes_api_request')).toBe(false);
    expect(isObservabilityBuiltInTool('github__search')).toBe(false);
  });

  it('flags Kubernetes Secret access as sensitive, other reads as not', () => {
    expect(
      isSensitiveBuiltInToolCall('kubernetes_api_request', {
        url: '/api/v1/namespaces/default/secrets/db',
        method: 'GET',
      })
    ).toBe(true);
    expect(
      isSensitiveBuiltInToolCall('kubernetes_api_request', {
        url: '/api/v1/secrets',
        method: 'GET',
      })
    ).toBe(true);
    expect(
      isSensitiveBuiltInToolCall('kubernetes_api_request', {
        url: '/api/v1/namespaces/default/pods?labelSelector=x',
        method: 'GET',
      })
    ).toBe(false);
    // Not a built-in tool, or missing/invalid url.
    expect(isSensitiveBuiltInToolCall('github__search', { url: '/secrets' })).toBe(false);
    expect(isSensitiveBuiltInToolCall('kubernetes_api_request', {})).toBe(false);
    expect(isSensitiveBuiltInToolCall('kubernetes_api_request', null)).toBe(false);
    expect(isSensitiveBuiltInToolCall('prometheus_read', { query: 'up' })).toBe(true);
    expect(isSensitiveBuiltInToolCall('grafana_read', { action: 'datasources' })).toBe(true);
    expect(isSensitiveBuiltInToolCall('azure_monitor_traces_read', {})).toBe(true);
    expect(isSensitiveBuiltInToolCall('azure_security_posture_read', {})).toBe(true);
  });

  it('normalizes encoded and fragmented Kubernetes Secret URLs', () => {
    expect(isSensitiveBuiltInToolCall('kubernetes_api_request', { url: '/api/v1/%73ecrets' })).toBe(
      true
    );
    expect(
      isSensitiveBuiltInToolCall('kubernetes_api_request', {
        url: '/api/v1/namespaces/default/secrets#item',
      })
    ).toBe(true);
    expect(
      isSensitiveBuiltInToolCall('kubernetes_api_request', {
        url: 'https://cluster.example/api/v1//SeCrEtS/db',
      })
    ).toBe(true);
    expect(isSensitiveBuiltInToolCall('kubernetes_api_request', { url: '/api/v1/%E0%A4%A' })).toBe(
      true
    );
  });
});
