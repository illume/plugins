# Final-Synthesis Limits Comparison

Date: 2026-09-17. Related work: https://github.com/illume/plugins/pull/25.

## Results

All **16 predeclared sessions** returned valid, resolved selections and passed
grounding, selection-budget, and no-action checks. There were no timeouts,
truncated outputs, duplicate/unknown references, or candidate errors. All eight
incident answers failed the prospective causal-selection contract. Two of eight
control answers passed, both on the healthy-capacity packet.

| Arm | Final token ceiling | Final deadline | Valid delivery | Incident causal passes | Control passes | Mean session seconds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | Unset | Unset | 4/4 | 0/2 | 0/2 | 8.079 |
| Tokens | 512 | Unset | 4/4 | 0/2 | 1/2 | 14.389 |
| Deadline | Unset | 30 seconds | 4/4 | 0/2 | 0/2 | 11.415 |
| Both | 512 | 30 seconds | 4/4 | 0/2 | 1/2 | 9.672 |

**No defaults change.** The uncapped baseline also completed every session, so
this run provides no evidence of a delivery-reliability improvement. All final
responses reported 49-109 output tokens, below the 512 ceiling; all synthesis
invocations completed within 14.485 seconds, below the 30-second deadline.
Neither limit triggered. The token-only arm was slower on this small sample,
not evidence of a general latency regression or improvement.

The two healthy-control successes are single samples per capped arm, not evidence
that a ceiling improves health recognition. This is a development comparison on
familiar packets, not a population accuracy estimate or a model qualification.
Earlier live NSG passes and autoscaler failures remain unchanged; no historical
assignment was retried, replaced, or regraded.

## Per-Assignment Outcomes

Required coverage is the existing fact-coverage measure, not a causal pass.
Healthy controls have no required cause facts. Kubernetes-only capacity cannot
observe the four required Azure pool facts and must abstain without cause facts.

| Order | Packet | Arm | Required coverage | Selected facts | Uncertain | Causal result | Session seconds |
| ---: | --- | --- | --- | ---: | --- | --- | ---: |
| 1 | NSG | Baseline | 5/6 | 6 | No | Fail | 10.110 |
| 2 | NSG | Tokens | 6/6 | 12 | No | Fail | 19.005 |
| 3 | NSG | Deadline | 6/6 | 9 | No | Fail | 19.361 |
| 4 | NSG | Both | 5/6 | 7 | No | Fail | 12.278 |
| 5 | Capacity | Tokens | 1/4 | 8 | No | Fail | 22.362 |
| 6 | Capacity | Deadline | 1/4 | 6 | No | Fail | 9.547 |
| 7 | Capacity | Both | 3/4 | 12 | No | Fail | 10.078 |
| 8 | Capacity | Baseline | 3/4 | 7 | No | Fail | 8.622 |
| 9 | Healthy capacity | Deadline | N/A | 0 | Yes | Fail | 5.782 |
| 10 | Healthy capacity | Both | N/A | 0 | No | Pass | 8.771 |
| 11 | Healthy capacity | Baseline | N/A | 0 | Yes | Fail | 6.176 |
| 12 | Healthy capacity | Tokens | N/A | 0 | No | Pass | 8.324 |
| 13 | Capacity, Kubernetes-only | Both | 0/4 | 5 | Yes | Fail | 7.561 |
| 14 | Capacity, Kubernetes-only | Baseline | 0/4 | 5 | No | Fail | 7.410 |
| 15 | Capacity, Kubernetes-only | Tokens | 0/4 | 5 | No | Fail | 7.864 |
| 16 | Capacity, Kubernetes-only | Deadline | 0/4 | 7 | No | Fail | 10.972 |

NSG token-only and deadline-only answers covered all six required facts, which
satisfies the existing coverage check, but selected six and one facts respectively
outside the causal contract's required/supporting set. That distinction is why
full coverage is not reported as a causal pass. The evaluator-supplied contract
can reject defensible extras; it is not a general-purpose causal engine.

All four enabled capacity answers omitted the target pool's explicit name. The
baseline and combined-limit answers selected the target's autoscaling flag,
maximum, and current count but still omitted identity and included disallowed
extras. Token-only selected the minimum instead of the maximum; deadline-only
included the unrelated system pool's disabled autoscaling flag and count. The
required observations were available, so these remain selection failures rather
than insufficient retrieval or truncation.

All Kubernetes-only controls selected unsupported *causal interpretations* of
otherwise grounded observations. The combined arm expressed uncertainty but still
listed five cause facts, failing clean abstention. The other three were confident.
None of these failures involved fabricated observation values or invalid IDs.

