# Kubernetes scenario validation progress

Status: live draft validation started, 2026-09-21

The active roster remains fixed at 275 qualified scenarios. Draft validation uses
absolute portfolio numbering, so scenario 276 is the first pending rule-gap draft.
Validation does not promote a draft or change canonical qualification coverage.

## Current result

The `local-minikube` validator executed portfolio scenarios 276 through 305:

- 29 scenarios passed fixture application, trusted Kubernetes API observation,
  accepted-fact matching, contradiction rejection, and namespace cleanup;
- scenario 300 was skipped because it does not declare `local-minikube` support;
- no native Kubernetes API scenario in this range remains failed;
- all validated scenarios retain `qualification_status: pending`.

The next resume point is scenario 306,
`rule-gap-anonymous-kubelet-auth`. It fails closed because its predicate is encoded
inside ConfigMap YAML at `data.config.yaml#authentication.anonymous.enabled`.
Scenario 306 and the following host-configuration drafts require a typed decoder
evidence adapter before their observations can count as executable validation.

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
isolated namespace, reads resources through the trusted adapter boundary, and
always deletes the namespace. Unsupported profiles are reported as skipped.
Unsupported field encodings are errors rather than inferred passes.

## Remaining qualification controls

This pass supplies setup, observation-capture, mechanism-oracle, and cleanup
evidence for the exercised positive fixtures. Full promotion still requires the
remaining candidate-view, leakage, healthy-negative, temporal, uncertainty, and
confounder controls applicable to each capability.