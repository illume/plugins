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

import { describe, expect, it, vi } from 'vitest';
import { detectKubectlContext, query } from './chat.js';

describe('chat', () => {
  it('exports a query function', () => {
    expect(typeof query).toBe('function');
  });

  it('reads the active cluster and namespace from structured kubeconfig output', () => {
    const run = vi.fn().mockReturnValue(
      JSON.stringify({
        contexts: [{ context: { cluster: 'trial', namespace: 'eval-selector-fault' } }],
      })
    );
    expect(detectKubectlContext(run)).toEqual({
      cluster: 'trial',
      namespace: 'eval-selector-fault',
    });
    expect(run).toHaveBeenCalledWith('kubectl', ['config', 'view', '--minify', '-o', 'json'], {
      encoding: 'utf8',
    });
  });

  it('uses the Kubernetes default namespace only when the context omits one', () => {
    const run = vi
      .fn()
      .mockReturnValue(JSON.stringify({ contexts: [{ context: { cluster: 'local' } }] }));
    expect(detectKubectlContext(run)).toEqual({ cluster: 'local', namespace: 'default' });
  });

  it('returns undefined when kubectl context detection fails', () => {
    const run = vi.fn().mockImplementation(() => {
      throw new Error('kubectl unavailable');
    });
    expect(detectKubectlContext(run)).toBeUndefined();
  });
});
