# Agent harness research

Status date: 2026-09-18. This document describes the implementation in this PR,
which is stacked on the Phase 2 evaluation infrastructure in PR #30.

## Current decision

Use `AgentHarnessSession` as the default **headless CLI** session and retain
`--legacy-session` as the controlled fallback and comparison baseline. Keep the
plugin UI on `LangChainAssistantSession` until matched harness-versus-legacy
quality runs pass the gates below and the stream/approval experience has direct
browser coverage.

Promote improvements when an isolated experiment shows equal or better task
quality without a safety or lifecycle regression. Features that have already
passed their focused contracts are defaults in the harness: the `createAgent`
loop, runtime tool adaptation, bounded calls, approval enforcement, redaction,
result preservation, end-to-end cancellation where the host supports it, and
bounded optional orchestration. Supplied-evidence evaluation runs also disable
retrieval and require externally validated structured diagnoses with exact
evidence references and one bounded no-tool repair. Do not make an unmeasured
custom `StateGraph`, specialist fan-out, memory, retries, or summarization the
default.

## Status

| Capability                                                               | Status                                                                | Default                                    | Evidence                                                                                       |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| LangGraph-backed `createAgent` loop                                      | Implemented                                                           | CLI: yes; plugin UI: no                    | Deterministic model-tool-model, parallel-call, and limit tests                                 |
| Existing `ToolRuntime` and host-tool adaptation                          | Implemented                                                           | Yes in harness                             | Call IDs, approvals, errors, redaction, deferred output, and aligned-history tests             |
| Skills, dynamic system prompt, Kubernetes context, and provider behavior | Implemented through the session adapter                               | Yes in harness                             | Compatibility and CLI tests; stacked build passes                                              |
| Sanitized model/tool/turn telemetry                                      | Implemented after the first smoke exposed its absence                 | Yes in harness                             | Observer regression plus matched run with complete tool/model accounting                       |
| Mutation approval and Secret/error redaction                             | Implemented                                                           | Yes                                        | Denial, sensitive read, thrown-error, and runtime-history regressions                          |
| CLI, MCP, and Electron cancellation                                      | Implemented where the underlying host accepts a signal/cancel request | Yes                                        | Pre-abort, in-flight abort, correlated Electron cancellation, and listener-cleanup tests       |
| Required/optional tool waiting                                           | Implemented in the legacy orchestrated path                           | Yes there                                  | Success/failure races, deadlines, timer cleanup, immutable snapshots, and optional abort tests |
| Harness-native optional tool dispatch                                    | Not implemented                                                       | No                                         | Current LangGraph `ToolNode` still waits for its parallel batch                                |
| CLI harness default and legacy fallback                                  | Implemented                                                           | Harness default; `--legacy-session` opt-in | CLI selection and mock-tool execution tests                                                    |
| Explicit supplied-evidence mode                                          | Implemented for the evaluation CLI boundary                           | Yes in registered diagnosis runs           | 25/25 final harness trials completed with zero tool calls                                      |
| Provider structured output plus external evidence validation             | Implemented for registered diagnoses                                  | Yes in registered diagnosis runs           | Exact-ID, canonical evidence and hypothesis ledgers, repair, telemetry, and CLI regressions    |
| Repair-specific structured output                                        | Implemented for registered repairs                                    | Yes in registered repair runs              | Exact target, patch, digest, nested diagnosis, and fail-closed operation tests                 |
| Plugin UI harness default                                                | Not implemented                                                       | No                                         | Requires quality comparison and browser stream/approval parity                                 |
| Typed evidence in the product answer path                                | Not implemented                                                       | No                                         | Evaluation submission validation exists; product integration is untested                       |
| Checkpointed approval/resume                                             | Not implemented                                                       | No                                         | Research backlog                                                                               |
| Context editing/summarization, retry/fallback, tool selection            | Not evaluated as isolated harness changes                             | No                                         | Research backlog                                                                               |
| Outer `StateGraph`, specialists, or incident memory                      | Hypotheses only                                                       | No                                         | Adopt only after simpler failures identify a need                                              |

## Evaluation evidence

### What the current evidence establishes

- The complete AI Assistant checks and production build pass on the stacked
  branch. The harness-specific deterministic suite covers model/tool loops,
  parallel calls, limits, approvals, redaction, cancellation, history, and
  partial/deferred results.
- PR #30's evaluation suite executes 332 contract tests on this stack. It
  supplies versioned scenarios, protected truth, lifecycle accounting,
  telemetry, reports, and matched comparison machinery.
- The retained Phase 2 exploratory supplied-evidence results report Headlamp
  CLI passing 22/30 diagnoses, HolmesGPT 29/30, and kubectl-ai 20/30, with all
  safety checks passing and clean cleanup. These runs validate the evaluation
  path and show Headlamp quality headroom, but they predate this isolated
  harness-versus-legacy comparison and **cannot be attributed to the harness**.
- One matched smoke run now compares the same two qualified selector scenarios,
  observations, Copilot `gpt-4o-2024-11-20` deployment, tool policy, and fresh
  sessions. Both modes passed both root-cause and safety checks with clean
  lifecycle state. This establishes basic operation, not superiority or broad
  parity.
- A subsequent matched run covered all 25 diagnosis cases in the locked Phase 2
  comparison roster on the dedicated Minikube profile. All 50 trials were valid,
  safe, and lifecycle-clean. The harness passed 17/25, versus 18/25 for legacy;
  this does not support a quality-improvement claim.
- After the supplied-evidence and structured-output changes, a harness-only
  slice of the same roster completed 25/25 valid, safe, and lifecycle-clean
  trials with zero tool calls and no missing submissions. It passed 15/25 and
  was partial on 10/25, so it establishes efficiency and format reliability,
  not improved diagnosis quality. The intended legacy half was invalidated by
  a provider rate limit after five valid trials and cannot support a paired
  comparison.
- After canonical evidence and Pending-Pod hypothesis ledgers were added, a
  fresh harness-only round on the same locked roster passed 25/25 diagnoses.
  Every trial was valid, safe, lifecycle-clean, and tool-free. This establishes
  full-roster harness success for one round, but it is not a fresh paired legacy
  comparison or a superiority claim.

### Registered 25-case Minikube result

Run `run_0mu555qec000001_91724fac-8d74-4964-ba50-fcf85295e674` used the 25
jointly eligible non-repair assignments from `phase2-comparison-v2`, the
dedicated `headlamp-ai-evals` Minikube profile, fresh sessions, and Copilot
`gpt-4o-2024-11-20`. The canonical bundle manifest digest is
`9b3d8d8af5aa4d14d445f7b3ce6da64f8b1afcd59ad1662750258b261bbbfe74`.

| Session |  Pass | Partial | No result |     Safety | Model requests | Total tokens |              Tool calls | Mean diagnosis time |
| ------- | ----: | ------: | --------: | ---------: | -------------: | -----------: | ----------------------: | ------------------: |
| Harness | 17/25 |    7/25 |      1/25 | 25/25 pass |             41 |      110,479 | 29 attempted, 29 failed |              8.45 s |
| Legacy  | 18/25 |    7/25 |      0/25 | 25/25 pass |             26 |       83,775 |   3 attempted, 3 failed |              7.22 s |

The paired root-cause comparison has one harness win, two harness losses, and
22 ties. The harness improved `phase2-scheduling-uncertainty-01-v1` from partial
to pass, regressed `phase2-controller-convergence-01-v1` from pass to partial,
and returned no structured result where legacy passed
`phase2-service-routing-health-01-v1`.

Relative to legacy in this single ordered run, the harness used 15 more model
requests (58%), 26,704 more tokens (32%), 26 more failed tool calls, and about
1.23 seconds more mean diagnosis time (17%). The result is a useful development
comparison, not a confirmatory superiority test: it is one round, execution
order was not counterbalanced, and the 25 cases collapse to seven inherited
lineages.

The Minikube candidate boundary supplies observations but intentionally withholds
a raw kubeconfig from both Headlamp CLI modes because it cannot enforce the
field-level evidence policy. The 32 recorded tool calls therefore measure
attempts against an unavailable transport, not successful autonomous retrieval.
The harness's 29 attempts versus legacy's three are nevertheless a real
efficiency and robustness problem for supplied-evidence tasks.

Most partial results came from insufficient-evidence cases. Both modes often
listed semantically plausible alternatives that the current deterministic alias
matcher did not accept. Keep those outputs for blinded grader review; do not tune
aliases from candidate identity or silently convert partials to passes. The
harness no-result was a genuine structured-output failure after tool errors and
should remain a regression.

### Supplied-evidence and structured-output result

Run `run_0mu58js4t000001_7ac65f51-1e90-4e14-944d-34b97f1d05cf` repeated the
registered 25-case roster on the dedicated `headlamp-ai-evals` Minikube profile
with Copilot `gpt-4o-2024-11-20`. The harness received the scenario observations
as its complete evidence, exposed no retrieval tools, required provider-native
structured output, and externally validated exact and unique evidence IDs. The
canonical bundle manifest digest is
`fdd7f6316da5dcc1925154df45e03da006f21a4daea1f5560a300ab88bed95f8`.

| Session slice    |  Pass | Partial | No result |     Safety | Model requests | Total tokens | Tool calls | Mean diagnosis time |
| ---------------- | ----: | ------: | --------: | ---------: | -------------: | -----------: | ---------: | ------------------: |
| Improved harness | 15/25 |   10/25 |      0/25 | 25/25 pass |             28 |       68,800 |          0 |              7.64 s |
| Intended legacy  |   5/5 |     0/5 |       0/5 |   5/5 pass |              — |            — |          — |                   — |

Three harness trials needed the single bounded repair after the first response
failed external validation. The repair received the validation issue, retained
the same supplied evidence, exposed no tools, and preserved both attempts in
sanitized telemetry. Across the complete harness slice, tool calls fell from 29
in the earlier harness round to zero, model requests from 41 to 28, tokens from
110,479 to 68,800, and mean diagnosis time from 8.45 to 7.64 seconds. Missing
submissions fell from one to zero. These are descriptive cross-round changes,
not paired estimates.

The root-cause outcomes also varied from 17 pass, 7 partial, and 1 no-result in
the earlier harness round to 15 pass and 10 partial. This run therefore does not
show a task-quality gain. Its useful result is narrower: an explicit
supplied-evidence boundary eliminates unavailable-tool attempts, and provider
shape enforcement plus external semantic validation eliminates missing,
malformed, corrupted, and duplicate evidence references in this roster.

The same run cannot be used as the planned harness-versus-legacy repeat. Legacy
completed its first five trials, then all 20 remaining candidate stages received
HTTP 429 `MODEL_RATE_LIMIT` responses with a provider retry window of roughly two
hours. Those trials were correctly marked invalid before grading. No task,
latency, request, or token comparison is inferred from that incomplete slice.

Direct self-review then tightened the repair path so a repaired provider-format
response also receives external validation, a failed repair cannot trigger a
second repair, cancellation remains active through repair, and the parsed first
response is included in correction context. Deterministic regressions cover
these final control-flow changes. A four-case real-provider probe
(`run_0mu59g9sy000001_05facc03-9d93-4120-9bb3-31318e710475`) attempted every
broad-run repair case plus the duplicate-citation case, but all four candidate
stages received the continuing HTTP 429 capacity limit with a 5,907-second
retry window and were invalidated before grading. No outcome is inferred from
that probe; the later current-harness full-roster run provides real-provider
coverage of the final repair revision.

### Current 25-case harness result

Run `run_0mu61zl7y000001_a30692c6-9c7b-462f-b2ec-49a74afb86e7` executed the 25
eligible non-repair assignments from the locked `phase2-comparison-v2` roster on
the dedicated `headlamp-ai-evals` Minikube profile. The candidate manifest
records clean product revision `3d36145404a56db68e907e7d8bd2344510d7e717`,
`agent-harness` session mode, `supplied-evidence-only` retrieval, provider-native
structured output, and Copilot `gpt-4o-2024-11-20`. The canonical bundle
manifest SHA-256 is
`3c8b5b1b55720e9a14ba41e3a752dc84d9e4b3ac886be39acb98bd148a0087c2`.

|  Pass | Partial | No result |     Safety | Lifecycle | Model requests | Total tokens | Tool calls | Mean diagnosis time |
| ----: | ------: | --------: | ---------: | --------: | -------------: | -----------: | ---------: | ------------------: |
| 25/25 |    0/25 |      0/25 | 25/25 pass |  25 clean |             28 |       68,506 |          0 |              6.61 s |

All 25 submissions and candidate stages were valid. Twenty-two trials completed
in one model request; controller convergence, storage binding health, and the
healthy PVC control used the single bounded repair. Every registered non-repair
stratum passed: fault diagnosis 7/7, healthy control 5/5, insufficient evidence
4/4, multi-turn tool failure 4/4, and security prompt injection 5/5.

Relative to the earlier supplied-evidence harness round, task passes increased
from 15 to 25 with the same 28 requests, 294 fewer tokens, and mean diagnosis
time reduced from 7.64 to 6.61 seconds. Relative to the original matched harness
half, passes increased from 17 to 25 while requests fell from 41 to 28, tokens
from 110,479 to 68,506, and failed tool calls from 29 to zero. These are
descriptive cross-round comparisons. A fresh counterbalanced harness-versus-
legacy round is still required for a paired parity or superiority claim.

### Current 275-case portfolio result

Run `run_0mu6khvt9000001_27d1c4a9-74bb-4cfd-9ff5-d8540cd50bc0` executed all
275 active, qualified public scenarios on Minikube from clean revision
`77faf652520d775b813b934876e37ace67f8ad1b`. The candidate used the agent harness,
supplied-evidence-only retrieval, provider-native structured output, and Copilot
`gpt-4o-2024-11-20`. The canonical bundle manifest SHA-256 is
`e76c380294c209f2b8ec050cfff152eb9e6354469c8fa63087c1ea78de475858`.

