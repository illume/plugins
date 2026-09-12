# @headlamp-k8s/ai-evals

Phase 1 evaluation framework plus a non-claiming Phase 2 foundation for the Headlamp AI Assistant: a local,
deterministic, offline-by-default developer loop that answers **"which
Headlamp behavior changed?"** from retained evidence, not from a blended
score. See [`docs/implementation-phases.md`](docs/implementation-phases.md)
for the full roadmap. Phase 2 exit claims remain gated by the complete roadmap.

## What this is (and is not)

- **Is**: a standalone TypeScript package with typed/versioned contracts,
  275 active, qualified public scenarios, deterministic graders, a canonical
  immutable result bundle, generated reports, a redacted public publication
  view, and offline golden exporter projections (LangSmith-native, OTLP).
- **Is not**: a release gate, a completed Phase 2 comparison, or a
  cross-system comparison, or a claim about free-form answer quality (natural
  language is retained but never scored in Phases 1–2).
- **Default execution is offline and deterministic.** The default cluster
  adapter is an in-memory simulation of the two KWOK-compatible scenarios;
  real `kubectl`/`kwokctl` execution and real product (Copilot/Azure)
  inference are strictly opt-in, and every unsupported capability (AKS
  without a caller-provisioned cluster, missing binaries) is reported as an explicit
  `unsupported`/`invalid` result — never faked.

### Phase 2A foundation status

The eight roadmap anchors and 263 generated descendants are committed with public
provenance, family/lineage, primary behavioral stratum, split, and qualification
metadata. All 271 Phase 2 scenarios were reviewed and qualified on 2026-09-12.
The loader fails closed if an active case is unqualified, if
qualification controls are incomplete, or if a derived case lacks an admitted
parent.

Repair contracts bind approval to the canonical request digest, candidate,
cluster identity, object UID, and current evidence digest. The journal validator
rejects execution without an approved authorization check. Actual mutation,
before/after inventory, postcondition execution, rollback execution,
browser/headless parity, scaled qualification, private holdouts, and external
tool comparison remain pending roadmap work.

Phase 2B now has a neutral, fail-closed reference-adapter qualification contract
for startup, health, lossless fixed-submission parity, non-mutation, and cleanup.
Concrete pinned HolmesGPT and K8sGPT adapters have not yet passed that contract,
so both systems remain unqualified and no comparison eligibility is implied.

The checked-in Phase 2B/2C comparison registration freezes a balanced 30-case
public roster and records an explicit disposition for Headlamp plugin, Headlamp
CLI, HolmesGPT, and K8sGPT in every cell. Inspect its validated status with:

```sh
npm run eval:comparison:status
```

The roster is frozen, but the comparison design remains `draft` and
confirmatory execution is blocked. Missing, invalid, censored, unsupported,
ineligible, and pending pairs now have typed, executable dispositions; the two
primary contrasts use a registered fixed-sequence multiplicity policy.
Repeat targets, the practical margin, adapter qualification, assignment
dispositions, and private-holdout access verification must be completed before
the loader permits a `locked` design. The status reports 22
declared families but only seven inherited lineages; those generated family
labels are not represented as independent incidents.

Inspect the qualified Phase 2 portfolio:

```sh
npm run eval:list-scenarios -- --profile local-minikube --portfolio phase-2
```

Regenerate the public Phase 2 draft portfolio and exercise every fixture on a
supported non-production cluster without grading or promoting it:

```sh
npm run eval:generate:phase2
npm run eval:qualify:minikube
npm run eval:qualify:aks
```

Generation produces exactly 275 public contracts across 25 proposed families
and the six registered behavioral strata. Generated variants are active and
qualified; the qualification commands check schema admission, setup,
mechanism oracle, observation capture, and namespace cleanup only. The AKS
command requires the dedicated non-production cluster and kubeconfig described
below.
Independent provenance, rights, family, security, and leakage review is still
required before any draft may be marked qualified or selected by a scored run.
Mechanism qualification alone does not support a best-in-class claim. That
claim remains gated by the Phase 2A-2E exits in
[`docs/implementation-phases.md`](docs/implementation-phases.md), including
independently reviewed families, private holdouts, repair and browser parity,
registered repeated comparisons, and qualified HolmesGPT and K8sGPT adapters.

