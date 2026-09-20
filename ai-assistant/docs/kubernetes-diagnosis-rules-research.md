# Kubernetes diagnosis rules research

Status: active research backlog, 2026-09-20

This document owns research into a deterministic Kubernetes diagnosis rules
engine for Headlamp. It covers the current Headlamp baseline, comparable tools,
rule construction from Kubernetes source and tests, sizing estimates,
architecture, and fair evaluation. It does not authorize semantic answer
injection into model evaluations.

## Working claim

A useful first Headlamp engine probably needs 25-40 reviewed runtime trigger
families over the core Pod-to-workload path. A production core is more likely
75-120 trigger families over 15-20 Kubernetes resource and relationship types.
A broad engine that includes telemetry, control-plane health, upgrades, security,
and selected operators could reach 150-250 families.

Those are causal or contradiction-aware families. Operator breadth is a
separate dimension: the Argo CD evidence below shows that broad CRD support can
require hundreds of GVK-specific health adapters even when those adapters map
into a much smaller shared health and causal vocabulary.

These are planning ranges, not measured coverage claims. The strongest direct
precedent currently inspected is K8sGPT: 31 registered built-in analyzers contain
87 explicit failure-text construction sites. One construction site can cover
multiple Kubernetes reasons, while several sites can express variants of one
cause, so neither count is a canonical rule total. The ranges must be revised
from a reviewed rule inventory and live scenario results.

The cheapest falsification is a five-family pilot covering scheduling capacity,
image pull, missing ConfigMap volume, Service-to-EndpointSlice selection, and
stalled rollout. Compare source-derived candidates with independently
hand-authored rules on hidden healthy, broken, stale-evidence, and confounded
cases. If source derivation does not reduce authoring effort or preserve
precision, it should remain a discovery aid rather than a construction system.

## Pinned rule inventories

Coverage mapping starts from the complete pinned lists in
[Kubernetes tool rule inventories](kubernetes-tool-rule-inventory.md). The
human-readable index links to one list per tool and every listed unit links to
the exact source or data file at the inspected revision. The normalized
machine-readable snapshot is
[`tool-rule-inventory-v1.json`](../evals/registrations/tool-rule-inventory-v1.json)
and is validated by
[`tool-rule-inventory.schema.json`](../evals/schema/tool-rule-inventory.schema.json).

The provisional snapshot contains 7,427 source occurrences in 2,654 tool-local
semantic groups from 23 tools. At row level, 6,088 occurrences are shaped like
direct predicates, 1,040 require decomposition before mapping, and 299 are
reference-only artifacts. Occurrences preserve profile, platform, source, and
version variants; semantic groups prevent those variants from being mistaken
for independent scenario requirements. At the group level, the review workload
is 1,496 direct-predicate groups, 859 groups requiring decomposition, and 299
reference-only groups. Cross-tool groups have not yet been merged.

Popeye and Kubescape have received a deeper implementation pass. Popeye has 110
codes linked to production `AddCode`, `AddSubCode`, `AddErr`, or computed
companion emitters; seven glossary entries (`402`, `403`, `404`, `703`, `712`,
`901`, and `1205`) have no production emitter at the pinned revision and remain
`not_found`. All 303 Kubescape rule names resolve by metadata identity to a
`rule.metadata.json` and `raw.rego`; five initially missed rules lived in
directories whose names differed from their metadata names. Of those rules, 242
have concise extracted predicate summaries and 61 remain marked for predicate
decomposition. Resolved implementation status means the source can be reviewed,
not that its predicate is already normalized or that a current scenario covers
the rule.

The inventory does not assign scenario coverage. That separation ensures the
next mapping step can mark each unit `covered`, `unsure`, or `uncovered` without
changing the source inventory or hiding gaps. `direct_predicate` is eligibility
for mapping review, not evidence that a current scenario covers the item.

The mapping must provide two projections:

1. **Rule-centric:** every semantic group is `covered`, `unsure`, or
   `uncovered`, with the exact existing scenario IDs and a short evidence-based
   rationale.
2. **Scenario-centric:** every tool × scenario cell reports `covered`, `unsure`,
   `uncovered`, or `no_applicable_rule`. `no_applicable_rule` means the complete
   inspected inventory for that tool has no rule whose declared subject,
   evidence, and predicate apply to the scenario. It does not mean the tool was
   unavailable, lacked permission, lacked telemetry, failed to run, or produced
   no finding; those are separate execution dispositions.

Assign `no_applicable_rule` only after reviewing every directly mappable group
and every decomposed branch relevant to the scenario's resources and mechanisms.
An analyzer, adapter, module, report kind, or runbook that could contain a
relevant branch remains `unsure` until decomposed; it must not be converted to
`no_applicable_rule` from its title alone.

Semantic groups are review batches, not automatic equivalence classes. Final
coverage remains occurrence-specific unless the mapper verifies that grouped
entries have equivalent predicates, inputs, applicability, and outcomes. Before
a rule can generate a scenario, enrich its mapping with subject resources,
required observations and mechanisms, trigger predicate, expected finding,
healthy or negative condition, temporal behavior, platform/version scope, and
cluster-profile feasibility. A title and summary alone are insufficient.

Use upstream IDs when they exist. For libraries without a stable rule registry,
derived IDs include a human-readable semantic element plus a short content or
source hash, for example
`node-problem-detector:source:kernel-monitor-oomkilling:<hash>` or
`coroot:source:check-memoryoom:<hash>`. Each such row records
`id_origin: derived`, its native granularity, a pinned source path, and a direct
source link. A derived ID is an inventory handle; it does not claim that the
upstream project considers the referenced adapter, symbol, module, or runbook an
independent diagnosis rule. The extraction method and caveat are recorded per
tool. The snapshot remains `provisional` because the cross-repository extractor
is not yet repository-owned or independently reproduced.

## Could rules pass the current 275 scenarios?

Yes, a closed-world deterministic product could probably pass all 275 current
public scenarios. That would not mean a diagnosis rules engine covers 275
independent Kubernetes problems.

A mechanical audit of the active qualified portfolio on 2026-09-20 found:

| Property                           | Measured result |
| ---------------------------------- | --------------: |
| Public scenario rows               |             275 |
| Diagnose-only rows                 |             235 |
| Approved-repair rows               |              40 |
| Hand-authored anchors              |              12 |
| Generated descendants              |             263 |
| Inherited lineages                 |               7 |
| Normalized evaluator contracts     |              12 |
| Rows expecting bounded uncertainty |              55 |
| Rows allowing additional retrieval |             220 |

The twelve normalized contracts cover one underdetermined Pending Pod, Service
selector fault and healthy states, unschedulable CPU capacity, missing and
healthy StorageClass/PVC states, denied workload RBAC, a current healthy rollout
with a stale failure Event, malicious and benign annotations, and two exact
repair contracts. The 263 generated descendants copy one of those anchors,
change identity and portfolio metadata, and add zero to two benign ConfigMaps.
Several distinct family names therefore share identical setup semantics,
observation logic, and evaluator truth.

The controlling sources are the
[portfolio generator](../evals/src/scenarios/generatePhase2Portfolio.ts), which
declares the 25 labels and copies parent fixtures, and the
[case-logic registry](../evals/src/scenarios/caseLogic.ts), which resolves every
generated row through its parent. The
[diagnosis grader](../evals/src/grading/diagnosisGrader.ts) implements exact
grounding, accepted-fact, contradiction, and uncertainty checks; the
[repair grader](../evals/src/grading/repairGrader.ts) validates the authorized
action lifecycle.

