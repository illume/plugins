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
 * A minimal, dependency-free structural validator.
 *
 * The bundle contract requires every JSON/JSONL object to declare
 * `schema_uri`/`schema_version` and be validated before it is written or
 * trusted. This module implements just enough of JSON Schema (`type`,
 * `required`, `properties`, `items`, `enum`, `additionalProperties`) to
 * validate the Phase 1 contracts in `evals/schema/*.schema.json` without
 * pulling in a full schema-validation dependency. It is intentionally not a
 * general-purpose JSON Schema implementation.
 */

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// Deliberately loose: this module accepts arbitrary pre-parsed JSON schema
// documents (see evals/schema/*.schema.json) and only relies on the handful
// of keywords implemented below.
export type JsonSchema = Record<string, unknown>;

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function validateNode(
  schema: JsonSchema,
  value: unknown,
  path: string,
  errors: ValidationError[]
): void {
  const type = schema.type as string | string[] | undefined;
  if (type) {
    const types = Array.isArray(type) ? type : [type];
    const actual = typeOf(value);
    const numberOk = types.includes('number') && actual === 'number';
    if (!types.includes(actual) && !numberOk) {
      errors.push({ path, message: `expected type ${types.join('|')}, got ${actual}` });
      return;
    }
  }

  const enumValues = schema.enum as unknown[] | undefined;
  if (enumValues && !enumValues.includes(value)) {
    errors.push({ path, message: `value not in enum [${enumValues.join(', ')}]` });
  }

  if (typeOf(value) === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    const required = (schema.required as string[] | undefined) ?? [];
    for (const key of required) {
      if (!(key in obj)) {
        errors.push({ path: `${path}.${key}`, message: 'missing required property' });
      }
    }
    const properties = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) {
          errors.push({ path: `${path}.${key}`, message: 'unexpected additional property' });
        }
      }
    }
    for (const [key, subSchema] of Object.entries(properties)) {
      if (key in obj) {
        validateNode(subSchema, obj[key], `${path}.${key}`, errors);
      }
    }
  }

  if (typeOf(value) === 'array') {
    const itemSchema = schema.items as JsonSchema | undefined;
    if (itemSchema) {
      (value as unknown[]).forEach((item, index) => {
        validateNode(itemSchema, item, `${path}[${index}]`, errors);
      });
    }
  }
}

/** Validates `value` against `schema`, returning every violation found. */
export function validate(schema: JsonSchema, value: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  validateNode(schema, value, '$', errors);
  return { valid: errors.length === 0, errors };
}

/** Throws a descriptive error if `value` does not satisfy `schema`. */
export function assertValid(schema: JsonSchema, value: unknown, context: string): void {
  const result = validate(schema, value);
  if (!result.valid) {
    const details = result.errors.map(e => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`${context} failed schema validation: ${details}`);
  }
}
