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

import AgentHarnessSession from '@headlamp-k8s/ai-common/assistant/AgentHarnessSession';
import type { AssistantTelemetryEvent } from '@headlamp-k8s/ai-common/assistant/telemetry';
import {
  createCompactDiagnosisProviderSchema,
  SUPPLIED_EVIDENCE_CONTEXT,
  type StructuredDiagnosisObservation,
  validateCompactDiagnosisSubmission,
} from '@headlamp-k8s/ai-common/diagnosis/structured';
import type { ProviderSettings } from '@headlamp-k8s/ai-common/providers/savedConfigs';
import { providerStrategy } from 'langchain';

export const BROWSER_EVALUATION_QUERY = 'headlamp-ai-eval';

/** Candidate-visible input accepted by the browser plugin evaluation boundary. */
export interface BrowserEvaluationRequest {
  providerId: string;
  config: ProviderSettings;
  prompt: string;
  observations: StructuredDiagnosisObservation[];
}

/** Sanitized browser plugin output returned to the evaluator. */
export interface BrowserEvaluationResult {
  response: string;
  telemetry: AssistantTelemetryEvent[];
}

interface EvaluationSession {
  userSend(prompt: string): Promise<{ content: string }>;
  abort(): void;
  setContext(context: string): void;
}

type EvaluationSessionFactory = (
  providerId: string,
  config: ProviderSettings,
  observations: StructuredDiagnosisObservation[],
  telemetryObserver: (event: AssistantTelemetryEvent) => void
) => EvaluationSession;

export interface BrowserEvaluationBridge {
  invoke(request: BrowserEvaluationRequest): Promise<BrowserEvaluationResult>;
  abort(): void;
}

declare global {
  interface Window {
    __headlampAiEvaluator?: BrowserEvaluationBridge;
  }
}

/** Creates the browser-only candidate bridge around the production agent harness. */
export function createBrowserEvaluationBridge(
  createSession: EvaluationSessionFactory = (providerId, config, observations, telemetryObserver) =>
    new AgentHarnessSession(providerId, config, [], {
      responseFormat: providerStrategy(createCompactDiagnosisProviderSchema()),
      validateStructuredResponse: response =>
        validateCompactDiagnosisSubmission(response, observations),
      telemetryObserver,
    })
): BrowserEvaluationBridge {
  let activeSession: EvaluationSession | null = null;

  return {
    async invoke(request) {
      if (activeSession) throw new Error('A browser plugin evaluation is already running');
      const telemetry: AssistantTelemetryEvent[] = [];
      activeSession = createSession(
        request.providerId,
        request.config,
        request.observations,
        event => {
          telemetry.push(structuredClone(event));
        }
      );
      activeSession.setContext(SUPPLIED_EVIDENCE_CONTEXT);
      try {
        const response = await activeSession.userSend(request.prompt);
        return { response: response.content, telemetry };
      } finally {
        activeSession = null;
      }
    },
    abort() {
      activeSession?.abort();
    },
  };
}

/** Installs the bridge only for an explicitly requested evaluator page load. */
export function installBrowserEvaluationBridge(locationSearch = window.location.search): void {
  if (new URLSearchParams(locationSearch).get(BROWSER_EVALUATION_QUERY) !== '1') return;
  window.__headlampAiEvaluator = createBrowserEvaluationBridge();
}