See [ARCHITECTURE.md](ARCHITECTURE.md) for module ownership, adapter boundaries,
and the flow from scenario inputs to canonical and published results.

## Prerequisites

- Node.js 20+ and npm.
- The default dry-run needs no cluster, credentials, container runtime, or
  network access.
- Real local Minikube execution needs a running Docker daemon and compatible
  `docker`, `kubectl`, and `minikube` binaries on `PATH`. The runner starts or
  reuses only the dedicated `headlamp-ai-evals` profile, exports an isolated
  kubeconfig, and leaves the reusable profile running after the evaluation.
- Real local KWOK execution needs a running Docker daemon and compatible
  `docker`, `kubectl`, and `kwokctl` binaries on `PATH`. The runner creates and
  deletes its own `headlamp-evals-*` cluster and never uses the current
  kubeconfig context.
- Real AKS execution uses a dedicated **non-production** AKS cluster created
  by `npm run eval:aks:setup`. Its kubeconfig principal must be able to create/delete
  namespaces, apply fixtures, and create namespaced ServiceAccounts, Roles, and
  RoleBindings. The candidate itself receives a generated, short-lived,
  read-only namespaced kubeconfig.
- The `headlamp-cli` candidate needs the sibling `packages/ai-cli` dependencies
  and a provider configuration for live inference. The child process uses an
  empty temporary Headlamp data directory, so workstation Headlamp/MCP settings
  are deliberately ignored.

## Install

From `ai-assistant/` (recommended):

```sh
cd ai-assistant
npm ci
```

The top-level install also runs `npm ci` for `evals/`. Top-level type checking
and tests include the eval package:

```sh
npm run tsc
npm test
```

For an eval-only checkout or dependency refresh:

```sh
cd ai-assistant/evals
npm ci
```

## Quick start: live model on AKS

This path uses either GitHub Copilot or an auto-detected Azure model with a
dedicated, non-production AKS cluster. It creates billable Azure resources.
Before starting, install `az`, `kubectl`, Node.js 20+, and npm, then sign in to
Azure. For the GitHub Copilot option, also install and sign in to `gh`:

```sh
# Azure login, and set the correct subscription
az login
az account show --query '{name:name, id:id}' --output table
az account set --subscription <subscription-id-or-name>

# GitHub Copilot only
gh auth login
gh auth status
```

Create resource group and cluster.

```sh
cd ai-assistant
npm run eval:aks:setup
```

The setup command uses the current Azure subscription. It creates resource
group `rg-<username>-ai-assistant-evals-<location>-1` and cluster
`<username>-ai-assistant-evals-<location>-1`, then gets credentials with a
context of the same name. AKS node resources use the bounded group
`rg-<cluster-name>-nodes` and the subscription-supported
`Standard_A2_v2` size. The numeric suffix leaves room for additional eval
clusters. Setup writes a dedicated kubeconfig under `.private/`; the eval
runner finds that file automatically.

Without `--location`, setup reuses the alphabetically first location containing
a matching eval cluster for the username, or uses `eastus2` when none exists.
Specify a location with `npm run eval:aks:setup -- --location westus2`. Setup is
safe to rerun: an existing generated cluster is left unchanged, and its
credentials are refreshed in the dedicated kubeconfig.
Override the default node size when regional quota requires it with
`npm run eval:aks:setup -- --location westus2 --node-vm-size <size>`.

### GitHub Copilot

Run all AKS scenarios with GitHub Copilot:

```sh
npm run eval:aks
```

Specify a tested model explicitly when comparing providers or reproducing a run:

```sh
# Claude Opus 4.6
npm run eval:aks -- --model claude-opus-4.7

# GPT-5.4
npm run eval:aks -- --model gpt-5.4
```

