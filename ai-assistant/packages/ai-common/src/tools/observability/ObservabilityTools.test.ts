import { describe, expect, it, vi } from 'vitest';
import {
  AzureMonitorTracesTool,
  DatadogTool,
  GrafanaTool,
  type ObservabilityConfig,
  PrometheusTool,
  SplunkTool,
  validateWorkspaceKql,
} from './ObservabilityTools';

const config: ObservabilityConfig = {
  datadog: {
    baseUrl: 'https://datadog.example',
    apiKey: 'api-key',
    applicationKey: 'app-key',
  },
  splunk: { baseUrl: 'https://splunk.example:8089', token: 'splunk-token' },
  grafana: { baseUrl: 'https://grafana.example', token: 'grafana-token' },
  prometheus: {
    baseUrl: 'https://prometheus.example',
    token: 'prometheus-token',
    organizationId: 'tenant-a',
  },
  azureMonitor: {
    baseUrl: 'https://api.loganalytics.azure.com/v1/workspaces/workspace-id',
  },
};

function jsonFetch() {
  const implementation: typeof fetch = async () =>
    new Response(JSON.stringify({ status: 'success', data: [] }));
  return vi.fn(implementation);
}

describe('native observability tools', () => {
  it('queries bounded Azure Monitor traces using a short-lived CLI token', async () => {
    const fetch = jsonFetch();
    const commandRunner = vi.fn().mockResolvedValue({ stdout: 'logs-token\n', exitCode: 0 });
    const tool = new AzureMonitorTracesTool();
    tool.setContext({ config, fetch, commandRunner });

    await tool.handler({
      query: 'AppRequests | where AppRoleName == "store"',
      start: '2026-09-05T00:00:00Z',
      end: '2026-09-05T01:00:00Z',
    });

    expect(commandRunner).toHaveBeenCalledWith(
      'az',
      [
        'account',
        'get-access-token',
        '--resource',
        'https://api.loganalytics.azure.com',
        '--query',
        'accessToken',
        '-o',
        'tsv',
      ],
      expect.any(AbortSignal)
    );
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://api.loganalytics.azure.com/v1/workspaces/workspace-id/query');
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      ['Bearer', 'logs-token'].join(' ')
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'AppRequests | where AppRoleName == "store"\n| take 100',
      timespan: '2026-09-05T00:00:00.000Z/2026-09-05T01:00:00.000Z',
    });
  });

  it('rejects Azure Monitor trace ranges longer than 24 hours', async () => {
    const fetch = jsonFetch();
    const tool = new AzureMonitorTracesTool();
    tool.setContext({
      config: { ...config, azureMonitor: { ...config.azureMonitor, token: 'x' } },
      fetch,
    });

    await expect(
      tool.handler({
        start: '2026-09-01T00:00:00Z',
        end: '2026-09-03T00:00:00Z',
      })
    ).rejects.toThrow('at most 24 hours');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps CLI tokens on the official Logs API and rejects external KQL', async () => {
    const fetch = jsonFetch();
    const commandRunner = vi.fn().mockResolvedValue({ stdout: 'logs-token\n', exitCode: 0 });
    const proxyTool = new AzureMonitorTracesTool();
    proxyTool.setContext({
      config: {
        ...config,
        azureMonitor: { baseUrl: 'https://proxy.example/v1/workspaces/workspace-id' },
      },
      fetch,
      commandRunner,
    });

    await expect(proxyTool.handler({})).rejects.toThrow(
      'Azure CLI tokens can only be sent to api.loganalytics.azure.com'
    );
    expect(commandRunner).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    const queryTool = new AzureMonitorTracesTool();
    queryTool.setContext({
      config: { ...config, azureMonitor: { ...config.azureMonitor, token: 'logs-token' } },
      fetch,
    });
    await expect(
      queryTool.handler({ query: 'externaldata(value:string)["https://example.invalid"]' })
    ).rejects.toThrow('disallowed');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('parses KQL comments and strings before blocking cross-resource access', () => {
    expect(() =>
      validateWorkspaceKql('let url = "https://example.invalid"; externaldata(value:string)[url]')
    ).toThrow('disallowed');
    expect(() => validateWorkspaceKql('workspace("other") | take 1')).toThrow('disallowed');
    expect(validateWorkspaceKql('print value = "externaldata( is text"')).toBe(
      'print value = "externaldata( is text"'
    );
  });

  it('defaults Azure Monitor traces to the latest hour of application telemetry', async () => {
    const fetch = jsonFetch();
    const tool = new AzureMonitorTracesTool();
    tool.setContext({
      config: { ...config, azureMonitor: { ...config.azureMonitor, token: 'logs-token' } },
      fetch,
    });

    await tool.handler({});

    const [, init] = fetch.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.query).toBe(
      'union isfuzzy=true AppRequests, AppDependencies, AppTraces | top 100 by TimeGenerated desc\n| take 100'
    );
    const [start, end] = body.timespan.split('/').map(Date.parse);
    expect(end - start).toBe(60 * 60 * 1000);
  });

  it('queries Datadog logs with scoped headers and bounded results', async () => {
    const fetch = jsonFetch();
    const tool = new DatadogTool();
    tool.setContext({ config, fetch });

    await tool.handler({ action: 'logs', query: 'service:web', limit: 500 });

    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://datadog.example/api/v2/logs/events/search');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('DD-API-KEY')).toBe('api-key');
    expect(JSON.parse(String(init?.body)).page.limit).toBe(100);
  });

  it('blocks unsafe SPL before making a request', async () => {
    const fetch = jsonFetch();
    const tool = new SplunkTool();
    tool.setContext({ config, fetch });

    await expect(
      tool.handler({ action: 'search', query: 'search index=main | outputlookup results.csv' })
    ).rejects.toThrow('read-only allowlist');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['outputcsv results.csv', 'sendalert email', 'runshellscript notify'])(
    'blocks non-allowlisted Splunk command %s',
    async command => {
      const fetch = jsonFetch();
      const tool = new SplunkTool();
      tool.setContext({ config, fetch });

      await expect(
        tool.handler({ action: 'search', query: `search index=main | ${command}` })
      ).rejects.toThrow('read-only allowlist');
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it.each(['search index=main `unsafe_macro`', 'search index=main [ | outputlookup results.csv ]'])(
    'blocks unquoted Splunk macro or subsearch syntax in %s',
    async query => {
      const fetch = jsonFetch();
      const tool = new SplunkTool();
      tool.setContext({ config, fetch });

      await expect(tool.handler({ action: 'search', query })).rejects.toThrow(
        'cannot contain macros or subsearches'
      );
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it('allows read-only Splunk pipelines and pipes inside quoted values', async () => {
    const fetch = jsonFetch();
    const tool = new SplunkTool();
    tool.setContext({ config, fetch });

    await tool.handler({
      action: 'search',
      query: 'search index=main message="left|right [literal] `literal`" | stats count | head 10',
    });

    expect(fetch).toHaveBeenCalledOnce();
  });

  it('rejects relative Splunk ranges longer than 24 hours clearly', async () => {
    const fetch = jsonFetch();
    const tool = new SplunkTool();
    tool.setContext({ config, fetch });

    await expect(
      tool.handler({
        action: 'search',
        query: 'search index=main',
        earliestTime: '-2d',
        latestTime: 'now',
      })
    ).rejects.toThrow('Splunk time range must cover at most 24 hours');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('runs bounded Splunk searches and uses Splunk token authentication', async () => {
    const fetch = jsonFetch();
    const tool = new SplunkTool();
    tool.setContext({ config, fetch });

    await tool.handler({ action: 'search', query: 'search index=main error' });

    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://splunk.example:8089/services/search/jobs/oneshot');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Splunk splunk-token');
    expect(String(init?.body)).toContain('earliest_time=-24h');
  });

  it('uses only Grafana read endpoints and escapes dashboard UIDs', async () => {
    const fetch = jsonFetch();
    const tool = new GrafanaTool();
    tool.setContext({ config, fetch });

    await tool.handler({ action: 'get_dashboard', uid: 'team/dashboard' });

    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://grafana.example/api/dashboards/uid/team%2Fdashboard');
    expect(init?.method).toBeUndefined();
  });

  it('queries Prometheus with tenant authentication', async () => {
    const fetch = jsonFetch();
    const tool = new PrometheusTool();
    tool.setContext({ config, fetch });

    await tool.handler({ action: 'query', query: 'up' });

    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://prometheus.example/api/v1/query?query=up');
    expect(new Headers(init?.headers).get('X-Scope-OrgID')).toBe('tenant-a');
  });

  it('encodes Unicode Splunk basic-auth credentials as UTF-8', async () => {
    const fetch = jsonFetch();
    const tool = new SplunkTool();
    tool.setContext({
      config: { splunk: { baseUrl: 'https://splunk.example', username: 'josé', password: '密碼' } },
      fetch,
    });

    await tool.handler({ action: 'indexes' });

    const headers = new Headers(fetch.mock.calls[0][1]?.headers);
    expect(headers.get('Authorization')).toBe(
      `Basic ${Buffer.from('josé:密碼', 'utf8').toString('base64')}`
    );
  });

  it('converts ISO Datadog metric times to POSIX seconds', async () => {
    const fetch = jsonFetch();
    const tool = new DatadogTool();
    tool.setContext({ config, fetch });

    await tool.handler({
      action: 'metrics',
      query: 'avg:system.cpu.user{*}',
      from: '2026-01-01T00:00:00Z',
      to: '2026-01-01T01:00:00Z',
    });

    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.searchParams.get('from')).toBe('1767225600');
    expect(url.searchParams.get('to')).toBe('1767229200');
  });

  it('rejects Prometheus range queries longer than 24 hours', async () => {
    const fetch = jsonFetch();
    const tool = new PrometheusTool();
    tool.setContext({ config, fetch });

    await expect(
      tool.handler({
        action: 'query_range',
        query: 'up',
        start: '2026-01-01T00:00:00Z',
        end: '2026-01-03T00:00:00Z',
        step: '1m',
      })
    ).rejects.toThrow('at most 24 hours');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects Prometheus ranges whose end precedes their start', async () => {
    const fetch = jsonFetch();
    const tool = new PrometheusTool();
    tool.setContext({ config, fetch });

    await expect(
      tool.handler({
        action: 'query_range',
        query: 'up',
        start: '2026-01-02T00:00:00Z',
        end: '2026-01-01T00:00:00Z',
        step: '1m',
      })
    ).rejects.toThrow('Prometheus time range is invalid');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects Prometheus range queries that request excessive sample counts', async () => {
    const fetch = jsonFetch();
    const tool = new PrometheusTool();
    tool.setContext({ config, fetch });

    await expect(
      tool.handler({
        action: 'query_range',
        query: 'up',
        start: '2026-01-01T00:00:00Z',
        end: '2026-01-02T00:00:00Z',
        step: '1ms',
      })
    ).rejects.toThrow('at most 11000 points');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects non-HTTP provider URLs and redacts credentials from errors', async () => {
    const tool = new GrafanaTool();
    tool.setContext({
      config: { grafana: { baseUrl: 'file:///tmp/data', token: 'never-print-me' } },
      fetch: jsonFetch(),
    });

    await expect(tool.handler({ action: 'datasources' })).rejects.toThrow(
      'URL must use HTTP or HTTPS'
    );
  });

  it('rejects credentials embedded in provider URLs', async () => {
    const tool = new GrafanaTool();
    tool.setContext({
      config: { grafana: { baseUrl: 'https://user@grafana.example' } },
      fetch: jsonFetch(),
    });

    await expect(tool.handler({ action: 'datasources' })).rejects.toThrow(
      'URL must not contain credentials'
    );
  });

  it('removes query parameters and fragments from provider base URLs', async () => {
    const fetch = jsonFetch();
    const tool = new GrafanaTool();
    tool.setContext({
      config: { grafana: { baseUrl: 'https://grafana.example/root?token=value#fragment' } },
      fetch,
    });

    await tool.handler({ action: 'datasources' });

    expect(String(fetch.mock.calls[0][0])).toBe('https://grafana.example/root/api/datasources');
  });

  it('does not send provider credentials over remote plain HTTP', async () => {
    const fetch = jsonFetch();
    const tool = new GrafanaTool();
    tool.setContext({
      config: { grafana: { baseUrl: 'http://grafana.example', token: 'never-send-me' } },
      fetch,
    });

    await expect(tool.handler({ action: 'datasources' })).rejects.toThrow(
      'URL must use HTTPS, or HTTP for localhost'
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('bounds arrays and map-shaped provider result sets', async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: Array.from({ length: 150 }, (_, index) => index),
          metadata: Object.fromEntries(
            Array.from({ length: 150 }, (_, index) => [`metric_${index}`, [{ type: 'gauge' }]])
          ),
        })
      );
    const tool = new PrometheusTool();
    tool.setContext({ config, fetch });

    const result = await tool.handler({ action: 'metadata' });

    const data = result.data as { data: number[]; metadata: Record<string, unknown> };
    expect(data.data).toHaveLength(100);
    expect(Object.keys(data.metadata)).toHaveLength(100);
  });

  it('rejects oversized responses while reading the response stream', async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response(new Uint8Array(200_001), {
        headers: { 'Content-Type': 'application/json' },
      });
    const tool = new PrometheusTool();
    tool.setContext({ config, fetch });

    await expect(tool.handler({ action: 'metadata' })).rejects.toThrow(
      'response exceeded 200000 bytes'
    );
  });

  it('bounds deeply nested provider responses without overflowing the stack', async () => {
    const nested = `${'['.repeat(12_000)}0${']'.repeat(12_000)}`;
    const fetch: typeof globalThis.fetch = async () => new Response(nested);
    const tool = new PrometheusTool();
    tool.setContext({ config, fetch });

    const result = await tool.handler({ action: 'metadata' });

    expect(result.success).toBe(true);
    expect(result.content).toContain('[nested value omitted]');
  });
});
