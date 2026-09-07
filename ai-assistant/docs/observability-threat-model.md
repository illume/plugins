# Observability tools threat model

Last reviewed: 2026-09-06

This document applies STRIDE to the native read-only observability and Azure/AKS troubleshooting
tools. It records inherent and residual risk, implemented safeguards, operational requirements, and
accepted limitations. Successful tool results cross another trust boundary when sent to the selected
model provider.

## Risk method

Impact and likelihood are scored from 1 (minimal/rare) to 5 (severe/likely). The inherent score is
`impact × likelihood` before controls; the residual score is reassessed after controls:

| Rating               | Meaning                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| **Critical (20–25)** | Likely compromise with broad confidentiality, integrity, or availability impact; release-blocking.      |
| **High (12–19)**     | Credible attack with serious credential, telemetry, authorization, or service impact.                   |
| **Medium (6–11)**    | Attack requires additional access or has limited scope, but warrants mitigation or explicit acceptance. |
| **Low (1–5)**        | Unlikely or narrowly scoped impact with effective defense-in-depth controls.                            |

**Inherent risk** assumes the tool exists without its listed controls. **Residual risk** is the risk
after implemented controls and required deployment practices. Ratings are conservative and do not
replace provider-specific assessment.

## Scope, assets, and trust boundaries

Protected assets are provider credentials, Azure access tokens, telemetry, infrastructure metadata,
security findings, cost and quota data, and provider availability. The principal boundaries are:

1. Model-generated arguments entering the built-in tool manager.
2. Headlamp sending authenticated requests to a configured provider or Azure endpoint.
3. Desktop Headlamp asking `az` for short-lived Azure tokens.
4. Untrusted provider responses entering Headlamp and the selected model.
5. Administrators configuring endpoints, proxies, credentials, RBAC, and model providers.

Administrators must trust configured HTTPS endpoints and proxies, protect Headlamp and model-provider
access, and use provider-side least privilege. HTTP is accepted only for loopback development
endpoints. These tools do not provide an immutable audit log.

## Threat register

| ID  | STRIDE  | Scenario                                                                                                                | Impact | Likelihood | Inherent          | Controls and status                                                                                                                                                                                                                                                     | Residual        |
| --- | ------- | ----------------------------------------------------------------------------------------------------------------------- | -----: | ---------: | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| T1  | S, I, E | A malicious or intercepted endpoint steals credentials and returns forged data.                                         |      5 |          3 | **High (15)**     | **Implemented:** remote HTTPS requirement, embedded-credential rejection, redirect rejection, Azure origin and token-audience pinning. **Operational:** trust and secure configured proxies.                                                                            | **Medium (8)**  |
| T2  | E, I    | An overprivileged provider credential exposes data beyond the intended resource or tenant.                              |      5 |          3 | **High (15)**     | **Implemented:** fixed endpoints, runtime schema/action/resource validation, workspace-local KQL. **Operational:** least-privilege provider roles, tenant isolation, short token lifetime.                                                                              | **Medium (8)**  |
| T3  | I       | Sensitive telemetry, audit data, topology, findings, or costs are disclosed to the model provider.                      |      5 |          4 | **Critical (20)** | **Implemented:** explicit per-call approval by default, optional persistent approval with visible risk disclosure, result bounds, recognized-secret redaction before model processing. **Operational:** approved model/data policy and narrowly scoped queries.         | **Medium (10)** |
| T4  | T, E    | Prompt injection embedded in provider data attempts to override instructions or trigger another action.                 |      4 |          4 | **High (16)**     | **Implemented:** untrusted-data delimiters and system instructions forbid following embedded instructions; subsequent sensitive calls are approval-gated unless the user has persistently approved observability reads. **Residual:** model controls are probabilistic. | **Medium (8)**  |
| T5  | T, E    | Crafted arguments pivot a read tool to another endpoint, action, resource, or tenant.                                   |      5 |          3 | **High (15)**     | **Implemented:** Zod validation at execution, explicit action checks, fixed API suffixes, path-safe Azure IDs/regions, encoded dashboard IDs, fixed read-only methods.                                                                                                  | **Low (4)**     |
| T6  | T, E    | Query-language features escape the intended data scope or invoke unsafe server behavior.                                |      5 |          3 | **High (15)**     | **Implemented:** workspace-local KQL denylist; SPL command allowlist with macro/subsearch rejection; fixed control-plane KQL. **Operational:** workspace and search-only RBAC remain authoritative.                                                                     | **Medium (8)**  |
| T7  | D       | Expensive queries, large responses, recursive data, pagination, or polling exhaust client/provider resources.           |      4 |          4 | **High (16)**     | **Implemented:** 24-hour windows, result and byte caps, nesting limit, Prometheus point cap, 30-second deadlines, bounded pagination and polling. **Operational:** provider quotas.                                                                                     | **Low (4)**     |
| T8  | R       | A user disputes a sensitive read or administrators cannot attribute it.                                                 |      3 |          3 | **Medium (9)**    | **Implemented:** approval settings provide visible intent and persistent approval is explicit and revocable. **Operational:** retain provider and platform audit logs. **Accepted:** no plugin-managed immutable audit store.                                           | **Medium (9)**  |
| T9  | I, E    | Credentials appear in responses, errors, URLs, or model context.                                                        |      5 |          3 | **High (15)**     | **Implemented:** credentials forbidden in URLs, bounded error bodies, header-only authentication, structured/text secret redaction before model processing.                                                                                                             | **Low (5)**     |
| T10 | T, I    | Compromised discovery or asynchronous APIs redirect polling or repeatedly paginate to leak tokens or consume resources. |      5 |          3 | **High (15)**     | **Implemented:** ARM-origin polling, redirect rejection, repeated-token detection, page/poll/deadline limits, discovered URL validation.                                                                                                                                | **Low (5)**     |

