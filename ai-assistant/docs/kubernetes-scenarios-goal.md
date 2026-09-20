# Scenarios Goal

Status: active program, 2026-09-20

> Full coverage of product-scoped canonical diagnosis capabilities, plus
> risk-weighted coverage of policy, runtime, host, and platform-specific tails.

This is the governing objective for Kubernetes diagnosis scenario selection,
implementation, qualification, and reporting. Raw tool-rule counts remain source
provenance; they are not the completion denominator.

All artifacts are agent-generated. Versioned source, canonicalization, skeptic,
scenario, fixture, oracle, and qualification agents produce the work; deterministic
schemas and executable validators reject omissions and inconsistencies. No manual
scenario authoring, manual scoring, or private holdout set is required.

Surveyed tools are not test dependencies. Their pinned rules provide provenance
and predicates; Scenarios Goal creates the corresponding broken Kubernetes state,
captures native resource, status, condition, Event, log, metric, or runtime
evidence, and evaluates a normalized oracle. Coverage of a Popeye, Falco,
kube-bench, or other rule means the scenario exercises that rule's predicate. It
does not mean the scenario installs or runs that tool.

## Completion criteria

The goal is complete only when all of these conditions hold:

1. Every approved product-scoped canonical capability has qualified positive and
   healthy-negative scenarios.
2. Capabilities whose predicates depend on missing, stale, conflicting, or
   incomplete evidence also have qualified uncertainty, temporal, or confounder
   scenarios.
3. Every critical capability in each tail domain is qualified.
4. Qualified scenarios cover at least 80% of the frozen risk weight separately in
   policy, runtime, host, and platform-specific domains.
5. Reproducible agent-generated capability and composition challenge batches pass
   after the implementation is frozen, then ship with their provenance.
6. Coverage is reported separately as `targeted`, `implemented`, and `qualified`.

A draft, a source-rule match, a silent negative branch, or a successful static
scan does not by itself count as qualified diagnosis coverage.

## Canonical denominator

A canonical capability is a source-grounded, multi-agent-reviewed cross-tool
equivalence class. Members must agree on:

- subject resource or component;
- trigger predicate and negative condition;
- required observations and mechanisms;
- expected finding and evidence relation;
- temporal behavior;
- material platform and version constraints.

Similar titles are insufficient. Rules with different evidence, temporal gates,
or outcomes remain separate capabilities. Profile copies with equivalent
predicates remain source occurrences of one capability.

A capability is product-scoped only when Headlamp can obtain the required evidence
and present or safely orchestrate the outcome on a declared supported profile.
Reference-only artifacts may inform a capability but cannot establish coverage.

## Product scope v1

The built-in product surface exposes one
[`kubernetes_api_request`](../packages/ai-common/src/tools/catalog/toolDefinitions.ts)
tool. Its
[implementation](../packages/ai-common/src/tools/kubernetes/langchain/KubernetesTool.ts)
supports authorized Kubernetes API reads, including resource specifications,
status, conditions, Events, and Pod log subresources. These evidence types define
the initial product core. Approval-bound Kubernetes mutations remain a separate
repair capability layered on the same API surface.

Time-series metrics, runtime syscall events, node logs, node filesystems, and
cloud-provider APIs are not unconditional built-in evidence. They remain tails
unless an evidence adapter is declared, enabled, and qualified. The adapter
captures native evidence for normalized predicates; it does not invoke the tools
from which those predicates were researched. A capability does not enter the
product core merely because an external tool can detect it.

## Risk model

Risk scoring is frozen before scenario selection. Independent scorer agents assign
ordinal values from 1 to 5 for impact, prevalence, exposure, and platform relevance.
A critic agent resolves agreement mechanically or leaves the capability
`risk_unresolved`; it never averages an unexplained disagreement. The tail risk
weight is:

$$
W = I \times P \times E \times R
$$

A capability is critical regardless of its aggregate weight when it can cause a
control-plane outage, irreversible data loss, cross-tenant or privilege-boundary
breach, or broad credential disclosure. Qualification cost is used only to order
work; it never lowers risk weight.

For each tail domain, report:

$$
\text{qualified risk coverage} =
\frac{\sum W_{\text{qualified}}}{\sum W_{\text{in-scope}}}
$$

Do not combine domains into one percentage that can hide an omitted tail.

## Current baseline

The source inventory contains 7,427 occurrences in 2,654 tool-local groups,
including 1,496 direct-predicate groups. The active roster has 275 scenarios but
only 12 normalized evaluator contracts.

