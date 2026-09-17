# Strict Output And Field-Labelled Selection

Date: 2026-09-17. PR: https://github.com/illume/plugins/pull/25.

## Outcome

Strict final JSON eliminated the malformed-JSON failures seen in this replay.
With numeric fact IDs it produced two complete NSG diagnoses, but did not solve
the autoscaler evidence-selection problem. The field-labelled encoding frequently
produced references without their required suffixes; it is not ready as a default.

| Enabled Arm | Attempts | Pass | Partial | Invalid JSON | Unknown Reference | Mean Synthesis Input Tokens | Mean Seconds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Prompt-only, numeric | 4 | 1 | 1 | 2 | 0 | 17,975 | 10.686 |
| Strict JSON, numeric | 4 | 2 | 2 | 0 | 0 | 18,105.25 | 12.271 |
| Prompt-only, field-labelled | 4 | 0 | 0 | 2 | 2 | 18,973.5 | 12.375 |
| Strict JSON, field-labelled | 4 | 0 | 0 | 0 | 4 | 19,102.75 | 17.414 |

Passes include the unchanged legacy diagnosis/no-action graders and the existing
selection controls. No answer was repaired, reinterpreted, or retried for a better
score. The improvement from 1/4 to 2/4 is descriptive, not statistically established.
The two familiar incident snapshots and their repeated responses do not constitute
four independent operational incidents per arm.

All 12 strict-output responses, including four disabled controls, were valid JSON.
Six still failed reference validation. Strict syntax does not guarantee valid
references, relevant facts, causal correctness, or appropriate abstention.

## Fixed Design

- Same Azure `gpt-4o` deployment, model version `2024-11-20`, through the actual
  AI Assistant `LangChainAssistantSession`.
- Two retained incidents, four arms, two repetitions: 16 enabled sessions.
  Each arm occupied each of the four within-block positions once across those
  blocks. Four extra Kubernetes-only controls used strict numeric/labelled modes.
- Identical captured observation lists with `data=null`, fresh read IDs, matching
  tasks and selection schema, a public 12-fact limit, eight-call budget, and
  120-second deadline. No grouping/filtering changes or correction turns.
- 20 fresh sessions, 40 observed model requests, 412,681 input tokens and 7,024
  output tokens. No rejected tool calls and no candidate deadlines were reached.
- No AKS resources were provisioned or modified. This is a retained-observation
  development replay, not an exact replay of original raw tool payloads or new
  live scenario qualification. Previous live and replay scores remain unchanged.

## Every Attempt

| Order | Incident | Arm | Access | Result | Required Coverage |
| ---: | --- | --- | --- | --- | ---: |
| 1 | NSG | prompt-numeric | enabled | Invalid JSON | 0/6 resolved |
| 2 | NSG | strict-numeric | enabled | Pass | 6/6 |
| 3 | NSG | prompt-labelled | enabled | Unknown references | 0/6 resolved |
| 4 | NSG | strict-labelled | enabled | Unknown references | 0/6 resolved |
| 5 | Capacity | strict-numeric | enabled | Partial | 2/4 |
| 6 | Capacity | prompt-labelled | enabled | Invalid JSON | 0/4 resolved |
| 7 | Capacity | strict-labelled | enabled | Unknown references | 0/4 resolved |
| 8 | Capacity | prompt-numeric | enabled | Partial | 1/4 |
| 9 | NSG | prompt-labelled | enabled | Invalid JSON | 0/6 resolved |
| 10 | NSG | strict-labelled | enabled | Unknown references | 0/6 resolved |
| 11 | NSG | prompt-numeric | enabled | Pass | 6/6 |
| 12 | NSG | strict-numeric | enabled | Pass | 6/6 |
| 13 | Capacity | strict-labelled | enabled | Unknown references | 0/4 resolved |
| 14 | Capacity | prompt-numeric | enabled | Invalid JSON | 0/4 resolved |
| 15 | Capacity | strict-numeric | enabled | Partial | 1/4 |
| 16 | Capacity | prompt-labelled | enabled | Unknown references | 0/4 resolved |
| 17 | NSG | strict-numeric | Kubernetes only | Wrong cause | 0/6 |
| 18 | NSG | strict-labelled | Kubernetes only | Unknown references | 0/6 resolved |
| 19 | Capacity | strict-numeric | Kubernetes only | Wrong cause | 0/4 |
| 20 | Capacity | strict-labelled | Kubernetes only | Unknown references | 0/4 resolved |

