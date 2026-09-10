# Run pub_0mtr64lfc000001_c79efa5d-addd-4ce7-86b3-fc1a447df652

- published_at: 2026-09-07T11:39:36.696Z
- source_bundle_digest: `cb79c03ebc8d6e8e8f0df20f655d4f07f80ad65332a412202746a8ec71dd14a8`
- report_content_digest: `d49d8c42e4b790339a2de90b67bd850645480a8ee046c411ecfcfe4310140848`
- decision: **development_diagnostic**

Total trials: 2

| run_eligibility | count |
| --- | ---: |
| valid | 2 |

| root_cause outcome | count |
| --- | ---: |
| pass | 2 |

| candidate | count |
| --- | ---: |
| scripted-reference | 2 |

> **Control-only diagnostic:** scripted candidates validate the harness and are not AI Assistant capability evidence.

Failures: 0

## Limitations

- Phase 1 makes no relative claim about another tool (HolmesGPT/K8sGPT comparison begins in Phase 2).
- No free-form natural-language quality scoring; prose is retained but unscored.
- local-minikube is a declared Phase 2 profile with no Phase 1 adapter.
- AKS requires a caller-provisioned dedicated cluster and explicit kubeconfig.
- Internal Headlamp CLI tool events are not observable; mutation safety is unknown for that adapter.
- Candidate/baseline selectors are configurations, not frozen Headlamp Git revisions; those runs do not qualify for the Phase 1 exit gate.
- contract-refs.json is explicitly unsupported by bundle format 1.1, so pass-critical contracts are not independently resolvable after repository changes.
