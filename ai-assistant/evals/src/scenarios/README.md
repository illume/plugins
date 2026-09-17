# Scenarios

Scenario code loads versioned case files and connects each scenario identity to the cluster observations needed to evaluate it. This keeps on-disk scenario content and mechanism-specific behavior out of the generic runner.

Start with:

- [`loader.ts`](loader.ts) for loading and cross-validating manifests, candidate packets, evaluator packets, and compatibility declarations.
- [`admission.ts`](admission.ts) for portfolio census, lineage/admission invariants, and Phase 2 selectors.
- [`caseLogic.ts`](caseLogic.ts) for the scenario-ID registry.
- [`cases/`](cases/) for implementations of scenario-family preflight and observation behavior.

Candidate and evaluator packets remain separate throughout loading. Adding a scenario normally means adding validated files under `evals/scenarios` and registering focused case logic, not modifying the trial runner.

Phase 2 anchors and generated descendants are `active` with
`qualification_status: qualified` after the 2026-09-12 review. Future scenarios remain
`draft` with `qualification_status: pending` until every
admission control passes. An active scenario must be qualified, and generated or
transformed descendants must identify a qualified parent before they can enter
eligible evidence.

## Provisioned Observability Scenarios

These scenarios create resources and cause an observable failure. The former
canned-response suite is removed, including its Datadog and Splunk cases. Nothing
in the execution path fabricates a healthy Kubernetes snapshot or provider response.

The dedicated [runner](../runner/observabilityEvaluation.ts) keeps these cases
outside the locked Phase 2 roster and qualified comparison denominator. Use
`npm run eval:observability -- list`, not the cluster-only `list-scenarios` command.
All cases remain pending independent qualification. An offline unit-test pass
does not count as Azure execution or a model diagnosis result.

The [live AKS GPT-4o report](../../docs/observability-aks-gpt4o-results.md) retains
the first execution outcomes: NSG partial diagnosis with successful recovery;
autoscaler evidence-grounding failure with failed recovery; cleanup passed for
all attempts. These results do not qualify either case independently.

### AKS Incidents

Each invocation creates a fresh tagged resource group, custom VNet, an AKS cluster
with a dedicated managed node resource group, and an isolated kubeconfig. It never
reuses the Phase 2 cluster or the current kubectl context.

**`aks-private-backend-nsg-deny-v1`** provisions an Azure CNI Overlay AKS cluster,
a private Ubuntu VM serving HTTP, a backend NIC, and its NSG. A Ready Pod must
first reach the backend successfully on three consecutive probes. The runner
then adds an NSG rule denying TCP 8080 from the AKS node subnet. Three failed
requests, a still-Ready Pod, a backend-local successful HTTP probe, and the exact
effective NSG deny must all be observed. The production `azure_network_config_read`
tool reads the real NIC effective rules. Deleting the injected rule must restore
three successful Pod requests. No public IP is attached to the backend VM.

**`aks-autoscaler-max-count-v1`** provisions a separate autoscaling user pool
with min/max/count all one. A BusyBox workload requests 60% of one node's
allocatable CPU and must become Ready. Scaling the workload to two replicas
induces a Pending replica with `Insufficient cpu` scheduler evidence. ARM must
report that autoscaling is enabled and the pool has reached maxCount=1. The
production `azure_cost_capacity_read` tool reads the live agent-pool settings.
Increasing the maximum to two must result in automatic node scale-out and two
Ready replicas; the runner never manually scales the node count.
The recovery update retries only Azure `OperationNotAllowed` responses identifying
an in-progress cluster operation, at most 60 attempts with ten seconds between
attempts. Other errors fail immediately. This retry was unit-tested after the
first live recovery failure; it has not yet been exercised in Azure.

These are realistic AKS troubleshooting tasks, not claims that Kubernetes can
never provide clues. Events can expose autoscaler limits; the Azure tool supplies
authoritative pool settings or effective network policy that standard Kubernetes
objects do not own. No events are hidden to force a favorable comparison.

### Azure Prerequisites And Cost

- Install dependencies in the parent AI Assistant and `evals` packages; install
	Azure CLI, kubectl, and ssh-keygen. Sign into the intended public-Azure tenant.
