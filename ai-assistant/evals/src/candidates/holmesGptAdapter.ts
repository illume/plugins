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

/** Digest-pinned HolmesGPT qualification adapter. */
export class HolmesGptAdapter extends ContainerReferenceAdapter {
  readonly system = 'holmesgpt' as const;

  constructor(options: ContainerReferenceAdapterOptions) {
    super(options);
  }

  protected healthCommand(): string[] {
    return ['ask', '--help'];
  }
}
