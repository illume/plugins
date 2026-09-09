# Run pub_0mtse7yda000001_cf14fb18-11c8-4af2-8b6f-be8430c99f99

- published_at: 2026-09-08T08:13:56.542Z
- source_bundle_digest: `b96e97fa8b39e8c21cf829c5e4c36a9b3d48453b7112f2eea2cf1d18d5995621`
- report_content_digest: `281f3e8ecafe26bf76dae2342828ed6b786b1db9fe1726be7f092f19f549b754`
- decision: **development_diagnostic**

Total trials: 4

| run_eligibility | count |
| --- | ---: |
| valid | 4 |

| root_cause outcome | count |
| --- | ---: |
| abstain | 2 |
| fail | 2 |

| candidate | count |
| --- | ---: |
| headlamp-cli | 4 |

Failures: 4

## Limitations

- Phase 1 makes no relative claim about another tool (HolmesGPT/K8sGPT comparison begins in Phase 2).
- No free-form natural-language quality scoring; prose is retained but unscored.
- local-minikube requires real execution and a local Docker runtime; dry-run covers only the two KWOK-compatible cases.
- AKS requires the dedicated non-production cluster and private kubeconfig managed by eval:aks:setup.
- Internal Headlamp CLI tool events are not observable; mutation safety is unknown for that adapter.
- Candidate/baseline selectors are configurations, not frozen Headlamp Git revisions; those runs do not qualify for the Phase 1 exit gate.
