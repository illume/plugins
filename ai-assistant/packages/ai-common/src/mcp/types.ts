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

/**
 * MCP types shared by the AI assistant and Electron integrations.
 */

/**
 * Stores the persisted MCP feature configuration.
 */
export interface MCPSettings {
  /** Whether MCP integrations are globally enabled. */
  enabled: boolean;
  /** Configured MCP servers available to the client. */
  servers: MCPServer[];
}

/** Fields shared by every MCP server transport. */
interface MCPServerBase {
  /** Unique server name used in tool prefixes and settings. */
  name: string;
  /** Whether this server should be started by the client. */
  enabled: boolean;
  /** Whether tools from this server may run without prompting. */
  autoApprove?: boolean;
}

/** MCP server launched as a local stdio process. */
export interface MCPStdioServer extends MCPServerBase {
  /** Stdio transport; omission retains legacy stdio behavior. */
  transport?: 'stdio';
  /** Executable used to start the server. */
  command: string;
  /** Arguments passed to the server command. */
  args: string[];
  /** Optional environment variables added to the server process. */
  env?: Record<string, string>;
  /** Remote endpoints do not apply to stdio servers. */
  url?: never;
  /** Request headers do not apply to stdio servers. */
  headers?: never;
}

/** MCP server reached through a remote HTTP transport. */
export interface MCPRemoteServer extends MCPServerBase {
  /** Remote MCP transport. */
  transport: 'http' | 'sse';
  /** Remote MCP endpoint. */
  url: string;
  /** Optional request headers sent to the endpoint. */
  headers?: Record<string, string>;
  /** Unused legacy command accepted when normalizing older settings. */
  command?: string;
  /** Unused legacy arguments accepted when normalizing older settings. */
  args?: string[];
  /** Process environment variables do not apply to remote servers. */
  env?: never;
}

/** MCP server configuration discriminated by transport. */
export type MCPServer = MCPStdioServer | MCPRemoteServer;

/**
 * Tracks persisted state for a single MCP tool.
 */
export interface MCPToolState {
  /**
   * Whether the tool is currently enabled.
   *
   * Optional rather than required because persisted configs written by older
   * versions of this package may omit the field. All callers must treat a
   * missing value as `true` (default-enabled). Use `enabled !== false` instead
   * of `!!enabled` for correct semantics.
   */
  enabled?: boolean;
  /** Timestamp of the most recent tool execution (ISO-8601 string). */
  lastUsed?: string;
  /** Number of recorded executions for the tool. */
  usageCount?: number;
  /** JSON schema used to validate tool input arguments. */
  inputSchema?: Record<string, unknown> | null;
  /** Human-readable description returned by the MCP server. */
  description?: string;
}

/**
 * Groups tool state for one MCP server.
 */
export interface MCPServerToolState {
  /** Tool state keyed by tool name. */
  [toolName: string]: MCPToolState;
}

/**
 * Groups tool state for all configured MCP servers.
 */
export interface MCPToolsConfig {
  /** Server tool state keyed by server name. */
  [serverName: string]: MCPServerToolState;
}
