# Observability Reliability Research

Updated: 2026-09-17. Work tracked in [PR #25](https://github.com/illume/plugins/pull/25).

This is the maintained research, phase plan, results ledger, and backlog for
observability-assisted diagnosis. It consolidates the earlier private research
notes and subsequent experiments. Detailed attempt reports remain in
[the eval documentation](../evals/docs/); their scores and artifacts are historical.
The observability phases below are separate from the locked
[evaluation framework phases](../evals/docs/implementation-phases.md).

## Current Defaults

Promote demonstrated benefits instead of leaving every successful experiment
behind a flag. As requested after the factorial replay, the observability
[candidate factory](../evals/src/candidates/headlampObservability.ts) now defaults
to compact evidence, numeric fact selection, and strict final JSON for Azure/OpenAI.
This is an operator-selected **development default**, not general accuracy or
live operational qualification. GPT-4o `2024-11-20` on Azure was the measured model;
other models must support strict JSON Schema or use an explicit override.

| Configuration | Evidence mode | Strict final output | References |
| --- | --- | --- | --- |
| Azure/OpenAI, options omitted | `compact-select` | On | Numeric |
| Other provider, options omitted | `compact` | Off | Numeric |
| Explicit `compact` or `full` | Requested mode | Off; explicit strict is rejected | Numeric unless overridden |
| Explicit `compact-select`, Azure/OpenAI | `compact-select` | On unless explicitly disabled | Numeric unless overridden |
| Explicit `compact-select`, other provider | `compact-select` | Off; explicit strict is rejected | Numeric unless overridden |

`strictFinalOutput: false` preserves a prompt-only comparison arm; it does not
change the evidence mode. `referenceStyle: 'field-labelled'` remains an explicit
experiment, not a default. Unsupported strict model calls fail visibly; there is
no silent unconstrained retry. Choose `evidenceMode: 'compact'` for models without
strict support to retain compact input and legacy diagnosis output.

Strict JSON applies only to post-tool synthesis. Planning remains tool-enabled;
if no tool is called, caller-side output validation is still necessary. Only
explicitly selected facts are resolved, never related or gold-required fields.
Citation existence, duplicates, fact budgets, causal correctness, and uncertainty
remain distinct concerns.

These defaults apply to the observability **eval adapter**, not normal browser
chat or CLI conversations. The reusable shared-session strict-response capability
exists, but moving benchmark JSON into ordinary chat is not a product rollout.
No paid inference or cloud provisioning becomes automatic. The
[scenario guide](../evals/src/scenarios/README.md#candidate-runs) covers invocation
and opt-outs; OBS-8 below defines consumer rollout gates.

## Completed Work And Results

| Work | Status | Observed result | Decision |
| --- | --- | --- | --- |
| Real local Prometheus/Grafana faults | Lifecycle verified | Scrape `up=1 -> 0 -> 1`; datasource working -> broken -> restored; cleanup passed. No model comparison. | Keep resource-backed fixtures; model trials remain pending. |
| Real AKS NSG/autoscaler incidents | Executed; qualification incomplete | NSG enabled partial, Kubernetes-only abstained. Capacity enabled failed grounding, Kubernetes-only failed. NSG recovery passed; capacity recovery failed; all cleanup passed. | Retain results; verify capacity recovery live. |
| Native effective-NSG API fix | Implemented and exercised live | Supported API version restored the production tool read. | Normal product behavior, not an experimental flag. |
| Compact evidence | Implemented, replayed, promoted | About 53% fewer synthesis input tokens and 32% lower mean latency; no accuracy gain in the first replay. | Keep compaction in the default path. |
| Exact reference resolution and selection controls | Implemented and tested | Unknown/duplicate references and echo-all/budget shortcuts rejected; only selected observations become citations. | Used with default selection; not causal proof. |
| Strict numeric final selection | Implemented, replayed, promoted | All 12 strict responses were valid JSON. Numeric enabled arm passed 2/4 versus prompt-only 1/4; capacity remained partial. | Azure/OpenAI eval default for format reliability; accuracy remains exploratory. |
| Field-labelled suffixes | Tested; not promoted | Both labelled arms had 0/4 enabled passes; every enabled selection was invalid. | Keep opt-in; numeric prompt example confounds the result. |
| Strict cancellation and buffered streaming | Implemented, offline tested | Abort signal, raw text/usage retention, refusal/incomplete-output rejection, and complete JSON delivery. | Used by strict mode; broader runtime work remains open. |

### Fresh Strict-Default Live Run: Completed

The [2026-09-17 live rerun report](../evals/docs/observability-aks-strict-results.md)
records an enabled NSG diagnosis pass on fresh infrastructure: all 6/6 required
facts, selection and no-action controls passed, 22.553 seconds. Connectivity
recovery also passed. Kubernetes-only failed diagnosis in 15.569 seconds: it
expressed uncertainty but still asserted unrelated facts as causes.

All four planned diagnoses are now complete. Autoscaler enabled failed in 23.830
seconds and Kubernetes-only failed in 14.116 seconds; both covered 0/4 required
facts. All four no-action and selection-control checks passed. Both scenarios
passed baseline, induced fault, recovery, and cleanup; all four owned resource
groups were independently verified absent. NSG therefore has a complete enabled
diagnosis/lifecycle pass, while autoscaler has a verified reproduction but no
diagnosis pass. The original results below remain unchanged. This is not an
isolated estimate of strict JSON versus compaction, selection, public fact budget,
or changed live observations, and does not qualify the broader comparison roster.

### Live AKS Baseline

The [live report](../evals/docs/observability-aks-gpt4o-results.md) records four
scored GPT-4o sessions and eight model requests on genuinely induced faults.
The NSG diagnosis omitted inbound direction. Capacity used a wrong CPU JSON
Pointer and omitted pool identity. Its prose also blamed a small VM for a workload
that had fit during baseline: citation repair alone would not prove correct
reasoning. Two earlier NSG setup/tool failures were not model failures.

The concurrent-operation recovery retry was added and unit-tested after the
original capacity failure. The later live run completed automatic recovery; that
alone does not prove the concurrent-operation retry branch was exercised. Cleanup
success is not recovery success.
Datadog/Splunk eval cases were removed because corresponding real infrastructure
was not provisioned; their product integrations remain.

### Compact Replay

The [14-session report](../evals/docs/observability-compact-replay-results.md)
compares four enabled attempts per arm plus two selection-only Kubernetes controls.

| Enabled arm | Complete passes | Mean synthesis input tokens | Mean seconds |
| --- | ---: | ---: | ---: |
| Full observations, legacy output | 2/4 | 38,262.75 | 17.827 |
| Compact observations, legacy output | 1/4 | 18,150 | 12.136 |
| Compact observations, prompt-only selection | 1/4 | 17,631 | 11.559 |

Two enabled selection responses had an extra closing brace inside JSON; the
disabled capacity response duplicated a reference. A valid capacity answer
selected `minCount` while discussing `maxCount`. Efficiency improved, pass rates
did not. All 11 valid submissions passed no-action checks; invalids were unscored
for that dimension. Totals: 28 requests, 364,704 input and 10,503 output tokens.

### Strict Output Factorial

The [20-session report](../evals/docs/observability-selection-factorial-results.md)
records two incidents, four arms, two repetitions, and four strict Kubernetes-only
controls. Totals: 40 requests, 412,681 input and 7,024 output tokens.

| Enabled arm | Pass | Partial | Invalid JSON | Unknown references |
| --- | ---: | ---: | ---: | ---: |
| Prompt-only, numeric | 1/4 | 1/4 | 2/4 | 0/4 |
| Strict JSON, numeric | 2/4 | 2/4 | 0/4 | 0/4 |
| Prompt-only, labelled | 0/4 | 0/4 | 2/4 | 2/4 |
| Strict JSON, labelled | 0/4 | 0/4 | 0/4 | 4/4 |

Strict numeric covered all six required NSG facts in both repeats. Capacity
coverage was 2/4 then 1/4: one answer combined target-pool count/maximum with
`enableAutoScaling=false` from the other pool. Both valid Kubernetes-only controls
were incorrectly confident. Six of the twelve valid strict JSON responses still
had unknown references. All eight resolved submissions passed no-action checks;
the other twelve had no valid submission to safety-score.

Models frequently omitted the suffix from labelled IDs. The common prompt still
contained a numeric example; this encoding/prompt failed, not all meaningful ID
designs. No suffix completion, repair, retry, or regrading was used. The static
strict schema allows string references; it does not enumerate retrieved choices.

Both replays used retained leaf observations with `data=null` and fresh read IDs,
not original raw payloads or newly provisioned incidents. Repeats of two familiar
snapshots are not independent incident breadth. The second replay changed the
shared prompt/schema: do not pool scores or infer a direct strict-versus-compact-only
accuracy effect across experiments.

## Research Findings

### Object Grouping And Guidance Experiment

The [27-assignment comparison](../evals/docs/observability-object-guidance-results.md)
is complete: two live snapshots repeated twice per arm, plus five controls per
arm. Baseline and object grouping each passed 1/4 incident attempts; guidance
passed 0/4. Control passes were 1/5, 0/5, and 2/5 respectively. Six deadlines and
two duplicate-reference failures remain in the results. No failed assignment was
retried; continuations ran only previously untouched assignments.

Neither option is promoted. The current defaults remain strict numeric selection
with read grouping and no extra guidance. New options are `evidenceGrouping:
'object'` and `diagnosticGuidance: 'aks'`, independently selectable. Grouping
preserves all facts/IDs and does not automatically select related fields. Guidance
helped a healthy-capacity and NSG abstention control but did not fix capacity
diagnosis. Incremental telemetry and deadline handling are now the next priority:
six attempts lack complete response/usage records, so recorded usage is a lower
bound, not a complete cost estimate.

### Cancellation And Incremental Records

Subsequent implementation adds `recordProgress` snapshots and explicit terminal
status/error fields to the observability candidate. The final record is emitted
once, immediately on cancellation, rather than waiting for a stalled session's
`finally` block. Existing `record` callers receive cancellation records without
opting into progress; callers wanting checkpoints before cancellation can persist
`recordProgress` snapshots. Earlier snapshots are independent copies, late results
are ignored, and observed planning usage is retained when final synthesis stalls.

The shared nonstreaming direct-call path retains its abort controller through
planning and tool handling, checks cancellation after asynchronous preparation and
tool results, prevents later reads/synthesis, and avoids chain fallback on abort.
Ordinary post-tool synthesis now receives an abort signal, as strict synthesis
already did. Offline controls cover cancellation during approval initialization,
skill preparation, direct planning, tool reads, and strict/ordinary synthesis,
plus successful records and late results. Real Azure-client HTTP is mocked; no
paid rerun or new accuracy claim accompanies this change.

This is scoped progress on OBS-5, not end-to-end cancellation qualification for
every streaming, MCP orchestration, approval, or provider path. Tools already in
flight may be non-cancellable; local HTTP abort does not establish remote billing
termination. Usage not reported before cancellation remains unknown, and these
callbacks do not recover the six historical incomplete records. The original
27-assignment report and its hashes/scores remain unchanged. See the
[recording contract](../evals/src/scenarios/README.md#candidate-runs).

### Recording Integration: Offline Verification

The private replay launcher now uses the progress and terminal callbacks to write
separate JSON snapshots via same-directory atomic replacement. Six offline checks
exercise stalled planning, tool reads, and final synthesis in both strict-selection
and compact modes through the installed Azure client with mocked HTTP. Each check
reads a progress file before cancellation, observes a terminal cancellation file
before the stalled work is released, verifies 0600 file permissions, and confirms
that late completion changes neither the record nor the request count.

All six checks passed. Planning cancellation retained unknown usage as `null`;
tool/synthesis cancellation retained the already-observed planning usage as partial.
The reusable `summarizeObservabilityUsage` helper distinguishes observed events
from request counts, validates missing/zero counts, and retains input-token semantics.
The launcher no longer assumes its last usage event belongs to synthesis or sums
missing records as zero. Its future result format is versioned `2.0.0`, preserves
deadline classification when cancellation wins a promise race, and refuses to
resume a historical recording format. Live execution requires explicit
`--execute-paid`; the offline modes acquire no Azure credentials or live services.

Private check artifacts: `.tmp/pr25-recording-offline-final-20260917`, with six
progress files, six terminal records, six trial summaries, and `offline-check.json`.
The launcher command is `node --import tsx .local/replay-object-guidance.ts
--offline-recording-check` from the eval package, with `REPLAY_OUTPUT` set to a
new directory. These are deliberately stalled mock requests, not additional
diagnosis trials. All 375 offline eval tests, formatting, and typecheck pass.
No paid comparison, remote billing guarantee, historical score change, or broader
streaming/MCP cancellation qualification is implied. The next model experiment
must declare a new plan and retain these measurement limits.

### Invocation Phase Telemetry: Offline Verification

Direct planning and post-tool synthesis now emit sanitized `model_invocation`
start/terminal events with session-local IDs, phase, elapsed time, and a numeric
HTTP status when available from a thrown error. Cancellation is recorded before
a stalled invocation settles; a late result cannot overwrite that terminal event.
This resolves the ambiguity between a stalled planning request, a tool read, and
final synthesis in future recordings without guessing from the last usage event.

The actual Azure-client mocked boundary verifies successful planning then synthesis,
cancelled planning, stalled strict/ordinary synthesis, and a rejected synthesis
request. The rejection produces a failed synthesis event and no fallback model
request; the telemetry omits provider error text and credentials. A separate
shared-session check covers a thrown 429 without inferring SDK retry counts.
All 1,979 shared-runtime tests and 376 eval tests pass, including existing usage
metadata tests updated to filter their event type. Six disk-persistence checks
also passed in `.tmp/pr25-invocation-recording-offline-b-20260917`.

These are logical invocation records, not HTTP request-attempt accounting. A
returned invocation can still fail selection validation. No retry policy, prompt,
model, budget, or diagnosis default was changed. SDK backoff/remote billing and
uncovered streaming/MCP/fallback paths remain separate verification work. No new
paid eval ran, and the historical six timeouts remain unattributed; their missing
phase or usage data cannot be reconstructed from these new events.

### Four-Session Transport Diagnostic

The [instrumented diagnostic](../evals/docs/observability-synthesis-transport-results.md)
ran four predeclared fresh GPT-4o sessions on retained packets after committing the
instrumentation. Guided NSG timed out waiting for synthesis response headers; its
planning usage, phase, HTTP attempt, and cancellation were preserved. No 429 or
extra fetch attempt was observed for that request. The cause remains unresolved
between transport/intermediary/server/inference delays; this does not explain the
six historical timeouts or prove a guidance-specific regression.

Baseline capacity returned a valid but incomplete/irrelevant selection (2/4 required
facts). Grouped healthy capacity abstained; grouped shadowed-deny correctly declared
health. Three valid submissions passed no-action checks; the timeout was unscored.
Both existing diagnosis defaults and historical scores remain unchanged. Eight
fetch attempts and seven usage events were retained; reported token totals exclude
unknown usage for the timed-out synthesis. No Azure resources were provisioned.

The next offline limit checks are recorded below. Keep causal-selection work
separate from transport delivery; instrumentation improves measurement, not
diagnosis accuracy.

### Final-Synthesis Limits: Offline Verification

Added independent opt-in `finalResponseMaxOutputTokens` and
`finalResponseTimeoutMs` options for structured Azure/OpenAI eval responses.
Defaults remain unset, with both effective settings retained in candidate records.
The optional final model is constructed through the existing provider factory
with the same configuration and its own output ceiling; the planning model is
not mutated. Limits are validated before model requests. The shared session exposes
the same options; the token cap requires an Azure/OpenAI structured response and
the final timeout requires a structured response.

The local final-invocation deadline starts after planning/tools, aborts the request
signal, and settles even when a model promise ignores abort. It bounds the logical
synthesis call, not each HTTP retry independently; SDK retry policy is unchanged.
An earlier caller cancellation wins. Success, failure, and abort clear timers and
listeners, and late responses cannot become successful submissions. A token ceiling
does not repair truncated JSON; provider `length` termination still fails closed.

Verification is **offline only**: actual Azure/OpenAI client requests with mocked
HTTP show no planning cap and the requested final cap, including GPT-4o's
`max_tokens` and the installed SDK's o3 `max_completion_tokens` mapping. Tests
also cover token-only configuration, combined limits, timeout before outer abort,
early cancellation, timer cleanup, unsupported/invalid settings, and a truncated
response with no fallback request. All **1,987 shared tests and 383 eval tests**,
formatting, typechecks, and scoped lint passed. No new model/provider qualification
or improved diagnosis/delivery rate is claimed, and no paid calls were made.

Keep these limits opt-in until a new prospective experiment compares bounded and
unbounded requests with identical packets/prompts and retained failures. Requested
token limits depend on deployment capabilities and may include reasoning tokens;
local deadlines do not prove remote billing termination. The historical pre-header
timeout remains unexplained, not retroactively fixed. See the
[configuration and limitations](../evals/src/scenarios/README.md#candidate-runs).

### Representation And Identity

A model-free tokenizer probe reduced the observation component from 36,882 to
15,006 tokens for 593 NSG leaves, and 30,129 to 11,829 for 506 capacity leaves.
These 59%/61% reductions are not whole-request savings. Raw-plus-flattened
duplication was an eval-adapter property, not a demonstrated browser payload
problem. Neither capture contained managed fields, so removing those would not
explain the savings.

Compaction preserves supplied observation tuples, not types or empty containers
already lost by flattening. Current empty-container handling only helps when raw
data is available. Keep read/resource/time identity and raw digests; never resolve
an ID against a later response or guess a path from a matching value. Expanded
NSG address sets can affect matching and must not be discarded just to save tokens.

### Measurement Is Not Yet Causal

A model-free echo of every observation passed both original diagnosis and
no-action graders on both incidents. Supplementary selection controls now reject
echo-all, duplicates, unsupported citations, and over-budget submissions, but
neither those controls nor the legacy grader validate arbitrary explanatory prose.
See [selection controls](../evals/src/grading/observabilitySelection.ts) and the
unchanged [legacy grader](../evals/src/grading/diagnosisGrader.ts).

Prospective contracts should connect NSG traffic to applicable direction, protocol,
ports, attachment, and precedence, and connect a Pending workload to its eligible
pool, aggregate demand, and scaling constraint. A deny elsewhere or a capped
unrelated pool must fail; valid alternative causes must remain expressible. Never
feed an evaluator-only missing fact back as a candidate repair hint.

### Runtime Limits

Initial model-free probes inspected runtime behavior at `acd128a78`. One tool
batch was followed by forced unbound synthesis; the current strict path still
does not add adaptive investigation. Missing facts in the recorded incidents were
already retrieved, so more calls are not a proven fix.

The generic kubectl correction probe lacked task, answer, evidence, and usual usage
accounting. Strict mode now bypasses that rewriter; general correction remains
separate work. Strict synthesis now propagates cancellation, but this does not
establish end-to-end cancellation through planning, tools, and normal responses.
Historical probes found 101 items silently capped at 100 and oversized content
retained as only 100 characters plus a notice. Neither limit was shown to cause
the scored failures. Recheck the owning code before fixing these historical findings;
do not describe them as new cloud results.

## Ordered Phases

Use the current default as the prospective baseline. Pin options explicitly in
every experiment so later promotions cannot change a frozen comparison. Statuses
distinguish implementation, execution, and qualification.

### OBS-0: Resource-Backed Baseline

**Status: basic lifecycles verified; independent qualification incomplete.** Local
service lifecycles and the latest NSG/autoscaler baseline/fault/recovery/cleanup
passed. Model failures remain recorded above. Preserve the original failed
autoscaler recovery; a later successful attempt does not erase it.

### OBS-1: Compact Evidence And Exact Selection

**Status: implemented, evaluated, compaction promoted.** The 14-session experiment
and model-free controls are complete. Preserve provenance and per-read resolution.
Never expand one selected object into every required field.

### OBS-2: Strict Final JSON And Reference Encoding

**Status: implemented, evaluated; strict numeric promoted after operator request.**
The 20-session factorial is complete. Do not rerun it to improve scores. Retain
prompt-only/full/compact overrides and explicit labelled experiments. Default
tests cover the real Azure request boundary and provider/override rules.
The separate fresh live rerun has an NSG diagnosis/lifecycle pass and successful
autoscaler reproduction/recovery/cleanup, but failed autoscaler diagnoses.

### OBS-3: Causal And Abstention Controls

**Status: initial fact-selection/disposition controls implemented and tested.**
`observability_causal_selection@1.0.0` requires one complete source-bound causal
alternative, rejects irrelevant extras, and checks healthy versus clean abstention.
Model-free and model controls cover wrong-pool, minimum/maximum confusion,
shadowed-rule, healthy, and insufficient-evidence cases. The evaluator supplies
the contract; this does not compute domain causal truth or grade arbitrary prose.
Full cause-to-symptom, retrieval-sufficiency, and lifecycle qualification remain.

**Exit:** known-bad echoes, wrong-resource joins, and confident unsupported causes
fail; supported diagnoses and appropriate abstention pass. Test graders without
model calls first. Freeze contracts before new scored runs; historical grades stay.

### OBS-4: Preserve Object Identity, Then Constrain Choices

**Status: first grouping and separate guidance comparison completed; not promoted.**
The 27-assignment report above found no diagnosis-pass improvement. The opt-in
per-pool/per-rule view preserves every fact and reference; regression tests cover
read identity and equal-valued fields. A more compact field layout remains a
different prospective experiment, not a reinterpretation of these results.

Then, in a separate ablation, enumerate only retrieved references in the final
schema. Handle empty evidence and provider schema-size limits explicitly. An enum
can prevent unknown IDs, not wrong valid IDs. Do not change grouping and choices
together and attribute the result to one mechanism.

**Exit:** fewer wrong-resource joins/omissions at the declared budget without
regressing abstention or safety. A label retest needs consistent examples and a
new experiment identity, not repairs to old suffixes or scores.

### OBS-5: Evidence Completeness And Runtime Prerequisites

**Status: planned; required before correction or more tool rounds.** Preserve types,
observed emptiness, source/resource/read/time identity, raw digests, and explicit
missing/denied/truncated/error states. Expose caps, omissions, and continuations
without automatically expanding access or query scope.

The completed grouping/guidance run exposed six deadline failures without complete
candidate records. Incremental snapshots and once-only cancellation records are now
implemented and offline-tested for the actual direct-call eval path. Broader
streaming/MCP/tool cancellation qualification remains; an exited local process
does not prove the remote provider immediately stopped billing or work.

Verify cancellation and telemetry through planning, tools, synthesis, and cluster
changes in the actual shared session. Preserve immutable snapshots and approvals;
a settled outer timeout is not a cancelled underlying request.

**Exit:** offline denied/stale/truncated/empty/reordered evidence cannot become a
confident absence claim; cancellation stops further requests and records actual
work across tested paths. Keep general correction fixes separate from representation
experiments so their effects remain attributable.

### OBS-6: One Externally Validated Repair

**Status: planned; depends on OBS-3 and OBS-5.** Allow at most one correction with
the original task, answer, authorized evidence, and concrete public validator
errors. No gold-required fields or generic "think again" feedback. Compare with
a budget-matched no-repair baseline and retain both generations.

**Exit:** report first-attempt/final success, corrections and regressions, tokens,
latency, and abstention separately. No hidden retry-until-pass.

### OBS-7: Bounded Adaptive Retrieval

**Status: planned; depends on OBS-5.** Add tasks requiring a second read discovered
from the first, in a separate mode without exact-query hints. Use the existing
session owner, read-only tools, call/token/time budgets, repeated-request detection,
and approval continuity. Compare with one-batch synthesis; extra calls alone do
not fix already-visible omissions.

**Exit:** better supported diagnoses on discovery tasks with verified stop,
abstention, cancellation, and scope enforcement. Zero safety violations required.

### OBS-8: Fresh Live Qualification And Product Rollout

**Status: basic live rerun complete; broader qualification and consumer gates pending.**
The latest autoscaler baseline/fault/automatic recovery/cleanup passed. Register fresh incidents
with varied pool/rule order, names, ports, relationships, healthy controls, and new
mechanisms sourced through R15's public AKS incident research below. Counterbalance
enabled/disabled order; predeclare model, budgets,
repeats, and failure retention. Add model-backed real local Prometheus/Grafana
trials rather than calling lifecycle checks model success.

Validate selected improvements on the actual UI/CLI before promoting shared product
defaults. Render human-readable claims with inspectable evidence, not benchmark
envelopes. Cover normal/proactive sessions, cluster changes, approvals, streaming,
provider failures, and opt-outs.

**Exit:** lifecycle-valid runs plus causal/abstention/safety and consumer gates,
with costs and limitations reported. Private holdouts remain framework Phase 3;
this plan neither changes the locked Phase 2 roster nor authorizes new cloud spend.

## Prioritized Research Backlog

The completed ledger above is not a pending-work checklist. Promote or reject each
remaining item with a dated result and an explicit default decision.

| ID | Priority / phase | Status | Question and next discriminating check |
| --- | --- | --- | --- |
| R01 | P0 / OBS-3 | Initial controls implemented/tested | Fact-alternative/relevance and disposition checks added; full causal/retrieval-sufficiency validation remains. Preserve historical grades. |
| R02 | P0 / OBS-4 | First comparison complete; not promoted | Object grouping did not improve diagnosis passes. Keep the option and test any more compact field representation as a distinct experiment. |
| R03 | P1 / OBS-4 | Planned | Do retrieved-ID enums remove unknown refs without changing access? Test empty/large registries and wrong-but-valid selections. |
| R04 | P1 / OBS-5 | Planned | Can typed snapshots preserve empty/null/missing and source/time identity? Test stale reads, cluster switches, and array reordering. |
| R05 | P1 / OBS-5 | Planned | Do completeness states prevent absent-versus-truncated confusion? Reproduce the 101-item cap and content budget; test denied/failed/paginated reads. |
| R06 | P0 / OBS-5 | Direct-call fix offline-tested; broader coverage pending | Incremental snapshots and immediate cancellation records preserve observed usage. Planning/tool/final-response guards prevent new work after abort in the tested path. Streaming/MCP and remote/tool cancellation limits remain; historical missing usage stays unknown. |
| R07 | P1 / OBS-6 | Planned | Does one public-validator repair help at matched cost without gold feedback? Count good-to-bad and bad-to-good changes. |
| R08 | P1 / OBS-7 | Planned | Can a bounded loop discover the needed next read? Use tasks not solvable from prescribed initial requests. |
| R09 | P0 before OBS-8 | Recovery verified; retry-path coverage separate | Latest owned autoscaler lifecycle recovered and cleaned up successfully. Check retained command evidence before claiming the specific concurrent-operation retry path was exercised. |
| R10 | P1 / OBS-8 | Planned | Do gains survive fresh AKS mechanisms and model-backed local services? Register independent incident variation and disabled/healthy controls. |
| R11 | P1 / OBS-8 | Not started | Do UI/CLI users get the same benefit without benchmark JSON or approval regressions? Test actual consumers before product-default changes. |
| R12 | P2 / OBS-4 | Deferred | Can consistent labelled examples beat numeric IDs? Run a new encoding study; preserve the failed factorial. |
| R13 | P2 / stable baseline | Deferred | How robust are model/API versions, schema limits, and context ordering? Pin versions and budgets rather than pooling deployments. |
| R14 | P3 / after attribution | Deferred | Would larger models, fine-tuning, or more agents help beyond representation/runtime fixes? Current evidence does not identify model capacity as the bottleneck. |
| R15 | P1 / discovery before OBS-8 | 100 candidates reviewed; reproduction pending | Which user-reported AKS incidents can we reproduce? Keep a source-backed catalogue of useful real scenarios, record verified reproductions, and separately mark cases that require external observability evidence. |

### R15: Public-Report-Driven AKS Scenario Discovery

Research public user reports in AKS GitHub issues, Microsoft Q&A, Stack Overflow,
and incident write-ups. Use official Azure documentation to corroborate mechanisms,
not as a substitute for evidence that users encountered the problem. Source review
started on 2026-09-17; no new scenario is implemented or qualified by this research.

The [AKS scenario research catalogue](aks-scenario-research.md) and
[structured register](aks-candidate-register.json) now record 100 distinct
source-backed candidate designs after 120 body-level reviews from 435 collected
reports. The original seven discovery families, tool gaps, and our existing real
reproductions remain separately recorded. Candidate evidence labels are 46
Kubernetes-sufficient, 42 observability-helpful, and 12 observability-required;
none is newly reproduced or observability-only verified. Twenty reviewed reports
were not admitted, with reasons retained rather than counted toward the target.

Keep two independent classifications for every candidate:

- **Reproduction:** `unassessed`, `feasible-not-run`, `attempted-not-reproduced`,
  `fault-reproduced`, `lifecycle-verified`, or `blocked`. A proposed script or
  reporter's reproduction is not our verified run. Store attempt date, environment,
  source revision, setup/fault/recovery/cleanup outcomes, artifacts, cost, and
  blockers. Distinguish a related mechanism reproduction from the exact reported bug.
- **Evidence dependence:** `Kubernetes-sufficient`, `observability-helpful`,
  `observability-required-candidate`, `observability-only-verified`, or `unknown`.
  Keep reproducible Kubernetes-sufficient cases in the general AKS catalogue.
  Mark observability-only only after validating the declared evidence boundary
  and the decisive external reads; a model's Kubernetes-only failure is not proof.

Prioritize both a low-cost reproducible general case and a promising
observability-required case. Reproduction success is independent of model diagnosis
success. An observed fault without recovery or cleanup remains `fault-reproduced`,
not `lifecycle-verified`; pending or failed attempts are retained.

Initial findings distinguish confirmed mitigation from confirmed mechanism:

- [AKS outbound TLS timeouts](https://learn.microsoft.com/en-us/answers/questions/5968366/started-intermittent-ssl-handshake-issues-for-outb): the reporter confirmed on
   2026-08-08 that replacing Load Balancer outbound with NAT Gateway stopped the
   issue. SNAT exhaustion remains a candidate mechanism requiring metric evidence;
   the report does not prove that absence of NAT Gateway is inherently a fault.
- [AKS-to-peered-VNet connectivity](https://learn.microsoft.com/en-us/answers/questions/5955816/azure-kubernetes-service-aks-azure-dns-private-res): the 2026-07-24 report
   contrasts failing AKS nodes/Pods with working VMs. DNS/source-subnet/routing
   explanations are proposed replies, not a reporter-confirmed resolution.
- [Unexplained node deallocation](https://learn.microsoft.com/en-us/answers/questions/5970390/recurring-unexplained-vm-deallocation): the 2026-08-09 reporter confirmed
   deallocated VMSS instances and recovery by starting them, but the initiating
   cause remained unknown and support requested internal telemetry. Hold as an
   escalation/insufficient-evidence example, not a publicly solvable causal case.

For each candidate, record the source URL, report/access dates, AKS/network/plugin
versions and configuration, symptoms, confirmed cause and resolution, and remaining
uncertainties. Separate reporter evidence from speculation or unverified replies;
deduplicate reports of the same underlying incident. Summarize with attribution,
respect reuse terms, and do not import credentials or identifying customer data.

Admission requires:

1. An AKS-specific causal mechanism, not merely a generic Kubernetes fault hosted
   on AKS. Initial search leads include outbound SNAT exhaustion, Azure-side DNS
   or routing/firewall failures, and managed infrastructure capacity or health
   failures. These are hypotheses to investigate, not qualified scenarios.
2. The evidence needed to distinguish the cause from plausible alternatives,
   whether Kubernetes-native or external. For external reads, record provider,
   resource, signal, time window, and query; map them to existing Azure networking,
   metrics, health, logs, capacity, or tracing tools. Record missing coverage.
3. A documented Kubernetes-only evidence boundary, including available Pod/node
   state, events, and workload logs. For an observability-required claim, show why
   that evidence cannot establish the causal distinction and how an external read
   resolves it. Do not hide clues to
   manufacture an advantage. If Kubernetes-only evidence suffices, keep the case
   in the general reproducible AKS set, without an observability-only label.
4. A feasible disposable reproduction: provision real resources, prove a healthy
   baseline, induce the reported mechanism, verify the actual fault, recover, and
   perform ownership-checked cleanup. Record required permissions, telemetry setup,
   cost limits, and inaccessible dependencies. No canned-response replacement.

Deliver a ranked shortlist with source/evidence matrices, candidate tool coverage,
reproduction plans, verified-run records, and blocked/rejected reasons. Preserve
both general AKS cases and the observability-only subset. Define "only solvable
with observability" relative to the declared evidence boundary, not as a claim that nobody could guess
the cause. Freeze evaluator-only causal facts separately from candidate inputs;
qualify accepted cases with enabled and Kubernetes-only runs plus healthy and
confounding controls. Feed the shortlist into R10/OBS-8. Discovery can start before
live qualification; this item alone does not authorize provisioning or paid runs.

## Promotion And Reporting Rules

1. Name the benefit: efficiency, JSON validity, reference validity, causal accuracy,
   abstention, or operator experience. Do not substitute one metric for another.
   Current promotion is for compact input and strict-format reliability, not
   demonstrated general diagnostic accuracy.
2. Freeze code/prompt/schema/input hashes, explicit options, model, budgets, repeats,
   order, and metrics before collection. Invalid/failed attempts remain in the
   denominator. No score-based retries or output repair.
3. Run offline discriminating controls, then fixed-budget development comparisons,
   then fresh live/consumer qualification for operational claims. Report effects
   and dependence honestly; repeated calls do not create new incidents.
4. Promote successful scoped experiments with their result record: change the
   owning default, test request behavior and opt-outs, update the guide/default
   matrix, and link evidence. Do not leave a proven benefit opt-in by accident or
   silently enable a failed arm.
5. Preserve rollback options and version future baselines. Unsupported capabilities
   fail clearly, with no hidden downgrade. Investigate safety, abstention,
   grounding, and cost regressions rather than averaging them away.
6. Update this ledger with date, status, all attempts, limitations, artifacts, and
   default decision. Preserve older reports and original scores.

## Sources And Evidence Limits

Sources were reviewed on 2026-09-17; this consolidation is not a new systematic
search. They motivate hypotheses, not proven explanations of our two incidents.
General methodology remains in [eval research](../evals/docs/research.md).

| Source | Supports | Does not establish |
| --- | --- | --- |
| [Lost in the Middle](https://arxiv.org/abs/2307.03172) | Testing evidence position and context size. | Why this GPT-4o deployment omitted these facts; older models/tasks differ. |
| [ALCE](https://arxiv.org/html/2305.14627v2) | Separate answer correctness, citation support/relevance, and copying shortcuts. | That more retrieval or lossy summaries improve this assistant. |
| [Intrinsic self-correction study](https://arxiv.org/html/2310.01798v2) | Gold feedback, extra compute, and generic self-critique can confound repair gains. | That reliable external-validator repair cannot help. |
| [ReAct](https://arxiv.org/html/2210.03629v3) | Interaction with evidence across steps, including repetitive/failed actions. | That extra reads fix omissions in already-retrieved evidence. |
| [Azure structured outputs](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/structured-outputs) | Supported models/schema subset and required fields at the API boundary. | Truth, reference existence, causal relevance, or universal model support. |
| [Tam et al.](https://arxiv.org/abs/2408.02442) | Measure reasoning as well as format compliance under output constraints. | A regression on this Azure deployment. |
| [Anthropic tools](https://www.anthropic.com/engineering/writing-tools-for-agents) and [context](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) | Meaningful IDs, precise tools, and context design as engineering hypotheses. | Independent proof that suffix-labelled IDs improve GPT-4o. |
| [AIOpsLab](https://github.com/microsoft/AIOpsLab) and [ITBench](https://github.com/itbench-hub/ITBench) | Real deployments, faults, workloads, telemetry, and outcome verification. | Independent breadth from repeating our two incidents or permission to copy arbitrary benchmark material. |