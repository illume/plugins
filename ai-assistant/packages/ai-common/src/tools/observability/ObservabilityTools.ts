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
import { type CommandRunner, getAzureAccessToken } from '../../providers/detectProvider';
import type { ToolConfig, ToolHandler } from '../langchain/LangChainTool';
import { LangChainTool } from '../langchain/LangChainTool';
import type { ToolExecutionResult } from '../ToolRuntime';

/** Connection settings for one native observability provider. */
export interface ObservabilityProviderConfig {
  /** Provider-compatible HTTP endpoint. */
  baseUrl?: string;
  /** Bearer-style access token. */
  token?: string;
  /** Azure Resource Manager access token for browser-only Azure tools. */
  managementToken?: string;
  /** Datadog API key. */
  apiKey?: string;
  /** Datadog application key. */
  applicationKey?: string;
  /** Username used for Splunk Basic authentication. */
  username?: string;
  /** Password used for Splunk Basic authentication. */
  password?: string;
  /** Grafana organization or Prometheus-compatible tenant identifier. */
  organizationId?: string;
}

/** Native observability provider settings. */
export interface ObservabilityConfig {
  /** Datadog connection settings. */
  datadog?: ObservabilityProviderConfig;
  /** Splunk connection settings. */
  splunk?: ObservabilityProviderConfig;
  /** Grafana connection settings. */
  grafana?: ObservabilityProviderConfig;
  /** Prometheus-compatible connection settings. */
  prometheus?: ObservabilityProviderConfig;
  /** Azure Monitor Logs connection settings for AKS and application traces. */
  azureMonitor?: ObservabilityProviderConfig;
}

/** Runtime dependencies supplied to native observability tools. */
export interface ObservabilityToolContext {
  /** Provider connection settings. */
  config: ObservabilityConfig;
  /** Optional request implementation, primarily for tests. */
  fetch?: typeof fetch;
  /** Optional desktop command runner used to obtain short-lived Azure API tokens. */
  commandRunner?: CommandRunner;
}

type Provider = keyof ObservabilityConfig;
/** Maximum provider response size read into memory or returned as model-facing content. */
export const MAX_RESPONSE_BYTES = 200_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REQUEST_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 5_000;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

/** Returns whether a URL hostname is a local loopback name or address. */
export function isLoopbackHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

/**
 * Recursively caps arrays and map-shaped collections in provider responses.
 *
 * @param value - Parsed provider response value.
 * @returns A response copy whose collections contain no more than 100 entries.
 */
function boundCollections(value: unknown, depth = 0): unknown {
  if (depth >= 100) return '[nested value omitted]';
  if (Array.isArray(value))
    return value.slice(0, 100).map(item => boundCollections(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [key, boundCollections(item, depth + 1)])
    );
  }
  return value;
}

/**
 * Converts provider data into a bounded tool execution result.
 *
 * @param data - Parsed provider response.
 * @returns A successful result with bounded structured data and model-facing content.
 */
export function toolResult(data: unknown): ToolExecutionResult {
  const boundedData = boundCollections(data);
  const serialized = JSON.stringify(boundedData);
  const truncated = serialized.length > MAX_RESPONSE_BYTES;
  const content = truncated
    ? `${serialized.slice(0, MAX_RESPONSE_BYTES)}… [response truncated]`
    : serialized;
  return {
    content,
    data: truncated ? undefined : boundedData,
    success: true,
    shouldAddToHistory: true,
    shouldProcessFollowUp: true,
  };
}

/**
 * Parses and normalizes a configured provider base URL.
 *
 * @param value - Configured URL.
 * @param provider - Provider used in configuration errors.
 * @returns A normalized HTTP or HTTPS URL without trailing pathname separators.
 * @throws When the URL is missing or does not use HTTP or HTTPS.
 */
