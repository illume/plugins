# Object-Relative Field Layout Comparison

Date: 2026-09-17. Related work: https://github.com/illume/plugins/pull/25.

## Results And Decision

All **27 predeclared assignments** finished their recorded disposition. Object
fields passed both NSG incident attempts; both row arms passed neither. Capacity
still failed in every arm. Each arm passed only one of five controls, on different
cases. The predeclared promotion gate was not met: **fields remain opt-in**, and
the default remains read grouping with row layout.

| Arm | Valid resolved selections | Incident causal passes | Control passes | Timeouts | Rejected selections |
| --- | ---: | ---: | ---: | ---: | ---: |
| Read rows | 9/9 | 0/4 | 1/5 | 0 | 0 |
| Object rows | 7/9 | 0/4 | 1/5 | 1 | 1 duplicate-reference answer |
| Object fields | 9/9 | 2/4 | 1/5 | 0 | 0 |

The 25 valid resolved selections passed grounding, budget, and no-action checks.
The timeout and rejected selection remain failures in their arm's denominator;
neither was retried or repaired. NSG improvement is a small development signal,
not general reliability or accuracy evidence. Historical live results and earlier
experiments remain unchanged.

## Per-Assignment Outcomes

Required coverage is separate from causal success. A dash means no resolved
submission, not zero observed model work. Controls without required cause facts
show N/A coverage. Repeated incidents are new predeclared attempts, not score retries.

| Order | Packet | Attempt | Arm | Coverage | Selected | Uncertain | Result | Session seconds |
| ---: | --- | ---: | --- | --- | ---: | --- | --- | ---: |
| 1 | NSG | 1 | Read rows | 5/6 | 8 | No | Fail | 10.916 |
| 2 | NSG | 1 | Object rows | 6/6 | 9 | No | Fail | 9.228 |
| 3 | NSG | 1 | Object fields | 6/6 | 8 | No | Pass | 10.396 |
| 4 | Capacity | 1 | Object rows | 2/4 | 8 | No | Fail | 18.424 |
| 5 | Capacity | 1 | Object fields | 3/4 | 11 | No | Fail | 22.922 |
| 6 | Capacity | 1 | Read rows | 1/4 | 7 | No | Fail | 7.069 |
| 7 | NSG | 2 | Object fields | 6/6 | 7 | No | Pass | 9.184 |
| 8 | NSG | 2 | Read rows | 5/6 | 6 | No | Fail | 9.731 |
| 9 | NSG | 2 | Object rows | 5/6 | 6 | No | Fail | 8.028 |
| 10 | Capacity | 2 | Read rows | 1/4 | 5 | No | Fail | 8.165 |
| 11 | Capacity | 2 | Object rows | 2/4 | 8 | No | Fail | 7.525 |
| 12 | Capacity | 2 | Object fields | 2/4 | 7 | No | Fail | 8.550 |
| 13 | Wrong pool/minimum | 1 | Object rows | N/A | 3 | No | Fail | 14.561 |
| 14 | Wrong pool/minimum | 1 | Object fields | N/A | 2 | No | Fail | 7.483 |
| 15 | Wrong pool/minimum | 1 | Read rows | N/A | 2 | No | Fail | 19.155 |
| 16 | Healthy capacity | 1 | Object fields | N/A | 0 | Yes | Fail | 47.752 |
| 17 | Healthy capacity | 1 | Read rows | N/A | 0 | Yes | Fail | 6.432 |
| 18 | Healthy capacity | 1 | Object rows | - | - | - | Timeout | 120.041 |
| 19 | Shadowed deny | 1 | Read rows | N/A | 0 | No | Pass | 7.604 |
| 20 | Shadowed deny | 1 | Object rows | N/A | 0 | No | Pass | 6.317 |
| 21 | Shadowed deny | 1 | Object fields | N/A | 8 | No | Fail | 7.974 |
| 22 | Kubernetes-only NSG | 1 | Object rows | - | - | - | Duplicate rejected | 6.720 |
| 23 | Kubernetes-only NSG | 1 | Object fields | 0/6 | 0 | Yes | Pass | 26.076 |
| 24 | Kubernetes-only NSG | 1 | Read rows | 0/6 | 6 | Yes | Fail | 7.386 |
| 25 | Kubernetes-only capacity | 1 | Object fields | 0/4 | 7 | No | Fail | 8.808 |
| 26 | Kubernetes-only capacity | 1 | Read rows | 0/4 | 10 | No | Fail | 8.415 |
| 27 | Kubernetes-only capacity | 1 | Object rows | 0/4 | 8 | No | Fail | 23.820 |

