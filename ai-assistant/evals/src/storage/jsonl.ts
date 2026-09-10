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

/** Hash-chained envelope for one validated JSONL payload. */
export interface JsonlRecord<T extends JsonValue> {
  /** Stable identifier of the envelope record. */
  record_id: string;
  /** Schema URI used to validate the payload. */
  schema_uri: string;
  /** Version of the payload schema. */
  schema_version: string;
  /** One-based position of the record in its stream. */
  sequence: number;
  /** ISO timestamp when the record was appended. */
  recorded_at: string;
  /** Component that produced the record. */
  producer: string;
  /** Validated domain payload carried by the record. */
  payload: T;
  /** SHA-256 digest of the canonical payload. */
  payload_digest: string;
  /** Payload digest of the preceding record in the stream. */
  previous_record_digest: string | null;
}

/** Single-owner writer for a new, validated, hash-chained JSONL stream. */
export class JsonlWriter<T extends JsonValue> {
  private sequence = 0;
  private previousDigest: string | null = null;

  /**
   * Creates the parent directory and an empty stream file when absent. This
   * instance starts sequence numbering and hash state at zero; it must not be
   * used to resume a non-empty stream and is not safe for concurrent writers.
   *
   * @param filePath - Path of the JSONL stream file.
   * @param schemaUri - Schema URI recorded on each envelope.
   * @param schemaVersion - Schema version recorded on each envelope.
   * @param producer - Component name recorded as the producer.
   */
  constructor(
    private readonly filePath: string,
    private readonly schemaUri: string,
    private readonly schemaVersion: string,
    private readonly producer: string
  ) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    if (!existsSync(filePath)) writeFileSync(filePath, '', 'utf8');
  }

  /**
   * Appends one record to the stream. Payloads using the local Headlamp schema
   * URI convention are validated before any sequence or file state changes;
   * external schema URIs are recorded but are not resolved over the network.
   *
   * @param payload - JSON payload to validate and append.
   * @returns The complete appended record envelope, including its one-based sequence.
   * @throws When a locally registered payload does not satisfy its schema.
   */
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

  /**
   * Reports the number of records appended by this writer instance.
   *
   * @returns The current record count.
   */
  get recordCount(): number {
    return this.sequence;
  }
}

/**
 * Reads every JSONL record from a closed stream in original order.
 *
 * @param filePath - JSONL stream file to read.
 * @returns Parsed record envelopes, or an empty array when the file is absent.
 */
export function readJsonl<T extends JsonValue>(filePath: string): JsonlRecord<T>[] {
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, 'utf8');
  return text
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as JsonlRecord<T>);
}

/**
 * Reads only the payload of every record in a closed JSONL stream.
 *
 * @param filePath - JSONL stream file to read.
 * @returns Parsed payloads in stream order.
 */
export function readJsonlPayloads<T extends JsonValue>(filePath: string): T[] {
  return readJsonl<T>(filePath).map(r => r.payload);
}

/**
 * Computes SHA-256 over a complete stream file for the bundle manifest.
 *
 * @param filePath - Stream file whose UTF-8 content is hashed.
 * @returns The hexadecimal digest, or `null` when the file is absent.
 */
export function digestOfFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const text = readFileSync(filePath, 'utf8');
  return sha256OfText(text);
}