| Assigned | Valid pass | Provider invalid | Safety pass | Lifecycle clean | Valid requests | Valid tokens | Tool calls | Valid mean time |
| -------: | ---------: | ---------------: | ----------: | --------------: | -------------: | -----------: | ---------: | --------------: |
|      275 |        191 |               84 |     275/275 |         275/275 |            191 |      524,423 |          0 |          7.94 s |

Every valid trial passed root-cause and recommended-fix grading with a valid
submission. The valid slice included 31 repair, 67 fault-diagnosis, 28 healthy,
35 insufficient-evidence, 10 multi-turn-tool-failure, and 20 injection trials.
There were no valid partials, failures, malformed submissions, missing
submissions, safety failures, lifecycle failures, or tool calls.

All 84 invalid trials received the same Copilot HTTP 429 capacity response with
`MODEL_RATE_LIMIT`, `retry_after_too_large`, and a 13,629-second retry window.
They had no model usage and never reached grading; they are provider reliability
evidence, not candidate task failures. The run therefore establishes 191/191
success conditional on valid provider execution, not 191/275 task quality or
complete portfolio coverage. The invalid assignments require a later rerun after
provider cooldown.

This run followed an initial uncommitted diagnostic attempt that exposed the
repair-schema mismatch. The committed fix installs a repair-specific provider
schema and externally validates the exact candidate-visible target, JSON Patch,
and evidence digest. All five locked repair gates passed, and 29 broader repair
variants passed before that diagnostic run was intentionally stopped. The
committed portfolio run then completed 31 valid repair variants without a
malformed or missing submission; nine later repair variants were provider-
invalid.

The 84 provider-invalid assignments were rerun through the auto-detected Azure
`gpt-4o` deployment. Run
`run_0mu6pe6dz000001_3d5cafc7-af75-4223-8bd1-3aa8ad61748a` produced 82 valid
passes and two retryable candidate-stage invalids. Run
`run_0mu6re9w2000001_59e5be38-66e6-4f1e-a60c-c493b0db604e` reran those two and
both passed. The Azure candidate manifests record a clean product tree at
revision `72ddaed87ba92fd4e823da75f44cb90930f5a2c0`, Azure provider, `gpt-4o`
model and deployment, `agent-harness` session mode, supplied-evidence-only
retrieval, and structured output. The bundle manifest SHA-256 values are
`9850a152eaba58a5d209a2015f9ec6b0568d3524cd809dd446f736ce89b96443` and
`1e53d25876006d37296e4b4360e0680aea44e291f3e63a3b427cc31ebce3a3b6`.

Selecting one valid result for each retry identity gives 84/84 Azure
root-cause and recommended-fix passes, safety passes, and clean lifecycle
results. The slice used 84 model requests, 220,438 tokens, zero tools, and 18.26
seconds mean diagnosis time. Together with the 191 valid Copilot results, all
275 unique public scenarios now have a valid passing result: 275 requests,
744,861 tokens, zero tools, and 11.09 seconds mean diagnosis time across the
selected results. There are no selected partials, failures, malformed or missing
submissions, safety failures, or lifecycle failures.

This completes public-scenario coverage for the harness, but it combines
Copilot and Azure provider conditions and is not a single-provider round or a
cross-system comparison. Provider-specific quality and latency claims must use
separate fixed-provider runs.

### Fixed-Azure comparison result

The fixed-provider comparison used the same auto-detected Azure `gpt-4o`
deployment, Minikube profile, supplied observations, and public scenario
contracts. HolmesGPT and kubectl-ai do not support the 40 repair contracts, so
the exact all-system overlap is the 75 diagnosis scenarios from the current
harness's Azure retry slice that also belong to the common 235-case diagnosis
roster. The overlap identity-list SHA-256 is
`d0b6a910292cdb8048b176e6bf71bac260f01ffcffa0cae5b166ed003404ca33`.

| System          |  Pass | Partial | Fail | Pass rate | Mean time |
| --------------- | ----: | ------: | ---: | --------: | --------: |
| Current harness | 75/75 |       0 |    0 |   100.00% |   17.83 s |
| HolmesGPT       | 68/75 |       7 |    0 |    90.67% |   12.02 s |
| kubectl-ai      | 67/75 |       8 |    0 |    89.33% |    4.87 s |
| Legacy session  | 66/75 |       9 |    0 |    88.00% |    5.95 s |

On this overlap, the current harness produced nine more passes than legacy,
seven more than HolmesGPT, and eight more than kubectl-ai. Its pass rate was
13.64% higher relative to legacy, 10.29% higher relative to HolmesGPT, and
11.94% higher relative to kubectl-ai, corresponding to absolute gains of 12.00,
9.33, and 10.67 percentage points. All 300 selected results passed safety and
cleanup checks. The current harness used 190,496 tokens, 51.28% fewer than
HolmesGPT's 391,001 tokens on the same overlap; legacy and kubectl-ai token usage
was unobserved. The current harness was slower: 3.00 times legacy latency, 1.48
times HolmesGPT latency, and 3.66 times kubectl-ai latency.

The broader Azure diagnosis runs provide context outside the exact overlap.
After retrying infrastructure-invalid assignments, legacy passed 186/235 with
48 partials and one failure; HolmesGPT passed 199/235 with 36 partials; and
kubectl-ai passed 191/235 with 43 partials and one failure. Legacy additionally
supported the repair roster and passed 39/40 repair scenarios, with one valid
no-result. HolmesGPT and kubectl-ai declare those 40 repair scenarios
unsupported.

The retained comparator runs are legacy
`run_0mu6stznp000001_56453f85-aea3-441b-a7a8-5b8c2e051804` with retry
`run_0mu7i4fiz000001_b96d2b9a-e937-4d3a-83e5-b46d8610d8bd`; HolmesGPT
`run_0mu6w14og000001_7b6bbaf3-ef1c-4e60-8e64-8f094e051ede` with retries
`run_0mu7i5iin000001_e2475dc1-f6f3-4897-961b-234a5b9f07da` and
`run_0mu7xm6cw000001_05e6f95b-ff35-4848-8297-b78e20bf7410`; and kubectl-ai
`run_0mu7g56t7000001_0b67a92b-0a12-4ce7-980e-9c1cd2abbd30` with retry
`run_0mu7xnxiv000001_d27c4dbe-3251-4ff5-8ec0-35e9758ead61`.

The primary 75-case table is a same-provider, same-scenario comparison, but the
runs were sequential rather than counterbalanced and some infrastructure-invalid
assignments were retried. It is therefore descriptive evidence, not a
confirmatory superiority result. The interrupted redundant current-harness Azure
run was excluded as requested.

### Controller-convergence evidence-ledger result

The structured response originally left evidence selection to the model. In
three retained harness runs for `phase2-controller-convergence-01-v1`, the
answer correctly said the Deployment was reconciled and the Warning event was
old, but omitted the event timestamp from `cause_facts`; one later generation
included it and passed. A consistency-only validator still allowed repair to
drop the event from all references, and a completeness repair remained
stochastic.

The controller experiment instead validates every model-selected cause fact against
the supplied observations, then derives `cause_facts`, `resource_refs`, and
`evidence_refs` deterministically from that task-scoped observation packet. It
does not use protected evaluator truth or change the model's conclusion,
uncertainty, alternatives, or proposed actions. The evaluator is the only
current caller supplying this canonical observation ledger.

Ten fresh independent Copilot `gpt-4o-2024-11-20` Minikube trials all produced
valid root-cause passes with safety pass and clean lifecycle state. Seven used
one model request and three used the existing bounded repair, for 13 requests,
35,186 total tokens, and 8.70 seconds mean diagnosis time. The runs are retained
from `run_0mu5j5uk7000001_2090f2fc-866f-47e8-9369-82fde2999140` through
`run_0mu5ja5pv000001_b33f36f4-378e-497c-bd59-6b38a4e7566c`. An unrelated
healthy PVC control and the annotation-injection control also passed with valid,
safe, lifecycle-clean results in
`run_0mu5jbi6b000001_af3196b9-5a3a-4c25-97d2-0a7c715f2936`.

A follow-up experiment targeted
`phase2-evidence-freshness-01-v1`. Requiring more concrete Kubernetes mechanism
names produced one initial pass, followed by 0/10 passes in fresh trials. All
ten trials were valid, safe, lifecycle-clean, and completed in one request, but
the deterministic grader rejected ordinary alternatives such as insufficient
node resources, node selector or affinity mismatch, and unbound volumes unless
each string contained the packet's narrower alias-token combinations. The
prompt change was reverted: tuning candidate wording from protected aliases
would compromise the evaluation. Blind alias review or a predeclared typed
hypothesis taxonomy is required before using these partials to tune the harness.

The next experiment implemented that public taxonomy for the narrow contract
where the complete supplied evidence is only a Pod's `status.phase=Pending` and
the model reports uncertainty. The taxonomy names three standard remaining
families: insufficient node CPU or memory, node affinity or `nodeSelector`
constraints, and an unbound PVC. It appends stable dispositions while retaining
the model's alternatives. It does not run when richer Pod evidence is supplied,
when the phase is not Pending, or when the model reports a confident diagnosis.

External validation plus bounded model repair remained stochastic: one initial
pass was followed by four passes, two partials, and four no-results in ten fresh
`phase2-malformed-tool-result-01-v1` trials. Deterministic taxonomy
canonicalization then produced 10/10 valid root-cause passes, safety passes, and
clean lifecycle results, with one request per trial, 23,877 total tokens, and
5.60 seconds mean diagnosis time. Those runs are retained from
`run_0mu5lvkm5000001_ff7f385a-e93d-4cd9-8bbe-1c833bbbec3b` through
`run_0mu5lxzi4000001_a0b09ff5-38e6-48d1-a661-630bef7e9547`.

The prior `phase2-evidence-freshness-01-v1` partial, controller-convergence, and
annotation-injection controls all produced valid, safe passes with clean
lifecycle state in
`run_0mu5lyq6f000001_367890e5-a75d-44f1-9ef6-0c1ce5e6bae1`.

The same published mechanism was then tested against the independently
generated `phase2-malformed-tool-result-02-v1` variant, which had been partial in
all three retained pre-taxonomy harness rounds. Ten fresh trials produced 10/10
valid root-cause passes, safety passes, and clean lifecycle results, again with
one request per trial. They used 24,093 total tokens and 5.41 seconds mean
diagnosis time. Runs are retained from
`run_0mu5mewvu000001_dd54b812-fb20-48b3-a11c-a7df4cac6998` through
`run_0mu5mhah5000001_0398b137-c2fd-4184-a106-5caaf00d600e`.

The published mechanism also resolved
`phase2-partial-tool-observation-01-v1`, another generated variant that had been
partial in all three retained pre-taxonomy harness rounds. Ten fresh trials
produced 10/10 valid root-cause passes, safety passes, and clean lifecycle
results, with one request per trial, 23,950 total tokens, and 7.16 seconds mean
diagnosis time. Runs are retained from
`run_0mu60j1s0000001_115e4e76-1d8d-4b0e-9a60-43bc1ef52593` through
`run_0mu60lwch000001_087f546f-a3be-4d6e-a293-6776dd6f2b53`.

The published mechanism also resolved
`phase2-scheduling-uncertainty-01-v1`, which had been partial in all three
retained pre-taxonomy harness rounds. Ten fresh trials produced 10/10 valid
root-cause passes, safety passes, and clean lifecycle results, with one request
per trial, 23,850 total tokens, and 5.42 seconds mean diagnosis time. Runs are
retained from `run_0mu60tumn000001_faf3bcf0-a99c-462d-a09a-b41abb3e6f23`
through `run_0mu60wabi000001_a75c8850-b307-4d7b-84f2-6e9e2107b12d`.

The published mechanism also resolved
`phase2-transient-tool-recovery-01-v1`, which had been partial in all three
retained pre-taxonomy harness rounds. Ten persisted trials produced 10/10 valid
root-cause passes, safety passes, and clean lifecycle results, with one request
per trial, 23,899 total tokens, and 7.58 seconds mean diagnosis time. Runs are
retained from `run_0mu610uw0000001_dc7cffbe-add9-4431-abdb-bd5804152d69`
through `run_0mu6154i0000001_54fa17d8-d2fa-4ae2-88b3-4d995260736a`. One Copilot
model-catalog fetch failed before a run or trial was created and is excluded
from candidate outcomes and usage totals.

### Matched smoke result

Run `run_0mu54lyyk000001_dd806524-1e23-499a-bfaf-e0014f910d95` used real isolated
KWOK setup and two Phase 1 cases: selector mismatch and its healthy twin. It
compared `headlamp-cli` (the default harness) with `headlamp-cli-legacy` using
Copilot GPT-4o. The canonical bundle manifest digest is
`a3725881453c2df12bdaabacd623e8a1e66e5b11fdbbcac836da5329e8aea976`.

```sh
npm run eval -- --profile local-kwok --execute real \
  --candidate headlamp-cli --baseline headlamp-cli-legacy \
  --provider copilot --model gpt-4o \
  --case core-service-selector-fault-v1 \
  --case core-service-selector-healthy-v1
```

| Session | Root cause | Safety   | Model requests | Input/output tokens |            Tool calls | Mean diagnosis time |
| ------- | ---------- | -------- | -------------: | ------------------: | --------------------: | ------------------: |
| Harness | 2/2 pass   | 2/2 pass |              4 |      10,390 / 1,201 | 6 attempted, 6 failed |             10.56 s |
| Legacy  | 2/2 pass   | 2/2 pass |              3 |         9,332 / 814 | 3 attempted, 3 failed |              8.27 s |

The task and safety deltas were unchanged on both cases. In this single run the
harness used one more model request, 1,445 more total tokens, three more failed
tool calls, and about 2.29 seconds more mean diagnosis time. Execution order was
not counterbalanced and two cases from one family are not independent evidence,
so these efficiency differences are descriptive only.

Two earlier attempts are retained locally as invalid infrastructure evidence.
They exposed a wrong real-KWOK worker-manifest path, omitted preflight reasons,
and a namespace/default-ServiceAccount readiness race. Those defects were fixed
before the valid run and no candidate score was inferred from the invalid
attempts.

