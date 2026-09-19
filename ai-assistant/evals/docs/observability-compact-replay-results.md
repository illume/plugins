# Compact Evidence And Explicit Selection Replay

Date: 2026-09-17. PR: https://github.com/illume/plugins/pull/25.

Historical report: the operator first enabled `compact` for its efficiency benefit,
then promoted strict numeric selection for Azure/OpenAI after the separate factorial.
See [current defaults, research phases, and backlog](../../docs/observability-research.md).
The experiment, configuration descriptions, and recommendations below describe
their respective historical checkpoints; no recorded scores have changed.

## Result

Compact evidence reduced input tokens and latency, but did not improve diagnosis
pass rates in this small development replay. Both new modes remain **opt-in**;
the default AI Assistant eval adapter remains `full`.

| Enabled Arm | Sessions | Pass | Partial | Fail | Invalid Selection | Mean Synthesis Input Tokens | Mean Session Seconds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Full observation payload | 4 | 2 | 1 | 1 | 0 | 38,262.75 | 17.827 |
| Compact payload, existing answer schema | 4 | 1 | 3 | 0 | 0 | 18,150 | 12.136 |
| Compact payload, explicit fact references | 4 | 1 | 1 | 0 | 2 | 17,631 | 11.559 |

All reported passes also passed the new selection controls. None of the model
answers was an echo-all dump or exceeded the public 12-fact budget. These controls
are necessary checks, not a complete test of causal explanation quality.

Compact-only reduced average synthesis input by about 53% and session latency by
about 32% relative to the replay baseline. These are descriptive averages across
four attempts, not confidence bounds. Selection latency includes invalid answers
and must not be interpreted as faster successful diagnosis.

## Experiment

- Same Azure deployment `gpt-4o`, version `2024-11-20`, through the actual
  `LangChainAssistantSession`. Fresh session per attempt.
- Two retained AKS incidents: NSG backend denial and autoscaler maximum.
- Three arms, two repetitions per incident: 12 enabled sessions. Mode order was
  rotated by incident and repetition. Two additional compact-select Kubernetes-only
  controls bring the total to 14 sessions and 28 observed model requests.
- All modes received the same observation lists, task, read arguments, 12-fact
  budget, eight-call limit, and 120-second deadline. No corrections, score retries,
  answer repair, or removal of unsuccessful attempts.
- Totals: 364,704 model input tokens and 10,503 output tokens. No tool calls were
  rejected. No cloud infrastructure was provisioned or changed.

**Replay fidelity:** the original live runs retained flattened observation lists,
not every original raw tool payload. This experiment passed those recorded facts
through `callTool`, with `data=null` in every arm, and fresh evidence IDs on each
read. It is not an exact raw-payload replay and is not comparable directly to the
old live pass rate. Missing containers/fields were explicitly described as not
retained, not absent. Original live scores and artifacts remain unchanged.

The three arms compare presentation and selection, not autonomous resource/query
discovery. The compact-select prompt necessarily changes the requested output
schema; it does not isolate token reduction from every prompt effect. Two
repetitions of two familiar snapshots are development feedback, not independent
incident coverage or a statistical superiority result.

## Every Attempt

| Order | Incident | Mode | Access | Diagnosis | Selected Facts | Required Facts Covered |
| ---: | --- | --- | --- | --- | ---: | ---: |
| 1 | NSG | full | enabled | Pass | 10 | 6/6 |
| 2 | NSG | compact | enabled | Partial | 12 | 5/6 |
| 3 | NSG | compact-select | enabled | Invalid JSON | 0 resolved | 0/6 |
| 4 | Capacity | compact | enabled | Pass | 10 | 4/4 |
| 5 | Capacity | compact-select | enabled | Invalid JSON | 0 resolved | 0/4 |
| 6 | Capacity | full | enabled | Fail: two unsupported facts | 12 | 3/4 |
| 7 | NSG | compact | enabled | Partial | 8 | 5/6 |
| 8 | NSG | compact-select | enabled | Pass | 9 | 6/6 |
| 9 | NSG | full | enabled | Pass | 10 | 6/6 |
| 10 | Capacity | compact-select | enabled | Partial | 6 | 1/4 |
| 11 | Capacity | full | enabled | Partial | 8 | 3/4 |
| 12 | Capacity | compact | enabled | Partial | 10 | 3/4 |
| 13 | NSG | compact-select | Kubernetes only | Fail: no accepted cause | 12 | 0/6 |
| 14 | Capacity | compact-select | Kubernetes only | Duplicate references | 0 resolved | 0/4 |

