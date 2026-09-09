# Headlamp AI Assistant — evaluation results

Scope: Phase 1 local developer loop (see `evals/docs/implementation-phases.md`). Report schema 1.0.0.
Latest publication: [`pub_0mtshtcqx000001_3e938a55-cac3-4440-a5c2-2875e529b5cc`](./runs/2026-09-08-pub_0mtshtcqx000001_3e938a55-cac3-4440-a5c2-2875e529b5cc/README.md) (2026-09-08T09:54:33.801Z). Machine-readable: [overall-report.json](./overall-report.json).

## Current status

**Qualification: not Phase 1 qualifying.** Publications remain development diagnostics until all Phase 1 exit evidence is present.

Total trials in the latest run: 4

| run_eligibility | count |
| --- | ---: |
| valid | 4 |

| root_cause outcome | count |
| --- | ---: |
| fail | 1 |
| no_result | 1 |
| partial | 2 |

| safety_outcome | count |
| --- | ---: |
| pass | 4 |

| candidate | count |
| --- | ---: |
| headlamp-cli | 4 |

## Trend

4 publications recorded; see `overall-report.json` for the full series.

## Coverage gaps and limitations

- Phase 1 makes no relative claim about another tool (HolmesGPT/K8sGPT comparison begins in Phase 2).
- No free-form natural-language quality scoring; prose is retained but unscored.
- local-minikube requires real execution and a local Docker runtime; dry-run covers only the two KWOK-compatible cases.
- AKS requires the dedicated non-production cluster and private kubeconfig managed by eval:aks:setup.
- Missing or malformed Headlamp CLI telemetry keeps mutation safety unknown; metadata-only telemetry excludes prompts, responses, arguments, results, and credentials.
- Candidate/baseline selectors are configurations, not frozen Headlamp Git revisions; those runs do not qualify for the Phase 1 exit gate.

## Publications

- [pub_0mtshtcqx000001_3e938a55-cac3-4440-a5c2-2875e529b5cc](./runs/2026-09-08-pub_0mtshtcqx000001_3e938a55-cac3-4440-a5c2-2875e529b5cc/README.md) — 2026-09-08T09:54:33.801Z (active)
- [pub_0mtse7yda000001_cf14fb18-11c8-4af2-8b6f-be8430c99f99](./runs/2026-09-08-pub_0mtse7yda000001_cf14fb18-11c8-4af2-8b6f-be8430c99f99/README.md) — 2026-09-08T08:13:56.542Z (active)
- [pub_0mtr64lfc000001_c79efa5d-addd-4ce7-86b3-fc1a447df652](./runs/2026-09-07-pub_0mtr64lfc000001_c79efa5d-addd-4ce7-86b3-fc1a447df652/README.md) — 2026-09-07T11:39:36.696Z (active)
- [pub_0mtr1w2ep000002](./runs/2026-09-07-pub_0mtr1w2ep000002/README.md) — 2026-09-07T09:41:00.337Z (active)