## Method And Measurement

- Azure `gpt-4o`, version `2024-11-20`, actual shared assistant at commit
  `b9ad6e5fda3b2b5b66fb324dff4f374abd71b145`. Shared limits were committed first
  as `61daadcadf166f09dd9f77cf0188f1277447ae43`.
- Four independent settings in a 2-by-2 token/deadline design. One fresh session
  per setting and packet, in the declared order above. Arm positions rotate
  across packets; all calls are sequential, not randomized or replicated.
- Two retained live raw-read packets, one synthetic healthy control, and one
  Kubernetes-only access control from the
  [grouping/guidance experiment](observability-object-guidance-results.md).
  No new AKS incident or cloud resource was provisioned.
- All arms use compact numeric strict selection, read grouping, and no extra
  diagnostic guidance. Prompt construction, input packets, fact contracts,
  graders, and eight-read/12-fact budgets are fixed. Planning remains uncapped;
  model-generated planning/history can vary, so resulting requests need not be
  byte-identical. No seed or deterministic inference guarantee was introduced.
- A 120-second outer deadline applies to every session; the optional 30-second
  deadline starts only at synthesis. The separate child watchdog is 135 seconds.
  Provider retry policy remains unchanged; there are no score retries, repair
  turns, or post-hoc fact expansion.
- Each child preserves atomic progress and terminal records, effective limits,
  observations, sanitized HTTP-stage traces, and process disposition. The plan
  freezes source and case hashes before credential acquisition/model calls.
  Credentials stay in process memory and child stdin, not published artifacts.

There were **32 fetch attempts**, each returning HTTP 200 headers, and 28 successful
read calls. Every logical planning/synthesis invocation completed; no extra fetch
attempt or retry-delay header was observed. All 16 children exited normally with
no watchdog kill. The launcher retains failures rather than dropping them, but
none occurred in this run. These observations do not explain earlier timeouts.

The 32 observed usage events report **306,163 input tokens and 2,772 output tokens**.
Input semantics are total including cache; each record is labelled `reported`,
not a provider billing reconciliation. Per-arm observed totals were:

| Arm | Input tokens | Output tokens |
| --- | ---: | ---: |
| Baseline | 76,538 | 680 |
| Tokens | 76,545 | 704 |
| Deadline | 76,540 | 689 |
| Both | 76,540 | 699 |

Durations include candidate/session preparation, planning, reads, synthesis, and
local persistence, but exclude parent startup and credential acquisition. Local
trace writes can affect timing. One attempt per cell cannot isolate inference
variance, caching, load, or order effects. A local deadline still does not guarantee
remote termination or bounded provider billing.

## Provenance And Checks

Private root: `.tmp/pr25-final-limits-comparison-20260917`. The existing private
transport launcher gained an explicit `--limits-comparison` mode; the old four-row
mode and historical run directories were retained. Source snapshots preserve the
exact launcher used for this comparison.

| Artifact | SHA-256 |
| --- | --- |
| `plan.json` | `e1ec805902c75767dad900a20fabd4fdd59c1eab4d94b0335d72499ae8acb077` |
| `summary.json` | `b21e543e9ea2d6dc84ea30dfe74825daa6708da372d721be9b1e725bdcb7695c` |
| `sources.json` | `10ff4cf05e5c3f0289b8693cf88d647612a36354fc6aec0d81cd7cb9caba1ca1` |
| `cases.json` | `5ee4f75851793d49800c482ca6db3d2113aacb134702126ea682fbb48f539830` |

Before committing the limits, 212 focused shared tests, 32 candidate tests, and
both typechecks passed again, following the prior full 1,987 shared / 383 eval
test gates. The launcher passed offline assignment/option/order and trace privacy
checks. After execution, all 16 dispositions, effective limits, source hashes,
original case hash, and private directory/terminal-record permissions were checked.
No private launcher, raw packet, credentials, or model response is published here.

## Decision And Next Step

Keep token and deadline limits opt-in. This run demonstrated successful bounded
configuration use, not a beneficial boundary intervention or diagnosis gain.
Do not repeat calls just to obtain a timeout or a passing score.

Return to a source-bound field/claim representation hypothesis with offline
identity and value-preservation checks first. Any future paid comparison must
keep the current graders and counterexamples fixed, include clean-abstention
controls, and use a new declared plan. Never auto-add oracle facts or change the
historical rubric to make the current results pass.