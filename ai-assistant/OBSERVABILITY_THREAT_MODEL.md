# Observability tools threat model

This document applies STRIDE to the native read-only observability and Azure/AKS troubleshooting
tools. It covers data access by the tool; the selected model provider receives successful tool
results and is a separate trust boundary.

## Scope and trust boundaries

Protected assets are provider credentials, Azure access tokens, telemetry, infrastructure metadata,
cost and quota data, and the availability of provider APIs. The principal boundaries are:

1. Model-generated arguments entering the built-in tool manager.
2. Headlamp sending authenticated HTTPS requests to a configured provider or Azure endpoint.
3. Desktop Headlamp asking `az` for short-lived Azure tokens.
4. Untrusted provider responses entering the assistant and selected model.

Administrators must trust configured endpoints and proxies, use provider-side least-privilege roles,
protect Headlamp and model-provider access, and review tool calls before approval. HTTP is accepted
only for loopback development endpoints. The tools do not provide an immutable audit log.

## Shared controls

- Built-in arguments are runtime-validated against their schemas. Resource IDs, regions, actions,
  time ranges, query sizes, and result limits receive additional validation at execution.
- Requests reject redirects. Credentialed remote endpoints require HTTPS; automatically acquired
  Azure tokens are sent only to their intended Microsoft endpoint.
- Provider responses are capped at 200,000 bytes, arrays at 100 entries, and nesting at 100 levels.
  Requests have 30-second deadlines; Azure continuation and asynchronous polling are bounded.
- Tools expose only fixed read endpoints or documented read-only POST operations. Provider RBAC is
  still the final authorization boundary.
- Telemetry can contain secrets or personal data. Returned data is disclosed to the configured model
  provider, so queries and credentials must be scoped to the intended environment.

## Per-tool STRIDE analysis

