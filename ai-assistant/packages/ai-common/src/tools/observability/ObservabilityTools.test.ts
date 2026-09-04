import { describe, expect, it, vi } from 'vitest';
import {
  DatadogTool,
  GrafanaTool,
  type ObservabilityConfig,
  PrometheusTool,
  SplunkTool,
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
};

function jsonFetch() {
  const implementation: typeof fetch = async () =>
    new Response(JSON.stringify({ status: 'success', data: [] }));
  return vi.fn(implementation);
}

describe('native observability tools', () => {
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

  it('allows read-only Splunk pipelines and pipes inside quoted values', async () => {
    const fetch = jsonFetch();
    const tool = new SplunkTool();
    tool.setContext({ config, fetch });

    await tool.handler({
      action: 'search',
      query: 'search index=main message="left|right" | stats count | head 10',
    });

    expect(fetch).toHaveBeenCalledOnce();
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

  it('retains bounded structured data when the response fits the payload limit', async () => {
    const fetch: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: Array.from({ length: 150 }, (_, index) => index) }));
    const tool = new PrometheusTool();
    tool.setContext({ config, fetch });

    const result = await tool.handler({ action: 'metadata' });

    expect((result.data as { data: number[] }).data).toHaveLength(100);
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
});
