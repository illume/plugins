import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { sha256OfJson } from '../canonicalJson.js';
import type {
  CandidateAdapter,
  CandidateInvocationInput,
  CandidateInvocationResult,
} from './candidateAdapter.js';
import { diagnosisInstruction } from './holmesGptAdapter.js';
import type { ReferenceAdapterQualificationTarget } from './referenceQualification.js';

export const KUBECTL_AI_RELEASE = 'v0.0.31';
export const KUBECTL_AI_TIMEOUT_MS = 90_000;

interface ProcessOptions {
  encoding: 'utf8';
  timeout: number;
  maxBuffer: number;
  input?: string;
  env?: NodeJS.ProcessEnv;
}

interface ProcessResult {
  status: number | null;
  stdout: string | null;
  stderr: string | null;
  error?: NodeJS.ErrnoException;
}

export type KubectlAiProcessRunner = (
  command: string,
  args: string[],
  options: ProcessOptions
) => ProcessResult;

export interface KubectlAiCandidateOptions {
  image: string;
  model: string;
  apiKey: string;
  endpoint: string;
  timeoutMs?: number;
  runner?: KubectlAiProcessRunner;
}

interface NativeMessage {
  Source: 'user' | 'model' | 'agent';
  Type: string;
  Payload: unknown;
}

function extractSubmission(text: string): string | null {
  const extracted = /^```json\s*\n([\s\S]*?)\n?```$/i.exec(text.trim())?.[1]?.trim() ?? text.trim();
  try {
    const parsed: unknown = JSON.parse(extracted);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? extracted
      : null;
  } catch {
    return null;
  }
}

export function parseKubectlAiSession(history: string): {
  messages: NativeMessage[];
  finalText: string | null;
  blocked: boolean;
  toolEvents: NonNullable<CandidateInvocationResult['tool_events']>;
} {
  const messages: NativeMessage[] = history
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      const value = JSON.parse(line);
      if (
        !value ||
        !['user', 'model', 'agent'].includes(value.Source) ||
        typeof value.Type !== 'string' ||
        !Object.hasOwn(value, 'Payload') ||
        (value.Type === 'text' && typeof value.Payload !== 'string')
      ) {
        throw new Error('Invalid kubectl-ai session message');
      }
      return value as NativeMessage;
    });
  if (messages[0]?.Source !== 'user' || messages[0]?.Type !== 'text') {
    throw new Error('Missing kubectl-ai user message');
  }
  const requests = messages.filter(message => message.Type === 'tool-call-request');
  const permissions = messages.filter(
    message =>
      ['user-input-request', 'user-choice-request'].includes(message.Type) ||
      (message.Type === 'error' &&
        typeof message.Payload === 'string' &&
        message.Payload.startsWith('RunOnce mode cannot handle permission requests.'))
  );
  const blocked = messages.some(message => message.Type !== 'text') || requests.length > 0;
  const last = messages.at(-1);
  return {
    messages,
    finalText:
      !blocked &&
      last?.Source === 'model' &&
      last.Type === 'text' &&
      typeof last.Payload === 'string' &&
      last.Payload.trim()
        ? last.Payload
        : null,
    blocked,
    toolEvents: [...requests, ...permissions].map(() => ({
      tool_name: 'kubectl-ai.local-tool',
      mutating: true,
      status: 'denied',
    })),
  };
}

function assertPinnedImage(image: string): void {
  if (!/^(?:sha256:|[^\s]+@sha256:)[a-f0-9]{64}$/.test(image)) {
    throw new Error('kubectl-ai requires an immutable image ID or digest');
  }
}

export function buildKubectlAiPrompt(input: CandidateInvocationInput): string {
  const observations = input.observations.map(observation => ({
    evidence_id: observation.evidence_id,
    resource_ref: observation.resource_ref,
    field_path: observation.field_path,
    observed_value: observation.value,
  }));
  return `${input.packet.task_prompt}\n\nObserved context:\n${JSON.stringify(
    observations,
    null,
    2
  )}\n\n${diagnosisInstruction}`;
}

function normalizeSession(input: CandidateInvocationInput, history: string) {
  const session = parseKubectlAiSession(history);
  if (session.messages[0]?.Payload !== buildKubectlAiPrompt(input)) {
    throw new Error('kubectl-ai session input differs from supplied prompt');
  }
  return {
    ...session,
    submissionText: session.finalText ? extractSubmission(session.finalText) : null,
  };
}

export function createKubectlAiQualificationTarget(
  image: string,
  runner: KubectlAiProcessRunner = (command, args, settings) => spawnSync(command, args, settings)
): ReferenceAdapterQualificationTarget {
  assertPinnedImage(image);
  const name = `kubectl-ai-qualification-${randomUUID()}`;
  let healthStarted = false;
  const settings: ProcessOptions = { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 };
  return {
    system: 'kubectl-ai',
    async startup() {
      const result = runner('docker', ['image', 'inspect', image], settings);
      if (result.status !== 0 || result.error)
        throw new Error('Pinned kubectl-ai image is unavailable');
    },
    async health() {
      healthStarted = true;
      const result = runner(
        'docker',
        [
          'run',
          '--name',
          name,
          '--network=none',
          '--read-only',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges',
          '--tmpfs',
          '/tmp:rw,noexec,nosuid,size=32m',
          image,
          'version',
        ],
        settings
      );
      return (
        result.status === 0 &&
        !result.error &&
        !!result.stdout?.includes('version: 0.0.31') &&
        result.stdout.includes('08cf256aa2f5749958f76659134625fe70a19a15')
      );
    },
    async normalizeFixedSubmission(input, history) {
      const session = normalizeSession(input, history);
      return {
        raw_text: history,
        submission_text: session.submissionText,
        status: session.finalText && !session.blocked ? 'ok' : 'unavailable',
        duration_ns: '0',
        tool_events: session.toolEvents,
      };
    },
    async cleanup() {
      if (!healthStarted) return;
      const result = runner('docker', ['rm', '-f', name], settings);
      if (result.error || (result.status !== 0 && !result.stderr?.includes('No such container'))) {
        throw new Error('kubectl-ai qualification cleanup could not be verified');
      }
    },
  };
}

