# Identity-Bearing Claim Comparison

Date: 2026-09-17. Related work: https://github.com/illume/plugins/pull/25.

## Results

All **18 predeclared assignments** finished. Neither arm passed an incident causal
contract. Claims correctly declared the two healthy controls, but four causal
answers used literal identity values instead of retrieved fact references and
were rejected. Two claim assignments and one fact-selection assignment timed out.

| Arm | Valid resolved selections | Incident causal passes | Control passes | Identity rejections | Timeouts |
| --- | ---: | ---: | ---: | ---: | ---: |
| Facts, object fields | 8/9 | 0/4 | 0/5 | 0 | 1 |
| Claims, object fields | 3/9 | 0/4 | 2/5 | 4 | 2 |

The eleven valid resolved selections passed grounding, selection-budget, and
no-action checks. All seven rejected/timed-out assignments remain failures in
the denominators. **The promotion gate failed; defaults remain unchanged.** Claims
stay opt-in. The two control successes are not a general diagnosis improvement.
Neither prior NSG passes nor historical results were replaced or regraded.

## Per-Assignment Outcomes

Coverage is the unchanged required-fact measure, separate from causal success.
N/A denotes a control without required cause facts; a dash denotes no resolved
submission, not zero model work. Rejections were not converted to abstentions.

| Order | Packet | Attempt | Arm | Coverage | Selected | Uncertain | Result | Session seconds |
| ---: | --- | ---: | --- | --- | ---: | --- | --- | ---: |
| 1 | NSG | 1 | Facts | 5/6 | 8 | No | Fail | 42.196 |
| 2 | NSG | 1 | Claims | - | - | - | Identity rejected | 25.298 |
| 3 | Capacity | 1 | Claims | 0/4 | 0 | Yes | Fail | 20.125 |
| 4 | Capacity | 1 | Facts | 2/4 | 6 | No | Fail | 8.788 |
| 5 | NSG | 2 | Facts | 5/6 | 6 | No | Fail | 58.724 |
| 6 | NSG | 2 | Claims | - | - | - | Identity rejected | 16.646 |
| 7 | Capacity | 2 | Claims | - | - | - | Timeout | 120.035 |
| 8 | Capacity | 2 | Facts | 2/4 | 6 | No | Fail | 8.551 |
| 9 | Wrong pool/minimum | 1 | Facts | - | - | - | Timeout | 120.033 |
| 10 | Wrong pool/minimum | 1 | Claims | - | - | - | Identity rejected | 16.332 |
| 11 | Healthy capacity | 1 | Claims | N/A | 0 | No | Pass | 39.479 |
| 12 | Healthy capacity | 1 | Facts | N/A | 0 | Yes | Fail | 5.900 |
| 13 | Shadowed deny | 1 | Facts | N/A | 10 | No | Fail | 70.122 |
| 14 | Shadowed deny | 1 | Claims | N/A | 0 | No | Pass | 79.998 |
| 15 | Kubernetes-only NSG | 1 | Claims | - | - | - | Timeout | 120.038 |
| 16 | Kubernetes-only NSG | 1 | Facts | 0/6 | 11 | No | Fail | 88.648 |
| 17 | Kubernetes-only capacity | 1 | Facts | 0/4 | 6 | No | Fail | 11.665 |
| 18 | Kubernetes-only capacity | 1 | Claims | - | - | - | Identity rejected | 23.421 |

## Failure Analysis

All four rejected claim outputs were parseable JSON with disposition `cause`, but
their `identity_ref` held a literal identifier: an Azure NIC resource ID, an NSG
resource ID, the pool name `apps`, or a workload name. The contract required a
short retrieved reference such as `r2.fN`, not its observed value. Their ordinary
`fact_refs` used the short-reference syntax. This is reference-role confusion, not
evidence that the cited identity values themselves were fabricated. The resolver
stopped at the first unknown identity and did not establish that the remaining
facts or object relationships would otherwise have been valid.

The one completed capacity claim answer selected `insufficient` with no claims.
It was a valid abstention but failed the incident's expected causal diagnosis.
Its second attempt timed out before any tool read. No resolved causal claim
survived in this batch, so explicit identity completeness was not demonstrated in
a successful live-model cause answer despite passing the offline resolver tests.