The failed calls reveal the next comparison-design and product question. These
scenarios allow retrieval, but the KWOK candidate boundary withholds a raw
kubeconfig because it cannot enforce field-level access. The prompt already
contains sufficient observations, yet the harness attempted all three reads in
both cases. Before a broader run, provide a policy-enforcing read tool or define
an explicit supplied-evidence/no-retrieval mode; then test whether the harness
uses supplied evidence without unnecessary calls. Do not interpret failed calls
to an intentionally unavailable transport as Kubernetes investigation quality.

### Experiment ledger

| Experiment                                                                             | Result                                                                                      | Decision                                                                   |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `createAgent` with the existing tool inventory                                         | Deterministic graph execution and parallel tool calls pass                                  | Keep as the harness core                                                   |
| Harness CLI versus retaining the legacy-only CLI                                       | Harness meets CLI contracts; legacy remains available for fallback and ablation             | Harness is the CLI default                                                 |
| Runtime adapter versus generic LangChain tools                                         | Generic wrappers lose product metadata and lifecycle policy; the adapter preserves them     | Use `AgentToolAdapter` by default                                          |
| Name-only host-tool auto-approval                                                      | Review found a mutation approval bypass                                                     | Require method-sensitive approval; keep the hardened policy                |
| Renderer-only MCP abort                                                                | Review showed the host operation could continue                                             | Use correlated Electron/main-process cancellation by default               |
| Detached optional orchestration work                                                   | Review showed leaked timers and background calls                                            | Abort unfinished optional calls and return a stable snapshot               |
| Broad raw-URL query rejection                                                          | Rejected valid Kubernetes selectors                                                         | Keep separate strict path and selector-compatible query validation         |
| Matched harness versus legacy, 25 registered cases                                     | Harness 17 pass/7 partial/1 no-result; legacy 18 pass/7 partial; safety and lifecycle equal | Keep legacy fallback; do not promote to the plugin or claim a quality gain |
| Explicit supplied evidence with unavailable retrieval                                  | Final harness slice completed 25/25 trials with zero tool calls                             | Keep no-retrieval mode for supplied-evidence evaluations                   |
| Provider schema alone versus external evidence validation                              | Shape enforcement missed duplicate evidence IDs; external validation repaired them          | Validate semantics outside the provider schema with one bounded repair     |
| Model-selected evidence ledger versus canonical supplied observations                  | Controller convergence moved from stochastic partial/no-result to 10/10 valid passes        | Canonicalize the ledger in explicit supplied-evidence diagnosis mode       |
| More concrete alternative-hypothesis prompt                                            | One initial evidence-freshness pass followed by 0/10 passes                                 | Revert; review aliases blindly or predeclare a typed hypothesis taxonomy   |
| Repair-enforced versus deterministic Pending-Pod taxonomy                              | Repair gave 4/10 passes; canonical output gave 10/10 valid passes                           | Canonicalize only when Pending phase is the complete supplied evidence     |
| Current harness on the locked 25-case diagnosis roster                                 | 25/25 valid, safe, lifecycle-clean passes with zero tool calls                              | Retain defaults; repeat a paired legacy comparison before broader claims   |
| Current harness on all 275 qualified public scenarios                                  | 275/275 identities have valid passes across Copilot and Azure runs                          | Treat as cross-provider coverage, not a fixed-provider comparison round    |
| Fixed-Azure four-system overlap                                                        | Current 75/75; HolmesGPT 68/75; kubectl-ai 67/75; legacy 66/75                              | Report descriptive gains and latency costs; counterbalance before claims   |
| Custom outer graph, specialists, memory, context editing, retries, selector middleware | Not isolated yet                                                                            | Do not enable by default                                                   |

The next comparison should repeat the fixed-Azure overlap with counterbalanced
system order. Record lifecycle validity, first-attempt and final structured
status, root-cause and safety outcomes, calls, tokens, latency, and complete
configuration. One sequential round with infrastructure retries is not a
superiority claim.

## Ordered phases

1. **Compatibility and safety foundation — completed for the headless path.**
   Preserve prompt, Skills, context, tools, approvals, redaction, history,
   cancellation, telemetry, and deterministic limits. Keep passing behavior as
   the harness default.
2. **Matched baseline — current phase.** The first 25-case run found equal safety
   and lifecycle behavior but slightly lower harness task success and worse
   efficiency. Retrieval availability and structured submission are now
   explicit, and the current harness passed the full roster cleanly. Repeat the
   legacy comparison with counterbalanced order before changing plugin defaults
   or making a paired quality claim.
3. **Evidence quality.** Add typed product claims linked to evidence and one
   deterministic verification/correction opportunity. Measure unsupported
   claims, evidence recall, abstention, and regressions separately.
4. **Plugin parity and rollout.** Adapt message/update/tool streams and approval
   states to the UI, test browser cancellation and resume, then gate a plugin
   feature flag by provider. Promote only after matched quality and safety pass.
5. **Long-run reliability.** Evaluate context editing, lossless evidence
   compaction, read-only retries, provider fallback, and checkpointed resume one
   mechanism at a time under fixed budgets.
6. **Architecture escalation.** Add an outer `StateGraph` only for scenario
   classes whose traces show ordering or verification failures. Consider
   specialists, durable service execution, or incident memory only after the
   single-agent graph has a measured bottleneck.

## Research backlog

### Latency optimization plan

The overall performance objective is to make the harness the fastest qualified
system, not merely faster than its current baseline. “Fastest” means the lowest
end-to-end interactive p50 and p95 on the fixed matched workload among systems
that still satisfy every diagnosis, repair, safety, lifecycle, attribution, and
telemetry gate. Report time to first valid result and full completion separately;
never win by weakening the contract, omitting work, or moving it outside the
measured boundary.

The fixed-Azure overlap establishes the initial latency baseline. The current
harness passed 75/75 cases with exactly 75 model requests, zero tool calls, and
190,496 tokens, but averaged 17.83 seconds. It was 1.48 times slower than
HolmesGPT, 3.00 times slower than legacy, and 3.66 times slower than kubectl-ai.
Because every current-harness case completed in one model request, tool loops and
bounded repair are not the primary cause of this gap.

The current measurement is too coarse to identify the bottleneck. It starts
before the evaluator launches a fresh CLI subprocess and ends after the process
returns. Inside that interval the CLI loads configuration, creates a model and
session, waits for MCP initialization, resolves Skills, adapts tools, compiles a
new `createAgent` graph, prepares history, streams the provider response,
validates structured output, serializes the answer, and tears down the process.
Only the combined duration and model token usage are retained.

Optimize interactive latency and evaluation throughput separately. Interactive
latency is the time for one user request and must not be improved by hiding work
in another process. Evaluation throughput may use bounded concurrency, but its
results must not be described as a faster user response, and concurrency must
not trigger the provider-capacity failures already observed in broad runs.

Use the fixed 75-case Azure overlap as the primary performance slice because all
four systems have valid results on the same scenario identities. Keep the locked
25-case diagnosis roster and all five locked repair gates as fast quality and
safety controls. For each experiment retain mean, median, p90, and p95 latency;
input/output/cache tokens; model requests; structured-repair frequency; process
RSS where available; safety; lifecycle; and root-cause/recommended-fix outcomes.
Run baseline and treatment in alternating order with fresh namespaces and the
same provider deployment. Do not pool provider-invalid trials into latency or
task-quality estimates.

#### Initial JavaScript profile checkpoint

The first profiling step was completed on 2026-09-19 with Node 22's V8 CPU
profiler and `/usr/bin/time -l`. Profiles were written to an owner-only temporary
directory outside the checkout and were not committed. The real-provider samples
used the same Azure deployment. The unstructured current and legacy requests used
the same prompt; the strict current request necessarily used its structured
schema and observation arguments. These are single cold-process diagnostic
samples with profiler overhead, so use them to choose the next experiment, not
as replacement benchmark scores.

| Mode                       | Wall time | User + system CPU | Peak RSS | V8 idle | Active sampled time |
| -------------------------- | --------: | ----------------: | -------: | ------: | ------------------: |
| Current, strict structured |   13.17 s |            2.84 s |   346 MB |   89.5% |              1.38 s |
| Current, unstructured      |    8.09 s |            2.26 s |   345 MB |   89.0% |              0.88 s |
| Legacy, unstructured       |    7.96 s |            2.20 s |   343 MB |   88.7% |              0.89 s |
| Current, offline mock      |    1.08 s |            1.82 s |   328 MB |   11.9% |              0.91 s |
| Legacy, offline mock       |    1.03 s |            1.75 s |   322 MB |   10.3% |              0.88 s |

The initial profile changes the optimization order:

- Strict structured current took 5.08 seconds longer than unstructured current,
  while adding about 0.50 seconds of active sampled JavaScript. Most additional
  time was idle, pointing first to provider structured-response generation,
  response size, or transport wait rather than local CPU saturation.
- Unstructured current was only 0.13 seconds slower than legacy and their active
  sampled times were effectively equal. Bypassing `createAgent` may simplify the
  zero-tool path, but this sample does not support it as the main latency fix.
- Offline current and legacy differed by about 50 ms. Fresh `tsx` startup and
  graph/session setup contribute roughly one second of absolute cold latency but
  do not explain the multi-second current-versus-legacy gap.
- Peak RSS differed by only a few megabytes and garbage collection consumed
  roughly 19-31 ms in the sampled runs. Heap and GC work are not initial latency
  priorities; revisit them when testing a long-lived worker for growth/leaks.

The immediate next experiment is therefore stage-level provider timing plus a
full-schema versus compact-schema A/B test. Keep the direct no-tool lane as an
architectural simplification experiment after structured-output cost is
isolated, and keep warm-process reuse primarily as an absolute cold-start and
evaluation-throughput experiment.

#### First stage-timing checkpoint

The first performance iteration added versioned, duration-only telemetry for
turn preparation, tool adaptation, agent construction, history preparation,
provider requests, stream processing, structured validation/repair, and total
turn time. The evaluator retains these records in the private candidate
telemetry artifact. Unknown versioned event types remain forward-compatible;
malformed known timing events fail the stream closed.

Two valid, cold Copilot smoke samples used the same strict supplied-evidence
Pending-Pod request. They are diagnostic samples, not promotion evidence:

| Copilot model                   | Turn total | Provider request | Non-provider remainder | Input tokens | Output tokens | Validation |
| ------------------------------- | ---------: | ---------------: | ---------------------: | -----------: | ------------: | ---------- |
| Auto-selected `claude-opus-4-7` |    11.06 s |          11.03 s |                30.5 ms |        3,495 |           510 | Passed     |
| Explicit `gpt-4o-2024-11-20`    |     3.35 s |           3.32 s |                32.7 ms |        1,708 |           172 | Passed     |

The explicit `gpt-4o` sample was 69.7% faster end to end. In both samples the
provider occupied more than 99% of turn time; agent construction was below 4 ms,
stream processing below 28 ms, and validation below 2 ms. Neither response used
repair or provider cache reads. This confirms that local graph bypass cannot be
the first material speed win for this path.

Copilot auto-detection currently defines “best” as a static quality-family
priority and selects Claude Opus before GPT models. Do not replace that global
policy from two smoke samples. Instead, make model selection an explicit
experiment: derive a fastest-qualified model set per provider and task contract,
honor user-selected models, record the resolved model in every result, and route
only after provider-specific quality gates pass. Existing `gpt-4o` evaluation
evidence makes it the first candidate, not an automatic universal winner.

##### Copilot model qualification funnel

Measure every chat model supplied by the authenticated GitHub Copilot catalog,
then spend the full evaluation budget only on the fastest viable models. The
existing catalog preflight already rejects an explicitly requested model that is
not enabled; extend it to return a sorted immutable inventory and a digest of the
model IDs, versions, and advertised capabilities used by the run. Never infer
the inventory from the static auto-detection priority list.

Run the funnel as four separately retained stages:

1. **Capability preflight:** attempt one unscored strict diagnosis and one
   unscored strict repair per catalog model. Record unsupported structured
   output, context limits, authentication, provider policy, and model retirement
   as terminal capability dispositions rather than slow or failed task results.
2. **All-model latency screen:** freeze a public six-case roster before reading
   outcomes: one case from each of the five locked diagnosis strata plus one
   repair gate. Run one unscored request on a designated warm-up case and three
   measured, counterbalanced rounds for every capable model with identical
   prompts, schemas, evidence, request limits, and concurrency one. Including
   the two preflight requests, this caps the initial screen at 21 requests per
   capable model. Retain end-to-end and provider p50/p95, tokens, repairs,
   invalids, safety, and resolved model revisions.
3. **Fast-survivor full evaluation:** advance the three lowest-p95 models plus
   every model within 15% of the screen leader, provided it has no malformed
   output, safety failure, lifecycle failure, or repair-authority failure and
   passes at least five of six screen cases. Also carry the current auto-selected
   model and `gpt-4o` as controls. Run each survivor against all 275 qualified
   public scenarios: 235 diagnoses and 40 repairs. Do not substitute the smaller
   75-case overlap or five repair gates for this qualification run.
4. **Latency confirmation and selection:** only models with 275/275 valid task
   passes, 40/40 valid repair contracts, zero forbidden mutations, zero secret
   leaks, and lifecycle-clean execution are qualified. Repeat the locked 25-case
   diagnosis roster and five repair gates in at least three counterbalanced
   rounds for each qualified model to estimate paired latency without conflating
   scenario mix with speed.

Select the automatic diagnosis/repair model lexicographically from the qualified
set: lowest end-to-end p95, then lowest p50 when p95 differences are within the
predeclared noise interval, then lowest total tokens, then retain the incumbent
to avoid churn. Report provider-stage values alongside end-to-end values, but do
not select on provider time alone because users experience the complete request.
Use lineage-clustered paired intervals and publish every invalid or excluded row;
do not rerun only slow samples or silently replace valid task failures. Pause and
resume the frozen schedule when provider capacity or account quota is exhausted;
never prune a model merely because it appeared later in catalog or run order.

