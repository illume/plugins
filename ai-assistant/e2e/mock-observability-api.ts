import { createServer } from 'node:http';

export interface ObservabilityApiRequest {
  method: string;
  path: string;
  authorization?: string;
  datadogApiKey?: string;
  datadogApplicationKey?: string;
  body: string;
}

export interface MockObservabilityApi {
  url: string;
  requests: ObservabilityApiRequest[];
  close: () => Promise<void>;
}

/** Starts a dependency-free JSON API fixture used by the native tool E2E tests. */
export async function startMockObservabilityApi(): Promise<MockObservabilityApi> {
  const requests: ObservabilityApiRequest[] = [];
  const server = createServer(async (request, response) => {
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
      method: request.method ?? '',
      path: `${url.pathname}${url.search}`,
      authorization: request.headers.authorization,
      datadogApiKey: request.headers['dd-api-key'] as string | undefined,
      datadogApplicationKey: request.headers['dd-application-key'] as string | undefined,
      body,
    });
    response.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    response.end(JSON.stringify({ status: 'success', data: [{ source: url.pathname }] }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock API failed to bind');
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      ),
  };
}