No unmitigated **Critical** risks are known. T1–T4 and T6 retain **Medium** risk because endpoint trust,
credential scope, model behavior, and provider-side query semantics cannot be fully enforced locally.

## Per-tool classification

The rating is the highest credible residual risk for the tool. Threat IDs refer to the register above.

| Tool                              | Primary assets and threats                                             | Inherent | Residual   | Implemented controls                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------- | -------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `datadog_read`                    | Logs, metrics, monitors, API/application keys; T1–T5, T7–T9            | **High** | **Medium** | HTTPS, approval, runtime action/range limits, fixed log-search/metric/monitor APIs, response bounds, redaction |
| `splunk_read`                     | Search data, indexes, saved searches, token/basic credentials; T1–T9   | **High** | **Medium** | HTTPS, approval, search-only SPL allowlist, macro/subsearch rejection, 24-hour/100-result bounds, redaction    |
| `grafana_read`                    | Dashboards, datasource metadata, viewer token; T1–T5, T7–T9            | **High** | **Medium** | HTTPS, approval, GET-only fixed APIs, encoded UIDs, response bounds, redaction                                 |
| `prometheus_read`                 | Series, labels, targets, bearer token and tenant; T1–T5, T7–T9         | **High** | **Medium** | HTTPS, approval, fixed GET APIs, 24-hour and 11,000-point limits, response bounds, redaction                   |
| `azure_monitor_traces_read`       | Workload traces and Logs token; T1–T9                                  | **High** | **Medium** | Logs-origin pinning, approval, workspace-local KQL, 24-hour/100-row bounds, redaction                          |
| `azure_metrics_read`              | Resource metrics and ARM token; T1–T5, T7–T9                           | **High** | **Medium** | ARM-origin pinning, approval, validated resource IDs/metrics, fixed GET API, bounded range/results             |
| `azure_resource_health_read`      | Health events and ARM token; T1–T5, T7–T9                              | **High** | **Medium** | ARM-origin pinning, approval, validated IDs/actions, fixed GET APIs, response bounds                           |
| `azure_application_insights_read` | Application telemetry and Logs token; T1–T9                            | **High** | **Medium** | Logs-origin pinning, approval, workspace-local KQL, 24-hour/100-row bounds, redaction                          |
| `azure_diagnostics_read`          | Diagnostic destinations/categories and ARM token; T1–T5, T7–T9         | **High** | **Medium** | ARM-origin pinning, approval, validated AKS IDs/actions, fixed GET APIs, response bounds                       |
| `azure_control_plane_logs_read`   | Audit/control-plane identities and activity; T1–T9                     | **High** | **Medium** | Dual-origin token pinning, approval, allowlisted categories, resource-scoped fixed KQL, bounded results        |
| `azure_network_config_read`       | Routes, NSGs, endpoints, DNS, addresses; T1–T5, T7–T10                 | **High** | **Medium** | ARM-origin pinning, approval, type-safe IDs/actions, fixed read-only POSTs, safe bounded polling               |
| `azure_cost_capacity_read`        | Node pools, quotas, utilization and infrastructure costs; T1–T5, T7–T9 | **High** | **Medium** | ARM-origin pinning, approval, validated IDs/regions/actions, node-resource-group cost scope, bounds            |
| `azure_security_posture_read`     | Defender findings and Policy failures; T1–T5, T7–T9                    | **High** | **Medium** | ARM-origin pinning, approval, validated IDs/actions, fixed assessment/policy read APIs, bounds                 |
| `azure_deployment_changes_read`   | Configuration and operator change history; T1–T5, T7–T9                | **High** | **Medium** | ARM-origin pinning, approval, one validated resource ID, fixed change-query API, 24-hour/result bounds         |

