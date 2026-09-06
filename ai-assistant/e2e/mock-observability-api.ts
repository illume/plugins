import { createServer } from 'node:http';
import { E2E_GRAFANA_ORIGIN, E2E_PROMETHEUS_ORIGIN } from './observability-services.ts';

const OBSERVABILITY_UPSTREAMS = {
  grafana: {
    '/api/search?type=dash-db&query=Kubernetes&limit=100': `${E2E_GRAFANA_ORIGIN}/api/search?type=dash-db&query=Kubernetes&limit=100`,
  },
  prometheus: {
    '/api/v1/query?query=up': `${E2E_PROMETHEUS_ORIGIN}/api/v1/query?query=up`,
  },
} as const;

export interface ObservabilityApiRequest {
  /** Provider whose API received the request. */
  provider: 'datadog' | 'splunk' | 'grafana' | 'prometheus' | 'azureMonitor';
  /** HTTP method received by the fixture. */
  method: string;
  /** Request pathname and query string. */
  path: string;
  /** Authorization header, when supplied. */
  authorization?: string;
  /** Datadog API key header, when supplied. */
  datadogApiKey?: string;
  /** Datadog application key header, when supplied. */
  datadogApplicationKey?: string;
  /** UTF-8 request body. */
  body: string;
}

export interface MockObservabilityApi {
  /** Browser-accessible API origins for each provider. */
  urls: Record<ObservabilityApiRequest['provider'], string>;
  /** Non-preflight requests received by the fixture. */
  requests: ObservabilityApiRequest[];
  /** Providers whose requests received successful responses from real upstream services. */
  successfulUpstreams: Array<'grafana' | 'prometheus'>;
  /** Stops the fixture server. */
  close: () => Promise<void>;
}

/**
 * Starts a dependency-free JSON API fixture used by native tool E2E tests.
 *
 * @returns The running fixture URL, captured requests, and an asynchronous close function.
 */
export async function startMockObservabilityApi(): Promise<MockObservabilityApi> {
  const requests: ObservabilityApiRequest[] = [];
  const successfulUpstreams: MockObservabilityApi['successfulUpstreams'] = [];
  const providers = ['datadog', 'splunk', 'grafana', 'prometheus', 'azureMonitor'] as const;
  const servers = providers.map(provider =>
    createServer(async (request, response) => {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers':
            'authorization, content-type, dd-api-key, dd-application-key, x-grafana-org-id, x-scope-orgid',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
        });
        response.end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const url = new URL(request.url ?? '/', 'http://localhost');
      const body = Buffer.concat(chunks).toString('utf8');
      requests.push({
        provider,
        method: request.method ?? '',
        path: `${url.pathname}${url.search}`,
        authorization: request.headers.authorization,
        datadogApiKey: request.headers['dd-api-key'] as string | undefined,
        datadogApplicationKey: request.headers['dd-application-key'] as string | undefined,
        body,
      });
      const requestPath = `${url.pathname}${url.search}`;
      const upstreams =
        provider === 'grafana'
          ? OBSERVABILITY_UPSTREAMS.grafana
          : provider === 'prometheus'
          ? OBSERVABILITY_UPSTREAMS.prometheus
          : undefined;
      const upstreamUrl = upstreams?.[requestPath as keyof typeof upstreams];
      if (upstreamUrl) {
        try {
          const upstreamResponse = await fetch(upstreamUrl);
          if (upstreamResponse.ok) successfulUpstreams.push(provider);
          response.writeHead(upstreamResponse.status, {
            'content-type': upstreamResponse.headers.get('content-type') ?? 'application/json',
            'access-control-allow-origin': '*',
          });
          response.end(await upstreamResponse.text());
        } catch {
          response.writeHead(502, {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
          });
          response.end(JSON.stringify({ error: 'Observability E2E upstream is unavailable' }));
        }
        return;
      }
      if (upstreams) {
        response.writeHead(404, {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        });
        response.end(JSON.stringify({ error: 'Unexpected observability E2E request' }));
        return;
      }
      response.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      });
      response.end(
        provider === 'splunk'
          ? JSON.stringify({ results: [{ host: 'e2e-splunk', _raw: 'fixture event' }] })
          : provider === 'azureMonitor'
          ? JSON.stringify({
              tables: [
                {
                  name: 'PrimaryResult',
                  columns: [{ name: 'TimeGenerated', type: 'datetime' }],
                  rows: [['2026-09-05T00:00:00Z']],
                },
              ],
            })
          : JSON.stringify({ data: [{ id: 'e2e-datadog-log', type: 'log' }] })
      );
    })
  );
  await Promise.all(
    servers.map(
      server =>
        new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, '127.0.0.1', resolve);
        })
    )
  );
  const urls = Object.fromEntries(
    servers.map((server, index) => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Mock API failed to bind');
      const provider = providers[index];
      const origin = `http://127.0.0.1:${address.port}`;
      return [
        provider,
        provider === 'azureMonitor' ? `${origin}/v1/workspaces/workspace-id` : origin,
      ];
    })
  ) as MockObservabilityApi['urls'];
  return {
    urls,
    requests,
    successfulUpstreams,
    close: () =>
      Promise.all(
        servers.map(
          server =>
            new Promise<void>((resolve, reject) =>
              server.close(error => (error ? reject(error) : resolve()))
            )
        )
      ).then(() => undefined),
  };
}