| Tool | Spoofing | Tampering | Repudiation | Information disclosure | Denial of service | Elevation of privilege |
| --- | --- | --- | --- | --- | --- | --- |
| `datadog_read` | A malicious configured proxy could impersonate Datadog; HTTPS and explicit configuration mitigate interception. | Only log-search POST, metric-query GET, and monitor GET operations are exposed; provider responses remain untrusted. | Datadog audit records and Headlamp logs may provide evidence, but the tool creates no immutable audit trail. | API/application keys stay in headers; log and metric results go to the model. Use narrowly scoped keys and a non-logging proxy. | Log windows, item counts, response bytes, nesting, and request duration are bounded. | Runtime action validation and Datadog RBAC prevent selecting mutation APIs; compromised credentials retain their provider-granted rights. |
| `splunk_read` | A configured Splunk server or proxy is trusted; remote credentials require HTTPS. | Only one-shot search and metadata endpoints are used. SPL must start with `search`; macros, subsearches, and non-allowlisted commands are rejected. | Splunk search/audit logs may identify activity; the plugin itself does not make records non-repudiable. | Search results and metadata may be sensitive and are sent to the model. Tokens or basic credentials are header-only. | Searches are limited to 24 hours and 100 results with request and response bounds. Provider search quotas remain recommended. | A search-only Splunk role is required because custom server commands and excessive provider permissions are outside local enforcement. |
| `grafana_read` | The configured Grafana origin is trusted and remote access requires HTTPS. | Only dashboard search/get and datasource-list GET endpoints are constructed; dashboard UIDs are path-encoded. | Grafana access logs may record reads; there is no plugin-managed immutable audit log. | Dashboards and datasource metadata go to the model. Viewer tokens should not grant datasource secrets or writes. | Results, bytes, nesting, and request time are bounded. | Runtime action validation plus a Viewer service-account role prevents mutation through this tool. |
| `prometheus_read` | The configured Prometheus-compatible origin is trusted; remote bearer tokens require HTTPS. | Only query, metadata, and target GET endpoints are constructed. PromQL cannot mutate Prometheus. | Provider access logs may record queries; no immutable audit record is created locally. | Series labels, target addresses, and metadata go to the model and can expose topology or tenant data. | Ranges are limited to 24 hours and 11,000 requested points; responses and request duration are bounded. | Runtime action validation and tenant headers constrain routing; provider authorization must isolate tenants. |
| `azure_monitor_traces_read` | CLI-acquired Logs tokens are restricted to `api.loganalytics.azure.com`; custom proxies require an explicitly configured token. | The tool only submits workspace queries and rejects redirects. Workspace-local KQL validation blocks external and cross-resource operators. | Azure and Headlamp logs may identify queries, but no immutable audit trail is guaranteed by the plugin. | Trace content may include secrets or personal data and is sent to the model. Tokens are short-lived or explicitly configured. | Queries use a 24-hour window, `take 100`, response limits, and a deadline. Complex workspace-local KQL can still consume service quota. | The Logs token and Azure RBAC define accessible workspaces; cross-workspace KQL constructs are rejected locally. |
| `azure_metrics_read` | ARM tokens are sent only to `management.azure.com`, and subscription-scoped resource IDs are validated. | Only the fixed Azure Monitor metrics GET endpoint is used. | Azure Activity/access logs may identify reads; the plugin does not provide non-repudiation. | Metric values and resource identifiers go to the model. | Metric names, time range, response size, and request duration are bounded. | Runtime schemas, resource-ID validation, fixed paths, and Azure RBAC prevent endpoint selection or writes. |
| `azure_resource_health_read` | ARM origin and resource IDs are validated. | Only current/history Resource Health GET endpoints are available. | Azure logs may record reads; no immutable local audit record is promised. | Health events and resource identifiers go to the model. | Responses and request duration are bounded; arrays are capped. | Runtime action validation, fixed paths, and Azure RBAC constrain access. |
| `azure_application_insights_read` | Logs-token origin controls match the trace tool. | Only a workspace query POST is used; workspace-local KQL validation blocks external and cross-resource access. | Azure query logs may provide evidence; the plugin does not guarantee non-repudiation. | Application telemetry can contain customer or secret data and is sent to the model. | The 24-hour window, `take 100`, response cap, and deadline limit load; complex local KQL remains a residual service-cost risk. | Workspace RBAC is the final boundary, reinforced by runtime validation and cross-resource KQL rejection. |
| `azure_diagnostics_read` | ARM origin and AKS resource identity are validated. | Only diagnostic-settings and category GET endpoints are exposed. | Azure access logs may record reads; no immutable plugin audit exists. | Destinations, categories, and resource IDs go to the model. | Responses, nesting, and duration are bounded. | Runtime action validation, fixed endpoints, and Reader/Monitoring Reader permissions prevent writes. |
| `azure_control_plane_logs_read` | ARM and Logs tokens are restricted to their respective official origins; the AKS resource ID is validated. | The tool builds fixed KQL for allowlisted categories and performs no control-plane mutation. | Workspace logs may identify the query; the plugin does not guarantee immutable attribution. | Audit and control-plane logs can contain identities, commands, and sensitive metadata and are sent to the model. | Time is limited to 24 hours and rows to 100; response and request bounds apply. | Category allowlisting, resource-scoped KQL, and workspace RBAC prevent arbitrary endpoint or cross-resource selection. |
| `azure_network_config_read` | ARM origin, AKS IDs, NIC IDs, and subscription identity are validated. | Topology uses GET/Resource Graph query; effective routes and NSGs use only fixed Azure read-only POST actions. Poll redirects remain on ARM. | Azure activity/access logs may record calls; no immutable local audit is created. | Routes, NSGs, private endpoints, DNS, and addresses reveal network topology and go to the model. | Resource Graph results, async polls, response size, and the overall deadline are bounded. | Runtime action validation, fixed suffixes, path-safe IDs, and Azure Reader permissions block arbitrary ARM operations. |
| `azure_cost_capacity_read` | ARM origin, cluster identity, subscription, and region format are validated. | Cluster, node-pool, quota, metric, and Cost Management requests are fixed read operations. | Azure access logs may record reads; local non-repudiation is not guaranteed. | Quotas, utilization, node-group identity, and cost data go to the model. | Time windows, metrics, results, responses, and request duration are bounded. | Region traversal is rejected; runtime action validation, node-resource-group scoping, and Azure RBAC constrain access. |
| `azure_security_posture_read` | ARM origin and AKS resource identity are validated. | Only Defender assessment GET and Policy Insights read-only query POST endpoints are used. | Azure logs may identify reads; the plugin has no immutable audit store. | Findings and compliance failures are sensitive and are sent to the model. | Policy results, response size, nesting, and request time are bounded. | Runtime action validation, fixed endpoints, and Security/Policy Reader roles prevent mutation or endpoint pivoting. |
| `azure_deployment_changes_read` | ARM origin and the full target resource ID are validated. | Only the fixed Resource Graph change-history query is submitted for that resource. | Azure logs may identify reads; no immutable plugin audit is guaranteed. | Change history can expose configuration and operator activity and is sent to the model. | The query window is at most 24 hours with bounded results, bytes, nesting, and duration. | The request body fixes one validated resource ID; Azure RBAC remains the authorization boundary. |

## Residual risks and operational guidance

- A compromised provider credential can be used outside these tools. Rotate credentials and restrict
  roles, scopes, source networks, and token lifetimes at the provider.
- A trusted proxy can observe credentials and results. Pin its upstream, disable sensitive logging,
  require HTTPS, and prevent user-controlled redirects.
- Read-only queries can still incur provider cost or expose sensitive data. Keep approval enabled,
  apply provider quotas, and avoid sending unnecessary results to a third-party model.
- Provider responses and telemetry are untrusted content and may contain prompt injection. Treat
  results as data, require approval for subsequent sensitive actions, and do not grant the model
  broader write-capable credentials.
- Azure discovery obtains a short-lived ARM token through `az`, bounds pagination, and validates
  returned URLs; selecting a discovered endpoint does not grant service credentials.
