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

## Observability-only draft scenarios

[`observabilityScenarios.ts`](observabilityScenarios.ts) defines a separate public,
synthetic suite of twelve cases in six paired families. These are **draft, pending
qualification**, not additions to the locked Phase 2 roster or its comparison
denominator. The cluster-only manifest/profile contract cannot yet express
external fixture services; these cases therefore use the dedicated
[`observabilityEvaluation.ts`](../runner/observabilityEvaluation.ts) adapter,
not `caseLogicFor` or the ordinary `list-scenarios` command.

The paired variants have byte-equivalent candidate packets and Kubernetes
snapshots, but different provider responses and accepted facts. A Kubernetes-only
candidate cannot distinguish the two causes. The synthetic environment explicitly
keeps provider audit, metrics, dashboard configuration, spans, and ARM state out of
Pod logs, events, ConfigMaps, and other Kubernetes objects. This is a controlled
capability test, not a claim that every real deployment hides those signals.

| Family | Production tool | External distinction between twins |
| --- | --- | --- |
| External queue lag | `prometheus_read` | Payments backlog versus inventory backlog |
| Payment API rejection | `datadog_read` | Provider tenant quota versus suspended merchant account |
| External gateway TLS | `splunk_read` | Expired partner certificate versus hostname mismatch |
| Dashboard scope drift | `grafana_read` | Staging datasource versus a retired namespace filter |
| Azure dependency failure | `azure_monitor_traces_read` | Cosmos DB 429 versus Azure SQL 40501 |
| AKS effective route | `azure_network_config_read` | Blackhole route versus incorrect appliance next hop |

All six tools are exercised by the observability browser E2E scenario. That E2E
uses real local Prometheus/Grafana and mocked other APIs. This draft suite instead
uses in-process synthetic responses for **all** providers, routed through the
same production argument validation, request construction, response bounding,
and tool-result code. It does not repeat the browser configuration/approval test.

Run the offline fixture and grader controls from `ai-assistant/evals`:

```sh
npm run eval:observability:check
```

Install the parent AI Assistant dependencies as well as the eval package before
running: the adapter dynamically loads the product tools from `ai-common` without
changing evals' Node module-resolution settings. No cloud credentials, cluster,
containers, or model calls are needed. The transport has no network fallback.

The command exercises all cases in three conditions:

- **Enabled:** a reference control reads Kubernetes and the required provider,
	then echoes retrieved facts into the existing diagnosis submission schema.
- **Kubernetes-only:** the same Kubernetes snapshot is available, but external
	calls are disabled; the expected control disposition is insufficient evidence.
- **Provider unavailable:** the tool exists but its exact request returns 403;
	this must not be reported as a solved incident or a healthy provider.

These results are explicitly `fixture-contract-verification` with zero model
invocations. The reference echo control validates fixtures and grading, not model
reasoning, and does not qualify a scenario or establish a capability advantage.

### Candidate adapter contract

`runObservabilityTrial(scenario, mode, candidate)` accepts an asynchronous
candidate callback. Give the candidate only its callback input, never the full
scenario object or this evaluator documentation. The input contains a cloned
candidate packet, enabled tool names, and `callTool(name, args)`. The packet
includes bounded read requests so these cases test retrieval access and evidence
interpretation, **not** query discovery or arbitrary PromQL/SPL/KQL execution.
Kubernetes reads use `GET /eval/kubernetes-snapshot`; this is an in-memory fixture
read, not a live Kubernetes endpoint.

Each successful read returns untrusted provider content and observations with
fresh evidence IDs, `tool/<tool_name>` resource references, JSON Pointer field
paths, and string-valued leaves. Return a JSON `diagnosis_submission@1.0.0` using
the existing [submission schema](../../schema/diagnosis-submission.schema.json).
The adapter reuses the existing exact-fact and no-action graders. A passing trial
must cite actually retrieved external facts, remain read-only, and not claim a
unique cause while uncertain. Guessing the gold values or replaying a citation
from another trial cannot pass. Results retain the parsed submission, observations,
call outcomes, and grading dispositions for inspection.

Unknown queries fail closed as unsupported fixture requests, rather than
receiving the answer to a different query. Each trial permits at most eight tool
calls. Mutating Kubernetes requests, disabled tools, and shell calls are rejected.
The callback is a trusted in-process adapter, **not a sandbox**: it must not give
the model filesystem access to the public fixtures, evaluator facts, or this
process. No live-model CLI or canonical comparison-bundle integration is claimed
by this draft suite. Live candidate runs, independent review, broader provider
query semantics, and qualification remain follow-up work before scored admission.