## Mitigation implementation register

Statuses are **Implemented** (enforced by this repository), **Operational** (deployment requirement),
or **Accepted** (known limitation with no local control planned).

| Mitigation                                                                       | Status          | Evidence / owner                                                                                                                   |
| -------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Validate built-in arguments at execution                                         | **Implemented** | `packages/ai-common/src/tools/langchain/LangChainToolManager.ts`                                                                   |
| Require per-call approval by default                                             | **Implemented** | `packages/ai-common/src/tools/catalog/toolDefinitions.ts`, `assistant/LangChainAssistantSession.ts`                                |
| Offer explicit, revocable persistent approval for proactive diagnosis            | **Implemented** | `src/pluginState.tsx`, `src/modal.tsx`, `packages/ai-ui/src/components/settings/ObservabilitySettings/ObservabilitySettings.tsx`   |
| Show guided setup and risk disclosures before persistent approval                | **Implemented** | `packages/ai-ui/src/components/settings/ObservabilitySettings/ObservabilitySettings.tsx`                                           |
| Restrict remote credentialed transport to HTTPS and reject redirects             | **Implemented** | `packages/ai-common/src/tools/observability/ObservabilityTools.ts`, `AzureAksTools.ts`                                             |
| Pin automatically acquired Azure tokens and async polling to Microsoft origins   | **Implemented** | `ObservabilityTools.ts`, `AzureAksTools.ts`                                                                                        |
| Validate actions, Azure resource identity, regions, paths, and query windows     | **Implemented** | `ObservabilityTools.ts`, `AzureAksTools.ts`                                                                                        |
| Restrict KQL/SPL and fixed read-only POST operations                             | **Implemented** | `ObservabilityTools.ts`, `AzureAksTools.ts`                                                                                        |
| Bound bytes, rows, nesting, points, request duration, pagination, and polling    | **Implemented** | `ObservabilityTools.ts`, `AzureAksTools.ts`, `AzureObservabilityDiscovery.ts`                                                      |
| Redact recognized credentials before model processing                            | **Implemented** | `packages/ai-common/src/security/redactSecrets.ts`, `tools/results/formatToolResults.ts`, `assistant/LangChainAssistantSession.ts` |
| Delimit tool output as untrusted data and forbid following embedded instructions | **Implemented** | `packages/ai-common/src/prompts/buildSystemPrompt.ts`, `tools/results/prepareToolResponse.ts`                                      |
| Configure least-privilege roles, tenant isolation, quotas, and trusted proxies   | **Operational** | Deployment administrator; see setup guidance in `README.md`                                                                        |
| Retain provider/platform audit logs                                              | **Operational** | Deployment administrator and provider                                                                                              |
| Immutable plugin audit log                                                       | **Accepted**    | Not implemented; rely on provider/platform auditing                                                                                |
| Deterministic prompt-injection elimination                                       | **Accepted**    | Not achievable through prompting alone; approval gates and least privilege limit impact                                            |

## Residual risk and review triggers

- A compromised credential can be used outside these tools. Rotate credentials and restrict roles,
  scopes, source networks, and token lifetimes at the provider.
- A trusted proxy can observe credentials and results. Pin its upstream, disable sensitive logging,
  require HTTPS, and prevent user-controlled redirects.
- Secret redaction is defense-in-depth and cannot identify every domain-specific sensitive value.
  Avoid broad queries and apply model-provider data governance.
- Read-only queries can still incur provider cost. Keep per-call approval enabled unless proactive
  diagnosis is required, and apply provider quotas. Persistent approval remains active across restarts
  until the user disables it.
- Review this model when adding a provider, endpoint, query feature, authentication mechanism,
  automatic approval path, model destination, or materially changing result processing.
