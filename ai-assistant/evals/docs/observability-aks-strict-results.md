# Live AKS Strict-Default Results

Run date: 2026-09-17. PR: https://github.com/illume/plugins/pull/25.

## Completed Run

All four planned GPT-4o sessions completed without score retries or answer repair.
Both scenarios passed healthy baseline, induced fault verification, recovery, and
ownership-checked cleanup. After completion, independent Azure queries verified
all four owned resource groups, including managed node groups, were absent.

| Scenario / access | Diagnosis | Required facts | Selected facts | No-action / selection checks | Session seconds |
| --- | --- | ---: | ---: | --- | ---: |
| NSG, observability enabled | Pass | 6/6 | 9 | Pass / Pass | 22.553 |
| NSG, Kubernetes only | Fail | 0/6 | 10 | Pass / Pass | 15.569 |
| Autoscaler, observability enabled | Fail | 0/4 | 4 | Pass / Pass | 23.830 |
| Autoscaler, Kubernetes only | Fail | 0/4 | 7 | Pass / Pass | 14.116 |

NSG cleanup completed at 06:04:02 UTC. Autoscaler baseline passed at 06:12:40,
fault was verified at 06:12:46, recovery passed at 06:16:45, and cleanup completed
at 06:26:54. Autoscaler recovery now succeeds, unlike the original live attempt;
do not infer that the concurrent-operation retry branch was exercised solely from
this success. The model selected supported facts but none of the four required
autoscaler facts, and both capacity answers expressed `is_uncertain=false`.
All four selections had zero unsupported or duplicate facts; no candidate errors
or rejected calls occurred. Syntax and citation validity still do not establish
causal diagnosis or calibrated abstention.

The enabled NSG run is a complete diagnosis/lifecycle pass. Autoscaler is a
verified real-fault reproduction with successful recovery, not a model pass.
The run is small and exploratory; no general capability or independent comparison
qualification follows from one enabled pass out of two incidents.

The original interim checkpoint below is preserved as history, including its
then-pending statuses. Its fixed NSG scores and artifact hashes are unchanged.

## Original Interim Checkpoint

This report records the first two completed diagnoses from a planned four-session
live run. NSG diagnosis and recovery have completed. At this checkpoint, NSG
resource deletion is in progress and autoscaler execution is queued behind verified
cleanup. Neither pending cleanup nor unexecuted autoscaler trials count as passes
or failures. This is not a completed four-session evaluation.

| Scenario / access | Diagnosis | Required facts | Selected facts | No-action check | Selection controls | Session seconds |
| --- | --- | ---: | ---: | --- | --- | ---: |
| NSG, observability enabled | Pass | 6/6 | 9 | Pass | Pass | 22.553 |
| NSG, Kubernetes only | Fail | 0/6 | 10 | Pass | Pass | 15.569 |
| Autoscaler, observability enabled | Pending | Not scored | Not scored | Not scored | Not scored | Not measured |
| Autoscaler, Kubernetes only | Pending | Not scored | Not scored | Not scored | Not scored | Not measured |

The enabled NSG answer covered all six required facts, including inbound direction
omitted in the original live run. All nine selected facts were supported, with
no duplicates, no rejected calls, and no candidate error. It passed both the
unchanged legacy diagnosis/no-action graders and supplementary selection controls.

The Kubernetes-only answer set `is_uncertain=true` but still selected ten unrelated
Kubernetes facts as causes. It therefore failed the diagnosis contract rather than
abstaining cleanly. Its citations were valid and it recommended no action; neither
property establishes a supported diagnosis or appropriate abstention. Do not call
this answer confidently wrong: its failure is the mismatch between expressed
uncertainty and asserted cause facts.

## Lifecycle

| NSG phase | Status | Recorded time (UTC) |
| --- | --- | --- |
| Setup started | Recorded | 05:40:51 |
| Healthy baseline | Passed | 05:49:06 |
| Induced fault | Observed and verified | 05:52:12 |
| Connectivity recovery | Passed | 05:53:37 |
| Ownership-checked cleanup | Started; deletion pending at checkpoint | 05:53:37 |