function safeBaseUrl(value: string | undefined, provider: Provider): URL {
  if (!value) throw new Error(`${provider} is not configured`);
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${provider} URL must use HTTP or HTTPS`);
  }
  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname)) {
    throw new Error(`${provider} URL must use HTTPS, or HTTP for localhost`);
  }
  if (url.username || url.password) {
    throw new Error(`${provider} URL must not contain credentials`);
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url;
}

/**
 * Clamps a requested item limit to the supported range.
 *
 * @param value - Requested limit.
 * @param fallback - Limit used when the request omits a numeric value.
 * @returns An integer from 1 through 100.
 */
function capLimit(value: unknown, fallback = 100): number {
  return Math.min(Math.max(typeof value === 'number' ? Math.trunc(value) : fallback, 1), 100);
}

/**
 * Validates a provider query window.
 *
 * @param start - Window start in milliseconds.
 * @param end - Window end in milliseconds.
 * @param provider - Provider used in validation errors.
 * @returns No value when the range is valid.
 * @throws When the range is invalid or exceeds 24 hours.
 */
export function assertMaximumRange(start: number, end: number, provider: string): void {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    throw new Error(`${provider} time range is invalid`);
  }
  if (end - start > 24 * 60 * 60 * 1000) {
    throw new Error(`${provider} time range must cover at most 24 hours`);
  }
}

/**
 * Parses an ISO timestamp or numeric Datadog timestamp.
 *
 * @param value - Timestamp value.
 * @param seconds - Whether numeric input is expressed in POSIX seconds.
 * @returns The timestamp in milliseconds, or `NaN` for invalid input.
 */
function parseDatadogTime(value: string, seconds: boolean): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric * (seconds ? 1000 : 1);
  return Date.parse(value);
}

/**
 * Validates Splunk absolute search times or a relative earliest time paired with `now`.
 *
 * @param earliest - Earliest search time.
 * @param latest - Latest search time.
 * @returns No value when the range is valid.
 * @throws When the range is invalid or exceeds 24 hours.
 */
function validateSplunkTimeRange(earliest: string, latest: string): void {
  const relative = /^-(\d+)([smhd])$/.exec(earliest);
  if (relative) {
    if (latest !== 'now') {
      throw new Error('Splunk relative search times must end at now');
    }
    const unit = { s: 1, m: 60, h: 3600, d: 86400 }[relative[2] as 's' | 'm' | 'h' | 'd'];
    if (Number(relative[1]) * unit <= 86_400) return;
    throw new Error('Splunk time range must cover at most 24 hours');
  }
  const start = Date.parse(earliest);
  const end = Date.parse(latest);
  if (Number.isFinite(start) && Number.isFinite(end)) {
    assertMaximumRange(start, end, 'Splunk');
    return;
  }
  throw new Error('Splunk searches must use a valid time range of at most 24 hours');
}

/**
 * Appends an API path without discarding a configured base pathname.
 *
 * @param base - Normalized provider base URL.
 * @param path - Provider API path beginning with a slash.
 * @returns A new URL containing the appended path.
 */
function appendPath(base: URL, path: string): URL {
  const url = new URL(base);
  let pathEnd = url.pathname.length;
  while (pathEnd > 0 && url.pathname.charCodeAt(pathEnd - 1) === 47) pathEnd--;
  url.pathname = `${url.pathname.slice(0, pathEnd)}${path}`;
  return url;
}

/**
 * Creates an RFC 7617 Basic authorization value from Unicode credentials.
 *
 * @param username - Splunk username.
 * @param password - Splunk password.
 * @returns A Basic authorization header value encoded from UTF-8 bytes.
 */
function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  return `Basic ${globalThis.btoa(binary)}`;
}

/**
 * Creates provider-specific request headers.
 *
 * @param provider - Observability provider.
 * @param config - Provider connection settings.
 * @returns Headers containing the configured authentication and tenant values.
 * @throws When required provider credentials are missing.
 */
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

/** Returns a bounded delay for a rate-limited or transient request retry. */
function retryDelayMs(response: Response | undefined, retry: number): number {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(delay)) return Math.min(Math.max(delay, 0), MAX_RETRY_DELAY_MS);
  }
  return Math.min(250 * 2 ** retry, MAX_RETRY_DELAY_MS);
}

/** Returns whether fetch failed because the network connection was unavailable or interrupted. */
function isNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException && ['NetworkError', 'NotReadableError'].includes(error.name))
  );
}

/** Waits before retrying without extending the overall request deadline. */
async function waitForRetry(delay: number, deadline: number): Promise<boolean> {
  if (Date.now() + delay >= deadline) return false;
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  return true;
}

/**
 * Executes a bounded provider HTTP request and parses its JSON response.
 *
 * @param context - Runtime configuration and request implementation.
 * @param provider - Observability provider.
 * @param path - Provider API path.
 * @param init - Optional request initialization.
 * @param search - Optional query-string values.
 * @returns The parsed JSON response.
 * @throws When the request fails or returns invalid JSON.
 */
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
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`${provider} request timed out after 30 seconds`);
    try {
      const response = await (context.fetch ?? fetch)(url, {
        ...init,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(remaining),
      });
      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt + 1 < MAX_REQUEST_ATTEMPTS) {
        const delay = retryDelayMs(response, attempt);
        await response.body?.cancel().catch(() => undefined);
        if (await waitForRetry(delay, deadline)) {
          continue;
        }
      }
      return await readBoundedJson(response, provider);
    } catch (error) {
      if (
        error instanceof DOMException &&
        (error.name === 'AbortError' || error.name === 'TimeoutError')
      ) {
        throw new Error(`${provider} request timed out after 30 seconds`);
      }
      if (!isNetworkError(error)) throw error;
      if (
        attempt + 1 >= MAX_REQUEST_ATTEMPTS ||
        !(await waitForRetry(retryDelayMs(undefined, attempt), deadline))
      ) {
        throw new Error(`${provider} request failed because the network is unavailable`);
      }
    }
  }
  throw new Error(`${provider} request failed because the network is unavailable`);
}

/**
 * Reads and parses a JSON response without buffering more than the shared response limit.
 *
 * @param response - Provider response.
 * @param label - Provider name used in errors.
 * @returns Parsed JSON.
 */
export async function readBoundedJson(response: Response, label: string): Promise<unknown> {
  const contentLength = response.headers.get('content-length');
  const declaredLength = contentLength === null ? Number.NaN : Number(contentLength);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error(`${label} response exceeded ${MAX_RESPONSE_BYTES} bytes`);
  }
  let text: string;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the response-size error if stream cancellation fails.
        }
        throw new Error(`${label} response exceeded ${MAX_RESPONSE_BYTES} bytes`);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    text = new TextDecoder().decode(bytes);
  } else {
    text = await response.text();
  }
  if (!response.ok) {
    throw new Error(`${label} request failed (${response.status}): ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned an invalid JSON response`);
  }
}

/** Shared context handling for native observability tools. */
export abstract class ObservabilityTool extends LangChainTool {
  protected context: ObservabilityToolContext | null = null;

  /**
   * Supplies provider configuration and runtime dependencies.
   *
   * @param context - Context used by subsequent tool executions.
   * @returns No value.
   */
  setContext(context: ObservabilityToolContext): void {
    this.context = context;
  }

  /**
   * Retrieves the configured runtime context.
   *
   * @returns The current observability tool context.
   * @throws When context has not been configured.
   */
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
      action: z.enum(['logs', 'metrics', 'monitors']).describe('Read-only Datadog operation'),
      query: z
        .string()
        .max(4096)
        .optional()
        .describe('Log search query or required metric query; logs default to *'),
      from: z.string().optional().describe('ISO timestamp, or Unix seconds for metrics'),
      to: z.string().optional().describe('ISO timestamp, or Unix seconds for metrics'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum returned items'),
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
    if (action !== 'monitors') throw new Error('Unsupported Datadog action');
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

/**
 * Validates that an SPL query uses only explicitly allowlisted read-only commands.
 *
 * @param query - SPL query beginning with the explicit `search` command.
 * @returns No value when the query is valid.
 * @throws When the query contains a command outside the allowlist.
 */
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
    } else if (character === '`' || character === '[' || character === ']') {
      throw new Error('SPL query cannot contain macros or subsearches');
    } else if (character === '|') {
      segments.push(segment);
      segment = '';
    } else {
      segment += character;
    }
  }
  segments.push(segment);

  const commands = segments
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => item.split(/\s+/, 1)[0].toLowerCase());
  if (commands[0] !== 'search') {
    throw new Error('SPL queries must begin with search');
  }
  if (commands.some(command => !SAFE_SPLUNK_COMMANDS.has(command))) {
    throw new Error('SPL query contains a command outside the read-only allowlist');
  }
}