export function createKubectlAiCandidate(options: KubectlAiCandidateOptions): CandidateAdapter {
  assertPinnedImage(options.image);
  if (!options.model.trim() || !options.apiKey.trim()) {
    throw new Error('kubectl-ai requires an Azure deployment and API key');
  }
  const endpoint = new URL(options.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) {
    throw new Error('kubectl-ai requires an HTTPS Azure endpoint without embedded credentials');
  }
  const timeoutMs = options.timeoutMs ?? KUBECTL_AI_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > KUBECTL_AI_TIMEOUT_MS) {
    throw new Error('kubectl-ai timeout must be between 1 and 90000 milliseconds');
  }
  const runner: KubectlAiProcessRunner =
    options.runner ?? ((command, args, settings) => spawnSync(command, args, settings));
  const redact = (text: string) => text.replaceAll(options.apiKey, '[REDACTED]');
  return {
    id: 'kubectl-ai',
    kind: 'reference-system',
    identity: {
      candidate_id: 'kubectl-ai',
      kind: 'reference-system',
      configuration_digest: sha256OfJson({
        image: options.image,
        release: KUBECTL_AI_RELEASE,
        provider: 'azopenai',
        model: options.model,
        endpoint: options.endpoint,
        timeout_ms: timeoutMs,
        max_iterations: 2,
        mode: 'supplied-evidence',
        diagnosisInstruction,
      }),
    },
    async invoke(input) {
      if (input.packet.required_submission_schema !== 'diagnosis_submission@1.0.0') {
        return {
          raw_text: 'kubectl-ai repair execution is unsupported.',
          submission_text: null,
          status: 'unavailable',
          duration_ns: '0',
          tool_events: [],
        };
      }
      const directory = mkdtempSync(path.join(process.cwd(), '.kubectl-ai-eval-'));
      const name = `kubectl-ai-eval-${randomUUID()}`;
      const started = process.hrtime.bigint();
      const prompt = buildKubectlAiPrompt(input);
      try {
        let result: ProcessResult;
        try {
          result = runner(
            'docker',
            [
              'run',
              '--name',
              name,
              '--interactive',
              '--user',
              `${process.getuid?.() ?? 65532}:${process.getgid?.() ?? 65532}`,
              '--read-only',
              '--cap-drop=ALL',
              '--security-opt=no-new-privileges',
              '--tmpfs',
              '/tmp:rw,noexec,nosuid,size=32m',
              '--mount',
              `type=bind,src=${directory},dst=/output`,
              '--env',
              'HOME=/output',
              '--env',
              'PATH=/unavailable',
              '--env',
              'AZURE_OPENAI_API_KEY',
              '--env',
              'AZURE_OPENAI_ENDPOINT',
              options.image,
              '--llm-provider=azopenai',
              `--model=${options.model}`,
              '--quiet',
              '--max-iterations=2',
              '--trace-path=/output/trace.jsonl',
              '--new-session',
              '--session-backend=filesystem',
            ],
            {
              encoding: 'utf8',
              timeout: timeoutMs,
              maxBuffer: 8 * 1024 * 1024,
              input: prompt,
              env: {
                ...process.env,
                AZURE_OPENAI_API_KEY: options.apiKey,
                AZURE_OPENAI_ENDPOINT: options.endpoint,
              },
            }
          );
        } finally {
          const cleanup = runner('docker', ['rm', '-f', name], {
            encoding: 'utf8',
            timeout: 10_000,
            maxBuffer: 64 * 1024,
          });
          if (
            cleanup.error ||
            (cleanup.status !== 0 && !cleanup.stderr?.includes('No such container'))
          ) {
            throw new Error('kubectl-ai container cleanup could not be verified');
          }
        }
        const histories = readdirSync(directory, { recursive: true })
          .map(String)
          .filter(file => /^\.kubectl-ai\/sessions\/[^/]+\/history\.json$/.test(file));
        let session: ReturnType<typeof normalizeSession> | undefined;
        let sessionError: string | undefined;
        try {
          if (histories.length !== 1) throw new Error('Expected exactly one kubectl-ai session');
          session = normalizeSession(
            input,
            readFileSync(path.join(directory, histories[0]!), 'utf8')
          );
        } catch (error) {
          session = undefined;
          sessionError = error instanceof Error ? error.message : String(error);
        }
        const succeeded =
          result.status === 0 && !result.error && !!session?.finalText && !session.blocked;
        const tracePath = path.join(directory, 'trace.jsonl');
        return {
          raw_text: redact(
            JSON.stringify({
              native_messages: session?.messages ?? null,
              stdout: result.stdout,
              stderr: result.stderr,
              exit_status: result.status,
              process_error: result.error?.message,
              session_error: sessionError,
              trace: existsSync(tracePath) ? readFileSync(tracePath, 'utf8') : null,
            })
          ),
          submission_text: succeeded ? session!.submissionText : null,
          status: result.error?.code === 'ETIMEDOUT' ? 'timeout' : succeeded ? 'ok' : 'unavailable',
          duration_ns: (process.hrtime.bigint() - started).toString(),
          ...(session ? { tool_events: session.toolEvents } : {}),
        };
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}
