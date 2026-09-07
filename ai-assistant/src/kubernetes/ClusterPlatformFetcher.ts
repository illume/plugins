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

import type {
  ClusterPlatform,
  ClusterPlatforms,
} from '@headlamp-k8s/ai-common/kubernetes/context/buildContextDescription';
import { clusterRequest } from '@kinvolk/headlamp-plugin/lib/ApiProxy';

interface KubernetesNode {
  metadata?: {
    labels?: Record<string, string>;
  };
  spec?: {
    providerID?: string;
  };
  jsonData?: KubernetesNode;
}

interface ClusterConfig {
  server?: unknown;
  cluster?: {
    server?: unknown;
  };
}

const CACHE_MS = 5 * 60 * 1000;
const UNKNOWN_CACHE_MS = 30 * 1000;
const AKS_API_SERVER_SUFFIXES = [
  '.azmk8s.io',
  '.azmk8s.us',
  '.cx.aks.containerservice.azure.us',
  '.cx.prod.service.azk8s.cn',
];
const platformCache = new Map<string, { platform: ClusterPlatform; detectedAt: number }>();
const inFlight = new Map<string, Promise<ClusterPlatform>>();

/**
 * Detects the Kubernetes platform for each selected cluster.
 *
 * AKS is identified from its API server hostname or AKS-specific node labels.
 * Failures remain unknown rather than being treated as non-AKS.
 *
 * @param clusterNames - Clusters whose platform should be detected.
 * @param clusterConfigs - Headlamp cluster configurations keyed by cluster name.
 * @returns Detected platform for each requested cluster.
 */
export async function fetchClusterPlatforms(
  clusterNames: string[],
  clusterConfigs: Record<string, unknown> = {}
): Promise<ClusterPlatforms> {
  const entries = await Promise.all(
    clusterNames.map(async cluster => {
      const clusterConfig = clusterConfigs[cluster];
      return [
        cluster,
        isAksClusterConfig(clusterConfig)
          ? 'aks'
          : await fetchClusterPlatform(cluster, clusterCacheKey(cluster, clusterConfig)),
      ] as const;
    })
  );
  return Object.fromEntries(entries);
}

async function fetchClusterPlatform(cluster: string, cacheKey: string): Promise<ClusterPlatform> {
  const cached = platformCache.get(cacheKey);
  const cacheLifetime = cached?.platform === 'unknown' ? UNKNOWN_CACHE_MS : CACHE_MS;
  if (cached && Date.now() - cached.detectedAt < cacheLifetime) {
    return cached.platform;
  }

  const pending = inFlight.get(cacheKey);
  if (pending) return pending;

  const request = requestClusterPlatform(cluster, cacheKey).finally(() =>
    inFlight.delete(cacheKey)
  );
  inFlight.set(cacheKey, request);
  return request;
}

async function requestClusterPlatform(cluster: string, cacheKey: string): Promise<ClusterPlatform> {
  let platform: ClusterPlatform;
  try {
    const response = (await clusterRequest('/api/v1/nodes?limit=10', {
      cluster,
      headers: { Accept: 'application/json' },
      autoLogoutOnAuthError: false,
    })) as {
      items?: KubernetesNode[];
      rows?: Array<{ object?: KubernetesNode }>;
    };
    const nodes =
      response.items ?? response.rows?.flatMap(row => (row.object ? [row.object] : [])) ?? [];
    platform = nodes.length === 0 ? 'unknown' : nodes.some(isAksNode) ? 'aks' : 'other';
  } catch (error) {
    console.warn(`[ClusterPlatformFetcher] Could not detect platform for ${cluster}:`, error);
    platform = 'unknown';
  }

  platformCache.set(cacheKey, { platform, detectedAt: Date.now() });
  return platform;
}

function isAksClusterConfig(value: unknown): boolean {
  const server = clusterServer(value);
  if (!server) return false;
  try {
    const hostname = new URL(server).hostname.toLowerCase();
    return AKS_API_SERVER_SUFFIXES.some(suffix => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

function clusterCacheKey(cluster: string, config: unknown): string {
  return `${cluster}\0${clusterServer(config) ?? ''}`;
}

function clusterServer(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const config = value as ClusterConfig;
  const server = config.server ?? config.cluster?.server;
  return typeof server === 'string' ? server : undefined;
}

function isAksNode(value: KubernetesNode): boolean {
  const node = value.jsonData ?? value;
  const labels = node.metadata?.labels ?? {};
  if (
    'kubernetes.azure.com/cluster' in labels ||
    'kubernetes.azure.com/agentpool' in labels ||
    'kubernetes.azure.com/mode' in labels
  ) {
    return true;
  }

  return (
    typeof node.spec?.providerID === 'string' &&
    node.spec.providerID.toLowerCase().startsWith('azure://') &&
    'agentpool' in labels
  );
}
