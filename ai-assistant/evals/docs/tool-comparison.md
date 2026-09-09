## Executive summary

The strongest public evaluation systems found are:

1. **HolmesGPT** has the most mature framework for evaluating investigation and root cause analysis (RCA). It runs live, scenario-based investigations, grades explicit expected-output criteria with a classifier model, records tool calls, tokens, cost, and duration, supports repeated multi-model runs, and publishes historical reports through Braintrust and Markdown.
2. **`kubectl-ai` + `k8s-ai-bench`** has the strongest framework for evaluating whether an agent actually fixes a Kubernetes environment. It creates isolated Kind or vCluster environments, runs setup/agent/verification/cleanup phases, uses deterministic cluster-state verification, and reports Pass@1, Pass@5, and Pass^5.
3. **DevOps AI Toolkit (`dot-ai`)** has the broadest model-comparison and cost/performance analysis. It captures rich traces from real integration runs across nine models and several tools, then uses weighted LLM-as-judge comparisons. It is ambitious and useful, but less rigorous for RCA correctness because much of its comparison is reference-free and its own standards document notes missing statistical testing, experiment versioning, and standard exports.

The recommended Headlamp framework is a **hybrid of the first two**:

- Use `k8s-ai-bench`-style executable scenarios for setup, isolation, cleanup, and hard postconditions.
- Use HolmesGPT-style expected criteria for root-cause identification, evidence, impact, and remediation quality.
- Capture the agent trajectory, then score tool choice and evidence provenance separately from the prose answer.
- Treat a correct fix with a wrong explanation, or a plausible explanation without evidence, as a partial result rather than a pass.

For direct Phase 2 comparison, start with only **HolmesGPT and K8sGPT**. HolmesGPT provides a ready-to-run Compose service configured through provider environment variables and a mounted kubeconfig; K8sGPT publishes an official container image and exposes a small analyzer/authentication surface. Defer kubectl-ai, kagent, and DevOps AI Toolkit until the value of another comparison justifies their image-build, credential, runtime, or adapter setup.

The existing plugin `test-files/` are a good seed corpus. Knative, kro, Volcano, and Strimzi already contain deterministic broken states. They should not be consumed directly as an unversioned glob: each should be wrapped in an eval manifest that identifies prerequisites, setup order, the hidden root cause, observable evidence, allowed mutations, cleanup, and hard verification.

## Scope and terminology

This report distinguishes three kinds of tests that projects often call “evals”:

- **Software tests:** deterministic unit, integration, protocol, UI, and security tests. These validate the product but do not measure an LLM's troubleshooting quality.
- **Agent task benchmarks:** put an agent in an environment and verify the resulting external state. These measure task completion and, with repetition, reliability.
- **Semantic quality evals:** grade an answer or trajectory for diagnosis, root cause, evidence, safety, and communication. These usually need gold criteria, a human rubric, or an LLM judge.

For this report, **root cause analysis** means more than naming a visible failure such as `CrashLoopBackOff`. A valid RCA must identify the causal configuration, dependency, change, or runtime condition; cite observations that distinguish it from alternatives; connect cause to symptom; and propose a proportionate remediation.

## Comparison at a glance

| Tool                      | Main troubleshooting model                                                                 | Public AI-quality evals                       | Live cluster state                                                   | RCA grading                                                          | Tool trajectory                                         | Repeated-model statistics                                      | Overall eval maturity                                                |
| ------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| HolmesGPT                 | Agentic investigation across Kubernetes and observability sources                          | Yes                                           | Yes for many cases; other data sources can be live or fixture-backed | Explicit expected criteria judged by classifier                      | Captured; optional required tool checks                 | Iterations, model matrices, pass rates, cost, tokens, duration | **Most advanced for investigations/RCA**                             |
| kubectl-ai + k8s-ai-bench | General Kubernetes agent using `kubectl`, shell, and MCP tools                             | Yes                                           | Yes, isolated Kind/vCluster                                          | Usually inferred from successful repair; text expectations available | Trace captured, but primary grade is final state        | Pass@1, Pass@5, Pass^5; multi-model leaderboard                | **Most advanced for executable outcomes**                            |
| DevOps AI Toolkit         | MCP/CLI workflows for remediation, recommendation, policy, and capability discovery        | Yes                                           | Integration-run datasets                                             | Weighted comparative LLM judge; reference-free in current core       | Iterations, tool count, unique tools, failures          | Nine-model comparison, latency, tokens, cost, reliability      | **Most advanced for broad model comparison**                         |
| K8sGPT                    | Deterministic analyzers detect known failure patterns; LLM explains them                   | No public explanation-quality benchmark found | Fake clients and ordinary integration paths                          | Analyzer results are deterministic; explanation is not graded        | Limited because the LLM is mainly an explanation layer  | No public model leaderboard found                              | Strong software tests, weak LLM evals                                |
| kagent                    | Kubernetes-native agent runtime, MCP, A2A, multi-agent and multiple ADKs                   | No public diagnosis-quality benchmark found   | Kind E2E with mock LLM/MCP; some real-provider tests                 | No public gold RCA scoring found                                     | Excellent protocol-path tests and OpenTelemetry support | No public troubleshooting model comparison found               | Strong agent architecture tests, weak RCA evals                      |
| Robusta                   | Alert ingestion and deterministic incident enrichment, with HolmesGPT for AI investigation | HolmesGPT owns the semantic evals             | Yes in integration/manual tests                                      | Rule-based enrichers are testable; AI RCA delegated to HolmesGPT     | Holmes results include calls and results                | Through HolmesGPT                                              | Strong incident context pipeline, not a separate AI eval framework   |
| Botkube                   | ChatOps, notifications, recommendations, interactive `kubectl`/Helm, AI plugin/scan        | No public AI-quality benchmark found          | Extensive bot/platform E2E                                           | No public RCA rubric found                                           | Interaction and command paths tested                    | No public model comparison found                               | Strong interaction E2E, weak semantic evals                          |
| Komodor / Klaudia         | Commercial investigation using events, changes, logs, metrics, and timelines               | No public Klaudia quality framework found     | Public agent release checks generate failures and verify ingestion   | Product capability is documented; scoring is not public              | Not publicly inspectable end to end                     | No public model benchmark found                                | Useful scenario ideas; cannot independently rank eval quality highly |

