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

import { describe, expect, it, vi } from 'vitest';
import { discoverAzureObservabilityEndpoints } from './AzureObservabilityDiscovery';

describe('discoverAzureObservabilityEndpoints', () => {
  it('uses one CLI token call then discovers endpoints across subscriptions with APIs', async () => {
    const runCommand = vi.fn().mockResolvedValue({ stdout: 'arm-token\n', exitCode: 0 });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            value: [
              { subscriptionId: 'first', state: 'Enabled' },
              { subscriptionId: 'second', state: 'Enabled' },
              { subscriptionId: 'disabled', state: 'Disabled' },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              {
                provider: 'grafana',
                name: 'dashboards',
                resourceGroup: 'operations',
                subscriptionId: 'first',
                url: 'https://dashboards.example.azure.com/',
              },
              {
                provider: 'prometheus',
                name: 'metrics',
                resourceGroup: 'operations',
                subscriptionId: 'second',
                url: 'https://metrics.example.azure.com/',
              },
            ],
          }),
          { status: 200 }
        )
      );

    try {
      await expect(discoverAzureObservabilityEndpoints(runCommand)).resolves.toEqual([
        {
          provider: 'grafana',
          name: 'dashboards',
          resourceGroup: 'operations',
          subscriptionId: 'first',
          url: 'https://dashboards.example.azure.com',
        },
        {
          provider: 'prometheus',
          name: 'metrics',
          resourceGroup: 'operations',
          subscriptionId: 'second',
          url: 'https://metrics.example.azure.com',
        },
      ]);
      expect(runCommand).toHaveBeenCalledOnce();
      expect(runCommand).toHaveBeenCalledWith(
        'az',
        [
          'account',
          'get-access-token',
          '--resource',
          'https://management.azure.com/',
          '--query',
          'accessToken',
          '-o',
          'tsv',
        ],
        expect.any(AbortSignal)
      );
      const graphRequest = fetchSpy.mock.calls[1];
      expect(JSON.parse(String(graphRequest[1]?.body)).subscriptions).toEqual(['first', 'second']);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('reports when Azure CLI is not signed in', async () => {
    const runCommand = vi.fn().mockResolvedValue({ stdout: '', exitCode: 1 });

    await expect(discoverAzureObservabilityEndpoints(runCommand)).rejects.toThrow(
      'Azure CLI is not signed in'
    );
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed Resource Graph data', async () => {
    const runCommand = vi.fn().mockResolvedValue({ stdout: 'arm-token', exitCode: 0 });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: [{ subscriptionId: 'first', state: 'Enabled' }] }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: {} }), { status: 200 }));

    try {
      await expect(discoverAzureObservabilityEndpoints(runCommand)).rejects.toThrow(
        'invalid observability resource data'
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
