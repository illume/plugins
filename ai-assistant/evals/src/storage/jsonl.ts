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
 * An append-only JSONL writer with the common record envelope described in
 * "Result bundle and report evolution contract": `record_id`, `schema_uri`,
 * `schema_version`, `sequence`, `recorded_at`, `producer`, `payload`,
 * `payload_digest`, and `previous_record_digest`. Each stream hash-chains its
 * records, which is tamper evidence and ordering support (not a substitute
 * for the Phase 4 signing this repository has not implemented).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  canonicalStringify,
  sha256OfJson,
  sha256OfText,
  type JsonValue,
} from '../canonicalJson.js';
import { recordId as generateRecordId } from '../ids.js';
import { loadSchema, type SchemaName } from '../contracts/schemas.js';
import { assertValid } from '../contracts/validate.js';

export interface JsonlRecord<T extends JsonValue> {
  record_id: string;
  schema_uri: string;
  schema_version: string;
  sequence: number;
  recorded_at: string;
  producer: string;
  payload: T;
  payload_digest: string;
  previous_record_digest: string | null;
}

export class JsonlWriter<T extends JsonValue> {
  private sequence = 0;
  private previousDigest: string | null = null;

  constructor(
    private readonly filePath: string,
    private readonly schemaUri: string,
    private readonly schemaVersion: string,
    private readonly producer: string
  ) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) writeFileSync(filePath, '', 'utf8');
  }

  /** Appends one validated, hash-chained record and returns it. */
  append(payload: T): JsonlRecord<T> {
    const localSchemaMatch = /\/([^/]+)\.schema\.json$/.exec(this.schemaUri);
    if (this.schemaUri.startsWith('https://headlamp-k8s.local/') && localSchemaMatch?.[1]) {
      const schemaName = localSchemaMatch[1] as SchemaName;
      assertValid(loadSchema(schemaName), payload, `${schemaName} payload`);
    }
    this.sequence += 1;
    const payloadDigest = sha256OfJson(payload);
    const record: JsonlRecord<T> = {
      record_id: generateRecordId(),
      schema_uri: this.schemaUri,
      schema_version: this.schemaVersion,
      sequence: this.sequence,
      recorded_at: new Date().toISOString(),
      producer: this.producer,
      payload,
      payload_digest: payloadDigest,
      previous_record_digest: this.previousDigest,
    };
    appendFileSync(
      this.filePath,
      canonicalStringify(record as unknown as JsonValue) + '\n',
      'utf8'
    );
    this.previousDigest = payloadDigest;
    return record;
  }

  get recordCount(): number {
    return this.sequence;
  }
}

/** Reads every JSONL record from a closed stream, in original order. */
export function readJsonl<T extends JsonValue>(filePath: string): JsonlRecord<T>[] {
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, 'utf8');
  return text
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as JsonlRecord<T>);
}

/** Reads only the `payload` field of every record in a closed JSONL stream. */
export function readJsonlPayloads<T extends JsonValue>(filePath: string): T[] {
  return readJsonl<T>(filePath).map(r => r.payload);
}

/** SHA-256 over the full stream file's bytes, used for the bundle manifest. */
export function digestOfFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const text = readFileSync(filePath, 'utf8');
  return sha256OfText(text);
}