The three valid claim answers all contained no claims: insufficient capacity and
the two healthy controls. Fact selection remained incomplete on both incidents,
abstained on healthy capacity, and selected causes on shadowed deny and both
Kubernetes-only controls. Stricter output validation did not solve evidence choice.

## Transport And Usage

Assignments 7 and 15 timed out during planning before response headers, with no
tool reads or usage events. Their input/output usage remains `unknown` with null
counts. Assignment 9 completed planning in 3.844 seconds, read its control, then
waited about 116.128 seconds for synthesis headers before cancellation. Its known
planning usage is `partial`: 3,079 input and 99 output tokens; synthesis usage is
unknown. None of these three traces observed an additional fetch attempt or 429.

Assignment 14 recorded a planning HTTP **500** after about 63.836 seconds, followed
by another planning attempt returning HTTP 200 and a successful synthesis HTTP 200.
This is an observed provider-client request retry within the same logical planning
invocation, under the unchanged retry policy, not a score retry or replacement
assignment. No numeric retry-delay header was recorded. The metadata does not
identify the cause of the 500 or the earlier pre-header stalls.

Across the run there were **35 fetch attempts**, **32 responses** (31 HTTP 200 and
one HTTP 500), **29 successful read calls**, and **31 observed usage events**.
Fifteen children exited with code 0 and the three deadlines with expected code 2;
none needed a watchdog kill. No new cloud resources were provisioned and the
evaluator has exited.

| Arm | Observed input tokens | Observed output tokens | Mean seconds, all nine assignments |
| --- | ---: | ---: | ---: |
| Facts | 142,754 | 1,520 | 46.070 |
| Claims | 116,973 | 1,383 | 51.264 |

Observed totals are **259,727 input and 2,903 output tokens**, with reported input
semantics total including cache. These exclude unknown work from timed-out calls
and do not reconcile provider billing, including any work behind the HTTP 500.
Rejected answers retain their usage events, but failed records remain labelled
`partial`. The lower claims subtotal is not evidence of savings: two assignments
have no reported usage, and the arms have different failure patterns. All-assignment
duration means include failures; no latency or delivery improvement is established.

## Hypothesis And Contract

Explicit object identity plus a cause/healthy/insufficient decision may reduce
missing-name selections and contradictory abstentions. The treatment combines
instructions, a static strict schema, same-object source validation, and disposition
translation. This is not an isolated schema ablation or evidence that a model
independently learned identity completeness.

The model returns `claim_selection@1.0.0`. Each causal claim explicitly selects
an `identity_ref` and nonempty `fact_refs`. The identity must be an observed
object-relative `/name`, `/id`, `/metadata/name`, or `/metadata/uid`; all settings
in that claim must share its read, resource, evidence ID, and object group. Other
identity shapes are outside this experiment's contract. Identity references count
toward the same twelve-fact budget. Wrong but well-formed object claims remain
eligible for grading; source validation is not causal validation.

Cause requires at least one claim. Healthy and insufficient require no claims,
mapping to no cause facts and uncertainty false/true respectively. The adapter
translates only model-selected identities and settings to the existing submission
schema. Unknown/duplicate/cross-source references and contradictory shapes fail
without repair, deduplication, automatic identity expansion, or a second model call.
Rejected attempts remain in the denominator, not converted into abstentions.

## Method

- Actual assistant through the eval adapter at commit
  `277ddff46e85dd6ed6fc1ccadfd318645c8d263b`; Azure `gpt-4o`, version `2024-11-20`.
- Eighteen predeclared sessions: fact selection versus claims, both on object
  grouping and field layout. Two attempts per each NSG/capacity incident and one
  per each of five controls per arm: four incident and five control assignments.
- Blocks: NSG first attempt, capacity first attempt, NSG second attempt, capacity
  second attempt, wrong-pool/minimum, healthy capacity, shadowed deny,
  Kubernetes-only NSG, and Kubernetes-only capacity. First arm alternates by block.
  Execution is sequential, not randomized; facts run first for both NSG attempts
  and claims first for both capacity attempts. Repetition is not independent
  incident coverage, and order remains a limitation.
