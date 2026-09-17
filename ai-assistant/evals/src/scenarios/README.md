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