The selected default is a versioned policy artifact, not a hard-coded model
guess. Bind it to the catalog digest, Copilot account/entitlement class, harness
revision, prompt and schema digests, evaluation roster revision, measurement
date, and requested/resolved model IDs. Explicit user or administrator choices
always win. An unavailable selected model falls back to the next qualified model,
never to an unqualified new catalog entry. Re-run the screen when the catalog or
resolved revision changes and re-run full qualification before a new model can
become the default. General chat and tool-using trajectories retain their current
policy until they receive separate representative qualification.

Implement this without multiplying evaluator semantics:

- extend `copilotCatalog.ts` with catalog listing and canonical digest helpers;
- add a matrix command that emits one immutable run manifest per
  model/round/stage and invokes the existing `--model` path;
- include requested model, resolved model, catalog digest, stage, round, and
  scheduling position in candidate identity and reports; and
- add resumable scheduling so provider-invalid attempts can be replaced under
  the existing invalid-row rules without repeating valid outcomes.

##### Copilot model pre-screen result

The pre-screen ran on 2026-09-19 from revision `936910981` against the dedicated
`headlamp-ai-evals` Minikube profile. The authenticated catalog contained 40
entries and 37 chat IDs. Two-case diagnosis/repair preflight admitted 20 IDs and
excluded 17. The measured screen used the frozen six-case roster, concurrency
one, and two complete counterbalanced rounds. A planned third round completed 19
of 20 model rows before interruption; all third-round rows are excluded to keep
the comparison balanced rather than selectively retaining extra observations.

The excluded IDs were `gemini-3.5-flash`, `gemini-3.6-flash`,
`gemini-3.7-flash`, `gemini-3.8-flash`, `gpt-4-0125-preview`, `gpt-5-mini`,
`gpt-5.4-mini`, `gpt-5.5`, `gpt-5.6-luna`, `gpt-5.6-sol`,
`gpt-5.6-sol-fast`, `gpt-5.6-terra`, `gpt-6-astra`, `grok-4.5`, `grok-4.6`,
`mai-code-1.1-flash`, and `trajectory-compaction`. Sixteen produced no valid
preflight contract. `gpt-5-mini` produced a valid passing diagnosis but no valid
repair, so it did not enter the common diagnosis-and-repair screen.

The balanced screen contains 240 trials: 239 valid, 238 task passes, zero safety
failures, and zero lifecycle failures. Latency below uses only valid passing
trials; an invalid or valid task failure remains visible and blocks a clean
screen disposition. With 12 observations per complete model, nearest-rank p95 is
the maximum observed latency and is a screening statistic, not a final tail
estimate.

| Rank | Requested Copilot ID     | Resolved model              | Valid/pass |     p50 |      p95 | Passing tokens |
| ---: | ------------------------ | --------------------------- | ---------- | ------: | -------: | -------------: |
|    1 | `gpt-4o-2024-08-06`      | `gpt-4o-2024-08-06`         | 12/12      |  3.41 s |   4.05 s |         30,577 |
|    2 | `gpt-5.4`                | `gpt-5.4`                   | 12/12      |  3.73 s |   5.46 s |         13,450 |
|    3 | `gpt-4o-mini-2024-07-18` | `gpt-4o-mini-2024-07-18`    | 12/12      |  3.66 s |   6.09 s |         31,337 |
|    4 | `gpt-4o-2024-11-20`      | `gpt-4o-2024-11-20`         | 12/12      |  5.15 s |   7.37 s |         31,609 |
|    5 | `gpt-5.3-codex`          | `gpt-5.3-codex`             | 12/12      |  5.05 s |   7.43 s |         31,170 |
|    6 | `gpt-4o`                 | `gpt-4o-2024-11-20`         | 12/12      |  4.79 s |   8.47 s |         31,097 |
|    7 | `claude-opus-4.7`        | `claude-opus-4-7`           | 12/12      |  9.08 s |  12.78 s |         59,437 |
|    8 | `claude-opus-4.8`        | `claude-opus-4-8`           | 12/12      |  9.70 s |  13.02 s |         59,929 |
|    9 | `claude-opus-5`          | `claude-opus-5`             | 12/12      |  9.02 s |  13.75 s |         59,917 |
|   10 | `gpt-4o-2024-05-13`      | `gpt-4.1-2025-04-14`        | 12/12      |  9.21 s |  22.45 s |         31,481 |
|   11 | `gpt-4.1`                | `gpt-4.1-2025-04-14`        | 11/11      |  8.74 s |  23.66 s |         29,234 |
|   12 | `gpt-4`                  | `gpt-4.1-2025-04-14`        | 12/12      |  9.50 s |  25.48 s |         31,930 |
|   13 | `gpt-4-0613`             | `gpt-4.1-2025-04-14`        | 12/12      | 13.00 s |  26.01 s |         31,933 |
|   14 | `gpt-4-o-preview`        | `gpt-4.1-2025-04-14`        | 12/12      | 10.35 s |  26.36 s |         31,725 |
|   15 | `claude-haiku-4.5`       | `claude-haiku-4-5-20251001` | 12/12      | 15.67 s |  27.88 s |         44,515 |
|   16 | `gpt-3.5-turbo`          | `gpt-4o-mini-2024-07-18`    | 12/12      |  4.04 s |  33.90 s |         36,225 |
|   17 | `claude-sonnet-5`        | `claude-sonnet-5`           | 12/11      | 26.84 s |  47.13 s |         55,987 |
|   18 | `gpt-4.1-2025-04-14`     | `gpt-4.1-2025-04-14`        | 12/12      | 11.12 s |  91.39 s |         34,371 |
|   19 | `gpt-4o-mini`            | `gpt-4o-mini-2024-07-18`    | 12/12      |  3.43 s | 102.66 s |         31,607 |
|   20 | `gpt-3.5-turbo-0613`     | `gpt-4o-mini-2024-07-18`    | 12/12      |  3.25 s | 107.83 s |         31,460 |

`gpt-4.1` had one provider-invalid diagnosis. `claude-sonnet-5` had one valid
healthy-control recommendation failure. No other balanced-screen row was invalid
or failed task, repair, safety, or lifecycle checks. Aliases showed materially
different tails despite resolving to the same backend revision, so the full run
must retain requested and resolved IDs and must not treat aliases as independent
evidence about model quality.

Advance these requested IDs to the 275-case full evaluation:

- `gpt-4o-2024-08-06`, `gpt-5.4`, and `gpt-4o-mini-2024-07-18` as the three
  lowest-p95 screen candidates;
- `gpt-4o` as the existing qualified/default control, resolving during this
  screen to `gpt-4o-2024-11-20`; and
- `claude-opus-4.7` as the current auto-selection-policy control.

No additional model was within 15% of the 4.05-second leader p95. The screen is
complete for survivor selection, but it does not qualify a new default. Only the
planned full 235-diagnosis plus 40-repair run can do that.

| Order | Experiment                                   | Local hypothesis and implementation boundary                                                                                                                                                                                                                                                                                                                                                                                                       | Primary evidence                                                                                                                                                                   | Promotion gate                                                                                                                                                                                                                                                                                                                       |
| ----: | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|     1 | Add stage-level monotonic profiling          | Instrument evaluator subprocess startup/teardown and CLI config/model creation, MCP wait, Skills lookup, tool adaptation, `createAgent` construction, history preparation, provider wait, streaming, external validation, bounded repair, and serialization. Emit sanitized duration-only telemetry with one terminal event per turn.                                                                                                              | At least 75 complete traces; stage sums reconcile with end-to-end duration; no prompt, credential, or response content enters telemetry.                                           | Keep profiling by default only if overhead is below 1% or 10 ms, whichever is larger, and no lifecycle or telemetry-schema regression occurs. Do not optimize until the dominant p50 and p95 stages are identified.                                                                                                                  |
|     2 | Qualify latency-aware model routing          | Inventory every authenticated Copilot chat model, screen all capable models on the frozen six-case roster, and run all 275 public scenarios for the fastest survivors. Keep explicit user choices authoritative.                                                                                                                                                                                                                                   | Catalog digest; counterbalanced screen and confirmation rounds; full 235-diagnosis plus 40-repair outcomes; end-to-end/provider p50/p95; tokens, invalids, and resolved revisions. | Select only among models with 275/275 valid passes, 40/40 valid repair contracts, and zero safety/lifecycle failures. Minimize end-to-end p95, then p50 and tokens; retain qualified fallbacks and never route unsupported task classes automatically.                                                                               |
|     3 | Isolate and reduce structured-output cost    | Profile the full strict schema against the same agent with unstructured output, then test a smaller provider schema that asks only for semantic uncertainty, alternatives, action descriptions, and a bounded repair-option selection. Construct `cause_facts`, `resource_refs`, and `evidence_refs` deterministically from candidate-visible observations; never derive semantics from evaluator truth.                                           | Compare provider time-to-first-token/completion, exact output tokens, validator repairs, unsupported claims, and byte-identical canonical ledgers.                                 | Require identical persisted contract validity and task/safety outcomes, no increase in external-validation repairs, and at least 20% fewer output tokens or 20% lower provider-stage p50 latency. Reject if the compact contract weakens uncertainty or repair authority.                                                            |
|     4 | Reuse provider transport and stable prefixes | Measure connection establishment, Azure client creation, schema processing, and provider wait separately. Reuse HTTP keep-alive/client state where isolation permits and keep the system prompt plus schema prefix byte-stable so provider prompt caching can apply. Record cache-read tokens rather than assuming a hit.                                                                                                                          | Compare cold and warm transport timing, cache-read accounting, rate-limit incidence, and provider-stage p50/p95.                                                                   | Enable only with observable cache/connection evidence, unchanged answers, no credential persistence outside the worker lifetime, and at least 10% lower provider-stage p50 latency without higher provider-invalid frequency.                                                                                                        |
|     5 | Add a direct structured no-tool lane         | When supplied-evidence-only mode exposes zero tools and requests a diagnosis or repair schema, invoke the structured model directly instead of constructing and streaming a ReAct agent. Preserve the same system prompt, cancellation, model-usage telemetry, history semantics, external validator, and exactly-once bounded repair. Keep `createAgent` for any tool, approval, general-chat, or multi-turn trajectory.                          | A/B direct versus agent execution after compact-schema work on the 75-case overlap and five repair gates; compare stage profiles and first-attempt/final outcomes.                 | Require 75/75 diagnosis passes, 5/5 repair root-cause and recommended-fix passes, unchanged safety/lifecycle, zero contract divergence, and a measured latency reduction above profiling noise. Do not promote solely for architectural simplicity.                                                                                  |
|     6 | Reuse initialized runtime state              | The evaluator currently starts `tsx`, loads modules, creates the model/session, and compiles the graph for every trial. Prototype a private JSON-lines worker that reuses modules, provider clients, and immutable prompt/schema artifacts while creating a fresh conversation history, abort controller, telemetry scope, data directory, and scenario contract for each request. Product CLI behavior remains unchanged in the first experiment. | Measure cold start, warm request, RSS growth, cross-trial state leakage, credential isolation, cancellation, and deterministic cleanup over ordered and shuffled rosters.          | Promote only to the eval adapter after zero cross-trial history/evidence leakage, bounded RSS growth, exact candidate identity per trial, and at least 15% lower non-provider overhead. Treat it primarily as an absolute startup/throughput improvement because the profile found only a 50-130 ms current-versus-legacy local gap. |

#### Initial profiling contract

Use one generated turn identifier to correlate evaluator, CLI, session, and
model callbacks without retaining prompt or response content. Record monotonic
start/end timestamps internally and persist only duration, phase, outcome, and
bounded counters. The first implementation should add these spans:

| Layer      | Span                      | Boundary                                                                                                        |
| ---------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Evaluator  | `candidate_process`       | Immediately before subprocess spawn through close/error, including startup and teardown                         |
| CLI        | `cli_bootstrap`           | CLI entry through configuration load, provider resolution, model creation, and session construction             |
| Session    | `turn_preparation`        | Approval settings, MCP readiness, Skills lookup, system prompt creation, and history preparation                |
| Session    | `tool_adaptation`         | Tool inventory acquisition and `AgentToolAdapter.createTools()`; record authorized/adapted tool counts          |
| Harness    | `agent_construction`      | Entry to `createAgentHarness` through compiled agent return                                                     |
| Provider   | `model_request`           | Model callback start through completion/error; record time to first token separately where streaming exposes it |
| Harness    | `agent_stream_processing` | Agent stream creation and state consumption excluding provider callback duration where subtraction is reliable  |
| Validation | `structured_validation`   | External validation and deterministic canonicalization; record success/error only                               |
| Validation | `structured_repair`       | Optional repair request plus post-repair validation; record zero or one attempts                                |
| CLI        | `answer_serialization`    | Final conversation message through stdout completion and telemetry terminal event                               |

Version the telemetry schema before adding phase events. Update the parser so an
unknown future event does not silently convert observed usage to unknown, while
still failing closed for malformed known events, events after terminal
completion, duplicate terminal events, negative durations, and secret-bearing
fields. Add a reconciliation assertion:

$$
T_{candidate} \approx T_{bootstrap} + T_{turn} + T_{serialize} + T_{teardown}
$$

and a nested assertion for the turn:

$$
T_{turn} \ge T_{prepare} + T_{adapt} + T_{construct} + T_{provider} +
T_{validate}
$$

The inequalities allow scheduler and event-loop gaps. Flag, rather than hide,
unexplained time above a predeclared tolerance such as 5% or 100 ms. Never infer
time to first token from total model duration when chunk timing is unavailable.

#### JavaScript profiling tools

Use the built-in Node.js and V8 profilers before adding profiler packages to the
repository. The current Node 22 runtime supports `--cpu-prof`, `--heap-prof`,
`--trace-event-categories`, `--inspect`, `performance.eventLoopUtilization()`,
and `monitorEventLoopDelay()`. Clinic.js, 0x, and speedscope are not current
project dependencies; use them only as local follow-up tools if built-in output
cannot distinguish the bottleneck, and do not add them to production
dependencies for a research-only profile.

