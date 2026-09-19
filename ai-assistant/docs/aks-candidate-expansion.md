# AKS Candidate Expansion: Performance, Observability And Energy

Research checkpoint: 2026-09-18. The [structured expansion register](aks-candidate-expansion.json)
adds **150 source-bound candidate designs, AKS-C101 through AKS-C250**, to the
[original 100-candidate research](aks-scenario-research.md). The original register,
generated 100-plan catalogue, reproduction code and scored roster are unchanged.
These are research designs, not new executable scenarios.

## Implementation Follow-Up: 2026-09-19

Nine candidates, C133, C159, C186, C190, C192, C193, C194, C244 and C249, now have authored handlers in the
[full-AKS runner](../evals/docs/aks-end-to-end-authoring.md#c159-expansion-follow-up)
with pinned inputs, explicit evidence controls and owned cleanup. The network
cases distinguish affected-image from healthy-image modes. C159 checks kubenet hairpin
traffic; C192 checks Azure NPM named-port compatibility, including deny-all and
numeric-port controls. C186 checks overlapping CIDR exceptions, C193 additive
allow-policy ordering and backend egress, and C194 completed-Job ipset membership.
C190 compares pod-network and host-network behavior for an empty Service; C133
compares deleted policy objects with retained target DROP rules and traffic.
C244 checks the energy-exporter chart's removed PodSecurityPolicy API using
Helm server dry-runs, not a running collector. C249 compares strict Prometheus 3
scrapes with a scoped fallback protocol and requires readable host RAPL counters.
C133, C190, C244 and C249 have offline lifecycle tests only, not live AKS results.
The other 141 expansion entries have no authored handler. Of these, C243 now
requires re-triage: its reporter closed the issue after finding the example was
wrong, so the original PID-range defect hypothesis must not be treated as confirmed.
The original research snapshot below and its JSON are
unchanged; runtime results are separate, not retroactive changes to research data.
Live validation is now authorized within an explicitly bounded disposable scope.
No new case is admitted to scored evaluation or qualified as a historical fault.
The [live attempt report](../evals/docs/aks-expansion-live-results.md) retains the
failed setups and the C159 healthy-image control outcome. The NPM batch stopped
before workloads because its declared image differed from the managed deployment;
a retry was refused by the original time-budget guard. All trial resources are
deleted. None of this rewrites the historical research classifications below.

The [energy compatibility follow-up](../evals/docs/aks-end-to-end-authoring.md#c244-and-c249-energy-tool-compatibility)
records the source correction, sensor constraints, local Helm capability caveat
and pending server/runtime validation. No watts, joules or energy savings have
been measured by this work.

## Results And Limits

- **99 sources report AKS context; 51 are upstream transfer candidates.** AKS
  context includes explicit environment/image/log evidence in component trackers,
  not just the AKS repository. AKS-Engine, Rancher on VMSS, ARO, EKS, k3s, Docker,
  KVM and bare-metal reports are not silently relabelled managed AKS incidents.
- Repository mix: **75 Azure/AKS, 20 Azure CNI, eight CSI, 17 Inspektor Gadget,
  and 30 Kepler/Scaphandre** reports. Public reports include operators, research
  users, engineering observations and relayed customer incidents. Paying-customer
  identity is not verified; this is not a claim of 150 confirmed customer outages.
- **95 performance-related designs**, **30 energy-related designs**, and **54
  efficiency proxies**. These categories overlap. Performance includes observation
  overhead, startup/attach latency, throughput, resource accounting and misleading
  throttling alerts, not only application benchmarks.
- Provisional evidence labels: **7 K / 77 H / 66 O**. K is Kubernetes-sufficient
  for the stated proximate diagnosis, H is observability-helpful, and O requires
  external evidence for the proposed attribution. Tool necessity is not verified.
- **Zero reproduced, qualified, energy-measured or observability-only verified.**
  No clusters, models or scenario handlers were run. Earlier full-AKS authoring
  remains unverified under the user's existing constraint.

Twenty bounded GitHub searches returned **722 hits**, yielding **534 unique issue
bodies after excluding original admitted URLs**. **199 reports have tracked
body-excerpt/targeted-section decisions: 150 admitted and 49 not admitted**.
Retrieval is not review. Opening/tail excerpts and selected reproduction/platform
sections were reviewed; all middle sections, attachments, comments and later fixes
were not systematically reviewed. Source claims and proposed explanations remain
unverified. Before implementation, read the full thread and confirm current support.

Searches were limited to the first 40 results, sorted by recent update, and are
neither exhaustive nor a prevalence sample. The JSON includes exact queries,
source titles/dates/state/body SHA-256, search-page/archive digests, explicit
non-admission reasons and timing caveats. Cached-page aggregation timestamps are
not exact acquisition times. Raw public-source snapshots remain private to avoid
republishing customer logs and identifiers. Digests establish snapshot provenance,
not truth or reproducibility.

Related mechanisms were compared with the original 100 and with each other.
For example, repeated NVIDIA mismatch reports, overlapping DNS complaints and
the control-plane metrics issue already represented by C013 were not counted
again. Different triggers and diagnostic questions in the same family remain
separate designs. Distinct source URLs do not imply statistically independent bugs.

## How To Use

Read an entry's `trigger`, `oracle`, `recovery`, `requirements`, `feasibility`,
`aksScope`, `energy` and `observability` together. The referenced observability
profile supplies the Kubernetes baseline, proposed additional evidence and tool
limitations. Every entry remains `executionEligible: false`, `qualified: false`
and `reproductionStatus: not-run`. These fields are independent of K/H/O.

Source-bound configurations still have unchecked prerequisites. Conditional cases
have no established bounded trigger; evidence-gap adaptations do not reproduce an
unknown historical initiating cause. Historical versions may be unavailable.
An ordinary current image is a new adaptation, not an exact reproduction.

Suggested next research slices, **not authorization to run them**:

1. CPU and I/O: C101/C102/C109 matched disk tests; C114 collector read attribution;
  C161/C162/C168 alert/throttling/idle-overhead controls. Measure completed work and
   latency, not utilization alone.
2. Network evidence: C129/C130 forwarding and conntrack; C155 enforcement-map
  mismatch; C176-C195 CNI cases. Compare desired Kubernetes state with actual
   per-node enforcement and independently observed traffic.
3. Observer reliability: C204-C220 Gadget cases. Check known workload events,
   collection health, field identity, loss, truncation and sorting before trusting
   a diagnosis. A failed/empty collector must not imply a healthy/idle workload.
4. Energy evidence: C221-C250. Start with schema, scrape and sensor-availability
   checks; hardware calibration and hypervisor experiments need separate access.

The IDs above are index navigation, not a prescribed execution order. Use the
case-specific safety and feasibility gates; a smaller component experiment may
be useful but must be labelled as such.

## Tool And Energy Boundaries

[Inspektor Gadget capabilities](https://inspektor-gadget.io/docs/latest/gadgets/)
suggest CPU/throttle/process, DNS/TCP, block/file I/O, OOM and GPU diagnostics.
These are proposals using current capability names, **not verified commands for
every historical release**. Pin CLI/server/gadget image, kernel/BTF, architecture,
cgroup mode, runtime discovery, privileges and output schema. Use independent
known-event controls. Linux Gadget is not a Windows tracer; Windows cases require
appropriate HNS/ETW/performance telemetry. TCP gadgets do not replace ARP/UDP
header captures. Node traces cannot reveal private managed-control-plane internals.

The [documented limitations](https://inspektor-gadget.io/docs/latest/gadgets/gadget_limitations)
include syscall tracing blind spots for `io_uring` and uprobe limitations for
statically compiled binaries. Missing events, incompatible BPF programs, lost
enrichment and wrong kernel enum decoding are explicit candidates here. Gadget
itself is the subject under test in 17 cases, not their sole ground truth.

[Current Kepler attribution](https://sustainable-computing.io/kepler/usage/power-attribution/)
uses hardware-source energy and CPU-time-proportional workload allocation.
**Host/domain energy can be hardware-derived while workload attribution remains
an estimate.** CPU-time allocation has limitations for heterogeneous instruction
mixes, memory/I/O activity and power states. Historical
[energy-source documentation](https://sustainable-computing.io/archive/design/kepler-energy-sources/)
and legacy model-based deployments must not be mixed with current architecture.

Energy entries distinguish:

- Hardware-reference comparison and sensor-domain availability, including PDU
  versus CPU/package/DRAM boundaries. Ordinary Azure VM guests must not be assumed
  to expose RAPL, MSR, hwmon or the provider's whole-host meter.
- Model-derived energy versus estimated process/container attribution. A model
  must identify its version, inputs, training domain and calibration uncertainty.
- Watts versus joules: integrate power over elapsed seconds; preserve units,
  counter resets, process lifetimes and sample alignment. Never sum overlapping
  domains or use cumulative counters from unmatched windows as conservation proof.
- Unavailable, zero, stale, unparsable and unattributed data as separate states.
  CPU work can contradict an idle diagnosis but cannot supply missing joules.
- CPU/I/O/node-minute/cost proxies, including exporter overhead. These are not
  measured energy savings or carbon reductions. Gadget provides workload context,
  not an energy meter.

Use synthetic workloads, scoped least-privilege collectors, bounded time/data
volume, header-only captures and redaction. Do not collect tokens, private packet
payloads or real process command-line secrets. GPU, large-volume, long-soak,
control-plane-scale and subscription-throttling cases require explicit budget and
isolation gates. No production fault injection or destructive shared-node cleanup.

## Research Backlog

- Done: bounded collection, 199 tracked excerpt/section reviews, 150 proposed
  designs, provenance/non-admission ledger, source-scope and evidence classification.
- Done: research-data count/uniqueness/hash/field checks only, not scenario tests.
- Pending: full thread/fix review, prerequisite availability and managed AKS
  portability for upstream cases; minimize conditional triggers.
- Pending: exact workload/image pinning, independent oracle, negative/healthy
  control, resource/time/cost caps and owned-cleanup plan for each selected case.
- Pending: separately authorized implementation and reproduction; then matched
  Kubernetes-only/augmented diagnosis experiments with failures retained and no
  answer repair or retrospective oracle changes.
- Pending: demonstrate energy-source validity and uncertainty before any energy
  comparison, and demonstrate diagnostic benefit before promoting a tool profile.

## Candidate Index

The full per-case experiment and evidence plans are in the JSON register. `AKS`
means reported AKS context, not a verified AKS bug. `Upstream` means proposed
transfer with managed-AKS applicability still unverified.

<!-- candidate-index -->

| ID | Report-Bound Candidate | Source Scope | Evidence | Family |
| --- | --- | --- | --- | --- |
| AKS-C101 | [Write latency rises after the 5.15-to-6.8 AKS kernel transition](https://github.com/Azure/AKS/issues/5849) | AKS | O | io |
| AKS-C102 | [Large NVMe readahead amplifies random-read traffic](https://github.com/Azure/AKS/issues/5743) | AKS | O | io |
| AKS-C103 | [In-cluster Kubernetes API calls intermittently stall on an SLA cluster](https://github.com/Azure/AKS/issues/3047) | AKS | O | api |
| AKS-C104 | [Windows SQL connection churn fails while a Linux client succeeds](https://github.com/Azure/AKS/issues/5483) | AKS | H | network |
| AKS-C105 | [Cobalt ephemeral-disk provisioning reports zero usable placement capacity](https://github.com/Azure/AKS/issues/5568) | AKS | O | lifecycle |
| AKS-C106 | [Containerd CRI stalls while the node remains Ready](https://github.com/Azure/AKS/issues/5878) | AKS | O | lifecycle |
| AKS-C107 | [Metrics-server scrape timeouts remove scaling input under load](https://github.com/Azure/AKS/issues/5520) | AKS | H | cpu |
| AKS-C108 | [Disk queue tuning targets absent sda on NVMe nodes](https://github.com/Azure/AKS/issues/5485) | AKS | H | io |
| AKS-C109 | [Ephemeral AKS OS disk underperforms a matched VM](https://github.com/Azure/AKS/issues/3787) | AKS | O | io |
| AKS-C110 | [Azure snapshot exists well before VolumeSnapshot becomes ready](https://github.com/Azure/AKS/issues/4555) | AKS | O | storage |
| AKS-C111 | [Unattributed API request bursts coincide with cluster timeouts](https://github.com/Azure/AKS/issues/3685) | AKS | O | api |
| AKS-C112 | [Redis exec liveness probes intermittently time out after upgrade](https://github.com/Azure/AKS/issues/4219) | AKS | H | cpu |
| AKS-C113 | [Blob mount initially lists empty before files become visible](https://github.com/Azure/AKS/issues/4112) | AKS | H | storage |
| AKS-C114 | [Hourly AKS log collection coincides with read saturation](https://github.com/Azure/AKS/issues/5465) | AKS | O | io |
| AKS-C115 | [Windows node CPU appears lower than its pod CPU sum](https://github.com/Azure/AKS/issues/4028) | AKS | H | cpu |
| AKS-C116 | [NAP continually replaces nodes marked Kubernetes-version drifted](https://github.com/Azure/AKS/issues/5899) | AKS | K | scheduling |
| AKS-C117 | [NAP and scheduler disagree on capacity with pod-level resources](https://github.com/Azure/AKS/issues/5499) | AKS | H | scheduling |
| AKS-C118 | [Autoscaler misses ACStor NVMe ephemeral capacity](https://github.com/Azure/AKS/issues/5403) | AKS | H | scheduling |
| AKS-C119 | [ALB controller image lacks the requested ARM64 platform](https://github.com/Azure/AKS/issues/5390) | AKS | H | lifecycle |
| AKS-C120 | [Eraser cleaner is OOM-killed at its managed memory limit](https://github.com/Azure/AKS/issues/5376) | AKS | H | memory |
| AKS-C121 | [Resource pressure triggers a Cilium restart and probe-restart loop](https://github.com/Azure/AKS/issues/5305) | AKS | H | network |
| AKS-C122 | [ElasticSAN CSI driver fails during node upgrade at higher volume count](https://github.com/Azure/AKS/issues/4863) | AKS | H | memory |
| AKS-C123 | [NAP regional-node requirements unexpectedly restrict available SKUs](https://github.com/Azure/AKS/issues/5574) | AKS | H | scheduling |
| AKS-C124 | [AGC TLS policy rejects documented RSA-CBC negotiation](https://github.com/Azure/AKS/issues/5966) | AKS | O | network |
| AKS-C125 | [Kubernetes RBAC admin cannot perform a managed-identity AKS update](https://github.com/Azure/AKS/issues/4980) | AKS | O | identity |
| AKS-C126 | [Managed Prometheus repeatedly restarts behind private connectivity](https://github.com/Azure/AKS/issues/5229) | AKS | H | dns |
| AKS-C127 | [Private-cluster NAP enablement is rejected by public-network validation](https://github.com/Azure/AKS/issues/5586) | AKS | H | lifecycle |
| AKS-C128 | [Entra group access differs from direct-user cluster access](https://github.com/Azure/AKS/issues/5552) | AKS | H | identity |
| AKS-C129 | [Long-lived TCP connections stall through a draining intermediate node](https://github.com/Azure/AKS/issues/5038) | AKS | O | network |
| AKS-C130 | [Observed conntrack capacity differs from the documented default](https://github.com/Azure/AKS/issues/5529) | AKS | O | network |
| AKS-C131 | [CephFS-enabled nodes panic in the netfs kernel path](https://github.com/Azure/AKS/issues/4726) | AKS | O | io |
| AKS-C132 | [Custom conntrack maximum is overwritten after node startup](https://github.com/Azure/AKS/issues/3051) | AKS | H | network |
| AKS-C133 | [Deleted NetworkPolicy leaves blocking rules on one node](https://github.com/Azure/AKS/issues/2225) | AKS | O | policy |
| AKS-C134 | [Service DNS lookup delay appears in 2.5-second increments](https://github.com/Azure/AKS/issues/1657) | AKS | H | dns |
| AKS-C135 | [Windows prepared-image caching exceeds the internal build timeout](https://github.com/Azure/AKS/issues/5919) | AKS | O | lifecycle |
| AKS-C136 | [Windows upgrade removes capacity before large-image workloads start](https://github.com/Azure/AKS/issues/4047) | AKS | H | lifecycle |
| AKS-C137 | [AKS drain retries an admission-denied eviction after the pod moves](https://github.com/Azure/AKS/issues/4720) | AKS | H | lifecycle |
| AKS-C138 | [Host messages grow faster than rotation and cause DiskPressure](https://github.com/Azure/AKS/issues/2802) | AKS | H | io |
| AKS-C139 | [Snapshot-limit retries amplify storage control-plane requests](https://github.com/Azure/AKS/issues/4394) | AKS | O | storage |
| AKS-C140 | [A10 CUDA workload slows severely after several minutes](https://github.com/Azure/AKS/issues/4868) | AKS | O | gpu |
| AKS-C141 | [Managed Prometheus target operator memory grows until OOM](https://github.com/Azure/AKS/issues/4509) | AKS | H | memory |
| AKS-C142 | [CPU-bound workloads slow after a node OS/kernel change](https://github.com/Azure/AKS/issues/3969) | AKS | O | cpu |
| AKS-C143 | [Autoscaler overprovisions while new nodes are still becoming Ready](https://github.com/Azure/AKS/issues/4136) | AKS | H | scheduling |
| AKS-C144 | [Windows CNS pre-pull version mismatch adds node startup delay](https://github.com/Azure/AKS/issues/4082) | AKS | H | lifecycle |
| AKS-C145 | [Cluster-create operation reports failure before the resource later succeeds](https://github.com/Azure/AKS/issues/1972) | AKS | O | lifecycle |
| AKS-C146 | [A10 node image contains mismatched NVIDIA kernel and user-space drivers](https://github.com/Azure/AKS/issues/5860) | AKS | H | gpu |
| AKS-C147 | [NVIDIA DRA feature validation rejects the available GRID driver](https://github.com/Azure/AKS/issues/5785) | AKS | H | gpu |
| AKS-C148 | [Azure Linux GPU validation misclassifies the outbound configuration](https://github.com/Azure/AKS/issues/5684) | AKS | O | lifecycle |
| AKS-C149 | [Ready spot nodes emit recurring IMDS timeout events](https://github.com/Azure/AKS/issues/4757) | AKS | H | network |
| AKS-C150 | [A scaled-to-zero pool cannot bootstrap from an aged image](https://github.com/Azure/AKS/issues/5567) | AKS | O | lifecycle |
| AKS-C151 | [Deallocate-mode provisioning failure does not trigger autoscaler fallback](https://github.com/Azure/AKS/issues/5589) | AKS | O | scheduling |
| AKS-C152 | [GPU ephemeral pool requests unsupported CacheDisk placement](https://github.com/Azure/AKS/issues/5602) | AKS | O | lifecycle |
| AKS-C153 | [Managed Cilium operator can land on user-pool nodes](https://github.com/Azure/AKS/issues/5711) | AKS | K | scheduling |
| AKS-C154 | [Workload-identity admission returns EOF after a node-image upgrade](https://github.com/Azure/AKS/issues/4139) | AKS | H | network |
| AKS-C155 | [Cilium reports healthy endpoints with empty enforcement maps](https://github.com/Azure/AKS/issues/5969) | AKS | O | policy |
| AKS-C156 | [Dapr extension update has no Windows sidecar image](https://github.com/Azure/AKS/issues/5900) | AKS | H | lifecycle |
| AKS-C157 | [Retired Istio revision leaves stale leader-election Leases](https://github.com/Azure/AKS/issues/5862) | AKS | K | lifecycle |
| AKS-C158 | [ArgoCD extension image lacks the enabled commit-server binary](https://github.com/Azure/AKS/issues/5850) | AKS | H | lifecycle |
| AKS-C159 | [Kubenet service hairpin fails after the Ubuntu 24.04 upgrade](https://github.com/Azure/AKS/issues/5669) | AKS | H | network |
| AKS-C160 | [Eraser startup skips nodes temporarily absent during upgrade](https://github.com/Azure/AKS/issues/5580) | AKS | K | lifecycle |
| AKS-C161 | [Extension-agent throttling produces noise without demonstrated service loss](https://github.com/Azure/AKS/issues/4831) | AKS | H | cpu |
| AKS-C162 | [Monitoring sidecar consumes CPU on nearly empty nodes](https://github.com/Azure/AKS/issues/5380) | AKS | H | cpu |
| AKS-C163 | [Flux extension log volume reaches its new EmptyDir limit](https://github.com/Azure/AKS/issues/5607) | AKS | H | io |
| AKS-C164 | [Managed Prometheus collector DNS failure precedes restart](https://github.com/Azure/AKS/issues/4672) | AKS | H | dns |
| AKS-C165 | [Managed Prometheus image pull is throttled with HTTP 429](https://github.com/Azure/AKS/issues/4279) | AKS | H | lifecycle |
| AKS-C166 | [Secrets-store registrar is throttled at its small CPU limit](https://github.com/Azure/AKS/issues/2972) | AKS | H | cpu |
| AKS-C167 | [Large artifact I/O causes unexpected container OOM kills](https://github.com/Azure/AKS/issues/2390) | AKS | O | memory |
| AKS-C168 | [Tunnel-front CPU exceeds its request without a proved failure](https://github.com/Azure/AKS/issues/2344) | AKS | H | cpu |
| AKS-C169 | [Custom-controller requests wait in client throttling](https://github.com/Azure/AKS/issues/2155) | AKS | H | api |
| AKS-C170 | [OS-disk IOPS saturation destabilizes node services](https://github.com/Azure/AKS/issues/1373) | AKS | O | io |
| AKS-C171 | [Azure Files copy errors leave locked server handles](https://github.com/Azure/AKS/issues/1593) | AKS | O | storage |
| AKS-C172 | [Alpine directory operations fail above a reported SMB entry threshold](https://github.com/Azure/AKS/issues/1325) | AKS | H | storage |
| AKS-C173 | [Disk-heavy scale-down hits VMSS high-cost request throttling](https://github.com/Azure/AKS/issues/1187) | AKS | O | storage |
| AKS-C174 | [ACR pull access through an Entra group lags a direct role grant](https://github.com/Azure/AKS/issues/4275) | AKS | O | identity |
| AKS-C175 | [Heterogeneous pools concentrate work on the smallest pool during maintenance](https://github.com/Azure/AKS/issues/5671) | AKS | H | scheduling |
| AKS-C176 | [Sandbox recreation leaks CNS IP assignments until allocation stops](https://github.com/Azure/azure-container-networking/issues/4497) | Upstream | O | network |
| AKS-C177 | [Dynamic Pod Subnet traffic follows node routes instead of expected pod routes](https://github.com/Azure/azure-container-networking/issues/3204) | Upstream | O | network |
| AKS-C178 | [CNS cannot watch ClusterSubnetState after a control-plane update](https://github.com/Azure/azure-container-networking/issues/3063) | Upstream | K | identity |
| AKS-C179 | [NPM selects legacy iptables after a transient nft detection failure](https://github.com/Azure/azure-container-networking/issues/3094) | AKS | O | policy |
| AKS-C180 | [Leaked ipset references keep NPM in a startup crash loop](https://github.com/Azure/azure-container-networking/issues/2997) | Upstream | H | policy |
| AKS-C181 | [Selected node-to-pod routes loop packets back to the sender](https://github.com/Azure/azure-container-networking/issues/2672) | AKS | O | network |
| AKS-C182 | [Multus secondary interface cannot allocate an Azure CNI pool](https://github.com/Azure/azure-container-networking/issues/1132) | Upstream | H | network |
| AKS-C183 | [Concurrent Windows pod starts fail CNI state initialization](https://github.com/Azure/azure-container-networking/issues/1918) | AKS | H | network |
| AKS-C184 | [Dynamic IP monitoring counts 17 addresses at the initial allocation](https://github.com/Azure/azure-container-networking/issues/2462) | AKS | H | network |
| AKS-C185 | [CNS restart reuses an IP already held by a running pod](https://github.com/Azure/azure-container-networking/issues/1259) | AKS | O | network |
| AKS-C186 | [Overlapping ipBlock exceptions violate additive policy expectations](https://github.com/Azure/azure-container-networking/issues/558) | AKS | O | policy |
| AKS-C187 | [Azure CNI transparent mode adds ARP resolution latency](https://github.com/Azure/azure-container-networking/issues/778) | Upstream | O | network |
| AKS-C188 | [IPVS Service addresses time out with the source Azure CNI setup](https://github.com/Azure/azure-container-networking/issues/447) | Upstream | H | network |
| AKS-C189 | [CNI propagates only part of a custom DNS server list](https://github.com/Azure/azure-container-networking/issues/713) | Upstream | H | dns |
| AKS-C190 | [An endpoint-less Service hangs instead of rejecting promptly under NPM](https://github.com/Azure/azure-container-networking/issues/569) | Upstream | H | network |
| AKS-C191 | [Cross-node ARP replies carry an unexpected destination MAC](https://github.com/Azure/azure-container-networking/issues/486) | AKS | O | network |
| AKS-C192 | [Named-port policy unexpectedly permits an unlisted numeric port](https://github.com/Azure/azure-container-networking/issues/550) | AKS | H | policy |
| AKS-C193 | [A second additive allow policy blocks previously allowed traffic](https://github.com/Azure/azure-container-networking/issues/554) | AKS | O | policy |
| AKS-C194 | [Completed Job pod IPs remain in NPM policy sets](https://github.com/Azure/azure-container-networking/issues/428) | AKS | O | policy |
| AKS-C195 | [UDP traffic through a public load balancer is duplicated](https://github.com/Azure/azure-container-networking/issues/525) | AKS | O | network |
| AKS-C196 | [Windows 2025 SMB mapping reports conflicting connections](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/2974) | AKS | H | storage |
| AKS-C197 | [Azure Files unmount failures repeatedly flood kubelet logs](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/3218) | AKS | H | storage |
| AKS-C198 | [Rate-limited snapshot requests leave duplicate Azure Files snapshots](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/2569) | Upstream | O | storage |
| AKS-C199 | [Windows SMB unmapping blocks new volume mounts](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/1925) | AKS | O | storage |
| AKS-C200 | [Requested NFS share SKU silently becomes a different redundancy tier](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/1480) | Upstream | O | storage |
| AKS-C201 | [Stacked Azure Files stage mounts survive workload deletion](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/1137) | AKS | O | storage |
| AKS-C202 | [Force-detach fallback correlates with broken VMSS reimage bootstrap](https://github.com/kubernetes-sigs/azuredisk-csi-driver/issues/3692) | Upstream | O | storage |
| AKS-C203 | [Rapid PV/PVC deletion leaves a provider disk behind](https://github.com/kubernetes-sigs/azuredisk-csi-driver/issues/1750) | Upstream | O | storage |
| AKS-C204 | [Gadget image enrichment and filters lose short-lived container identity](https://github.com/inspektor-gadget/inspektor-gadget/issues/4127) | AKS | H | tracing |
| AKS-C205 | [Traceloop retrieval exceeds the transport message size](https://github.com/inspektor-gadget/inspektor-gadget/issues/2868) | Upstream | H | tracing |
| AKS-C206 | [Gadget cannot discover pods through the source container runtime endpoint](https://github.com/inspektor-gadget/inspektor-gadget/issues/2876) | Upstream | H | tracing |
| AKS-C207 | [Long-running exec observation reaches fanotify file limits](https://github.com/inspektor-gadget/inspektor-gadget/issues/2967) | Upstream | H | tracing |
| AKS-C208 | [Exec path tracing exceeds a small collector memory budget](https://github.com/inspektor-gadget/inspektor-gadget/issues/2821) | Upstream | H | tracing |
| AKS-C209 | [Failed exec churn fills the container-hook map and loses startup events](https://github.com/inspektor-gadget/inspektor-gadget/issues/2789) | Upstream | O | tracing |
| AKS-C210 | [High-volume traceloop fails while stopping its WASM operator](https://github.com/inspektor-gadget/inspektor-gadget/issues/4751) | AKS | H | tracing |
| AKS-C211 | [Concurrent container add/remove events panic Gadget kubemanager](https://github.com/inspektor-gadget/inspektor-gadget/issues/5507) | Upstream | H | tracing |
| AKS-C212 | [Gadget packet capture omits some egress observations](https://github.com/inspektor-gadget/inspektor-gadget/issues/5022) | AKS | O | tracing |
| AKS-C213 | [Backported kernel drop-reason enum produces wrong Gadget attribution](https://github.com/inspektor-gadget/inspektor-gadget/issues/1847) | AKS | O | tracing |
| AKS-C214 | [Capability tracing fails BPF verification on the reported AKS kernel](https://github.com/inspektor-gadget/inspektor-gadget/issues/4093) | AKS | H | tracing |
| AKS-C215 | [Container exits before delayed event enrichment resolves its identity](https://github.com/inspektor-gadget/inspektor-gadget/issues/1178) | Upstream | O | tracing |
| AKS-C216 | [DNS latency filter compares duration values incorrectly](https://github.com/inspektor-gadget/inspektor-gadget/issues/2752) | AKS | H | tracing |
| AKS-C217 | [Kernel structure change breaks bind gadget CO-RE relocation](https://github.com/inspektor-gadget/inspektor-gadget/issues/2519) | Upstream | H | tracing |
| AKS-C218 | [ARM64 AKS open tracing loses the file-path field](https://github.com/inspektor-gadget/inspektor-gadget/issues/827) | AKS | H | tracing |
| AKS-C219 | [Multi-node top output ranks rows only within nodes](https://github.com/inspektor-gadget/inspektor-gadget/issues/1733) | AKS | H | tracing |
| AKS-C220 | [Snapshot gadgets fail because the node kernel lacks required iterators](https://github.com/inspektor-gadget/inspektor-gadget/issues/930) | AKS | H | tracing |
| AKS-C221 | [Idle-power attribution changes the apparent benefit of CPU power management](https://github.com/sustainable-computing-io/kepler/issues/1194) | Upstream | O | energy |
| AKS-C222 | [Cloud VM workload energy is zero while system metrics remain nonzero](https://github.com/sustainable-computing-io/kepler/issues/1310) | Upstream | O | energy |
| AKS-C223 | [Short power spikes exceed the plausible physical host budget](https://github.com/sustainable-computing-io/kepler/issues/1344) | Upstream | O | energy |
| AKS-C224 | [Kepler aggregate power differs substantially from a PDU](https://github.com/sustainable-computing-io/kepler/issues/1349) | Upstream | O | energy |
| AKS-C225 | [A pretrained power-model response crashes the legacy estimator](https://github.com/sustainable-computing-io/kepler/issues/1476) | Upstream | H | energy |
| AKS-C226 | [Core-energy counters stay zero on a RAPL-reporting dual-socket server](https://github.com/sustainable-computing-io/kepler/issues/1675) | Upstream | O | energy |
| AKS-C227 | [One process spanning several cgroups loses part of its energy attribution](https://github.com/sustainable-computing-io/kepler/issues/1813) | Upstream | O | energy |
| AKS-C228 | [A namespace dynamic-energy sum exceeds the reported platform series](https://github.com/sustainable-computing-io/kepler/issues/1833) | Upstream | O | energy |
| AKS-C229 | [Process package-energy totals diverge from node package energy](https://github.com/sustainable-computing-io/kepler/issues/1837) | Upstream | O | energy |
| AKS-C230 | [Ampere hwmon power does not integrate to the exported energy](https://github.com/sustainable-computing-io/kepler/issues/2062) | Upstream | O | energy |
| AKS-C231 | [Energy monitoring rollout increases API-server memory pressure at scale](https://github.com/sustainable-computing-io/kepler/issues/2366) | Upstream | O | energy |
| AKS-C232 | [Guaranteed-QoS cgroup layout is omitted from energy attribution](https://github.com/sustainable-computing-io/kepler/issues/2354) | Upstream | H | energy |
| AKS-C233 | [Kepler cannot start because a virtual node exposes no RAPL zones](https://github.com/sustainable-computing-io/kepler/issues/2280) | Upstream | H | energy |
| AKS-C234 | [Isolated-core DPDK workloads are absent from energy metrics](https://github.com/sustainable-computing-io/kepler/issues/1165) | Upstream | O | energy |
| AKS-C235 | [One unreadable process executable suppresses all power export](https://github.com/sustainable-computing-io/kepler/issues/2518) | Upstream | H | energy |
| AKS-C236 | [Kepler architecture migration removes metrics expected by existing dashboards](https://github.com/sustainable-computing-io/kepler/issues/2363) | Upstream | H | energy |
| AKS-C237 | [ARM DRAM metric remains zero despite memory-intensive work](https://github.com/sustainable-computing-io/kepler/issues/1345) | Upstream | O | energy |
| AKS-C238 | [Namespaced container labels make energy metrics unparsable](https://github.com/hubblo-org/scaphandre/issues/439) | Upstream | H | energy |
| AKS-C239 | [Containers started after exporter launch lack identity labels](https://github.com/hubblo-org/scaphandre/issues/437) | Upstream | H | energy |
| AKS-C240 | [Per-process estimates disagree despite matching host energy totals](https://github.com/hubblo-org/scaphandre/issues/436) | Upstream | O | energy |
| AKS-C241 | [Frequent scrapes freeze Scaphandre energy refresh](https://github.com/hubblo-org/scaphandre/issues/434) | Upstream | H | energy |
| AKS-C242 | [QEMU exporter writes power as energy without the interval factor](https://github.com/hubblo-org/scaphandre/issues/428) | Upstream | O | energy |
| AKS-C243 | [Energy process selection rejects valid high PIDs](https://github.com/hubblo-org/scaphandre/issues/425) | Upstream | K | energy |
| AKS-C244 | [Energy-exporter Helm install requests a removed PodSecurityPolicy API](https://github.com/hubblo-org/scaphandre/issues/321) | Upstream | K | energy |
| AKS-C245 | [Multithreaded VM process power attribution is asymmetric](https://github.com/hubblo-org/scaphandre/issues/335) | Upstream | O | energy |
| AKS-C246 | [Powercap files exist on the host but are missing inside the exporter](https://github.com/hubblo-org/scaphandre/issues/386) | Upstream | H | energy |
| AKS-C247 | [Cgroup-v2 container paths lose Scaphandre identity attribution](https://github.com/hubblo-org/scaphandre/issues/420) | Upstream | H | energy |
| AKS-C248 | [Long process command labels exceed Prometheus scrape limits](https://github.com/hubblo-org/scaphandre/issues/416) | Upstream | H | energy |
| AKS-C249 | [Prometheus 3 rejects energy metrics with a blank Content-Type](https://github.com/hubblo-org/scaphandre/issues/400) | Upstream | H | energy |
| AKS-C250 | [Stopping the JSON exporter leaves truncated energy evidence](https://github.com/hubblo-org/scaphandre/issues/359) | Upstream | H | energy |
