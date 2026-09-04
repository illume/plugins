import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface MockObservabilityMCPServer {
  url: string;
  close: () => Promise<void>;
  receivedProviderHeader: () => boolean;
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

export async function startMockObservabilityMCPServer(
  provider: string
): Promise<MockObservabilityMCPServer> {
  let providerHeaderReceived = false;
  const server = createServer(async (request, response) => {
    if (request.method === 'DELETE') {
      response.writeHead(200).end();
      return;
    }
    if (request.method !== 'POST' || request.url !== '/mcp') {
      response.writeHead(404).end();
      return;
    }

    providerHeaderReceived ||= request.headers['x-e2e-provider'] === provider;
    const message = await readJson(request);
    const id = message.id;
    if (id === undefined) {
      response.writeHead(202).end();
      return;
    }

    switch (message.method) {
      case 'initialize': {
        const params = message.params as { protocolVersion?: string } | undefined;
        sendJson(response, {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: params?.protocolVersion ?? '2025-03-26',
            capabilities: { tools: {} },
            serverInfo: { name: `${provider}-e2e`, version: '1.0.0' },
          },
        });
        return;
      }
      case 'tools/list':
        sendJson(response, {
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'query',
                description: `Query ${provider} without modifying data`,
                inputSchema: {
                  type: 'object',
                  properties: { query: { type: 'string' } },
                  required: ['query'],
                  additionalProperties: false,
                },
              },
            ],
          },
        });
        return;
      case 'tools/call': {
        const params = message.params as { arguments?: { query?: string } } | undefined;
        sendJson(response, {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `${provider} read-only result for ${params?.arguments?.query ?? ''}`,
              },
            ],
          },
        });
        return;
      }
      default:
        sendJson(response, {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: 'Method not found' },
        });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Mock observability MCP server did not bind to a TCP port');
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      ),
    receivedProviderHeader: () => providerHeaderReceived,
  };
}