- Supply an explicit subscription ID, region, and **new** state directory whose
	parent exists. Sovereign Azure clouds are rejected by this implementation.
- Use a disposable non-production subscription with permission to create/delete
	resource groups, AKS, networks, VMs, and the managed-identity role assignments
	needed for a custom AKS VNet. Provider registrations and quota must already be
	available. The runner does not grant the operator extra permissions.
- Every run creates billable resources. Network case: one Standard_D2s_v5 AKS
	node plus one Standard_B1s backend. Capacity case: one system node and a user
	pool growing from one to two Standard_D2s_v5 nodes. Disks, load balancers,
	outbound traffic, and other Azure resources can also incur charges. Region
	prices and quota vary; there is no promised monetary cap.
- If the default node SKU is unavailable for your subscription/region, use
	`--node-vm-size Standard_A2_v2` (or another supported AKS SKU). The capacity
	scenario computes workload demand from the selected node's allocatable CPU.
- `--accept-azure-costs` is mandatory before any provisioning. Commands and
	convergence loops are bounded; cloud operations may continue after a local
	timeout. A terminated process cannot guarantee cleanup, so retain the state
	directory and retry cleanup. Never use this on a production cluster.

From `ai-assistant/evals`, this command **creates real Azure resources**:

```sh
npm run eval:observability -- verify \
	--scenario aks-private-backend-nsg-deny-v1 \
	--subscription "$AZURE_SUBSCRIPTION_ID" --location eastus2 \
	--state-dir "$PWD/.private/aks-network-run" \
	--workload-image busybox@sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0 \
	--accept-azure-costs
```

Use `aks-autoscaler-max-count-v1` with a different new state directory for the
other case. Create the `.private` parent before running. The BusyBox image must
provide `sh`, `httpd`, and `wget`; an immutable digest is required.

`verify` runs the baseline, induced fault, real product-tool detection, recovery,
and cleanup with **zero model calls**. A failed baseline or fault oracle aborts;
it is not a solved incident. The private `lifecycle.json` records the completed
stages, `azure-oracle.json` retains the live tool evidence, and `result.json` is
written only after recovery and cleanup succeed. `state.json` stores exact
ownership and cleanup status. Keep the 0700 directory and 0600 files private.

Cleanup runs in `finally`, even after partial setup or candidate failure. It checks
the resource-group ownership tag, deletes only that group, then verifies both it
and the AKS-managed node group are gone. Unowned groups and lingering node groups
cause a failed cleanup result, never a silent pass. Retry after interruption:

```sh
npm run eval:observability -- cleanup --state-dir "$PWD/.private/aks-network-run"
```

### Candidate Runs

[`createHeadlampObservabilityCandidate`](../candidates/headlampObservability.ts)
provides the actual AI Assistant `LangChainAssistantSession` adapter. Construct it
with `{ provider: 'azure', config: { model, deploymentName, endpoint, apiKey } }`
and default-export the returned callback from your private candidate module.
Acquire credentials in that private process; do not commit them. Each callback
creates a fresh session with only the allowed read tools. Its optional `record`
hook retains the original response, model/tool telemetry, and elapsed time.

`recordProgress` receives independent `HeadlampObservabilityRecord` snapshots at
startup, on observed telemetry, after completed tool payloads, and when final text
arrives. Persist snapshots as they arrive instead of waiting for the entire turn.
Both hooks are synchronous and should return promptly without throwing; callers
own persistence and should keep these records private. The adapter does not create
artifact files automatically.

Records include `status` (`running`, `completed`, `failed`, or `cancelled`) and
`error` separately from fact-selection validation errors. `record` fires once on
terminal disposition. On abort it fires immediately, before a stalled session or
tool must settle; partial planning usage and already-returned evidence sizes are
retained. Late responses cannot overwrite this record or become a submission.
The supplied AbortSignal still owns the deadline; the adapter creates no new
timer or automatic retry. Pre-cancelled calls are recorded without model requests.

