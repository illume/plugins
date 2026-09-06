# Headlamp AI Assistant

The Headlamp AI Assistant is a plugin that integrates AI capabilities directly into Headlamp. It provides a conversational interface to interact with your Kubernetes clusters, helping you manage resources, troubleshoot issues, and understand complex configurations through natural language.

The assistant is context-aware, meaning it uses information about your cluster to provide more relevant and accurate responses.

**IMPORTANT:** This plugin is in alpha state!

## End-to-end tests

`npm run e2e` runs the complete cross-platform harness in `e2e/run-ai-assistant-e2e.ts`. It builds the plugin and Headlamp image, creates a KWOK cluster and the test fixtures, and runs the Playwright scenarios.

`npm run e2e:playwright` runs only the Playwright scenarios against an already running Headlamp instance. It does not build Headlamp or create the KWOK cluster. See [e2e/README.md](e2e/README.md) for setup and configuration.

## Key Features

- **Conversational Kubernetes Management**: Interact with your cluster using natural language. Ask questions, get explanations, and issue commands.
- **Context-Aware Assistance**: The AI has access to cluster information, making its responses relevant to your current setup.
- **Multi-Provider Support**: Choose from a wide range of AI providers.
- **Configurable Tools**: Fine-tune the AI's capabilities by enabling or disabling specific tools, like direct Kubernetes API access.
- **Resource Generation**: Ask the AI to generate Kubernetes YAML manifests for deployments, services, and more.
- **In-depth Analysis**: Get help diagnosing issues, understanding resource configurations, and interpreting logs.

## Supported Providers

The plugin supports multiple AI providers, allowing you to choose the one that best fits your needs:

- **OpenAI** (GPT models)
- **Azure OpenAI Service**
- **Anthropic** (Claude models)
- **Mistral AI**
- **Google** (Gemini models)
- **DeepSeek** (deepseek-v4-flash, deepseek-v4-pro)
- **OpenAI-Compatible** (vLLM, llama.cpp, and other OpenAI-compatible servers)
- **Local Models** (via Ollama)

You will need to provide your own API keys and endpoint information for the provider you choose to use. Please note that using AI providers may incur costs, so check the pricing details of your chosen provider.

## Adding Holmes Agent to Your Cluster