Both field-layout capacity answers still omitted the explicit target pool name,
although all required facts were retrieved. The first selected target count,
maximum, and autoscaling, along with irrelevant Pod/system-pool metadata. The
second omitted the maximum as well and selected the unrelated system pool's
disabled autoscaling flag. Compact representation did not solve causal selection.

Object fields correctly abstained on Kubernetes-only NSG, but failed the shadowed
deny control with eight confident cause facts; both row arms correctly declared
health there. All arms failed wrong-pool/minimum and Kubernetes-only capacity.
Both completed healthy-capacity answers abstained instead of declaring supplied
health. These failures prevent promotion even with the two NSG successes.

## Transport And Usage

Assignment 18 completed planning in 3.304 seconds, read the healthy control, then
spent about 116.656 seconds in synthesis before the outer deadline. Its trace
records one planning HTTP 200 and one synthesis request cancelled **before response
headers**. No extra fetch attempt, 429, or retry delay was observed. Planning usage
was preserved as `partial`: 3,083 input and 99 output tokens; synthesis usage is
unknown. This does not identify network, intermediary, queueing, or inference as
the cause, or explain previous timeouts. Final-only limits were intentionally unset.

Assignment 22 returned strict JSON with twelve references but only eleven unique
ones: `r1.f109` appeared twice. The resolver rejected it without deduplication or
another request. Both model usage events are retained, but the failed terminal
record remains labelled `partial`, not provider-billing complete.

There were **54 fetch attempts**, **53 HTTP 200 responses**, and **48 successful
read calls**. No extra fetch attempt or retry-delay header was observed. All
children exited normally except the timeout's expected exit code 2; no watchdog
kill occurred. No evaluator process or newly provisioned cloud resource remains.

The 53 observed usage events report **460,955 input tokens and 4,612 output tokens**,
with input semantics total including cache. These are observed subtotals, excluding
unknown timed-out synthesis usage, not a billing reconciliation.

| Arm | Observed input tokens | Observed output tokens | Mean seconds, all nine assignments |
| --- | ---: | ---: | ---: |
| Read rows | 156,358 | 1,524 | 9.430 |
| Object rows | 157,925 | 1,534 | 23.852 |
| Object fields | 146,672 | 1,554 | 16.572 |

The object-row token subtotal omits its timed-out synthesis; do not interpret the
all-arm totals as a complete cost comparison. All four incident attempts per arm
did complete, allowing this matched, incident-only descriptive comparison:

| Arm | Synthesis input tokens, four incidents | Tool-payload characters, four incidents | Mean incident seconds |
| --- | ---: | ---: | ---: |
| Read rows | 90,269 | 210,652 | 8.970 |
| Object rows | 94,213 | 222,110 | 10.802 |
| Object fields | 81,719 | 177,752 | 12.763 |

Fields used 13.3% fewer synthesis input tokens than object rows and 9.5% fewer than
read rows. It was not faster on these incident attempts. These measurements include
model-generated history and persistence overhead; two attempts per familiar packet
cannot isolate load, caching, inference variance, or order effects.

## Hypothesis And Method

The hypothesis was that object-relative field keys make identity and settings
easier to connect than repeated full-path rows. Object rows isolate field layout
from grouping. The renderer maps relative JSON-pointer keys to lists of
`[reference, observed_value]` tuples; append the key to `object_path` to recover
the original path. Duplicate paths retain entries. References keep their original
ordinals, source/read boundaries remain separate, and the unchanged resolver never
auto-adds identity or any oracle fact. No field filtering was introduced.

