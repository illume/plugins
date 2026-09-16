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

/** Verifies that an explicit model is enabled for the authenticated Copilot account. */
export async function assertCopilotModelAvailable(
  token: string,
  model: string,
  fetchCatalog: typeof fetch = fetch
): Promise<void> {
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
  const enabled = (entries as CopilotCatalogEntry[])
    .filter(entry => !entry.capabilities?.type || entry.capabilities.type === 'chat')
    .map(entry => entry.id)
    .filter((id): id is string => typeof id === 'string');
  if (!enabled.includes(model)) {
    const hint = enabled.length > 0 ? ` Enabled chat models: ${enabled.join(', ')}.` : '';
    throw new Error(`Copilot model ${model} is not enabled for this account.${hint}`);
  }
}
