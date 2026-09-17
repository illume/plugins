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

### Fresh Strict-Default Live Run: Interim

The [2026-09-17 live rerun checkpoint](../evals/docs/observability-aks-strict-results.md)
records an enabled NSG diagnosis pass on fresh infrastructure: all 6/6 required
facts, selection and no-action controls passed, 22.553 seconds. Connectivity
recovery also passed. Kubernetes-only failed diagnosis in 15.569 seconds: it
expressed uncertainty but still asserted unrelated facts as causes.

At this publication checkpoint, NSG cleanup is underway and autoscaler is queued
behind verified deletion. Only two of four planned diagnoses are complete; this
is not yet a lifecycle-valid NSG pass or a completed rerun. The original results
below remain unchanged. This new NSG success does not isolate strict JSON from
compaction, selection, the public fact budget, or changed live observations.

### Live AKS Baseline

The [live report](../evals/docs/observability-aks-gpt4o-results.md) records four
scored GPT-4o sessions and eight model requests on genuinely induced faults.
The NSG diagnosis omitted inbound direction. Capacity used a wrong CPU JSON
Pointer and omitted pool identity. Its prose also blamed a small VM for a workload
that had fit during baseline: citation repair alone would not prove correct
reasoning. Two earlier NSG setup/tool failures were not model failures.

The concurrent-operation recovery retry was added and unit-tested after the
capacity failure, not verified in Azure. Cleanup success is not recovery success.
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

**Status: executed; recovery/independent qualification incomplete.** Local service
lifecycles passed. Live AKS/model failures and cleanup are recorded above. Keep
original scores; re-verify capacity recovery before OBS-8.

### OBS-1: Compact Evidence And Exact Selection

**Status: implemented, evaluated, compaction promoted.** The 14-session experiment
and model-free controls are complete. Preserve provenance and per-read resolution.
Never expand one selected object into every required field.

### OBS-2: Strict Final JSON And Reference Encoding

**Status: implemented, evaluated; strict numeric promoted after operator request.**
The 20-session factorial is complete. Do not rerun it to improve scores. Retain
prompt-only/full/compact overrides and explicit labelled experiments. Default
tests cover the real Azure request boundary and provider/override rules.
The separate fresh live rerun has an NSG diagnosis/recovery pass; cleanup and
autoscaler results remain pending at the published checkpoint linked above.

### OBS-3: Causal And Abstention Controls

**Status: next, before another accuracy claim.** Add a prospective versioned
contract separating localization, cause-to-symptom support, citation relevance,
uncertainty, safety, and lifecycle validity. Start with wrong-pool, shadowed-rule,
healthy, and insufficient-evidence examples, plus valid alternative explanations.

**Exit:** known-bad echoes, wrong-resource joins, and confident unsupported causes
fail; supported diagnoses and appropriate abstention pass. Test graders without
model calls first. Freeze contracts before new scored runs; historical grades stay.

### OBS-4: Preserve Object Identity, Then Constrain Choices

**Status: planned; depends on OBS-3.** First compare strict numeric with a
deterministic per-pool/per-rule view that keeps identity and related settings
together, preserving every observation and selection granularity. Use reordered
arrays, repeated equal values, and unrelated pools/rules as discriminating cases.

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

**Status: blocked on recovery verification and relevant earlier gates.** Prove
autoscaler baseline/fault/automatic recovery/cleanup first. Register fresh incidents
with varied pool/rule order, names, ports, relationships, healthy controls, and new
mechanisms. Counterbalance enabled/disabled order; predeclare model, budgets,
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
| R01 | P0 / OBS-3 | Next | Do causal/abstention contracts reject wrong-pool, shadowed-rule, healthy, and insufficient-evidence false passes while accepting alternatives? Run model-free controls first. |
| R02 | P0 / OBS-4 | Planned | Does grouping reduce wrong joins and missing identity? Compare strict numeric against matched reordered/equal-valued multi-object evidence. |
| R03 | P1 / OBS-4 | Planned | Do retrieved-ID enums remove unknown refs without changing access? Test empty/large registries and wrong-but-valid selections. |
| R04 | P1 / OBS-5 | Planned | Can typed snapshots preserve empty/null/missing and source/time identity? Test stale reads, cluster switches, and array reordering. |
| R05 | P1 / OBS-5 | Planned | Do completeness states prevent absent-versus-truncated confusion? Reproduce the 101-item cap and content budget; test denied/failed/paginated reads. |
| R06 | P1 / OBS-5 | Partly implemented | Strict synthesis cancellation exists; verify planning/tool/general-synthesis cancellation and telemetry before increasing budgets. |
| R07 | P1 / OBS-6 | Planned | Does one public-validator repair help at matched cost without gold feedback? Count good-to-bad and bad-to-good changes. |
| R08 | P1 / OBS-7 | Planned | Can a bounded loop discover the needed next read? Use tasks not solvable from prescribed initial requests. |
| R09 | P0 before OBS-8 | Live verification pending | Does the concurrent-operation retry restore automatic scale-out? Run a fresh owned lifecycle only with explicit cloud authorization. |
| R10 | P1 / OBS-8 | Planned | Do gains survive fresh AKS mechanisms and model-backed local services? Register independent incident variation and disabled/healthy controls. |
| R11 | P1 / OBS-8 | Not started | Do UI/CLI users get the same benefit without benchmark JSON or approval regressions? Test actual consumers before product-default changes. |
| R12 | P2 / OBS-4 | Deferred | Can consistent labelled examples beat numeric IDs? Run a new encoding study; preserve the failed factorial. |
| R13 | P2 / stable baseline | Deferred | How robust are model/API versions, schema limits, and context ordering? Pin versions and budgets rather than pooling deployments. |
| R14 | P3 / after attribution | Deferred | Would larger models, fine-tuning, or more agents help beyond representation/runtime fixes? Current evidence does not identify model capacity as the bottleneck. |

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