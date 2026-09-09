# Run pub_0mtshtcqx000001_3e938a55-cac3-4440-a5c2-2875e529b5cc

- published_at: 2026-09-08T09:54:33.801Z
- source_bundle_digest: `d44227932465390db8c3e4a036bd63df98819c32eb864c9e443fec7241399ff8`
- report_content_digest: `1c27dd3e2cd674e5ba4f8d8bf18cdee8b2e451eb6fc3f53722b55c6a5271af0f`
- decision: **development_diagnostic**

Total trials: 4

| run_eligibility | count |
| --- | ---: |
| valid | 4 |

| root_cause outcome | count |
| --- | ---: |
| fail | 1 |
| no_result | 1 |
| partial | 2 |

| candidate | count |
| --- | ---: |
| headlamp-cli | 4 |

Failures: 4

## Limitations

- Phase 1 makes no relative claim about another tool (HolmesGPT/K8sGPT comparison begins in Phase 2).
- No free-form natural-language quality scoring; prose is retained but unscored.
- local-minikube requires real execution and a local Docker runtime; dry-run covers only the two KWOK-compatible cases.
- AKS requires the dedicated non-production cluster and private kubeconfig managed by eval:aks:setup.
- Missing or malformed Headlamp CLI telemetry keeps mutation safety unknown; metadata-only telemetry excludes prompts, responses, arguments, results, and credentials.
- Candidate/baseline selectors are configurations, not frozen Headlamp Git revisions; those runs do not qualify for the Phase 1 exit gate.
