# @headlamp-k8s/ai-evals

Phase 1 evaluation framework for the Headlamp AI Assistant: a local,
deterministic, offline-by-default developer loop that answers **"which
Headlamp behavior changed?"** from retained evidence, not from a blended
score. See [`docs/implementation-phases.md`](docs/implementation-phases.md)
for the full roadmap this package implements Phase 1 of.

## What this is (and is not)

- **Is**: a standalone TypeScript package with typed/versioned contracts,
  four frozen Kubernetes scenarios, deterministic graders, a canonical
  immutable result bundle, generated reports, a redacted public publication
  view, and offline golden exporter projections (LangSmith-native, OTLP).
- **Is not**: a CI service, a release gate, a cross-system comparison (that
  begins in Phase 2), or a claim about free-form answer quality (natural
  language is retained but never scored in Phases 1–2).
- **Default execution is offline and deterministic.** The default cluster
  adapter is an in-memory simulation of the two KWOK-compatible scenarios;
  real `kubectl`/`kwokctl` execution and real product (Copilot/Azure)
  inference are strictly opt-in, and every unsupported capability (Minikube,
  AKS without credentials, missing binaries) is reported as an explicit
  `unsupported`/`invalid` result — never faked.

## Prerequisites

- Node.js 20+ and npm.
- No cluster, credentials, or network access are required for the default
  `npm run check` / `npm run eval:local:kwok` path.
- Optional, for a real cluster run (`--execute real`): `kubectl`, `kwokctl`,
  and `docker` on `PATH`.
- Optional, for a real product run (`--candidate headlamp-cli`): the sibling
  `packages/ai-cli` package's dependencies installed
  (`npm install --prefix ../packages/ai-cli`), plus provider credentials if
  you want live inference rather than the offline `mock-testing-model`
  default.

## Install

```sh
cd ai-assistant/evals
npm install
```

## Running from the `ai-assistant` directory

The project root delegates to this package:

```sh
npm run eval -- <eval arguments>                 # tsx src/cli.ts run
npm run eval:check                                # npm --prefix evals run check
npm run eval:local:kwok -- <eval arguments>       # KWOK-compatible fast subset only
npm run eval:report:publish -- --run <run_id>
npm run eval:report:overall -- --check
```

Or from inside `evals/` directly:

```sh
npm run eval:local:kwok                                    # 2 kwok-compatible scenarios, reference control
npx tsx src/cli.ts run --profile local-kwok --candidate wrong
npx tsx src/cli.ts run --profile local-kwok --candidate reference --baseline wrong
npx tsx src/cli.ts run --profile aks --candidate reference  # always reports unsupported: no credentials
npx tsx src/cli.ts list-scenarios --profile local-kwok
npx tsx src/cli.ts report:publish --run <run_id>
npx tsx src/cli.ts report:overall --check
npx tsx src/cli.ts rerun --run <run_id> --trial <trial_id>
```

`--candidate` accepts `reference`, `wrong`, `malformed`, `unavailable`
(machine-authored controls that prove the harness/grader are valid), or
`headlamp-cli` (the real product boundary, invoked as a subprocess of
`packages/ai-cli/src/cli.ts` through `tsx`). By default `headlamp-cli` runs
fully offline via `HEADLAMP_AI_MOCK_ALL=1` (the CLI's own deterministic
`mock-testing-model`); pointing it at a real provider or cluster is opt-in
and never happens by default.

### Phase 1 MVP simplification: `--baseline`/`--candidate`

The roadmap describes `--baseline <ref> --candidate <ref>` as two Git
revisions of Headlamp compared under the same scenarios. This MVP instead
lets `--baseline`/`--candidate` select two **candidate configurations**
(for example two scripted controls, or two `headlamp-cli` provider
profiles) run within the same bundle, and computes the same
`regression-deltas.jsonl` shape from their results. Comparing two actual Git
revisions (checking each out, building, and running both) is a natural
extension once this runtime is proven; it is deliberately deferred to keep
the ten-day Phase 1 vertical slice buildable. This is a documented
limitation, not a silent gap.

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
- `aks` has a preflight-only stub adapter: it validates credential/tool
  presence and always reports `unsupported` until a real dedicated
  non-production AKS cluster is wired up (never fakes a cloud run).
- The `headlamp-cli` candidate observes trial state only through the task
  prompt (best-effort context injection), not through a live MCP kube tool
  bound to the trial's namespace; its diagnosis is graded honestly
  (`missing`/`malformed` when no valid sidecar is produced) rather than
  assumed correct.

## Tests

```sh
npm test        # tsx --test "src/**/*.test.ts"
npm run tsc      # typecheck only
npm run format   # prettier --check
npm run check    # format + tsc + test
```
