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

import LangChainAssistantSession from '@headlamp-k8s/ai-common/assistant/LangChainAssistantSession';
import type { AssistantTelemetryObserver } from '@headlamp-k8s/ai-common/assistant/telemetry';
import { DEFAULT_SKILLS_CONFIG } from '@headlamp-k8s/ai-common/skills/config';
import { createMockSkillManager } from '@headlamp-k8s/ai-common/skills/testing/MockSkillManager';
import { createMockKubernetesToolManager } from '@headlamp-k8s/ai-common/tools/testing/MockToolManager';
import { execFileSync } from 'child_process';
import * as readline from 'readline';
import { createKubectlTool } from './kubectl.js';
import { loadSkillsFromUrls } from './skills.js';

interface KubectlContext {
  cluster: string;
  namespace: string;
}

/** Reads the active cluster and namespace without exposing kubeconfig credentials. */
export function detectKubectlContext(
  run: typeof execFileSync = execFileSync
): KubectlContext | undefined {
  try {
    const output = run('kubectl', ['config', 'view', '--minify', '-o', 'json'], {
      encoding: 'utf8',
    });
    const config = JSON.parse(String(output)) as {
      contexts?: Array<{ context?: { cluster?: string; namespace?: string } }>;
    };
    const context = config.contexts?.[0]?.context;
    if (!context?.cluster) return undefined;
    return { cluster: context.cluster, namespace: context.namespace || 'default' };
  } catch {
    return undefined;
  }
}

/**
 * Create a LangChain assistant session for the given provider and config.
 * This uses the same code path as the Headlamp UI, including
 * the generate()-based tool call extraction that handles the
 * Copilot API's multi-generation responses.
 * Binds a kubectl-backed Kubernetes tool for CLI use.
 *
 * @param allowMutations When false (default), the kubectl tool only permits GET.
 * @param skillSources  Git URLs for skill sources (e.g. https://github.com/microsoft/azure-skills).
 * @param mockSkills    When true, inject a built-in mock skill set (no network needed).
 * @param mockTools     When true, inject mock Kubernetes tool results (no cluster needed).
 */
export async function createManager(
  providerId: string,
  config: Record<string, any>,
  options: {
    allowMutations?: boolean;
    skillSources?: string[];
    mockSkills?: boolean;
    mockTools?: boolean;
    telemetryObserver?: AssistantTelemetryObserver;
  } = {}
): Promise<LangChainAssistantSession> {
  const toolManager = options.mockTools ? createMockKubernetesToolManager() : undefined;
  const manager = new LangChainAssistantSession(
    providerId,
    config,
    [],
    toolManager || options.telemetryObserver
      ? { toolManager, telemetryObserver: options.telemetryObserver }
      : undefined
  );
  const kubectlContext = options.mockTools ? undefined : detectKubectlContext();
  if (kubectlContext) {
    manager.setContext(
      `Kubernetes cluster: ${kubectlContext.cluster}\nCurrent namespace: ${kubectlContext.namespace}\n` +
        `Use ${kubectlContext.namespace} for namespaced Kubernetes API requests unless the user explicitly names another namespace.`
    );
  }
  const kubectlTool = createKubectlTool({
    readOnly: !options.allowMutations,
    namespace: kubectlContext?.namespace,
  });
  await manager.enableDirectToolCalling([kubectlTool]);

  // Inject mock skills when requested (no network needed — good for demos and tests)
  if (options.mockSkills) {
    manager.setSkillManager(createMockSkillManager() as any, DEFAULT_SKILLS_CONFIG);
    console.error('Using built-in mock skill set (--mock-skills).');
  }

  // Load skills from Git repos if any were specified
  if (options.skillSources && options.skillSources.length > 0) {
    const {
      manager: skillManager,
      config: skillsConfig,
      errors,
      skillCount,
    } = await loadSkillsFromUrls(options.skillSources);

    for (const err of errors) {
      console.error(`Warning: Failed to load skills from ${err.sourceUrl}: ${err.error}`);
    }

    if (skillCount > 0) {
      manager.setSkillManager(skillManager, skillsConfig);
      console.error(`Loaded ${skillCount} skill(s) from ${options.skillSources.length} source(s).`);
    } else if (errors.length === 0) {
      console.error('No skills found in the specified source(s).');
    }
  }

  return manager;
}

/** Send one message through the assistant session and return the text. */
export async function query(manager: LangChainAssistantSession, message: string): Promise<string> {
  const result = await manager.userSend(message);
  return result.content;
}

/** Run an interactive REPL session using the assistant session. */
export async function interactiveMode(manager: LangChainAssistantSession): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('Headlamp AI Assistant (interactive mode)');
  console.log('Type your questions. Press Ctrl+C or type "exit" to quit.\n');

  const ask = () => {
    rl.question('You: ', async input => {
      const trimmed = input.trim();
      if (!trimmed || ['exit', 'quit'].includes(trimmed.toLowerCase())) {
        rl.close();
        return;
      }
      try {
        const resp = await query(manager, trimmed);
        console.log(`\nAssistant: ${resp}\n`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`\nError: ${message}\n`);
      }
      ask();
    });
  };

  ask();
}
