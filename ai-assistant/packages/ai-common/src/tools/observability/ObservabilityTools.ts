/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { z } from 'zod';
import type { ToolConfig, ToolHandler } from '../langchain/LangChainTool';
import { LangChainTool } from '../langchain/LangChainTool';
import type { ToolExecutionResult } from '../ToolRuntime';

/** Connection settings for one native observability provider. */
export interface ObservabilityProviderConfig {
  baseUrl?: string;
  token?: string;
  apiKey?: string;
  applicationKey?: string;
  username?: string;
  password?: string;
  organizationId?: string;
}

/** Native observability provider settings. */
export interface ObservabilityConfig {
  datadog?: ObservabilityProviderConfig;
  splunk?: ObservabilityProviderConfig;
  grafana?: ObservabilityProviderConfig;
  prometheus?: ObservabilityProviderConfig;
}

/** Runtime dependencies supplied to native observability tools. */
export interface ObservabilityToolContext {
  config: ObservabilityConfig;
  fetch?: typeof fetch;
}

type Provider = keyof ObservabilityConfig;

function boundArrays(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 100).map(boundArrays);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        boundArrays(item),
      ])
    );
  }
  return value;
}

function toolResult(data: unknown): ToolExecutionResult {
  const boundedData = boundArrays(data);
  const serialized = JSON.stringify(boundedData);
  const truncated = serialized.length > 200_000;
  const content = truncated ? `${serialized.slice(0, 200_000)}… [response truncated]` : serialized;
  return {
    content,
    data: truncated ? undefined : boundedData,
    success: true,
    shouldAddToHistory: true,
    shouldProcessFollowUp: true,
  };
}

function safeBaseUrl(value: string | undefined, provider: Provider): URL {
  if (!value) throw new Error(`${provider} is not configured`);
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${provider} URL must use HTTP or HTTPS`);
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

function capLimit(value: unknown, fallback = 100): number {
  return Math.min(Math.max(typeof value === 'number' ? Math.trunc(value) : fallback, 1), 100);
}

function assertMaximumRange(start: number, end: number, provider: string): void {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error(`${provider} time range is invalid`);
  }
  if (end - start > 24 * 60 * 60 * 1000) {
    throw new Error(`${provider} time range must cover at most 24 hours`);
  }
}

function parseDatadogTime(value: string, seconds: boolean): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric * (seconds ? 1000 : 1);
  return Date.parse(value);
}

function validateSplunkTimeRange(earliest: string, latest: string): void {
  const relative = /^-(\d+)([smhd])$/.exec(earliest);
  if (relative && latest === 'now') {
    const unit = { s: 1, m: 60, h: 3600, d: 86400 }[relative[2] as 's' | 'm' | 'h' | 'd'];
    if (Number(relative[1]) * unit <= 86_400) return;
  } else {
    const start = Date.parse(earliest);
    const end = Date.parse(latest);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      assertMaximumRange(start, end, 'Splunk');
      return;
    }
  }
  throw new Error('Splunk searches must use a valid time range of at most 24 hours');
}

function appendPath(base: URL, path: string): URL {
  const url = new URL(base);
  let pathEnd = url.pathname.length;
  while (pathEnd > 0 && url.pathname.charCodeAt(pathEnd - 1) === 47) pathEnd--;
  url.pathname = `${url.pathname.slice(0, pathEnd)}${path}`;
  return url;
}

function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  return `Basic ${globalThis.btoa(binary)}`;
}

function providerHeaders(provider: Provider, config: ObservabilityProviderConfig): Headers {
  const headers = new Headers({ Accept: 'application/json' });
  if (provider === 'datadog') {
    if (!config.apiKey || !config.applicationKey) {
      throw new Error('Datadog API and application keys are required');
    }
    headers.set('DD-API-KEY', config.apiKey);
    headers.set('DD-APPLICATION-KEY', config.applicationKey);
  } else if (provider === 'splunk') {
    if (config.token) {
      headers.set('Authorization', `Splunk ${config.token}`);
    } else if (config.username && config.password) {
      headers.set('Authorization', basicAuth(config.username, config.password));
    } else {
      throw new Error('Splunk token or username and password are required');
    }
  } else if (config.token) {
    headers.set('Authorization', ['Bearer', config.token].join(' '));
  }
  if (config.organizationId) {
    headers.set(
      provider === 'grafana' ? 'X-Grafana-Org-Id' : 'X-Scope-OrgID',
      config.organizationId
    );
  }
  return headers;
}

async function requestJson(
  context: ObservabilityToolContext,
  provider: Provider,
  path: string,
  init?: RequestInit,
  search?: Record<string, string | undefined>
): Promise<unknown> {
  const config = context.config[provider] ?? {};
  const url = appendPath(safeBaseUrl(config.baseUrl, provider), path);
  for (const [name, value] of Object.entries(search ?? {})) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  const headers = providerHeaders(provider, config);
  for (const [name, value] of new Headers(init?.headers)) headers.set(name, value);
  const response = await (context.fetch ?? fetch)(url, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${provider} request failed (${response.status}): ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${provider} returned an invalid JSON response`);
  }
}