Cancellation reaches the actual Azure-client planning and final-synthesis HTTP
signal in offline tests. The shared nonstreaming direct-call path now preserves
cancellation through tool processing, rejects cancelled model results, skips later
tool calls/final synthesis after cancelled work, and does not fall back after an
abort. An already-running `callTool` implementation must still honor the supplied
signal itself. Prompt settlement does not prove that a remote provider stopped
work or billing, nor that a shell/SDK tool with no cancellation support was killed.
Only reported usage events are retained; missing in-flight usage is unknown, not
zero. Do not infer a complete cost from a cancelled record.

`summarizeObservabilityUsage(record)` returns the versioned
`observability_observed_usage@1.0.0` projection. `observedUsageEvents` counts
telemetry events, not HTTP requests or provider retries. Input/output values are
observed subtotals, or `null` when no valid measurements exist; a reported zero
remains zero. Missing fields are counted separately. Input totals are withheld
when events have mixed or unknown input-token semantics, and the semantics are
retained so uncached-only counts cannot be mistaken for cache-inclusive totals.

Usage status is `unknown` without usable counts, `partial` for unfinished/failed
turns or missing fields, and `reported` only for a completed turn whose observed
events have both counts and consistent input semantics. `reported` describes the
available events, not a guarantee that the provider reported all billable work.
Do not label the last available usage event as final-synthesis usage after a
timeout: it might belong to planning. Keep progress and terminal artifacts separate
and use atomic replacement when writing snapshots to avoid partially written JSON.

Direct planning and strict/ordinary post-tool synthesis also emit
`model_invocation` events. Each has a session-local `invocation_id`, `phase`
(`planning` or `synthesis`), and `status` (`started`, `completed`, `failed`, or
`cancelled`). A terminal event includes elapsed `duration_ns`; a thrown provider
error may include a numeric `http_status`. No prompts, raw error messages, response
bodies, headers, or credentials are included in these lifecycle events. Recorders
can persist the start event even before usage is available. Cancellation emits
its terminal event immediately and does not later emit a second completion.

These events wrap logical LangChain invocations, not individual HTTP attempts.
`completed` means the invocation returned, not that the final selection passed
validation. Internal SDK retries, general chain fallbacks, MCP planning, and
streaming paths are not fully instrumented by this change. Do not infer their
request count or billable work from this event count. Usage remains a separate
event type; consumers must filter on `type` rather than assume the first event
contains token counts. An abort during tool processing may have only a completed
planning invocation and no synthesis invocation, which is expected.

For Azure/OpenAI, the factory defaults to `evidenceMode: 'compact-select'`,
`referenceStyle: 'numeric'`, and `strictFinalOutput: true`. Compact evidence removes
repeated metadata and raw/flattened duplication. Only model-selected references
are resolved into exact citations; no related fields are added automatically.
Other providers retain `evidenceMode: 'compact'` with legacy diagnosis output and
strict output off. This is an observability eval default, not a browser UI/CLI
chat change, and does not start paid inference by itself.

Explicit `evidenceMode: 'compact'` or `'full'` keeps legacy output and disables
strict synthesis by default. `strictFinalOutput: false` preserves prompt-only
selection without changing the evidence mode. `referenceStyle: 'field-labelled'`
remains opt-in. Explicit strict output requires `compact-select` and an
Azure/OpenAI provider; the selected model must support strict JSON Schema. An
unsupported strict call fails visibly, without an unconstrained retry; use an
explicit compact override for incompatible models. Strict output applies only to
post-tool synthesis, not initial planning or answer repair.

For a separately planned bounded-output experiment, strict Azure/OpenAI selection
accepts `finalResponseMaxOutputTokens` and `finalResponseTimeoutMs`. Both are unset
by default and recorded as `null` when omitted. The token limit must be a positive
safe integer; the timeout must be an integer from 1 through 2,147,483,647 ms.
Unsupported providers, non-strict modes, and invalid limits are rejected before
model requests. The selected deployment must still support the requested schema
and token budget; model context/output limits are not inferred automatically.

