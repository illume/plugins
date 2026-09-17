# Claim Reference Wording Comparison

Date: 2026-09-17. Related work: https://github.com/illume/plugins/pull/25.

## Results And Decision

All **18 predeclared assignments** finished. The syntax-only hint reduced unknown
identity-reference rejections from 5/9 to 0/9 and increased valid resolved
submissions from 3/9 to 7/9. However, **neither arm passed an incident**, and each
passed only three of five controls. The promotion gate failed: the hint remains
opt-in, with all defaults unchanged.

| Arm | Unknown identity rejections | Unsupported identity-path rejections | Timeouts | Valid resolved selections | Incident causal passes | Control passes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| No hint | 5/9 | 0/9 | 1/9 | 3/9 | 0/4 | 3/5 |
| Syntax example | 0/9 | 2/9 | 0/9 | 7/9 | 0/4 | 3/5 |

All ten resolved submissions passed grounding, selection-budget, and no-action
checks. Seven rejected selections and one timeout remain failures in the assigned
denominators. No output was repaired, converted into an abstention, or score-retried.
Better reference syntax is not evidence of better causal reasoning or sufficient
grounds to promote the full claims contract.

## Per-Assignment Outcomes

A dash means no resolved submission, not zero model work. N/A denotes a control
without required cause facts. Required coverage is separate from causal success.

| Order | Packet | Attempt | Hint | Coverage | Selected | Uncertain | Result | Session seconds |
| ---: | --- | ---: | --- | --- | ---: | --- | --- | ---: |
| 1 | NSG | 1 | None | - | - | - | Unknown identity | 33.700 |
| 2 | NSG | 1 | Example | - | - | - | Identity path rejected | 12.792 |
| 3 | Capacity | 1 | Example | 0/4 | 0 | Yes | Fail | 25.419 |
| 4 | Capacity | 1 | None | - | - | - | Unknown identity | 13.059 |
| 5 | NSG | 2 | Example | - | - | - | Identity path rejected | 16.015 |
| 6 | NSG | 2 | None | - | - | - | Unknown identity | 25.787 |
| 7 | Capacity | 2 | None | - | - | - | Unknown identity | 19.798 |
| 8 | Capacity | 2 | Example | 0/4 | 0 | Yes | Fail | 9.831 |
| 9 | Wrong pool/minimum | 1 | None | - | - | - | Timeout | 120.021 |
| 10 | Wrong pool/minimum | 1 | Example | N/A | 11 | No | Fail | 36.385 |
| 11 | Healthy capacity | 1 | Example | N/A | 0 | No | Pass | 12.640 |
| 12 | Healthy capacity | 1 | None | N/A | 0 | No | Pass | 9.881 |
| 13 | Shadowed deny | 1 | None | N/A | 0 | No | Pass | 8.793 |
| 14 | Shadowed deny | 1 | Example | N/A | 0 | No | Pass | 8.310 |
| 15 | Kubernetes-only NSG | 1 | Example | 0/6 | 0 | Yes | Pass | 7.178 |
| 16 | Kubernetes-only NSG | 1 | None | 0/6 | 0 | Yes | Pass | 9.765 |
| 17 | Kubernetes-only capacity | 1 | None | - | - | - | Unknown identity | 8.656 |
| 18 | Kubernetes-only capacity | 1 | Example | 0/4 | 5 | No | Fail | 11.021 |

## Interpretation

The unhinted causal outputs again supplied literal resource IDs, names, or JSON
pointers where `identity_ref` required an exact short fact reference. The hinted
outputs instead used retrieved reference tokens; none copied the example's
`r7.f12` or `r7.f13` placeholders. This supports the narrow reference-wording
hypothesis on this development sample, not a universal error-rate estimate.

Both hinted NSG answers chose `r2.f1`, which resolves to
`/value/0/networkSecurityGroup/id`. This is a real observed nested NSG ID, but it
is outside the frozen contract's accepted direct object-relative identity paths
(`/name`, `/id`, `/metadata/name`, `/metadata/uid`). The validator rejected it
before checking the remaining same-object relationships. These are **unsupported
identity-shape rejections**, not invented IDs or proof that the remaining causal
claim was correct. The restrictive experimental contract can reject a reasonable
identity representation; this batch does not qualify a broader identity model.

The two hinted capacity incident answers cleanly abstained instead of diagnosing
the retrieved cause. On wrong-pool/minimum, the hint produced a well-formed,
grounded eleven-fact causal answer where the control required abstention. On
Kubernetes-only capacity it produced five confident cause facts instead of
abstaining. These are valid-shape causal failures that clearer syntax did not fix.
Both arms correctly declared healthy capacity and shadowed-deny health and cleanly
abstained on Kubernetes-only NSG.

## Transport And Usage

Assignment 6 had one planning transport error before headers, then a successful
planning retry and synthesis response: three fetch attempts in two logical calls.
Assignment 9 had four planning attempts (three transport errors, then HTTP 200)
and four synthesis attempts (all transport errors), then the outer deadline.
Planning took about 57.731 seconds; logical synthesis was cancelled after about
62.238 seconds. The last fetch had already failed before logical cancellation;
the trace does not establish whether the remaining interval was retry backoff
or another internal client wait.

