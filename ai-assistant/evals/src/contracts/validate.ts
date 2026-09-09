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

import { Ajv, type ErrorObject } from 'ajv';

/** One JSON Schema contract violation found during validation. */
export interface ValidationError {
  /** JSON-style path to the invalid value. */
  path: string;
  /** Human-readable description of the violated constraint. */
  message: string;
}

/** Aggregate result of validating one value against a schema. */
export interface ValidationResult {
  /** Whether the value satisfies the complete JSON Schema contract. */
  valid: boolean;
  /** All structural violations found in the value. */
  errors: ValidationError[];
}

/** A pre-parsed JSON Schema document. */
export type JsonSchema = Record<string, unknown>;

const ajv = new Ajv({ allErrors: true, strict: false, addUsedSchema: false });

function errorPath(error: ErrorObject): string {
  const segments = error.instancePath
    .split('/')
    .slice(1)
    .map(segment => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (error.keyword === 'required') segments.push(String(error.params.missingProperty));
  return segments.reduce(
    (result, segment) => (/^\d+$/.test(segment) ? `${result}[${segment}]` : `${result}.${segment}`),
    '$'
  );
}

/** Validates a value against a complete JSON Schema document. */
export function validate(schema: JsonSchema, value: unknown): ValidationResult {
  const validateValue = ajv.compile(schema);
  if (validateValue(value)) return { valid: true, errors: [] };
  const errors = (validateValue.errors ?? []).map((error: ErrorObject) => ({
    path: errorPath(error),
    message: `${error.keyword}: ${error.message ?? 'constraint violated'}`,
  }));
  return { valid: false, errors };
}

/** Throws a descriptive error when a value does not satisfy a schema. */
export function assertValid(schema: JsonSchema, value: unknown, context: string): void {
  const result = validate(schema, value);
  if (!result.valid) {
    const details = result.errors.map(error => `${error.path}: ${error.message}`).join('; ');
    throw new Error(`${context} failed schema validation: ${details}`);
  }
}