The token ceiling uses a separate final model with the same provider configuration,
leaving the planning model untouched. Offline HTTP tests verify `max_tokens` for
GPT-4o and the installed SDK's `max_completion_tokens` mapping for o3, on both
Azure and OpenAI paths. This is request-mapping coverage, not live qualification of
those deployments. Reasoning-model budgets may include reasoning as well as visible
output. A `length` result remains a failure, not repaired or silently retried as
an unconstrained answer.

The timeout starts at structured final synthesis, after planning and tool reads.
It aborts the active synthesis signal with a `TimeoutError` and settles the local
call even if the underlying promise ignores cancellation. It covers the logical
synthesis invocation, including any SDK retry time, rather than resetting per HTTP
attempt. Timers/listeners are removed after completion or cancellation. Set it
below the outer trial deadline; the earlier outer cancellation still wins and the
outer deadline continues to include preparation, planning, and tools. Strict
buffered streaming uses the same final path; ordinary free-form streaming is not
covered by these options.

An inner deadline is recorded as a failed candidate response, with a cancelled
synthesis invocation; outer cancellation is a cancelled candidate. Neither local
settlement nor a token ceiling guarantees provider completion, complete usage,
remote cancellation, or bounded billing. No defaults were promoted and no paid
comparison accompanied implementation of these limits.

The [first compact replay](../../docs/observability-compact-replay-results.md)
measured efficiency benefits but no accuracy gain. The
[20-session factorial](../../docs/observability-selection-factorial-results.md)
measured valid JSON in all strict responses and the strongest enabled result for
strict numeric selection, but persistent wrong-pool/omission and abstention errors.
The operator subsequently requested promoting the successful mechanisms; this
does not change either experiment's scores or qualify new models/incidents.
Use `gradeObservabilitySelection` as a supplementary evaluator with a publicly
declared fact budget; grounded references are not proof of causal reasoning.
The maintained [research, phases, results, and backlog](../../../docs/observability-research.md)
records the current defaults and remaining qualification gates.

Two independent options remain opt-in: `evidenceGrouping: 'object'` separates
per-pool/per-rule/Kubernetes-object records while retaining every fact and ID;
`diagnosticGuidance: 'aks'` adds general causal-selection and abstention guidance.
Defaults are `'read'` and `'none'`. Object grouping requires a compact mode.
Neither option repairs answers or adds unselected fields. The record hook retains
both effective settings. The [27-assignment report](../../docs/observability-object-guidance-results.md)
found no diagnosis improvement and retained six deadline failures; neither option
was promoted.

`evidenceLayout: 'fields'` is a separate opt-in presentation experiment requiring
object grouping and compact evidence. The default is `'rows'`; the record hook
retains the effective layout. Each object's `fields` map uses relative JSON-pointer
keys and arrays of `[reference, observed_value]` tuples. Append the relative key
to `object_path` to recover the original full path. Empty relative keys represent
the object itself; repeated paths retain separate references and values. Read,
resource, and evidence boundaries remain distinct. No paths are unescaped,
observations filtered, identity fields auto-selected, or resolver behavior changed.

`selectionContract: 'claims'` is an opt-in output-contract experiment; the default
is `'facts'`. Claims require strict Azure/OpenAI compact selection and object
grouping, with either row or field layout. The candidate record retains the
effective contract. The model returns `claim_selection@1.0.0` with `disposition`
(`cause`, `healthy`, or `insufficient`), `claims`, `alternative_dispositions`, and
`proposed_actions`. Each claim explicitly selects `identity_ref` plus nonempty
`fact_refs`. Identity must be a retrieved object's `/name`, `/id`, `/metadata/name`,
or `/metadata/uid`; every fact must share its read, resource, evidence ID, and
object group. Other identity shapes are not supported by this experiment.

Cause requires at least one claim. Healthy and insufficient require no claims;
they translate to no cause facts and uncertainty false/true respectively. Identity
references count toward the same fact budget. Unknown, duplicate, cross-object,
or contradictory selections fail without repair or automatic field expansion.
The resolver only translates explicitly selected identities/settings into the
existing submission schema. Grounded identities do not prove causal relevance;
well-formed wrong-object claims still reach the unchanged evaluator and can fail.
This combines new instructions, output schema, and source validation, not a test
of schema alone. General UI chat and the default fact-selection path are unchanged.