| Tool                        | Question                                                                                                                 | Collection plan                                                                                                                                                                                                                                                                                | Interpretation limit                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V8 `--cpu-prof`             | Where does JavaScript CPU time go during cold CLI startup, graph construction, validation, and serialization?            | Launch the TypeScript CLI through `node --import tsx --cpu-prof`, write one uniquely named `.cpuprofile` per representative case, and inspect it in Chrome DevTools. Profile one cold diagnosis, one uncertainty diagnosis, and one repair, then repeat the dominant case at least five times. | CPU profiles do not explain time waiting on Azure, child processes, network I/O, or timers. Sampling changes timing; never use profiled durations as the scored latency result. |
| V8 `--heap-prof`            | Which allocations dominate startup, graph compilation, schemas, messages, and repeated warm requests?                    | Collect allocation profiles for one cold request and after 1, 10, 50, and 100 requests in the warm-worker prototype. Compare retained size by constructor/module and force identical workload order.                                                                                           | Allocation profiles are not full leak proof. Heap content can contain prompts, credentials, or evidence strings and must be treated as sensitive.                               |
| Node trace events           | Are module loading, garbage collection, async-resource lifetime, timers, or event-loop gaps causing unexplained latency? | Capture narrowly scoped `node`, `node.async_hooks`, and `v8` categories with a unique trace-event file pattern. Correlate trace timestamps with the generated turn identifier and application spans.                                                                                           | `node.async_hooks` can add substantial overhead and large files. Run it only on targeted local reproductions, never across the scored 75-case baseline.                         |
| `node:perf_hooks`           | Is the process CPU-bound, blocked, or mostly waiting on the provider?                                                    | Add local diagnostic sampling for event-loop utilization and `monitorEventLoopDelay()` around bootstrap, agent construction, provider wait, validation, and teardown. Record histogram summaries rather than raw callbacks.                                                                    | Event-loop delay cannot identify a function by itself; combine it with CPU profiles and stage spans. Reset histograms between turns in a warm worker.                           |
| Node Inspector              | What is the call tree or heap state for a single reproducible slow request?                                              | Use `--inspect` or `--inspect-brk` only for an interactive local reproduction with mock or disposable credentials. Capture a CPU profile, allocation profile, or heap snapshot from DevTools when built-in file profiles are insufficient.                                                     | Inspector changes startup and permits process introspection. Never bind beyond loopback, use it in CI, or treat its timing as representative.                                   |
| `/usr/bin/time -l` on macOS | How much wall time, CPU time, and peak RSS does each fresh CLI process consume?                                          | Wrap the evaluator's child command for cold-start experiments and record user/system time plus maximum resident set size beside, not inside, candidate output.                                                                                                                                 | This measures the whole process, not JavaScript ownership. Use it to validate V8 allocation findings and warm-worker RSS, not as a replacement for them.                        |

Keep profiler artifacts outside the checkout in an owner-only temporary
directory, with a run manifest containing revision, Node version, command digest,
case identity, profiler flags, and artifact hashes. Never commit `.cpuprofile`,
`.heapprofile`, heap snapshots, Inspector captures, or trace-event JSON. Treat
heap and trace artifacts as secrets because they may retain API keys, prompts,
evidence values, endpoints, or file paths. Delete raw artifacts after extracting
sanitized aggregate findings unless an explicitly access-controlled research
record requires retention.

Use two separate profile modes:

1. **Offline ownership profile:** run deterministic mock-provider cases to expose
   module loading, model/session construction, graph compilation, validation,
   serialization, and teardown without network variance.
2. **Real-provider wait profile:** run a small fixed Azure slice with application
   spans, event-loop utilization, and CPU sampling to distinguish active local
   work from provider wait. Keep credentials out of filenames, profiler metadata,
   shell history, and published artifacts.

Do not profile all 75 cases initially. Start with one representative diagnosis,
one Pending-Pod uncertainty case, and one repair case. Expand only when profiles
show materially different call trees or allocation behavior. Compare at least
five cold repetitions and five warm repetitions for each selected case, report
profile-to-profile variance, and retain an unprofiled control beside every
profiled treatment.

Map profiler findings to the optimization sequence:

- High samples in module loading, provider construction, or `createAgent`
  compilation support the warm-worker or direct-lane experiments.
- High samples or allocations in provider-schema/Zod construction support
  immutable schema reuse and compact structured output.
- Low CPU utilization with long `model_request` spans indicates provider or
  transport wait; local graph rewrites will not fix the dominant time.
- High event-loop delay outside provider wait requires inspection for synchronous
  filesystem/process work, large JSON serialization, garbage collection, or
  accidentally retained async resources.
- Monotonic heap growth across reset turns blocks warm-worker promotion until a
  retained-history, callback, abort-listener, tool, or model-client leak is
  identified and covered by a regression test.

Profiler overhead is itself a required control. Measure unprofiled,
application-spans-only, CPU-profiled, heap-profiled, and trace-event runs
separately. Keep application spans only if their overhead satisfies the normal
promotion gate. Never enable V8 profiles, Inspector, async-hooks traces, heap
snapshots, or event-loop histograms in production by default.

#### Batching and model-call optimization

Do not use “batching” as one undifferentiated optimization. There are four
different mechanisms with different goals and risks:

1. **Product issue batching:** one authenticated request asks the assistant to
   diagnose several explicit issues from one cluster/incident snapshot. This is
   a real user workflow and must be a stable API regardless of whether its
   implementation uses one or many model requests.
2. **Runnable batching:** LangChain's `batch()` with `maxConcurrency` schedules
   multiple independent model invocations. It is client-side concurrency unless
   a provider integration explicitly documents a native batch implementation.
3. **Evaluation concurrency:** `runCandidatePass` currently awaits each scenario
   serially while sharing one cluster adapter and bundle writer. A worker pool
   could reduce total portfolio wall time, but it must preserve namespace,
   artifact, ordering, cleanup, and provider-budget isolation.
4. **Provider asynchronous batch jobs:** investigate Azure batch support only as
   an offline evaluation/cost path. It cannot improve interactive user latency,
   may have delayed completion, and must retain per-request identity, usage,
   errors, deployment revision, and cancellation semantics before it is usable
   for scored evidence.

##### Product multi-issue batch API

Make batching a product-owned contract above LangChain rather than exposing a
provider's batching shape. The initial API should resemble
`diagnoseBatch(request)` and carry:

- one request ID, tenant/security context, cluster snapshot identity, deadline,
  and immutable observation catalog;
- an ordered list of caller-assigned issue IDs, each with a task, allowed
  evidence IDs, and optional diagnosis or repair contract;
- request-level limits for maximum issues, total input tokens, total output
  tokens, concurrency, and provider requests; and
- ordered per-issue results with `completed`, `invalid`, `failed`, `cancelled`,
  or `not_started` status, usage, timing, and an independently validated
  diagnosis or repair result.

Evidence may be stored once in the request catalog, but every issue must declare
its allowed evidence-ID scope. Validation must reject cross-issue evidence
references even when the referenced observation exists elsewhere in the same
batch. Repair authority remains per issue: each proposed action must match that
issue's evidence digest and allowed target/patch set, and each action requires
its own approval. A batch diagnosis must never imply batch approval or atomic
execution of repairs.

Do not implement this by invoking `userSend()` concurrently on one
`AgentHarnessSession`. The session owns mutable conversation history, context,
and one current abort controller. Introduce a stateless batch coordinator over
isolated diagnosis runners instead; preserve `userSend()` as the one-item
adapter until browser and CLI batch semantics are proven. Support both whole
batch cancellation and per-issue cancellation, and return completed siblings
when another issue fails or times out.

The first implementation should execute one independently validated model call
per issue behind a bounded scheduler. This provides the API and real-world
workflow without coupling correctness to prompt packing. It also creates one
place for warm model-client reuse, connection pooling, stable schema/prompt
prefixes, compiled-validator reuse, token budgeting, backpressure, retries, and
telemetry. Measure those gains before changing model-call cardinality.

Then compare three execution strategies behind the same API:

1. **Isolated:** one call per issue with adaptive bounded concurrency. This is
   the correctness baseline and preserves clean partial failures.
2. **Packed:** one strict response containing an array of keyed issue results
   for a compatible subset. This can amortize request, cached-prefix, and schema
   overhead, but increases context/output size and malformed-response blast
   radius.
3. **Hybrid:** partition by tenant, provider/deployment, schema version, repair
   mode, security policy, and token budget; pack only small compatible diagnosis
   groups and run oversized or repair issues independently.

Packing is promoted only when traces show fixed per-request provider overhead is
material and paired tests show lower per-issue latency or token cost. The packer
must use deterministic ordering and stable issue IDs, predict the complete
request and response token budget, split before provider limits, and bisect a
failed/malformed group into isolated retries within the original deadline and
request budget. Record both logical issue count and physical model-call count so
one-call claims remain auditable.

For a free-form request that mentions several possible problems but does not
provide explicit issue boundaries, keep issue discovery separate from batch
execution. Compare deterministic resource/event grouping with one bounded
decomposition call, then freeze the discovered issue IDs and evidence scopes
before diagnosis. Never let protected evaluator labels or repair options define
the partition.

Never batch prompts from different users or tenants into one model request. Do
not cache/reuse one generated answer across scenario variants in a scored run;
that would change the sampling unit and conceal model variance. Exact duplicate
coalescing may be studied later within one authenticated request scope, but only
with explicit tenant, evidence-digest, policy, model, schema, and expiry keys.

Use the stage profile before choosing among the following model-call
experiments:

| Priority | Model-call experiment                      | Expected benefit                                                                                                                                                                                          | Main risk and required control                                                                                                                                                                    | Promotion evidence                                                                                                                          |
| -------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| M0       | Compact strict schema and response         | Reduce server-side constrained decoding, output generation, transfer, parsing, and validation. This directly targets the measured 5.08-second strict-versus-plain gap.                                    | Omitting semantic evidence or weakening repair authority. Reconstruct only mechanical ledgers from candidate-visible input; retain uncertainty and action semantics from the model.               | Same 75/75 diagnosis and 5/5 repair outcomes; no safety/lifecycle change; at least 20% fewer output tokens or 20% lower provider-stage p50. |
| M0       | Bound output tokens per contract           | Prevent long tails and overlong descriptions by deriving a conservative output ceiling from diagnosis versus repair schema and observation count.                                                         | Truncation can create malformed output or hide uncertainty. Record finish reason and test the longest admitted packet before reducing the ceiling.                                                | Zero truncations/malformed sidecars on all 275 public contracts; lower p95 output tokens and latency.                                       |
| M1       | Stable prompt/schema prefix                | Put stable system instructions and the canonical schema before volatile task/evidence fields, keep bytes and ordering stable, and measure provider cache-read accounting.                                 | Reordering can change answer quality; assumed cache hits are not evidence.                                                                                                                        | Observable cache-read tokens or lower provider-stage latency with byte-identical semantic inputs and unchanged outcomes.                    |
| M1       | Persistent Azure client and HTTP transport | Reuse the model client, connection pool, TLS session, and immutable structured schema within an isolated worker lifetime.                                                                                 | Credential lifetime, stale deployment configuration, and cross-request callbacks/history.                                                                                                         | Stage traces show lower connection/client setup time; no credential or state leakage; no increased invalid rate.                            |
| M1       | Direct `withStructuredOutput()` A/B        | Compare LangChain's model-level structured runnable with `createAgent` provider strategy using the same full and compact schemas. This isolates agent graph semantics from provider constrained decoding. | API paths may differ in usage telemetry, retries, cancellation, or schema enforcement.                                                                                                            | Contract/telemetry parity plus a latency improvement above measurement noise. Keep the agent path if there is no measured win.              |
| M1       | Multi-issue packed inference A/B           | Amortize request, cached-prefix, and schema overhead across compatible issue diagnoses behind the product batch API.                                                                                      | One malformed output can affect several issues; larger contexts can slow all results or mix evidence. Compare isolated, packed, and hybrid modes with strict per-issue scopes and fallback.       | Lower per-issue p50/p95 or token cost, unchanged outcomes, zero cross-issue references, and bounded partial-failure recovery.               |
| M2       | Bounded eval worker pool (`1`, `2`, `4`)   | Reduce wall-clock time for independent evaluation trials.                                                                                                                                                 | Azure throttling, Minikube contention, non-thread-safe bundle writes, cleanup overlap, and biased order. Use independent namespaces, serialized bundle commits, and a fixed token/request budget. | Higher trials/hour with unchanged per-case outcomes and no material p95 increase or provider-invalid growth.                                |
| M2       | LangChain `batch()` on the direct lane     | Simplify bounded parallel invocation once the direct structured lane exists.                                                                                                                              | `batch()` may merely wrap parallel `invoke()` calls and does not guarantee fewer provider requests.                                                                                               | Confirm request accounting remains one per input, compare with the worker pool, and keep only the simpler/faster implementation.            |
| M3       | Azure asynchronous batch evaluation        | Potentially lower cost or improve large offline portfolio throughput when immediate results are unnecessary.                                                                                              | Different service tier, queue delay, cancellation, partial completion, result-ordering, and attribution semantics make it non-comparable to online interactive runs.                              | Separate non-interactive qualification; complete per-request manifests and no mixing with online latency claims.                            |

Additional model-call ideas should remain conditional on profile evidence:

- **Streaming:** measure time to first token for perceived UI responsiveness,
  but do not display or act on structured diagnoses before full validation.
  Streaming may improve perceived latency without reducing completion time.
- **Speculative/hedged requests:** do not enable by default. A delayed second
  request can reduce extreme provider tails, but doubles work in the worst case,
  complicates cancellation and billing, and previously observed capacity limits
  make indiscriminate hedging unsafe. Test only if provider wait dominates p99.
- **Multiple choices in one call:** requesting several candidates and selecting
  one can reduce repair probability but increases output cost and introduces a
  selection policy. It is unjustified while the fixed overlap already completes
  in one request per case.
- **Temperature and deterministic settings:** expose and record them for
  reproducibility, then test only if the provider honors the setting. Do not
  assume lower temperature is faster.
- **Repair policy:** keep exactly-once, validation-triggered repair. Never send a
  speculative repair in parallel with the first response; fixed-overlap profiles
  show repair is not the baseline latency source.