The five draft catalogues add 415 specifications. Existing predicate coverage plus
the authored bundles targets 2,005 direct-predicate occurrences and 661 tool-local
direct-predicate groups across 14 tools: 32.9% of direct occurrences and 44.2% of
direct-predicate groups. These are progress figures, not Scenarios Goal completion.
Canonical qualified coverage is not measurable until the canonical registry and
risk review are complete.

| Gate                          | Current state  | Completion evidence still required                                              |
| ----------------------------- | -------------- | ------------------------------------------------------------------------------- |
| Product evidence boundary     | Defined for v1 | Source-grounded scope-agent verification                                        |
| Canonical capability registry | Not complete   | Multi-agent mapping for every direct predicate and decomposed branch            |
| Tail risk weights             | Not frozen     | Reproducible scorer-agent outputs and critic resolution                         |
| Draft scenario targeting      | 415 drafts     | Canonical reconciliation after registry review                                  |
| Fixture implementation        | 415 authored   | Observation execution and cleanup evidence for generated bundles                |
| Qualification                 | Not complete   | Positive, healthy, temporal, uncertainty, and confounder evidence as applicable |
| Generated challenge batches   | Not complete   | Post-freeze generation, execution, and published provenance                     |

Scenarios Goal is therefore **in progress**, not complete. The remaining gates
require agent execution, live evidence, and deterministic validation; they cannot
be satisfied by increasing draft counts alone.

## Work plan

### 1. Canonicalize

Create a versioned canonical-capability registry. Map every tool-local occurrence
to one capability, `reference_only`, or an explicit unresolved disposition.
Cross-tool merges require agreement between a source agent, canonicalizer agent,
and skeptic agent over the normalized predicate fields, not title similarity.

Exit gate: every direct-predicate occurrence is mapped or explicitly unresolved;
all merge decisions retain pinned evidence.

### 2. Scope and score

Classify each capability as product core or one tail domain. Record evidence
availability, supported profiles, impact, prevalence, exposure, platform
relevance, critical status, agent versions, prompts, evidence, and decision trace.

Exit gate: independent scorer agents agree, a critic agent accepts their evidence,
and scope and risk weights are frozen before further coverage optimization.

### 3. Reconcile scenarios

Map active and draft scenarios to canonical capabilities. Preserve one
independently triggerable fixture per scenario; merge rules only when the same
root setup or action naturally triggers equivalent predicates.

Every scenario, fixture, healthy twin, oracle, and confounder is generated by a
versioned agent from source-grounded capability data. Deterministic checks enforce
schema, uniqueness, source provenance, and candidate/evaluator separation.

Exit gate: every scenario has a positive oracle, healthy control, required
evidence, platform constraints, and no duplicate semantic target.

### 4. Implement shared harnesses

Build reusable harnesses in increasing cost order:

1. manifest and policy evaluation;
2. Kubernetes API relationship and status observation;
3. Prometheus-compatible telemetry and temporal windows;
4. runtime syscall and process evidence capture;
5. node-log replay and condition observation;
6. cloud and platform-specific evidence.

Exit gate: each harness has deterministic setup, cleanup, evidence capture, and
failure classification.

### 5. Qualify and close gaps

Promote drafts only after setup, observation, oracle, cleanup, and leakage agents
produce passing machine-verifiable evidence.
Choose each subsequent scenario by uncovered canonical risk weight divided by
qualification cost, subject to the core and per-domain completion gates.

Exit gate: 100% core, 100% critical tails, and at least 80% risk weight in every
tail domain are qualified.

### 6. Generate robustness challenges

Freeze the rules engine, then have a separate challenge agent generate capability
variants, composed faults, renamed resources, alternative API representations,
stale evidence, and evidence-adapter failures from the canonical registry. Do not provide
the challenge generator with candidate outputs or evaluator aliases. Publish each
challenge batch, seed, agent version, prompt digest, and result after the run.

Exit gate: post-freeze generated challenge results are reported separately and do
not retroactively become qualification evidence for that frozen engine version.

## Related artifacts

- [Diagnosis rules research](kubernetes-diagnosis-rules-research.md)
- [Pinned tool-rule inventory](kubernetes-tool-rule-inventory.md)
- [Current tool-to-scenario mapping](kubernetes-tool-scenario-coverage.md)
- [First rule-gap draft batch](kubernetes-rule-gap-scenarios.md)
- [Marginal rule-gap draft batch](kubernetes-rule-gap-scenarios-v2.md)
- [Cross-tool rule-gap draft batch](kubernetes-rule-gap-scenarios-v3.md)
- [Undercovered-tool rule-gap draft batch](kubernetes-rule-gap-scenarios-v4.md)
- [Remaining direct-predicate rule-gap draft batch](kubernetes-rule-gap-scenarios-v5.md)
- [Scenario implementation progress](kubernetes-scenario-implementation-progress.md)
