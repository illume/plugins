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

import AgentHarnessSession from '@headlamp-k8s/ai-common/assistant/AgentHarnessSession';
import LangChainAssistantSession from '@headlamp-k8s/ai-common/assistant/LangChainAssistantSession';
import { describe, expect, it } from 'vitest';
import { createManager, query } from './chat.js';

describe('chat', () => {
  it('exports a query function', () => {
    expect(typeof query).toBe('function');
  });

  it('uses the production session unless the experimental harness is requested', async () => {
    const production = await createManager('mock-testing-model', {}, { mockTools: true });
    const experimental = await createManager('mock-testing-model', {}, {
      mockTools: true,
      experimentalAgentHarness: true,
    });

    expect(production).toBeInstanceOf(LangChainAssistantSession);
    expect(production).not.toBeInstanceOf(AgentHarnessSession);
    expect(experimental).toBeInstanceOf(AgentHarnessSession);
  });
});
