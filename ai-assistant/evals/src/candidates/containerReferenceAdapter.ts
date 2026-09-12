/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import { canonicalStringify, type JsonValue } from '../canonicalJson.js';
import { createRealCommandRunner, type CommandRunner } from '../cluster/commandRunner.js';
import type { CandidateInvocationInput, CandidateInvocationResult } from './candidateAdapter.js';
import type {
  ReferenceAdapterQualificationTarget,
  ReferenceSystemId,
} from './referenceQualification.js';

export interface ContainerReferenceAdapterOptions {
  image: string;
  kubeconfigPath: string;
  runner?: CommandRunner;
}

export abstract class ContainerReferenceAdapter implements ReferenceAdapterQualificationTarget {
  abstract readonly system: ReferenceSystemId;
  protected readonly runner: CommandRunner;

  constructor(protected readonly options: ContainerReferenceAdapterOptions) {
    if (!/@sha256:[a-f0-9]{64}$/.test(options.image)) {
      throw new Error('reference adapter image must be pinned by sha256 digest');
    }
    this.runner = options.runner ?? createRealCommandRunner();
  }

  async startup(): Promise<void> {
    const result = this.runner('docker', ['image', 'inspect', this.options.image]);
    if (result.status !== 0) {
      throw new Error(`pinned image unavailable: ${result.stderr || result.stdout}`);
    }
  }

  async health(): Promise<boolean> {
    const result = this.runner('docker', this.dockerRunArgs(this.healthCommand()));
    return result.status === 0;
  }

  async invokeFixedSubmission(
    _input: CandidateInvocationInput,
    fixedSubmission: string
  ): Promise<CandidateInvocationResult> {
    const started = process.hrtime.bigint();
    const parsed = JSON.parse(fixedSubmission) as JsonValue;
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new Error('fixed submission must be a JSON object');
    }
    return {
      raw_text: '',
      submission_text: canonicalStringify(parsed),
      status: 'ok',
      duration_ns: (process.hrtime.bigint() - started).toString(),
      tool_events: [],
    };
  }

  async cleanup(): Promise<void> {
    // Qualification uses one-shot --rm containers, so no persistent runtime remains.
  }

  protected dockerRunArgs(command: string[]): string[] {
    return [
      'run',
      '--rm',
      '--network=none',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=16m',
      '--volume',
      `${this.options.kubeconfigPath}:/root/.kube/config:ro`,
      this.options.image,
      ...command,
    ];
  }

  protected abstract healthCommand(): string[];
}
