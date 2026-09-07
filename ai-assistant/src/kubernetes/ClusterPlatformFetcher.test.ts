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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  clusterRequest: vi.fn(),
}));

vi.mock('@kinvolk/headlamp-plugin/lib/ApiProxy', () => ({
  clusterRequest: mocks.clusterRequest,
}));

import { fetchClusterPlatforms } from './ClusterPlatformFetcher';

describe('fetchClusterPlatforms', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('detects AKS from the configured API server without requesting nodes', async () => {
    await expect(
      fetchClusterPlatforms(['aks-config'], {
        'aks-config': {
          server: 'https://private.example.privatelink.eastus.azmk8s.io:443',
        },
      })
    ).resolves.toEqual({ 'aks-config': 'aks' });
    expect(mocks.clusterRequest).not.toHaveBeenCalled();
  });

  it('detects AKS from node metadata', async () => {
    mocks.clusterRequest.mockResolvedValue({
      items: [
        {
          metadata: {
            labels: {
              'kubernetes.azure.com/agentpool': 'system',
            },
          },
          spec: {
            providerID:
              'azure:///subscriptions/subscription/resourceGroups/group/providers/Microsoft.Compute/virtualMachineScaleSets/pool/virtualMachines/0',
          },
        },
      ],
    });

    await expect(fetchClusterPlatforms(['aks-node-label'])).resolves.toEqual({
      'aks-node-label': 'aks',
    });
    expect(mocks.clusterRequest).toHaveBeenCalledWith('/api/v1/nodes?limit=10', {
      cluster: 'aks-node-label',
      headers: { Accept: 'application/json' },
      autoLogoutOnAuthError: false,
    });
  });

  it('distinguishes non-AKS clusters from unknown clusters', async () => {
    mocks.clusterRequest
      .mockResolvedValueOnce({
        items: [
          {
            metadata: { labels: { 'kubernetes.io/hostname': 'worker-1' } },
            spec: { providerID: 'aws:///zone/instance' },
          },
        ],
      })
      .mockRejectedValueOnce(new Error('forbidden'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(fetchClusterPlatforms(['other-cluster', 'unknown-cluster'])).resolves.toEqual({
      'other-cluster': 'other',
      'unknown-cluster': 'unknown',
    });
  });
});