/** Shared context handling for native observability tools. */
export abstract class ObservabilityTool extends LangChainTool {
  protected context: ObservabilityToolContext | null = null;

  setContext(context: ObservabilityToolContext): void {
    this.context = context;
  }

  protected getContext(): ObservabilityToolContext {
    if (!this.context) throw new Error('Observability tool context not configured');
    return this.context;
  }
}

/** Read-only Datadog logs, metrics, and monitor queries. */
export class DatadogTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'datadog_read',
    shortDescription: 'Query Datadog logs, metrics, and monitors',
    description:
      'Read Datadog logs, metrics, or monitors. Results are capped at 100 items and this tool never changes Datadog data.',
    schema: z.object({
      action: z.enum(['logs', 'metrics', 'monitors']),
      query: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }),
  };

  handler: ToolHandler = async args => {
    const context = this.getContext();
    const action = String(args.action);
    const limit = capLimit(args.limit);
    if (action === 'logs') {
      const now = Date.now();
      const from =
        typeof args.from === 'string' ? args.from : new Date(now - 3_600_000).toISOString();
      const to = typeof args.to === 'string' ? args.to : new Date(now).toISOString();
      assertMaximumRange(parseDatadogTime(from, false), parseDatadogTime(to, false), 'Datadog');
      return toolResult(
        await requestJson(context, 'datadog', '/api/v2/logs/events/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filter: {
              query: typeof args.query === 'string' ? args.query : '*',
              from,
              to,
            },
            page: { limit },
            sort: 'timestamp',
          }),
        })
      );
    }
    if (action === 'metrics') {
      if (typeof args.query !== 'string' || !args.query)
        throw new Error('Metric query is required');
      const now = Math.floor(Date.now() / 1000);
      const from = typeof args.from === 'string' ? args.from : String(now - 3600);
      const to = typeof args.to === 'string' ? args.to : String(now);
      const fromMs = parseDatadogTime(from, true);
      const toMs = parseDatadogTime(to, true);
      assertMaximumRange(fromMs, toMs, 'Datadog');
      return toolResult(
        await requestJson(context, 'datadog', '/api/v1/query', undefined, {
          query: args.query as string,
          from: String(Math.floor(fromMs / 1000)),
          to: String(Math.floor(toMs / 1000)),
        })
      );
    }
    return toolResult(
      await requestJson(context, 'datadog', '/api/v1/monitor', undefined, {
        page_size: String(limit),
      })
    );
  };
}

const SAFE_SPLUNK_COMMANDS = new Set([
  'append',
  'appendcols',
  'bin',
  'bucket',
  'chart',
  'dedup',
  'eval',
  'eventstats',
  'fields',
  'fillnull',
  'head',
  'inputlookup',
  'join',
  'lookup',
  'multisearch',
  'rare',
  'regex',
  'rename',
  'rex',
  'search',
  'sort',
  'spath',
  'stats',
  'streamstats',
  'table',
  'tail',
  'timechart',
  'top',
  'transaction',
  'where',
]);

function assertReadOnlySpl(query: string): void {
  let quote = '';
  let escaped = false;
  let segment = '';
  const segments: string[] = [];
  for (const character of query) {
    if (escaped) {
      escaped = false;
      segment += character;
    } else if (character === '\\') {
      escaped = true;
      segment += character;
    } else if (quote) {
      if (character === quote) quote = '';
      segment += character;
    } else if (character === '"' || character === "'") {
      quote = character;
      segment += character;
    } else if (character === '|') {
      segments.push(segment);
      segment = '';
    } else {
      segment += character;
    }
  }
  segments.push(segment);

  const commands = segments.map(item => item.trim().split(/\s+/, 1)[0].toLowerCase());
  if (commands[0] !== 'search' || commands.some(command => !SAFE_SPLUNK_COMMANDS.has(command))) {
    throw new Error('SPL query contains a command outside the read-only allowlist');
  }
}