The TypeScript command obtains the token from `gh` and passes `--provider` and
`--api-key` directly to the Headlamp AI CLI. No eval environment variables are
needed.

### Auto-detected Azure model

Run the same AKS scenarios with an auto-detected Azure model:

```sh
npm run eval:aks:azure
```

This uses the active `az` login and current Azure subscription. It selects the
first detected chat-capable Azure OpenAI or Azure AI Foundry deployment in that
subscription and passes its endpoint, deployment, model, and refreshed account
key directly to the Headlamp AI CLI. No model environment variables are needed.

When finished, delete the dedicated resource group to stop charges:

```sh
npm run eval:aks:delete
```

Deletion uses the same location selection as setup. To delete a specific
regional eval cluster, run `npm run eval:aks:delete -- --location westus2`.

## Quick start: deterministic offline run

From `ai-assistant/`:

```sh
npm run eval:check
npm run eval:local:kwok
```

Neither command uses an actual AI model or a real cluster. `eval:check` runs
formatting, type checking, and tests. `eval:local:kwok` uses the simulated
cluster adapter and a deterministic scripted reference control; it makes no
network calls and needs no model credentials. It runs only the two generated
KWOK-compatible selector scenarios and writes a bundle under
`ai-assistant/.eval-runs/`.

Useful offline controls:

```sh
npm run eval -- --profile local-kwok --candidate wrong
npm run eval -- --profile local-kwok --candidate reference --baseline wrong
npm run eval -- --profile local-kwok --case core-service-selector-fault-v1
npm run eval:list-scenarios -- --profile local-kwok
```

Runs and listings accept `--portfolio phase-1|phase-2`,
`--split development|regression|capability|safety|external_comparison|aks_parity`,
and `--stratum fault_diagnosis|healthy_control|insufficient_evidence|approved_repair|security_prompt_injection|multi_turn_tool_failure`.
`--include-pending` applies only to `list-scenarios`; pending cases cannot be
selected for a run.

`--candidate` accepts `reference`, `partial`, `wrong`, `abstaining`,
`overconfident`, `unsupported-evidence`, `unsafe-effective`, `injected`,
`malformed`, or `unavailable` (machine-authored controls that prove the
harness/grader and orthogonal safety gates are valid), or
`headlamp-cli` (the real product boundary, invoked as a subprocess of
`packages/ai-cli/src/cli.ts` through `tsx`). By default `headlamp-cli` runs
fully offline via `HEADLAMP_AI_MOCK_ALL=1` (the CLI's own deterministic
`mock-testing-model`); pointing it at a real provider or cluster is opt-in
and never happens by default.

## Real KWOK and Headlamp CLI runs

First verify Docker is running and the required binaries resolve:

```sh
docker info
kubectl version --client
kwokctl --version
```

Run the real isolated KWOK cluster with a scripted control:

```sh
npm run eval:local:kwok -- --execute real --candidate reference
```

To exercise the product CLI offline, ensure its dependencies are installed and
omit `--execute real`; the CLI uses its deterministic mock provider:

```sh
npm ci --prefix packages/ai-cli
npm run eval:local:kwok -- --candidate headlamp-cli
```

For live provider inference, `--execute real` disables the mock provider.
Configure the AI CLI only through these allow-listed variables:

```sh
export HEADLAMP_AI_PROVIDER=copilot
export HEADLAMP_AI_API_KEY='<token>'
# Optional when required by the provider:
export HEADLAMP_AI_MODEL='<model>'
npm run eval:local:kwok -- --execute real --candidate headlamp-cli
```

For Azure OpenAI:

```sh
export HEADLAMP_AI_PROVIDER=azure
export HEADLAMP_AI_API_KEY='<azure-openai-key>'
export HEADLAMP_AI_ENDPOINT='https://<resource>.openai.azure.com'
export HEADLAMP_AI_DEPLOYMENT_NAME='<deployment>'
export HEADLAMP_AI_MODEL='<model>'
npm run eval:local:kwok -- --execute real --candidate headlamp-cli
```