/** Read-only Splunk searches and metadata discovery. */
export class SplunkTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'splunk_read',
    shortDescription: 'Search Splunk and inspect indexes or saved searches',
    description:
      'Run bounded read-only SPL searches or list indexes and saved searches. Searches must begin with the explicit search command and may use only allowlisted read-only commands.',
    schema: z.object({
      action: z
        .enum(['search', 'indexes', 'saved_searches'])
        .describe('Read-only Splunk operation'),
      query: z
        .string()
        .min(1)
        .max(10_000)
        .optional()
        .describe('Required for search: read-only SPL beginning with search'),
      earliestTime: z
        .string()
        .optional()
        .describe('Search start timestamp or relative value such as -1h; defaults to -24h'),
      latestTime: z.string().optional().describe('Search end timestamp or now; defaults to now'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum returned items'),
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
    if (action !== 'indexes' && action !== 'saved_searches') {
      throw new Error('Unsupported Splunk action');
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
      action: z
        .enum(['search_dashboards', 'get_dashboard', 'datasources'])
        .describe('Read-only Grafana operation'),
      query: z.string().max(4096).optional().describe('Dashboard title search text'),
      uid: z
        .string()
        .min(1)
        .max(256)
        .optional()
        .describe('Required for get_dashboard: exact dashboard UID'),
      limit: z.number().int().min(1).max(100).optional().describe('Maximum dashboards'),
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
    if (action !== 'search_dashboards') throw new Error('Unsupported Grafana action');
    return toolResult(
      await requestJson(context, 'grafana', '/api/search', undefined, {
        type: 'dash-db',
        query: typeof args.query === 'string' ? args.query : '',
        limit: String(capLimit(args.limit)),
      })
    );
  };
}

/**
 * Converts a Prometheus range timestamp to milliseconds.
 *
 * @param value - RFC3339 timestamp or Unix timestamp expressed in seconds.
 * @returns The timestamp in milliseconds.
 * @throws When the timestamp is invalid.
 */
function rangeMilliseconds(value: string): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric * 1000;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Range times must be RFC3339 or Unix timestamps');
  return parsed;
}

/**
 * Parses a positive Prometheus step expressed as seconds or a duration such as `1m`, `1h30m`, or
 * `1ms`.
 *
 * @param value - Numeric seconds or a concatenated Prometheus duration.
 * @returns The step duration in seconds.
 * @throws When the value is not a positive supported duration.
 */
function prometheusStepSeconds(value: string): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const units = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86_400, w: 604_800, y: 31_536_000 };
  let seconds = 0;
  let offset = 0;
  while (offset < value.length) {
    const numberStart = offset;
    while (
      offset < value.length &&
      value.charCodeAt(offset) >= 48 &&
      value.charCodeAt(offset) <= 57
    ) {
      offset++;
    }
    if (offset === numberStart) throw new Error('Prometheus step is invalid');
    if (value[offset] === '.') {
      offset++;
      const fractionStart = offset;
      while (
        offset < value.length &&
        value.charCodeAt(offset) >= 48 &&
        value.charCodeAt(offset) <= 57
      ) {
        offset++;
      }
      if (offset === fractionStart) throw new Error('Prometheus step is invalid');
    }
    const amount = Number(value.slice(numberStart, offset));
    const unitName = value.startsWith('ms', offset) ? 'ms' : value[offset];
    if (!(unitName in units)) throw new Error('Prometheus step is invalid');
    seconds += amount * units[unitName as keyof typeof units];
    offset += unitName.length;
  }
  if (seconds <= 0) throw new Error('Prometheus step is invalid');
  return seconds;
}

