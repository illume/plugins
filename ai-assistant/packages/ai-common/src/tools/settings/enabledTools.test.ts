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
import { getEnabledToolIds, isToolEnabled, setEnabledTools, toggleTool } from './enabledTools';

const toolId = 'kubernetes_api_request';
const observabilityToolIds = [
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
];
const disabledObservabilityTools = Object.fromEntries(observabilityToolIds.map(id => [id, false]));

describe('isToolEnabled', () => {
  it('defaults null settings to enabled', () => {
    expect(isToolEnabled(null, toolId)).toBe(true);
  });

  it('defaults missing enabledTools to enabled', () => {
    expect(isToolEnabled({}, toolId)).toBe(true);
  });

  it('returns true for an explicitly enabled tool', () => {
    expect(isToolEnabled({ enabledTools: { [toolId]: true } }, toolId)).toBe(true);
  });

  it('returns false for an explicitly disabled tool', () => {
    expect(isToolEnabled({ enabledTools: { [toolId]: false } }, toolId)).toBe(false);
  });

  it('defaults unknown tools to enabled for map settings', () => {
    expect(isToolEnabled({ enabledTools: { other: false } }, 'unknown-tool')).toBe(true);
  });

  it('treats malformed enabledTools values as missing', () => {
    for (const enabledTools of [true, 'yes', 42]) {
      expect(() => isToolEnabled({ enabledTools }, toolId)).not.toThrow();
      expect(isToolEnabled({ enabledTools }, toolId)).toBe(true);
    }
  });

  it('supports the string-array settings format', () => {
    expect(isToolEnabled({ enabledTools: [toolId] }, toolId)).toBe(true);
    expect(isToolEnabled({ enabledTools: [] }, toolId)).toBe(false);
    expect(isToolEnabled({ enabledTools: ['other-tool'] }, toolId)).toBe(false);
  });
});

describe('toggleTool', () => {
  it('turns a default-enabled tool off on the first call', () => {
    const disabled = toggleTool({}, toolId);
    const enabled = toggleTool(disabled, toolId);
    expect(disabled.enabledTools).toEqual({ [toolId]: false });
    expect(enabled.enabledTools).toEqual({ [toolId]: true });
  });

  it('accepts null and undefined settings', () => {
    expect(toggleTool(null, toolId).enabledTools).toEqual({ [toolId]: false });
    expect(toggleTool(undefined, toolId).enabledTools).toEqual({ [toolId]: false });
  });

  it('normalizes malformed enabledTools values to a map', () => {
    expect(toggleTool({ enabledTools: true }, toolId).enabledTools).toEqual({ [toolId]: false });
    expect(toggleTool({ enabledTools: 'yes' }, toolId).enabledTools).toEqual({ [toolId]: false });
  });

  it('preserves the string-array format and unrelated IDs', () => {
    expect(toggleTool({ enabledTools: [toolId] }, toolId).enabledTools).toEqual([]);
    expect(toggleTool({ enabledTools: [] }, toolId).enabledTools).toEqual([toolId]);
    expect(toggleTool({ enabledTools: ['other-tool', toolId] }, toolId).enabledTools).toEqual([
      'other-tool',
    ]);
  });
});

describe('enabled tool collections', () => {
  it('returns enabled built-in tool IDs', () => {
    expect(getEnabledToolIds({ enabledTools: { [toolId]: false } })).toEqual(observabilityToolIds);
    expect(getEnabledToolIds({ enabledTools: { [toolId]: true } })).toEqual([
      toolId,
      ...observabilityToolIds,
    ]);
  });

  it('stores enabled built-in tools in map settings', () => {
    expect(setEnabledTools({}, [toolId])).toEqual({
      enabledTools: { [toolId]: true, ...disabledObservabilityTools },
    });
    expect(setEnabledTools({}, [])).toEqual({
      enabledTools: { [toolId]: false, ...disabledObservabilityTools },
    });
  });

  it('preserves the string-array settings format', () => {
    expect(setEnabledTools({ enabledTools: ['other-tool'] }, [toolId]).enabledTools).toEqual([
      toolId,
    ]);
    expect(setEnabledTools({ enabledTools: [toolId] }, []).enabledTools).toEqual([]);
  });

  it('accepts null and undefined settings', () => {
    expect(setEnabledTools(null, [toolId]).enabledTools).toEqual({
      [toolId]: true,
      ...disabledObservabilityTools,
    });
    expect(setEnabledTools(undefined, []).enabledTools).toEqual({
      [toolId]: false,
      ...disabledObservabilityTools,
    });
  });
});
