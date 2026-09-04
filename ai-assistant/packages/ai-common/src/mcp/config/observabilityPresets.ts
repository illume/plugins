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
 * Placeholder values must be replaced before use. The remote servers require
 * no local executable; read-only access is enforced by their backend identity
 * and server deployment.
 *
 * @param preset - Provider configuration to create.
 * @returns A new MCP server configuration.
 */
export function createObservabilityPreset(preset: ObservabilityPreset): MCPServer {
  switch (preset) {
    case 'datadog':
      return {
        name: 'datadog',
        transport: 'http',
        command: '',
        args: [],
        url: 'https://mcp.datadoghq.com/v1/mcp',
        headers: {
          'DD-API-KEY': 'REPLACE_WITH_API_KEY',
          'DD-APPLICATION-KEY': 'REPLACE_WITH_APPLICATION_KEY',
        },
        enabled: true,
        autoApprove: false,
      };
    case 'splunk':
      return {
        name: 'splunk',
        transport: 'http',
        command: '',
        args: [],
        url: 'https://YOUR_SPLUNK_HOST/services/mcp',
        headers: { Authorization: 'REPLACE_WITH_AUTHORIZATION_VALUE' },
        enabled: true,
        autoApprove: false,
      };
    case 'grafana':
      return {
        name: 'grafana',
        transport: 'http',
        command: '',
        args: [],
        url: 'https://YOUR_GRAFANA_MCP_HOST/mcp',
        headers: { Authorization: 'REPLACE_WITH_AUTHORIZATION_VALUE' },
        enabled: true,
        autoApprove: false,
      };
    case 'prometheus':
      return {
        name: 'prometheus',
        transport: 'http',
        command: '',
        args: [],
        url: 'https://YOUR_PROMETHEUS_MCP_HOST/mcp',
        enabled: true,
        autoApprove: false,
      };
  }
}