The current 20 `multi_turn_tool_failure` rows do not inject distinct malformed
or transient tool behavior. They inherit the same candidate packet, observation
logic, and uncertainty contract as the underdetermined Pending-Pod anchor. A
system can pass them by correctly abstaining from the supplied Pod phase; it is
not required to recover from an actual malformed tool result in these rows.

A compact closed-world implementation would need approximately ten state and
safety classification paths plus two canonical repair plans, together with a
generic evidence-to-submission serializer. It could satisfy the diagnosis grader
because free-form prose is not scored: accepted resource, field, and value facts
must be cited from retrieved evidence; uncertainty rows require explicit
uncertainty and at least two accepted alternatives. The two repairs reuse the
Service-selector and capacity diagnoses but add exact JSON Patch, approval,
freshness, execution, postcondition, collateral, and rollback contracts.

This yields two different answers:

- A **pure diagnosis rules engine** can target the 235 read-only rows. It cannot
  by itself pass the 40 action-lifecycle rows.
- An **integrated deterministic system** containing collectors, rules, output
  construction, action policy, approval-bound execution, and verification could
  plausibly reach 275/275 on this frozen portfolio.

The implementation must not dispatch on scenario ID, family label, prompt
wording, fixed fixture names, evaluator aliases, or copied protected packets.
Rules should operate on typed Kubernetes observations and relationships. Even
then, 275/275 would establish complete behavior on seven public lineages, not
general Kubernetes diagnosis quality. The portfolio is public and development-
visible, and its generated rows do not create independent causal diversity.

Use the current roster as a regression target, then require fresh, independently
authored lineage holdouts with renamed resources, changed values, equivalent
API representations, healthy twins, confounders, stale and missing evidence,
actual tool failures, and composed faults. Report the following separately:

1. rules-only diagnosis on all 235 read-only rows;
2. deterministic repair orchestration on the 40 repair rows;
3. integrated closed-roster 275/275 coverage;
4. performance on unseen lineage holdouts after the implementation is frozen.

Do not use a closed-roster 275/275 result as evidence that a broad 75-120-family
production engine is unnecessary. It would instead show that the current public
portfolio is much smaller semantically than its row count.

### Reuse available for the twelve contracts

The closed-roster implementation need not start from nothing, but no inspected
project covers every contract end to end:

| Current contract                           | Strong reusable precedent                                              | Headlamp-specific work still required                                                                                                |
| ------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Underdetermined Pending Pod                | kstatus `Unknown`; bounded evidence contracts in the current grader    | Decide evidence sufficiency and produce alternatives without copying evaluator aliases                                               |
| Service selector fault and healthy twin    | Kubevious selector graph; K8sGPT Service analyzer                      | Use live EndpointSlices, ready backends, selector/label evidence, and transient-state suppression                                    |
| CPU request exceeds every node             | Kubernetes scheduler condition/Event; Kubernetes quantity parsing      | Compare each eligible node after filters, account for overhead/extended resources, and preserve uncertainty when evidence is partial |
| Missing StorageClass and healthy Bound PVC | Kubernetes PVC phase; kstatus Bound handling; K8sGPT storage analyzers | Distinguish absent class, provisioner failure, binding mode, topology, quota, and delayed provisioning                               |
| Workload authorization denied              | SubjectAccessReview and explicit Role/Binding relationships            | Separate the workload identity's denial from the investigating user's own RBAC denial                                                |
| Healthy current rollout plus stale warning | kstatus and Argo CD generation-aware health                            | Establish event age/producer identity and let current reconciled state contradict stale evidence                                     |
| Malicious and benign annotations           | Candidate-data trust boundary and secret/mutation safety graders       | Classify content as untrusted without treating every instruction-like annotation as malicious                                        |
| Selector and capacity repairs              | Current exact action contracts; remediation-controller separation      | Generalize target discovery, policy, approval, freshness, collateral checks, postconditions, and rollback                            |

This mapping supports a small implementation for the public roster, not a claim
that the reused projects have already passed it. A fair prototype should encode
the generic observation and relationship semantics above, then run unchanged on
renamed and value-varied copies before it sees any new causal lineage.

## Scope and terms

Keep five layers distinct:

1. **Observation extraction** converts Kubernetes objects, Events, logs,
   metrics, and relationships into typed facts.
2. **Deterministic findings** assert a condition that follows from available
   evidence, with a stable rule ID and provenance.
3. **Diagnostic hypotheses** rank possible causes when evidence is incomplete.
   They must remain labeled hypotheses rather than deterministic findings.
4. **Explanation and investigation** use rules or an LLM to connect findings,
   request missing evidence, and explain remediation.
5. **Verification and safety** confirm freshness, permissions, repair scope,
   rollout, recovery, collateral state, and rollback.

Runtime diagnosis answers why an observed resource or service is unhealthy.
Preventive analysis identifies risk or policy violations that may not explain a
current incident. Schema validation, security scanning, admission policy, and
upgrade analysis are useful inputs, but their findings must not silently become
root causes.

## Current Headlamp baseline

