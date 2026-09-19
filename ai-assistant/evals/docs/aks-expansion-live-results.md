# AKS Expansion Validation: Initial Network Cases

Date: 2026-09-19. Implementation follow-up to the
[150-candidate research expansion](../../docs/aks-candidate-expansion.md).

Nine additional candidates have authored handlers: C133 deleted-policy state,
C159 kubenet hairpin, C186 CIDR exception overlap, C190 endpoint-less Services,
C192 named ports, C193 additive allow policies and C194 completed-Job ipset
membership, plus C244 removed chart API and C249 exporter Content-Type.
The other 141 expansion candidates have no handler; C243 requires re-triage
after the reporter withdrew the original explanation. No case is a qualified historical reproduction or admitted
scored scenario. The original 100-plan catalogue and research registers remain
unchanged. No model evaluation, diagnostic accuracy or energy savings are claimed.

## C159 Attempts

| Attempt | Setup | Traffic Check | Recovery Control | Cleanup |
| --- | --- | --- | --- | --- |
| 1 | Failed after AKS creation: requested admin kubeconfig context absent | Not run | Not run | Both owned resource groups independently absent |
| 2, explicit setup retry | Passed after context normalization repair | 20/20 HTTP requests succeeded; all six self-Service calls healthy | Selecting a non-self backend restored/retained successful routing | Both owned resource groups independently absent |