Do not put credentials in profiles, command arguments, scenario files, or
committed results. Profiles contain environment-variable **names** only.

## Real AKS run

For Azure OpenAI instead of GitHub Copilot, first create the cluster with
`npm run eval:aks:setup`, then provide the Azure model configuration:

```sh
export AKS_KUBECONFIG_PATH="$PWD/.private/evals-aks.kubeconfig"
export HEADLAMP_AI_PROVIDER=azure
export HEADLAMP_AI_API_KEY='<azure-openai-key>'
export HEADLAMP_AI_ENDPOINT='https://<resource>.openai.azure.com'
export HEADLAMP_AI_DEPLOYMENT_NAME='<deployment>'
export HEADLAMP_AI_MODEL='<model>'
npm run eval -- --profile aks --execute real --candidate headlamp-cli
```

Ordinary scored AKS runs select active, qualified scenarios that declare AKS
support. The non-scoring `eval:qualify:aks` command also exercises every
AKS-declared draft fixture without promoting it. Never point
`AKS_KUBECONFIG_PATH` at a production cluster.

## Results, reruns, and publication

Override private bundle storage with either
`HEADLAMP_AI_EVAL_RUNS_DIR=/approved/path` or `--runs-dir /approved/path`.
Contract archives default to the sibling `.eval-contracts/` directory. Use
`HEADLAMP_AI_EVAL_CONTRACTS_DIR=/approved/path` or
`--contracts-dir /approved/path` for a separately controlled store.
Use the same override for reruns and publication:

```sh
npm run eval:rerun -- --run <run_id> --trial <trial_id> --runs-dir /approved/path
npm run eval:export -- --run <run_id> --runs-dir /approved/path
npm run eval:report:publish -- --run <run_id> --runs-dir /approved/path
npm run eval:report:overall -- --check
```

`eval:export` verifies the closed canonical bundle before generating the
LangSmith and OTLP projections; normal runs do not generate exports implicitly.
`report:publish` creates a new immutable redacted directory under `results/runs/`;
`report:overall --check` verifies that the top-level generated views match all
published runs. Inspect `bundle/manifest.json` before treating a run as
qualification evidence; capabilities listed under `unsupported_files` are not
silently considered complete.

### Current qualification gap: `--baseline`/`--candidate`

The roadmap describes `--baseline <ref> --candidate <ref>` as two Git
revisions of Headlamp compared under the same scenarios. This MVP instead
lets `--baseline`/`--candidate` select two **candidate configurations**
(for example two scripted controls) run within the same bundle, and computes the
same `regression-deltas.jsonl` shape from their results. Comparing two actual Git
revisions (checking each out, building, and running both) is a natural
extension once this runtime is proven; it is deliberately deferred to keep
the ten-day Phase 1 vertical slice buildable. This is a documented
limitation, not a silent gap. Runs using this shorthand are diagnostic and do
not satisfy the Phase 1 exit gate. Identical baseline and candidate selectors
are rejected rather than reported as a meaningful regression comparison.

## Storage layout

- `../.eval-runs/` (gitignored, outside `evals/`) — canonical run bundles:
  `runs/<run_id>/bundle/...`, `runs/<run_id>/projections/{reports,exports}/...`.
  Override with `HEADLAMP_AI_EVAL_RUNS_DIR` or `--runs-dir`.
- `results/` (committed) — the redacted, public `public-github` disclosure
  projection: `README.md` (GitHub-rendered landing page),
  `overall-report.json`, `index.json`, and immutable
  `runs/<date>-<publication_id>/` summaries. Regenerated only from those
  immutable publication directories; deleting and rebuilding the three
  top-level files must reproduce the same content (`report:overall --check`
  verifies this).
- `scenarios/<scenario_id>/` — `scenario.yaml` (metadata, ownership,
  lifecycle), `setup.yaml` (Kubernetes fixture), `candidate-packet.json`
  (candidate-visible task), `evaluator-packet.json` (protected grader truth
  — never sent to any candidate process).
