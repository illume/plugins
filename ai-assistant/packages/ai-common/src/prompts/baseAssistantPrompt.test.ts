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

import { describe, expect, it } from 'vitest';
import { basePrompt } from './baseAssistantPrompt';

describe('ai/prompts', () => {
  it('basePrompt is a non-empty string', () => {
    expect(typeof basePrompt).toBe('string');
    expect(basePrompt.length).toBeGreaterThan(0);
  });

  it('basePrompt includes Kubernetes capabilities section', () => {
    expect(basePrompt).toContain('Kubernetes');
    expect(basePrompt).toContain('never assume "default"');
  });

  it('basePrompt includes MCP tool usage guidance', () => {
    expect(basePrompt).toContain('MCP');
  });

  it('basePrompt includes link formatting instructions from promptLinks', () => {
    expect(basePrompt).toContain('http');
  });

  it('basePrompt requires complete relational and temporal evidence', () => {
    expect(basePrompt).toContain(
      'verify compatible resource identities, revisions, and time windows'
    );
    expect(basePrompt).toContain('each side of a relationship');
  });

  it('basePrompt keeps uncertain hypotheses distinct and mechanism-focused', () => {
    expect(basePrompt).toContain('materially distinct Kubernetes mechanisms');
    expect(basePrompt).toContain('typically 4-6');
    expect(basePrompt).toContain('independently testable');
    expect(basePrompt).toContain('precise resource, blocking condition or relationship');
    expect(basePrompt).toContain('speculative, redundant, or contradicted alternatives');
  });

  it('basePrompt prefers canonical Kubernetes API language', () => {
    expect(basePrompt).toContain('canonical Kubernetes API language');
    expect(basePrompt).toContain(
      'exact Kind, object, field, condition, controller, and relationship'
    );
    expect(basePrompt).toContain('PersistentVolumeClaim');
    expect(basePrompt).toContain('spec.nodeSelector');
    expect(basePrompt).toContain('Preserve exact resource names and observed values');
  });

  it('basePrompt requires an evidence-bounded investigation loop', () => {
    expect(basePrompt).toContain('one evidence-backed cause remains');
    expect(basePrompt).toContain('ownership and dependencies');
    expect(basePrompt).toContain('adjacent controller or external dependency');
    expect(basePrompt).toContain('never invent evidence to complete the sequence');
  });

  it('basePrompt asks for concise non-repetitive diagnoses', () => {
    expect(basePrompt).toContain('state each decisive fact once');
    expect(basePrompt).toContain('unnecessary preambles');
  });
});
