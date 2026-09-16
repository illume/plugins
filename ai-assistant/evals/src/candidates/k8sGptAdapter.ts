/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sha256OfJson } from '../canonicalJson.js';
import type {
  CandidateAdapter,
  CandidateInvocationInput,
  CandidateInvocationResult,
} from './candidateAdapter.js';
import {
  ContainerReferenceAdapter,
  type ContainerReferenceAdapterOptions,
} from './containerReferenceAdapter.js';

export const K8S_GPT_IMAGE =
  'ghcr.io/k8sgpt-ai/k8sgpt@sha256:f8b2965530701d6adedd52bc9d618e7d5999e7c91886ee8a620fdeecd964ca2e';

export interface K8sGptCandidateOptions extends ContainerReferenceAdapterOptions {
  model: string;
  deployment: string;
  apiKey: string;
  apiBase: string;
  apiVersion: string;
}

const analyzerByObservationKind: Record<string, string> = {
  deployment: 'Deployment',
  event: 'Pod',
  persistentvolumeclaim: 'PersistentVolumeClaim',
  pod: 'Pod',
  service: 'Service',
};

function hasSuccessfulExplanation(rawOutput: string): boolean {
  try {
    const output = JSON.parse(rawOutput) as Record<string, unknown> | null;
    if (
      !output ||
      output.provider !== 'azureopenai' ||
      !Number.isSafeInteger(output.problems) ||
      Number(output.problems) < 0 ||
      (output.errors !== null && (!Array.isArray(output.errors) || output.errors.length !== 0))
    ) {
      return false;
    }
    if (output.problems === 0) {
      return (
        output.status === 'OK' &&
        (output.results === null || (Array.isArray(output.results) && output.results.length === 0))
      );
    }
    return (
      output.status === 'ProblemDetected' &&
      Array.isArray(output.results) &&
      output.results.length > 0 &&
      output.results.every(
        result =>
          result !== null &&
          typeof result === 'object' &&
          typeof result.details === 'string' &&
          result.details.trim().length > 0
      )
    );
  } catch {
    return false;
  }
}

/** Digest-pinned K8sGPT qualification adapter. */
export class K8sGptAdapter extends ContainerReferenceAdapter {
  readonly system = 'k8sgpt' as const;

  constructor(options: ContainerReferenceAdapterOptions) {
    super(options);
  }

  protected healthCommand(): string[] {
    return ['version'];
  }

  protected override dockerRunArgs(command: string[]): string[] {
    const args = super.dockerRunArgs(command);
    args.splice(6, 0, '--tmpfs', '/home/nonroot/.config:rw,noexec,nosuid,size=16m');
    return args;
  }

  protected normalizeNativeOutput(): null {
    return null;
  }

  runCandidate(
    input: CandidateInvocationInput,
    options: K8sGptCandidateOptions
  ): CandidateInvocationResult {
    const started = process.hrtime.bigint();
    const kubeconfigPath = input.environment?.KUBECONFIG;
    const namespace = input.environment?.KUBERNETES_NAMESPACE;
    if (!kubeconfigPath || !namespace) {
      return {
        raw_text: 'K8sGPT requires an ephemeral kubeconfig and trial namespace.',
        submission_text: null,
        status: 'unavailable',
        duration_ns: (process.hrtime.bigint() - started).toString(),
        tool_events: [],
      };
    }
    const filters = [
      ...new Set(
        input.packet.allowed_observation_kinds
          .map(kind => analyzerByObservationKind[kind.split('.')[0] ?? ''])
          .filter((kind): kind is string => kind !== undefined)
      ),
    ];
    if (filters.length === 0) {
      return {
        raw_text: 'K8sGPT has no analyzer for the allowed observation kinds.',
        submission_text: null,
        status: 'unavailable',
        duration_ns: (process.hrtime.bigint() - started).toString(),
        tool_events: [],
      };
    }

    const directory = mkdtempSync(path.join(process.cwd(), '.k8sgpt-eval-'));
    try {
      const kubeconfig = JSON.parse(readFileSync(kubeconfigPath, 'utf8')) as {
        clusters?: Array<{ cluster?: { server?: string; 'tls-server-name'?: string } }>;
      };
      const cluster = kubeconfig.clusters?.[0]?.cluster;
      if (cluster?.server?.includes('127.0.0.1')) {
        cluster.server = cluster.server.replace('127.0.0.1', 'host.docker.internal');
        cluster['tls-server-name'] = '127.0.0.1';
      }
      writeFileSync(path.join(directory, 'kubeconfig.json'), JSON.stringify(kubeconfig), {
        mode: 0o600,
      });
      writeFileSync(
        path.join(directory, 'k8sgpt.json'),
        JSON.stringify({
          ai: {
            defaultprovider: 'azureopenai',
            providers: [
              {
                name: 'azureopenai',
                model: options.model,
                engine: options.deployment,
                password: options.apiKey,
                baseurl: options.apiBase,
                azureapitype: 'AZURE',
                azureapiversion: options.apiVersion,
                temperature: 0,
              },
            ],
          },
        }),
        { mode: 0o600 }
      );
      const result = this.runner('docker', [
        'run',
        '--rm',
        '--user',
        `${process.getuid?.() ?? 65532}:${process.getgid?.() ?? 65532}`,
        '--env',
        'HOME=/tmp',
        '--read-only',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=16m',
        '--volume',
        `${directory}:/eval:ro`,
        this.options.image,
        'analyze',
        '--explain',
        '--backend',
        'azureopenai',
        '--config',
        '/eval/k8sgpt.json',
        '--kubeconfig',
        '/eval/kubeconfig.json',
        '--namespace',
        namespace,
        '--filter',
        filters.join(','),
        '--output',
        'json',
        '--no-cache',
      ]);
      const succeeded = result.status === 0 && hasSuccessfulExplanation(result.stdout);
      return {
        raw_text: [result.stdout, result.stderr].filter(Boolean).join('\n'),
        submission_text: null,
        status: succeeded ? 'ok' : 'unavailable',
        duration_ns: (process.hrtime.bigint() - started).toString(),
        tool_events: [
          {
            tool_name: 'k8sgpt.analyze.explain',
            mutating: false,
            status: succeeded ? 'success' : 'error',
          },
        ],
      };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}

/** Creates the K8sGPT explanation candidate; bare analyzer mode is intentionally unavailable. */
export function createK8sGptCandidate(options: K8sGptCandidateOptions): CandidateAdapter {
  const adapter = new K8sGptAdapter(options);
  return {
    id: 'k8sgpt',
    kind: 'reference-system',
    unsupportedSubmissionReason:
      'K8sGPT explain output has no lossless mapping to the evidence-linked diagnosis contract.',
    identity: {
      candidate_id: 'k8sgpt',
      kind: 'reference-system',
      configuration_digest: sha256OfJson({
        image: options.image,
        backend: 'azureopenai',
        model: options.model,
        deployment: options.deployment,
        api_base: options.apiBase,
        api_version: options.apiVersion,
        mode: 'explain',
      }),
    },
    async invoke(input: CandidateInvocationInput): Promise<CandidateInvocationResult> {
      if (input.packet.required_submission_schema !== 'diagnosis_submission@1.0.0') {
        return {
          raw_text: 'K8sGPT repair execution is unsupported.',
          submission_text: null,
          status: 'unavailable',
          duration_ns: '0',
          tool_events: [],
        };
      }
      return adapter.runCandidate(input, options);
    },
  };
}
