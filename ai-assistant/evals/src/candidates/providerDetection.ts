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

/** Provider record returned by the product CLI's auto-detection command. */
export interface DetectedProvider {
  providerId: string;
  config: Record<string, unknown>;
}

/**
 * Parses the final JSON array emitted by provider auto-detection. The product
 * CLI currently writes human-readable diagnostics before its `--json` payload,
 * so parsing the complete stdout as JSON would reject an otherwise valid
 * detection result.
 */
export function parseProviderDetectionOutput(output: string): DetectedProvider[] {
  const candidateStarts = [0];
  for (let index = output.indexOf('\n['); index >= 0; index = output.indexOf('\n[', index + 2)) {
    candidateStarts.push(index + 1);
  }
  for (const start of candidateStarts.reverse()) {
    try {
      const value = JSON.parse(output.slice(start).trim()) as unknown;
      if (
        Array.isArray(value) &&
        value.every(
          item =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as Record<string, unknown>).providerId === 'string' &&
            typeof (item as Record<string, unknown>).config === 'object' &&
            (item as Record<string, unknown>).config !== null &&
            !Array.isArray((item as Record<string, unknown>).config)
        )
      ) {
        return value as DetectedProvider[];
      }
    } catch {
      // Try an earlier array-looking line; diagnostics may also begin with `[`.
    }
  }
  throw new Error('provider auto-detection did not emit a valid JSON array');
}
