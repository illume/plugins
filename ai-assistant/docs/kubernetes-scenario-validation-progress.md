# Kubernetes scenario validation progress

Status: live draft validation started, 2026-09-21

The active roster remains fixed at 275 qualified scenarios. Draft validation uses
absolute portfolio numbering, so scenario 276 is the first pending rule-gap draft.
Validation does not promote a draft or change canonical qualification coverage.

## Current result

The `local-minikube` validator executed portfolio scenarios 276 through 1024:

- 461 scenarios passed fixture application, trusted Kubernetes API or decoded
  ConfigMap observation, accepted-fact matching, contradiction rejection, and
  fixture plus namespace cleanup;
- 251 scenarios were skipped because they require another profile, a missing CRD
  or removed API, or source-manifest evidence erased by API defaulting;
- 37 scenarios remain failed, concentrated in temporal metrics, scheduler,
  node, storage-controller, and admission-invalid fixture evidence;
- all validated scenarios retain `qualification_status: pending`.

The 101-scenario batch from 506 through 606 produced 68 passes, 31 skips, and two
failures. Both failures require a cluster quota versus Node allocatable metric
adapter that is not installed in the current Minikube profile.

The 103-scenario batch from 607 through 709 produced 30 passes, 73 skips, and no
failures. Most skips are removed Pluto APIs or optional CRDs not installed in the
current Minikube profile.

The 104-scenario batch from 710 through 813 produced 72 passes, 32 skips, and no
failures. The skipped scenarios require cloud, agent-runtime, Cilium, workload
metrics, or other profile-specific evidence unavailable on local Minikube.

The 105-scenario batch from 814 through 918 produced 47 passes, 58 skips, and no
failures. The skipped scenarios require cloud, policy-engine, agent-runtime,
workload metrics, removed APIs, or other profile-specific evidence.

The 106-scenario batch from 919 through 1024 produced 85 passes, 21 skips, and no
failures. The skipped scenarios require cloud or managed-platform evidence, or
host files that are not represented by the local Minikube profile.

The next sequential resume point is scenario 1025. The failed scenarios in the
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