- Same retained packets and evaluator contracts from the
  [grouping/guidance experiment](observability-object-guidance-results.md).
  Wrong-pool/minimum, healthy, and shadowed-deny controls are synthetic; the
  Kubernetes-only controls restrict access to captured incident reads. This is
  not fresh live AKS provisioning or execution of the 100 researched candidates.
- Strict numeric output; no AKS diagnostic-guidance option or final token/deadline
  limit. The claim-specific instructions differ by design. Raw inputs, field
  presentation, graders, eight-read/twelve-fact budgets, 120-second outer deadline,
  and 135-second child watchdog stay fixed. Provider retry policy is unchanged.
- The predeclared promotion gate requires claims to pass all four incidents and
  all five controls, with no format/transport failures, and exceed fact selection
  in causal passes. Otherwise claims remain opt-in.
- No score retries, output repair, oracle fact expansion, or historical regrading.
  Model-generated planning/history can vary, so requests need not be byte-identical.

The prospective causal grader is evaluator-supplied, not a domain causal engine.
It may reject defensible extra facts outside its required/supporting alternatives.
Required fact coverage and causal passes must be reported separately. Safety is
graded independently. A shape that forbids symptoms on insufficient answers does
not itself establish when evidence is insufficient.

## Offline Checks

All **392 eval tests**, formatting, and typechecks passed before committing,
including 41 focused candidate tests. Tests cover missing and wrong identity shapes,
cross-pool/read/resource/evidence claims, duplicates, nested/root identities,
explicit-only resolution, disposition consistency, and wrong-but-grounded claims.
Actual mocked Azure requests cover row/field layouts and numeric/labelled references.
Unsupported configurations fail before model construction. Default fact-selection
prompt content, shared runtime, graders, and historical reports are unchanged.

The private launcher validated all eighteen assignments/options and trace privacy
before execution. The prior lossless field-layout checks remain applicable: the
claim experiment changes the output contract, not the evidence renderer.

## Provenance

Private root: `.tmp/pr25-identity-claims-comparison-20260917`. The existing private
transport launcher has an explicit `--claims-comparison` mode; prior modes and
artifacts are retained. The plan freezes assignments, options, budgets, gate,
source hashes, and original input-case digest before credentials/model calls.
Source hashes are checked before each child. Original input-case SHA-256:
`7cfe9ab0d0646acd6f16fae8d2fc8b3ca2247352d74f4475806707da6a2c0fc7`.

| Artifact | SHA-256 |
| --- | --- |
| `plan.json` | `e94595bb88eb53d68b6ce6ca2ffd88c5f6512f22b7edace5b0cc0978c50f2c56` |
| `summary.json` | `8c40c9ba3bea718fd0f32e81021f95f703b05dc8bed72dc483eb0076071102b8` |
| `sources.json` | `59bb1efa6c46c0056950c11d1fe16ae9693424f323aa30c2ea1a1abb63ee3b0b` |
| `cases.json` | `8a8dbd5f57322a26a6213a3ca26f3846e4a61065ec709acc6b1a271113bcbb15` |

Each child retains atomic progress/terminal records, raw output, observations,
effective contract, sanitized HTTP metadata, usage, and process disposition.
Tracing preserves the original Response without reading its body or logging
credentials/headers/prompts. Keys stay in process memory and child stdin.
Durations include local persistence overhead but exclude parent startup and
credential acquisition. Fetch traces and local cancellation do not establish
server-internal queue/retry behavior or remote billing termination.

After execution, all eighteen terminal dispositions, effective contracts/layouts,
source hashes, original case digest, and private directory/record modes were
verified. Published outcome rows and numerical totals were checked against saved
records. The committed candidate was not changed during collection.

## Next Step

Do not promote claims or add further restrictions on this evidence. The immediate
candidate hypothesis is reference-role ambiguity: first test clearer identity
reference wording and a syntax-only example offline, without resolving literal
names/IDs by guessing or adding oracle facts. A later paid comparison would need
a new fixed plan separating that change from disposition instructions. Keep the
current failures and graders intact; do not rerun the batch to obtain passes.