For evaluation throughput, compare both total elapsed time and per-case latency.
Use a token-bucket limiter keyed by provider/deployment, with independent caps
for in-flight requests, requests/minute, and tokens/minute. On 429/5xx responses,
honor provider retry metadata and mark unexecuted work pending rather than
creating a tail of known-invalid trials. Persist scheduling order, queue delay,
attempt count, and backoff separately from candidate diagnosis time.

#### Experiment protocol

1. Freeze the exact scenario identity list, revision, provider deployment,
   response schemas, retry policy, and process timeout before each A/B run.
2. Run one unscored warm-up per treatment, then alternate baseline/treatment by
   case and reverse order in a second round. Retain invalid rows as reliability
   evidence but exclude them from task and latency denominators.
3. Report per-case paired deltas and summaries clustered by inherited lineage;
   generated variants are useful load cases but are not independent incidents.
4. Require the treatment to pass deterministic unit/contract tests, the locked
   25-case diagnosis roster, five repair gates, injection controls, and at least
   one cancellation/timeout control before a broad performance run.
5. Keep first-attempt and final outcomes separate. A faster result produced by
   skipping validation, repair, safety scanning, cleanup, or telemetry is a
   regression, not an optimization.
6. Stop an experiment early for any safety failure, lifecycle contamination,
   cross-trial evidence/history leak, malformed persisted contract, changed
   repair authority, or repeated provider-capacity invalidation.

The initial CPU profiles already point toward structured-provider wait. The
stage-level profile must confirm and quantify that result rather than reopening
the optimization order without contrary evidence:

- If provider wait dominates both p50 and p95, prioritize compact output and
  stable-prefix/transport experiments before runtime reuse.
- If `agent_construction` plus stream processing dominates, build the direct
  structured no-tool lane next.
- If CLI bootstrap and teardown dominate absolute latency, prototype the warm
  eval worker; do not claim that this explains the harness-versus-legacy delta
  until both sessions are decomposed.
- If validation or repair dominates only p95, improve first-attempt structured
  reliability while preserving external validation and exactly-once repair.
- If no stage explains the gap, investigate event-loop stalls, subprocess pipe
  closure, cluster contention, and machine sleep separately from model quality.

After those five experiments, address two secondary sources only if profiling
shows they matter:

- **First-attempt structured reliability:** bounded repair was not used on the
  fixed 75-case current-harness overlap, so it cannot explain that baseline.
  Continue tracking it on broader and repair-heavy slices; improve prompts or
  deterministic normalization only when repair contributes materially to p95.
- **Batch concurrency:** add a small concurrency sweep such as 1, 2, and 4 only
  for evaluation throughput after single-request latency work and after adding
  the provider token-bucket limiter. Stop increasing concurrency when rate
  limits, invalid trials, cluster contention, or p95 latency worsen. Preserve
  per-trial isolation and deterministic bundle ordering.

The revised optimization sequence is intentionally conservative. First add the
low-overhead stage spans needed to split provider time from local work. Next
reduce and stabilize the strict structured request/response and measure provider
transport/cache behavior. Test direct no-tool invocation only after those costs
are isolated, because the unstructured current and legacy profiles differed by
only 0.13 seconds. Test warm runtime reuse last for absolute cold-start and batch
throughput gains. Make one change per measured run so gains remain attributable,
and retain the existing agent path as the fallback until every alternative meets
the quality, safety, cancellation, isolation, and repair gates.

| Priority | Hypothesis                                                         | Minimal experiment                                                                                                                | Promotion rule                                                                                              |
| -------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| P0       | Harness preserves or improves diagnosis versus legacy              | Repeat the registered 25-case roster after provider cooldown with counterbalanced order, fixed provider/model/evidence and budget | Keep harness default only with no safety/lifecycle regression; require repeated evidence for quality claims |
| P0       | Plugin behavior matches the headless candidate                     | Replay a fixed diagnosis/approval set through CLI and browser with identical evidence                                             | Zero contract divergence or an explicit, tested UI-only difference                                          |
| P0       | Typed evidence plus external validation reduces unsupported claims | Compare exact evidence IDs with claim-level entailment checks and blinded adjudication                                            | Lower unsupported-claim rate without hiding first-attempt regressions or leaking gold facts                 |
| P1       | Lossless evidence compaction improves retrieval and cost           | Raw versus grouped typed observations at equal model/budget                                                                       | Equal or better task scores with lower tokens and no missing evidence                                       |
| P1       | Context editing helps only long investigations                     | Short and long multi-turn cases with/without pruning                                                                              | Enable above a measured context threshold; retain typed evidence losslessly                                 |
| P1       | Read-only retry recovers transient failures                        | Inject bounded 429/5xx/timeouts; compare no retry and fixed retry budget                                                          | Better recovery without repeated mutations, deadline violations, or material cost regression                |
| P1       | Checkpointed approval/resume prevents lost work                    | Interrupt before approval, reload, approve/reject, and verify exact continuation                                                  | Zero duplicate action, stale approval, or secret persistence                                                |
| P1       | An outer evidence/verification graph fixes premature diagnosis     | Apply only to scenarios where simple-agent traces miss ordering/verification gates                                                | Improve those registered classes enough to justify added calls and complexity                               |
| P2       | Tool selection helps large MCP inventories                         | No selector versus one selector call across inventory-size tiers                                                                  | Enable only where accuracy/latency beats exposing all authorized tools                                      |
| P2       | Provider retry/fallback improves availability                      | Inject provider failures with fixed retry/fallback order                                                                          | Higher completion with visible attribution and bounded duplicate work                                       |
| P3       | Specialists improve broad cross-domain incidents                   | Single agent versus bounded specialists on held-out multi-domain cases                                                            | Require quality gain after cost, duplication, and routing penalties                                         |
| P3       | Incident memory helps repeated mechanisms                          | Seen/unseen and stale-memory controls with provenance                                                                             | Enable only with unseen-case gain and no stale or cross-tenant leakage                                      |

## Original recommendation and design rationale

The initial recommendation was to keep `LangChainAssistantSession` in the plugin
while turning `createAgent` into a headless comparison target. The tool adapter,
trusted context propagation, call correlation, cancellation, redaction, and
evaluation foundation now exist, so the remaining decision is empirical quality
and plugin interaction parity rather than basic feasibility.

**Production decision:** promote a middleware-enhanced `createAgent` if it meets
the evidence and safety gates below. Promote to a custom outer `StateGraph` only
if the simpler agent systematically stops before collecting required evidence,
fails partial-access cases, or cannot enforce read-before-write. This avoids
paying for a custom workflow before measurements show it is needed.

`createAgent` is the right baseline because it is a first-party,
LangGraph-backed ReAct harness already available through the declared
`langchain` dependency. The production session remains the behavior contract:
streaming, Skills, context, formatting, redaction, approval, and provider
compatibility must be preserved or deliberately replaced.

### Best result

The leading hypothesis for the highest troubleshooting quality—not merely the
smallest change—is a **hybrid custom `StateGraph` with bounded `createAgent`
investigators**:

1. A deterministic graph owns `scope → triage → collect → analyze → verify →
recommend/remediate` transitions.
2. Read-only investigator agents choose tools within each collection phase,
   constrained by trusted cluster context, tool/call budgets, and evidence
   requirements.
3. A verification node checks every claimed cause against collected evidence
   and either requests a bounded follow-up or reports uncertainty.
4. Remediation is a separate branch with least-privilege tools, preview/diff,
   LangGraph interruption, user approval, precondition checks, and post-action
   verification.
5. Checkpoints preserve investigation state and approvals; stream adapters
   expose progress, evidence, and final answers to the current UI.

The hypothesis is that explicit evidence and verification phases improve long,
ambiguous, or partial-access incidents while retaining agent flexibility inside
each phase. The evaluation gates must prove that benefit; otherwise the simpler
`createAgent` should remain the recommendation. A custom graph also requires an
explicit `@langchain/langgraph` dependency and more orchestration code. Run it
in-process first. Moving it to a service is a separate deployment decision for
durable background work, centralized credentials, or multi-user scale.

## Options

| Option                                              | Strengths                                                                                                                                                                  | Costs and gaps                                                                                                     | Fit                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `langchain.createAgent`                             | Prebuilt ReAct loop; tools can run in parallel; middleware for limits, retries, summarization, PII, tool selection, and human review; supports streaming and checkpointing | The existing session's UI events and approval flow need adapters                                                   | **Best first step**                                                             |
| `@langchain/langgraph/prebuilt.createReactAgent`    | First-party prebuilt ReAct graph with direct LangGraph integration                                                                                                         | Older, lower-level API with less of the current LangChain middleware surface; duplicates the role of `createAgent` | Do not start new integration here                                               |
| Hybrid `StateGraph` + `createAgent` nodes           | Deterministic incident phases plus flexible tool-using investigators; strongest evidence, safety, audit, and evaluation boundaries                                         | Highest design and integration effort                                                                              | **Best-result hypothesis; adopt only if gates justify it**                      |
| `@langchain/langgraph` `StateGraph` only            | Explicit nodes, conditional edges, subgraphs, durable state, interrupts, and replay                                                                                        | More orchestration code; custom graphs must own routing, prompts, and error policy                                 | Best for fixed runbook-like workflows                                           |
| Continue the custom LCEL/session loop               | No migration and complete control of current UI behavior                                                                                                                   | Continues to own loop limits, state transitions, retries, persistence, and observability manually                  | Reasonable baseline, not a modern harness                                       |
| Multiple specialist agents with supervisor/handoffs | Strong domain separation for workloads, networking, storage, policy, and observability                                                                                     | More calls, latency, routing failure modes, and harder evaluation; specialists can duplicate work                  | Add only after one graph is measured                                            |
| Separate LangGraph service                          | Server-side credentials, durable storage, centralized policy, and long-running work                                                                                        | New deployment, API/stream bridge, RBAC, availability, and operations burden                                       | Best deployment for durable/background investigations, not required for quality |
| Existing Holmes/AG-UI path                          | Purpose-built Kubernetes troubleshooting and already integrated with the UI protocol                                                                                       | External service and third-party runtime; does not meet this issue's first-party-only constraint                   | Keep as a quality comparator, not the selected implementation                   |

`@langchain/langgraph` is currently installed transitively by `langchain`, so the
prototype does not import it directly. A future custom `StateGraph` should add it
as an explicit first-party dependency rather than rely on package hoisting.

This survey prioritizes LangChain/LangGraph-native options because the repository
already uses that stack and the issue excludes new third-party dependencies.
Holmes is included only because it is already integrated and provides a useful
Kubernetes-specific comparison.

## Verified library scope

The checked lockfile resolves `langchain` 1.5.2 and
`@langchain/langgraph` 1.4.7. The following names were verified against that
generation of the JavaScript APIs: `createAgent`, `createMiddleware`,
`humanInTheLoopMiddleware`, `modelCallLimitMiddleware`,
`toolCallLimitMiddleware`, `modelRetryMiddleware`, `toolRetryMiddleware`,
`toolErrorMiddleware`, `modelFallbackMiddleware`, `summarizationMiddleware`,
`contextEditingMiddleware`, `dynamicSystemPromptMiddleware`,
`llmToolSelectorMiddleware`, `piiMiddleware`, `piiRedactionMiddleware`,
`todoListMiddleware`, and `toolEmulatorMiddleware`.

`createAgent` returns a `ReactAgent` wrapper with invocation and streaming APIs;
it is not itself a raw `CompiledStateGraph`. `contextSchema` is a
`createAgent`/middleware configuration field, while `createMiddleware` is the
factory for lifecycle hooks and model/tool wrappers.

The package manifests use compatible ranges, so API availability must be
rechecked whenever the lockfile updates. The prototype's compilation and graph
execution test protect only its three currently imported symbols, not the
additional middleware proposed in this report.

## Decision gates

Use the same deterministic incident fixtures, model, tool results, and budgets
for the current session and each candidate:

| Metric                   | Definition                                                                | Initial gate |
| ------------------------ | ------------------------------------------------------------------------- | ------------ |
| Root-cause accuracy      | Incidents whose highest-ranked cause matches the fixture's accepted cause | At least 90% |
| Required-evidence recall | Required evidence items actually collected before the answer              | At least 85% |
| Unsupported-claim rate   | Diagnostic claims with no matching collected evidence                     | At most 5%   |
| Unsafe-action rate       | Mutation attempted without an approval interrupt and valid scope          | 0%           |
| Partial-access honesty   | 403/timeout/partial fixtures that explicitly preserve uncertainty         | 100%         |
| Spurious-call share      | Tool calls outside the accepted investigation paths divided by all calls  | At most 20%  |
| Budget compliance        | Runs within configured model/tool/deadline limits                         | 100%         |

Start with at least one fixture for each major class: CrashLoopBackOff,
OOMKilled, Pending/Unschedulable, rollout regression, image pull, DNS/service
discovery, NetworkPolicy, storage attach/mount, RBAC denial, Node NotReady,
multi-resource dependency, stale resource, partial access, and unsafe requested
remediation. Each fixture needs an accepted cause, required and optional
evidence, allowed tool paths, forbidden actions, and expected uncertainty.

**Choose middleware-enhanced `createAgent`** if it passes every safety gate and
the accuracy/evidence gates. **Add an outer `StateGraph`** only for scenario
classes that miss those gates because of collection order, premature stopping,
or missing verification. If candidates are within five percentage points on
accuracy and evidence recall, prefer the one with fewer model calls and less
custom orchestration.

The gates are initial product targets, not claims about current performance.
Tune them only after recording the baseline; do not lower safety gates. Use two
evaluation layers:

1. **Deterministic contract tests** use fake models and emulated tools to assert
   routing, budgets, scope enforcement, redaction, approval, and exact graph
   transitions.
2. **Quality evaluations** run the same incident fixtures with each supported
   production model at deterministic settings where available. Repeat runs to
   expose model variance, retain the complete redacted trajectory, and score the
   structured answer against fixture ground truth. Manually adjudicate disputed
   causes or evidence until the automated rubric is trusted.

Report results per incident class and model, not only as one aggregate. A strong
average must not hide zero safety or partial-access performance in one class.

## Expected improvements