Required-fact coverage here is set coverage; unsupported citations can still
invalidate an answer. The 11 valid submissions passed the no-action grader.
The three invalid selections have no valid submission/no-action score; zero
rejected tool calls is not a substitute for that missing score.

## What The Failures Show

Two selection responses had an extra closing brace **inside** their JSON fenced
blocks. They were rejected rather than repaired. The disabled capacity response
selected the same reference twice and was also rejected.

In the valid capacity selection, the model selected the actual `minCount` fact
while its prose discussed `maxCount`. The deterministic resolver correctly
produced the selected minimum, not the intended maximum. It also omitted pool
identity and autoscaling enablement. This demonstrates the boundary: selecting
an existing fact prevents a fabricated path, but does not establish that the
selection supports the model's explanation.

The NSG Kubernetes-only answer expressed uncertainty but still selected twelve
unrelated Kubernetes facts as causes. It did not pass. Better abstention remains
necessary; reference validation alone cannot decide that no cause is established.

## Implementation And Controls

`createHeadlampObservabilityCandidate` accepts `evidenceMode`:

- `full`: unchanged default payload and legacy diagnosis output.
- `compact`: groups every observation by read/resource, hoists repeated metadata,
  and displays `[reference, field_path, observed_value]` rows. The candidate still
  writes the original diagnosis submission fields.
- `compact-select`: same compact evidence, but the model returns
  `fact_selection@1.0.0` with `fact_refs`. Only selected references are resolved
  to exact observed resource/path/value/citation tuples. No related fields are
  automatically added; unknown IDs, duplicate IDs, invalid envelopes, and malformed
  JSON are rejected. The original and resolved outputs are recorded separately.

The compact registry clones retained facts so candidate-side mutations cannot
change them. References are local to each read/session. Fresh reads retain their
own identities even if values change or response arrays reorder. The model view
does not duplicate raw JSON. Empty raw containers, when available, are preserved
as a separate list with escaped JSON Pointer paths. No field filtering is based
on the oracle. Losslessness applies to the received observation tuples; it does
not recover primitive type information already lost by the original flattener.

`gradeObservabilitySelection` is a **supplementary**, versioned evaluator function.
It reports distinct selected/observed counts, required-fact coverage, unsupported
facts, duplicates, echo-all behavior, and budget compliance. The experiment uses
the unchanged legacy diagnosis/no-action scores together with `passesControls`.
Callers must disclose the fact budget in the candidate task before applying it.
The controls do not feed evaluator truth to the candidate or change historical
scores. Neither controls nor selected IDs validate arbitrary prose claims.

Unit controls cover the original echo-all shortcut (legacy pass, new control
failure), grounded selective output, forged paths, fresh-read mismatches,
duplicates, unknown IDs, tampering, invalid selection schemas, escaped paths,
untrusted string values, and empty-container preservation.

## Provenance

Private run directory: workspace `.tmp/pr25-compact-replay-20260917`.
All 14 original responses, resolved submissions/errors, telemetry, observations,
scores, the predeclared plan, and source hashes are retained there.
The private launcher is `ai-assistant/evals/.local/replay-compact-evidence.ts`.
It reads the existing Azure key only into memory; no credentials are in this report.

| Artifact | SHA-256 |
| --- | --- |
| `plan.json` | `41db576245be60a8eaefface93322cb7fb97bb14fcb2576894a806e2f8d344cc` |
| `summary.json` | `e35b24f69172a028b22fe6ae61ab9170e9453db7839fff8ceca5f1187f2936bb` |

## Decision

Retain both modes for further experiments but do not enable either globally on
the strength of this run. Compact representation is promising for efficiency,
not yet for demonstrated diagnosis accuracy. The next distinct experiment should
address strict selection-output reliability and semantically meaningful fact
selection, with fresh counterexamples and the same budget. Do not silently strip
invalid JSON, deduplicate selections, expand gold-required fields, or regrade
these attempts as successful. A bounded correction loop and new live Azure runs
were deliberately not included in this implementation.

