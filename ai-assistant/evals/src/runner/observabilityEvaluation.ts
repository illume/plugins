import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalStringify, type JsonValue } from '../canonicalJson.js';
import type { DiagnosisSubmission, EvaluatorPacket } from '../contracts/evaluationContracts.js';
import {
  gradeRecommendedFix,
  gradeRootCause,
  parseSubmission,
  type RootCauseGradingInput,
} from '../grading/diagnosisGrader.js';
import {
  observabilityCandidatePacket,
  observabilityScenarios,
  type ObservabilityScenario,
  type ObservabilityToolName,
} from '../scenarios/observabilityScenarios.js';

export type ObservabilityTrialMode = 'enabled' | 'kubernetes-only' | 'provider-unavailable';
type Observation = RootCauseGradingInput['retrievedObservations'][number];

export interface ObservabilityCandidateInput {
  packet: ReturnType<typeof observabilityCandidatePacket>;
  enabledTools: string[];
  callTool: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<{
    content: string;
    observations: Observation[];
  }>;
}

export type ObservabilityCandidate = (input: ObservabilityCandidateInput) => Promise<string | null>;

const config = {
  datadog: {
    baseUrl: 'https://datadog.eval.invalid',
    apiKey: 'fixture',
    applicationKey: 'fixture',
  },
  splunk: { baseUrl: 'https://splunk.eval.invalid', token: 'fixture' },
  grafana: { baseUrl: 'https://grafana.eval.invalid', token: 'fixture' },
  prometheus: { baseUrl: 'https://prometheus.eval.invalid', token: 'fixture' },
  azureMonitor: {
    baseUrl: 'https://api.loganalytics.azure.com/v1/workspaces/eval-workspace',
    token: 'fixture',
    managementToken: 'fixture',
  },
};

interface NativeTool {
  config: { name: string; schema: { parse: (args: unknown) => Record<string, unknown> } };
  setContext: (context: { config: typeof config; fetch: typeof fetch }) => void;
  handler: (
    args: Record<string, unknown>
  ) => Promise<{ success: boolean; data?: JsonValue; content?: unknown }>;
}

async function loadNativeTool(name: ObservabilityToolName): Promise<NativeTool> {
  const exportNames = {
    datadog_read: 'DatadogTool',
    splunk_read: 'SplunkTool',
    grafana_read: 'GrafanaTool',
    prometheus_read: 'PrometheusTool',
    azure_monitor_traces_read: 'AzureMonitorTracesTool',
    azure_network_config_read: 'AzureNetworkConfigTool',
  };
  const file = name === 'azure_network_config_read' ? 'AzureAksTools' : 'ObservabilityTools';
  const source = new URL(
    `../../../packages/ai-common/src/tools/observability/${file}.ts`,
    import.meta.url
  );
  const exports: Record<string, new () => NativeTool> = await import(source.href);
  const Tool = exports[exportNames[name]];
  assert.ok(Tool, `No production tool for ${name}`);
  const tool = new Tool();
  assert.equal(tool.config.name, name);
  return tool;
}

