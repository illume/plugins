# Agent harness research

Status date: 2026-09-17. This document describes the implementation in this PR,
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
bounded optional orchestration. Do not make an unmeasured custom `StateGraph`,
specialist fan-out, memory, retries, or summarization the default.

## Status

| Capability                                                               | Status                                                                       | Default                                    | Evidence                                                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| LangGraph-backed `createAgent` loop                                      | Implemented                                                                  | CLI: yes; plugin UI: no                    | Deterministic model-tool-model, parallel-call, and limit tests                                 |
| Existing `ToolRuntime` and host-tool adaptation                          | Implemented                                                                  | Yes in harness                             | Call IDs, approvals, errors, redaction, deferred output, and aligned-history tests             |
| Skills, dynamic system prompt, Kubernetes context, and provider behavior | Implemented through the session adapter                                      | Yes in harness                             | Compatibility and CLI tests; stacked build passes                                              |
| Sanitized model/tool/turn telemetry                                      | Implemented after the first smoke exposed its absence                        | Yes in harness                             | Observer regression plus matched run with complete tool/model accounting                       |
| Mutation approval and Secret/error redaction                             | Implemented                                                                  | Yes                                        | Denial, sensitive read, thrown-error, and runtime-history regressions                          |
| CLI, MCP, and Electron cancellation                                      | Implemented where the underlying host accepts a signal/cancel request        | Yes                                        | Pre-abort, in-flight abort, correlated Electron cancellation, and listener-cleanup tests       |
| Required/optional tool waiting                                           | Implemented in the legacy orchestrated path                                  | Yes there                                  | Success/failure races, deadlines, timer cleanup, immutable snapshots, and optional abort tests |
| Harness-native optional tool dispatch                                    | Not implemented                                                              | No                                         | Current LangGraph `ToolNode` still waits for its parallel batch                                |
| CLI harness default and legacy fallback                                  | Implemented                                                                  | Harness default; `--legacy-session` opt-in | CLI selection and mock-tool execution tests                                                    |
| Plugin UI harness default                                                | Not implemented                                                              | No                                         | Requires quality comparison and browser stream/approval parity                                 |
| Typed evidence and deterministic verification                            | Partly supplied by the eval submission contract, not the product answer path | No                                         | Phase 2 graders exist; product integration is untested                                         |
| Checkpointed approval/resume                                             | Not implemented                                                              | No                                         | Research backlog                                                                               |
| Context editing/summarization, retry/fallback, tool selection            | Not evaluated as isolated harness changes                                    | No                                         | Research backlog                                                                               |
| Outer `StateGraph`, specialists, or incident memory                      | Hypotheses only                                                              | No                                         | Adopt only after simpler failures identify a need                                              |

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

| Experiment                                                                             | Result                                                                                  | Decision                                                                                            |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `createAgent` with the existing tool inventory                                         | Deterministic graph execution and parallel tool calls pass                              | Keep as the harness core                                                                            |
| Harness CLI versus retaining the legacy-only CLI                                       | Harness meets CLI contracts; legacy remains available for fallback and ablation         | Harness is the CLI default                                                                          |
| Runtime adapter versus generic LangChain tools                                         | Generic wrappers lose product metadata and lifecycle policy; the adapter preserves them | Use `AgentToolAdapter` by default                                                                   |
| Name-only host-tool auto-approval                                                      | Review found a mutation approval bypass                                                 | Require method-sensitive approval; keep the hardened policy                                         |
| Renderer-only MCP abort                                                                | Review showed the host operation could continue                                         | Use correlated Electron/main-process cancellation by default                                        |
| Detached optional orchestration work                                                   | Review showed leaked timers and background calls                                        | Abort unfinished optional calls and return a stable snapshot                                        |
| Broad raw-URL query rejection                                                          | Rejected valid Kubernetes selectors                                                     | Keep separate strict path and selector-compatible query validation                                  |
| Matched harness versus legacy smoke                                                    | Both passed 2/2 task and safety checks; harness used more calls, tokens, and mean time  | Keep the CLI default for continued evaluation; do not promote to the plugin or claim a quality gain |
| Custom outer graph, specialists, memory, context editing, retries, selector middleware | Not isolated yet                                                                        | Do not enable by default                                                                            |

