import { describe, expect, it, vi } from 'vitest';
import {
  AzureApplicationInsightsTool,
  AzureControlPlaneLogsTool,
  AzureCostCapacityTool,
  AzureDeploymentChangesTool,
  AzureDiagnosticsTool,
  AzureMetricsTool,
  AzureNetworkConfigTool,
  AzureResourceHealthTool,
  AzureSecurityPostureTool,
} from './AzureAksTools';
import type { ObservabilityConfig, ObservabilityTool } from './ObservabilityTools';

const clusterId =
  '/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/aks-rg/providers/Microsoft.ContainerService/managedClusters/demo';
const nicId =
  '/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/MC_aks-rg_demo_westeurope/providers/Microsoft.Network/networkInterfaces/node-nic';
const config: ObservabilityConfig = {
  azureMonitor: {
    baseUrl: 'https://api.loganalytics.azure.com/v1/workspaces/workspace-id',
    token: 'logs-token',
    managementToken: 'arm-token',
  },
};

function response(data: unknown = { value: [] }, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), { status: 200, ...init });
}

function configure<T extends ObservabilityTool>(tool: T, fetch: typeof globalThis.fetch): T {
  tool.setContext({ config, fetch });
  return tool;
}

describe('safe Azure and AKS troubleshooting tools', () => {
  it('queries bounded Azure metric values with a GET request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
    const tool = configure(new AzureMetricsTool(), fetch);

    await tool.handler({
      resourceId: clusterId,
      metricNames: ['node_cpu_usage_percentage'],
      start: '2026-09-05T00:00:00Z',
      end: '2026-09-05T01:00:00Z',
      interval: 'PT5M',
    });

    const [requestUrl, init] = fetch.mock.calls[0];
    const url = new URL(String(requestUrl));
    expect(init?.method).toBeUndefined();
    expect(url.pathname).toBe(`${clusterId}/providers/microsoft.insights/metrics`);
    expect(url.searchParams.get('metricnames')).toBe('node_cpu_usage_percentage');
    expect(url.searchParams.get('timespan')).toBe(
      '2026-09-05T00:00:00.000Z/2026-09-05T01:00:00.000Z'
    );
    expect(new Headers(init?.headers).get('Authorization')).toBe(['Bearer', 'arm-token'].join(' '));
  });

  it('queries Resource Health history at resource scope', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
    const tool = configure(new AzureResourceHealthTool(), fetch);

    await tool.handler({ resourceId: clusterId, action: 'history' });

    expect(String(fetch.mock.calls[0][0])).toBe(
      `https://management.azure.com${clusterId}/providers/Microsoft.ResourceHealth/availabilityStatuses?api-version=2025-05-01`
    );
  });

  it('runs bounded Application Insights KQL and blocks external data access', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response({ tables: [] }));
    const tool = configure(new AzureApplicationInsightsTool(), fetch);

    await tool.handler({
      query: 'AppExceptions | order by TimeGenerated desc',
      start: '2026-09-05T00:00:00Z',
      end: '2026-09-05T01:00:00Z',
    });

    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      query: 'AppExceptions | order by TimeGenerated desc\n| take 100',
      timespan: '2026-09-05T00:00:00.000Z/2026-09-05T01:00:00.000Z',
    });

    await expect(
      tool.handler({ query: 'externaldata(value:string)["https://example.invalid/data"]' })
    ).rejects.toThrow('disallowed');
    await expect(
      tool.handler({ query: 'externaldata/* bypass */(value:string)["https://example.invalid"]' })
    ).rejects.toThrow('disallowed');
  });

  it('does not send an automatically acquired Logs token to a custom endpoint', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
    const commandRunner = vi.fn().mockResolvedValue({ stdout: 'logs-token', exitCode: 0 });
    const tool = new AzureApplicationInsightsTool();
    tool.setContext({
      config: {
        azureMonitor: { baseUrl: 'https://proxy.example/v1/workspaces/workspace-id' },
      },
      fetch,
      commandRunner,
    });

    await expect(tool.handler({ query: 'AppRequests' })).rejects.toThrow(
      'Azure CLI tokens can only be sent to api.loganalytics.azure.com'
    );
    expect(commandRunner).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('allows an explicitly authenticated IPv6 loopback Logs endpoint', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response({ tables: [] }));
    const tool = new AzureApplicationInsightsTool();
    tool.setContext({
      config: {
        azureMonitor: {
          baseUrl: 'http://[::1]:8080/v1/workspaces/workspace-id',
          token: 'local-token',
        },
      },
      fetch,
    });

    await expect(tool.handler({ query: 'AppRequests' })).resolves.toMatchObject({ success: true });
    expect(String(fetch.mock.calls[0][0])).toBe(
      'http://[::1]:8080/v1/workspaces/workspace-id/query'
    );
  });

  it('lists AKS diagnostic settings without accepting arbitrary paths', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
    const tool = configure(new AzureDiagnosticsTool(), fetch);

    await tool.handler({ clusterResourceId: clusterId, action: 'settings' });

    expect(String(fetch.mock.calls[0][0])).toContain(
      `${clusterId}/providers/microsoft.insights/diagnosticSettings?api-version=2021-05-01-preview`
    );
    await expect(
      tool.handler({ clusterResourceId: `${clusterId}?api-version=unsafe`, action: 'settings' })
    ).rejects.toThrow('valid Azure resource ID');
    await expect(
      tool.handler({
        clusterResourceId: `${clusterId}' | take 1`,
        action: 'settings',
      })
    ).rejects.toThrow('valid Azure resource ID');
  });

  it('generates fixed, resource-scoped control-plane log queries', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response({ tables: [] }));
    const tool = configure(new AzureControlPlaneLogsTool(), fetch);

    await tool.handler({
      clusterResourceId: clusterId,
      category: 'kube-apiserver',
      start: '2026-09-05T00:00:00Z',
      end: '2026-09-05T01:00:00Z',
    });

    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(body.query).toContain(
      "union isfuzzy=true withsource=SourceTable AKSControlPlane, AzureDiagnostics\n| where _ResourceId =~ '"
    );
    expect(body.query).toContain("| where Category =~ 'kube-apiserver'");
    expect(body.query).toContain('| take 100');
  });

  it('reads AKS network topology and related network resources', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ properties: { nodeResourceGroup: 'MC_aks' } }))
      .mockResolvedValueOnce(response({ data: [] }));
    const tool = configure(new AzureNetworkConfigTool(), fetch);

    await tool.handler({ action: 'topology', resourceId: clusterId });

    expect(String(fetch.mock.calls[0][0])).toContain(`${clusterId}?api-version=2024-07-01`);
    const graphBody = JSON.parse(String(fetch.mock.calls[1][1]?.body));
    expect(graphBody.query).toContain("resourceGroup =~ 'MC_aks'");
    expect(graphBody.query).toContain('microsoft.network/privatednszones');
  });

  it('uses only allowlisted effective network read actions and polls accepted requests', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response('', {
          status: 202,
          headers: {
            location:
              'https://management.azure.com/subscriptions/00000000-0000-0000-0000-000000000001/providers/Microsoft.Network/locations/westeurope/operations/read',
            'retry-after': '0',
          },
        })
      )
      .mockResolvedValueOnce(response({ value: [{ source: 'Default' }] }));
    const tool = configure(new AzureNetworkConfigTool(), fetch);

    await tool.handler({ action: 'effective_routes', resourceId: nicId });

    expect(fetch.mock.calls[0][1]?.method).toBe('POST');
    expect(String(fetch.mock.calls[0][0])).toContain('/effectiveRouteTable?api-version=2023-09-01');
    expect(fetch.mock.calls[1][1]?.method).toBeUndefined();
  });

  it('continues polling while an Azure async operation remains in progress', async () => {
    const operationUrl =
      'https://management.azure.com/subscriptions/00000000-0000-0000-0000-000000000001/providers/Microsoft.Network/locations/westeurope/operations/read';
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response('', {
          status: 202,
          headers: { location: operationUrl, 'retry-after': '0' },
        })
      )
      .mockResolvedValueOnce(
        response({ status: 'InProgress' }, { headers: { 'retry-after': '0' } })
      )
      .mockResolvedValueOnce(response({ value: [{ source: 'Default' }] }));
    const tool = configure(new AzureNetworkConfigTool(), fetch);

    const result = await tool.handler({ action: 'effective_routes', resourceId: nicId });

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(result.data).toEqual({ value: [{ source: 'Default' }] });
  });

  it('uses a one-second polling delay when Azure omits Retry-After', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(
          new Response('', {
            status: 202,
            headers: {
              location:
                'https://management.azure.com/subscriptions/00000000-0000-0000-0000-000000000001/providers/Microsoft.Network/locations/westeurope/operations/read',
            },
          })
        )
        .mockResolvedValueOnce(response({ value: [] }));
      const tool = configure(new AzureNetworkConfigTool(), fetch);

      const resultPromise = tool.handler({ action: 'effective_routes', resourceId: nicId });
      await vi.advanceTimersByTimeAsync(999);
      expect(fetch).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await expect(resultPromise).resolves.toMatchObject({ success: true });
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects path traversal in Azure quota locations', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
    const tool = configure(new AzureCostCapacityTool(), fetch);

    await expect(
      tool.handler({
        action: 'quotas',
        clusterResourceId: clusterId,
        location: '../../providers/Microsoft.Authorization/roleAssignments',
      })
    ).rejects.toThrow('valid Azure region');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads node pools, quotas, autoscaler state, utilization, and scoped costs', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async input =>
      String(input) === `https://management.azure.com${clusterId}?api-version=2024-07-01`
        ? response({ properties: { nodeResourceGroup: 'MC_aks' } })
        : response()
    );
    const tool = configure(new AzureCostCapacityTool(), fetch);

    await tool.handler({ action: 'node_pools', clusterResourceId: clusterId });
    await tool.handler({
      action: 'quotas',
      clusterResourceId: clusterId,
      location: 'westeurope',
    });
    await tool.handler({ action: 'utilization', clusterResourceId: clusterId });
    await tool.handler({
      action: 'costs',
      clusterResourceId: clusterId,
      start: '2026-09-05T00:00:00Z',
      end: '2026-09-05T01:00:00Z',
    });

    expect(String(fetch.mock.calls[0][0])).toContain('/agentPools?api-version=2024-07-01');
    expect(String(fetch.mock.calls[1][0])).toContain(
      '/providers/Microsoft.Compute/locations/westeurope/usages?api-version=2024-03-01'
    );
    expect(String(fetch.mock.calls[2][0])).toContain(
      'metricnames=node_cpu_usage_percentage%2Cnode_memory_usage_percentage'
    );
    expect(String(fetch.mock.calls[3][0])).toBe(
      `https://management.azure.com${clusterId}?api-version=2024-07-01`
    );
    expect(String(fetch.mock.calls[4][0])).toContain(
      '/resourceGroups/MC_aks/providers/Microsoft.CostManagement/query'
    );
    const costBody = JSON.parse(String(fetch.mock.calls[4][1]?.body));
    expect(costBody.dataset.filter).toBeUndefined();
  });

  it.each([
    ['defender', '/providers/Microsoft.Security/assessments?api-version=2021-06-01'],
    [
      'policy',
      '/providers/Microsoft.PolicyInsights/policyStates/latest/queryResults?api-version=2019-10-01',
    ],
  ] as const)('reads %s security posture through a fixed endpoint', async (action, path) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response());
    const tool = configure(new AzureSecurityPostureTool(), fetch);

    await tool.handler({ action, clusterResourceId: clusterId });

    expect(String(fetch.mock.calls[0][0])).toContain(`${clusterId}${path}`);
    expect(fetch.mock.calls[0][1]?.method).toBe(action === 'policy' ? 'POST' : undefined);
  });

  it('reads bounded deployment change history for one resource', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response({ changes: [] }));
    const tool = configure(new AzureDeploymentChangesTool(), fetch);

    await tool.handler({
      resourceId: clusterId,
      start: '2026-09-05T00:00:00Z',
      end: '2026-09-05T01:00:00Z',
    });

    expect(String(fetch.mock.calls[0][0])).toBe(
      'https://management.azure.com/providers/Microsoft.ResourceGraph/resourceChanges?api-version=2024-04-01'
    );
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      resourceIds: [clusterId],
      interval: {
        start: '2026-09-05T00:00:00.000Z',
        end: '2026-09-05T01:00:00.000Z',
      },
      fetchPropertyChanges: true,
      $top: 100,
    });
  });
});
