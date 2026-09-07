# @headlamp-k8s/ai-evals

Phase 1 evaluation framework under qualification for the Headlamp AI Assistant: a local,
deterministic, offline-by-default developer loop that answers **"which
Headlamp behavior changed?"** from retained evidence, not from a blended
score. See [`docs/implementation-phases.md`](docs/implementation-phases.md)
for the full roadmap this package implements Phase 1 of.

## What this is (and is not)

- **Is**: a standalone TypeScript package with typed/versioned contracts,
  four frozen Kubernetes scenarios, deterministic graders, a canonical
  immutable result bundle, generated reports, a redacted public publication
  view, and offline golden exporter projections (LangSmith-native, OTLP).
- **Is not**: a release gate, a cross-system comparison (that
  begins in Phase 2), or a claim about free-form answer quality (natural
  language is retained but never scored in Phases 1–2).
- **Default execution is offline and deterministic.** The default cluster
  adapter is an in-memory simulation of the two KWOK-compatible scenarios;
  real `kubectl`/`kwokctl` execution and real product (Copilot/Azure)
  inference are strictly opt-in, and every unsupported capability (Minikube,
  AKS without a caller-provisioned cluster, missing binaries) is reported as an explicit
  `unsupported`/`invalid` result — never faked.

## Prerequisites

- Node.js 20+ and npm.
- The default dry-run needs no cluster, credentials, container runtime, or
  network access.
- Real local KWOK execution needs a running Docker daemon and compatible
  `docker`, `kubectl`, and `kwokctl` binaries on `PATH`. The runner creates and
  deletes its own `headlamp-evals-*` cluster and never uses the current
  kubeconfig context.
- Real AKS execution needs a caller-provisioned, dedicated **non-production**
  AKS cluster. Its kubeconfig principal must be able to create/delete
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

## Quick start: deterministic offline run

From `ai-assistant/`:

```sh
npm run eval:check
npm run eval:local:kwok
```

This uses the simulated cluster adapter and scripted reference control. It runs
only the two generated KWOK-compatible selector scenarios and writes a bundle
under `ai-assistant/.eval-runs/`.

Useful offline controls:

```sh
npm run eval -- --profile local-kwok --candidate wrong
npm run eval -- --profile local-kwok --candidate reference --baseline wrong
npm run eval -- --profile local-kwok --case core-service-selector-fault-v1
npm run eval:list-scenarios -- --profile local-kwok
```

`--candidate` accepts `reference`, `wrong`, `malformed`, `unavailable`
(machine-authored controls that prove the harness/grader are valid), or
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

Use a dedicated non-production cluster and an explicit kubeconfig; the runner
does not provision or select an Azure cluster:

```sh
export AKS_KUBECONFIG_PATH="$PWD/.private/evals-aks.kubeconfig"
export HEADLAMP_AI_PROVIDER=azure
export HEADLAMP_AI_API_KEY='<azure-openai-key>'
export HEADLAMP_AI_ENDPOINT='https://<resource>.openai.azure.com'
export HEADLAMP_AI_DEPLOYMENT_NAME='<deployment>'
export HEADLAMP_AI_MODEL='<model>'
npm run eval -- --profile aks --execute real --candidate headlamp-cli
```

The AKS profile runs all four Phase 1 scenarios. Never point
`AKS_KUBECONFIG_PATH` at a production cluster.

## Results, reruns, and publication

Override private bundle storage with either
`HEADLAMP_AI_EVAL_RUNS_DIR=/approved/path` or `--runs-dir /approved/path`.
Use the same override for reruns and publication:

```sh
npm run eval:rerun -- --run <run_id> --trial <trial_id> --runs-dir /approved/path
npm run eval:report:publish -- --run <run_id> --runs-dir /approved/path
npm run eval:report:overall -- --check
```

`report:publish` creates a new immutable redacted directory under `results/runs/`;
`report:overall --check` verifies that the top-level generated views match all
published runs. Inspect `bundle/manifest.json` before treating a run as
qualification evidence; capabilities listed under `unsupported_files` are not
silently considered complete.

### Current qualification gap: `--baseline`/`--candidate`

The roadmap describes `--baseline <ref> --candidate <ref>` as two Git
revisions of Headlamp compared under the same scenarios. This MVP instead
lets `--baseline`/`--candidate` select two **candidate configurations**
(for example two scripted controls, or two `headlamp-cli` provider
profiles) run within the same bundle, and computes the same
`regression-deltas.jsonl` shape from their results. Comparing two actual Git
revisions (checking each out, building, and running both) is a natural
extension once this runtime is proven; it is deliberately deferred to keep
the ten-day Phase 1 vertical slice buildable. This is a documented
limitation, not a silent gap. Runs using this shorthand are diagnostic and do
not satisfy the Phase 1 exit gate.

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
  (`local-kwok.yaml`, `aks-azure.yaml`); credentials are referenced by
  environment-variable name only, never serialized.

## Known Phase 1 limitations (deliberately not claimed)

- No cross-system comparison (HolmesGPT/K8sGPT begins in Phase 2).
- No free-form natural-language quality scoring.
- `local-minikube` is a declared Phase 2 profile name with no Phase 1
  adapter; selecting it fails with an explicit message rather than a silent
  KWOK fallback.
- `aks` uses a caller-provisioned dedicated cluster and explicit kubeconfig;
  the eval runner does not provision Azure resources.
- The `headlamp-cli` subprocess receives the trial kubeconfig in real mode,
  but its internal tool events are not yet observable. Mutation safety is
  therefore reported as `unknown`, never silently passed.
- The currently committed two-control publication is diagnostic-only and does
  not satisfy the Phase 1 exit gate.
- `contract-refs.json` is explicitly unsupported by bundle format 1.1, so
  pass-critical source contracts are not yet independently resolvable after
  repository changes.

## Tests

```sh
npm test        # tsx --test "src/**/*.test.ts"
npm run tsc      # typecheck only
npm run format   # prettier --check
npm run check    # format + tsc + test
```