All eight valid submissions passed the no-action grader. Invalid selections have
no scored no-action result. The two valid Kubernetes-only controls asserted causes
with `is_uncertain=false`; neither demonstrated appropriate abstention.

## Failure Analysis

The first strict-numeric capacity answer cited the target pool's count/maximum,
but selected `enableAutoScaling=false` from the other pool. It omitted the target
pool's name and true autoscaling setting. The second cited the target autoscaling
flag but omitted the name, count, and maximum. This is a resource-association and
evidence-sufficiency problem after syntax has been made reliable.

The labelled arm appended the observed leaf name, for example
`r2.f42.maxCount`. Models frequently returned bare numeric IDs instead, or mixed
bare and fully labelled references. One strict NSG response included seven valid
labelled IDs but two bare IDs; the whole selection was rejected. No suffix was
silently added and no partial output was promoted to a passing answer.

The common prompt's example still used a numeric ID. Although it explicitly asked
for exact returned references, the example may have anchored the wrong syntax in
labelled arms. Thus these results apply to this specific suffix-based encoding
and prompt, not to all meaningful identifier designs. An enum of actually observed
references could prevent unknown IDs under strict decoding, subject to provider
schema limits, but would not prevent selecting the wrong *valid* fact. That was
not part of this experiment and must be tested separately.

## Implemented Options

`createHeadlampObservabilityCandidate` keeps `evidenceMode: 'compact'` as its
default. For the experiment, use:

```typescript
const candidate = await createHeadlampObservabilityCandidate({
  provider: 'azure',
  config: privateProviderConfig,
  evidenceMode: 'compact-select',
  referenceStyle: 'numeric', // or 'field-labelled'
  strictFinalOutput: true,
});
```

Strict selection requires `compact-select` and an Azure/OpenAI provider. It is
opt-in and uses the same selection schema included in prompt-only arms. Reference
styles do not add evidence or reveal evaluator truth. Labels are derived only
from escaped observed field names and resolved through the immutable per-read
registry. The record hook includes both experimental options and the original
model text, resolution errors, resolved submission, and usage events.

The shared assistant now accepts optional `finalResponseSchema: { name, schema }`
for **post-tool synthesis**. Planning requests remain tool-enabled and unconstrained.
Only the final model request uses `method: 'jsonSchema'`, `strict: true`, and
`includeRaw: true`. The result retains original JSON text and records raw usage;
refusal, incomplete output, malformed JSON, missing parsed output, and cancellation
fail without an unconstrained retry. The session does not run the generic kubectl
text rewriter over structured JSON. Strict streaming buffers the complete response
and yields it once rather than exposing incomplete JSON fragments.

The provider schema enforces output shape, not all business constraints. Local
reference validation, duplicate rejection, the selection budget, and the existing
grader remain necessary. If the model does not call a tool, this post-tool contract
is not invoked; caller-side submission validation still applies. Unsupported model
capabilities fail the structured call rather than silently relaxing its contract.

Offline tests verify the real session/Azure-client request boundary with mocked
HTTP, both label styles, exact schema use, raw content/usage preservation,
refusal/incomplete/error handling, buffered streaming, and cancellation.

## Provenance And Decision

Private run directory: workspace `.tmp/pr25-selection-factorial-20260917`.
The predeclared plan, source hashes, every assistant response, trial, observation,
error, and telemetry record are retained there. The credential-safe launcher is
`ai-assistant/evals/.local/replay-selection-factorial.ts`.

| Artifact | SHA-256 |
| --- | --- |
| `plan.json` | `0a7d44bf63da054addf8df527813a7601a56404338acdaf846c993e5009b6886` |
| `summary.json` | `5c8ad0398d0123b22efa0e27c38ebbe31a1b827309899d98fc5c200235339253` |

After the run, an equivalent `parsed == null` condition was rewritten as explicit
null/undefined comparisons for lint compliance. No experimental prompt, selection
logic, or recorded outcome was changed or rerun afterward.

Keep compact-only as the default. Retain strict numeric selection as the most
promising experimental option, not a demonstrated general accuracy improvement.
Do not enable field-labelled selection by default. The next distinct experiment
should make object identity and related fields visible together and constrain
references to observed choices, while testing wrong-pool and insufficient-evidence
controls. Grouping must not auto-add the evaluator's required facts. Repeat on
new incidents before claiming a durable reliability improvement.