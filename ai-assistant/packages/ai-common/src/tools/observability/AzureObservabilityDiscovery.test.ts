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
  it('discovers managed Grafana and Prometheus endpoints', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '{"id":"subscription"}', exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            name: 'dashboards',
            resourceGroup: 'operations',
            properties: { endpoint: 'https://dashboards.example.azure.com/' },
          },
        ]),
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            name: 'metrics',
            resourceGroup: 'operations',
            properties: {
              metrics: {
                prometheusQueryEndpoint: 'https://metrics.example.azure.com/',
              },
            },
          },
        ]),
        exitCode: 0,
      });

    await expect(discoverAzureObservabilityEndpoints(runCommand)).resolves.toEqual([
      {
        provider: 'grafana',
        name: 'dashboards',
        resourceGroup: 'operations',
        url: 'https://dashboards.example.azure.com',
      },
      {
        provider: 'prometheus',
        name: 'metrics',
        resourceGroup: 'operations',
        url: 'https://metrics.example.azure.com',
      },
    ]);
  });

  it('reports when Azure CLI is not signed in', async () => {
    const runCommand = vi.fn().mockResolvedValue({ stdout: '', exitCode: 1 });

    await expect(discoverAzureObservabilityEndpoints(runCommand)).rejects.toThrow(
      'Azure CLI is not signed in'
    );
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed resource data and ignores invalid endpoints', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ stdout: '{}', exitCode: 0 })
      .mockResolvedValueOnce({ stdout: 'not-json', exitCode: 0 })
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          {
            name: 'metrics',
            resourceGroup: 'operations',
            properties: { metrics: { prometheusQueryEndpoint: 'file:///tmp/data' } },
          },
        ]),
        exitCode: 0,
      });

    await expect(discoverAzureObservabilityEndpoints(runCommand)).rejects.toThrow(
      'invalid grafana resource data'
    );
  });
});