The inspected implementation is
[`frontend/src/components/diagnostics/Diagnostics.tsx`](https://github.com/illume/headlamp/blob/10bfb15261a7/frontend/src/components/diagnostics/Diagnostics.tsx)
at local Headlamp revision `10bfb15261a7`; the file's latest local history entry
is `a9d32f3724bac7811e80cb3dd70c7dcface70f87`. The implementation has 928
physical lines and its focused test has 208 physical lines. Record an upstream
Kubernetes SIGs revision before treating this fork snapshot as the release
baseline.

Current deterministic behavior:

- classifies a Pod as healthy only when it is Succeeded, or Running with a True
  Ready condition and a detailed `Running` reason;
- emits a Pod status summary and non-redundant False or Unknown conditions;
- maps eight reason families to actionable text: crash loop, image pull,
  OOM kill, invalid referenced configuration, container start, eviction,
  unschedulable, and containers not ready;
- surfaces restart history, Pending node-selector/affinity/PVC constraints, and
  the five newest warning or failure-like Events;
- emits workload replica availability and failed-condition findings;
- groups unhealthy owned Pods by a dominant scheduling, waiting, termination,
  restart, readiness, or fallback status reason;
- deduplicates findings and links grouped Pods to details or likely logs;
- intentionally leaves per-container state to the existing Containers UI.

This is already a legitimate small rules layer. It is not yet a reusable rules
engine because it has no public rule registry, rule/version provenance,
evidence IDs, confidence or certainty type, negative evidence, version bounds,
cross-resource causal graph, policy applicability, or engine-level execution
contract. Its direct resource scope is Pods plus workload status and owned Pods;
it does not diagnose Nodes, Services, EndpointSlices, storage provisioning,
RBAC, admission, control-plane health, or operator resources.

### Headlamp research tasks

- [x] Trace current Pod and workload diagnostic inputs, outputs, hint families,
      UI placement, deduplication, and focused tests.
- [ ] Pin the exact released upstream Headlamp revision containing diagnostics
      and record browser-visible behavior for healthy, faulty, loading, forbidden,
      and partial-data states.
- [ ] Convert the existing behavior into a provisional rule inventory. Separate
      generic presentation aggregation from causal trigger families.
- [ ] Measure false positives for transient rollouts, stale Events, deleted
      owners, Jobs that completed successfully, and temporarily unready Pods.
- [ ] Decide which existing helpers become engine observations or rules and
      which remain view-specific presentation behavior.

## Measured implementation precedents

The following source snapshots were shallow-cloned and counted mechanically on
2026-09-20. Production and test sizes are physical lines, including comments and
blanks, and are useful only as implementation-scale anchors.

| Project                                                                                                  | Pinned revision                            |                                        Measured inventory |                              Production footprint |                   Test footprint | Interpretation                                                                                 |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------: | ------------------------------------------------: | -------------------------------: | ---------------------------------------------------------------------------------------------- |
| [K8sGPT](https://github.com/k8sgpt-ai/k8sgpt/tree/8cb270e0800e9195d0ba4540fab1f458cac15117/pkg/analyzer) | `8cb270e0800e9195d0ba4540fab1f458cac15117` | 14 default + 17 optional analyzers; 87 failure-text sites |                  4,454 lines in 33 analyzer files | 10,019 lines; 125 test functions | Closest direct deterministic runtime precedent; optional AI explains findings after detection. |
| [kube-linter](https://github.com/stackrox/kube-linter/tree/3b485c42f4b3445634bd8fe5f76f4aace15d42b5)     | `3b485c42f4b3445634bd8fe5f76f4aace15d42b5` |       63 built-in checks, 31 default checks, 65 templates |                 5,040 hand-written template lines |        7,329 template test lines | Static policy and manifest correctness ceiling, not incident RCA.                              |
| [kube-score](https://github.com/zegl/kube-score/tree/06dedc9ccce58bff50a4f42a3ce0633dc72b0dfa)           | `06dedc9ccce58bff50a4f42a3ce0633dc72b0dfa` |                                      39 documented checks |                         2,095 lines under `score` |                      3,944 lines | Compact static reliability/security reference with cross-object checks.                        |
| [Polaris](https://github.com/FairwindsOps/polaris/tree/1038b3c1e51fd92a8b12f25d193e842a92dc3d25)         | `1038b3c1e51fd92a8b12f25d193e842a92dc3d25` |                                   44 registered built-ins | 1,752 check-YAML lines plus 1,303 validator lines |       2,183 validator test lines | Data-driven policy, severity, exemptions, audit, and admission patterns.                       |

K8sGPT demonstrates that analyzer count understates diagnosis surface. Its Pod
analyzer has a small number of emission sites but recognizes scheduling gated,
unschedulable, eviction, abnormal exit, failed readiness, two event reasons, and
11 named waiting reasons. Conversely, a Node condition helper emits one shape
for several related condition types. A useful inventory therefore counts
reviewed trigger families and evidence contracts, not files, branches, messages,
or every reason string as independent rules.

The K8sGPT analyzer package also has more than twice as many test lines as
production lines. That is a warning against estimating this as a list of `if`
statements. Fixtures, fake clients, relationship cases, transient states,
version handling, permissions, and negative controls dominate the trustworthy
implementation cost.

### Expanded measured ecosystem baselines

The first measurement covered analyzers and static policy. A second pinned
source pass on 2026-09-20 measured problem detectors, health classifiers,
temporal alerts, condition aggregation, relationship rules, and runbooks. These
inventories are deliberately not summed: they represent different artifacts and
different truth claims.

| Project                                                                                                                                         | Pinned revision                            |                                                                                      Measured inventory |                                                            Test or support evidence | What the inventory means                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------: | ----------------------------------------------------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------- |
| [Node Problem Detector](https://github.com/kubernetes/node-problem-detector/tree/5f40c13970d90844b439b1532b3f97fd69fee58a)                      | `5f40c13970d90844b439b1532b3f97fd69fee58a` |              55 shipped rule entries; 49 unique full definitions; 40 unique reasons; 14 condition types |               8 explicit kernel problem-injection files; 128 package test functions | Node-local log/plugin detectors that emit Kubernetes Events or NodeConditions, not general RCA.                              |
| [Argo CD resource health](https://github.com/argoproj/argo-cd/tree/7fe2ec7cf937dd839fb9ec8618dcc4642f90c2da/resource_customizations)            | `7fe2ec7cf937dd839fb9ec8618dcc4642f90c2da` |                         293 `health.lua` scripts; 267 exact-distinct script bodies; 11,911 script lines |                 293 paired test manifests containing 1,382 expected-health fixtures | Broad GVK-specific health normalization. Scripts consume one resource object and normally classify health, not cause.        |
| [Kubernetes mixin](https://github.com/kubernetes-sigs/kubernetes-mixin/tree/7f47ec17cfb9be7ff4bd4e830648f50124459ebb)                           | `7f47ec17cfb9be7ff4bd4e830648f50124459ebb` |                                  53 alert definitions; 48 unique alert names; 1,572 alert Jsonnet lines |  216 timed alert-test evaluations over 43 unique alert names; 3,090 test-YAML lines | Time-windowed symptom and risk detection over metrics. Repeated names encode severity/window variants.                       |
| [cli-utils kstatus](https://github.com/kubernetes-sigs/cli-utils/tree/5895ad6c17dd06b99c1e5c8af17e2b12a3504fad/pkg/kstatus/status)              | `5895ad6c17dd06b99c1e5c8af17e2b12a3504fad` |                             16 registered GVK keys backed by 11 unique handlers; 1,185 production lines |                                                 1,935 test lines; 20 test functions | Reconciliation-state normalization to Current, InProgress, Failed, Terminating, NotFound, or Unknown.                        |
| [Cluster API condition utilities](https://github.com/kubernetes-sigs/cluster-api/tree/3d12cb64549b869e753f6f9abf7e683e404733cb/util/conditions) | `3d12cb64549b869e753f6f9abf7e683e404733cb` | 2,235 non-deprecated production lines for get/set, mirror, aggregate, summarize, merge, patch, and sort |                                                 3,008 test lines; 47 test functions | A mature condition-composition library, not a catalog of incident causes.                                                    |
| [Prometheus Operator runbooks](https://github.com/prometheus-operator/runbooks/tree/a685d14cf5128bb30e2bf935c3983decd772d885)                   | `a685d14cf5128bb30e2bf935c3983decd772d885` |                                108 runbook pages across eight component categories; 3,949 content lines |                  105 pages each contain Meaning, Diagnosis, and Mitigation sections | Human operational knowledge. Detection predicates live elsewhere and prose is not executable truth.                          |
| [Kubevious rules library](https://github.com/kubevious/rules-library/tree/b572cbf8ddc0903cb06cee430fa9a38c9b40d8b9)                             | `b572cbf8ddc0903cb06cee430fa9a38c9b40d8b9` |                                           36 indexed cross-manifest/policy rules; 1,942 rule-YAML lines | Repository validation scripts; no comparable per-rule live RCA fixture corpus found | A historical graph-query and relationship-validation precedent. Most rules are preventive rather than runtime diagnosis.     |
| [Popeye](https://github.com/derailed/popeye/tree/5d07838165bb64fa70c594f2b46ef14a9080782f)                                                      | `5d07838165bb64fa70c594f2b46ef14a9080782f` |                            117 executable issue codes across 33 linter source files; 3,970 linter lines |                                          2,825 linter test lines; 50 test functions | Broad read-only live-cluster hygiene, relationship, status, and metrics checks; many findings are preventive or symptomatic. |
| [Robusta](https://github.com/robusta-dev/robusta/tree/96c8a3fcaf2e82e367445ce3d8dc6e242b0c45de)                                                 | `96c8a3fcaf2e82e367445ce3d8dc6e242b0c45de` |                       55 built-in playbook modules; 142 `@action` decorator sites; 8,873 playbook lines |          Heterogeneous enrichment, reporting, investigation, and mutation functions | Strong trigger/action and alert-enrichment architecture; action sites are not equivalent to diagnosis rules.                 |
| [Coroot auditor](https://github.com/coroot/coroot/tree/ce49b11fa079683eddfba318c71089c3449bc93b/auditor)                                        | `ce49b11fa079683eddfba318c71089c3449bc93b` |                                  19 audit stages; 57 distinct referenced check IDs; 5,795 auditor lines |               No `_test.go` files found inside the auditor package at this snapshot | Rich application/telemetry inspection and health aggregation; checks are embedded in domain-specific audit code.             |
| [Kuberhealthy](https://github.com/kuberhealthy/kuberhealthy/tree/243a71b7d9ab7b2079535f810d3af1d8272a0bc0)                                      | `243a71b7d9ab7b2079535f810d3af1d8272a0bc0` |                                                                    13 checks in the maintained registry |          Checks live in independent repositories; two example manifests are bundled | Extensible scheduled synthetic verification, not a centrally implemented passive-diagnosis catalog.                          |

The measurements change the sizing model. A broad product may need **hundreds of
health adapters** without needing hundreds of independent causal rules. Argo
CD's 293 scripts mostly translate heterogeneous CRD status into a small health
vocabulary. Conversely, one causal rule such as “selected backends are absent”
can operate over many resource adapters if relationships and observations are
normalized. Track at least four separate inventory counts:

1. evidence producers and collectors;
2. GVK health adapters;
3. temporal symptom detectors;
4. causal or contradiction-aware diagnosis rules.

### What each artifact can prove

| Artifact                                       | Strongest justified output                                                                                                 | It does not establish                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Node Problem Detector pattern or plugin result | A named producer observed a matching node problem and emitted an Event or condition                                        | The complete incident root cause, affected service impact, or safe remediation                    |
| kstatus or Argo health result                  | A resource is Current/Healthy, progressing, failed/degraded, suspended, terminating, missing, or unknown under one adapter | Why it reached that state, whether descendants matter, or whether users are affected              |
| Prometheus alert                               | A metric predicate remained true for its configured windows and labels                                                     | A unique cause; alert names and annotations can be more specific than the evidence                |
| Cross-manifest graph rule                      | A required reference, selector, port, or other structural relationship is absent or inconsistent                           | That the live incident is caused by the inconsistency rather than merely exposing a latent defect |
| Controller condition/reason                    | The controller reported a typed state at an observed generation                                                            | That the message is current, complete, causal, or portable across controller versions             |
| Runbook                                        | Reviewed hypotheses, investigation order, impact, and possible mitigations                                                 | An executable predicate, a safe universal command, or an independently verified answer            |
| Repair controller outcome                      | A separately gated action progressed through its controller-specific state machine                                         | That detection was correct or that the action is safe outside its declared prerequisites          |

Two mature projects state the limits directly. kstatus notes that single-object
status cannot assess Services through Endpoint objects or workloads through
their descendants, and that an absent condition can look healthy when a
controller is not running. Argo CD deliberately does not inherit child health
into a resource and asks contributors to consult controller code or maintainers
when status is complex. A Headlamp engine therefore needs an explicit
relationship graph and open-world `unknown` behavior rather than assuming a
generic `Ready` check solves diagnosis.

The counts also reveal ordinary catalog drift. Popeye's executable
`internal/issues/assets/codes.yaml` contains 117 codes while `docs/codes.md`
lists 119; documented codes 502 and 601 are absent from the executable glossary
at the pinned revision. A source-import pipeline must compare implementation,
documentation, tests, and generated indexes instead of trusting any single
inventory.

### Measured adjacent policy and security catalogs

A third pinned source pass measured the large adjacent catalogs that are often
described loosely as Kubernetes “rules.” Their native units are useful product
inputs but are not interchangeable with runtime causal diagnoses.
All YAML inputs selected by the counting scripts parsed successfully; no file
was silently excluded because of a parser error.

| Project                                                                                                                     | Pinned revision                            |                                                                                                           Native inventory | Diagnosis boundary                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Kyverno policies](https://github.com/kyverno/policies/tree/2716f4a26a3c27590a1d6d960dee4ce043e4fa4a)                       | `2716f4a26a3c27590a1d6d960dee4ce043e4fa4a` |                           646 canonical policy documents; 513 unique API-version/kind/name identities; 337 semantic groups | Excludes hidden Chainsaw/Kyverno test fixtures. Includes legacy, CEL, validation, mutation, generation, cleanup, image-policy, and repeated engine forms.                                    |
| [Gatekeeper library](https://github.com/open-policy-agent/gatekeeper-library/tree/22a40962f83268769bcec5dfe55e44b5a85c392a) | `22a40962f83268769bcec5dfe55e44b5a85c392a` |                                                                49 unique `ConstraintTemplate` objects and 49 suite objects | Parameterized admission/audit policy. A violation can explain rejection or non-compliance, not arbitrary runtime failure.                                                                    |
| [Kubescape Regolibrary](https://github.com/kubescape/regolibrary/tree/28642707ea4eeea42cf031f0933d0d9fd451d610)             | `28642707ea4eeea42cf031f0933d0d9fd451d610` |                                                                    289 control records referencing 303 distinct rule names | Controls group rules into security/compliance findings; many require host, cloud, vulnerability, or policy evidence outside ordinary Headlamp API access.                                    |
| [Trivy Operator](https://github.com/aquasecurity/trivy-operator/tree/7107830178ae50e96e9f09d98976e51e6152759f)              | `7107830178ae50e96e9f09d98976e51e6152759f` |                                                                                                        12 report CRD kinds | The operator federates vulnerability, configuration, secret, RBAC, infrastructure, compliance, and SBOM results. Rule/database counts belong to upstream scanners and change independently.  |
| [kube-bench](https://github.com/aquasecurity/kube-bench/tree/9f133cb7509ce1dbedfc860e94474588000e25ac)                      | `9f133cb7509ce1dbedfc860e94474588000e25ac` | 5,236 check definitions in 244 benchmark files across 49 profiles; 429 distinct check IDs and 1,007 normalized check texts | Profiles repeat and adapt CIS/vendor checks; IDs are not globally semantic. Many checks require host process/filesystem access unavailable to a dashboard.                                   |
| [Pluto](https://github.com/FairwindsOps/pluto/tree/9495152d614581a988e31414fa64e8b82474d956)                                | `9495152d614581a988e31414fa64e8b82474d956` |                                                  112 deprecation entries; 111 unique component/version/kind/removal tuples | Preventive upgrade evidence: 86 Kubernetes, 24 cert-manager, and 2 Istio entries. One Kubernetes audit-policy tuple is duplicated. Live API conversion means submission provenance matters.  |
| [Falco rules](https://github.com/falcosecurity/rules/tree/e822409d8a2a28c9719f56ace66e8cadebfd2bc3)                         | `e822409d8a2a28c9719f56ace66e8cadebfd2bc3` |                                                              95 unique runtime rules: 25 stable, 31 incubating, 39 sandbox | Runtime threat detections over system/plugin events. Maturity, exceptions, engine/plugin versions, and deployment context are part of applicability; an alert is not an incident root cause. |

The Kyverno counts exclude hidden test resources but retain canonical alternate
engines or generations of related policy intent. The kube-bench count
demonstrates the opposite ambiguity: 429 IDs expand into 1,007 normalized texts
because vendors and benchmark versions reuse or modify identifiers. Neither
total should be compared directly with 75-120 causal trigger families.

The practical integration opportunity is typed federation. Headlamp can consume
Gatekeeper/Kyverno policy reports, Trivy CRDs, Kubescape controls, Falco Events,
and Pluto findings as attributed observations with source version, severity,
scope, and exception state. A causal rule may then use one when it actually
distinguishes an incident, such as an admission denial or a deprecated API that
blocks an upgrade. Importing every adjacent finding into the diagnosis stream
would create alert volume and false causal attribution rather than broader RCA.

## Evidence-backed size estimates

| Tier                 | Runtime trigger families | Resource/relationship types | Estimated production code | Estimated focused tests/fixtures |       Planning effort | Intended value                                                                                                             |
| -------------------- | -----------------------: | --------------------------: | ------------------------: | -------------------------------: | --------------------: | -------------------------------------------------------------------------------------------------------------------------- |
| Focused useful slice |                    25-40 |                        7-10 |         1,500-3,000 lines |                2,500-6,000 lines |   2-4 engineer-months | Common Pod, workload, scheduling, Service, storage, Node, and Event diagnosis in Headlamp views.                           |
| Production core      |                   75-120 |                       15-20 |         4,000-8,000 lines |               8,000-16,000 lines |  6-12 engineer-months | K8sGPT-class core breadth with stronger evidence, versioning, graph correlation, RBAC degradation, and UI/API integration. |
| Broad ecosystem      |                  150-250 |    25-40 plus selected CRDs |       10,000-20,000 lines |              20,000-40,000 lines | 15-30 engineer-months | Metrics/logs, control plane, upgrades, security inputs, Gateway API, autoscaling, and maintained operator packs.           |

The rule, resource, and line ranges are anchored by the measured projects above.
The schedule ranges are engineering planning estimates, not repository-derived
facts. They assume an experienced Kubernetes engineer, an existing Headlamp API
client and UI, code review, live fixture automation, documentation, and no new
telemetry backend. A declarative rule format may reduce per-rule code but does
not remove fixture, semantic review, or compatibility work.

Maintenance planning:

- Kubernetes currently releases about three minors per year and maintains a
  release branch for about one year. Budget a compatibility review and live
  qualification for every supported minor.
- A core-only catalog likely needs 0.25-0.5 ongoing engineer-equivalent after
  stabilization. A broad catalog with several operators and telemetry adapters
  is more plausibly 0.5-1.5 engineer-equivalents.
- These maintenance values are capacity placeholders to validate over the first
  four release/operator update cycles. Track rule churn, changed evidence,
  false-positive incidents, qualification time, and retired rules.
- Kubernetes Events default to one-hour retention in kube-apiserver. Event-only
  rules must disclose evidence age and abstain when the event window is absent.
- Kubernetes system log text and formatting do not carry API stability
  guarantees. Prefer structured API state, conditions, Events, and stable
  metrics; version and quarantine log parsers.

### Observed one-year artifact churn

The planning placeholders above now have a source-history check. For each pinned
repository, the measured rule, health, alert, runbook, playbook, or registry path
was compared over `2025-09-20T00:00:00Z` through its pinned head. Commit authors
are unique commit email identities, not guaranteed people. Additions and
deletions are Git `numstat` physical lines; they include generated files,
fixtures, moves, and refactors and therefore are not engineering hours.

| Artifact path                       | Commits | Authors | Files touched |  Added | Deleted |                                  Inventory change |
| ----------------------------------- | ------: | ------: | ------------: | -----: | ------: | ------------------------------------------------: |
| K8sGPT analyzers                    |      30 |      12 |            51 |  3,726 |     185 |                                 29 → 31 analyzers |
| kube-linter templates and built-ins |      12 |       9 |            50 | 14,063 |      51 |                           60 → 63 built-in checks |
| kube-score checks                   |       2 |       1 |             6 |     95 |       0 |                         39 → 39 documented checks |
| Polaris checks and validator        |       4 |       2 |             8 |     71 |      53 |                                 44 → 44 built-ins |
| Node Problem Detector config        |       5 |       5 |            34 |  2,027 |     568 |                              53 → 55 rule entries |
| Argo CD resource health             |      83 |      49 |           856 | 21,280 |   1,923 |                          233 → 293 health scripts |
| Cluster API condition utilities     |       7 |       4 |            14 |    136 |      67 |             Library, not a countable rule catalog |
| Kubernetes mixin alerts/rules/tests |      25 |      15 |            32 |  1,978 |     232 | Alert inventory not reconstructed at the boundary |
| Robusta built-in playbooks          |      15 |       6 |            18 |    407 |      45 |                                   54 → 55 modules |
| Coroot auditor                      |      22 |       2 |            21 |  3,612 |     477 |          Embedded checks; no stable catalog count |
| Kuberhealthy registry               |       9 |       3 |             1 |     39 |      47 |                             15 → 13 linked checks |

No commits touched the measured kstatus path in this window; its latest path
commit at the pinned revision was 2025-09-08. The pinned Popeye, Prometheus
Operator runbook, and Kubevious rule paths likewise had no commits in the
window; their latest measured-path commits were 2025-04-14, 2024-10-03, and
2024-06-12 respectively. Zero churn is ambiguous: it can mean stability,
maintenance dormancy, or a moved artifact. It is not evidence of low future
cost.

The inventory comparisons use the last reachable commit before the window and
the pinned head, not current mutable branches. The pre-window commits were:
K8sGPT `83c5d670842f`, kube-linter `efe5ae547ea1`, kube-score
`81371e9f53b6`, Polaris `ec1ba2f2db4d`, Node Problem Detector
`0f8e0ea1262a`, Argo CD `f960274139a6`, Robusta `5bf9189124fc`, and
Kuberhealthy `22b75ae01c63`. This makes the deltas reproducible while keeping
the already recorded head revisions fixed.

The result does not support a universal per-rule maintenance coefficient.
Kube-linter's large line addition includes template/generated support work;
Argo health additions include scripts, tests, and fixtures across many GVKs;
Coroot embeds multiple checks in application-specific audit code. It does show
that adapter breadth can dominate churn: Argo added 60 health scripts while the
countable causal, policy, and problem-detector catalogs changed by zero to three
entries. Size and maintenance estimates should therefore budget causal rules,
health adapters, collectors, and fixtures separately.

Official references: [Kubernetes release cycle](https://kubernetes.io/releases/release/),
[kube-apiserver `--event-ttl`](https://kubernetes.io/docs/reference/command-line-tools-reference/kube-apiserver/),
[API deprecation policy](https://kubernetes.io/docs/reference/using-api/deprecation-policy/),
and [system log stability warnings](https://kubernetes.io/docs/concepts/cluster-administration/system-logs/).

## Empirical evidence and evidence gaps

No primary study found in this pass establishes that a particular number of
deterministic rules covers a known percentage of Kubernetes production
incidents. No credible public source was found for Kubernetes-specific
rule-level precision, recall, false-positive rates, or annual maintenance cost.
Claims such as “50 rules cover 80% of failures” must therefore be measured in
Headlamp's target population, not imported as facts.

The strongest relevant operational evidence is broader SRE guidance:

- Google's SRE book reports that a 10-12-person service team historically
  assigned one or sometimes two members primarily to monitoring, while noting
  that shared infrastructure reduced this burden. This is practitioner evidence
  for monitoring as a substantial engineering system, not a staffing formula
  for Headlamp.
- The same source reports limited success with complex dependency hierarchies
  under continuous refactoring and recommends simple, comprehensible paging
  rules focused mainly on symptoms, reserving cause heuristics for definite and
  imminent causes.
- Its Bigtable example describes voluminous low-value alerts consuming
  unacceptable engineering time and masking user-impacting problems; the Gmail
  example describes per-task alerts as unmaintainable. Neither case publishes a
  reusable false-positive percentage.
- The SRE workbook defines alert quality through precision, recall, detection
  time, and reset time and shows that changing time windows and duration trades
  these properties against one another. Diagnosis rules need the analogous
  measures plus evidence grounding and abstention; raw match rate is
  insufficient.

Primary sources:
[Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/)
and [Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/).

The research program must create the missing evidence. For every rule, retain
eligible executions, true and false matches, abstentions, time-to-finding,
evidence age, permissions, Kubernetes/controller version, suppressions,
operator disposition, and subsequent incident outcome. Review quarterly which
rules have never helped, which are routinely ignored, and which require human
correction. Do not optimize a single aggregate accuracy score; report precision,
recall, abstention, detection delay, and maintenance separately by family.

## Kubernetes-source-derived construction

Kubernetes source can supply a versioned vocabulary and executable semantics for
candidate rules. It cannot automatically establish operator intent, production
frequency, remediation safety, or a complete causal explanation.

| Upstream surface                                                   | Candidate artifact                                                                            | Value                                                                          | Main limitation                                                                                   |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| API types, constants, generated OpenAPI, and condition definitions | Typed observations, enum values, field paths, GVK and version bounds                          | Prevents ad hoc string schemas and identifies stable object state              | A field or enum usually says what exists, not why it is unhealthy.                                |
| Controller condition/status transitions                            | Trigger predicates, causal edges, freshness/observed-generation gates                         | Captures the code that decides status instead of merely documenting it         | Conditions can summarize downstream failures and vary by controller/version.                      |
| Event recorder reason constants and call sites                     | Producer identity, reason vocabulary, involved object, likely evidence query                  | Connects a visible Event to the component and branch that emitted it           | Event reason/message stability is weaker than API types; absence after TTL is not negative proof. |
| Scheduler framework statuses and plugin failures                   | Scheduling trigger families, resolvable/unresolvable distinction, node evidence requests      | Can distinguish capacity, affinity, taints, topology, volume, and policy paths | User-visible aggregation and plugin messages change; multiple failures can coexist.               |
| Kubelet/container status generation                                | Waiting/termination/restart observations and container-runtime evidence                       | Grounds image, mount, sandbox, lifecycle, probe, and resource symptoms         | Runtime implementations and Events differ; status can expose only the final symptom.              |
| Admission/defaulting/validation errors                             | Deterministic invalid-object findings and dry-run verification                                | High-confidence configuration feedback before mutation                         | Admission policy is cluster-specific and does not explain later runtime failures.                 |
| `kubectl describe`, status, debug, and printer logic               | Investigation ordering, relationship queries, concise summaries                               | Encodes mature operator-facing evidence selection                              | Presentation logic is not automatically causal or a stable library API.                           |
| Unit, integration, E2E, and regression tests                       | Positive/negative fixtures, temporal gates, expected transitions, version/feature constraints | Best executable source for proving candidate rule semantics                    | Tests are narrow, can encode historical bugs, and often expose internals unavailable to users.    |
| Documentation and issue-linked fixes                               | Human remediation, alternatives, caveats, owning SIG                                          | Completes actionable output and review context                                 | Prose can lag implementation and must be pinned separately.                                       |

Concrete upstream starting points include
[`staging/src/k8s.io/api/core/v1/types.go`](https://github.com/kubernetes/kubernetes/blob/master/staging/src/k8s.io/api/core/v1/types.go),
[`pkg/kubelet/status/generate.go`](https://github.com/kubernetes/kubernetes/blob/master/pkg/kubelet/status/generate.go),
[`pkg/kubelet/events/event.go`](https://github.com/kubernetes/kubernetes/blob/master/pkg/kubelet/events/event.go),
[`staging/src/k8s.io/kube-scheduler/framework/interface.go`](https://github.com/kubernetes/kubernetes/blob/master/staging/src/k8s.io/kube-scheduler/framework/interface.go),
and
[`staging/src/k8s.io/kubectl/pkg/describe/describe.go`](https://github.com/kubernetes/kubernetes/blob/master/staging/src/k8s.io/kubectl/pkg/describe/describe.go).
Pin exact release commits and owning tests before extracting facts; `master`
links are discovery pointers only.

### Proposed extraction pipeline

1. Pin one supported Kubernetes release and retain repository, path, symbol,
   commit, license, owning SIG, and source digest.
2. Use Go AST and type information to inventory condition/reason constants,
   `Eventf` call sites, status assignments, scheduler statuses, and validation
   errors. Do not regex-mine prose into executable rules.
3. Normalize candidates into typed observations, trigger predicates, evidence
   queries, causal edges, contradictions, and version/feature bounds.
4. Join each candidate to the smallest owning tests and operator-facing docs.
   Reject candidates without a negative control or observable user evidence.
5. Require human Kubernetes review to classify deterministic finding,
   hypothesis, policy, or presentation-only behavior.
6. Generate declarative rule data or typed code plus provenance. Generated files
   must never contain unreviewed remediation or confidence claims.
7. Qualify healthy, broken, stale, permission-denied, partial-data, and
   confounded variants on declared cluster versions.
8. Diff every supported Kubernetes release. Changed producer code, fields,
   reasons, tests, or docs trigger review rather than automatic production
   updates.

### Evidence ladder and intermediate representation

Source extraction should produce candidates in an evidence ladder, not
immediately executable diagnoses:

1. **Vocabulary:** field, condition, reason, metric, Event, or error constant.
2. **Producer semantics:** the branch and component that assigns or emits it.
3. **Executable behavior:** a unit, integration, E2E, Lua fixture, promtool test,
   or injected problem that demonstrates positive and negative behavior.
4. **Operator interpretation:** pinned documentation or runbook explaining
   impact, alternatives, and investigation.
5. **Independent qualification:** a Headlamp-authored healthy/fault/confounded
   live scenario reviewed independently of the source artifact.

Only level 5 can promote a candidate to a product diagnosis rule. Earlier
levels can define observations, health adapters, alert inputs, hypotheses, or
test seeds.

The rule intermediate representation should add these fields to the proposed
finding contract:

```yaml
artifact_role: causal_rule # detector | health_adapter | temporal_alert | policy | causal_rule
certainty: deterministic # observed | deterministic | hypothesis
inputs:
  - { observation_type: pod.condition, freshness: 5m, required: true }
relationships:
  - { type: selects, from: service, to: pod, cardinality: at-least-one }
temporal:
  for: 15m
  reset_after: 5m
preconditions: [controller-observed-current-generation]
suppressions: [intentional-suspension, maintenance-window]
unknown_when: [permission-denied, required-observation-missing, producer-stale]
positive_fixtures: [<fixture-id>]
negative_fixtures: [<fixture-id>]
source_evidence:
  - { level: producer-semantics, repository: <repo>, revision: <commit>, symbol: <symbol> }
```

This prevents a health script, alert, or runbook paragraph from being promoted
under the same label as a causal rule. It also makes time windows, suppression,
missing evidence, and source strength reviewable.

### Source-construction research backlog

- [ ] Build a Go-aware inventory prototype for Pod, scheduler, kubelet, Service,
      EndpointSlice, Deployment, and PVC/PV sources at one pinned Kubernetes minor.
- [ ] Define deduplication rules for constants, aliases, shared helpers, repeated
      recorder calls, and message variants so source volume is not reported as rule
      coverage.
- [ ] Record what each source family can and cannot prove. In particular, never
      translate an Event reason directly into a root cause without the required
      object, producer, freshness, and contradictory evidence.
- [ ] Run the five-family falsification pilot against hand-authored rules.
      Measure accepted candidates, author/reviewer time, precision, recall,
      abstention, source drift, and lines/tests per qualified family.
- [ ] Test version-diff generation across three supported Kubernetes minors and
      determine which changes can be mechanically accepted versus reviewed.
- [ ] Extend the method to one operator with high-quality condition constants and
      E2E tests, then compare maintenance cost with core Kubernetes extraction.

## Wider Kubernetes analysis and diagnosis landscape

The survey must record a pinned revision, release date, maintenance state,
license, inputs, permissions, output schema, rule inventory, extensibility,
version support, and deterministic/LLM boundary. Popularity and README claims do
not establish diagnosis quality.

### Direct runtime and hybrid precedents

| Tool                                                                                                                                                                          | What to study                                                                                                                       | Relevance and boundary                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [K8sGPT](https://github.com/k8sgpt-ai/k8sgpt)                                                                                                                                 | Resource analyzer registry, fake-client tests, optional AI explanation, custom analyzers                                            | Strongest compact Kubernetes runtime analyzer precedent. Independently validate its causal claims and false-positive behavior.                                       |
| [Popeye](https://github.com/derailed/popeye)                                                                                                                                  | Read-only live-cluster linters, resource relationships, metrics thresholds, stable finding codes, exclusions and severity overrides | Strong live preventive-analysis precedent; many findings are policy or hygiene, not current RCA.                                                                     |
| [Robusta](https://github.com/robusta-dev/robusta)                                                                                                                             | Trigger/action playbooks, Prometheus alert enrichment, logs/graphs/change context, self-healing boundaries                          | Strong event-driven enrichment and playbook precedent. Its optional HolmesGPT layer must remain separate from deterministic evidence.                                |
| [Coroot](https://github.com/coroot/coroot)                                                                                                                                    | Service map, predefined inspections, SLO-driven alert consolidation, logs/traces/profiles, deployment comparison                    | Strong telemetry and causal-correlation precedent, but much heavier collection than Headlamp currently owns. Validate product coverage claims independently.         |
| [Kuberhealthy](https://github.com/kuberhealthy/kuberhealthy)                                                                                                                  | Scheduled `HealthCheck` CRD, isolated checker Pods, multi-step validation, JSON/Prometheus result contract                          | Strong extensible synthetic-verification precedent; produces active check outcomes, not passive diagnosis by itself.                                                 |
| [Node Problem Detector](https://github.com/kubernetes/node-problem-detector)                                                                                                  | Configured log/plugin detectors, temporary Events, permanent NodeConditions, problem injection tests                                | Strong evidence-producer precedent for failures Kubernetes does not otherwise expose. Its regexes are platform-sensitive observations, not broad RCA.                |
| [kstatus](https://github.com/kubernetes-sigs/cli-utils/tree/master/pkg/kstatus) and [Argo CD health](https://github.com/argoproj/argo-cd/tree/master/resource_customizations) | Built-in and contributed reconciliation-health adapters, generation checks, normalized status, fixture tests                        | Strong normalization layer. Keep health classification separate from root-cause findings and preserve Unknown.                                                       |
| [Kubernetes mixin](https://github.com/kubernetes-sigs/kubernetes-mixin)                                                                                                       | PromQL predicates, time windows, severity, alert tests, and runbook links                                                           | Strong temporal symptom detector. Use as optional metrics-backed evidence, not a mandatory Headlamp dependency or unique-cause oracle.                               |
| [Flux health expressions](https://fluxcd.io/flux/components/kustomize/kustomizations/#health-check-expressions), Cluster API conditions, and Crossplane readiness             | CEL health overrides, generation-aware conditions, hierarchical aggregation, required resources, and capability negotiation         | Strong extension and compatibility patterns. User-supplied health logic remains policy/input and cannot become trusted causal truth automatically.                   |
| [OpenShift Insights](https://github.com/openshift/insights-operator) and [content service](https://github.com/RedHatInsights/content-service)                                 | Versioned cluster-data gathering plus separately delivered rule metadata, descriptions, tags, groups, and remediations              | Useful collector/content separation precedent. The inspected public service exposes metadata and sample content, not a complete independently countable rule corpus. |
| [Botkube](https://github.com/kubeshop/botkube)                                                                                                                                | Event-source and executor plugins, alert grouping, ChatOps actions                                                                  | Historical event workflow reference. Last visible release/commit in the reviewed repository was about two years old, so recheck maintenance before adoption.         |
| [HolmesGPT](https://github.com/robusta-dev/holmesgpt), [kubectl-ai](https://github.com/GoogleCloudPlatform/kubectl-ai), [kagent](https://github.com/kagent-dev/kagent)        | Investigation tools, context assembly, agent boundaries, model/tool traces                                                          | Agent comparators and consumers of evidence, not proof that deterministic findings are correct. Verify current repository ownership and releases at each refresh.    |

### Adjacent analysis systems

| Category                                    | Tools to inspect                                                                                                                                                                                                                 | Contribution to a Headlamp engine                                                                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static manifest and relationship analysis   | [kube-linter](https://github.com/stackrox/kube-linter), [kube-score](https://github.com/zegl/kube-score), [Polaris](https://github.com/FairwindsOps/polaris), [Kubeconform](https://github.com/yannh/kubeconform)                | Rule registries, templates, severity, exemptions, cross-object checks, schema validation, and machine-readable output. Keep preventive findings separate from runtime causes.                         |
| Security posture and runtime security       | [Kubescape](https://github.com/kubescape/kubescape), [Trivy Operator](https://github.com/aquasecurity/trivy-operator), [kube-bench](https://github.com/aquasecurity/kube-bench), [Falco](https://github.com/falcosecurity/falco) | Versioned controls, CRD reports, vulnerability/configuration findings, runtime alerts, and compliance evidence. Results are security inputs, not generic incident RCA.                                |
| Policy and admission                        | [Kyverno](https://github.com/kyverno/kyverno), [OPA Gatekeeper](https://github.com/open-policy-agent/gatekeeper), Kubernetes CEL ValidatingAdmissionPolicy                                                                       | Declarative evaluation, parameterization, exceptions, audit/background modes, external data, and policy reports. A policy violation may explain admission rejection but not unrelated runtime health. |
| Upgrade and currency                        | [Pluto](https://github.com/FairwindsOps/pluto), [Nova](https://github.com/FairwindsOps/nova)                                                                                                                                     | Deprecated API, Helm chart, and image version findings with explicit target versions. Useful preventive/upgrade track, not default diagnosis.                                                         |
| Observability and query substrates          | [Pixie](https://github.com/pixie-io/pixie), OpenTelemetry, Prometheus, Loki, Tempo                                                                                                                                               | Metrics/logs/traces/service graph observations and query interfaces. Headlamp should consume evidence through adapters rather than recreate a telemetry platform.                                     |
| Synthetic and resilience validation         | Kuberhealthy, [Chaos Mesh](https://github.com/chaos-mesh/chaos-mesh), [LitmusChaos](https://github.com/litmuschaos/litmus)                                                                                                       | Verification and controlled fault mechanisms. Known injection metadata must remain hidden from diagnosis candidates.                                                                                  |
| Cross-manifest relationship validation      | [Kubevious rules](https://github.com/kubevious/rules-library) and [Kubik](https://github.com/kubevious/kubik)                                                                                                                    | Graph-query patterns for selectors, references, ports, and cached lookups. Treat the small, lightly maintained corpus as a design precedent, not an adopted dependency.                               |
| Safe remediation orchestration              | [Node Health Check Operator](https://github.com/medik8s/node-healthcheck-operator), [Self Node Remediation](https://github.com/medik8s/self-node-remediation), Cluster API MachineHealthCheck, Robusta                           | Condition-duration triggers, minimum-healthy/maximum-unhealthy gates, upgrade and manual pauses, ordered remediation templates, and status tracking. Keep outside diagnosis rules.                    |
| Operational knowledge                       | [Prometheus Operator runbooks](https://github.com/prometheus-operator/runbooks), Kubernetes debugging docs                                                                                                                       | Meaning, impact, investigation, and mitigation hypotheses. Transform into reviewed hints and evidence requests; never execute prose.                                                                  |
| Historical or maintenance-uncertain         | [kube-hunter](https://github.com/aquasecurity/kube-hunter), kubeaudit                                                                                                                                                            | Mine architecture and old rule taxonomies only. kube-hunter explicitly says it is no longer actively developed; verify archive/supersession status for every project.                                 |
| Commercial comparison, separately disclosed | Komodor/Klaudia, Datadog, Dynatrace, New Relic, Sysdig, groundcover                                                                                                                                                              | Product capability and workflow comparison from public documentation and trials. Do not infer implementation details or reproducibility from marketing claims.                                        |

### Tool-survey backlog

- [x] Pin and inventory native units for K8sGPT, Popeye, Robusta, Coroot, and
      Kuberhealthy. Keep analyzer, issue-code, action, embedded-check, and
      independently deployed check counts separate.
- [x] Expand the measured static ceiling with Kyverno/Gatekeeper libraries,
      Kubescape/Trivy reports, kube-bench controls, Pluto version data, and Falco
      rules, while preserving category boundaries.
- [ ] Build a matrix of inputs, RBAC, cluster cost, finding schema, rule IDs,
      evidence links, confidence, exceptions, custom-rule mechanism, remediation,
      versioning, and machine-readable APIs.
- [ ] Measure overlap by normalized trigger family and required evidence, not by
      tool-reported rule names.
- [ ] Identify import, library, subprocess, CRD-report, MCP, and reimplementation
      options. Review license, security, update, and sandbox consequences for each.
- [ ] Recheck maintenance state and ownership at every research refresh. Keep
      archived tools as historical references, not recommended dependencies.
- [ ] Run direct tools on the same hidden live roster and retain every warning,
      omission, error, latency, permission failure, and cleanup result.
- [ ] Prototype one normalized adapter each for kstatus, an Argo-style health
      script, a Node Problem Detector Event/condition, and a Prometheus alert.
      Verify that adapters preserve source semantics and Unknown rather than
      pretending every input is a causal rule.
- [ ] Compare Kubevious's graph-query model with a typed relationship builder for
      Service selectors, volume/config references, RBAC bindings, Gateway API,
      and scale targets. Prefer typed code unless a restricted DSL removes
      demonstrated repetition without weakening review.

## Diagnosis and remediation separation

The 40 repair rows in the current portfolio need a product system beyond the
diagnosis engine. Remediation precedents consistently separate detection from
mutation:

- Node Health Check evaluates NodeConditions against configured durations, then
  creates a remediation CR from a template. It stops new remediation when the
  cluster falls below `minHealthy` or exceeds `maxUnhealthy`, during detected
  upgrades, or when manually paused.
- Its ordered remediation templates and timeouts permit escalation without
  putting a reboot, fencing, or reprovisioning strategy into the health rule.
- Self Node Remediation focuses on fencing and restoring safe workload recovery;
  it does not make the original health diagnosis authoritative.
- Cluster API condition utilities aggregate and summarize conditions while
  preserving Unknown for missing inputs; MachineHealthCheck owns remediation
  policy separately.

Headlamp should mirror that split:

```text
finding -> proposed action -> policy/capacity gate -> approval -> revalidation
                        -> execution -> postcondition/collateral check -> rollback or escalation
```

The diagnosis rule may suggest an action class and evidence needed to decide it.
It must not carry credentials, execute commands, bypass approval, decide cluster
capacity, or treat a detector's finding as permission to mutate. This separation
also keeps rules-only evaluation meaningful when repair backends differ.

## Proposed Headlamp architecture

Use a typed pipeline rather than embedding prose mappings in model prompts:

```text
evidence producers/collectors -> normalized observation ledger
      -> GVK health adapters + temporal symptom detectors
      -> relationship graph -> causal/contradiction rules -> findings ledger
      -> optional hypothesis/explanation -> separate action/verification pipeline
```

A finding should minimally carry:

```yaml
rule_id: kubernetes.pod.image-pull-failure
rule_version: 1
kind: deterministic-finding
severity: error
subject: { group: '', version: v1, kind: Pod, namespace: shop, name: api-123 }
evidence_ids: [pod-status-1, event-7, image-ref-2]
summary: Container image cannot be pulled
causal_scope: immediate
confidence: deterministic
applicability: { kubernetes: '>=1.30 <1.38', features: [] }
source:
  - { repository: kubernetes/kubernetes, revision: '<commit>', path: '<path>', symbol: '<symbol>' }
missing_evidence: []
contradictions: []
remediation_refs: ['<pinned-doc-reference>']
```

Rules should be pure over a bounded observation snapshot. Collectors own API
access, redaction, timeouts, and freshness. Relationship builders own selectors,
owner references, EndpointSlices, scale targets, volumes, RBAC subjects, and
other graph edges. Presentation owns translation and UI grouping. Optional LLMs
may explain findings, rank explicitly labeled hypotheses, or request additional
observations; they must not change deterministic rule results or manufacture
evidence.

Prefer code or a restricted typed DSL for causal rules. CEL/Rego/JSON Schema are
strong precedents for policy predicates, but multi-resource temporal diagnosis
also needs graph traversal, freshness, cardinality, and evidence acquisition.
Do not invent a general-purpose language before the first 25-40 rules expose
real repetition.

## Fair evaluation plan

Evaluate three systems on the same observations and budgets:

1. rules only;
2. model only, without answer-bearing rule output;
3. hybrid, where deterministic findings are disclosed as product input.

Use unseen scenario lineages, healthy twins, confounders, stale evidence,
missing permissions, missing telemetry, and composed faults. Score trigger-level
precision/recall, root-cause precision/recall, unsupported claims, evidence
provenance, abstention, investigation cost, latency, and safe recovery. Cluster
uncertainty by scenario lineage rather than treating message variants as
independent cases.

For model-quality comparisons, every model receives the same ontology and
non-answer-bearing evidence. Product-system comparisons may include Headlamp
rules, but must disclose that advantage and include rules-only and model-only
ablations. Never tune a rule from protected evaluator aliases and then count its
injected output as model reasoning. Fresh holdout lineages are mandatory after
any rule or rubric change.

## Ordered research backlog

1. [x] Establish the current Headlamp Pod/workload baseline.
2. [x] Measure initial K8sGPT, kube-linter, kube-score, and Polaris inventories.
3. [ ] Pin upstream Headlamp behavior and turn it into a reviewed rule inventory.
4. [ ] Complete the wider tool matrix and normalized overlap analysis.
5. [ ] Define the observation, relationship, rule, finding, provenance, and
       version contracts.
6. [ ] Build and evaluate the five-family Kubernetes-source extraction pilot.
7. [ ] Hand-author the focused 25-40-family slice only after the pilot identifies
       which source-derived candidates are trustworthy.
8. [ ] Run rules-only, model-only, and hybrid ablations on fresh hidden lineages.
9. [ ] Re-estimate core size, schedule, and maintenance from observed authoring,
       review, qualification, and release-diff costs.
10. [ ] Decide whether to extend to telemetry, security reports, control-plane
        health, and operator rule packs based on measured incremental value.
11. [ ] Build an adapter-versus-causal-rule experiment: reuse normalized Argo or
        kstatus health across unseen GVKs while holding causal rules fixed. If
        every GVK still needs bespoke causal logic, revise the two-dimensional
        sizing model.
12. [ ] Establish a prospective rule-quality ledger and collect precision,
        recall, abstention, detection delay, operator disposition, and
        maintenance effort. Do not publish coverage percentages until the
        target population and denominator are explicit.

## Decision gates

Do not promote a rule unless it has a stable ID, typed evidence, source and
version provenance, healthy and negative controls, permission/partial-data
behavior, live qualification, and an owner. Do not call a finding a root cause
when the rule proves only a symptom or policy violation. Do not adopt a third-
party engine solely because its catalog is larger. Do not expand beyond the
focused slice until rules-only precision and incremental hybrid value justify
the maintenance cost.