function observationsFor(
  value: JsonValue,
  resource: string,
  evidenceId: string,
  pointer = ''
): Observation[] {
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) =>
      observationsFor(
        nested,
        resource,
        evidenceId,
        `${pointer}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
      )
    );
  }
  return [
    { evidence_id: evidenceId, resource_ref: resource, field_path: pointer, value: String(value) },
  ];
}

function evaluatorFor(scenario: ObservabilityScenario): EvaluatorPacket {
  return {
    schema_version: '1.0.0',
    scenario_id: scenario.id,
    scenario_version: '1.0.0',
    accepted_fact_sets: [
      scenario.expectedFacts.map((fact, index) => ({
        ...fact,
        fact_id: `external-fact-${index}`,
        resource_ref: `tool/${scenario.requiredTool}`,
      })),
    ],
    accepted_actions: [
      { action_id: 'no-op', operation: 'no_action', description: 'Read-only investigation.' },
    ],
    contradiction_facts: [],
    expects_uncertainty: false,
    secret_canary: 'OBSERVABILITY-EVAL-NOT-A-CREDENTIAL',
  };
}

export async function runObservabilityTrial(
  scenario: ObservabilityScenario,
  mode: ObservabilityTrialMode,
  candidate: ObservabilityCandidate
) {
  const evidence: Observation[] = [];
  const calls: Array<{ tool: string; success: boolean }> = [];
  let rejectedCalls = 0;
  let unsupportedRequests = 0;
  let providerRequests = 0;
  let finished = false;
  const enabledTools = [
    'kubernetes_api_request',
    ...(mode === 'kubernetes-only' ? [] : [scenario.requiredTool]),
  ];
  const tool = await loadNativeTool(scenario.requiredTool);
  tool.setContext({
    config: structuredClone(config),
    fetch: async (input, init) => {
      providerRequests++;
      const url = new URL(String(input));
      const expectedUrl = new URL(scenario.request.url);
      const body =
        init?.body instanceof URLSearchParams
          ? Object.fromEntries(init.body)
          : typeof init?.body === 'string'
          ? JSON.parse(init.body)
          : undefined;
      const matches =
        url.origin === expectedUrl.origin &&
        url.pathname === expectedUrl.pathname &&
        canonicalStringify(Object.fromEntries(url.searchParams)) ===
          canonicalStringify(Object.fromEntries(expectedUrl.searchParams)) &&
        (init?.method ?? 'GET') === scenario.request.method &&
        canonicalStringify(body ?? null) === canonicalStringify(scenario.request.body ?? null);
      if (!matches) {
        unsupportedRequests++;
        return new Response('{}', { status: 400 });
      }
      if (mode === 'provider-unavailable') return new Response('{}', { status: 403 });
      return new Response(JSON.stringify(scenario.response), {
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const callTool: ObservabilityCandidateInput['callTool'] = async (name, args) => {
    if (finished || calls.length >= 8 || !enabledTools.includes(name)) {
      rejectedCalls++;
      throw new Error('Tool is disabled, trial is finished, or the call budget is exhausted');
    }
    const call = { tool: name, success: false };
    calls.push(call);
    let data: JsonValue;
    let content: string;
    if (name === 'kubernetes_api_request') {
      if (args.method !== 'GET' || args.path !== '/eval/kubernetes-snapshot') {
        rejectedCalls++;
        throw new Error('Only GET /eval/kubernetes-snapshot is available');
      }
      data = structuredClone(scenario.kubernetesEvidence);
      content = JSON.stringify(data);
    } else {
      const parsed = tool.config.schema.parse(args);
      const result = await tool.handler(parsed);
      if (!result.success || result.data === undefined)
        throw new Error('Tool did not return complete evidence');
      data = result.data as JsonValue;
      content = String(result.content);
    }
    if (finished) throw new Error('Trial finished before the tool result was consumed');
    const observations = observationsFor(data, `tool/${name}`, randomUUID());
    evidence.push(...observations);
    call.success = true;
    return { content, observations: structuredClone(observations) };
  };
  let submissionText: string | null = null;
  let candidateError = false;
  try {
    submissionText = await candidate({
      packet: observabilityCandidatePacket(scenario),
      enabledTools: [...enabledTools],
      callTool,
    });
  } catch {
    candidateError = true;
  } finally {
    finished = true;
  }
  const parsed = parseSubmission(submissionText);
  const rootCause = parsed.submission
    ? gradeRootCause({
        submission: parsed.submission,
        evaluatorPacket: evaluatorFor(scenario),
        retrievedObservations: evidence,
        graderResultId: randomUUID(),
      })
    : null;
  const readOnly = parsed.submission
    ? gradeRecommendedFix({ submission: parsed.submission, graderResultId: randomUUID() }).dimension
    : null;
  const retrievedExternalEvidence = calls.some(
    call => call.tool === scenario.requiredTool && call.success
  );
  const insufficientEvidence =
    parsed.submission?.uncertainty.is_uncertain === true &&
    parsed.submission.cause_facts.length === 0;
  const valid = !candidateError && parsed.status === 'valid' && unsupportedRequests === 0;
  return {
    scenarioId: scenario.id,
    mode,
    valid,
    submissionStatus: parsed.status,
    candidateError,
    submission: parsed.submission,
    observations: evidence,
    passed:
      valid &&
      rootCause?.outcome === 'pass' &&
      readOnly?.outcome === 'pass' &&
      rejectedCalls === 0 &&
      retrievedExternalEvidence &&
      !parsed.submission?.uncertainty.is_uncertain,
    insufficientEvidence,
    rootCause,
    readOnly,
    calls,
    providerRequests,
    rejectedCalls,
    unsupportedRequests,
  };
}

export function observabilityControlSubmission(observations: Observation[]): string {
  const submission: DiagnosisSubmission = {
    schema_version: '1.0.0',
    cause_facts: observations.map(observation => ({
      resource_ref: observation.resource_ref,
      field_path: observation.field_path,
      observed_value: observation.value,
    })),
    resource_refs: [...new Set(observations.map(observation => observation.resource_ref))],
    evidence_refs: [...new Set(observations.map(observation => observation.evidence_id))],
    alternative_dispositions: [],
    uncertainty: { is_uncertain: observations.length === 0 },
    proposed_actions: [{ operation: 'no_action', description: 'Read-only investigation.' }],
  };
  return JSON.stringify(submission);
}

export async function verifyObservabilityScenarios() {
  const results = [];
  for (const scenario of observabilityScenarios) {
    const reference: ObservabilityCandidate = async input => {
      await input.callTool('kubernetes_api_request', {
        method: 'GET',
        path: '/eval/kubernetes-snapshot',
      });
      const read = input.packet.readRequests[0];
      assert.ok(read);
      if (!input.enabledTools.includes(read.tool)) return observabilityControlSubmission([]);
      try {
        const output = await input.callTool(read.tool, read.args);
        return observabilityControlSubmission(output.observations);
      } catch {
        return observabilityControlSubmission([]);
      }
    };
    const enabled = await runObservabilityTrial(scenario, 'enabled', reference);
    const disabled = await runObservabilityTrial(scenario, 'kubernetes-only', reference);
    const unavailable = await runObservabilityTrial(scenario, 'provider-unavailable', reference);
    assert.equal(enabled.passed, true, `${scenario.id}: production tool fixture or grader failed`);
    assert.equal(disabled.passed, false);
    assert.equal(disabled.providerRequests, 0);
    assert.equal(disabled.calls[0]?.success, true);
    assert.equal(disabled.insufficientEvidence, true);
    assert.equal(unavailable.passed, false);
    assert.equal(unavailable.insufficientEvidence, true);
    results.push({
      scenario: scenario.id,
      tool: scenario.requiredTool,
      enabled: 'pass',
      kubernetesOnly: 'insufficient_evidence',
      providerUnavailable: 'insufficient_evidence',
    });
  }
  return {
    kind: 'fixture-contract-verification',
    modelInvocations: 0,
    qualification: 'pending',
    scenarios: results,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifyObservabilityScenarios(), null, 2));
}
