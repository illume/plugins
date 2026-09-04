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

import type { MCPServer } from '../types';

/** Supported read-only observability server presets. */
export type ObservabilityPreset = 'datadog' | 'splunk' | 'grafana' | 'prometheus';

/** Presets shown in the MCP server editor. */
export const OBSERVABILITY_PRESETS: readonly ObservabilityPreset[] = [
  'datadog',
  'splunk',
  'grafana',
  'prometheus',
];

/**
 * Creates an editable MCP server configuration for an observability provider.
 *
 * Placeholder values must be replaced before use. Write-capable Grafana tools
 * are explicitly disabled; the other servers expose queries or inherit the
 * read-only permissions of the configured backend identity.
 *
 * @param preset - Provider configuration to create.
 * @returns A new MCP server configuration.
 */
export function createObservabilityPreset(preset: ObservabilityPreset): MCPServer {
  switch (preset) {
    case 'datadog':
      return {
        name: 'datadog',
        command: 'npx',
        args: ['-y', 'mcp-remote@0.8.3', 'https://mcp.datadoghq.com/v1/mcp'],
        enabled: true,
        autoApprove: false,
      };
    case 'splunk':
      return {
        name: 'splunk',
        command: 'npx',
        args: ['-y', 'mcp-remote@0.8.3', 'https://YOUR_SPLUNK_HOST/services/mcp'],
        enabled: true,
        autoApprove: false,
      };
    case 'grafana':
      return {
        name: 'grafana',
        command: 'docker',
        args: [
          'run',
          '--rm',
          '-i',
          '-e',
          'GRAFANA_URL',
          '-e',
          'GRAFANA_SERVICE_ACCOUNT_TOKEN',
          'grafana/mcp-grafana:1.3.0',
          '-t',
          'stdio',
          '--disable-write',
        ],
        env: {
          GRAFANA_URL: 'https://YOUR_GRAFANA_HOST',
          GRAFANA_SERVICE_ACCOUNT_TOKEN: 'REPLACE_WITH_VIEWER_TOKEN',
        },
        enabled: true,
        autoApprove: false,
      };
    case 'prometheus':
      return {
        name: 'prometheus',
        command: 'docker',
        args: [
          'run',
          '--rm',
          '-i',
          '-e',
          'PROMETHEUS_URL',
          'ghcr.io/pab1it0/prometheus-mcp-server:v1.6.2',
        ],
        env: { PROMETHEUS_URL: 'https://YOUR_PROMETHEUS_HOST' },
        enabled: true,
        autoApprove: false,
      };
  }
}