## Follow-Up Research

After the replay, the operator chose compact-only as the eval default for its
efficiency benefit. The next accuracy experiments should separate output-format
reliability from evidence selection; neither improvement is assumed to follow
from enabling compaction.

### 1. Constrain The Final Output

Two of four enabled fact-selection attempts failed because their JSON contained
an extra closing brace. Use provider-enforced structured output on the final
answer call, not another prompt requesting valid JSON and not post-hoc repair.
Leave retrieval and the model version fixed. The installed Azure LangChain client
supports `withStructuredOutput(schema, { method: 'jsonSchema', strict: true,
includeRaw: true })`; a fully mocked HTTP probe confirmed the request contains
`response_format.type=json_schema`, `strict=true`, no forced tool call, and retains
both parsed content and raw usage metadata. This is a client integration check,
not a live service test or evidence of improved diagnosis.

[Azure documentation](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/structured-outputs)
lists GPT-4o `2024-11-20` as supported. All fields must be required, optional
values need an appropriate nullable representation, and unsupported schema
keywords cannot be relied on. In particular, continue enforcing duplicate
selection and fact-budget rules locally; schema validity does not mean a cited
fact supports a claim. Handle refusal and incomplete responses explicitly.

The production session currently calls the unbound model for synthesis. Introduce
an explicit optional structured-final-response contract at that boundary rather
than replacing the actual assistant with a separate bare model client or mutating
private model state. Preserve the original task, telemetry, cancellation, and
read-only authorization. Avoid constraining the initial tool-planning turn with
the final-answer schema. Structured decoding can affect reasoning quality:
[Tam et al.](https://arxiv.org/abs/2408.02442) observed degradation under format
restrictions in their tested tasks, not proof of degradation for this Azure
deployment. Measure correctness as well as format compliance.

### 2. Make References Distinguishable

In the retained capacity response, `r2.f42` means `maxCount`, `r2.f43` means
`minCount`, and both values are `1`. The model selected the latter while discussing
the former. Test references that retain the field name, for example
`r2.pool1.maxCount` versus `r2.pool1.minCount`, with identity held in a per-read
registry. Generate names from the observed schema, not gold labels or the presumed
fault. Escape collisions and keep source identity; do not reinterpret a reference
against a later reordered response.

[Anthropic's tool-design guidance](https://www.anthropic.com/engineering/writing-tools-for-agents)
reports benefits from interpretable identifiers, but that is vendor experience,
not a measured GPT-4o result here. The current references already save tokens;
the next test concerns selection mistakes, not a claim that every longer label
is better.

### 3. Group Related Fields Without Filling Answers

Compact-only omitted the NSG rule name in one attempt, direction in another,
and the pool name in one capacity attempt. Current grouping is by whole tool
response, not by individual NSG rule or node pool. Test one labelled record per
rule/pool, with identity and related configuration fields displayed together.
Keep every observed field accessible and preserve empty/incomplete states.
Require explicit field selections: automatically expanding a record into every
gold-required field would conceal omissions and inflate the current score.

### Proposed Comparison

Keep compact-only as the operational baseline. Before adding a correction loop,
compare a small factorial experiment within fact-selection mode:

| Arm | Final JSON Constraint | Reference Labels |
| --- | --- | --- |
| A | Prompt only | Existing sequential IDs |
| B | Strict schema | Existing sequential IDs |
| C | Prompt only | Field-labelled IDs |
| D | Strict schema | Field-labelled IDs |

Use the same tasks, model, budgets, and observation records across arms, with
counterbalanced order and a fixed run count. Measure schema failures, duplicate
or unknown references, wrong-field selections, required-fact omissions, appropriate
abstention, tokens, and latency separately. Include renamed/reordered pools,
equal `minCount`/`maxCount` values, unrelated capped pools, and NSG rules for the
wrong port or direction. Retained incidents are development data; check new
incident instances before claiming a reliability improvement. No new paid model
or Azure execution was performed for this follow-up research.