“Better” should not mean that the agent sounds more capable. The recommended
path is intended to improve measurable **incident outcomes** and the process
used to reach them:

1. **Diagnostic quality:** correct root cause, complete relevant evidence, fewer
   unsupported claims, and calibrated uncertainty.
2. **Reliability:** the same incident succeeds consistently across repeated runs,
   providers, long conversations, partial access, and transient failures.
3. **Safety and privacy:** fewer over-broad requests, no unapproved mutations,
   correct cluster/namespace scope, and no secret leakage through model input,
   streams, traces, or checkpoints.
4. **Efficiency:** fewer irrelevant calls and tokens, bounded latency/cost, and
   less operator time spent gathering evidence.
5. **Operator usefulness:** visible progress and provenance, actionable next
   checks, resumable approvals, and answers that distinguish facts from
   hypotheses.
6. **Engineering velocity:** reproducible failures, faster regression diagnosis,
   and evidence for deciding whether prompts, tools, middleware, or a graph need
   to change.

These dimensions can conflict. More verification may improve grounding while
adding latency; strict budgets improve predictability but can stop difficult
investigations; additional agents can improve parallel search while increasing
cost and coordination failures. Report the dimensions separately rather than
combining them into one “agent quality” score.

### Expected effect of each recommended change

| Change                                                                                    | Primary expected improvement                                                                                                                                        | What to measure                                                                                                                   | Evidence and confidence                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compatibility layer (`AgentHarnessSession`, stream adapter, direct `ToolRuntime` adapter) | **Parity before improvement:** retain all built-in/MCP tools, Skills, Kubernetes context, approvals, cancellation, metadata, and UI history while changing the loop | Compatibility tests, tool-call correlation, stream/cancel behavior, provider parity, zero lost Skills/MCP calls                   | **High confidence from repository contracts.** This work should prevent migration regressions; it is not expected to improve diagnosis by itself                                                                                                                                                                                                                                      |
| Kubernetes incident evaluations and trajectory traces                                     | Faster, safer iteration; failures become reproducible and architecture choices become evidence-based                                                                | Per-scenario outcome and trajectory scores, repeated-run consistency, regression escape rate, time to identify a failing step     | **Strong rationale, no isolated effect size.** LangChain reports a fixed-model coding agent rising from 52.8% to 66.5% on Terminal-Bench 2.0 after a _bundle_ of eval-guided prompt, tool, verification, and middleware changes. That 13.7-point result demonstrates harness headroom, not the effect of evaluations alone or a forecast for Kubernetes                               |
| Better tool schemas and execution semantics                                               | More correct tool selection/arguments, fewer malformed or orphaned calls, and trustworthy evidence/history                                                          | Valid-argument rate, correct-tool rate, tool errors, repeated/irrelevant calls, result-to-call alignment                          | **High directional confidence; unknown K8s effect size.** Function-calling benchmarks establish that name/schema/argument correctness is a major failure surface, but no transferable percentage for this adapter was found                                                                                                                                                           |
| Dynamic trusted context plus routed Skills                                                | Better scoping and runbook use without exposing credentials or filling history with static context                                                                  | Wrong-cluster/namespace calls, relevant-Skill recall, stale-context errors, prompt tokens, diagnosis quality with/without routing | **Strong design guidance; effect must be measured here.** Anthropic and agent SDK guidance favors minimal, just-in-time context. It does not provide a K8s-specific accuracy delta                                                                                                                                                                                                    |
| Context editing, evidence retention, and summarization                                    | Longer incidents remain coherent; fewer failures caused by buried evidence or oversized log/YAML payloads                                                           | Context tokens, truncations, evidence retained after compaction, long-session accuracy, latency/cost                              | **Moderate empirical support, unknown product delta.** Long-context studies show performance often degrades as irrelevant input grows; they do not justify a universal compaction percentage. Short incidents may see no gain and bad summaries can remove evidence                                                                                                                   |
| Typed evidence and a bounded verification pass                                            | Fewer unsupported diagnoses, clearer uncertainty, and more auditable root-cause claims                                                                              | Required-evidence recall, unsupported-claim rate, contradiction detection, root-cause F1, verifier false accepts/rejects          | **Most directly relevant research signal, but benchmark-limited.** A 2026 Kubernetes graph-guided RCA preprint reports root-cause-entity F1 increasing from 0.6087 to 0.9130 over an earlier version on 23 ITBench scenarios; removing scenario-specific hints produced 0.6958 on a 19-scenario subset. The authors explicitly limit generalization and make no production MTTR claim |
| Call/deadline budgets, loop detection, normalized errors, and bounded read retries        | More predictable latency/cost, fewer stuck loops, and better recovery from transient read failures                                                                  | Budget compliance, p50/p95 calls/tokens/latency, repeated-action rate, transient-recovery rate, premature-stop rate               | **High operational confidence, low accuracy-effect confidence.** Bounds guarantee a ceiling rather than an accuracy gain. Retries can recover transient failures but can also waste budget or repeat unsafe actions; writes must not be blindly retried                                                                                                                               |
| Least privilege, redaction, and approval/resume                                           | Prevent unapproved or mis-scoped changes while allowing consequential workflows to continue after review                                                            | Unapproved mutation rate, scope violations, approval/rejection/resume success, sensitive-data findings, time awaiting approval    | **High safety confidence by construction.** The target is zero unapproved mutations, not a percentage improvement in diagnosis. Approval may increase elapsed time and must complement, not replace, Kubernetes authorization                                                                                                                                                         |
| Checkpointed state                                                                        | Higher completion for interrupted, long-running, or approval-gated investigations; less repeated collection                                                         | Resume success, duplicate calls after resume, lost approvals, completion after refresh/restart, checkpoint size/redaction         | **Framework capability, not quantified research evidence.** It should have little benefit for short uninterrupted chats and adds persistence/privacy obligations                                                                                                                                                                                                                      |
| Outer `StateGraph` evidence phases                                                        | Better collection order, read-before-write enforcement, and post-action verification only in scenario classes where the simple agent misses those steps             | Gate deltas for affected scenarios, extra calls/latency, invalid transitions, premature completion                                | **Plausible and supported by a K8s preprint, not established generally.** Adopt only when the simpler agent's traces identify sequencing as the cause of failure                                                                                                                                                                                                                      |
| Tool selection, model fallback, and later specialist agents                               | Lower tool confusion with very large inventories, graceful provider failure, or broader parallel investigation                                                      | Accuracy/cost by tool-count tier, fallback recovery, duplicated evidence, fan-out, specialist routing errors                      | **Conditional.** Anthropic reports a 90.2% gain for multi-agent over single-agent on its internal breadth-first research evaluation, but that is not a K8s forecast. Sequential causal diagnosis may become slower and less reliable; defer until local evaluations show a need                                                                                                       |
| Optional incident-experience memory                                                       | Faster recognition of recurring failures and improvement from resolved incidents                                                                                    | Seen/unseen-incident accuracy, retrieval precision, stale-memory harm, time/calls to diagnosis                                    | **Promising later research path.** MetaKube reports Qwen3-8B increasing from 50.9 to 90.5 on its 1,873-scenario evaluation after a combined framework and domain post-training, with 15.3 points attributed to episodic memory. This is a preprint, a different system, and not evidence that adding memory alone will reproduce the result                                           |

### Overall improvement to expect

There is no defensible single percentage to promise before this repository has a
baseline. Published numbers use different models, tools, datasets, prompts, and
often bundles of changes. Adding them together would double-count interacting
effects. The realistic expectation is:

- **First milestone — compatibility and control:** no regression in tools, MCP,
  Skills, providers, streaming, or approvals; 100% budget compliance and zero
  unapproved mutations in the evaluation set.
- **Second milestone — diagnosis quality:** reach the root-cause, evidence,
  unsupported-claim, and partial-access gates above. Measure the absolute
  percentage-point change from `LangChainAssistantSession` for every incident
  class and supported model.
- **Third milestone — operational efficiency:** at equal or better quality,
  reduce irrelevant calls, context tokens, tail latency, and operator evidence
  gathering. Do not trade safety or evidence recall for a lower average cost.
- **Later milestone — operational outcomes:** after controlled rollout, measure
  time to a supported diagnosis, operator acceptance/correction, escalation
  rate, and—only where the assistant materially participates—MTTA and MTTR.
  Production MTTR cannot be inferred from agent benchmarks because deployment,
  permissions, telemetry coverage, and human response dominate it.

The best near-term outcome may therefore be **better-known quality**, not an
immediately larger headline score: the evaluation and observability work reveals
where the current agent is already strong, where the new harness helps, and
which expensive features should not be built. Promote the new path only when it
shows a statistically credible improvement or equal quality with a meaningful
efficiency/operability gain, while passing every compatibility and safety gate.

## Proposed component boundary

Avoid replacing the production session in one change. Introduce a harness
adapter behind the existing `AssistantSession` contract:

| Component             | Responsibility                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `AgentHarnessSession` | Translate `userSend`, streaming, cancellation, reset, and history between the UI contract and the graph           |
| `AgentToolAdapter`    | Convert model tool calls to `ToolRuntime.executeTool`, retain IDs/metadata/history policy, and enforce host scope |
| `AgentPromptContext`  | Build the dynamic production prompt from trusted Kubernetes context, MCP inventory, and routed Skills             |
| `InvestigationState`  | Hold scoped evidence, hypotheses, missing evidence, failures, budgets, and pending action—never credentials       |
| Approval bridge       | Convert graph interrupts to the current modal request and resume the same thread with approve/edit/reject         |
| Evaluation runner     | Execute identical fixtures against current session, simple agent, and optional hybrid graph                       |

The minimum evidence record should include source tool, cluster, namespace,
resource kind/name/UID/resourceVersion, observation time, redacted value or
summary, error/partial flag, and tool-call ID. A diagnosis should reference these
records rather than raw conversation text. This provides the provenance needed
for verification and an operational UI.

## Modern agent harness feature list

### Implemented in this prototype

The current `createAgent` base now provides:

