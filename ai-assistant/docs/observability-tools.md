# Observability tools developer guide

The AI Assistant's observability integrations are built-in LangChain tools that call provider HTTP
APIs directly. They are not MCP server presets and do not require a provider-specific local runtime.
This guide describes their implementation, registration, safety requirements, and test coverage.

For user setup and credential requirements, see
[Read-only observability data sources](../README.md#read-only-observability-data-sources). For the
security analysis, see the [observability tools threat model](observability-threat-model.md).

## Tool inventory

The common provider tools are implemented in
`packages/ai-common/src/tools/observability/ObservabilityTools.ts`.

| Tool                        | Actions                                                |
| --------------------------- | ------------------------------------------------------ |
| `datadog_read`              | `logs`, `metrics`, `monitors`                          |
| `splunk_read`               | `search`, `indexes`, `saved_searches`                  |
| `grafana_read`              | `search_dashboards`, `get_dashboard`, `datasources`    |
| `prometheus_read`           | `query`, `query_range`, `metadata`, `targets`          |
| `azure_monitor_traces_read` | A bounded, workspace-local Azure Monitor Logs KQL read |

The Azure and AKS tools are implemented in
`packages/ai-common/src/tools/observability/AzureAksTools.ts`.

| Tool                              | Actions or data                                                        |
| --------------------------------- | ---------------------------------------------------------------------- |
| `azure_metrics_read`              | Azure Monitor metrics                                                  |
| `azure_resource_health_read`      | `current`, `history`                                                    |
| `azure_application_insights_read` | Workspace-local Application Insights KQL                               |
| `azure_diagnostics_read`          | `settings`, `categories`                                               |
| `azure_control_plane_logs_read`   | Allowlisted AKS control-plane and audit categories                      |
| `azure_network_config_read`       | `topology`, `effective_routes`, `effective_nsgs`                        |
| `azure_cost_capacity_read`        | `cluster`, `node_pools`, `quotas`, `utilization`, `costs`               |
| `azure_security_posture_read`     | `defender`, `policy`                                                    |
| `azure_deployment_changes_read`   | Azure Resource Graph change history for one resource                    |

## Runtime architecture

`ObservabilityTool` extends the built-in `LangChainTool` abstraction. Each concrete tool defines a
stable name, descriptions, a Zod argument schema, and a handler. `LangChainToolManager` validates
model-supplied arguments against the schema before calling the handler.

At session creation, `src/modal.tsx` passes an `ObservabilityToolContext` containing persisted
provider configuration and the optional desktop command runner. `LangChainToolManager` injects this
context into each enabled `ObservabilityTool`. The context may also provide a `fetch` implementation
for isolated tests.

The registration points are:

1. `packages/ai-common/src/tools/catalog/builtInTools.ts` constructs the runtime tools.
2. `packages/ai-common/src/tools/catalog/toolDefinitions.ts` exposes their settings metadata and
   identifies them as approval-gated observability tools.
3. `packages/ai-common/src/tools/settings/enabledTools.ts` resolves the enabled tool IDs from
   persisted plugin settings.
4. `packages/ai-ui/src/components/settings/ObservabilitySettings/ObservabilitySettings.tsx`
   configures provider endpoints and credentials.
5. `src/pluginState.tsx` persists the provider configuration and observability auto-approval
   preference.

Changing observability settings recreates the active tool manager, so subsequent calls receive the
current configuration.

## Request and result invariants

New tools and actions must preserve these invariants:

- Only provider-defined read operations are allowed. A `POST` is acceptable only for a read/query
  API with a fixed endpoint and bounded request shape.
- Remote endpoints must use HTTPS. Plain HTTP is accepted only for loopback development endpoints.
  URLs containing credentials are rejected.
- Requests reject redirects, use a 30-second overall deadline, and retry only bounded transient
  failures. Azure Resource Manager requests and polling remain pinned to the Microsoft origin.
- Query language inputs remain scoped to the configured service. Splunk SPL uses an explicit command
  allowlist; model-supplied KQL rejects cross-service and external-data operators.
- Time windows are limited to 24 hours. Item counts and nested collections are capped at 100.
  Responses are streamed with a 200,000-byte maximum before JSON parsing.
- Results pass through `toolResult`, which applies collection and model-facing output bounds.
- Provider errors must not include authorization headers, tokens, passwords, or full unbounded
  response bodies.
- Observability calls require explicit approval unless the user enables the separate persistent
  observability approval setting.

Do not weaken these controls to support a provider feature. Add a narrower action or a new tool with
provider-side least-privilege requirements instead.

## Azure authentication and discovery

Browser deployments supply short-lived Azure Monitor Logs and Resource Manager tokens in the
observability configuration. Desktop deployments may instead inject the command runner, which uses
`az account get-access-token` for the required audience. Tokens are not discovered through shell
commands other than that allowlisted Azure CLI operation.

Managed Grafana, Prometheus, and Log Analytics endpoints are discovered by
`packages/ai-common/src/tools/observability/AzureObservabilityDiscovery.ts`. Azure OpenAI and shared
subscription discovery live in `packages/ai-common/src/providers/detectProvider.ts`. Discovery uses
Azure REST APIs, rejects redirects and untrusted pagination URLs, and bounds pagination.

## Adding or changing a tool

1. Add the tool class and its strict Zod schema to the appropriate observability module.
2. Reuse the shared request, range, response, URL, resource-ID, and query validators.
3. Register the constructor in `builtInTools.ts`.
4. Add matching catalog metadata and the observability classification in `toolDefinitions.ts`.
5. Add or update settings fields only when the provider needs new connection data.
6. Add tests for every action, authentication headers, invalid arguments, endpoint restrictions,
   redirects, response limits, time limits, and error paths.
7. Update the user documentation and threat model when capabilities or trust boundaries change.

## Testing

Unit tests are colocated with the implementation:

- `packages/ai-common/src/tools/observability/ObservabilityTools.test.ts`
- `packages/ai-common/src/tools/observability/AzureAksTools.test.ts`
- `packages/ai-common/src/tools/observability/AzureObservabilityDiscovery.test.ts`
- `packages/ai-common/src/providers/detectProvider.test.ts`
- `packages/ai-common/src/tools/langchain/LangChainToolManager.test.ts`

Run the package checks from `ai-assistant`:

```sh
npm run check
```

The end-to-end harness in `e2e/run-ai-assistant-e2e.ts` starts local Prometheus and Grafana services
and provider-compatible fixtures for Datadog and Splunk:

```sh
npm run e2e
```

