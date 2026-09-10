# Reporting

Reporting builds human- and machine-readable views from closed bundle records. Reports summarize and group canonical evidence for convenience; they do not replace that evidence or rerun evaluation work.

Start with [`reportBuilder.ts`](reportBuilder.ts) for constructing report JSON, rendering Markdown, and recording current limitations and coverage.

A report retains the source bundle digest and must be regenerable without contacting a candidate or cluster. New presentation needs belong here rather than in the trial state machine.