## Best-practice scorecard and public roadmap

This assessment applies the practices in [Current evaluation best practices](#current-evaluation-best-practices) to every tool in the survey. “No public evidence” is deliberately narrower than “not implemented”: several projects are commercial, delegate evaluation to another project, or may plan work outside GitHub. Issue states were checked on 2026-09-04.

### HolmesGPT

**Does well:** defines task-specific expected facts; exercises the complete investigation loop against live or fixture-backed tools; separates setup failures from model failures; captures trajectories and cost; repeats runs across models; schedules fast suites; publishes versioned historical results; and uses deterministic canary assertions where an LLM judge is not authoritative.

**Lacking or not public:** no documented private holdout or development/regression/capability split; no public expert-labeled judge calibration set, agreement measurement, swapped-order bias test, or judge holdout; no confidence intervals or paired statistical tests; and no published production-sampling/privacy loop. Holding the classifier model stable improves comparability but does not validate its judgments. Security companion tests are strong, but a systematic adversarial corpus and severity-based release gates are not evident publicly.

**Useful practice beyond the consensus list:** its authoring guide asks setup to verify the discoverable “needle” rather than every environmental detail. This is a practical anti-flakiness rule for live incident fixtures. Required-tool checks also detect answers that guessed the result without collecting the necessary evidence.

**Open issues and plans:** no relevant public open issue was found for eval methodology, judge quality, or an eval roadmap. The active suite, scheduled runs, and historical reports demonstrate ongoing work, but they are implementation evidence rather than an issue-backed future plan.

### kubectl-ai and k8s-ai-bench

**Does well:** runs the complete agent in isolated Kind or vCluster environments; verifies real external state instead of self-reported success; provides setup, verification, and cleanup phases; supports deterministic CEL checks; obscures answer-bearing names; captures traces; repeats trials; reports `pass@1`, `pass@5`, and `pass^5`; exports portable results; and publishes a cross-model leaderboard.

**Lacking or not public:** task success does not require a correct causal explanation, evidence provenance, or diagnosis-before-mutation, so trial-and-error repair can pass. There is no public calibrated semantic judge, expert RCA set, private holdout, confidence interval, paired significance test, systematic adversarial suite, or production feedback loop. The harness passes kubectl-ai-specific CLI flags, so its task format is reusable but its agent adapter is not fully neutral.

**Useful practice beyond the consensus list:** [`kubectl-expect`](https://github.com/GoogleCloudPlatform/kubectl-ai/tree/main/kubectl-utils) makes Kubernetes-aware polling and CEL assertions a reusable authoring primitive. The [Gatekeeper conversion recipe](https://github.com/gke-labs/k8s-ai-bench/blob/main/docs/gatekeeper.md) demonstrates how to turn an existing conformance corpus into agent tasks instead of inventing every scenario manually.

**Open issues and plans:**

- [kubectl-ai #573](https://github.com/GoogleCloudPlatform/kubectl-ai/issues/573), **“fix-oomkilled eval can pass without llm connection”** (open), is a direct measurement-validity defect. The fixture does not reliably create `OOMKilled` on Kind and the eval can falsely pass when the model endpoint is unavailable. The linked work adds setup failure detection and error propagation, but the issue states that a reliably reproducible, agent-fixable OOM condition is still needed.
- [kubectl-ai #667](https://github.com/GoogleCloudPlatform/kubectl-ai/issues/667), **“Use Evidra Bench for live infrastructure regression benchmarking”** (open), proposes an external 78-scenario suite that adds safe-versus-unsafe outcomes, diagnosis-before-mutation, forbidden-action checks, cost, timelines, and failure autopsies. It explicitly proposes testing either the CLI or MCP server and comparing releases, prompts, models, and tool changes. No maintainer commitment, assignee, milestone, or implementation link is present, so this is a third-party proposal rather than an accepted roadmap.
- No relevant open issue was found in `gke-labs/k8s-ai-bench` itself. Absence of an issue does not establish that no work is planned elsewhere.

### DevOps AI Toolkit (`dot-ai`)

**Does well:** captures real integration traces into JSONL automatically; uses common scenario identifiers for multi-model comparison; covers several tool families; records latency, tokens, cost, iterations, tool use, completion reason, and failure class; uses an explicit weighted rubric; and keeps human-readable synthesis reports in version control.

**Lacking or not public:** the core comparison is reference-free and can reward a persuasive shared error; no reference solution or gold RCA facts are required; no public expert calibration, judge-bias tests, judge holdout, private candidate holdout, confidence intervals, paired tests, or systematic safety suite were found. The repository's own standards analysis identifies incomplete experiment/version capture, statistical testing, and standard observability exports. A completed PRD documents intent but is not evidence that every proposed capability shipped.

**Useful practice beyond the consensus list:** automatic conversion of provider-debug traces into a cross-tool dataset sharply reduces the cost of creating model-comparison evidence. Its failure taxonomy and platform-wide synthesis connect model quality to practical provider limits such as context exhaustion and function-calling failures.

**Open issues and plans:** no open issue was found that commits to judge calibration, gold RCA datasets, statistical inference, or hosted-export work. Three open correctness issues are nevertheless relevant to trustworthy evaluation inputs and validators:

- [dot-ai #731](https://github.com/vfarcic/dot-ai/issues/731), **“rbac.test.ts ‘should allow’ tests assert only the absence of FORBIDDEN”** (open), documents false-positive integration tests. The stated fix is to observe and positively assert each known downstream response after the authorization gate; no assignee or linked implementation is present.
- [dot-ai #732](https://github.com/vfarcic/dot-ai/issues/732), **“remediate says ‘Automatic validation has been completed’ alongside a payload saying validation could not be completed”** (open), shows contradictory post-remediation evidence. The accepted contributor plan is to correct the wording, add a focused unit regression, add the required changelog fragment, and run focused plus repository checks.
- [dot-ai #740](https://github.com/vfarcic/dot-ai/issues/740), **“recommend: question generation can emit a suggestedAnswer that violates its own validation rule”** (open), is a stochastic self-consistency failure that also makes an integration test flaky. The issue proposes either prompt changes or, preferably, a server-side post-generation check; no maintainer commitment or linked fix is present.

These three are evaluation-enabling product/test defects, not a public plan to improve the comparative LLM judge itself.

### K8sGPT

**Does well:** uses deterministic, fake-client-tested analyzers as reproducible high-precision oracles for codified Kubernetes conditions. This keeps failure detection inspectable and cheap, and cleanly separates deterministic pattern detection from optional LLM explanation.

**Lacking or not public:** there is no public construct or gold set for explanation quality, causal completeness, or remediation safety; no end-to-end semantic benchmark, judge calibration, repeated model trials, uncertainty estimates, private holdout, adversarial AI suite, trajectory analysis, or production evaluation loop was found.

**Useful practice beyond the consensus list:** deterministic domain analyzers can act as fixture preconditions, evidence labels, and negative controls for an agentic RCA benchmark. They can also expose whether an LLM explanation faithfully preserves a machine-detected fact.

**Open issues and plans:** no open issue proposing LLM explanation evals or a model benchmark was found. Two open analyzer-correctness issues show why the deterministic oracle itself needs positive and negative controls:

- [K8sGPT #1742](https://github.com/k8sgpt-ai/k8sgpt/issues/1742), **“Deployment analyzer reports in-progress rollouts as failures”** (open), is a false positive caused by ignoring observed generation and healthy progress. A maintainer approved guards for unreconciled/healthy rollouts plus regression cases while retaining a stuck-rollout positive control; [PR #1743](https://github.com/k8sgpt-ai/k8sgpt/pull/1743) is open.
- [K8sGPT #1746](https://github.com/k8sgpt-ai/k8sgpt/issues/1746), **“NetworkPolicy analyzer matches same-label Pods from other namespaces”** (open), is a false negative caused by a cluster-wide Pod lookup. A maintainer approved lookup by the policy namespace and a fake-client regression test; [PR #1747](https://github.com/k8sgpt-ai/k8sgpt/pull/1747) is open.

These improve the deterministic oracle but do not evaluate the LLM-generated explanation.

### kagent

**Does well:** exercises the deployed interaction path in Kind; uses recorded model responses and mock LLM/MCP servers for reproducibility; asserts actual tool invocation; tests A2A/MCP continuation, cancellation, authorization, and cleanup; and emits OpenTelemetry traces suitable for future trajectory grading.

**Lacking or not public:** protocol success is not diagnosis quality. No public production-shaped incident dataset, gold RCA criteria, executable repair benchmark, semantic grader, grader calibration, repeated model comparison, uncertainty analysis, private holdout, adversarial quality suite, or production-eval flywheel was found.

**Useful practice beyond the consensus list:** deterministic mock servers test multi-agent and human-in-the-loop protocol state without provider noise. Continuation and cancellation tests cover control-flow failures that answer-only evals usually omit.

**Open issues and plans:** no relevant public open issue was found for a Kubernetes diagnosis benchmark or AI-quality eval roadmap. Open platform work may improve tracing, approvals, or runtime behavior, but it should not be represented as semantic eval work without an explicit measurement proposal.

### Robusta

**Does well:** packages incidents into typed findings; deterministically enriches alerts with logs, events, metrics, and related resources; preserves severity and source metadata; and tests adapters, rendering, and transport. Its AI investigation quality inherits HolmesGPT's eval strengths when that integration is used.

**Lacking or not public:** Robusta has no separate public AI-quality benchmark, dataset split, semantic rubric, calibrated judge, repeated-trial statistics, or production quality-sampling framework. Delegation avoids duplicating HolmesGPT's suite but leaves the alert-to-Holmes integration boundary dependent on ordinary integration tests.

**Useful practice beyond the consensus list:** deterministic pre-enrichment and a stable incident envelope make an eval input resemble a real alert rather than a bare prompt. That provides a natural unit for severity-weighted and ownership-aware slices.

**Open issues and plans:** no direct eval-roadmap issue was found. [Robusta #2102](https://github.com/robusta-dev/robusta/issues/2102), **“Self-hosted ask_holmes fails: 404 on /api/investigate”** (open), is an adjacent end-to-end coverage gap: released runner and Holmes versions disagree on the API endpoint, so automated analysis never runs. [PR #2112](https://github.com/robusta-dev/robusta/pull/2112) is merged and migrates the caller to `/api/chat`, but the issue remains open. This is evidence for a version-matrix integration eval, not a plan for semantic RCA scoring.

### Botkube

**Does well:** runs real Kubernetes-to-chat E2E flows; verifies notifications, commands, and audit events; constrains actions with RBAC and command guards; and tests structured interaction components. These cover the deployed user workflow and some necessary safety controls.

**Lacking or not public:** no public gold diagnosis corpus, semantic cluster-scan rubric, judge calibration, repeated model trials, uncertainty analysis, holdout, prompt-injection suite, or production quality monitoring was found. E2E delivery success does not establish that an AI scan is factually correct or complete.

**Useful practice beyond the consensus list:** tests span incident notification, private preview, progressive command construction, approved action, and audit history. This is a valuable multi-turn human-control pattern that prose-only agent benchmarks miss.

**Open issues and plans:** no public issue proposing AI-quality evals was found. [Botkube #1489](https://github.com/kubeshop/botkube/issues/1489), **“AI Plugin doesn't work: got unexpected status: failed”** (open), reports that a documented cluster scan can fail opaquely; a user reports that configuring `openAIBaseURL` worked around a similar failure, but there is no maintainer-confirmed plan. This is an operational issue and a useful future smoke case, not an eval roadmap.

### Komodor and Klaudia

**Does well, based on public evidence:** release checks create realistic Kubernetes failures and verify agent installation/data ingestion. The product's change timeline combines deployments, events, ownership, logs, metrics, and service relationships, giving an RCA system temporal evidence that snapshot-only benchmarks omit.

**Lacking or not public:** Klaudia's implementation, scenarios, rubrics, judges, repeated-trial statistics, safety gates, and production quality controls are not publicly inspectable. The public Helm checks prove transport and ingestion rather than RCA quality, so most best-practice categories must be marked unknown rather than failed.

**Useful practice beyond the consensus list:** change-correlation scenarios can include several plausible recent changes and ask the system to identify the causal one. This tests temporal discrimination rather than simple broken-state recognition.

**Open issues and plans:** no relevant public open issue was found in `komodorio/helm-charts` for Klaudia evaluation or an AI-quality roadmap. Because Klaudia is commercial, this search cannot say whether private plans or issue trackers exist.

### Cross-tool conclusions

No surveyed project publicly demonstrates the full stack of representative private holdouts, calibrated semantic judges, deterministic outcome verification, repeated trials with confidence intervals, systematic adversarial gates, and production feedback. The strongest public combination remains:

- HolmesGPT for task-specific semantic criteria, investigation traces, repeated model runs, and failure inspection.
- k8s-ai-bench for clean environments, executable outcomes, reliability metrics, leakage-resistant task authoring, and public comparison.
- DevOps AI Toolkit for automatic multi-model telemetry and cost/performance analysis.
- K8sGPT, Robusta, Botkube, kagent, and Komodor for deterministic oracles, incident packaging, human-control workflows, protocol testing, and temporal change correlation respectively.

The GitHub issue review also shows a recurring problem that the best-practice list should make explicit: **the eval harness and its deterministic oracle need regression tests of their own**. kubectl-ai #573 can produce a false pass, dot-ai #731 can pass on unrelated failures, and K8sGPT #1742/#1746 show both false-positive and false-negative oracle errors. A reference agent is necessary but not sufficient; every hard grader should have known-pass, known-fail, setup-failure, and unavailable-agent controls.

### Operational and reporting lessons by project

Only HolmesGPT, k8s-ai-bench, and DevOps AI Toolkit publish recognizable AI-eval reports. The other projects provide useful test, trace, incident, or audit output, but calling those artifacts AI-quality reports would overstate the evidence.

| Project                   | Maintenance and anti-flake practices                                                                                                                                                                                                                                                                                                                                                                                               | Reporting that works well                                                                                                                                                                                                                     | Missing or risky reporting                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HolmesGPT                 | Separates easy regression from medium capability cases; filters by domain tags; supports one-case setup-only/cleanup-only/debug modes; pins a classifier for comparisons; repeats stochastic trials, recommending ten; parallelizes broad runs; auto-cleans port forwards even after interruption; requires unique ports; and lets failures retain resources for inspection. Weekly reports create pressure to maintain the suite. | Side-by-side model table with pass rate, execution time/P90, cost, calls, tool calls, total/cached tokens, per-case rows, and links to the fixture and Braintrust trace; committed history makes trend inspection and report review possible. | No confidence intervals, paired deltas, flake/invalid-run rate, severity weighting, judge-agreement report, or explicit quarantine view. “Ten iterations” helps reveal variability but does not by itself make a result statistically significant.                                                                                                                        |
| kubectl-ai + k8s-ai-bench | Isolated clusters; setup/verify/cleanup contract; overall task timeout; condition polling with `kubectl --wait` instead of sleeps; cleanup functions and temporary kubeconfig removal; realistic non-revealing names; disabled-task flag; per-case artifacts and full logs; parallel workers; and a contribution request for both successful and failed example runs.                                                              | YAML per-task results, full logs with concise tails in errors, console summaries, Markdown/JSON/JSONL analysis, task catalog, and a public leaderboard separating `pass@1`, `pass@5`, and `pass^5` over 120 runs per model.                   | The leaderboard lacks confidence intervals, run date/commit/configuration prominence, setup/cleanup/invalid counts, cost/latency, semantic RCA, and per-failure taxonomy. A success can come from either verifier or text expectation; reports should identify which authority passed. Issue #573 proves setup validity and agent availability need first-class statuses. |
| DevOps AI Toolkit         | Automatically captures integration traces into common scenario IDs; records explicit failure metadata; compares many models over the same scenario families; and keeps generated analyses in source control. Its open issues show healthy willingness to turn intermittent failures and weak assertions into focused regression work.                                                                                              | Rich cross-model tables for quality, efficiency, latency, tokens, cost, iterations, tool count/diversity, completion reason, context-window and function-calling failures, with platform-level synthesis and recommendations.                 | Reference-free ranking, no uncertainty, incomplete experiment/version provenance, no judge-calibration report, and no deterministic RCA/outcome authority. Separate validation, infrastructure, and candidate failures so contradictory payloads or flaky generated questions do not become model-quality scores.                                                         |
| K8sGPT                    | Fake-client analyzer tests are cheap, deterministic, and easy to run; focused regressions encode Kubernetes semantics without a live cluster. Open issues #1742 and #1746 pair each bug with positive and negative controls and tightly scoped fixes.                                                                                                                                                                              | Analyzer results are structured enough to identify resource, failure text, and sensitivity masking; ordinary CI reports deterministic analyzer pass/fail.                                                                                     | No report for LLM explanation quality, model comparison, consistency, or cost. Analyzer reports also need an oracle-quality view: false positives, false negatives, resource-kind slices, and Kubernetes-version compatibility.                                                                                                                                           |
| kagent                    | Mock LLM/MCP servers and recorded responses remove provider variance; Kind E2E validates real protocol paths; focused tests cover tool calls, authorization, continuation, cancellation, and cleanup; OpenTelemetry preserves execution evidence.                                                                                                                                                                                  | Distributed traces are the strongest reporting substrate: agent/model/tool spans can diagnose protocol and latency failures. Deterministic E2E output establishes runtime correctness.                                                        | No aggregate Kubernetes RCA report, semantic slices, repeated-model reliability, cost comparison, or trace-to-release decision view. A trace backend alone is observability, not an eval report.                                                                                                                                                                          |
| Robusta                   | Typed findings and deterministic enrichers reduce free-form inputs; integration tests cover alert packaging and transport. Delegating semantic investigation to HolmesGPT avoids maintaining two RCA graders.                                                                                                                                                                                                                      | Findings naturally report severity, subject, source, type, aggregation identity, evidence blocks, and downstream delivery; HolmesGPT can supply linked investigation traces.                                                                  | No combined report proves that alert ingestion, enrichment, Holmes invocation, diagnosis, and delivery all succeeded. Issue #2102 shows component tests missed a released API mismatch; add a version-matrix journey status and never count “alert delivered without AI section” as evaluation success.                                                                   |
| Botkube                   | Real chat-platform E2E creates Kubernetes objects, observes notifications, invokes commands, and verifies audit records; deterministic recommendation checks and RBAC guards reduce ambiguity.                                                                                                                                                                                                                                     | Conversation output and audit events provide a useful human-action record: what was shown, selected, approved, executed, and attributed to a user.                                                                                            | No AI scan quality/completeness report, model/run metadata, semantic failure taxonomy, or clear provider error in the user report. Issue #1489 supports reporting provider/run status and actionable failure reason rather than only “unexpected status: failed.”                                                                                                         |
| Komodor/Klaudia           | Public release checks create failures, repeated changes, OOM/load patterns, and verify agent ingestion. Change timelines provide durable temporal context. Internal maintenance practices are unknown.                                                                                                                                                                                                                             | Product-facing timelines that align resource changes, events, logs, metrics, ownership, and relationships are an excellent RCA report shape because they let a reviewer validate causality chronologically.                                   | Public checks report delivery/ingestion rather than Klaudia correctness. No public rubric, trial distribution, model/judge provenance, uncertainty, or downloadable row-level quality data is available, so independent reporting assessment is limited.                                                                                                                  |

The best report design to copy is a hybrid: HolmesGPT's committed historical summary and trace links, k8s-ai-bench's separate capability/consistency measures and task catalog, dot-ai's cost/failure taxonomy, Robusta/Komodor's incident context, and Botkube's approval audit trail.

### Proposed Headlamp report contract

Generate three views from the same immutable JSONL rows:

1. **Pull-request check:** one-screen decision with baseline/candidate paired delta and interval, hard-gate failures, new regressions, invalid infrastructure count, cost delta, and links to changed-case traces. Do not paste the full leaderboard into a PR.
2. **Scheduled engineering report:** trends by suite and incident slice; `RCA@1`, `Repair@1`, `RCA&Repair@1`, and `pass^k`; setup/grader/verifier/cleanup validity; p50/p95 latency and cost; flake and quarantine tables; newly saturated cases; failure clusters; and direct trace/artifact links.
3. **Release evidence report:** exact candidate and baseline identities; dataset/rubric/fixture revisions; exclusions; quality and safety gates; residual risks; approved exceptions with expiry; reviewer and decision; production-monitoring plan; and a machine-readable attachment. Add a DeepMind-style safety case only for high-impact write capabilities.

Every aggregate should drill down to a stable `runId`, `taskId`, `trial`, and trace. Every row should carry:

- Dataset split, scenario provenance, severity, fixture and rubric versions.
- Candidate model/provider/snapshot, prompts, tool inventory, permissions, and runtime commit.
- Setup, agent, tool/provider, judge, verifier, and cleanup statuses separately.
- Raw grader dimensions, rationales, hard assertions, and final gate decision.
- Duration, turns, tool calls, tokens, cached tokens, cost, retries, and retry reasons.
- Before/after resource snapshots, collateral changes, approval events, and redaction state.

Do not rank invalid runs as failures or successes. Show them beside the denominator as an eval-system health problem. Do not silently drop quarantined tasks, unsupported evaluators, missing traces, or cleanup failures. A report that makes exclusions visible will prevent more disagreement than a more sophisticated aggregate score.

## Tool studies

### HolmesGPT

HolmesGPT is explicitly an SRE investigation agent. Its agent loop queries Kubernetes, logs, metrics, traces, cloud services, databases, alert systems, and runbooks to find root causes. Its data-source breadth is important: many production RCAs require correlating Kubernetes state with a recent deployment, a metric anomaly, a trace, or an upstream service rather than reading one Pod object.

Its evaluation framework is unusually complete:

- Each case lives under [`tests/llm/fixtures/test_ask_holmes`](https://github.com/HolmesGPT/holmesgpt/tree/master/tests/llm/fixtures/test_ask_holmes) and normally contains `test_case.yaml`, optional manifests, setup scripts, and toolset configuration.
- A case declares `user_prompt`, a list of `expected_output` criteria, tags, `before_test`, and `after_test`. It can also specify toolsets, included files, runbooks, fixed time, conversation history, maximum tokens, and whether tool calls should be included in grading.
- The authoring guide says setup should verify the discoverable “needle,” not every component of the environment. This is a good anti-flakiness rule.
- [`tests/llm/test_ask_holmes.py`](https://github.com/HolmesGPT/holmesgpt/blob/master/tests/llm/test_ask_holmes.py) parametrizes cases, models, and environment configurations.
- A separate classifier model grades correctness against the criteria. `CLASSIFIER_MODEL` is deliberately held stable when comparing candidate models.
- [`run_benchmarks_local.py`](https://github.com/HolmesGPT/holmesgpt/blob/master/run_benchmarks_local.py) supports fast/full marker sets, multiple models, up to ten iterations, parallel workers, strict setup, and optional Braintrust upload.
- Reports include pass rate, duration, cost, LLM calls, tool calls, total and cached tokens. Historical Markdown reports link each row to both its case and Braintrust trace.
- Fast benchmarks run on a schedule, while full benchmarks are on demand; published history makes regressions auditable.
- Security properties are backed by deterministic tests when an LLM judge would be too weak. For example, command-injection tests use a real canary-absence assertion and explicitly describe the LLM eval as insufficient on its own.

**RCA strengths:** gold criteria can require the exact causal fact, supporting evidence, and a safe recommendation. Live tools exercise the actual investigation loop. The framework can require a tool call when a generic answer might otherwise pass by guessing.

**RCA weaknesses:** correctness is still primarily judged by another model, so judge drift and correlated model bias remain. Binary expected-output criteria do not automatically prove a coherent causal chain. Some scenarios require shared external infrastructure and can be flaky or expensive. The public result is a pass rate, not a calibrated severity-weighted RCA score.

**What to copy:** fixture-per-incident organization, explicit semantic criteria, tags, setup/cleanup lifecycle, stable classifier model, trajectory capture, budget metrics, historical reports, and deterministic companion tests for safety-critical properties.

Primary references:

- [HolmesGPT repository](https://github.com/HolmesGPT/holmesgpt)
- [Adding an eval](https://github.com/HolmesGPT/holmesgpt/blob/master/docs/development/evaluations/adding-evals.md)
- [Running evals](https://github.com/HolmesGPT/holmesgpt/blob/master/docs/development/evaluations/running-evals.md)
- [Eval case format](https://github.com/HolmesGPT/holmesgpt/blob/master/.claude/skills/create-eval/references/test-case-format.md)
- [Benchmark runner](https://github.com/HolmesGPT/holmesgpt/blob/master/run_benchmarks_local.py)
- [Report generator](https://github.com/HolmesGPT/holmesgpt/blob/master/tests/generate_eval_report.py)
- [Example: misconfigured PVC](https://github.com/HolmesGPT/holmesgpt/tree/master/tests/llm/fixtures/test_ask_holmes/24_misconfigured_pvc)
- [Historical benchmark reports](https://github.com/HolmesGPT/holmesgpt/tree/master/docs/development/evaluations/history)

### kagent

kagent is primarily a Kubernetes-native framework for defining, deploying, and operating agents. Agents are represented by Kubernetes resources and can use MCP tools, remote agents over A2A, multiple provider configurations, memory, and ADK/CrewAI/LangGraph runtimes. Its Kubernetes tool server spans Kubernetes, Helm, Istio, Argo, Prometheus, Grafana, Cilium, and related systems.

The repository has strong deterministic architecture coverage:

- Kind-based end-to-end tests exercise the public interaction path with mock LLM and MCP servers.
- Recorded model responses make provider and agent execution reproducible.
- E2E tests verify that an MCP tool is actually called and that A2A/MCP tasks complete, continue after human input, and cancel correctly.
- Unit tests cover MCP transport, model adapters, configuration translation, authorization, cleanup, and UI behavior.
- OpenTelemetry tracing provides a useful foundation for future trajectory evals.

These tests answer “does the agent platform execute this interaction correctly?” They do not publicly answer “did the agent identify the right Kubernetes root cause?” The `2+2`-style mock interactions are protocol tests, not troubleshooting benchmarks. No public gold incident corpus, RCA rubric, semantic judge, or multi-model diagnosis leaderboard was found.

**What to copy:** its mock LLM/MCP servers, protocol-level assertions, tool authorization tests, A2A continuation/cancellation coverage, and tracing. Use kagent as a candidate runtime and extension surface, but bring an external quality harness.

References:

- [kagent repository](https://github.com/kagent-dev/kagent)
- [Core concepts and MCP tools](https://github.com/kagent-dev/kagent#technical-details)
- [E2E interaction tests](https://github.com/kagent-dev/kagent/blob/main/go/core/test/e2e/interaction_test.go)
- [E2E test documentation](https://github.com/kagent-dev/kagent/blob/main/go/core/test/e2e/README.md)
- [MCP agent-instance tests](https://github.com/kagent-dev/kagent/blob/main/go/core/test/e2e/mcp_test.go)
- [Testing guidance](https://github.com/kagent-dev/kagent/blob/main/CONTRIBUTING.md#testing)
- [Tracing documentation](https://kagent.dev/docs/kagent/getting-started/tracing)

### Robusta

Robusta Classic is an alert and event enrichment engine. It gathers Pod logs, Kubernetes events, resource graphs, metrics, and related objects; applies deterministic playbooks for common conditions such as OOM kills, image pulls, pending Pods, crashes, and misscheduled DaemonSets; and sends structured findings to Slack, Teams, incident systems, and the Robusta platform. AI investigation is delegated to HolmesGPT.

Its key eval contribution is **incident packaging** rather than a distinct LLM benchmark:

- A `Finding` has stable subject, severity, source, type, aggregation key, and enrichment blocks.
- Playbooks turn a raw alert into a richer evidence bundle before the LLM investigates.
- Holmes requests can include alert context, resource identity, runbooks, desired output sections, tool calls, and tool results.
- Tests validate adapters, rendering, and structured AI-result transport. Manual fixtures include realistic crash-loop details, previous-container state, logs, node saturation, and metrics.

This is valuable because eval inputs should resemble real incidents, not bare prompts. However, Robusta's public tests generally validate deterministic enrichment and transport; HolmesGPT's suite is where diagnosis quality is measured.

**What to copy:** a typed incident envelope, deterministic pre-enrichment, severity and ownership metadata, preservation of tool evidence, and output sections that keep RCA, impact, evidence, and remediation distinct.

References:

- [Robusta repository](https://github.com/robusta-dev/robusta)
- [How Robusta works](https://github.com/robusta-dev/robusta#how-it-works)
- [AI integration](https://github.com/robusta-dev/robusta/blob/master/src/robusta/core/playbooks/internal/ai_integration.py)
- [Pod issue investigator](https://github.com/robusta-dev/robusta/blob/master/playbooks/robusta_playbooks/pod_investigator_enricher.py)
- [OOM analysis](https://github.com/robusta-dev/robusta/blob/master/playbooks/robusta_playbooks/oom_killer.py)
- [Alert enrichment documentation](https://github.com/robusta-dev/robusta/blob/master/docs/playbook-reference/builtin-alert-enrichment.rst)

### Botkube

Botkube is a ChatOps system: it watches Kubernetes and other sources, posts filtered notifications to Slack, Discord, Teams, and Mattermost, and allows users to run approved `kubectl` and Helm operations from a conversation. Its AI assistant offers natural-language questions and a cluster scan.

Botkube is strongest as a source of interaction patterns:

- Rich messages combine status, code blocks, buttons, selects, filters, and commands.
- The interactive kubectl builder progressively selects verb, resource, name, and namespace.
- Commands are bound to conversations and constrained by RBAC and command guards.
- Cloud Slack E2E tests create real Kubernetes objects, wait for notifications, invoke commands, and verify audit events.
- Recommendation checks are deterministic and configurable.

The public tests validate message rendering, platform integrations, command execution, recommendation delivery, and audit records. No public semantic eval framework was found for the AI assistant's diagnosis or cluster scan, and no root-cause scoring or model comparison is visible.

**What to copy:** conversational incident entry points, private previews before action, structured action buttons, RBAC-aware command construction, audit history, and tests that span Kubernetes event to user-visible conversation to approved action.

References:

- [Botkube repository](https://github.com/kubeshop/botkube)
- [Features](https://github.com/kubeshop/botkube#features)
- [Bot E2E tests](https://github.com/kubeshop/botkube/blob/main/test/e2e/bots_test.go)
- [Cloud Slack E2E](https://github.com/kubeshop/botkube/blob/main/test/cloud-slack-dev-e2e/cloud_slack_dev_e2e_test.go)
- [Interactive kubectl builder](https://github.com/kubeshop/botkube/blob/main/internal/executor/kubectl/builder/kubectl.go)
- [Kubernetes recommendation interface](https://github.com/kubeshop/botkube/blob/main/internal/source/kubernetes/recommendation/factory.go)
- [Collaborative debugging example](https://github.com/kubeshop/botkube/tree/main/examples/service-debugging)

### Komodor and Klaudia

Komodor's relevant idea is change correlation. Its product assembles resource events, deploy changes, ownership, logs, metrics, and service relationships into a timeline; Klaudia uses that operational context for investigation and recommended fixes. This is often the missing dimension in Kubernetes troubleshooting benchmarks: the current broken state may not reveal which of several recent changes caused it.

The public Helm repository verifies agent installation and data ingestion and contains release scenarios for image-pull failures, repeated deployment edits, memory leaks/OOM kills, jobs, and log chaos. It also exposes a `klaudiaIntegrationSync` capability. The Klaudia implementation and semantic quality tests are not public, so there is no independently inspectable RCA rubric, dataset, judge, or model comparison to evaluate.

**What to copy:** inject a timeline of controlled changes before failure and test whether the agent links the right change to the symptom. Useful cases include image update, ConfigMap change, resource-limit reduction, selector change, certificate rotation, policy/RBAC change, and traffic-shift regression.

References:

- [Komodor agent chart](https://github.com/komodorio/helm-charts/tree/master/charts/komodor-agent)
- [Release-check scenarios](https://github.com/komodorio/helm-charts/tree/master/.buildkite/release_checks/scenarios)
- [Agent integration tests](https://github.com/komodorio/helm-charts/tree/master/.buildkite/tests)
- [Klaudia product page](https://komodor.com/platform/klaudia/)

### DevOps AI Toolkit (`dot-ai`)

This is the project associated with Viktor Farcic's DevOps Toolkit work. It exposes Kubernetes querying, recommendation, manifest generation, policy/pattern management, capability discovery, and remediation through MCP and a CLI. The remediation loop requests cluster data, correlates observations, identifies a root cause, assigns confidence, and proposes executable commands with risk assessments.

Its evaluation system is broad:

- Real integration runs emit JSONL datasets with model, prompt/response, user intent, scenario, latency, token counts, iteration count, tool-call count, unique tools, status, completion reason, and failure metadata.
- Datasets cover remediation, recommendation, capability inference, organizational patterns, and policy creation.
- Comparative evaluators group the same scenario across models and use an LLM judge.
- The remediation rubric weights quality 40%, efficiency 30%, performance 20%, and communication 10%. Quality explicitly includes root-cause identification, solution appropriateness/safety, and diagnostic completeness.
- Reports compare nine models and include latency, cost, context-window failures, function-calling failures, and platform-wide recommendations.
- The repository reports hundreds of generated datasets and keeps human-readable analysis in source control.

The main caveat is methodological. The implemented core is described as **reference-free comparative evaluation**: a judge ranks candidate outputs without a gold root cause. This is useful for model selection but can reward a persuasive shared mistake. The project's own standards-gap analysis says the custom schema lacks statistical testing, standard experiment/version capture, and MLflow/LangSmith/W&B export. Some “standards compliance” material is a PRD or proposed structure rather than evidence of completed interoperability, so it should not be credited as implemented until the corresponding code and runnable artifacts exist.

**What to copy:** automatic trace-to-dataset capture, common scenario IDs across models, explicit cost/latency/reliability dimensions, failure taxonomy, and cross-tool reporting. Add gold RCA facts and deterministic postconditions before adopting its comparative judge design.

References:

- [DevOps AI Toolkit repository](https://github.com/vfarcic/dot-ai)
- [AI engine overview](https://github.com/vfarcic/dot-ai/blob/main/docs/ai-engine/index.md)
- [Remediation documentation](https://github.com/vfarcic/dot-ai/blob/main/docs/ai-engine/tools/remediate.md)
- [Remediation evaluator](https://github.com/vfarcic/dot-ai/blob/main/src/evaluation/evaluators/remediation-comparative.ts)
- [Remediation grading prompt](https://github.com/vfarcic/dot-ai/blob/main/src/evaluation/prompts/remediation-comparative.md)
- [Dataset analyzer](https://github.com/vfarcic/dot-ai/blob/main/src/evaluation/dataset-analyzer.ts)
- [Evaluation metrics capture](https://github.com/vfarcic/dot-ai/blob/main/src/core/providers/provider-debug-utils.ts)
- [Evaluation framework PRD](https://github.com/vfarcic/dot-ai/blob/main/prds/done/154-ai-evaluation-framework.md)
- [Standards-gap analysis](https://github.com/vfarcic/dot-ai/blob/main/prds/done/156-ai-evaluation-standards-compliance.md)
- [Published platform synthesis](https://github.com/vfarcic/dot-ai/blob/main/eval/analysis/platform/synthesis-report.md)

### kubectl-ai and k8s-ai-bench

`kubectl-ai` is a general agent that translates natural language into Kubernetes operations. It uses `kubectl` and shell tools, supports external MCP tools, captures traces, asks for confirmation before mutation by default, and can run tool execution in a sandbox.

Its separate benchmark, [`gke-labs/k8s-ai-bench`](https://github.com/gke-labs/k8s-ai-bench), is the strongest public task-completion harness in this survey:

- A task directory contains `task.yaml`, `setup.sh`, `verify.sh`, `cleanup.sh`, and optional artifacts.
- The harness can create a dedicated Kind cluster or vCluster per task.
- It invokes an agent binary with a kubeconfig, model/provider parameters, trace path, and a user prompt.
- Verification runs against the resulting cluster, so success does not depend on the agent claiming it succeeded.
- Text-only expectations are possible, but executable verification is preferred.
- The suite covers creation, updates, deletion, operations, misconfiguration repair, questions, and troubleshooting such as crash loops.
- Repeated runs produce Pass@1, Pass@5, and Pass^5, separating capability from consistency.
- Results can be emitted as Markdown, JSON, and JSONL and published to a live leaderboard.
- The `kubectl-expect` helper polls Kubernetes objects with CEL, enabling concise state assertions.
- Gatekeeper suite generation shows how an existing conformance corpus can be transformed into isolated eval tasks and how names can be obfuscated to avoid leaking answers.

**RCA strengths:** the environment and final repair are real, isolated, and deterministic. A model cannot pass by writing a convincing but ineffective answer. Repeated-run metrics are better than one-shot percentages.

**RCA weaknesses:** final-state success does not prove that the agent understood the root cause; trial-and-error can pass. The harness is coupled to `kubectl-ai`'s CLI flags rather than defining a neutral agent protocol. It does not make semantic RCA criteria mandatory or report diagnosis and remediation as separate scores.

**What to copy:** the task directory contract, isolated clusters, setup/verify/cleanup lifecycle, CEL postconditions, agent traces, answer-obscuring names, repeated runs, and pass/reliability metrics.

References:

- [kubectl-ai repository](https://github.com/GoogleCloudPlatform/kubectl-ai)
- [kubectl-ai periodic eval runner](https://github.com/GoogleCloudPlatform/kubectl-ai/blob/main/dev/ci/periodics/run-evals.sh)
- [k8s-ai-bench repository](https://github.com/gke-labs/k8s-ai-bench)
- [Task authoring guide](https://github.com/gke-labs/k8s-ai-bench/blob/main/contributing.md)
- [Task schema and CLI](https://github.com/gke-labs/k8s-ai-bench/blob/main/main.go)
- [Evaluation lifecycle](https://github.com/gke-labs/k8s-ai-bench/blob/main/eval.go)
- [Live leaderboard](https://gke-labs.github.io/k8s-ai-bench/)
- [`kubectl-expect`](https://github.com/GoogleCloudPlatform/kubectl-ai/tree/main/kubectl-utils)
- [Gatekeeper task-generation recipe](https://github.com/gke-labs/k8s-ai-bench/blob/main/docs/gatekeeper.md)

### K8sGPT

K8sGPT scans Kubernetes objects with deterministic analyzers and sends the resulting failure text to an LLM for a simpler explanation and suggested solution. Built-in analyzers cover Pods, Services, Deployments, ReplicaSets, StatefulSets, Nodes, PVCs, Ingresses, Jobs, CronJobs, PDBs, network policies, storage, security, and integrations including KEDA and Kyverno. An MCP server exposes analysis, resources, events, logs, filters, and troubleshooting prompts.

This architecture is less agentic than HolmesGPT: SRE knowledge in Go identifies known failure patterns, while the LLM mainly explains those findings. The repository thoroughly tests analyzers with fake Kubernetes clients. This gives strong precision for codified conditions and makes results reproducible, but no public suite was found that compares the natural-language explanation against gold outputs across models.

**What to copy:** deterministic analyzers as high-precision oracles and preconditions. They can cheaply label whether a fixture was detected, while a separate eval measures whether the assistant connects that finding into a broader causal explanation.

References:

- [K8sGPT repository](https://github.com/k8sgpt-ai/k8sgpt)
- [Security self-assessment and architecture](https://github.com/k8sgpt-ai/k8sgpt/blob/main/SECURITY_SELF_ASSESSMENT.md)
- [MCP server](https://github.com/k8sgpt-ai/k8sgpt/blob/main/MCP.md)
- [Pod analyzer](https://github.com/k8sgpt-ai/k8sgpt/blob/main/pkg/analyzer/pod.go)
- [Pod analyzer tests](https://github.com/k8sgpt-ai/k8sgpt/blob/main/pkg/analyzer/pod_test.go)
- [KEDA analyzer](https://github.com/k8sgpt-ai/k8sgpt/blob/main/pkg/integration/keda/scaledobject_analyzer.go)
- [AI explanation prompts](https://github.com/k8sgpt-ai/k8sgpt/blob/main/pkg/ai/prompts.go)

## Which frameworks are most advanced?

A single ranking hides different strengths, so the useful answer is by objective.

### Investigation and root-cause quality

1. **HolmesGPT**: live investigations, explicit expected facts, judge model, trajectory evidence, budgets, repeated runs, and historical reports.
2. **DevOps AI Toolkit**: detailed RCA/safety rubric and broad model comparison, but mostly reference-free comparison weakens factual assurance.
3. **kubectl-ai/k8s-ai-bench**: excellent behavioral proof, but does not require a correct causal explanation.

### Executable remediation and reliability

1. **kubectl-ai/k8s-ai-bench**: isolated real clusters, hard verification, cleanup, repeated-run metrics.
2. **HolmesGPT**: strong live setup and investigation, with emerging approved remediation support; its center of gravity remains investigation.
3. **DevOps AI Toolkit**: remediation commands and safety metadata are evaluated, but deterministic end-state verification is less central to the published evaluator.

### Agent architecture and protocol correctness

1. **kagent**: the best coverage of MCP, A2A, multiple runtimes, mock providers, cancellation, human-in-the-loop continuation, and Kubernetes-native deployment.
2. **kubectl-ai**: practical MCP/client/server, custom tools, sandbox execution, and tracing.
3. **HolmesGPT**: the broadest operational tool catalog and strong tool security tests.

### Incident context and user workflow

1. **Robusta + HolmesGPT**: strongest alert-to-evidence-to-RCA pipeline.
2. **Komodor/Klaudia**: strongest public product story around change timelines and correlation, but its eval evidence is private.
3. **Botkube**: strongest visible ChatOps interaction and approval patterns.