The AI Assistant can connect to a [HolmesGPT](https://holmesgpt.dev) agent running in your cluster for enhanced Kubernetes diagnostics and troubleshooting. Follow the steps below to deploy Holmes.

### 1. Add the Robusta Helm Repository

```bash
helm repo add robusta https://robusta-charts.storage.googleapis.com
helm repo update
```

### 2. Create a `values.yaml`

Below is an example using Azure OpenAI. For other providers (OpenAI, AWS Bedrock, etc.), see the [HolmesGPT installation docs](https://holmesgpt.dev/latest/installation/kubernetes-installation/#installation).

```yaml
# values.yaml
image: robustadev/holmes:0.19.1

additionalEnvVars:
  - name: AZURE_API_KEY
    value: ''
  - name: AZURE_API_BASE
    value: 'https://<your-azure-endpoint>.openai.azure.com'
  - name: AZURE_API_VERSION
    value: '2024-02-15-preview'
# Or load from secret:
# - name: AZURE_API_KEY
#   valueFrom:
#     secretKeyRef:
#       name: holmes-secrets
#       key: azure-api-key
# - name: AZURE_API_BASE
#   valueFrom:
#     secretKeyRef:
#       name: holmes-secrets
#       key: azure-api-base

modelList:
  azure-gpt4:
    api_key: '{{ env.AZURE_API_KEY }}'
    model: azure/gpt-5
    api_base: '{{ env.AZURE_API_BASE }}'
    api_version: '{{ env.AZURE_API_VERSION }}'
```

### 3. Render and Patch the Helm Template

Holmes requires enabling the AG-UI server for the AI Assistant to communicate with it. Render the template and update the container command:

```bash
helm template holmesgpt robusta/holmes -f values.yaml > rendered.yaml
```

In `rendered.yaml`, find the container command and change it to:

```yaml
command: ['python3', '-u', '/app/experimental/ag-ui/server-agui.py']
```

### 4. Deploy to Your Cluster

```bash
kubectl apply -f rendered.yaml
```

## MCP (Model Context Protocol) Server Support

The AI Assistant supports [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) servers, allowing you to extend the assistant's capabilities by connecting it to external tools and data sources.

> **Note:** MCP server support is currently available only in the **Headlamp desktop application**.

### What is MCP?

MCP is an open protocol that enables AI assistants to interact with external tools and services. By configuring MCP servers, you can give the AI Assistant access to specialized tools — for example, connecting it to [Flux](https://fluxcd.io/) for GitOps management or any other MCP-compatible tool.

### Configuring MCP Servers

Navigate to the AI Assistant settings to add and manage MCP servers. Each server is configured with:

- **Name** — A unique identifier for the server.
- **Transport** — Local `stdio`, streamable `HTTP`, or `SSE`.
- **Command** — The executable to run (e.g., `flux-operator-mcp`).
- **Args** — Command-line arguments (e.g., `serve --kube-context HEADLAMP_CURRENT_CLUSTER`).
- **Environment Variables** — Optional env vars required by the server (e.g., `KUBECONFIG`).
- **Server URL and Request Headers** — The endpoint and optional authentication for HTTP/SSE
  servers.

You can configure servers using the form-based UI or by editing the JSON configuration directly.

![MCP Servers List](mcp-servers-list.png)

![MCP Config Editor](mcp-config.png)

### Managing MCP Tools

Once servers are configured, the assistant automatically discovers the tools they expose. You can:

- Enable or disable individual tools per server.
- View tool descriptions and input schemas.
- Track tool usage statistics.
- Use bulk operations to enable or disable all tools at once.

### Read-only observability data sources

The AI Assistant includes native tools for Datadog, Splunk, Grafana, Prometheus, and Azure Monitor
traces. Configure them under **Observability Data Sources** and enable the corresponding tool under
**AI Tools**. They use the built-in `fetch` API and connect to provider-compatible HTTP endpoints,
so no MCP server, container, Node.js package, or Python package is required. Azure Monitor can
optionally use the desktop app's Azure CLI integration to obtain a short-lived access token.

Use dedicated least-privilege credentials. Tool results are sent to the selected model provider.
Self-hosted APIs must be reachable from Headlamp and allow its origin through CORS. Every native
tool is read-only, caps result counts at 100, uses a 30-second overall request timeout, retries
rate limits and transient network failures up to twice with bounded backoff, and exposes no create,
update, or delete action.

In the Headlamp desktop app, **Discover from Azure CLI** can fill the URL from Managed Grafana and
Azure Monitor workspace resources across subscriptions accessible to the active `az` identity.
Sign in with `az login`, run discovery, then explicitly choose a result. The plugin uses `az` only
to obtain an Azure Resource Manager token; subscription and endpoint discovery use Azure REST APIs.
Discovery never persists the ARM token or imports service credentials. Configure an appropriately
scoped Grafana service-account token or HTTP bearer token separately.

#### Datadog

Provide a scoped API key and application key. Because Datadog SaaS does not allow arbitrary browser
origins, browser deployments must set the base URL to a trusted, CORS-enabled reverse proxy for the
[Datadog site API](https://docs.datadoghq.com/getting_started/site/). The proxy must restrict its
upstream to Datadog and must not log credentials. `datadog_read` searches logs, queries metrics, and
lists monitors through the Datadog v1/v2 APIs. Log searches default to the last hour.

#### Splunk

Set the Splunk management API URL (normally `https://HOST:8089`) and provide either a Splunk token
or username and password for a search-only role. `splunk_read` runs one-shot searches and lists
indexes or saved searches. Searches default to the last 24 hours, return at most 100 results, and
must begin with the explicit `search` command followed only by allowlisted built-in read-only SPL
commands. A search-only role remains required to enforce the security boundary against custom
commands and server-side permission changes.

#### Grafana

Set the Grafana URL and a Viewer service-account token. Set an organization ID for multi-org
installations. `grafana_read` searches dashboards, retrieves a dashboard by UID, and lists data
sources using only Grafana `GET` endpoints.

#### Prometheus

Set the Prometheus-compatible API URL and optional HTTP token. For a local Prometheus, click
**Use http://localhost:9090**. A common Kubernetes installation can be made browser-accessible with:

```sh
kubectl -n monitoring port-forward svc/prometheus-operated 9090:9090
```

For Thanos or Mimir, replace the suggested URL and set the tenant ID sent as `X-Scope-OrgID`.
`prometheus_read` supports instant and range PromQL queries, metric metadata, and active target
discovery. Range queries are limited to 24 hours.

#### Azure Monitor traces for AKS

Enable Application Insights or OpenTelemetry trace export for the AKS workloads and send the data
to a Log Analytics workspace. In the desktop app, use **Discover from Azure CLI** and select that
workspace; otherwise enter
`https://api.loganalytics.azure.com/v1/workspaces/WORKSPACE_ID` and a Logs API access token.

`azure_monitor_traces_read` queries the `AppRequests`, `AppDependencies`, and `AppTraces` tables by
default. Queries are limited to a 24-hour window and 100 rows. The desktop app obtains a short-lived
token with `az account get-access-token`; discovery and trace queries themselves use Azure REST
APIs. The browser app cannot run Azure CLI, so it requires a manually configured access token.

#### Azure and AKS troubleshooting

The following additional tools use fixed Azure REST endpoints or bounded Azure Monitor Logs
queries. They never create, update, or delete Azure resources:

| Tool                              | Read-only data                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `azure_metrics_read`              | Azure Monitor metric values for one resource                                                                   |
| `azure_resource_health_read`      | Current and historical Resource Health availability                                                            |
| `azure_application_insights_read` | Bounded Application Insights KQL                                                                               |
| `azure_diagnostics_read`          | AKS diagnostic settings and supported categories                                                               |
| `azure_control_plane_logs_read`   | `AKSControlPlane`, `AKSAudit`, and `AKSAuditAdmin` logs                                                        |
| `azure_network_config_read`       | Network profile, related NSGs/routes/load balancers/NAT/private endpoints/private DNS, and effective NIC rules |
| `azure_cost_capacity_read`        | Node pools, autoscaler settings, compute quotas, utilization, and node resource-group infrastructure costs     |
| `azure_security_posture_read`     | Defender for Cloud assessments and noncompliant Azure Policy states                                            |
| `azure_deployment_changes_read`   | Azure Resource Graph change history                                                                            |

All result sets are bounded to 100 entries and 200,000 bytes. Time-series, log, cost, and change
queries are limited to 24 hours. User-supplied KQL cannot use cross-cluster, cross-database,
`externaldata`, HTTP, or `evaluate` operators. Effective route and NSG inspection use Azure's
read-only POST actions and only poll Azure Resource Manager URLs.

See the [observability tools developer guide](docs/observability-tools.md) for implementation and
extension guidance. The [STRIDE threat model](docs/observability-threat-model.md) documents trust
boundaries, per-tool threats and mitigations, and residual operational risks.

The desktop app uses `az` only for `account get-access-token`; every discovery and troubleshooting
operation is an HTTP API call. Browser deployments can instead provide separate short-lived **Logs
Access Token** and **Resource Manager Token** values. Assign only the permissions needed for the
enabled tools, such as Reader, Monitoring Reader, Security Reader, Policy Reader, and Cost
Management Reader.

#### Manual integration testing

Use a non-production Headlamp profile and dedicated test credentials. Enable only the tool being
tested, leave per-call approval enabled, and begin with a narrow query. Local services must be
reachable from the Headlamp process; browser deployments also require CORS headers.

##### Splunk in Docker

Start a single-node Splunk Enterprise instance (review the image license before accepting it):

```sh
export SPLUNK_PASSWORD='choose-a-local-test-password'
docker run --rm --name ai-splunk \
  -p 8000:8000 -p 8089:8089 \
  -e SPLUNK_START_ARGS=--accept-license \
  -e SPLUNK_PASSWORD \
  splunk/splunk:latest
```

Wait for `https://localhost:8000` to become ready, sign in as `admin`, and create an authentication
token for a role restricted to searching the test indexes. Configure **Splunk URL** as
`https://localhost:8089` and use the token, or the local admin credentials only for disposable
testing. Splunk's development certificate must be trusted by the Headlamp runtime. For browser
Headlamp, configure Splunk's allowed origins or use a trusted loopback reverse proxy that adds CORS
headers without logging credentials. Verify with a bounded query such as
`search index=_internal | head 5`, then remove the container with `docker stop ai-splunk`.

##### Prometheus and Grafana in Docker

Create a minimal Prometheus configuration and start both services:

```sh
mkdir -p /tmp/ai-observability
cat >/tmp/ai-observability/prometheus.yml <<'EOF'
global:
  scrape_interval: 5s
scrape_configs:
  - job_name: prometheus
    static_configs:
      - targets: ['localhost:9090']
EOF
docker run --rm -d --name ai-prometheus -p 9090:9090 \
  -v /tmp/ai-observability/prometheus.yml:/etc/prometheus/prometheus.yml:ro \
  prom/prometheus:latest
docker run --rm -d --name ai-grafana -p 3000:3000 \
  -e GF_SECURITY_ADMIN_PASSWORD='choose-a-local-test-password' \
  grafana/grafana:latest
```

Configure Prometheus as `http://localhost:9090` with no token and test `up`. For Grafana, open
`http://localhost:3000`, sign in as `admin`, create a service account with the Viewer role, create a
token, and configure that URL and token in Headlamp. Create a test dashboard, then ask the assistant
to search for it. Stop both containers when finished:

```sh
docker stop ai-prometheus ai-grafana
```

##### Azure CLI

Use the desktop app so the plugin can invoke `az`, and select a non-production subscription:

```sh
az login
az account set --subscription SUBSCRIPTION_ID
az account show --query '{name:name,id:id,user:user.name}' -o table
```

Open **Observability Data Sources**, choose **Discover from Azure CLI**, and explicitly select the
Grafana, Prometheus, or Log Analytics result to apply. Enable one Azure read tool at a time and test
it against a known resource ID. The signed-in identity should have only the corresponding read role,
such as Reader, Monitoring Reader, Security Reader, Policy Reader, or Cost Management Reader. Use
`az logout` after testing on a shared workstation.

##### Datadog developer trial

Create a Datadog trial organization, select its site (for example `datadoghq.com` or
`datadoghq.eu`), and create a dedicated API key plus an application key restricted to the read
permissions needed for logs, metrics, and monitors. Keep keys in environment variables while
checking access:

```sh
export DD_SITE='datadoghq.com'
export DD_API_KEY='your-test-api-key'
export DD_APP_KEY='your-test-application-key'
curl --fail --silent --show-error \
  -H "DD-API-KEY: $DD_API_KEY" \
  -H "DD-APPLICATION-KEY: $DD_APP_KEY" \
  "https://api.$DD_SITE/api/v1/validate"
```

Datadog SaaS does not permit direct requests from arbitrary browser origins. Configure Headlamp with
the HTTPS URL of a trusted CORS-enabled proxy pinned to `https://api.$DD_SITE`; do not put keys in
the URL or proxy logs. Run a narrow metric query such as `avg:system.load.1{*}` or list monitors,
confirm the result, then revoke both trial keys after testing.
