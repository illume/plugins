# Kubernetes scenario validation progress

Status: live draft validation started, 2026-09-21

The active roster remains fixed at 275 qualified scenarios. Draft validation uses
absolute portfolio numbering, so scenario 276 is the first pending rule-gap draft.
Validation does not promote a draft or change canonical qualification coverage.

## Current result

The `local-minikube` validator executed portfolio scenarios 276 through 505:

- 159 scenarios passed fixture application, trusted Kubernetes API or decoded
  ConfigMap observation, accepted-fact matching, contradiction rejection, and
  fixture plus namespace cleanup;
- 36 scenarios were skipped because they require another profile, a missing CRD
  or removed API, or source-manifest evidence erased by API defaulting;
- 35 scenarios remain failed, concentrated in temporal metrics, scheduler,
  node, storage-controller, and admission-invalid fixture evidence;
- all validated scenarios retain `qualification_status: pending`.

The next sequential resume point is scenario 506. The failed scenarios in the
covered range should be revisited by mechanism rather than hidden by later passes:
runtime convergence and metrics begin at 331, storage/controller evidence at 365,
and the next telemetry-heavy block begins at 450.

Validation now supports typed YAML and JSON data decoding, dotted Kubernetes map
keys, exact related-resource inventories, generated Job Pod selection, Pod logs,
and bounded controller convergence. It deletes the complete fixture before its
namespace so cluster-scoped objects cannot leak into later runs. One unavailable
APIService exposed this requirement during development; the leaked object and all
empty terminating validation namespaces were removed before validation resumed.

## Command

Run a bounded range against the dedicated Minikube profile:

```sh
npm run eval:validate:drafts -- \
  --profile local-minikube \
  --start 276 \
  --limit 1 \
  --output .private/draft-validation.json
```

The validator starts or reuses `headlamp-ai-evals`, applies each setup in an
isolated namespace, reads resources through the trusted adapter boundary, deletes
the fixture, and then deletes the namespace. Unsupported profiles and API kinds
are reported as skipped. Unsupported field encodings are errors rather than
inferred passes.

## Remaining qualification controls

This pass supplies setup, observation-capture, mechanism-oracle, and cleanup
evidence for the exercised positive fixtures. Full promotion still requires the
remaining candidate-view, leakage, healthy-negative, temporal, uncertainty, and
confounder controls applicable to each capability.