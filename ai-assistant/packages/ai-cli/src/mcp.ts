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

import { makeMcpServers } from '@headlamp-k8s/ai-common/mcp/config/serverConfig';
import type { MCPSettings } from '@headlamp-k8s/ai-common/mcp/types';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';

/** Initialises MCP tools from MCPSettings. Returns a bound model and a cleanup fn. */
export async function initMCPTools(
  model: BaseChatModel,
  mcpConfig: MCPSettings | undefined
): Promise<{ model: BaseChatModel; cleanup: () => Promise<void> }> {
  const noop = async () => {};
  if (!mcpConfig?.enabled || !mcpConfig.servers?.length) return { model, cleanup: noop };

  const mcpServers = makeMcpServers(mcpConfig, []);

  if (Object.keys(mcpServers).length === 0) return { model, cleanup: noop };

  const client = new MultiServerMCPClient({ mcpServers });
  const tools = await client.getTools();
  if (!tools?.length) {
    await client.close();
    return { model, cleanup: noop };
  }

  const boundModel = model.bindTools!(tools) as BaseChatModel;
  return {
    model: boundModel,
    cleanup: async () => {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    },
  };
}
