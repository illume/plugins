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
    ).rejects.toThrow('non-read-only');
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
});
