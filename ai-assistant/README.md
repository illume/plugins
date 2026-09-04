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

The AI Assistant includes native tools for Datadog, Splunk, Grafana, and Prometheus. Configure
them under **Observability Data Sources** and enable the corresponding tool under **AI Tools**.
They use the browser's built-in `fetch` API and connect to provider-compatible HTTP endpoints, so
no MCP server, executable, container, Node.js package, or Python package is required.

Use dedicated least-privilege credentials. Tool results are sent to the selected model provider.
Self-hosted APIs must be reachable from Headlamp and allow its origin through CORS. Every native
tool is read-only, caps result counts at 100, uses a 30-second request timeout, and exposes no
create, update, or delete action.

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

Set the Prometheus-compatible API URL and optional HTTP token. For Thanos or Mimir, set the tenant
ID sent as `X-Scope-OrgID`. `prometheus_read` supports instant and range PromQL queries, metric
metadata, and active target discovery. Range queries are limited to 24 hours.
