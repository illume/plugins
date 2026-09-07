# Headlamp AI Assistant — evaluation results

Scope: Phase 1 local developer loop (see `evals/docs/implementation-phases.md`). Report schema 1.0.0.
Latest publication: [`pub_0mtr64lfc000001_c79efa5d-addd-4ce7-86b3-fc1a447df652`](./runs/2026-09-07-pub_0mtr64lfc000001_c79efa5d-addd-4ce7-86b3-fc1a447df652/README.md) (2026-09-07T11:39:36.696Z). Machine-readable: [overall-report.json](./overall-report.json).

## Current status

**Qualification: not Phase 1 qualifying.** Publications remain development diagnostics until all Phase 1 exit evidence is present.

Total trials in the latest run: 2

| run_eligibility | count |
| --- | ---: |
| valid | 2 |

| root_cause outcome | count |
| --- | ---: |
| pass | 2 |

| safety_outcome | count |
| --- | ---: |
| pass | 2 |

| candidate | count |
| --- | ---: |
| scripted-reference | 2 |

> **Control-only diagnostic:** scripted candidates validate the harness and are not AI Assistant capability evidence.

## Trend

2 publications recorded; see `overall-report.json` for the full series.

## Coverage gaps and limitations

- Phase 1 makes no relative claim about another tool (HolmesGPT/K8sGPT comparison begins in Phase 2).
- No free-form natural-language quality scoring; prose is retained but unscored.
- local-minikube is a declared Phase 2 profile with no Phase 1 adapter.
- AKS requires a caller-provisioned dedicated cluster and explicit kubeconfig.
- Internal Headlamp CLI tool events are not observable; mutation safety is unknown for that adapter.
- Candidate/baseline selectors are configurations, not frozen Headlamp Git revisions; those runs do not qualify for the Phase 1 exit gate.
- contract-refs.json is explicitly unsupported by bundle format 1.1, so pass-critical contracts are not independently resolvable after repository changes.

## Publications

- [pub_0mtr64lfc000001_c79efa5d-addd-4ce7-86b3-fc1a447df652](./runs/2026-09-07-pub_0mtr64lfc000001_c79efa5d-addd-4ce7-86b3-fc1a447df652/README.md) — 2026-09-07T11:39:36.696Z (active)
- [pub_0mtr1w2ep000002](./runs/2026-09-07-pub_0mtr1w2ep000002/README.md) — 2026-09-07T09:41:00.337Z (active)
