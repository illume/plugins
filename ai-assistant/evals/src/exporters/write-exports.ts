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

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { canonicalStringify, sha256OfJson, type JsonValue } from '../canonical-json.js';
import { exportId as generateExportId } from '../ids.js';
import type { TrialResult } from '../contracts/types.js';
import { projectToLangSmith } from './langsmith.js';
import { projectToOtlp } from './otlp.js';

/**
 * Writes both offline golden exporter projections for a run under
 * `runs/<run_id>/projections/exports/<export_id>/`, each with its own
 * `projection-manifest.json` and an `export-receipts.jsonl` recording
 * emitted/rejected counts and declared field loss. Never contacts a hosted
 * destination; a destination outage can therefore never change the
 * canonical run result.
 */
export function writeExportProjections(
  runDir: string,
  bundleDigest: string,
  trials: TrialResult[]
): { langsmithDir: string; otlpDir: string } {
  const langsmith = projectToLangSmith(trials);
  const otlp = projectToOtlp(trials);

  const langsmithId = generateExportId();
  const langsmithDir = path.join(runDir, 'projections', 'exports', langsmithId);
  mkdirSync(langsmithDir, { recursive: true });
  writeFileSync(
    path.join(langsmithDir, 'langsmith-projection.json'),
    canonicalStringify(langsmith as unknown as JsonValue),
    'utf8'
  );
  writeFileSync(
    path.join(langsmithDir, 'projection-manifest.json'),
    canonicalStringify({
      export_id: langsmithId,
      destination: 'langsmith-native',
      mapping_version: langsmith.mapping_version,
      source_bundle_digest: bundleDigest,
      emitted_count: langsmith.runs.length,
      rejected_count: 0,
      unsupported_fields: langsmith.unsupported_fields,
      dropped_fields: langsmith.dropped_fields,
      offline: true,
    } as unknown as JsonValue),
    'utf8'
  );
  writeFileSync(
    path.join(langsmithDir, 'export-receipts.jsonl'),
    langsmith.runs
      .map(r =>
        canonicalStringify({
          receipt_id: sha256OfJson(r as unknown as JsonValue),
          run_id: r.id,
          destination: 'langsmith-native',
          accepted: true,
        } as unknown as JsonValue)
      )
      .join('\n') + '\n',
    'utf8'
  );

  const otlpId = generateExportId();
  const otlpDir = path.join(runDir, 'projections', 'exports', otlpId);
  mkdirSync(otlpDir, { recursive: true });
  writeFileSync(
    path.join(otlpDir, 'otlp-projection.json'),
    canonicalStringify(otlp as unknown as JsonValue),
    'utf8'
  );
  writeFileSync(
    path.join(otlpDir, 'projection-manifest.json'),
    canonicalStringify({
      export_id: otlpId,
      destination: 'otlp-genai',
      mapping_version: otlp.mapping_version,
      semconv_version: otlp.semconv_version,
      source_bundle_digest: bundleDigest,
      emitted_count: otlp.resource_spans[0]?.spans.length ?? 0,
      rejected_count: 0,
      unsupported_fields: otlp.unsupported_fields,
      dropped_fields: otlp.dropped_fields,
      offline: true,
    } as unknown as JsonValue),
    'utf8'
  );
  writeFileSync(
    path.join(otlpDir, 'export-receipts.jsonl'),
    (otlp.resource_spans[0]?.spans ?? [])
      .map(s =>
        canonicalStringify({
          receipt_id: sha256OfJson(s as unknown as JsonValue),
          span_id: s.span_id,
          destination: 'otlp-genai',
          accepted: true,
        } as unknown as JsonValue)
      )
      .join('\n') + '\n',
    'utf8'
  );

  return { langsmithDir, otlpDir };
}
