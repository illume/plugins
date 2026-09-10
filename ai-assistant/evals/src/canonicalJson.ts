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
 * Canonical JSON serialization and content digests.
 *
 * The stable bundle contract requires deterministic, canonicalized JSON
 * before hashing so that two producers of the same logical content emit the
 * same digest. This is a minimal RFC 8785-compatible profile: object keys are
 * sorted, there is no insignificant whitespace, and numbers are emitted via
 * `JSON.stringify`'s default number formatting (values that could lose
 * precision, such as nanosecond durations or resource versions, must already
 * be represented as strings by the caller — this module does not silently
 * coerce them).
 */

import { createHash } from 'node:crypto';

/** A value that can be represented in canonical JSON. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * Recursively sorts object keys so serialization is deterministic.
 *
 * @param value - JSON value to normalize.
 * @returns The value with every object's keys sorted.
 */
function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys((value as Record<string, JsonValue>)[key] as JsonValue);
    }
    return sorted;
  }
  return value;
}

/**
 * Serializes a value as canonical sorted-key, compact JSON text.
 *
 * @param value - JSON value to serialize.
 * @returns Canonical JSON text for the value.
 */
export function canonicalStringify(value: JsonValue): string {
  return JSON.stringify(sortKeys(value));
}

/**
 * Computes the lowercase hexadecimal SHA-256 digest of a canonical JSON value.
 *
 * @param value - JSON value to hash canonically.
 * @returns The SHA-256 digest as lowercase hexadecimal text.
 */
export function sha256OfJson(value: JsonValue): string {
  return sha256OfText(canonicalStringify(value));
}

/**
 * Computes the lowercase hexadecimal SHA-256 digest of arbitrary text.
 *
 * @param text - UTF-8 text to hash.
 * @returns The SHA-256 digest as lowercase hexadecimal text.
 */
export function sha256OfText(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
