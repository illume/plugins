# Synthesis Transport Diagnostic

Date: 2026-09-17. Related work: https://github.com/illume/plugins/pull/25.

## Results

All four predeclared diagnostic sessions completed their recorded disposition.
One timed out; the new instrumentation preserved its partial usage, cancellation,
and HTTP-stage evidence. No old assignment was retried or regraded. These four
different configurations are not a balanced accuracy comparison.

| Assignment | Packet / configuration | Disposition | Required fact coverage | Session seconds |
| ---: | --- | --- | --- | ---: |
| 1 | Capacity / baseline | Valid selection, causal contract failed | 2/4 | 9.051 |
| 2 | NSG / guidance only | Deadline; no submission | Not scored | 120.038 |
| 3 | Healthy capacity / grouping only | Abstained instead of declaring supplied health | Not applicable | 9.617 |
| 4 | Shadowed deny / grouping only | Correct healthy disposition | Not applicable | 6.750 |

The three valid submissions passed the no-action check. Capacity selected twelve
facts, including the unrelated system pool's disabled autoscaling flag and generic
Pod metadata; it omitted the target pool name and current count. Valid references
and JSON still do not establish a correct causal selection. Healthy capacity
returned no cause facts with uncertainty true; the complete supplied healthy
control expected uncertainty false. The shadowed-deny control returned no cause
facts with uncertainty false, as expected.

No default changed. Read grouping and no extra guidance remain the defaults,
alongside strict numeric selection for Azure/OpenAI observability eval candidates.
The 100 researched scenario candidates were not executed in this diagnostic.

## What The Timeout Revealed

The guided NSG session completed planning in about 3.96 seconds and retrieved both
Kubernetes and Azure evidence (882 observations). Its synthesis invocation then
waited about 116 seconds until the 120-second outer deadline.

The fetch trace recorded one planning attempt with HTTP 200 and one synthesis
attempt with **no response headers received before cancellation**. It then recorded
the abort request and fetch cancellation. There was no observed HTTP 429, retry
delay, or additional fetch attempt for that synthesis invocation. This particular
timeout was therefore before response parsing, not an observed JSON-validation
failure or observed HTTP retry loop.

This does **not** distinguish network delay, intermediary behavior, server queueing,
or long inference. It does not rule out server-internal throttling or retries below
the fetch boundary, and it cannot explain the six earlier uninstrumented timeouts.
Do not attribute the failure to guidance or a model capability defect from one
unmatched example.

The cancelled terminal record contains the completed planning usage: 3,750 input
tokens and 130 output tokens, labelled `partial`. Synthesis usage remains unknown.
This is an improvement over losing the entire record, not recovery of all billable
work. The child exited with the expected deadline code; it was not killed by the
135-second process watchdog. The other three children exited normally, and no
resource provisioning or background evaluator process remains.

## Method

- Same Azure `gpt-4o` deployment, version `2024-11-20`, using the actual assistant
  session at commit `fd53477acc67c4e4404d9d62e2b400f48d86618f`.
- Four assignments declared before collection: baseline capacity, guided NSG,
  grouped healthy capacity, and grouped shadowed deny. Each uses a fresh session
  and a separate child process; no repeat-until-pass or replacement attempts.
- Retained raw-read packets and explicit synthetic controls from the prior
  [grouping/guidance experiment](observability-object-guidance-results.md).
  Same task construction, selection schema, model, and options for each selected
  configuration. Healthy and shadowed-deny packets remain synthetic controls,
  not fresh live AKS incidents.
- Strict numeric selection throughout; 12-fact public limit, eight-read budget,
  120-second session deadline. Default provider retry policy unchanged. The parent
  has a 135-second child watchdog and stops if that watchdog fails.
- Sanitized fetch-level metadata records attempt number, logical invocation ID,
  phase, timing, response status, and numeric retry delay when present. The tracer
  returns the original Response without reading, modifying, or logging its body.
  It does not log request headers, credentials, prompts, or provider error text.
- Progress and terminal records are written atomically in private directories.
  Model keys are held in memory and supplied to child processes through stdin,
  not command-line arguments or published artifacts.

The trace observes fetch entry and response headers, not response-body completion
or provider billing. A 200 header by itself would not prove successful parsing;
the returned invocation and validated submission are separate signals. Session
durations include candidate preparation and reads, but not parent process startup
or Azure credential acquisition. Local trace writes can add measurement overhead.

There were **eight fetch attempts**: seven returned HTTP 200 headers and one was
cancelled before headers. No additional fetch attempts or retry-delay headers were
observed. Seven usage events report **38,042 input tokens and 667 output tokens**;
these are observed totals only, excluding unknown synthesis usage from the timeout.
No new accuracy, latency, cost, or reliability improvement is inferred from them.

## Provenance And Checks

Private run directory: `.tmp/pr25-synthesis-transport-20260917`.
The plan freezes assignments, budgets, source hashes, and input-case digest;
`sources.json` retains source snapshots. Each numbered assignment directory holds
progress, terminal record, sanitized HTTP trace, result, observations, and child
exit information. The private launcher is
`ai-assistant/evals/.local/diagnose-synthesis-transport.ts`.

| Artifact | SHA-256 |
| --- | --- |
| `plan.json` | `90dde342a15a4d9e1ae458af7c5710df6bfc1f0546c64cb4e7aaea1e2ad62800` |
| `summary.json` | `8e9175f559cb1ea04b59d4ede96b38c4b99a5276cf22095b61c008f383e7631c` |
| Timed-out NSG HTTP trace | `59c1cf0060cd8fffc59adf4cefec6f5b7c78e5358102127505528d068916e50a` |
| Timed-out NSG terminal record | `d81494e590c8533afb2fe29adb517a85c405bc058da7d2db0b43200803c5f99c` |

Before this run, invocation instrumentation passed 1,979 shared-runtime tests,
376 eval tests, lint, typechecks, production build, and six mocked disk-persistence
checks. The new tracer passed a credential-free check proving that it preserves
the Response/body and excludes private headers/body text from trace events.
Frozen source hashes and all four child dispositions were verified afterward.

## Next Step

Treat transport delivery and causal selection as separate work. Before another
larger model experiment, test an explicit final-output token ceiling and provider
request timeout inside the outer deadline, with offline request-body/abort checks
first. A ceiling would bound requested generation, not guarantee completion or
prove the cause of this delay; any paid comparison needs a new fixed plan.

For diagnosis, retain the wrong-pool and missing-identity failures as counterexamples
for a more compact source-bound claim/field layout. Do not increase tool calls to
retrieve facts already present, or auto-add the required facts to manufacture a
pass. Do not enable the unsuccessful grouping/guidance arms on this evidence.