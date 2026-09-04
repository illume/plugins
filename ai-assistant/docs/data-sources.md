# Connecting observability data sources

The AI Assistant can investigate observability data through a local MCP server or through a
[HolmesGPT](https://holmesgpt.dev) agent. Choose one path for each data source:

- **Desktop MCP** is useful when the data source is reachable from the workstation running
  Headlamp.
- **HolmesGPT in Kubernetes** is useful when data is available only inside the cluster or when one
  agent should correlate Kubernetes, metrics, and logs.

Skills and runbooks supplement either path with organization-specific investigation steps, but
they do not provide credentials or data access themselves.

## Desktop MCP

MCP support currently requires the Headlamp desktop application. The assistant starts each
configured server as a local command and communicates with it over standard input/output (stdio).
It cannot connect directly to a remote HTTP MCP endpoint.

Install and test the MCP server first, then add it under **Settings > AI Assistant > MCP Servers**.
Headlamp uses an `enabled`/`servers` array rather than the `mcpServers` object shown in many
upstream examples.

| Data source | Recommended MCP option | Headlamp connection |
| --- | --- | --- |
| Datadog | [Datadog's managed MCP server](https://docs.datadoghq.com/bits_ai/mcp_server/) | The managed server is remote HTTP, so use a trusted local stdio-to-HTTP bridge or the HolmesGPT Datadog integration. Follow Datadog's authentication and regional endpoint instructions. |
| Splunk | [MCP Server for Splunk Platform](https://splunkbase.splunk.com/app/7931) | The Splunk server is remote HTTP, so use a trusted local stdio-to-HTTP bridge or a custom HolmesGPT toolset. Create a least-privileged Splunk MCP token as described by Splunk. |
| Grafana | [Grafana MCP server](https://github.com/grafana/mcp-grafana) (official open source) | Run the server locally in stdio mode. It can query Grafana, Prometheus, Loki, incidents, and dashboards exposed by the configured Grafana instance. |
| Prometheus | [Prometheus MCP server](https://github.com/pab1it0/prometheus-mcp-server) (community maintained) | Run the server locally in stdio mode. Review and pin a release before production use because this is not a Prometheus project. |
| Kubernetes | Use the assistant's built-in Kubernetes tools first; [Kubernetes MCP Server](https://github.com/containers/kubernetes-mcp-server) is a community alternative. | Use `HEADLAMP_CURRENT_CLUSTER` for the selected context and enable read-only mode for investigations. |

Remote bridges execute locally and handle valuable credentials. Review the bridge's source and
publisher, pin its version, and use the authentication method documented by the data-source vendor.

### Grafana example

Install [`uv`](https://docs.astral.sh/uv/getting-started/installation/) and create a Grafana service
account with only the permissions needed for investigation:

```json
{
  "enabled": true,
  "servers": [
    {
      "name": "grafana",
      "command": "uvx",
      "args": ["mcp-grafana"],
      "env": {
        "GRAFANA_URL": "https://grafana.example.com",
        "GRAFANA_SERVICE_ACCOUNT_TOKEN": "<service-account-token>"
      },
      "enabled": true
    }
  ]
}
```

See the upstream [Grafana configuration
reference](https://github.com/grafana/mcp-grafana#configuration) for Grafana Cloud, TLS, and
authentication alternatives.

### Prometheus example

This example runs the community server in Docker. Replace the image tag with a reviewed, pinned
release:

```json
{
  "enabled": true,
  "servers": [
    {
      "name": "prometheus",
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "PROMETHEUS_URL",
        "ghcr.io/pab1it0/prometheus-mcp-server:<version>"
      ],
      "env": {
        "PROMETHEUS_URL": "https://prometheus.example.com"
      },
      "enabled": true
    }
  ]
}
```

The upstream server also supports basic authentication, bearer tokens, custom headers, mTLS, and
custom CA bundles. Prefer a query-only identity.

## HolmesGPT in Kubernetes

Follow the [Holmes installation steps](../README.md#adding-holmes-agent-to-your-cluster), then
configure the relevant [data sources](https://holmesgpt.dev/latest/data-sources/). Holmes provides
documented integrations for
[Datadog](https://holmesgpt.dev/latest/data-sources/builtin-toolsets/datadog/),
[Grafana MCP](https://holmesgpt.dev/latest/data-sources/builtin-toolsets/grafana-mcp/), and
[Prometheus](https://holmesgpt.dev/latest/data-sources/builtin-toolsets/prometheus/). For Splunk,
define a [custom toolset](https://holmesgpt.dev/latest/data-sources/custom-toolsets/) that exposes
only approved saved searches or read-only search commands.

Store credentials in Kubernetes Secrets or an external secret provider and inject them into the
Holmes deployment; do not place them directly in Helm values committed to Git. Apply Kubernetes
NetworkPolicies where available so the Holmes pod can reach only the Kubernetes API, model
provider, and configured data sources.

## Data sources inside Kubernetes

An MCP command runs on the Headlamp desktop, not inside the cluster. Its endpoint must therefore be
reachable from that workstation (and from its container, if the MCP server runs in Docker).

For a temporary local connection, forward the service and point the MCP server at the forwarded
address:

```bash
kubectl --context <context> -n monitoring port-forward service/prometheus-server 9090:80
kubectl --context <context> -n monitoring port-forward service/grafana 3000:80
```

Service and port names vary by chart. Do not expose an unauthenticated Prometheus or Grafana
service publicly. For ongoing use, prefer private networking, TLS, and a read-only service
identity. If a Docker-based MCP server cannot reach a host loopback port, use the container
runtime's host address or networking option.

The assistant's built-in Kubernetes tools can inspect resources, events, and pod logs using the
current Headlamp cluster. A Kubernetes-aware MCP server can use
`HEADLAMP_CURRENT_CLUSTER` in its argument list; Headlamp replaces it with the selected kubeconfig
context when the cluster changes.

## AKS

When the plugin runs in AKS Desktop, it preconfigures the official
[Azure AKS MCP server](https://github.com/Azure/aks-mcp) with read-only access. For another
Headlamp desktop host:

1. Install `aks-mcp` from an official release and make it available on `PATH`.
2. Authenticate with `az login`, select the correct subscription, and obtain only the AKS access
   required by the operator.
3. Add this server configuration:

```json
{
  "enabled": true,
  "servers": [
    {
      "name": "aks-mcp",
      "command": "aks-mcp",
      "args": [
        "--transport",
        "stdio",
        "--access-level",
        "readonly",
        "--enabled-components",
        "az_cli,monitor,fleet,network,compute,detectors,advisor,inspektorgadget"
      ],
      "enabled": true
    }
  ]
}
```

The `monitor` component can investigate Azure Monitor and Container Insights. For Azure Managed
Prometheus or Azure Managed Grafana, use the AKS/Azure Monitor tools or configure the corresponding
Grafana/Prometheus MCP server with its private endpoint and Azure-supported authentication.

AKS MCP is intended to run locally for one trusted user. Its access-level flag reduces accidental
changes but is not an authorization boundary: the process inherits the user's Azure and Kubernetes
permissions. Do not expose it as a shared network service.

## Runbooks as Skills

Use Skills for repeatable procedures such as “pod crash-looping,” “latency regression,” or
“missing metrics.” A useful runbook tells the assistant:

1. which cluster, namespace, service, dashboard, and time window to identify;
2. which Kubernetes events and logs to inspect;
3. which saved searches or PromQL/LogQL queries to run;
4. how to correlate deployment changes, alerts, traces, and incidents; and
5. which actions require operator confirmation and when to escalate.

Add runbooks under **Settings > AI Assistant > Skills**. Supported formats are `SKILL.md`,
`*.instructions.md`, and Markdown with skill front matter. Desktop builds can load an absolute local
path; all builds can load an HTTPS GitHub repository. Pin Git sources to a commit and optionally
set the SHA-256 integrity value. Never put API keys or tokens in a Skill.

## Validate and secure the connection

After saving a server, open its tool list and enable only the required tools. Start with
`autoApprove` disabled, ask the assistant for a harmless inventory or health query, and verify the
result directly in the source system.

- Use dedicated, read-only service identities and the narrowest data scope.
- Keep secrets out of Git, runbooks, prompts, and screenshots; rotate any exposed credential.
- Restrict network access to the required endpoints and retain provider audit logs.
- Treat third-party MCP output as untrusted data and require approval for write-capable tools.