These are observed retries within logical invocations under the unchanged provider
policy, not score retries or replacement assignments. The eight transport-error
events across those two sessions occurred without HTTP response headers, generally
after about 10.5 seconds. The sanitized trace does not identify the underlying
network/client/server cause. No HTTP 429, 500, or numeric retry-delay header was
observed in this run. Earlier timeout/500 reports remain separate history.

Across all assignments there were **43 fetch attempts**, **35 HTTP 200 responses**,
**32 successful read calls**, and **35 observed usage events**. Assignment 9 retains
only its planning usage, labelled `partial`: 3,275 input and 99 output tokens.
Its synthesis usage remains unknown. All children exited with code 0 except the
deadline's expected code 2; none needed a watchdog kill. No evaluator or newly
provisioned cloud resource remains running.

| Arm | Observed input tokens | Observed output tokens | Mean seconds, all nine assignments |
| --- | ---: | ---: | ---: |
| No hint | 146,316 | 1,789 | 27.718 |
| Syntax example | 156,124 | 1,550 | 15.510 |

Observed totals are **302,440 input and 3,339 output tokens**, with input semantics
total including cache. Missing timeout usage and any unreported work behind failed
requests are excluded; these are not billing totals. Rejected answers retain their
usage events but failed records remain `partial`. The baseline timeout and retry
patterns confound the duration comparison, so no latency or cost improvement is
established. Per-assignment counts retain failures rather than comparing survivors.

## Method And Checks

- Azure `gpt-4o`, version `2024-11-20`, actual assistant through the candidate at
  committed source `e7fbdf442fb2c432d9d05186f26b98966dc29c57`.
- Eighteen fresh sessions: claims with `claimReferenceHint: 'none'` versus
  `'example'`, both using object-field evidence. Two attempts per each of two
  incidents and one per each of five controls per arm.
- Second incident attempts reverse arm order within each incident. Control order
  alternates; execution is sequential and not randomized. These are familiar
  retained packets, not independent operational breadth or a new live incident.
- Raw packets and evaluator contracts are unchanged from the
  [grouping/guidance experiment](observability-object-guidance-results.md).
  Wrong-pool/minimum, healthy, and shadowed-deny controls remain synthetic;
  Kubernetes-only controls restrict access to retained incident reads.
- The sole model-facing change is appended reference wording and a syntax-only
  example. Baseline prompt, disposition instructions, strict schema, resolver,
  field renderer, and graders are unchanged. Prompt changes reach planning and
  synthesis; model-generated history can vary. No other AKS guidance or final
  token/deadline limits are enabled.
- Both arms retain eight-read/twelve-fact budgets, a 120-second outer deadline,
  and 135-second child watchdog. No score retry, repair, identity lookup, oracle
  expansion, or historical regrading is permitted.
- The predeclared promotion gate requires the hint to pass all four incidents
  and five controls, without format/transport failures, and exceed baseline causal
  passes. Fewer unknown identity errors alone is explicitly insufficient.

Before committing, **395 eval tests**, formatting, and typechecks passed, including
44 candidate tests. Checks cover baseline prompt equivalence, actual client hint
propagation through planning/synthesis, effective recording, unchanged strict
schema, and rejection of literal values and unretrieved example references.
The launcher validated assignments, reversed incident order, options, and trace
privacy before paid calls. Shared runtime and historical reports were unchanged.

## Provenance

Private root: `.tmp/pr25-reference-hint-comparison-20260917`. The existing private
transport launcher gained an explicit `--reference-comparison` mode. The plan
freezes source/input hashes, assignments, budgets, measurements, and promotion
criteria before credentials/model calls. Sources were checked before each child
and after the run. Original input-case SHA-256:
`7cfe9ab0d0646acd6f16fae8d2fc8b3ca2247352d74f4475806707da6a2c0fc7`.

| Artifact | SHA-256 |
| --- | --- |
| `plan.json` | `8b96ceb4ab6dc8996fc0cd93304d4b3fdf7e49200e262f04a6ff57700ae7aa10` |
| `summary.json` | `9bae2b4dbe2757937e8871a90a17722a4aac14d7e567ef0da58dd5fa1c16edfd` |
| `sources.json` | `bc145028d24a30064e57485a66ff4ad3bb5d627a86a1884913c3e0da868b5691` |
| `cases.json` | `8a8dbd5f57322a26a6213a3ca26f3846e4a61065ec709acc6b1a271113bcbb15` |

All eighteen terminal dispositions, effective options, private record/directory
modes, and source/input hashes were verified. Records preserve raw outputs,
observations, incremental progress, errors, usage, and sanitized HTTP metadata.
Keys remain in process memory/child stdin, not published artifacts. Tracing does
not consume response bodies. Session durations include persistence overhead but
exclude parent startup and credential acquisition. Local cancellation cannot prove
remote billing termination.

## Next Step

Keep the hint experimental. Before another paid batch, audit the source-identity
contract offline against nested ARM relationships and effective-rule groups, with
cross-object negative tests. This may identify validator limitations; it must not
silently widen this run's contract or regrade its rejected answers. Separately,
retain the wrong-pool and insufficient-evidence false causes: resolving more IDs
cannot establish causal correctness. Do not repeat this batch until it passes.