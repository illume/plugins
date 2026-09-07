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

/**
 * Loads versioned JSON Schema documents from the archived local
 * `evals/schema/` registry. Schema URIs must resolve without network access;
 * a mutable web URL is never schema identity here — the `$id` value is a
 * stable label only, and resolution always goes through this local file map.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { JsonSchema } from './validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.resolve(here, '..', '..', 'schema');

const cache = new Map<string, JsonSchema>();

export type SchemaName =
  | 'scenario'
  | 'candidate-packet'
  | 'evaluator-packet'
  | 'diagnosis-submission'
  | 'bundle-manifest'
  | 'trial-index'
  | 'trajectory-event'
  | 'trial-result'
  | 'artifact-index'
  | 'regression-delta'
  | 'environment-manifest'
  | 'grader-result'
  | 'report';

/** Loads (and caches) the named schema from the local `evals/schema/` registry. */
export function loadSchema(name: SchemaName): JsonSchema {
  const cached = cache.get(name);
  if (cached) return cached;
  const filePath = path.join(schemaDir, `${name}.schema.json`);
  const schema = JSON.parse(readFileSync(filePath, 'utf8')) as JsonSchema;
  cache.set(name, schema);
  return schema;
}

/** Returns the archived local schema URI used as `schema_uri` in bundle records. */
export function schemaUri(name: SchemaName): string {
  return `https://headlamp-k8s.local/evals/schema/${name}.schema.json`;
}
