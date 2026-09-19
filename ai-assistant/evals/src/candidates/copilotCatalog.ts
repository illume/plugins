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

interface CopilotCatalogEntry {
  id?: unknown;
  capabilities?: { type?: unknown };
}

const COPILOT_MODEL_PRIORITY = [
  'gpt-5.4',
  'claude-opus',
  'gpt-5',
  'claude-sonnet',
  'gpt-4',
  'o4',
  'o3',
  'o1',
] as const;

/** Returns enabled chat model IDs from one authenticated Copilot catalog lookup. */
export async function listCopilotChatModels(
  token: string,
  fetchCatalog: typeof fetch = fetch
): Promise<string[]> {
  let response: Response;
  try {
    response = await fetchCatalog('https://api.githubcopilot.com/models', {
      headers: {
        Authorization: `Bearer ${token}`,
        'Copilot-Integration-Id': 'vscode-chat',
      },
    });
  } catch (error) {
    throw new Error(`could not query the Copilot model catalog: ${String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`Copilot model catalog returned HTTP ${response.status}`);
  }

  const body = (await response.json()) as { data?: unknown; models?: unknown };
  const entries = Array.isArray(body.data)
    ? body.data
    : Array.isArray(body.models)
    ? body.models
    : [];
  return (entries as CopilotCatalogEntry[])
    .filter(entry => !entry.capabilities?.type || entry.capabilities.type === 'chat')
    .map(entry => entry.id)
    .filter((id): id is string => typeof id === 'string');
}

/** Selects the product-preferred model from a frozen enabled-model list. */
export function selectPreferredCopilotModel(models: string[]): string {
  for (const priority of COPILOT_MODEL_PRIORITY) {
    const match = models.find(model =>
      priority === 'gpt-5.4'
        ? model.toLowerCase() === priority
        : model.toLowerCase().includes(priority)
    );
    if (match) return match;
  }
  if (models[0]) return models[0];
  throw new Error('Copilot model catalog contains no enabled chat models');
}

/** Verifies that an explicit model is enabled for the authenticated Copilot account. */
export async function assertCopilotModelAvailable(
  token: string,
  model: string,
  fetchCatalog: typeof fetch = fetch
): Promise<void> {
  const enabled = await listCopilotChatModels(token, fetchCatalog);
  if (!enabled.includes(model)) {
    const hint = enabled.length > 0 ? ` Enabled chat models: ${enabled.join(', ')}.` : '';
    throw new Error(`Copilot model ${model} is not enabled for this account.${hint}`);
  }
}