- `schema/` — versioned JSON Schemas used by `contracts/validate.ts`.
- `profiles/` — committed cluster/model profile configs
  (`local-kwok.yaml`, `local-minikube.yaml`, `aks-azure.yaml`); credentials are
  referenced by environment-variable name only, never serialized.

## Current limitations (deliberately not claimed)

- No cross-system comparison (HolmesGPT/K8sGPT begins in Phase 2).
- No free-form natural-language quality scoring.
- Provider responses expose usage, not invoice amounts. Each observed model call
  retains the provider, resolved model, actual service tier and inference
  geography when supplied, plus explicit input semantics. LangChain-normalized
  OpenAI, Copilot, and Anthropic input totals include cache reads/writes, which
  are subtracted exactly once to obtain uncached input. Raw Anthropic fallback
  usage retains its exclusive `input_tokens`; its 5-minute and 1-hour cache
  writes remain separate. Cache-write details are retained when the installed
  adapter exposes them.
- Pricing is optional enrichment, not part of the default operator workflow or
  evaluation validity. A normal run requires no pricing flags: it retains
  normalized per-invocation and aggregate usage, writes
  `configured_usage_estimate: null`, and can be priced later without rerunning
  the evaluation.
- Operators who already have an appropriate snapshot may calculate a
  reproducible configured usage estimate with
  `--pricing-source` and `--pricing-unit`. Token categories use
  `--uncached-input-rate-per-million`, `--output-rate-per-million`,
  `--cache-read-rate-per-million`, `--cache-write-rate-per-million`,
  `--cache-write-5m-rate-per-million`, and
  `--cache-write-1h-rate-per-million`. Copilot or another request-based policy
  can use `--request-rate`. Optional `--pricing-provider`, `--pricing-model`,
  `--pricing-service-tier`, `--pricing-effective-at`, and
  `--pricing-billing-mode` selectors are retained with the snapshot. The older
  `--input-usd-per-million`, `--output-usd-per-million`, and cache USD flags
  remain accepted as USD shorthands.
- For example, a Copilot allocation policy can use
  `--pricing-unit github_ai_credit --request-rate 1`, while an Anthropic snapshot
  can assign independent rates to uncached input, cache reads, 5-minute writes,
  1-hour writes, and output. Estimates are stored as category line items and
  totals are grouped by accounting unit. USD and GitHub credits are never added
  together. No live pricing is fetched and no built-in catalog is silently
  applied. These estimates are not provider invoices or billing records;
  subscriptions, included allowances, marketplace conversion, and invoice
  reconciliation require separate billing evidence.
- `local-minikube` requires real execution and is the local scheduler-backed
  substrate for all four Phase 1 cases; dry-run remains limited to the two
  deterministic KWOK-compatible cases.
- `aks` uses a dedicated username-named resource group and cluster provisioned
  by the TypeScript setup command.
- The `headlamp-cli` subprocess receives the trial kubeconfig in real mode and
  writes private metadata-only telemetry inside its isolated data directory.
  The adapter retains sanitized tool events, per-invocation model usage, and
  normalized aggregate counts in the canonical bundle; missing or malformed telemetry keeps mutation safety
  `unknown`, never silently passed. Prompts, responses, arguments, results,
  URLs, errors, credentials, endpoints, and kubeconfig data are excluded.
- The currently committed four-case Azure-model-on-Minukube publication is
  diagnostic-only. Fixture qualification on AKS does not substitute for a
  scored, immutable AKS parity run.
- Required `contract-refs.json` entries archive each scenario manifest,
  candidate packet, protected evaluator packet, and setup fixture by digest.
  The exact deterministic grader, verifier, safety policy, and complete schema
  registry are archived and verified alongside them.

## Tests

```sh
npm test        # tsx --test "src/**/*.test.ts"
npm run tsc      # typecheck only
npm run format   # prettier --check
npm run check    # format + tsc + test
```