The next result added to this ledger should repeat and broaden the matched
harness-versus-legacy run after retrieval availability is made explicit. Record
lifecycle validity, structured-submission status, root-cause and safety
outcomes, calls, tokens, latency, and complete configuration. A single run is a
smoke result, not a superiority claim.

## Ordered phases

1. **Compatibility and safety foundation — completed for the headless path.**
   Preserve prompt, Skills, context, tools, approvals, redaction, history,
   cancellation, telemetry, and deterministic limits. Keep passing behavior as
   the harness default.
2. **Matched baseline — current phase.** The first two-case smoke passed task,
   safety, and lifecycle checks for both modes. Make retrieval availability
   explicit, counterbalance order, repeat, and broaden across qualified
   families before making a quality or efficiency claim.
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

| Priority | Hypothesis                                                         | Minimal experiment                                                                                                             | Promotion rule                                                                                              |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| P0       | Harness preserves or improves diagnosis versus legacy              | Repeat the passing smoke with explicit retrieval policy, counterbalanced order, more families, fixed provider/model and budget | Keep harness default only with no safety/lifecycle regression; require repeated evidence for quality claims |
| P0       | Supplied-evidence runs should not waste calls on unavailable tools | Compare explicit no-retrieval mode with a policy-enforcing read tool; retain identical visible evidence                        | Eliminate transport-error calls without reducing task or safety outcomes                                    |
| P0       | Plugin behavior matches the headless candidate                     | Replay a fixed diagnosis/approval set through CLI and browser with identical evidence                                          | Zero contract divergence or an explicit, tested UI-only difference                                          |
| P0       | Typed evidence plus external validation reduces unsupported claims | Baseline, evidence IDs only, then one validator-guided correction                                                              | Lower unsupported-claim rate without hiding first-attempt regressions or leaking gold facts                 |
| P1       | Lossless evidence compaction improves retrieval and cost           | Raw versus grouped typed observations at equal model/budget                                                                    | Equal or better task scores with lower tokens and no missing evidence                                       |
| P1       | Context editing helps only long investigations                     | Short and long multi-turn cases with/without pruning                                                                           | Enable above a measured context threshold; retain typed evidence losslessly                                 |
| P1       | Read-only retry recovers transient failures                        | Inject bounded 429/5xx/timeouts; compare no retry and fixed retry budget                                                       | Better recovery without repeated mutations, deadline violations, or material cost regression                |
| P1       | Checkpointed approval/resume prevents lost work                    | Interrupt before approval, reload, approve/reject, and verify exact continuation                                               | Zero duplicate action, stale approval, or secret persistence                                                |
| P1       | An outer evidence/verification graph fixes premature diagnosis     | Apply only to scenarios where simple-agent traces miss ordering/verification gates                                             | Improve those registered classes enough to justify added calls and complexity                               |
| P2       | Tool selection helps large MCP inventories                         | No selector versus one selector call across inventory-size tiers                                                               | Enable only where accuracy/latency beats exposing all authorized tools                                      |
| P2       | Provider retry/fallback improves availability                      | Inject provider failures with fixed retry/fallback order                                                                       | Higher completion with visible attribution and bounded duplicate work                                       |
| P3       | Specialists improve broad cross-domain incidents                   | Single agent versus bounded specialists on held-out multi-domain cases                                                         | Require quality gain after cost, duplication, and routing penalties                                         |
| P3       | Incident memory helps repeated mechanisms                          | Seen/unseen and stale-memory controls with provenance                                                                          | Enable only with unseen-case gain and no stale or cross-tenant leakage                                      |

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
| P0       | No repeated, broad harness-versus-legacy quality comparison                               | One two-case smoke passed both modes, but architecture changes cannot yet be credited with improved correctness or efficiency                                                                                                                                                                                     | Repeat with counterbalanced order, explicit retrieval availability, more families, fixed model/evidence/permissions/budgets, and separate lifecycle/task reporting             |
| P1       | Prototype has no checkpointed approval/resume                                             | Current approval is outside graph state and only one request can be pending                                                                                                                                                                                                                                       | Add stable thread IDs and a checkpointer, then adapt graph-native approve/edit/reject while preserving current auto-approval policy                                            |
| P1       | No evidence schema or verification phase                                                  | A fluent answer can be unsupported or based on stale/partial results                                                                                                                                                                                                                                              | Add typed findings with provenance and a verifier node that rejects unsupported claims and reports uncertainty                                                                 |
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
