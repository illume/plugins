# AKS Scenario Research Catalogue

Research checkpoint: 2026-09-17. Implements the discovery work in
[R15](observability-research.md#r15-public-report-driven-aks-scenario-discovery).

Keep useful real AKS incidents whether or not observability tools are essential.
Track **our reproduction status** independently from **evidence dependence**.
An incident report, proposed script, or model answer is not a verified reproduction.
No newly discovered case below has been provisioned, reproduced, or model-evaluated
by this research. Existing live runs are recorded separately.

## 100-Candidate Review

The [structured register](aks-candidate-register.json) now contains **100 distinct
candidate designs from 100 public user reports**. Twelve bounded GitHub searches
returned 600 results, deduplicated to 435 reports; 120 received description and
reproduction-section review, yielding 100 candidates and 20 explicit non-admissions.
The register retains those decisions, source dates/body digests, triggers, failure
oracles, recovery plans, environment prerequisites, and evidence labels.

These are **research candidates, not 100 verified reproductions or 100 confirmed
current AKS bugs**. There are 51 source-configuration designs, 37 version-dependent
designs, 10 pinned-component designs, and two explicitly adapted historical
mechanisms. Check current AKS/region/component availability before an attempt;
mark unavailable prerequisites blocked. Some cases diagnose expected compatibility
constraints or operator mistakes reported as bugs. That still makes them useful
real-user diagnostic cases, without endorsing the reporter's defect interpretation.

Evidence classifications are provisional: **46 K**, **42 H**, and **12 O**. K means
Kubernetes-sufficient candidate for the stated proximate diagnosis; H means external
observability is helpful; O means external evidence may be required for the specific
attribution. **Zero are observability-only verified.** Cases involving projected
identity metadata can be K even though a real authentication control still needs
an owned Azure test identity.

Start low-cost proof work with C001 (CRD lookup ambiguity), C014 (ALB chart image
path), C024 (image-volume subPath), C059 (CoreDNS zone validation), and C094/C097/C099
(identity mutation). These have useful render/component prechecks before full AKS
execution. Those prechecks do not replace the real AKS lifecycle. For external
evidence, prioritize C075 (orphaned share), C080 (subnet policy mutation), and C038
(stale role assignment), plus the initial SNAT lead once metric dimensions are
supported. All cloud attempts require bounded cost/scope and owned cleanup.

## 100 Draft Scenario Plans

On 2026-09-18, all 100 register entries were converted one-to-one into
[structured scenario plans](../evals/scenario-plans/aks-real-incidents.json), with
stable IDs `aks-c001-v1` through `aks-c100-v1`. These are **draft plans, not runnable
or qualified scenarios**. Every plan has `execution.eligible: false`, implementation
`not-implemented`, qualification `pending`, and no results. The two implemented AKS
observability lifecycles remain separate; the draft catalogue does not expand the
locked Phase 2 roster or any qualified evaluation denominator.

Each plan contains a distinct symptom-focused candidate task, a case-specific
baseline/healthy control and observation list, and the original source-specific
fault trigger, fault oracle, recovery procedure, environment, fidelity, and source
dates/body digest. These plans propose experiments; they do not claim that the
reported versions are still deployable or that the proposed fault will reproduce.
The 46 K / 42 H / 12 O research labels are preserved, with **zero observability-only
verified**. Version-dependent plans explicitly require blocking unavailable
prerequisites instead of silently substituting a current managed version.

### Inspect Offline

From `ai-assistant/evals`, after installing the eval dependencies:

```sh
npm run eval:observability -- list-drafts
npm run eval:observability -- show-draft --scenario aks-c001-v1
npm run eval:observability -- list
```

`list-drafts` returns a summary of the 100 plans and their ineligible status.
`show-draft` returns the full selected plan, including evaluator-only details.
Neither needs Azure credentials, a state directory, or paid inference. `list`
continues to show only implemented observability scenarios. The regular
`list-scenarios` command also excludes these drafts; `run` and `verify` cannot
execute their IDs.

Only `candidate_view` is intended for eventual candidate exposure. The title,
source report, provenance, evidence classification, and `evaluator_plan` can reveal
the intended fault and must not be passed wholesale to a diagnosing model. The
current tests check structural separation, not proof that every future packet is
free of answer leakage; qualification requires a case-specific review.

### Maintain And Generate

Edit the source [candidate register](aks-candidate-register.json) for research
corrections and [case designs](../evals/scenario-plans/aks-candidate-designs.json)
for candidate tasks, baselines, and observation requirements. Do not hand-edit the
generated catalogue. From `ai-assistant/evals`:

```sh
node_modules/.bin/tsx src/scenarios/aksCandidateScenarios.ts --write
node_modules/.bin/tsx src/scenarios/aksCandidateScenarios.ts --check
npm run check
```

The [builder](../evals/src/scenarios/aksCandidateScenarios.ts) validates the input
shape, unique source/candidate/design mappings, complete coverage, and the fixed
100-case count. The catalogue records the register SHA-256. Loading drafts compares
the generated content with the committed JSON and rejects stale or edited output;
`--check` does not rewrite files. Tests exercise all 100 mappings, preservation of
source fault/recovery plans, CLI inspection, and exclusion from runnable discovery.

### Qualify One Case

1. Resolve source/version availability and exact reproduction fidelity; record
   blocked or non-reproduced cases honestly.
2. Implement bounded setup, fault injection, observation capture, recovery, and
   ownership-checked cleanup in an explicitly authorized disposable environment.
   Declare resource, time, and cost budgets before provisioning.
3. Demonstrate baseline, fault, recovery, and cleanup on real resources. A deleted
   cluster alone is not a successful recovery; a rendered manifest is not an AKS
   lifecycle reproduction.
4. Construct separate candidate/evaluator packets and exact source-bound grading
   facts and alternatives. The prose fault oracle is not a diagnosis rubric.
   Implement healthy and insufficient-evidence controls and test the declared
   Kubernetes-only evidence boundary before claiming observability necessity.
5. Add runnable scenario packets and focused case logic through the existing
   [scenario admission process](../evals/src/scenarios/README.md). Admit qualified
   evidence only after its gates pass and use a fixed plan for model evaluation.

Do not enable a draft by flipping `eligible` in generated JSON. Executable manifests,
capture tools, exact grading facts, and lifecycle qualification are still required.
No new cloud resources or paid model calls were used to create these 100 plans.

## Labels And Scope

Reproduction labels: `unassessed`, `feasible-not-run`, `attempted-not-reproduced`,
`fault-reproduced`, `lifecycle-verified`, and `blocked`. Feasible means a proposed
mechanism-level experiment, not a guarantee that an old service bug still exists.
Only verified baseline, fault, recovery, and owned-resource cleanup justify
`lifecycle-verified`. Preserve unsuccessful attempts and distinguish exact reported
bugs from related mechanisms deliberately induced in a test.

Evidence labels: `Kubernetes-sufficient`, `observability-helpful`,
`observability-required-candidate`, `observability-only-verified`, and `unknown`.
For this catalogue, Kubernetes evidence includes available objects, events,
workload/component logs, and declared read-only connectivity/DNS observations.
Document node-shell privileges, external DNS lookups, and any additional telemetry
separately; do not change that boundary between candidates. A failed Kubernetes-only
model run does not establish that the evidence itself is insufficient.

No new case is labelled `observability-only-verified`. That requires a validated
causal distinction unresolved by the full declared Kubernetes view but resolved by
the authorized external reads, with healthy and confounding controls. An exact
external-rule attribution task may require Azure evidence even when Kubernetes
symptoms already identify a likely networking failure.

## Initial Shortlist

Expansion target requested on 2026-09-17: **100 distinct, actionable candidates
from real user reports**, now recorded in the structured register. The initial
seven families below remain discovery leads, not seven additional admitted cases.
Count only reviewed cases with concrete
source evidence, a controlled reproduction design, an observable failure oracle,
and a recovery path. Exclude duplicates, feature requests, unspecified outages,
and causes dependent on inaccessible provider internals from the target count.
Historical version dependence and mechanism-versus-exact-bug reproduction must
remain explicit; candidate admission never means we have reproduced the fault.

| ID | Incident family | Our reproduction | Evidence dependence | Next decision |
| --- | --- | --- | --- | --- |
| AKS-R01 | Standard Load Balancer outbound SNAT exhaustion | `feasible-not-run` for exhaustion; exact RST-retention bug unverified | `observability-required-candidate` | First external-evidence feasibility target; fix/verify dimensional metric access before scoring. |
| AKS-R02 | Private API endpoint IP changes invalidate firewall allowlist | `feasible-not-run` for stale allowlist; natural IP change not guaranteed | `observability-required-candidate` | Good AKS lifecycle case, but needs an out-of-band investigation path and firewall reads. |
| AKS-R03 | ACNS-managed DNS proxy crash from conflicting flags | `blocked` for exact managed regression until version availability is checked | `Kubernetes-sufficient` for proximate crash diagnosis | Keep as a general AKS case; do not call a hand-written bad Pod an AKS service reproduction. |
| AKS-R04 | Managed Prometheus collector cannot reach its DCE | `feasible-not-run` for endpoint-access failure | `observability-helpful`; exact dependency varies by variant | Useful general diagnostic case; isolate DNS, access policy, and association faults separately. |
| AKS-R05 | API-server traffic contributes to NAT Gateway processing cost | `feasible-not-run` for traffic-path measurement | `observability-required-candidate` for Azure usage attribution | Retain as a cost investigation, not an outage; billing latency and tooling gaps lower priority. |
| AKS-R06 | AKS cannot reach peered resources while a VM can | `unassessed` for the reported incident | `unknown` | Keep lead; reporter did not confirm whether DNS, source-subnet policy, or routing caused it. |
| AKS-R07 | Unexplained deallocation of regular AKS VMSS instances | `blocked` for originating cause | `unknown` | Retain as an escalation/insufficient-evidence case; do not invent a hidden platform cause. |

## Source Ledger

All links were accessed on 2026-09-17. Dates below are report creation dates;
follow-up dates are included where confirmed. Environment fields are what the
reporter supplied, not versions independently tested by us. Missing fields remain
unknown. Summaries are paraphrased; customer inventories, images, and credentials
are not copied into the repository.

| Source | Reported environment | Evidence and confidence |
| --- | --- | --- |
| [Azure/AKS #4697](https://github.com/Azure/AKS/issues/4697), 2024-12-11 | AKS 1.30.5/1.30.6; Azure CNI node subnet; Calico; Istio 1.24.1; one outbound public IP | Reporter describes many short-lived PostgreSQL connections, SNAT depletion, and mitigation by more outbound ports/IPs. [Follow-up](https://github.com/Azure/AKS/issues/4697#issuecomment-2642990935) narrows it to connections ending in RST and says it persists; a service defect is not established. |
| [Q&A 5968366](https://learn.microsoft.com/en-us/answers/questions/5968366/started-intermittent-ssl-handshake-issues-for-outb), 2026-08-06 | Private AKS, Application Gateway ingress, .NET client; AKS/CNI version unspecified | Reporter confirmed on 2026-08-08 that replacing Load Balancer outbound with NAT Gateway stopped timeouts. No published dimensional SNAT proof; this confirms mitigation, not the precise mechanism. |
| [Azure/AKS #4668](https://github.com/Azure/AKS/issues/4668), 2024-11-21 | AKS 1.29.8; private cluster; custom DNS setup; Azure CNI Overlay; UDR; hub/spoke IP-based firewall rules | Reporter says stop/start changes API IP and access requires a firewall update. [Follow-up](https://github.com/Azure/AKS/issues/4668#issuecomment-2497043731) accepts the documented behavior. Strong mechanism lead; natural IP change is not guaranteed on every restart. |
| [Q&A 5965332](https://learn.microsoft.com/en-us/answers/questions/5965332/acns-observability-only-configuration-deploys-cras), 2026-08-03 | Reporter lists AKS 1.36.2, centralus, Azure Linux image `AKSAzureLinux-V3gen2-202607.09.0`, Cilium Overlay, DNS proxy `v1.19.3-260520` | Reports security disabled in ARM but conflicting generated proxy flags and an explicit crash error. Replies request fresh-cluster/current-patch reproduction; no confirmed fix or independent reproduction. Verify regional version/image availability rather than assuming these reported versions are deployable. |
| [Azure/AKS #3796](https://github.com/Azure/AKS/issues/3796), 2023-07-18 | Original AKS 1.25.6; CLI 2.50.0; managed Prometheus collector 6.7.2-era; later replies include AMPLS setups | Original collector restarts with localhost exporter errors. [A participant](https://github.com/Azure/AKS/issues/3796#issuecomment-2125969474) reports success after endpoint/association/DNS configuration work. Thread spans multiple setups: not one proven universal fix, and the original localhost theory is not established as the cause. |
| [Azure/AKS #4422](https://github.com/Azure/AKS/issues/4422), 2024-07-19 | AKS 1.27.9; public API; NAT Gateway egress | Reporter provides a route-change experiment and observed NAT metric reduction. [Another participant](https://github.com/Azure/AKS/issues/4422#issuecomment-2594096570) reports VNet Integration helped. Treat pricing figures as historical reports, not current quotes or proof of incorrect billing. |
| [Q&A 5955816](https://learn.microsoft.com/en-us/answers/questions/5955816/azure-kubernetes-service-aks-azure-dns-private-res), 2026-07-24 | AKS VNet uses a DNS Private Resolver in a peered VNet in another subscription; AKS/CNI version unspecified | AKS fails while ordinary VMs connect. Replies propose DNS and actual source-subnet checks; no reporter-confirmed resolution. Multiple hypotheses remain. |
| [Q&A 5970390](https://learn.microsoft.com/en-us/answers/questions/5970390/recurring-unexplained-vm-deallocation), 2026-08-09 | Regular, not Spot, AKS pools; NodeImage upgrade considered; AKS version unspecified | Reporter verified deallocation and recovery via VMSS start, but no matching Activity Log operation. Support says internal telemetry is needed. Do not adopt speculative quota-enforcement or add-on explanations as fact. |

Eight threads map to seven candidate families; the two SNAT reports remain distinct
incidents, not duplicates or two confirmations of the same low-level bug.

## Reproduction Assessments

### AKS-R01: SNAT Exhaustion

**Hypothesis:** bounded outbound demand on a specific AKS node exhausts its Standard
Load Balancer SNAT allocation while the workload and owned destination remain healthy.
The [AKS troubleshooting guide](https://learn.microsoft.com/en-us/troubleshoot/azure/azure-kubernetes/connectivity/snat-port-exhaustion)
uses Azure metrics to locate the node, then connection tracing to identify workload
contributors. Pod timeouts or high connection counts alone do not prove exhaustion.

Proposed reproduction: use a disposable supported AKS Load Balancer outbound
configuration and a researcher-owned public TCP endpoint, pre-pull workload images,
and establish low-load health. Bound connections, concurrency, bytes, and duration;
increase demand until node-specific failed SNAT allocations and port pressure are
observed. Abort if the mechanism is not demonstrated within the approved budget.
Recover by reducing demand and, in a separate intervention, increasing supported
AKS outbound capacity. Keep endpoint-down, DNS-failure, and healthy high-load
controls. Do not load-test an internet service or edit AKS-managed LB internals.

Required reads: `azure_network_config_read` topology to identify the LB and
`azure_metrics_read` for `UsedSnatPorts`, `AllocatedSnatPorts`, and
`SnatConnectionCount`. Per the [metric reference](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-metrics/microsoft-network-loadbalancers-metrics),
use `PT1M`, appropriate Average port gauges and Total connection counts, with
`BackendIPAddress`, `FrontendIPAddress`, protocol where supported, and failed
`ConnectionState` separated. Do not sum minute-by-minute port gauges as capacity.
Metrics are delayed observations, not guaranteed immediate samples.

**Gap:** the current metrics tool exposes names, aggregation, interval, and time,
but no dimension filter/split or metric-definition discovery. An aggregate across
healthy and affected nodes cannot establish the intended node-level claim. Verify
or add bounded dimensional reads before scoring. The exact short-lived/RST retention
behavior in #4697 needs a separate experiment; generic exhaustion would only be
a mechanism reproduction. NAT Gateway is not mandatory for healthy AKS egress.

**Resources:** AKS, Standard LB/public IP, owned public test endpoint, optional
additional outbound IPs. Requires an explicit small-run duration/cost budget and
resource-creation permissions; no new provisioning performed.

### AKS-R02: Stale Private API Allowlist

The [stop/start documentation](https://learn.microsoft.com/en-us/azure/aks/start-stop-cluster)
states that private endpoints are recreated and API IPs may change. Compare the
current endpoint IP and route with the operator's allowed destination and actual
deny telemetry. An API timeout alone cannot distinguish a stale rule, DNS error,
stopped cluster, or other network loss.

Proposed exact attempt: private AKS with an owned hub/spoke firewall and an
out-of-band management path; prove access, stop/start once using documented waits,
and check whether the IP actually changed. If unchanged, record
`attempted-not-reproduced`, not a success. A separately declared stale-allowlist
injection can reproduce the mechanism deterministically, but not the natural
stop/start IP-change event. Restore the correct narrow rule, verify API access,
and delete all owned resources. Never deliberately strand the only management path.

**Gap:** topology reads cover some private endpoints, but not general hub firewalls,
private DNS records/links, or DNS Resolver rulesets. Workspace logs could expose
firewall denies only if preconfigured and queryable. The existing prescribed-read
eval harness assumes Kubernetes evidence is available; API-unreachable trials need
an explicit unavailable/error path, not an old healthy snapshot substituted as live.
Firewall hourly cost and stop/start latency make this a later attempt.

### AKS-R03: ACNS Proxy Crash

Keep this as a **general AKS case**: container logs and generated Pod/ConfigMap flags
can identify the proximate proxy configuration conflict. ARM evidence helps establish
that managed generation disagrees with the requested ACNS state, but is not needed
merely to explain why the process exits. The phrase "observability-only" in the
report title describes an ACNS feature mode, not our evidence-dependence label.

First check supported regional AKS/node-image/ACNS availability against the reporter's
versions and [feature documentation](https://learn.microsoft.com/en-us/azure/aks/advanced-container-networking-services-overview).
An authorized disposable Cilium Overlay cluster could compare supported healthy
settings with the reported observability-on/security-off configuration and capture
ARM intent, managed objects, logs, and restart behavior. Restore via supported
configuration or upgrade, then clean up. No reporter-confirmed fix is available.

If the current service no longer emits the bad configuration, record non-reproduction.
Running a container with hand-written conflicting flags is a component-level test,
not reproduction of the AKS-managed regression. Do not patch a managed DaemonSet
and then claim the managed service produced the bug. Cost includes ACNS and AKS;
historical managed rollout availability is the present blocker.

### AKS-R04: Managed Metrics Ingestion Failure

Start with a working AKS managed Prometheus path, a known exporter sample, and
successful ingestion. In an isolated deployment, change exactly one operator-owned
dependency: endpoint access, DNS link, or collection association. Prove source
scrapes remain healthy while ingestion stops, inspect collector logs and the
external dependency, restore it, and verify newly timestamped samples arrive.
Allow bounded ingestion delay; an empty query alone is not a fault oracle.

Do not assume localhost exporter errors mean the remote endpoint should replace
localhost, or that all private AKS clusters require AMPLS. Historical thread replies
cover different network and regional arrangements. Each variant needs current
official configuration validation before implementation. Collector logs may already
name the failing dependency, making observability helpful rather than required.

**Gap:** current topology excludes DCE/DCR/association/AMPLS resources. The diagnostics
tool reads diagnostic settings, not those configurations. `prometheus_read` or
`grafana_read` needs an actually reachable, supported-auth query endpoint; discovery
alone does not prove managed Prometheus authentication works. Budget for workspace
ingestion, optional private endpoints, AKS, and cleanup of all owned associations.

### AKS-R05: NAT Processing Cost Attribution

This is a realistic investigation even with healthy Pods. The
[AKS outbound-type documentation](https://learn.microsoft.com/en-us/azure/aks/egress-outboundtype)
confirms public API-server traffic follows outbound routing and points to private
clusters or API Server VNet Integration to avoid processing it as public traffic.
This corroborates the path mechanism, not every historical billing assertion.

Use a tiny dedicated environment and bounded API activity, retain endpoint-specific
flow evidence and NAT counters, then compare a supported private/integrated path.
Do not recreate hundreds of nodes or large bills. Label a byte/path experiment
separately from a billing reproduction; actual usage export can lag the experiment.
Changing outbound type may change public IPs and disrupt connections, so this is
not a trivial reversible repair.

**Gap:** current cost reads are node-resource-group daily totals, not per-meter,
per-resource, destination-specific attribution. A BYO NAT in another group is not
covered by that query. Current topology and dimensional metrics also need review.
Keep as a lower-priority external-observability candidate, not a promised outage fix.

### AKS-R06 And AKS-R07: Retained Unresolved Leads

For peered connectivity, first obtain missing CNI/source-IP and DNS-versus-TCP
evidence. Reproducing an arbitrary NSG deny would overlap our existing network case,
not establish the cause of this user's unresolved incident. Keep as `unassessed`.

For deallocation, a deliberate VM stop does not reproduce an unexplained Azure
initiator. Retain observed power-state/health evidence and unknown-cause escalation
as a useful task, but do not manufacture platform health events or assert a quota,
upgrade, or policy cause absent evidence. Hidden support telemetry is a blocker,
not something our public tools can be assumed to retrieve.

## Our Existing Reproductions

These predate this internet-source catalogue and are **not** reproductions of the
specific reports above. Snapshot from retained artifacts on 2026-09-17:

| Existing case | Our reproduction status | Model result | Evidence dependence |
| --- | --- | --- | --- |
| `aks-private-backend-nsg-deny-v1` | `lifecycle-verified`: healthy baseline, real deny, recovery, cleanup; latest cleanup 06:04:02 UTC | Latest observability-enabled diagnosis passed, 6/6 facts; Kubernetes-only failed | `observability-required-candidate` for exact external-rule attribution; not formally verified solely by this model contrast |
| `aks-autoscaler-max-count-v1` | `lifecycle-verified` in the latest attempt: baseline, capped-pool fault, recovery at 06:16:45 UTC, cleanup at 06:26:54 UTC | Latest enabled and Kubernetes-only diagnoses failed, despite successful infrastructure recovery | `observability-helpful`: Kubernetes autoscaler events can expose limits; keep as a general AKS case regardless |

The [original live report](../evals/docs/observability-aks-gpt4o-results.md) and
[strict-default checkpoint report](../evals/docs/observability-aks-strict-results.md)
retain diagnosis results. The latter preserves the early checkpoint and now records
the completed four-session run. Both owned resource groups and both managed node
groups were independently verified absent after completion. Successful reproduction
does not imply a successful model diagnosis.
Private artifact roots are `.tmp/pr25-aks-nsg-gpt4o-c-20260916`,
`.tmp/pr25-aks-capacity-gpt4o-20260916`, and `.tmp/pr25-aks-strict-rerun-20260917`.
Never overwrite an earlier failure with the status of a later attempt.

## Next Reproduction Work

1. Retain the completed NSG and autoscaler lifecycle evidence and all four model
   results. Both recoveries and cleanups passed; autoscaler diagnosis still failed.
2. Prepare the SNAT mechanism test and verify dimensional metric access offline.
   This is the best-supported new observability-required lead, not yet verified.
3. Check ACNS historical/current version feasibility for a general AKS case. If
   blocked, prepare a single managed-collector dependency variant rather than
   inventing the historical managed regression.
4. Agree resource scope, permissions, duration, spend, teardown, and stop conditions
   before new paid attempts. Run real baseline/fault/recovery/cleanup first, without
   a model; only then admit a model scenario and assess observability dependence.

Each attempt record must include case/source IDs, exact versus mechanism variant,
date, region, AKS/CNI/node/add-on versions, code and image digests, commands/config
diffs, separate lifecycle outcomes, private evidence paths/digests, cost or estimate,
cleanup ownership verification, and evidence label with its justification. A failed
or blocked reproduction remains in this catalogue; it is not a model failure.

## Method And Tool Audit Limits

The initial pass reviewed eight primary threads and selected follow-ups, not an
exhaustive survey. Discovery used Azure/AKS issue searches for SNAT exhaustion and
firewall/DNS/outbound plus the Microsoft Q&A AKS index. A bounded quota/autoscaler
search returned no results; that is not evidence no such incidents exist. Stack
Overflow and independent postmortems remain to be searched. Some long GitHub
threads were read in selected comment windows, not every comment. Search listings
alone were not treated as confirmed diagnoses.

Tool coverage was inspected in
[AzureAksTools](../packages/ai-common/src/tools/observability/AzureAksTools.ts) and
[ObservabilityTools](../packages/ai-common/src/tools/observability/ObservabilityTools.ts)
at `6d1f9cf01`, with product code unchanged during research. No cloud request was
used to qualify a new tool path. Network topology is limited to selected resource
types in the managed node group plus same-subscription private DNS zones; it does
not enumerate DNS records, VNet links, firewalls, or DCE/DCR/AMPLS relationships.
Workspace-local KQL is supported with bounded time/results and no cross-workspace
queries, but only for tables actually collected and authorized. Missing diagnostic
data is not proof that an event never occurred. Resource Health is not a universal
explanation of underlying cause, and change history is not the Azure Activity Log.

Official metric names, dimensions, and aggregations were checked against the
[Load Balancer reference](https://learn.microsoft.com/en-us/azure/azure-monitor/reference/supported-metrics/microsoft-network-loadbalancers-metrics)
and [diagnostics guide](https://learn.microsoft.com/en-us/azure/load-balancer/load-balancer-standard-diagnostics).
Recheck mutable documentation and service support before implementation. Store
permitted source revisions/digests when a case is admitted; these linked paraphrases
are a research ledger, not a frozen source corpus or a license grant to copy reports.

## Candidate Index

Generated from the structured register. Source dates are report dates, not our
reproduction dates. Full triggers, oracles, recovery plans, and prerequisites are
in the register. The 100-case expansion used Azure/AKS, Azure Files CSI, Azure Disk
CSI, and Azure Workload Identity reports; it is not a cross-web exhaustive search.

<!-- AKS-CANDIDATE-INDEX:START -->
| ID | Candidate | Source / Report Date | Fidelity | Evidence |
| --- | --- | --- | --- | --- |
| AKS-C001 | ACStor and Flux CRD short-name collision | [AKS #5827](https://github.com/Azure/AKS/issues/5827), 2026-06-14 | source-configuration | K |
| AKS-C002 | Windows Pod deletion hangs with two ConfigMap subPath mounts | [AKS #4309](https://github.com/Azure/AKS/issues/4309), 2024-05-23 | version-dependent | K |
| AKS-C003 | Encrypted Azure Files NFS mount lacks AZNFS helper | [AKS #5772](https://github.com/Azure/AKS/issues/5772), 2026-05-13 | version-dependent | H |
| AKS-C004 | Node auto-provisioning rejects disk encryption set configuration | [AKS #5345](https://github.com/Azure/AKS/issues/5345), 2025-10-15 | version-dependent | O |
| AKS-C005 | Cost-analysis addon LRS disk conflicts with scheduling zone | [AKS #5228](https://github.com/Azure/AKS/issues/5228), 2025-08-22 | source-configuration | H |
| AKS-C006 | Azure Files managed-identity mount lacks azfilesauthmanager | [AKS #5447](https://github.com/Azure/AKS/issues/5447), 2025-11-17 | version-dependent | H |
| AKS-C007 | Unencrypted NFS mount conflicts with secure-transfer requirement | [AKS #5230](https://github.com/Azure/AKS/issues/5230), 2025-08-25 | source-configuration | H |
| AKS-C008 | Exported kube-audit payload truncates inside JSON | [AKS #4635](https://github.com/Azure/AKS/issues/4635), 2024-11-12 | version-dependent | O |
| AKS-C009 | Cloning an imported cross-resource-group disk builds an invalid source ID | [AKS #4544](https://github.com/Azure/AKS/issues/4544), 2024-09-16 | version-dependent | H |
| AKS-C010 | Private cluster DNS auto-link exceeds subnet-scoped identity permissions | [AKS #4841](https://github.com/Azure/AKS/issues/4841), 2025-03-06 | source-configuration | O |
| AKS-C011 | In-tree Azure Files migration requests an absent token audience | [AKS #4821](https://github.com/Azure/AKS/issues/4821), 2025-02-28 | version-dependent | K |
| AKS-C012 | Flux OCI chart fetch uses a non-directory HOME path | [AKS #4900](https://github.com/Azure/AKS/issues/4900), 2025-03-30 | version-dependent | K |
| AKS-C013 | Managed Prometheus configuration does not enable requested control-plane targets | [AKS #4838](https://github.com/Azure/AKS/issues/4838), 2025-03-05 | version-dependent | H |
| AKS-C014 | ALB Helm chart adds an unwanted public image-path segment | [AKS #5917](https://github.com/Azure/AKS/issues/5917), 2026-08-12 | pinned-component | K |
| AKS-C015 | APT ignores uppercase-only proxy exclusion during AKS bootstrap | [AKS #5945](https://github.com/Azure/AKS/issues/5945), 2026-09-04 | source-configuration | H |
| AKS-C016 | Calico API server certificate creation is blocked by operator RBAC | [AKS #5675](https://github.com/Azure/AKS/issues/5675), 2026-03-25 | version-dependent | K |
| AKS-C017 | Retina aggregation omits source and destination IP fields | [AKS #5734](https://github.com/Azure/AKS/issues/5734), 2026-04-21 | source-configuration | O |
| AKS-C018 | AGC association breaks after ALB controller restart | [AKS #5709](https://github.com/Azure/AKS/issues/5709), 2026-04-09 | version-dependent | H |
| AKS-C019 | NPD uses a wrong DNS IP on additional pools | [AKS #5451](https://github.com/Azure/AKS/issues/5451), 2025-11-18 | version-dependent | K |
| AKS-C020 | Configured NAP diagnostic category produces no records | [AKS #5213](https://github.com/Azure/AKS/issues/5213), 2025-08-14 | version-dependent | O |
| AKS-C021 | BYOCNI pod CIDR is accepted but lost from ARM state | [AKS #5399](https://github.com/Azure/AKS/issues/5399), 2025-10-30 | version-dependent | O |
| AKS-C022 | Calico Typha schedules on an incompatible ACI virtual node | [AKS #4667](https://github.com/Azure/AKS/issues/4667), 2024-11-20 | source-configuration | K |
| AKS-C023 | Windows port-forward lacks wincat | [AKS #5460](https://github.com/Azure/AKS/issues/5460), 2025-11-21 | version-dependent | K |
| AKS-C024 | Image volume does not expose the requested subPath | [AKS #5730](https://github.com/Azure/AKS/issues/5730), 2026-04-20 | pinned-component | K |
| AKS-C025 | Host tooling loses kubectl after relocation outside PATH | [AKS #5833](https://github.com/Azure/AKS/issues/5833), 2026-06-19 | version-dependent | K |
| AKS-C026 | Cost-analysis addon uses an amd64 image on ARM64 | [AKS #5814](https://github.com/Azure/AKS/issues/5814), 2026-06-09 | version-dependent | K |
| AKS-C027 | Basic image volume fails mkdir on Azure Linux | [AKS #5721](https://github.com/Azure/AKS/issues/5721), 2026-04-13 | version-dependent | K |
| AKS-C028 | Automatic namespace protection blocks Dapr trust initialization | [AKS #5726](https://github.com/Azure/AKS/issues/5726), 2026-04-15 | version-dependent | K |
| AKS-C029 | ArgoCD extension collides with existing immutable selectors | [AKS #5582](https://github.com/Azure/AKS/issues/5582), 2026-02-02 | source-configuration | K |
| AKS-C030 | ALB pre-delete hook lacks tolerations | [AKS #5729](https://github.com/Azure/AKS/issues/5729), 2026-04-17 | pinned-component | K |
| AKS-C031 | ArgoCD extension omits identity metadata | [AKS #5600](https://github.com/Azure/AKS/issues/5600), 2026-02-10 | source-configuration | K |
| AKS-C032 | Identity Binding changes the projected token path | [AKS #5541](https://github.com/Azure/AKS/issues/5541), 2026-01-08 | version-dependent | K |
| AKS-C033 | Entra impersonation lacks identity extras | [AKS #4743](https://github.com/Azure/AKS/issues/4743), 2025-01-13 | source-configuration | H |
| AKS-C034 | VNet encryption conflicts with API VNet Integration provisioning | [AKS #5334](https://github.com/Azure/AKS/issues/5334), 2025-10-10 | version-dependent | O |
| AKS-C035 | Automatic network-isolated flags form an invalid configuration | [AKS #5240](https://github.com/Azure/AKS/issues/5240), 2025-08-28 | source-configuration | O |
| AKS-C036 | Internal app routing does not create private DNS records | [AKS #4487](https://github.com/Azure/AKS/issues/4487), 2024-08-15 | source-configuration | H |
| AKS-C037 | Flux cross-tenant federation propagates the wrong tenant | [AKS #5121](https://github.com/Azure/AKS/issues/5121), 2025-07-04 | source-configuration | H |
| AKS-C038 | Identity replacement retains a stale node-group role assignment | [AKS #4610](https://github.com/Azure/AKS/issues/4610), 2024-10-28 | source-configuration | O |
| AKS-C039 | Cilium LB-IPAM races the Azure cloud controller | [AKS #5044](https://github.com/Azure/AKS/issues/5044), 2025-05-25 | source-configuration | K |
| AKS-C040 | Calico BPF setup fails on a FIPS image | [AKS #4837](https://github.com/Azure/AKS/issues/4837), 2025-03-05 | version-dependent | K |
| AKS-C041 | Managed Istio Gateway generates an invalid proxy image | [AKS #4322](https://github.com/Azure/AKS/issues/4322), 2024-05-30 | version-dependent | K |
| AKS-C042 | Deallocated nodes trip autoscaler unready thresholds | [AKS #5211](https://github.com/Azure/AKS/issues/5211), 2025-08-14 | source-configuration | H |
| AKS-C043 | Scale-from-zero ignores GPU time-slicing capacity | [AKS #3427](https://github.com/Azure/AKS/issues/3427), 2023-01-18 | version-dependent | H |
| AKS-C044 | Typha replicas face host-port and taint conflicts | [AKS #4143](https://github.com/Azure/AKS/issues/4143), 2024-03-06 | source-configuration | K |
| AKS-C045 | Topology spread prevents expected scale-in | [AKS #4201](https://github.com/Azure/AKS/issues/4201), 2024-04-10 | source-configuration | H |
| AKS-C046 | ARM64 node selector fails scale-from-zero | [AKS #5079](https://github.com/Azure/AKS/issues/5079), 2025-06-12 | source-configuration | H |
| AKS-C047 | Overlay pod-CIDR capacity rejects configured maximum node count | [AKS #4467](https://github.com/Azure/AKS/issues/4467), 2024-08-08 | source-configuration | O |
| AKS-C048 | Default node count lies outside requested autoscaler bounds | [AKS #3513](https://github.com/Azure/AKS/issues/3513), 2023-03-08 | source-configuration | H |
| AKS-C049 | Existing Goldilocks VPA CRDs prevent managed VPA installation | [AKS #4000](https://github.com/Azure/AKS/issues/4000), 2023-11-17 | source-configuration | K |
| AKS-C050 | RuntimeClass scheduling does not trigger Windows scale-from-zero | [AKS #3311](https://github.com/Azure/AKS/issues/3311), 2022-11-04 | version-dependent | H |
| AKS-C051 | Recent deprecated API use blocks AKS upgrade | [AKS #3984](https://github.com/Azure/AKS/issues/3984), 2023-11-07 | mechanism-adaptation | H |
| AKS-C052 | Windows storage/service-endpoint traffic follows unexpected NAT path | [AKS #5349](https://github.com/Azure/AKS/issues/5349), 2025-10-16 | version-dependent | H |
| AKS-C053 | AGC resets a long-running gRPC server stream | [AKS #5195](https://github.com/Azure/AKS/issues/5195), 2025-08-13 | version-dependent | H |
| AKS-C054 | System component disruption budgets block AKS drain | [AKS #3384](https://github.com/Azure/AKS/issues/3384), 2022-12-08 | mechanism-adaptation | K |
| AKS-C055 | Cloning a disk mounted by Windows fails | [AKS #3468](https://github.com/Azure/AKS/issues/3468), 2023-02-09 | source-configuration | H |
| AKS-C056 | Hubble DNS metric lacks the expected query label | [AKS #5723](https://github.com/Azure/AKS/issues/5723), 2026-04-14 | source-configuration | H |
| AKS-C057 | Managed Cilium admission expression rejects ingress-only policy | [AKS #4663](https://github.com/Azure/AKS/issues/4663), 2024-11-19 | version-dependent | K |
| AKS-C058 | CoreDNS upgrade removes stateless Pod reverse-DNS behavior | [AKS #4843](https://github.com/Azure/AKS/issues/4843), 2025-03-06 | pinned-component | K |
| AKS-C059 | Leading-dot custom DNS zone crashes newer CoreDNS | [AKS #3683](https://github.com/Azure/AKS/issues/3683), 2023-05-26 | pinned-component | K |
| AKS-C060 | Istio authorization placement does not restrict an external service as expected | [AKS #4655](https://github.com/Azure/AKS/issues/4655), 2024-11-14 | source-configuration | K |
| AKS-C061 | DNS egress NetworkPolicy crashes Cilium with ACNS FQDN policy | [AKS #4525](https://github.com/Azure/AKS/issues/4525), 2024-09-05 | version-dependent | K |
| AKS-C062 | AGC affinity cookie is scoped inconsistently across paths | [AKS #5805](https://github.com/Azure/AKS/issues/5805), 2026-06-04 | source-configuration | H |
| AKS-C063 | App Routing plus Istio crashes without Gateway API CRDs | [AKS #5914](https://github.com/Azure/AKS/issues/5914), 2026-08-10 | version-dependent | K |
| AKS-C064 | Microsoft ingress image crashes on auth-signin URI escaping | [AKS #5885](https://github.com/Azure/AKS/issues/5885), 2026-08-02 | pinned-component | K |
| AKS-C065 | Azure RBAC Reader lacks HTTPRoute read entitlement | [AKS #5508](https://github.com/Azure/AKS/issues/5508), 2025-12-11 | source-configuration | H |
| AKS-C066 | AGC probes root instead of the backend readiness path | [AKS #5644](https://github.com/Azure/AKS/issues/5644), 2026-03-08 | source-configuration | H |
| AKS-C067 | Azure Load Balancer appProtocol HTTP changes probe behavior | [AKS #3646](https://github.com/Azure/AKS/issues/3646), 2023-05-09 | source-configuration | H |
| AKS-C068 | AGC HTTPRoute wildcard hostname fails matching | [AKS #4713](https://github.com/Azure/AKS/issues/4713), 2024-12-17 | version-dependent | K |
| AKS-C069 | Windows ClientIP session affinity breaks service connectivity | [AKS #3856](https://github.com/Azure/AKS/issues/3856), 2023-08-15 | source-configuration | K |
| AKS-C070 | AGC buffers bidirectional gRPC until client half-close | [AKS #5889](https://github.com/Azure/AKS/issues/5889), 2026-08-04 | version-dependent | H |
| AKS-C071 | Azure Files snapshot restore is blocked by account network restrictions | [azurefile-csi-driver #2121](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/2121), 2024-10-01 | source-configuration | H |
| AKS-C072 | CIFS negotiation fails against AES-256-only Azure Files | [azurefile-csi-driver #2833](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/2833), 2025-10-20 | version-dependent | H |
| AKS-C073 | Inline Azure Files mount ignores account name held in a Secret | [azurefile-csi-driver #3076](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/3076), 2026-04-10 | version-dependent | K |
| AKS-C074 | Private-endpoint SMB identity mount requests the wrong Kerberos SPN | [azurefile-csi-driver #3245](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/3245), 2026-07-07 | source-configuration | H |
| AKS-C075 | Failed snapshot copy leaves an orphaned destination share | [azurefile-csi-driver #3149](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/3149), 2026-05-12 | source-configuration | O |
| AKS-C076 | Storage provisioning conflicts with cross-tenant-replication deny policy | [azurefile-csi-driver #3047](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/3047), 2026-04-03 | source-configuration | H |
| AKS-C077 | Duplicate references to one Azure Files PVC stall Pod initialization | [azurefile-csi-driver #2843](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/2843), 2025-10-31 | source-configuration | K |
| AKS-C078 | Azure Files folderName points to an absent directory | [azurefile-csi-driver #1296](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/1296), 2023-06-08 | source-configuration | H |
| AKS-C079 | Secretless inline CSI mount cannot resolve account from ephemeral handle | [azurefile-csi-driver #2697](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/2697), 2025-07-31 | source-configuration | K |
| AKS-C080 | Private-endpoint provisioning changes subnet network-policy settings | [azurefile-csi-driver #2634](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/2634), 2025-06-27 | source-configuration | O |
| AKS-C081 | Snapshot deletion targets a share instead of the intended snapshot | [azurefile-csi-driver #2561](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/2561), 2025-05-12 | version-dependent | H |
| AKS-C082 | Azure Files mounts retain stale credentials after key rotation | [azurefile-csi-driver #802](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/802), 2021-09-21 | source-configuration | H |
| AKS-C083 | Inline Azure Files secretNamespace lookup uses the Pod namespace | [azurefile-csi-driver #2098](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/2098), 2024-09-09 | source-configuration | K |
| AKS-C084 | Data-plane snapshot creation reports an old creation timestamp | [azurefile-csi-driver #1957](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/1957), 2024-07-07 | version-dependent | H |
| AKS-C085 | Cross-subscription Azure Files mount resolves an incorrect authorization scope | [azurefile-csi-driver #1798](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/1798), 2024-04-04 | source-configuration | H |
| AKS-C086 | Repeated detached-disk expansion leaves PVC and provider sizes inconsistent | [azuredisk-csi-driver #3378](https://github.com/kubernetes-sigs/azuredisk-csi-driver/issues/3378), 2025-10-07 | source-configuration | H |
| AKS-C087 | Static shared disk lacks the CSI attributes required for RWX block use | [azuredisk-csi-driver #2845](https://github.com/kubernetes-sigs/azuredisk-csi-driver/issues/2845), 2025-02-03 | source-configuration | K |
| AKS-C088 | Disk clone is placed in a different zone from its source | [azuredisk-csi-driver #571](https://github.com/kubernetes-sigs/azuredisk-csi-driver/issues/571), 2020-10-16 | source-configuration | H |
| AKS-C089 | Ordinary Azure Disk filesystem PVC requests unsupported RWX mode | [azuredisk-csi-driver #2122](https://github.com/kubernetes-sigs/azuredisk-csi-driver/issues/2122), 2023-12-12 | source-configuration | K |
| AKS-C090 | Remote-region snapshot restore resolves the wrong resource location | [azuredisk-csi-driver #1891](https://github.com/kubernetes-sigs/azuredisk-csi-driver/issues/1891), 2023-06-20 | source-configuration | H |
| AKS-C091 | CSI node disk limit does not reach scheduler correctly | [azuredisk-csi-driver #1842](https://github.com/kubernetes-sigs/azuredisk-csi-driver/issues/1842), 2023-05-10 | version-dependent | H |
| AKS-C092 | Premium SSD v2 receives unsupported default host caching | [azuredisk-csi-driver #1770](https://github.com/kubernetes-sigs/azuredisk-csi-driver/issues/1770), 2023-03-15 | source-configuration | H |
| AKS-C093 | Federated issuer URL mismatch from omitted trailing slash | [azure-workload-identity #1700](https://github.com/Azure/azure-workload-identity/issues/1700), 2026-02-09 | source-configuration | H |
| AKS-C094 | False proxy-injection annotation still injects sidecars | [azure-workload-identity #1210](https://github.com/Azure/azure-workload-identity/issues/1210), 2023-12-18 | pinned-component | K |
| AKS-C095 | Injected identity proxy conflicts with Pod runAsUser policy | [azure-workload-identity #1009](https://github.com/Azure/azure-workload-identity/issues/1009), 2023-06-22 | pinned-component | K |
| AKS-C096 | Identity proxy sidecar prevents Job completion | [azure-workload-identity #773](https://github.com/Azure/azure-workload-identity/issues/773), 2023-03-01 | source-configuration | K |
| AKS-C097 | Proxy injection violates namespace ResourceQuota requirements | [azure-workload-identity #1441](https://github.com/Azure/azure-workload-identity/issues/1441), 2024-08-20 | source-configuration | K |
| AKS-C098 | Webhook reinvocation leaves identity metadata from the previous service account | [azure-workload-identity #1475](https://github.com/Azure/azure-workload-identity/issues/1475), 2024-10-21 | pinned-component | K |
| AKS-C099 | Identity mutation strips native sidecar restartPolicy | [azure-workload-identity #1312](https://github.com/Azure/azure-workload-identity/issues/1312), 2024-04-03 | pinned-component | K |
| AKS-C100 | Identity annotation placed on Service instead of ServiceAccount | [azure-workload-identity #1357](https://github.com/Azure/azure-workload-identity/issues/1357), 2024-05-22 | source-configuration | K |
<!-- AKS-CANDIDATE-INDEX:END -->