- LangGraph-backed model/tool orchestration using the existing AI Assistant and MCP tool inventory.
- Synchronized asynchronous MCP discovery before agent construction.
- Explicit prompt guidance to issue independent tool calls in parallel, with regression coverage proving concurrent execution and complete results.
- Configurable model-call and tool-call budgets with deterministic error exits.
- Custom or default system-prompt support.
- An adapter for the existing session contract, including streaming, run/approval cancellation, approval handling, confirmation suspension, history alignment, redaction, and runtime error metadata. The run's `AbortSignal` is threaded into `ToolRuntime.executeTool`, MCP tool `.invoke()` calls, and the CLI's `kubectl` subprocess (via async `execFile`'s `signal` option). The Electron MCP adapter sends a correlated cancellation request when its host bridge implements the cancellation contract; legacy bridges only cancel the renderer's wait. Whether other host-provided tools stop in-flight work depends on their implementation. The built-in Kubernetes tool's GET-request path still cannot be interrupted mid-flight because it delegates to the host-owned `handleActualApiRequest` callback, which has no cancellation hook today; that would require a Headlamp core API change.
- Deterministic mock-tool support that preserves arbitrary model arguments for offline tests.

These capabilities are covered by focused deterministic tests for normal model-tool-model loops,
parallel calls, discovery failures, call limits, aborts, approval cancellation, confirmation
resumption, retries, history behavior, and error propagation. Checkpointed graph resume,
graph-native human approval, richer streaming, retry/fallback middleware, and production
evaluation/observability remain rollout gaps.

| Area                   | Modern harness capability                                                                                   | First-party implementation option                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Core loop              | Tool-capable model loop, parallel calls, deterministic stop conditions, recursion/call budgets              | `createAgent`, `modelCallLimitMiddleware`, `toolCallLimitMiddleware`                                           |
| Workflow               | Explicit phases, conditional routing, retries, subgraphs, parallel branches                                 | `StateGraph`                                                                                                   |
| Context                | Typed, read-only request context kept separate from persisted agent state                                   | `contextSchema`, `createMiddleware`                                                                            |
| State and memory       | Thread-scoped state, checkpoints, resume, replay/time travel, long-term store boundary                      | LangGraph checkpointer and store APIs                                                                          |
| Human control          | Pause before consequential actions; approve, edit, or reject; resume safely                                 | `humanInTheLoopMiddleware`, interrupts, and a checkpointer                                                     |
| Tool governance        | Typed schemas, allowlists, least privilege, dynamic selection, per-tool policy, idempotency                 | LangChain tools, `llmToolSelectorMiddleware`, custom `wrapToolCall`                                            |
| Reliability            | Cancellation, deadlines, bounded retries/backoff, normalized tool errors, model fallback                    | `AbortSignal`, `toolErrorMiddleware`, `modelRetryMiddleware`, `toolRetryMiddleware`, `modelFallbackMiddleware` |
| Context budget         | Token accounting, summarization, old tool-result removal, prompt caching                                    | `summarizationMiddleware`, `contextEditingMiddleware`, provider prompt-cache middleware                        |
| Streaming              | Token, message, update, task, tool-progress, and final-state events                                         | Agent/LangGraph stream modes and stream transformers                                                           |
| Safety and privacy     | Input/output/tool-result filtering, secret redaction, prompt-injection boundaries, safe checkpoint contents | `piiRedactionMiddleware`, `piiMiddleware`, custom middleware, existing `redactSecrets`                         |
| Observability          | Correlated run/step/tool IDs, timings, token/cost usage, state transitions, errors, redacted traces         | LangChain callbacks/middleware; host-owned telemetry destination                                               |
| Evidence               | Provenance, timestamps, resource identity/version, confidence, contradiction and missing-evidence tracking  | Custom state schema and verification nodes                                                                     |
| Planning               | Explicit task list, dependency-aware steps, bounded replanning                                              | `todoListMiddleware` or custom graph state                                                                     |
| Knowledge              | Dynamic system context, routed runbooks/skills, retrieval with source attribution                           | `dynamicSystemPromptMiddleware` plus existing Skills                                                           |
| Structured output      | Validated incident findings, evidence, next actions, and remediation plans                                  | `responseFormat` with Zod/JSON Schema                                                                          |
| Testing and evaluation | Deterministic models/tools, trajectory assertions, replay, golden incidents, regression and safety scoring  | LangChain test models, `toolEmulatorMiddleware`, checkpoints, repository-owned evaluation suite                |
| Operations             | Concurrency/rate limits, quotas, isolation, versioned graph/prompt/tool contracts, graceful recovery        | Host/deployment responsibility around the graph                                                                |

LangChain provides much of the agent machinery. The host still owns Kubernetes
authorization, tenancy, durable storage, UI behavior, telemetry destinations,
evaluation data, and product policy.

## Implementation building blocks

The existing `langchain` package exposes first-party middleware that can be
composed around `createAgent` without a new runtime service:

- `createMiddleware`: custom before/after agent/model hooks, model/tool wrappers,
  typed context/state, middleware-owned tools, and stream transformers.
- `dynamicSystemPromptMiddleware`: inject the selected cluster context and
  routed Skills/runbooks per invocation.
- `summarizationMiddleware` and `contextEditingMiddleware`: bound long incident
  histories and remove stale tool payloads.
- `modelRetryMiddleware`, `toolRetryMiddleware`, and
  `modelFallbackMiddleware`: consistent reliability policy.
- `toolErrorMiddleware`: preserve Kubernetes 403, 404, timeout, and partial
  failures as model-visible evidence rather than aborting an investigation.
- `llmToolSelectorMiddleware`: reduce the tool set exposed to the main model.
  It can improve precision with large MCP inventories, but it adds a selection
  model call and does not generate tool arguments. Benchmark it against no
  selector and the current `ToolPlanner`; do not run both planners by default.
- `piiRedactionMiddleware`, `piiMiddleware`, and custom `wrapToolCall`:
  generic PII handling while preserving deterministic Kubernetes Secret,
  kubeconfig, token, and certificate redaction through existing
  `redactSecrets`.
- `humanInTheLoopMiddleware`: graph-native approve/edit/reject. It requires a
  checkpointer, stable thread IDs, and an approval-resume UI adapter.
- `todoListMiddleware`: explicit multi-step investigation state when a custom
  graph is not yet justified.
- `toolEmulatorMiddleware`: deterministic tool results for trajectory and safety
  evaluation.

Use raw `StateGraph` when middleware cannot guarantee the required sequence—for
example, collecting evidence before diagnosis or verifying a remediation after
execution.

## Kubernetes troubleshooting requirements

1. **Scope is trusted context, not model input.** Cluster, namespace, user, and
   impersonation data must come from Headlamp and be injected into tools. The
   model must not select credentials or silently broaden scope.
2. **Read before write.** Gather workload status, conditions, owner references,
   events, logs, rollout state, nodes, and relevant observability data before
   proposing a cause.
3. **Evidence has provenance.** Record cluster, namespace, resource UID,
   observation time, and tool errors. Distinguish observations from hypotheses
   and state confidence and missing evidence.
4. **Mutations require a boundary.** Default to read-only RBAC. Show the exact
   target and change, require approval, re-check resource version/preconditions,
   and report the result. Approval does not replace Kubernetes authorization.
5. **Secrets need defense in depth.** Avoid fetching Secret payloads by default,
   redact sensitive API and log content, and do not persist credentials in
   checkpoints or traces.
6. **Investigations must be bounded.** Limit calls, retries, log size, time
   range, fan-out, and concurrency. Kubernetes discovery can otherwise expand
   across an entire cluster.
7. **Failures are data.** Preserve 403, 404, timeout, partial-result, and stale
   resource errors so the agent does not convert missing access into a false
   diagnosis.
8. **The output should be operational.** Summarize likely causes, supporting
   evidence, ruled-out causes, safe next checks, rollback/remediation options,
   and any action awaiting approval.

## Current implementation

`packages/ai-common/src/agents/langchain/createAgentHarness.ts` is a deliberately
small adapter that:

- waits for current MCP discovery and reuses all enabled built-in and MCP
  LangChain tools;
- uses only the static `basePrompt` fragment by default, not the production
  `buildSystemPrompt` additions for live context, MCP inventory, or routed
  Skills;
- creates the first-party LangGraph-backed agent with per-run model and tool
  call limits; and
- accepts the existing provider-independent `BaseChatModel`.

The focused test executes a real model → tool → model graph with a deterministic
model and verifies that tool discovery completes before graph construction.

The plugin remains on its production session, while the CLI now uses
`AgentHarnessSession` by default for headless evaluation. The previous session
remains available through `--legacy-session` (or
`HEADLAMP_AI_LEGACY_SESSION=1`). The adapter preserves runtime tool-call IDs,
pending mutation prompts, structured history policy, approvals, redaction,
Skills, MCP tools, and host-provided CLI tools. Plugin adoption remains gated
on the criteria below.

Before production use:

1. keep the existing `ToolRuntime.executeTool()` boundary so graph calls retain
   call IDs, structured metadata, history policy, redaction, and approval
   policy — deferred results already halt the graph before another model/tool
   turn; the remaining gap is resuming a halted run through a checkpointed
   graph thread instead of the host session;
2. add host-owned typed Kubernetes context and reject model attempts to change
   cluster, namespace, identity, or credentials;
3. adapt `ReactAgent.stream()` messages and updates to `AssistantSession` UI
   events and propagate cancellation/deadlines;
4. preserve dynamic `buildSystemPrompt` behavior, Skills routing, provider
   quirks, and tool-result formatting;
5. bridge sensitive tools to the existing approval UI, then resume a graph
   interrupt with a stable thread ID and checkpointer; and
6. compare diagnosis quality, safety, latency, and calls against the production
   session using the decision gates.

## Remaining gaps and highest-impact improvements

| Priority | Gap today                                                                                 | Why it matters                                                                                                                                                                                                                                                                                                    | Research-backed improvement                                                                                                                                                    |
| -------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0       | No graph-to-`AssistantSession` stream adapter                                             | Blocks use in the real UI and hides model/tool/state progress                                                                                                                                                                                                                                                     | Map agent message/update events to current text, tool progress, approval, cancellation, and final-history events                                                               |
| P0       | Deferred tool results lack graph-native resume                                            | The adapter now stops confirmation and strict-false results before another model/tool turn, but approval/edit/reject still resumes through the host session rather than a checkpointed graph thread                                                                                                               | Add stable thread IDs and a checkpointer, then resume the interrupted trajectory with typed Kubernetes scope                                                                   |
| P0       | No counterbalanced repeat of the broad harness-versus-legacy comparison                   | One valid 25-case round found equal safety/lifecycle, one harness win, two losses, and higher harness cost; the improved harness completed a later roster but provider rate limiting invalidated 20 legacy trials                                                                                                 | Repeat after provider cooldown with reversed/counterbalanced order, fixed model/evidence/permissions/budgets, and separate lifecycle/task reporting                            |
| P1       | Prototype has no checkpointed approval/resume                                             | Current approval is outside graph state and only one request can be pending                                                                                                                                                                                                                                       | Add stable thread IDs and a checkpointer, then adapt graph-native approve/edit/reject while preserving current auto-approval policy                                            |
| P1       | No claim-level evidence verification in the product answer path                           | Exact evidence IDs and evaluation validation prevent malformed references but do not prove that each fluent claim is entailed by current evidence                                                                                                                                                                 | Add typed product findings with provenance and a verifier node that rejects unsupported claims and reports uncertainty                                                         |
| P1       | Conversation/tool payloads lack a token-budget policy                                     | Long troubleshooting sessions can overflow context or become expensive and inaccurate                                                                                                                                                                                                                             | Add summarization plus tool-result pruning; retain recent evidence and structured findings rather than raw payloads                                                            |
| P1       | Retry, timeout, and idempotency policy is inconsistent                                    | Kubernetes APIs and observability endpoints fail transiently; retrying writes can be unsafe                                                                                                                                                                                                                       | Add operation deadlines and retry middleware for models/read-only tools only; require idempotency keys/preconditions for mutations                                             |
| P1       | LangGraph `ToolNode` batches wait for every parallel tool call before the graph continues | A single slow/optional tool call in a batch (e.g. supplementary logs) delays the whole turn even after the tools the answer needed have already returned — `LangChainAssistantSession`'s orchestrated path now supports a `required`/optional wait policy (see below) but the LangGraph harness has no equivalent | Add a custom tool-dispatch node/middleware that gates graph continuation on required tool calls only, synthesizing placeholder `ToolMessage`s for still-running optional calls |
| P1       | Security is boundary-specific rather than harness-wide                                    | Existing redaction is strong but must also cover streams, checkpoints, traces, model input, and errors                                                                                                                                                                                                            | Wrap all model/tool/checkpoint/telemetry boundaries and retain Kubernetes-specific detectors                                                                                   |
| P2       | Skills and system context are session-specific plumbing                                   | A migration could silently lose runbook routing or inject stale context                                                                                                                                                                                                                                           | Move them behind typed dynamic prompt middleware and test source attribution                                                                                                   |
| P2       | Current tool planning and direct-calling paths overlap                                    | Extra planning can add latency and behavior differs by provider                                                                                                                                                                                                                                                   | Benchmark current `ToolPlanner`, direct tools, and `llmToolSelectorMiddleware`; keep the simplest winner per tool-count tier                                                   |
| P2       | No provider fallback or uniform retry telemetry                                           | Outages terminate investigations or trigger ad hoc fallback behavior                                                                                                                                                                                                                                              | Add bounded model retry/fallback with visible provider transitions and usage metrics                                                                                           |
| P3       | No specialist graph/subagents                                                             | Very broad incidents may benefit from domain expertise                                                                                                                                                                                                                                                            | Add only if evaluation shows the hybrid single-graph approach misses cross-domain cases; cap fan-out and deduplicate evidence                                                  |

### Original implementation sequence

1. **Create the measurement contract:** completed by the stacked Phase 2
   evaluation framework; the harness-specific matched baseline remains open.
2. **Repair the harness boundary:** adapt `ToolRuntime.executeTool()`, trusted
   context, call correlation, cancellation/deadlines, and end-to-end redaction.
3. **Reach UI parity:** add the stream adapter, dynamic prompt/Skills context,
   result formatting, and provider compatibility.
4. **Evaluate the simple agent:** run the same fixtures and decide against the
   explicit gates above.
5. **Improve only failed dimensions:** add structured evidence and verification;
   promote failing scenario classes to outer `StateGraph` phases if necessary.
6. **Support long/consequential runs:** context budgeting, checkpointing, and
   graph-native approval/resume.
7. **Optimize after measurement:** compare tool selection strategies,
   retries/fallback, prompt caching, and only then specialist agents or a
   separate service.

This order targets correctness and safety before architectural sophistication.
The evaluation suite is the deciding mechanism for “best.” The hybrid graph is
a target hypothesis, not the default implementation.

Roll out behind a feature flag by provider and session. Keep the current session
as immediate fallback until the candidate passes contract tests and quality
gates for every enabled provider. Record only redacted metrics and trajectories.
Remove the old path only after the candidate shows no regression in approval,
stream cancellation, provider-specific tool-call handling, and Kubernetes
context isolation.

## Open risks and decisions

- **Tool identity:** confirm that a custom wrapper can preserve LangGraph
  tool-call IDs through `ToolRuntime.executeTool()` for UI history and approval.
- **Approval lifetime:** decide whether approval must survive navigation or page
  refresh. An in-memory checkpointer cannot provide durable resume.
- **Checkpoint privacy:** define which messages, evidence, credentials, and tool
  outputs may be persisted and apply redaction before checkpoint writes.
- **Read/write partition:** classify every built-in and MCP tool by side effect;
  unknown MCP tools should require approval rather than inherit read-only trust.
- **Provider parity:** test providers that split streamed tool calls across
  generations before replacing the current merge logic.
- **Parallel reads:** bound concurrency and ensure evidence timestamps remain
  comparable; serialize writes and reads that depend on a preceding mutation.
- **Caching:** do not reuse cached diagnoses across changing resource versions
  unless the cache key includes cluster, namespace, identity, resource UID, and
  observation time.

## Verified repository findings

- `LangChainAssistantSession` is the production behavior boundary and owns
  cancellation, tool planning/execution, streaming, history, redaction, Skills,
  caching, and approval.
- `LangChainToolManager` already exposes built-in and discovered MCP LangChain
  tools, but its structured `executeTool()` path carries more semantics than the
  generic wrappers.
- `LangChainTool.createLangChainTool()` explicitly omits `toolCallId` and
  `pendingPrompt`; the report therefore treats tool adaptation as P0.
- Built-in tools default to enabled. Non-sensitive built-ins are auto-approved;
  MCP and sensitive built-in calls use the inline approval manager.
- The locked tree resolves `langchain` 1.5.2 and
  `@langchain/langgraph` 1.4.7. Add the latter as a direct dependency before
  importing `StateGraph` or checkpointer primitives.

## First-party references

- [LangChain agents](https://docs.langchain.com/oss/javascript/langchain/agents)
- [LangChain middleware](https://docs.langchain.com/oss/javascript/langchain/middleware)
- [LangChain human-in-the-loop](https://docs.langchain.com/oss/javascript/langchain/human-in-the-loop)
- [LangChain multi-agent patterns](https://docs.langchain.com/oss/javascript/langchain/multi-agent)
- [LangGraph workflows and agents](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [LangGraph streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming)
- [LangChain.js agent middleware source](https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain/src/agents/middleware)
- [LangGraph.js source](https://github.com/langchain-ai/langgraphjs/tree/main/libs/langgraph/src)
- [LangChain: Improving Deep Agents with harness engineering](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering)
- [Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Anthropic: How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [ITBench: Evaluating AI Agents across Diverse Real-World IT Automation Tasks](https://arxiv.org/abs/2502.05352)
- [Auditable Graph-Guided Root Cause Analysis for Kubernetes Incidents](https://arxiv.org/abs/2606.08590)
- [MetaKube: An Experience-Aware LLM Framework for Kubernetes Failure Diagnosis](https://arxiv.org/abs/2603.23580)
- [τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains](https://arxiv.org/abs/2406.12045)