Attempt 1 ran from 09:51:25.987 to 10:03:13.744 UTC (11.80 minutes, excluding
the launcher's additional absence queries). It remains a failed
setup attempt, not a failed application diagnosis, and was not overwritten.
The runner previously assumed `az aks get-credentials --admin --context ...`
produced exactly that context name. The fix checks the fresh private kubeconfig
has one context, checks its HTTPS endpoint matches the newly created AKS cluster,
then renames it locally. Credentials and SSH keys are not published.

The retry began at 10:04:41.234 UTC only after the original setup failed and cleanup
passed, with independent absence checks repeated before new creation. Its
traffic observations passed between 10:10 and 10:12 UTC. Three paired self-call
checks use the Service IP and Service DNS name, while separate-client and
loopback checks continue to work. Recorded raw curl exit codes and nginx response
content were independently checked, rather than trusting phase labels alone.
Cleanup completed at 10:17:44.998 UTC, for a 13.06-minute lifecycle before the
launcher's additional absence queries. Both attempts and cleanup finished within
27 minutes of the first start. A final independent Azure lookup confirms all
four exact owned resource groups absent; no trial resources remain running.

Both attempts use fresh, owner-tagged resources in the authorized Cloud Native
Tools subscription, West Europe. Existing clusters are not modified. The only
node is `Standard_D2as_v6` (2 vCPU, 8 GB RAM), with a requested 32 GiB managed OS disk, kubenet,
AKS 1.35.7, node image `AKSUbuntu-2404gen2containerd-202609.03.1`,
Ubuntu 24.04.4 LTS and kernel `6.8.0-1067-azure`. The local kubectl is 1.36.1,
within the supported one-minor skew. No optional paid monitoring or model calls
are enabled. Standard LB/IP, disk and transfer charges may still apply.
Both provider snapshots confirm the Free AKS tier and disabled autoscaling.

Workload image manifests are pinned for Linux/amd64:

- nginx: `sha256:0dcc88822d45581e65ae329f8be769762bf628d3b2bb7d2a077d4aa5c98b30e3`
- curl: `sha256:5a91ea0c9c3ee27b4abe657b68cf6bf0676afa13b236b3bda34283cb3924d4f6`

The original and alternate backend Pods' runtime image IDs match these pinned
manifests; their probe/server containers were Ready with zero restarts at capture.

The source [AKS issue 5669](https://github.com/Azure/AKS/issues/5669) was read
with its follow-up comments. Its 2026-08-29 comment reports a fix in node image
`202608.14.0`. Both attempts explicitly requested `healthy-control`, never an
automatically selected expectation. The generic runner calls the observation
phase `fault`, but the evidence says `faultObserved: false`. A passing phase
does not mean the old fault was reproduced.

The probe is a curl sidecar in the nginx Pod, sharing its network namespace.
This preserves the self-Service routing mechanism but is not the source's exact
unpinned nginx container. Recovery selects a separate backend, not an in-place
kernel fix or the source's privileged hairpin-mode DaemonSet. No host networking
settings were changed and no historical affected node image was deployed.

## Budget And Evidence

The operator approved the same subscription/region with a modestly increased
budget. This batch uses a **US$15 operating budget**, a two-hour window including
cleanup, and one node at a time. The retry retains the original 75-minute
active-work deadline rather than resetting it. The regular Linux VM rate checked
was US$0.11/hour, or US$0.22 for two full node-hours before other charges. Actual
invoiced cost is unknown; billing is delayed and this is not an Azure-enforced
spending cap. There were no GPU, storage-share or secondary-cluster workloads.

Private evidence roots are `.tmp/pr25-c159-live-20260919` and
`.tmp/pr25-c159-live-20260919-retry-setup` under the workspace. They contain
preflight decisions, source comments, command journals, manifests, per-probe
responses, environment metadata, phase state and independent cleanup receipts.
They also contain credentials and must not be committed or shared wholesale.
The public report intentionally omits subscription IDs and cluster endpoints.
Each root now has a `completed-resource-audit.json` recording final absence
queries and hashes for selected evidence files (five for the failed setup and
38 for the completed retry), excluding kubeconfig and SSH keys. An earlier
intermediate audit showing resources still deleting is retained, not overwritten.

## NPM Batch Attempt

After C159, a four-case sequential batch was prepared for C192, C186, C193 and
C194 in fresh owner-tagged namespaces on one new AKS node. It reused the same
subscription, West Europe, Standard_D2as_v6, AKS 1.35.7 and exact Ubuntu 24.04
node image, with Azure CNI and Azure NPM instead of kubenet. All expectations
were declared `healthy-control` before provisioning. Cases stop on the first
failure; an untouched later case remains `not-run`.

| Stage | Outcome |
| --- | --- |
| Provisioning | New one-node AKS cluster created successfully |
| C192 environment gate | Failed before workloads: expected NPM v1.6.42, observed v1.6.48-0 |
| C192 baseline, fault and recovery | Not run; no policy behavior evaluated |
| C186, C193, C194 | Not run because the batch stopped at the first setup failure |
| Cleanup | Both exact owned resource groups independently confirmed absent |
| Explicit image-pin retry | Refused before provisioning by the original deadline guard; no new resources |

The failed lifecycle started **10:29:33.695 UTC** and finished cleanup at
**10:40:05.582 UTC**; the launcher's further independent absence receipt is dated
**10:40:17.123 UTC**. This is preserved as a setup failure, not an NPM defect or
a successful healthy-control run. Zero models were invoked.

The first expected image came from the latest published
[Ubuntu 24.04 cache manifest](https://github.com/Azure/AKS/blob/master/vhd-notes/aks-ubuntu/AKSUbuntu-2404/202608.26.0.txt).
AKS actually deployed a newer image. The strict match was not bypassed. An
explicit retry was prepared using the retained, pre-workload v1.6.48-0 evidence,
but the launcher required at least 25 minutes before the original 75-minute
active-work deadline and refused to create another cluster. The US$15 aggregate
operating budget and original two-hour window were not reset. Actual billing
remains unknown; all created compute and networking resources are deleted.

Private evidence is retained in `.tmp/pr25-npm-live-20260919`: source comments,
the declared preflight, command journal showing the actual NPM image, per-case
statuses, the failed state, and independent cleanup receipt. A final
`completed-resource-audit.json` hashes ten selected non-credential evidence files
and records another independent Azure absence check. Kubeconfig, keys and raw
cluster evidence remain private. The `-retry-image` resource/evidence directory
was never created. The prior C159 attempt records are unchanged.

## Policy Qualification Gates

### Offline C133 And C190 Follow-Up

After publishing the initial five handlers, C133 and C190 were added and tested
offline. No new cloud resources or model calls were made and no live results are
claimed for either. The prior attempt tables and saved evidence are unchanged.

C190 compares a pod-network client with a host-network client for an empty
Service, with structured curl timing, explicit refusal versus timeout and a
real-backend recovery control. C133 compares deleted policy objects with retained
target DROP rules, stable NPM identity and controlled traffic. Its intermittent
source trigger remains unestablished, and its historical final-phase control is
explicitly not a repair of the affected backend. Full details and prerequisites
are in the [authoring guide](aks-end-to-end-authoring.md#c133-and-c190-offline-follow-up).

Both cases use pinned images and remain mechanism adaptations with qualification
pending. Their injected tests cover healthy and conditional fault observations,
collection errors, unrelated rules, endpoint-state mismatch and failed independent
controls. Those tests do not demonstrate a real kernel/network defect or current
AKS behavior.

### Offline Energy Compatibility Follow-Up

C244 and C249 were authored after the network batch, with ten additional offline
tests. Neither has a live result. C244 provisions through the owned-AKS runner
but its chart operation is a server dry-run, not a running exporter. C249 requires
an actual readable RAPL source, a working exporter and paired Prometheus 3.0.0
scrapes before the Content-Type comparison can qualify. The latter may be blocked
on ordinary AKS VM nodes that do not expose hardware counters.

The full source replies and adjacent implementations were reviewed. Local Helm
rendering of the exact affected and fixed charts produced PSP in both, because
offline default API capabilities still include the removed API; only the fixed
chart has the capability guard. The failed initial local expectation is retained
as a limitation, not relabelled a successful live fix. No exporter image was
pulled or run and the local render used a placeholder digest. Server discovery
and actual chart API mapping remain untested.

The [energy authoring guide](aks-end-to-end-authoring.md#c244-and-c249-energy-tool-compatibility)
records input pins, host-mount permissions, exact controls and measurement limits.
It also records C243's source correction: the reporter closed the issue because
the example was wrong. No PID-range implementation was added. The original JSON
research snapshot and earlier live attempts remain unchanged.

### Remaining Cases

C192 has local implementation tests and the setup-blocked attempt above. Its
[source report](https://github.com/Azure/azure-container-networking/issues/550)
and maintainer reply establish that named ports were unsupported in the reported
NPM v1.0.33 release. The handler gates the exact managed NPM and node images,
checks two open ports, deny-all, numeric-port enforcement, then named-port
behavior and numeric-rule recovery. It records managed pod image IDs without
claiming that a mutable tag is a digest lock. The modern API/nginx fixture is a
documented mechanism adaptation. No AKS validation of C192 is claimed.

The new C186/C193/C194 handlers and their source caveats are documented in the
[authoring guide](aks-end-to-end-authoring.md#c186-c193-and-c194-policy-cases).
Their oracles cover policy union rather than ordered deny-rule semantics, both
policy insertion orders, backend egress, and completion-before-deletion state.
They do not run large-scale stress, force IP reuse, restart NPM or flush rules.

Offline verification: **444 eval tests pass**, including 34 focused expansion
tests; `npm run tsc` passes. Typechecking also exposed one missing brace in a
previously authored Windows container spec, repaired to permit registry imports.
That repair and a green test suite do not validate the original 89 live paths.
A private launcher self-check also confirms that the active-work deadline can
refuse new workload commands without blocking cleanup's initial cloud check.
The cleanup-bootstrap edge was not reached. The later minimum-time-to-start
guard was reached and correctly prevented a new resource allocation.

Remaining gates: recover an available affected C159 image before claiming
historical reproduction; establish a new explicitly bounded run window before
attempting C133/C186/C190/C192/C193/C194 with reviewed managed NPM images and
case-specific prerequisites. C244 needs a pinned Helm server-admission attempt;
C249 additionally needs supported and readable host energy counters. Then assess source fidelity,
negative controls and diagnostic evidence before scored admission. No commits or
pushes are part of this implementation/validation batch.