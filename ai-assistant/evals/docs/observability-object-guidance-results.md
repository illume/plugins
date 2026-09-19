# Object Grouping And Diagnostic Guidance

Date: 2026-09-17. Related work: https://github.com/illume/plugins/pull/25.

## Result And Default Decision

All 27 predeclared assignments were attempted once. Neither object grouping nor
diagnostic guidance demonstrated better diagnosis than the current strict-numeric
baseline. Keep `evidenceGrouping: 'read'` and `diagnosticGuidance: 'none'` as defaults;
both new options remain explicit experiments. Strict JSON and numeric references
remain enabled for Azure/OpenAI observability eval candidates.

| Arm | Incident passes / attempts | Control passes / attempts | Deadline failures | Invalid references |
| --- | ---: | ---: | ---: | ---: |
| Baseline | 1/4 | 1/5 | 0 | 2 duplicate selections |
| Object grouping only | 1/4 | 0/5 | 4 | 0 |
| AKS guidance only | 0/4 | 2/5 | 2 | 0 |

Both incident passes were NSG. All six completed capacity answers were partial
under the legacy grader and failed the prospective selection contract. Baseline
capacity coverage was 3/4 then 2/4 required facts, grouping 3/4 then 3/4, and
guidance 3/4 then 2/4. Grouped answers omitted pool identity in both repeats.
Guided answers still selected `maxPods` or another pool's autoscaling flag despite
explicit guidance about those distinctions. No answer was repaired or expanded.

Guidance correctly classified healthy capacity and cleanly abstained for NSG with
Kubernetes-only evidence. Baseline recognized the shadowed-deny healthy control.
No arm passed the wrong-pool/minimum control or the capacity Kubernetes-only
control. Baseline abstained on the explicitly healthy capacity packet, which is
reported separately from a wrong causal claim but fails its declared disposition.

There were 19 valid submissions, all passing the no-action check; two duplicate
selections and six deadline failures had no valid submission/no-action score.
No read calls were rejected. A timeout is a failure to deliver, not evidence of
malformed JSON or of incorrect diagnostic reasoning.

## Design

- Same Azure GPT-4o deployment/version `gpt-4o` / `2024-11-20`, through the actual
  `LangChainAssistantSession`; no new live Azure resources.
- Three independent arms: existing read-grouped numeric selection, object-grouped
  numeric selection, and existing read grouping with general AKS guidance. No
  combined grouping-plus-guidance arm, reference enum, or correction turn.
- Two retained live snapshots (NSG and capacity from the latest live run), two
  repetitions per arm: 12 incident attempts. Five controls per arm: 15 attempts.
- The controls are three explicitly synthetic development packets (wrong capped
  pool/equal minimum, healthy capacity, shadowed NSG deny) and two retained-snapshot
  access controls with Azure reads disabled. They are not new operational incidents
  or independently qualified scenarios from the 100-candidate catalogue.
- Same raw reads, tasks, schema, model, 12-fact public budget, eight-read limit,
  and 120-second deadline within each arm comparison, except the declared guidance
  text in the guidance arm. Numeric IDs resolve only explicitly selected facts.
- Rotated arm order within incident/repetition blocks and control blocks. Small
  repeated development inputs are not independent incident breadth or significance
  evidence. Do not pool these scores with earlier prompts or live runs.

Unlike the first two replay experiments, original raw reads were available here.
Every arm receives the same retained payload and freshly flattened observations,
including available empty containers and fresh evidence IDs. Object grouping does
not change paths, values, the fact set, or the reference ordinal. The tool view
changes structure and may change ordering for interleaved objects. Prompts are
identical for baseline versus grouping.

## Every Assignment

"Partial" denotes legacy fact coverage with an unsuccessful prospective result.
The legacy diagnosis grader is not used for the synthetic healthy/insufficient
packets. Controls use the predeclared disposition contract instead.

| Order | Case | Arm | Outcome |
| ---: | --- | --- | --- |
| 1 | NSG, repeat 1 | Baseline | Pass |
| 2 | NSG, repeat 1 | Grouped | Pass |
| 3 | NSG, repeat 1 | Guided | Deadline |
| 4 | Capacity, repeat 1 | Grouped | Partial 3/4; missing identity, irrelevant extras |
| 5 | Capacity, repeat 1 | Guided | Partial 3/4; missing count, irrelevant extras |
| 6 | Capacity, repeat 1 | Baseline | Partial 3/4; missing identity, wrong-pool extra |
| 7 | NSG, repeat 2 | Grouped | Partial 4/6 |
| 8 | NSG, repeat 2 | Guided | Partial 5/6 |
| 9 | NSG, repeat 2 | Baseline | Partial 5/6 |
| 10 | Capacity, repeat 2 | Guided | Partial 2/4; wrong-pool extra |
| 11 | Capacity, repeat 2 | Baseline | Partial 2/4 |
| 12 | Capacity, repeat 2 | Grouped | Partial 3/4; missing identity |
| 13 | Wrong pool / minimum | Guided | Unsupported cause selection; no abstention |
| 14 | Wrong pool / minimum | Baseline | Unsupported cause selection; no abstention |
| 15 | Wrong pool / minimum | Grouped | Deadline |
| 16 | Healthy capacity | Baseline | Abstained rather than established health |
| 17 | Healthy capacity | Grouped | Deadline |
| 18 | Healthy capacity | Guided | Pass |
| 19 | Shadowed deny / healthy | Grouped | Deadline |
| 20 | Shadowed deny / healthy | Guided | Deadline |
| 21 | Shadowed deny / healthy | Baseline | Pass |
| 22 | NSG, Kubernetes only | Guided | Pass: clean abstention |
| 23 | NSG, Kubernetes only | Baseline | Duplicate references |
| 24 | NSG, Kubernetes only | Grouped | Deadline |
| 25 | Capacity, Kubernetes only | Baseline | Duplicate references |
| 26 | Capacity, Kubernetes only | Grouped | Selected symptoms as causes |
| 27 | Capacity, Kubernetes only | Guided | Selected symptoms as causes |