/** Read-only Prometheus queries, metadata, and target inspection. */
export class PrometheusTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'prometheus_read',
    shortDescription: 'Query Prometheus metrics and metadata',
    description:
      'Run instant or maximum 24-hour range PromQL queries, inspect metric metadata, or list active scrape targets.',
    schema: z.object({
      action: z
        .enum(['query', 'query_range', 'metadata', 'targets'])
        .describe('Read-only Prometheus operation'),
      query: z
        .string()
        .min(1)
        .max(10_000)
        .optional()
        .describe('Required for query and query_range: PromQL expression'),
      time: z.string().optional().describe('Instant query RFC3339 or Unix-seconds time'),
      start: z.string().optional().describe('Required range-query start'),
      end: z.string().optional().describe('Required range-query end, at most 24 hours later'),
      step: z
        .string()
        .min(1)
        .max(64)
        .optional()
        .describe('Required range-query duration or seconds between points'),
      metric: z.string().max(1024).optional().describe('Optional exact metadata metric name'),
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
      const start = rangeMilliseconds(args.start);
      const end = rangeMilliseconds(args.end);
      assertMaximumRange(start, end, 'Prometheus');
      if ((end - start) / 1000 / prometheusStepSeconds(args.step) + 1 > 11_000) {
        throw new Error('Prometheus range query must request at most 11000 points');
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
    if (action !== 'targets') throw new Error('Unsupported Prometheus action');
    return toolResult(
      await requestJson(context, 'prometheus', '/api/v1/targets', undefined, { state: 'active' })
    );
  };
}

/**
 * Parses an optional trace-query timestamp and applies a bounded default.
 *
 * @param value - Optional RFC3339 timestamp.
 * @param fallback - Timestamp used when the value is omitted.
 * @returns Validated timestamp in milliseconds.
 */
export function traceTime(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error('Trace times must be valid timestamps');
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Trace times must be valid timestamps');
  return parsed;
}

/**
 * Restricts model-supplied KQL to the configured workspace.
 *
 * @param value - Candidate KQL query.
 * @returns The trimmed query.
 * @throws When the query is empty, oversized, or can access external data sources.
 */
export function validateWorkspaceKql(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 10_000) {
    throw new Error('A KQL query of at most 10000 characters is required');
  }
  let code = '';
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    const next = value[index + 1];
    if (lineComment) {
      if (character === '\n') {
        lineComment = false;
        code += character;
      } else {
        code += ' ';
      }
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        code += '  ';
        index++;
      } else {
        code += character === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (quote) {
      if (character === '\\') {
        code += ' ';
        if (next !== undefined) {
          code += ' ';
          index++;
        }
      } else if (character === quote && next === quote) {
        code += '  ';
        index++;
      } else if (character === quote) {
        quote = '';
        code += ' ';
      } else {
        code += character === '\n' ? '\n' : ' ';
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      code += '  ';
      index++;
    } else if (character === '/' && next === '*') {
      blockComment = true;
      code += '  ';
      index++;
    } else if (character === "'" || character === '"') {
      quote = character;
      code += ' ';
    } else {
      code += character;
    }
  }
  if (
    /^\s*\./.test(code) ||
    /\b(?:externaldata|evaluate|cluster|database|workspace|app|resource|adx|arg|http_request|http_request_post)\s*(?:\(|\[|\b)/i.test(
      code
    )
  ) {
    throw new Error('KQL query contains a disallowed cross-service or external-data operator');
  }
  return value.trim();
}

/** Read-only Azure Monitor Logs queries for AKS and application traces. */
export class AzureMonitorTracesTool extends ObservabilityTool {
  readonly config: ToolConfig = {
    name: 'azure_monitor_traces_read',
    shortDescription: 'Query AKS traces in Azure Monitor',
    description:
      'Run read-only KQL queries against an Azure Monitor Log Analytics workspace. A final take 100 limit is always applied. Defaults to recent Application Insights request, dependency, and trace telemetry.',
    schema: z.object({
      query: z
        .string()
        .max(10_000)
        .optional()
        .describe('Workspace-local KQL; defaults to recent requests, dependencies, and traces'),
      start: z.string().optional().describe('Timestamp; defaults to one hour before end'),
      end: z.string().optional().describe('Timestamp; defaults to now, maximum range 24 hours'),
    }),
  };

  handler: ToolHandler = async args => {
    const context = this.getContext();
    const configured = context.config.azureMonitor ?? {};
    const baseUrl = safeBaseUrl(configured.baseUrl, 'azureMonitor');
    const end = traceTime(args.end, Date.now());
    const start = traceTime(args.start, end - 60 * 60 * 1000);
    assertMaximumRange(start, end, 'Azure Monitor');

    let token = configured.token;
    if (!token && context.commandRunner) {
      if (baseUrl.hostname !== 'api.loganalytics.azure.com') {
        throw new Error(
          'Azure CLI tokens can only be sent to api.loganalytics.azure.com; configure a token explicitly for a trusted proxy'
        );
      }
      token =
        (await getAzureAccessToken(context.commandRunner, 'https://api.loganalytics.azure.com')) ??
        undefined;
    }
    if (!token) {
      throw new Error('Azure Monitor requires an access token or an authenticated Azure CLI');
    }
    const query =
      typeof args.query === 'string' && args.query.trim()
        ? validateWorkspaceKql(args.query)
        : 'union isfuzzy=true AppRequests, AppDependencies, AppTraces | top 100 by TimeGenerated desc';

    return toolResult(
      await requestJson(
        {
          ...context,
          config: {
            ...context.config,
            azureMonitor: { ...configured, token },
          },
        },
        'azureMonitor',
        '/query',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `${query}\n| take 100`,
            timespan: `${new Date(start).toISOString()}/${new Date(end).toISOString()}`,
          }),
        }
      )
    );
  };
}
