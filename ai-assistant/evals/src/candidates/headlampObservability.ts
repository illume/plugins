import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import type {
  LiveObservabilityCandidate,
  LiveObservabilityCandidateInput,
} from '../runner/observabilityEvaluation.js';
import { extractJsonBlock } from './headlampCli.js';
import { loadSchema } from '../contracts/schemas.js';

interface Session {
  setContext(context: string): void;
  enableDirectToolCalling(tools: unknown[]): Promise<void>;
  userSend(message: string): Promise<{ content: string }>;
  abort(): void;
}

export interface HeadlampObservabilityOptions {
  provider: string;
  config: Record<string, unknown>;
  record?: (value: {
    text: string;
    telemetry: unknown[];
    enabledTools: string[];
    durationMs: number;
  }) => void;
}

export async function createHeadlampObservabilityCandidate(
  options: HeadlampObservabilityOptions
): Promise<LiveObservabilityCandidate> {
  const sessionUrl = new URL(
    '../../../packages/ai-common/src/assistant/LangChainAssistantSession.ts',
    import.meta.url
  );
  const SessionClass = (await import(sessionUrl.href)).default as new (
    provider: string,
    config: Record<string, unknown>,
    enabled: string[],
    options: Record<string, unknown>
  ) => Session;
  const require = createRequire(new URL('../../../package.json', import.meta.url));
  const { DynamicStructuredTool } = await import(
    pathToFileURL(require.resolve('@langchain/core/tools')).href
  );
  const { z } = await import(pathToFileURL(require.resolve('zod')).href);
  return async input => {
    const telemetry: unknown[] = [];
    const started = Date.now();
    const manager = new SessionClass(options.provider, options.config, [], {
      autoApproveObservabilityTools: true,
      telemetryObserver: (event: unknown) => telemetry.push(event),
    });
    const abort = () => manager.abort();
    input.signal.addEventListener('abort', abort, { once: true });
    let text = '';
    try {
      assert.ok(!input.signal.aborted, 'Trial was already cancelled');
      const tools = input.readRequests
        .filter(request => input.enabledTools.includes(request.tool))
        .map(
          request =>
            new DynamicStructuredTool({
              name: request.tool,
              description: `Read-only investigation of the current AKS incident. Use these exact resource-scoped arguments: ${JSON.stringify(
                request.args
              )}`,
              schema: z.object(
                Object.fromEntries(Object.keys(request.args).map(key => [key, z.string()]))
              ),
              func: async (args: Record<string, unknown>) =>
                JSON.stringify(await input.callTool(request.tool, args)),
            })
        );
      manager.setContext(
        `AKS cluster: ${input.clusterId}\nCurrent namespace: observability-eval\nResource: ${input.resourceId}`
      );
      await manager.enableDirectToolCalling(tools);
      const response = await manager.userSend(observabilityPrompt(input));
      text = response.content;
      return extractJsonBlock(text) ?? text;
    } finally {
      input.signal.removeEventListener('abort', abort);
      manager.abort();
      options.record?.({
        text,
        telemetry,
        enabledTools: [...input.enabledTools],
        durationMs: Date.now() - started,
      });
    }
  };
}

export function observabilityPrompt(input: LiveObservabilityCandidateInput): string {
  const requests = input.readRequests.filter(request => input.enabledTools.includes(request.tool));
  const schema = structuredClone(loadSchema('diagnosis-submission'));
  delete schema.$id;
  return `${input.task}\n\nAvailable resource-scoped reads:\n${JSON.stringify(
    requests
  )}\n\nUse tools to retrieve evidence before concluding. Each tool returns observations with resource_ref, field_path, value and evidence_id. Cite exact values and paths for the causal configuration, including its identifying resource/rule and settings that explain the symptom. Do not infer unavailable Azure settings from Kubernetes symptoms. If evidence is insufficient, state uncertainty instead of inventing a cause.\n\nReturn a JSON INSTANCE, not a schema. Its only top-level keys are schema_version, cause_facts, resource_refs, evidence_refs, alternative_dispositions, uncertainty, proposed_actions. Do not include $id, type, properties, or other schema metadata.\nSubmission shape (populate with retrieved facts): {"schema_version":"1.0.0","cause_facts":[],"resource_refs":[],"evidence_refs":[],"alternative_dispositions":[],"uncertainty":{"is_uncertain":true},"proposed_actions":[{"operation":"no_action","description":"Read-only investigation"}]}\nValidation schema:\n${JSON.stringify(
    schema
  )}`;
}