All non-timeout outputs were valid JSON; two still failed duplicate-reference
validation. Strict decoding does not enforce uniqueness or relevance.

## Prospective Controls And Limits

`gradeObservabilityCausality` adds `observability_causal_selection@1.0.0` without
changing either the legacy grader or `observability_selection_controls@1.0.0`.
An evaluator-only contract declares `cause`, `healthy`, or `insufficient`.
For a cause, at least one complete alternative's required facts must be selected,
with extras restricted to that alternative's required/supporting facts. Grounding,
duplicates, echo-all, and the public fact budget still apply. An empty output
requires at least some retrieved evidence; healthy expects uncertainty false and
insufficient expects uncertainty true. Uncertainty plus cause facts cannot pass.

These are source-bound selection/disposition checks, **not a causal engine or a
grader for arbitrary prose**. The evaluator supplies the accepted alternatives and
expected disposition; it must establish them independently. In particular, this
grader does not compute NSG precedence, workload demand, or pool eligibility, nor
prove that the candidate read all evidence needed for a healthy conclusion.
The shadowed-rule packet's expected health comes from its constructed control,
not an implementation of packet evaluation in the grader. Allowed supporting facts
remain rubric choices; additional defensible facts can be false negatives and
need prospective contract review, never retroactive regrading of this run.

For the live packets, required facts reuse the original oracle; permitted supporting
facts were frozen before calls (NSG protocol/priority/source port, and relevant
Kubernetes identity/placement/demand/scheduling fields for capacity). All contracts,
including healthy and insufficient expectations, stay outside candidate input.
No gold feedback, suffix completion, deduplication, or automatic related-field
expansion occurs. Model-free tests cover positive alternatives, wrong pool,
equal-valued `minCount`/`maxCount`, irrelevant facts, stale citations, no evidence,
healthy/insufficient mismatches, shadowed deny, and invalid contracts.

## Deadlines And Provenance

The initial process stopped after assignment 3. Subsequent segments stopped after
15, 17, 19, 20, and 24. Each stopped local process exited before a continuation;
only untouched assignments ran. All prior rows were retained byte-for-value, with
unchanged candidate/grader/case hashes and assignment order. The launcher alone
gained resume validation after the first deadline. The original plan and sources
remain intact, and each continuation links the previous plan/summary digests.

The six timed-out sessions had retrieved tool observations, but their candidate
record hook had not completed when the outer deadline ended the process. Their
raw final response and complete usage are missing. Summary zeros for usage in
those rows are **missing measurements, not zero tokens or cost**. The retained
42 usage events total 405,403 input and 3,630 output tokens and are only a lower
bound on actual work. Provider retries or work continuing remotely after local
abort are not measured here. No timeout is attributed specifically to grouping,
guidance, or a provider defect without further instrumentation.

Among the four non-timeout incident attempts per baseline/grouped arm, grouping
increased mean synthesis input from 22,569.25 to 23,567 tokens (about 4.4%), and
mean session time from 7.540 to 8.940 seconds. Guidance has one missing incident
duration/token measurement; do not compare its complete-case mean as though the
timed-out attempt were free. No efficiency improvement is claimed.

Private workspace directories, in continuation order:

1. `.tmp/pr25-object-guidance-replay-20260917`
2. `.tmp/pr25-object-guidance-continuation-20260917`
3. `.tmp/pr25-object-guidance-final-20260917`
4. `.tmp/pr25-object-guidance-controls-20260917`
5. `.tmp/pr25-object-guidance-rest-20260917`
6. `.tmp/pr25-object-guidance-tail-1-20260917`
7. `.tmp/pr25-object-guidance-tail-2-20260917`

The last directory contains the cumulative 27-row summary. Per-attempt files stay
in the segment that executed them. Source snapshots, cases, original responses
where available, trials, errors, and telemetry are retained. Credentials were used
in launcher memory only and are not committed.

| Artifact | SHA-256 |
| --- | --- |
| Initial plan | `ea1faeac190f0d7e9b8a531892f71c1dae2b8e9b75e8fe08f6ab281ca25baf0e` |
| Continuation plan | `a200c7622be3a9faebc18fb4dce5e6fb78f9a23d7f53b623c49ff4edf8116241` |
| Cases | `7cfe9ab0d0646acd6f16fae8d2fc8b3ca2247352d74f4475806707da6a2c0fc7` |
| Final cumulative summary | `259c3e5ab7475d1b216e5ead21fe7f06b2b7c9839d76c25c1c0314d433994fe9` |

## Next Decision

Keep the new controls for prospective comparisons and both presentation options
available, but do not promote grouping or guidance. Improve timeout cancellation
and incremental telemetry capture before another paid comparison. Then consider
a more compact per-object field layout or explicit source-bound claims, separately
from read discovery and reference enums. An enum alone cannot fix selecting a
valid but irrelevant fact. All 370 offline eval tests, formatting, and typecheck
passed before the frozen run; the real Azure request boundary is also covered
with mocked HTTP. No normal UI/CLI defaults or shared runtime behavior changed.