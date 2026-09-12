/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import {
  ContainerReferenceAdapter,
  type ContainerReferenceAdapterOptions,
} from './containerReferenceAdapter.js';

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
}