The actual Pod reached the private backend before the fault. The injected NSG
deny blocked traffic while backend health and the effective rule were verified.
Removing the deny restored connectivity. The launcher is deleting only its owned
resource group and must verify both it and the managed node group are absent
before starting autoscaler provisioning. No final cleanup or lifecycle-valid pass
is claimed at this checkpoint.

## Configuration And Interpretation

- Actual AI Assistant `LangChainAssistantSession`, Azure GPT-4o `2024-11-20`, same
  deployment as the preceding runs, fresh session for each access mode.
- Code at `f9edc6f4549cdb295331ba4e8821017609bfc452`; explicitly pinned
  `evidenceMode: 'compact-select'`, `referenceStyle: 'numeric'`, and
  `strictFinalOutput: true`, matching the current Azure/OpenAI eval defaults.
- Fresh disposable AKS resources in `eastus2`, `Standard_A2_v2` nodes, the same
  immutable workload image and compatible backend image as the previous live run.
- Live production ARM tool reads and actual fault-window Kubernetes snapshots,
  with raw per-read payloads retained. This is not retained-observation replay.
- Public maximum of 12 selected facts, eight calls, and a 120-second candidate
  deadline. One enabled and one Kubernetes-only session per incident, enabled
  first. No score retries, model-answer repair, or post-generation regrading.
- Legacy diagnosis/no-action scores remain separate from
  `observability_selection_controls@1.0.0`; a controlled pass requires both.

The original live NSG answer was partial; this new enabled answer passed. That is
evidence that the current configuration can pass on fresh infrastructure, not an
isolated causal estimate of the strict-output change. Compaction, fact selection,
the public fact budget, and fresh observations differ from the original run. There
is no simultaneous legacy baseline here. The earlier full-payload replay also
passed NSG, so this is not proof of a newly acquired capability.

One successful diagnosis does not establish reliability on unseen incidents,
validate arbitrary explanatory prose, or qualify the locked Phase 2 comparison.
Normal UI/CLI behavior and the existing defaults are unchanged by this report.
Earlier live and replay reports retain their original scores.

## Retained Evidence

Private workspace directory: `.tmp/pr25-aks-strict-rerun-20260917`.
`plan.json` freezes model/options/budgets/order and nine source hashes;
`sources.json` retains those source snapshots. The private launcher is
`ai-assistant/evals/.local/run-observability-strict-gpt4o.ts`.

The `nsg` directory retains `enabled.json`, `kubernetes-only.json`, original
assistant responses and telemetry, candidate inputs, raw reads, and oracle facts.
Its `resources/lifecycle.json` and `resources/state.json` record recovery and
cleanup independently. These lifecycle files continue to change while the run is
active; they must not be presented as a final completed-run digest.

| Completed artifact | SHA-256 |
| --- | --- |
| `plan.json` | `05aa540569b526d80c7b2dff0d6428f5f7c3b8f03deb1de54196fff372ddb115` |
| `sources.json` | `ba52b07ac8ed298a739cde923ab00c19c1956b789b5283b95202c96c45e2864a` |
| `nsg/enabled.json` | `808d1cfff0d8eda58f161585317e2d5995c8c55ec5e2f1fcd8ec7a5c13210fb4` |
| `nsg/kubernetes-only.json` | `a7eb74176f93034fe7d7f0041fe2882125dc4708f7678d8d994893e3d99f6e35` |

Credentials remain private and are not part of this report. The launcher obtains
the model key only in memory. Old artifacts were not overwritten. Before live
execution, the offline launcher check and all 34 focused candidate/provisioning
tests passed. Those tests are not a substitute for pending cloud verification.

## Next Steps

1. Finish the already-running cleanup and autoscaler trials; retain every result,
   including recovery failures. Publish a completed-run update without rerunning
   diagnoses merely to improve their scores.
2. Implement OBS-3 causal and abstention controls, starting offline with wrong-pool,
   shadowed-rule, healthy, and insufficient-evidence cases. Preserve legacy grades.
3. Test OBS-4 per-object grouping against the strict numeric baseline to address
   wrong-pool joins and omitted identity/settings. Test retrieved-reference enums
   separately; valid IDs alone do not prove correct causes.

See the maintained [research phases and backlog](../../docs/observability-research.md).