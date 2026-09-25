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

export const SCENARIOS_GOAL = {
  name: 'Scenarios Goal',
  statement:
    'Full coverage of product-scoped canonical diagnosis capabilities, plus risk-weighted coverage of policy, runtime, host, and platform-specific tails.',
  generation_policy:
    'Versioned agents generate canonicalization, risk scoring, scenarios, fixtures, oracles, qualification evidence, and post-freeze challenge batches; deterministic validators reject incomplete or inconsistent outputs.',
  rule_use_policy:
    'Surveyed tools and their rule catalogs are provenance inputs only; scenarios create Kubernetes faults and validate normalized predicates from native evidence without installing or executing those tools.',
  product_scope:
    'A capability is product-scoped only when Headlamp can obtain its required evidence and present or safely orchestrate its outcome on a declared supported profile.',
  canonical_capability:
    'An agent-reviewed cross-tool equivalence class with the same subject, trigger predicate, required evidence, expected finding, negative condition, and material platform constraints.',
  core_completion:
    'Every approved product-scoped canonical capability has qualified positive and healthy-negative scenarios, plus uncertainty, temporal, or confounder cases when those are part of the predicate.',
  tail_completion:
    'Cover every critical tail capability and at least 80 percent of source-grounded, multi-agent-reviewed risk weight within each of policy, runtime, host, and platform-specific domains.',
  accounting:
    'Report targeted, implemented, and qualified coverage separately; tool-local occurrences and semantic groups are provenance and progress measures, not the completion denominator.',
} as const;