/** Read-only Splunk searches and metadata discovery. */
export class SplunkTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'splunk_read',
    shortDescription: 'Search Splunk and inspect indexes or saved searches',
    description:
      'Run bounded read-only SPL searches or list indexes and saved searches. Mutating and external-execution SPL commands are rejected.',
    schema: z.object({
      action: z.enum(['search', 'indexes', 'saved_searches']),
      query: z.string().optional(),
      earliestTime: z.string().optional(),
      latestTime: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }),
  };

  handler: ToolHandler = async args => {
    const context = this.getContext();
    const action = String(args.action);
    const limit = capLimit(args.limit);
    if (action === 'search') {
      if (typeof args.query !== 'string' || !args.query) throw new Error('SPL query is required');
      assertReadOnlySpl(args.query);
      const earliestTime = typeof args.earliestTime === 'string' ? args.earliestTime : '-24h';
      const latestTime = typeof args.latestTime === 'string' ? args.latestTime : 'now';
      validateSplunkTimeRange(earliestTime, latestTime);
      const body = new URLSearchParams({
        search: args.query,
        earliest_time: earliestTime,
        latest_time: latestTime,
        count: String(limit),
        output_mode: 'json',
      });
      return toolResult(
        await requestJson(context, 'splunk', '/services/search/jobs/oneshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        })
      );
    }
    const path = action === 'indexes' ? '/services/data/indexes' : '/services/saved/searches';
    return toolResult(
      await requestJson(context, 'splunk', path, undefined, {
        output_mode: 'json',
        count: String(limit),
      })
    );
  };
}

/** Read-only Grafana dashboard and datasource discovery. */
export class GrafanaTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'grafana_read',
    shortDescription: 'Inspect Grafana dashboards and datasources',
    description:
      'Search or retrieve Grafana dashboards and list datasources using read-only Grafana HTTP API endpoints.',
    schema: z.object({
      action: z.enum(['search_dashboards', 'get_dashboard', 'datasources']),
      query: z.string().optional(),
      uid: z.string().optional(),
      limit: z.number().int().positive().max(100).optional(),
    }),
  };

  handler: ToolHandler = async args => {
    const context = this.getContext();
    const action = String(args.action);
    if (action === 'get_dashboard') {
      if (typeof args.uid !== 'string' || !args.uid) throw new Error('Dashboard UID is required');
      return toolResult(
        await requestJson(context, 'grafana', `/api/dashboards/uid/${encodeURIComponent(args.uid)}`)
      );
    }
    if (action === 'datasources') {
      return toolResult(await requestJson(context, 'grafana', '/api/datasources'));
    }
    return toolResult(
      await requestJson(context, 'grafana', '/api/search', undefined, {
        type: 'dash-db',
        query: typeof args.query === 'string' ? args.query : '',
        limit: String(capLimit(args.limit)),
      })
    );
  };
}

function rangeMilliseconds(value: string): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric * 1000;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Range times must be RFC3339 or Unix timestamps');
  return parsed;
}

/** Read-only Prometheus queries, metadata, and target inspection. */
export class PrometheusTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'prometheus_read',
    shortDescription: 'Query Prometheus metrics and metadata',
    description:
      'Run instant or maximum 24-hour range PromQL queries, inspect metric metadata, or list active scrape targets.',
    schema: z.object({
      action: z.enum(['query', 'query_range', 'metadata', 'targets']),
      query: z.string().optional(),
      time: z.string().optional(),
      start: z.string().optional(),
      end: z.string().optional(),
      step: z.string().optional(),
      metric: z.string().optional(),
    }),
  };

  handler: ToolHandler = async args => {
    const context = this.getContext();
    const action = String(args.action);
    if (action === 'query' || action === 'query_range') {
      if (typeof args.query !== 'string' || !args.query)
        throw new Error('PromQL query is required');
    }
    if (action === 'query_range') {
      if (
        typeof args.start !== 'string' ||
        typeof args.end !== 'string' ||
        typeof args.step !== 'string'
      ) {
        throw new Error('Range query requires start, end, and step');
      }
      const duration = rangeMilliseconds(args.end) - rangeMilliseconds(args.start);
      if (duration < 0 || duration > 24 * 60 * 60 * 1000) {
        throw new Error('Prometheus range queries must cover at most 24 hours');
      }
      return toolResult(
        await requestJson(context, 'prometheus', '/api/v1/query_range', undefined, {
          query: args.query as string,
          start: args.start,
          end: args.end,
          step: args.step,
        })
      );
    }
    if (action === 'query') {
      return toolResult(
        await requestJson(context, 'prometheus', '/api/v1/query', undefined, {
          query: args.query as string,
          time: typeof args.time === 'string' ? args.time : undefined,
        })
      );
    }
    if (action === 'metadata') {
      return toolResult(
        await requestJson(context, 'prometheus', '/api/v1/metadata', undefined, {
          metric: typeof args.metric === 'string' ? args.metric : undefined,
        })
      );
    }
    return toolResult(
      await requestJson(context, 'prometheus', '/api/v1/targets', undefined, { state: 'active' })
    );
  };
}
