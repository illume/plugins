# Storage

Storage writes and reads immutable evaluation bundles. Append-only, hash-chained JSONL preserves event order and detects modification, while a manifest written last distinguishes a complete bundle from an interrupted run.

Start with:

- [`bundleWriter.ts`](bundleWriter.ts) for run and trial directory layout, streams, artifacts, and final manifest creation.
- [`bundleReader.ts`](bundleReader.ts) for opening and validating closed bundles.
- [`jsonl.ts`](jsonl.ts) for hash-chained record envelopes.
- [`contractReferences.ts`](contractReferences.ts) for archiving the exact schemas and evaluation inputs used by a run.

Only closed bundles are valid sources for reports or publication. Hash chains provide tamper evidence and deterministic ordering, not cryptographic identity or signing.