Parent objects and effective rules are separate claim groups. An observed nested
NSG ID does not substitute for a rule's own name reference when selecting that
rule's settings. Even a supported parent identity cannot cross that boundary;
matching ID/name values do not merge groups. The
[offline identity audit](../../../docs/observability-research.md#nested-nsg-identity-audit-offline-results-2026-09-18)
records the observed parent/rule mismatch without repairing or rescoring outputs.

`claimReferenceHint: 'example'` appends a syntax-only reference/value example to
the claim prompt. It requires `selectionContract: 'claims'`; its default is
`'none'`, and records retain the effective hint. The example distinguishes the
short reference token from the observed name/ID and explicitly warns against
copying its placeholder tokens. It does not change disposition instructions,
strict schema, source validation, evidence layout, or reference resolution.
Literal identities and unretrieved example tokens still fail without repair.

`gradeObservabilityCausality` is a separate prospective evaluator for explicit
required/supporting fact alternatives and healthy/insufficient dispositions.
It is not used to regrade prior runs or compute domain causal truth. Its contract
must remain evaluator-only, and callers still score safety independently.

Replace `verify` with `run` and add `--candidate-module /absolute/candidate.ts`
to evaluate a trusted model adapter during the induced-fault window. The module
must default-export a `LiveObservabilityCandidate` callback. It is invoked twice,
first with Azure reads enabled and then with Kubernetes-only reads. Create a
fresh model session per callback. Provider selection and model credentials belong
to that adapter; there is no default paid model invocation.

The candidate receives the user task, provisioned resource IDs, bounded read
requests, an AbortSignal, and a `callTool` function. It does **not** receive
baseline/fault oracle data, expected facts, provisioning authority, or credentials.
Kubernetes reads return actual Pods/events captured during the fault; Azure calls
invoke the production tool against live ARM with a short-lived CLI token. The
HTTP boundary permits only the fixed trial request and validated ARM continuation
URLs. No raw command runner is exposed to the model.

Return [diagnosis_submission@1.0.0](../../schema/diagnosis-submission.schema.json)
with exact cause facts, JSON Pointer field paths, and fresh retrieved evidence IDs.
The existing diagnosis and no-action graders reject uncited guesses and mutations.
Candidate access is capped at eight calls and 120 seconds; a timeout fails the
candidate and closes tool access. This trusted in-process callback is not an OS
sandbox: it must honor cancellation and must not expose local files or its own
shell to the model. `trials.json` keeps candidate dispositions separately from
infrastructure success. Fixed enabled-first order is exploratory, not a registered
statistical comparison. No canonical comparison-bundle integration is claimed.

### Real Local Services

`prometheus-scrape-outage-v1` starts a real Prometheus server and BusyBox exporter,
proves `up=1`, stops the HTTP exporter process, observes `up=0` through
`prometheus_read`, then restarts HTTP and proves `up=1` again.

`grafana-dashboard-datasource-drift-v1` starts real Grafana and Prometheus,
creates a working datasource and dashboard, then changes the saved datasource
UID to a missing one. A proxy query must return 404 and `grafana_read` must see
the incorrect UID. Restoring the UID must restore a successful query.

These use the E2E-pinned Prometheus/Grafana images, random container names,
loopback-only ephemeral host ports, a short-lived Viewer service-account token,
and label-checked cleanup. Local verification does not need Azure or model calls:

```sh
npm run eval:observability -- verify-local \
	--scenario prometheus-scrape-outage-v1 \
	--state-dir "$PWD/.private/prometheus-run" \
	--workload-image busybox@sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0
```

Use the Grafana ID and a new directory for its case. `cleanup-local --state-dir
<directory>` retries local cleanup. Local cases currently verify infrastructure
and product-tool detection, not a model comparison. Their evidence is retained
in `local-result.json`, with ownership and deletion status in `local-state.json`.

### Offline Tests

`npm run eval:observability:check` runs command-boundary and live-reader contract
tests with fake process/HTTP dependencies. It **does not provision** anything.
The provisioning commands above have no canned-response fallback. Keep live Azure
execution, unit-test validation, local service verification, and model outcomes
distinct when reporting results.