- Azure `gpt-4o`, version `2024-11-20`, actual assistant through the eval adapter at
  committed source `bb634883dddfd84637a05aec096755207543a9c0`.
- Three arms, two attempts per incident and one per each of five controls, all
  fixed before calls. Each arm occupies each within-block position three times.
  Runs are sequential with rotated, not randomized, order.
- Retained raw incidents and unchanged controls from the
  [grouping/guidance experiment](observability-object-guidance-results.md).
  Wrong-pool/minimum, healthy, and shadowed-deny packets remain synthetic controls;
  Kubernetes-only controls restrict access to retained reads. No new live AKS
  reproduction or execution of the 100 researched candidates occurred.
- Strict numeric selection, no guidance, no final token/deadline limits. Prompts,
  schema, graders, eight-read/12-fact budgets, 120-second outer deadline, and
  135-second child watchdog remain fixed. Provider retry policy is unchanged.
- No score retries, repair turns, oracle expansion, or historical regrading.
  Model-generated planning/history can vary, so requests need not be byte-identical.
- The predeclared promotion gate required fields to pass all four incidents and
  all five controls, with no format/transport failures, and exceed both comparison
  arms in causal passes. The observed 2/4 and 1/5 fails that gate.

The causal contract is evaluator-supplied, not a domain causal engine, and may
reject defensible extras outside its required/supporting set. NSG object rows
covered all six required facts in one answer but failed that contract. Healthy
controls require no facts and uncertainty false; insufficient controls require
no facts and uncertainty true. Safety is scored separately.

## Verification And Provenance

All **386 eval tests**, formatting, and typechecks passed, including 35 focused
candidate tests. Reconstruction tests cover source/evidence separation, repeated
reads, escaped/root keys, nested rules, duplicate paths, and immutable explicit-only
resolution. Mocked Azure requests verify numeric and labelled references and the
effective layout record. Shared runtime, prompt function, graders, and historical
reports did not change. The private launcher reconstructed every observation in
all seven retained packets before calls and validated assignment order/privacy.

Private root: `.tmp/pr25-object-fields-comparison-20260917`. The existing private
transport launcher gained `--fields-comparison`; prior modes/artifacts are retained.
The plan freezes assignments, options, budgets, promotion gate, and source/input
hashes before credentials/model calls. Sources were checked before each child and
after execution. Original input-case SHA-256:
`7cfe9ab0d0646acd6f16fae8d2fc8b3ca2247352d74f4475806707da6a2c0fc7`.

| Artifact | SHA-256 |
| --- | --- |
| `plan.json` | `fac0dc5ad4ea68e710af23912e15fd777808a3b1aeb105f19683acbfeabbb483` |
| `summary.json` | `9670e31e93c754022e0c249a33766bdd929de40374f2543e586a3fe1eba0e64b` |
| `sources.json` | `69dffc8be56453e69df97a5079baa62b9a67b886a41ba0a5d18aa1e85176958d` |
| `cases.json` | `3fec3a1f5bedb14cdb157e5a2328605b94d07f7c377fad42df53f072d0273eaf` |

All 27 child dispositions, effective options, and private directory/record modes
were verified. Each child retains atomic progress and terminal records, observations,
HTTP-stage metadata, usage, and process information. Tracing preserves the original
Response without reading its body or logging credentials, headers, or prompts.
Keys remain in process memory and child stdin. Session durations exclude parent
startup and credential acquisition. Local cancellation is not remote billing control.

## Next Step

Retain fields as an experiment, not a default. Further work should test explicit
identity-bearing causal claims and clean healthy/insufficient dispositions, with
offline source-validation and the same negative controls first. Do not automatically
append missing names, weaken the rubric, add reads for facts already present, or
rerun this batch until it passes.