# Full AKS Reproduction Authoring

Original authoring checkpoint: 2026-09-18. **All original 89 paths authored;
live qualification still pending.** Validation was authorized on 2026-09-19;
the following follow-up is separate from the original checkpoint below.

## C159 Expansion Follow-Up

The [expansion handler](../src/scenarios/aksExpansionEndToEndCases.ts) now implements
C159, the [reported kubenet hairpin issue](https://github.com/Azure/AKS/issues/5669).
The full issue body and comments were reviewed before implementation. The
2026-08-29 source comment reports a fix in
`AKSUbuntu-2404gen2containerd-202608.14.0`; a current-image pass must not be called
a reproduction of the older fault.

The owned one-node AKS lifecycle now supports kubenet explicitly. The handler
requires AKS 1.35, an exact Ubuntu 24.04 node-image match and digest-pinned nginx
and curl images. The probe sidecar shares the nginx Pod's network namespace.
Controls cover loopback, Pod IP, a separate client to Service IP/DNS, and an
independently checked single ready EndpointSlice backend. Three paired self-call
probes then distinguish successful nginx responses from curl timeouts. DNS,
connection-refusal, executable and unexpected-content errors are inconclusive.

Choose `expectation: "reproduce-fault"` only with an available affected image;
all six self-call probes must time out while contemporaneous controls succeed.
Choose `expectation: "healthy-control"` to check all six calls succeed on a
declared current image. The generic lifecycle phase called `fault` stores that
explicit expectation and `faultObserved: false` for a healthy control. Its
`passed` status therefore does not by itself mean the historical fault occurred.
Recovery selects a different owned backend and verifies traffic from the original
Pod. This is a non-self routing control, not a kernel repair or the source's
privileged hairpin-mode workaround. No host network settings are changed.

The case is visible through `list-end-to-end-authoring`, not the frozen
`list-drafts` catalogue or scored roster. An example parameter file is:

```json
{
  "serverImage": "docker.io/library/nginx@sha256:<reviewed-amd64-digest>",
  "nodeImageVersion": "<exact-AKSUbuntu-2404-node-image>",
  "expectation": "healthy-control"
}
```

```sh
npm run eval:observability -- run-end-to-end \
  --scenario aks-c159-v1 \
  --subscription "$SUBSCRIPTION" --location "$LOCATION" \
  --kubernetes-version "$VERSION" --node-vm-size "$NODE_SKU" \
  --probe-image "$CURL_IMAGE_DIGEST" --case-parameters "$PARAMETERS" \
  --state-dir "$NEW_PRIVATE_STATE_DIRECTORY" \
  --accept-azure-costs --acknowledge-unverified-implementation
```

The public runner's acknowledgement is not a dollar cap. The first live trial
uses a private launcher restricted to one `Standard_D2as_v6` node, West Europe,
AKS 1.35.7, a US$15 operating budget and a two-hour overall window including
cleanup; no model calls. The regular Linux VM retail rate checked was US$0.11/h,
excluding disks, LB/IP and transfer. Billing may lag; no provider spending cap is
claimed. A failed first setup attempt is retained: the admin kubeconfig context
did not match the requested name. The runner now checks a single context and the
owned cluster endpoint before locally renaming it. No credentials are published.

Local checks: 39 focused tests, 449 eval tests and the eval typecheck pass. This also exposed
and repaired one missing brace in the previously unverified Windows handler
import; it does not validate Windows behavior. The
[live attempt report](aks-expansion-live-results.md) records the preserved setup
failure and current-image traffic results, separately from historical-fault
qualification. C159 and the original 89 remain pending qualification.

## C192 Named-Port Compatibility

C192 is also authored in the same expansion handler and discoverable through
`list-end-to-end-authoring`. The
[source](https://github.com/Azure/azure-container-networking/issues/550) reports
that NPM v1.0.33 allowed both ports 80 and 81 when a policy named only `serve-80`.
The maintainer's reply explicitly states named ports were unsupported then.
This is a historical compatibility observation, not a claim that current NPM
violates policy semantics.

The owned Azure CNI/NPM scenario uses a digest-pinned nginx server on both ports
and a separate curl client. It requires the exact managed NPM image, exact Ubuntu
node image, one ready NPM pod and an initially policy-free owned namespace. The
baseline establishes both ports reachable, deny-all blocking both ports, then a
numeric-80 rule permitting only 80. The named-port phase checks three stable
traffic matrices with localhost server controls. Recovery restores the numeric
rule and finally removes the owned policy, checking both ports reopen.

Parameters are `serverImage`, `nodeImageVersion`, `npmImage` and `expectation`.
Historical `reproduce-fault` mode requires the source `:v1.0.33` image; modern
images use `healthy-control`. Managed image tags are matched explicitly and pod
runtime image IDs are retained; nginx/curl workload inputs are digest-pinned.
The modern NetworkPolicy API and nginx replacement for the source Python server
are explicit mechanism adaptations. No old managed image availability is assumed.
C192 has local tests. Its live AKS attempt stopped at the exact managed-image
gate before workload creation; no policy behavior was validated or qualified.

## C186, C193 And C194 Policy Cases

These three additional handlers use the same one-node Azure CNI/NPM environment
gate and four parameters as C192. All support explicit `healthy-control` versus
`reproduce-fault` expectations, remain mechanism adaptations, and are outside the
scored roster. They have complete injected lifecycle tests, not live validation.

| Case | Baseline And Observation | Recovery And Limits |
| --- | --- | --- |
| C186: [CIDR exception overlap](https://github.com/Azure/azure-container-networking/issues/558) | Direct Pod-IP and Service-IP HTTP work, then a /24 allow with the backend /32 excluded blocks them. A second additive /24 allow must restore both in healthy mode; unaffected client and loopback controls stay healthy. | Remove the exclusion, then owned allow policy; require successful traffic. Historical mode requires NPM v1.1.0. The source follow-up identifies a Kubernetes conformance test, not a separately verified customer outage. The scenario canonicalizes the /24 address and uses one synthetic HTTP port. |
| C193: [second allow policy](https://github.com/Azure/azure-container-networking/issues/554) | Two fresh namespaces exercise frontend-first and test-first orders. Baseline permits one selected peer, denies other peers, and checks backend egress to a separate sink. Both allow policies must preserve selected traffic and egress while denying an outsider in healthy mode. | Remove only owned policies and require all traffic to recover. No NPM restart or rule flush hides persistent stale-state failure. Historical mode requires source Kubernetes 1.16.7 and a declared NPM image; actual historical availability is unproven. The fault oracle is deliberately narrow and requires selected ingress and backend egress to time out together; it does not claim exact iptables-root-cause proof. The source references fix PR #551. |
| C194: [completed Job membership](https://github.com/Azure/azure-container-networking/issues/428) | A bounded Job waits on an owned FIFO. Its IP must enter policy-referenced ipsets while a same-namespace nonmatching control stays outside those sets. After explicit successful completion, retain the Pod and sample membership three times with live-client and server controls. | Delete the exact owned Job, require membership removal, then remove its policy and restore control traffic. A four-minute Job deadline bounds stalled completion. Read-only `ipset save` and `iptables-save` must exist in the pinned NPM container; missing tools, unsupported set formats and NPM restart/image changes fail closed. Historical mode requires v1.0.28. No forced IP reuse, cross-node or 500-Job scalability claim. |

The C194 source discussion distinguishes deletion fixes in v1.0.29 from removing
membership on completion while the Pod object remains. The implementation records
that transition directly instead of treating a missing log line as proof. Kernel
set/rule evidence is private and limited to the newly owned cluster.

The shared environment check now saves expected/actual managed-image metadata
before failing a mismatch. A published node-image cache list is not proof of the
image deployed by AKS. The first live NPM attempt declared cached v1.6.42 but
observed managed v1.6.48-0 and stopped before any workload. Cleanup passed; the
prepared explicit v1.6.48-0 retry was refused because less than 25 minutes
remained in the original active-work window. No new cluster was created by that
refusal. See the [attempt ledger](aks-expansion-live-results.md#npm-batch-attempt)
for timing, budget and the four unvalidated cases.

## C133 And C190 Offline Follow-Up

These two additional cases use the same explicit `serverImage`, `nodeImageVersion`,
`npmImage` and `expectation` parameters and owned Azure CNI/NPM lifecycle as the
other policy cases. They are discoverable but unqualified, with no live attempt
in this follow-up. No new Azure budget window or paid-model run was started.

### C190: Endpoint-Less Service

The [source report](https://github.com/Azure/azure-container-networking/issues/569)
provides a Service with no backend, an allow-all NetworkPolicy and two clients:
ordinary pod networking and `hostNetwork`. Its follow-up reports different behavior
after manually moving NPM's chain; this implementation never edits host rules or
asserts that chain ordering is the proven cause.

Baseline requires the Service to have no endpoints, including unready endpoints,
and both clients to receive a prompt connection refusal before the policy exists.
An independent nginx Pod must remain reachable from both clients. After installing
the source allow-all policy, historical mode requires the pod client to time out
while the host client still receives a refusal. Healthy-control mode requires both
to refuse. Three samples must match the declared outcome. Requests use the numeric
Service IP to isolate DNS from routing.

The pinned curl probe must support `%{json}` and `exitcode`. Verbose stderr must
contain an explicit connection refusal, with exit 7, HTTP code zero and curl
elapsed time below 2.5 seconds. A timeout requires exit 28, HTTP code zero and
elapsed time from 2.5 to less than six seconds, using a three-second connect and
five-second total timeout. Malformed/missing output, DNS errors, other connection
errors and unsuccessful HTTP responses cannot establish either result.

Recovery first attaches the real nginx backend and requires HTTP 200 from both
clients. It then removes that endpoint and the owned policy and requires refusals
again. This is one port and one node, using nginx/curl instead of the source's
Python/BusyBox images. Historical NPM/kernel availability remains unestablished.
Host-network access is limited to synthetic test traffic in the newly owned
cluster; no privileged container, host mount, NPM restart or rules mutation is used.

### C133: Deleted-Policy Reconciliation

The [source report](https://github.com/Azure/AKS/issues/2225) shows stale NPM
rules on one of two nodes after policy deletion. It does not give a deterministic
trigger. The reporter later says a patched-node reboot resolved the incident and
suspects an aks-link synchronization issue; that explanation is not established.

This deliberately narrower one-node experiment starts policy-free, proves traffic
to a subject and unaffected backend, then installs an owned deny-ingress policy.
Baseline must observe blocked traffic and readable destination DROP rules tied to
the subject's actual IP. After deleting the exact owned policy, it records API
absence, unchanged Pod identity and NPM runtime identity, read-only ipset/rule
snapshots, and three traffic samples while the control backend stays reachable.
Healthy mode requires target rules gone and traffic restored; historical mode
requires the same captured target DROP rule and timeout to persist. Historical
mode also requires the source control-plane version 1.19.7, without claiming the
source's 1.19.6 nodes or its multi-node failure have been reconstructed.

The rule matcher intentionally accepts only non-negated destination memberships
with direct NPM DROP actions, including nested sets. Source-address, port,
protocol and selected conditional packet matches are excluded. Unsupported rule
shapes, missing collection tools, missing sets or changed NPM runtime fail closed.
This is correlated rule/traffic evidence, not a complete packet-path interpreter
or proof of the unknown initiating synchronization failure.

Healthy recovery repeats owned policy enforcement and deletion. In historical
mode the final phase is only an unaffected-backend control and explicitly records
`originalStillBlocked: true`, `kind: "unaffected-backend-control-not-a-repair"`.
A passing generic `recovery` phase must not be interpreted as repairing the
original backend. The owned-cluster cleanup removes the test infrastructure;
no reboot, rule flushing or deliberate state corruption is performed. A real
repair and independent qualification remain outstanding.

## C244 And C249 Energy-Tool Compatibility

The [energy compatibility handlers](../src/scenarios/aksEnergyEndToEndCases.ts)
add C244 and C249 to authoring discovery. Both remain pending qualification and
excluded from scored evaluation. They are upstream-transfer candidates, not
reports of these failures on managed AKS. This follow-up ran only offline tests
and local chart rendering: no cluster, collector, Prometheus process or model
was started, and no energy was measured. A renewed bounded Azure window and
case-specific prerequisites are required before any live attempt.

### C244: Removed Chart API

The [Scaphandre installation report](https://github.com/hubblo-org/scaphandre/issues/321)
and its replies identify Kubernetes 1.25's PodSecurityPolicy removal. Upstream
[PR #250](https://github.com/hubblo-org/scaphandre/pull/250) guards PSP and the
related role rule with `.Capabilities.APIVersions.Has "policy/v1beta1"`.
Reviewed affected revision: `b64497b2ff97b6f719db092d28540f5ba6264ce3`; fixed
merge revision: `933e29b97eba2bd55e227539df795e8e1c395186`.

Inputs are `affectedChartArchive`, `affectedChartSha256`, `fixedChartArchive`,
`fixedChartSha256` and `exporterImage`. Archives must be distinct local `.tgz`
files matching reviewed SHA-256 pins. `exporterImage` has the form
`repository:tag@sha256:digest` because the source chart joins image name and tag.
Helm must support `install --dry-run=server --output json`.

The fresh-AKS handler confirms `policy/v1` discovery and absence of
`policy/v1beta1`, creates a harmless ConfigMap admission witness, and checks the
fixed chart through a server dry-run. It renders the actual affected chart,
requires its PSP and real exporter DaemonSet with the reviewed image, then
requires the precise missing-PSP mapping error from the affected server dry-run.
Recovery repeats the fixed server dry-run and removes the owned witness.
It checks Helm release inventory and the source chart's actual
`app.kubernetes.io/name=scaphandre` labels for persisted namespaced and cluster
objects. Unsupported resource kinds, hooks, duplicate objects and preexisting
chart resources fail closed; no other installation is removed.

This is **chart rendering/API-mapping validation**, not an installed exporter,
exporter readiness or proof that every chart object passes admission webhooks.
Host paths in the upstream DaemonSet are never mounted by these dry-runs.
The source's generic "ensure CRDs are installed first" suffix is not interpreted
as a missing custom CRD, and RBAC/network/authentication failures do not qualify
as the reported removed-API fault.

Local Helm checks downloaded only chart files at the exact revisions and
confirmed their identities, image substitution and the fixed capability guard.
An initial expectation that the fixed chart would omit PSP in local rendering
was falsified: local Helm's default API capabilities still include
`policy/v1beta1`, so **both local renders contained PSP**, even with
`--kube-version 1.35.7`. The handler intentionally uses server discovery for the
fixed control. No successful server admission is claimed. The private record is
`.tmp/scaphandre-chart-review-20260919/review.json`; the local render used a
placeholder image digest and did not pull an image. Future execution requires
real reviewed exporter and chart pins.

### C249: Missing Metrics Content-Type

The [Prometheus 3 report](https://github.com/hubblo-org/scaphandre/issues/400)
describes Scaphandre metrics served without a Content-Type header. Its reply
suggests a per-target fallback protocol. The handler uses
`fallback_scrape_protocol: PrometheusText0.0.4`, which the
[Prometheus v3.0.0 configuration source](https://github.com/prometheus/prometheus/blob/v3.0.0/config/config.go)
explicitly supports. This differs from the reply's `PrometheusText1.0.0` example
and is a declared plain-text compatibility control, not an automatic fallback.

Inputs are digest-pinned `exporterImage` and `prometheusImage`,
`prometheusVersion: "3.0.0"`, exact `nodeImageVersion`, and
`acceptReadOnlyHostMetrics: "true"`. The source-compatible exporter must provide
`/usr/local/bin/scaphandre`, `/bin/sh` and `cat`. The pinned curl probe must
support `%{json}`, including `content_type`, `http_code` and `exitcode`.

On one owned Linux node, the real exporter mounts host `/proc` and `/sys`
read-only, runs as root without extra capabilities or privilege escalation, and
has no service-account token. This still exposes host telemetry and process
metadata and requires explicit authorization in the disposable environment.
No container-discovery flag is enabled. Before any comparison, the exporter must
be Ready, a numeric RAPL energy counter must be readable through the mount, and
HTTP 200 must contain `scaph_host_power_microwatts` while the Content-Type is
blank or absent. Missing hardware support, permission errors, a repaired header
or absent metric is a blocked/inconclusive setup, never zero consumption.
Ordinary AKS VM guests must not be assumed to satisfy these prerequisites.

Two digest-identical Prometheus 3.0.0 Pods scrape that unchanged exporter with
the same three-second interval and two-second timeout. The fallback control must
be healthy. The strict subject must report three distinct completed scrapes
failing specifically for blank/missing Content-Type; both exporter and scraper
UID/runtime identities are checked. Initial unscheduled scrapes remain pending,
not healthy or failed evidence. Recovery replaces only the owned subject scraper
with the same fallback configuration and requires healthy target status while
the exporter still sends no Content-Type. No broad Prometheus configuration is
changed and no policy, host sensor or driver is modified.

Recorded evidence contains header/target status and metric-presence metadata,
not raw per-process metric labels. Any private command journal can still contain
raw responses and must not be published. Host counter availability and successful
scraping do not validate power calibration, attribution or workload energy.
Zero-valued samples remain measurement-validity-unknown; no energy savings,
absolute consumption or carbon result is inferred. Owned-cluster teardown is
responsible for final Pod, ConfigMap and emptyDir cleanup.

### C243 Source Correction

The [high-PID report](https://github.com/hubblo-org/scaphandre/issues/425) was
closed by its author with the explanation that the example was wrong. This
follow-up therefore does **not** implement or count a confirmed PID-range bug.
C243 remains without a handler pending corrected CLI semantics and independent
evidence. The earlier excerpt-based research register is retained as a historical
snapshot, with this correction recorded separately rather than silently rewriting
the provenance or inventing a reproduced defect.

## C119 Controller Platform Compatibility

The [architecture handler](../src/scenarios/aksArchitectureEndToEndCases.ts)
implements a bounded binary-level adaptation of the
[ARM64 ALB Controller report](https://github.com/Azure/AKS/issues/5390). The source
describes Helm installation on an ARM64-only AKS 1.32 cluster with Controller
1.8.9; the June 2026 reply states ARM64 support is available in 1.11.1.
The handler does not install Helm charts, configure workload identity, reconcile
a controller or provision an Application Gateway for Containers.

Inputs: `affectedControllerImage`, `affectedManifest`, `affectedConfig`,
`fixedControllerImage`, `fixedManifest`, `fixedConfig`, `armNodeVmSize`,
`amdNodeImageVersion`, `armNodeImageVersion`, and `nodeCeiling: "2"`.
Manifest/config paths refer to reviewed local JSON bytes, not reformatted copies.
The manifest hash must equal the requested image digest and its config digest
and size must match the config bytes. Config OS/architecture must be Linux/AMD64
for source version 1.8.9 and Linux/ARM64 for control version 1.11.1. Inputs use
platform manifests, not an unreviewed multi-platform index. These content checks
bind the supplied artifacts; operators must still review registry provenance and
release identity before execution.

The fresh AKS runner begins with one AMD64 node. The baseline runs the affected
binary with `/alb-controller --help` there, then creates one non-autoscaling
ARM64 user node and runs the ARM64-capable binary with the same command. Exact
node images, actual node architecture and runtime image IDs must match; each
control must exit zero with recognizable help output and zero restarts. A Pod
has a 90-second deadline, capped CPU/memory, no service-account token and no extra
capabilities. The requested node SKU is verified through actual architecture;
SKU names alone are not accepted as evidence.

The fault requests the same AMD64-only platform digest on the ARM64 test pool.
Only `exec format error` in the controller state or UID-scoped Pod events can
satisfy its oracle, while the AMD64 control remains valid. Generic pull errors,
credentials, DNS, rate limits, successful execution, foreign events and changed
runtime images are not accepted. A runtime that rejects the platform earlier
with a different message produces an unconfirmed attempt, not a silently revised
oracle. Recovery replaces only the owned subject Pod with the fixed ARM64
manifest and requires a new UID and successful help output. The shared lifecycle
removes both pools through the owned cluster/resource-group cleanup.

This is a mixed-architecture, two-node mechanism adaptation, unlike the source's
ARM64-only installation. It tests executable compatibility, not a configured
controller. Help-mode behavior, live provisioning, failure and cleanup are not
yet validated. A renewed Azure window, appropriate ARM64 quota and a budget for
two nodes are required; the prior one-node live authorization was not reused.

### Registry Metadata Check

Public MCR manifest/config bytes were fetched and hashed without pulling image
layers or starting containers. The observed platform digests on 2026-09-19 were:

- 1.8.9 AMD64 manifest: `sha256:dc51c52633bdfdc0d12b5db0ee92084a07fc5e8b3c1abe06db5a99d288e510ff`
- 1.8.9 AMD64 config: `sha256:4a43234b4d67f2f78c24c41f9d5825ff4f4066429290f33804b1473a1c433c30`
- 1.11.1 ARM64 manifest: `sha256:fa475fbb5f6357fbb1453ebac4fc3ca3f36746e091e0c11bfdca0959dd6c70df`
- 1.11.1 ARM64 config: `sha256:25f25ee15dba2fd02324c7b7f8823145f4263e673122f6cd23fa4bd2404cffaf`

The 1.8.9 tag returned a single AMD64 manifest; 1.11.1 had AMD64/ARM64 entries
plus non-runtime attestation entries. Config histories reference `/alb-controller`.
The metadata audit is retained privately under `.tmp/aks-c119-image-review-20260919`.
It is evidence of image content/platform declaration, not evidence that the
handler ran or that either binary's help command completed successfully.

## Original Scope

The requested scope for the remaining 89 candidates is full end-to-end AKS
reproduction, not another set of local component adaptations. This requires
owned Azure infrastructure, actual workload/addon setup, a source-specific fault,
observations, recovery, and cleanup. A candidate design or resource checklist is
not an implementation.

## Original 89 Checkpoint

- The existing eleven component implementations and ten local live results are
  unchanged. They do not qualify as full AKS reproductions by association.
- The [full-AKS authoring inventory](../src/scenarios/aksEndToEndScenarios.ts)
  explicitly covers the remaining 89 IDs, with resource requirements and remaining
  implementation work. This inventory is not a set of executable fixtures.
- All 89 requested IDs now have case-specific authored code: the earlier C089,
  the next 31 handlers, and the final 57 described below. The
  [shared lifecycle](../src/cluster/provisioning/aksEndToEnd.ts) provisions a fresh
  owned AKS cluster, dispatches through the
  [implementation registry](../src/scenarios/aksEndToEndRegistry.ts), and removes
  owned Azure resources. These paths remain **`authored-unverified`**, not validated
  reproductions. All remain excluded from scored evidence. Authoring coverage is
  complete; correctness, version compatibility, exact source fidelity, cleanup,
  and qualification have not been established for these new paths.
- At the user's request, no tests, typechecks, builds, generated-catalogue checks,
  cluster operations, live verification, or model evaluations have been run for
  this new slice. Earlier test counts do not validate these changes.

The inventory retains `remaining_work` as deployment/source prerequisites rather
than replacing source caveats with a success claim. Some configurations, component
images, chart values, and API support still need review before execution.
Historical-version cases must fail closed when unavailable,
not run on a current release and claim the original issue reproduced.

## Authored Cases

The following table describes intended code paths, not executed outcomes. No
compilation, formatter, test, or live run has established that these new paths work.
All require explicit available Kubernetes/node versions, appropriate permissions,
owned disposable infrastructure, and reviewed immutable image inputs. Prerequisite
failure is not a reproduced fault. Metadata/image checks are deliberately strict;
a tag-only managed addon may be rejected even when its runtime image is equivalent.

| IDs | Implementation | Intended fault and recovery |
| --- | --- | --- |
| C024, C027 | [Image-volume cases](../src/scenarios/aksEndToEndCases.ts) | Real image-backed volume content/subPath or affected Azure Linux mkdir failure; full-volume/Ubuntu control and sentinel checksum recovery. |
| C047, C048 | [Capacity/configuration cases](../src/scenarios/aksEndToEndCases.ts) | Actual Overlay CIDR maximum rejection or pinned CLI omitted initial count; valid maximum/count recovery without creating the theoretical 200 nodes. C048 uses four-node controls explicitly. |
| C009 | [Disk cases](../src/scenarios/aksDiskEndToEndCases.ts) | Owned cross-resource-group disk import, PVC clone source-ID rejection, same-group clone baseline and snapshot-restore recovery with sentinel checks. |
| C086 | [Disk cases](../src/scenarios/aksDiskEndToEndCases.ts) | Repeated detached expansion with actual resize error and provider/PVC divergence; remount, capacity convergence and filesystem checks. |
| C087 | [Disk cases](../src/scenarios/aksDiskEndToEndCases.ts) | Actual maxShares disk and raw-block consumers; incomplete CSI attributes versus complete control, no concurrent filesystem writers. |
| C088 | [Disk cases](../src/scenarios/aksDiskEndToEndCases.ts) | Owned zonal source disk, same-zone clone control and different-zone provider rejection; recovery preserves the source sentinel. |
| C090 | [Disk cases](../src/scenarios/aksDiskEndToEndCases.ts) | Real copied remote snapshot and CSI lookup failure despite Azure inventory; local copy/import recovery and restored sentinel. |
| C092 | [Disk cases](../src/scenarios/aksDiskEndToEndCases.ts) | Premium SSD v2 provider attachment caching on a separate subject pool; supported None-caching control and disposable recreation. Original fault-disk data recovery is not claimed. |
| C011 | [Azure Files cases](../src/scenarios/aksFileEndToEndCases.ts) | Actual migrated in-tree volume and missing-audience mount error, requiring migration annotation; CSI-native mount recovery. |
| C073 | [Azure Files cases](../src/scenarios/aksFileEndToEndCases.ts) | Inline account-resolution error without explicit account attribute; existing share and explicit-attribute control/recovery. |
| C076 | [Azure Files cases](../src/scenarios/aksFileEndToEndCases.ts) | Owned RG-scoped replication policy and real dynamic account provisioning denial; compliant class recovery with policy still enforced. |
| C077 | [Azure Files cases](../src/scenarios/aksFileEndToEndCases.ts) | Duplicate references to an actual Azure Files PVC and observed initialization/mount failure; one declaration shared by two containers as recovery. |
| C078 | [Azure Files cases](../src/scenarios/aksFileEndToEndCases.ts) | Missing folder on an actual share using a declared affected pre-v1.34 driver; create that directory through the root mount and observe recovery. |
| C082 | [Azure Files cases](../src/scenarios/aksFileEndToEndCases.ts) | Real owned key rotation with unchanged Secret metadata and roles; refresh credential and remount. This covers the Secret-backed refresh path, not every identity-driven cache variant. |
| C083 | [Azure Files cases](../src/scenarios/aksFileEndToEndCases.ts) | Two owned Secret namespaces, inline lookup failure despite declared-namespace existence; supported same-namespace recovery. Secret values are not evidence. |
| C025 | [Node/identity cases](../src/scenarios/aksIdentityEndToEndCases.ts) | Read-only host PATH/executable comparison on an exact AKS image; explicit `/opt/bin/kubectl` invocation while node remains Ready. Requires a privileged, read-only host-root probe. |
| C093 | [Node/identity cases](../src/scenarios/aksIdentityEndToEndCases.ts) | Provision real AKS OIDC, a user-assigned identity, federated credential and RG Reader; exact issuer token exchange/read control, omitted-slash rejection and exact-issuer recovery. Tokens never enter saved evidence. |
| C038 | [Identity/network cases](../src/scenarios/aksNetworkEndToEndCases.ts) | Replace the real cluster identity and inventory retained old-principal node-RG roles; remove only recorded assignments and retain healthy node checks. No cached-token revocation claim. |
| C067 | [Identity/network cases](../src/scenarios/aksNetworkEndToEndCases.ts) | Owned Azure load balancer and backend with healthy non-root path; inspect actual HTTP root probe and failed external route, then correct probe path. Public ingress is limited to owned outbound addresses. |
| C002 | [Windows cases](../src/scenarios/aksWindowsEndToEndCases.ts) | Real Windows duplicate ConfigMap subPath mounts, failed deletion and mount-cleanup evidence; single-mount control, then removal of the affected owned pool before forced Pod-record cleanup. |
| C023 | [Windows cases](../src/scenarios/aksWindowsEndToEndCases.ts) | Real Windows server, direct access and bounded loopback port-forward requiring the wincat error; declared supported upgrade/image and new backend for recovery. |
| C069 | [Windows cases](../src/scenarios/aksWindowsEndToEndCases.ts) | ClientIP affinity against a Windows backend/client with Linux and direct controls; removal of affinity must restore requests. |
| C046, C050 | [Scale-from-zero cases](../src/scenarios/aksScalingEndToEndCases.ts) | Actual ARM64/Windows pools, warm/direct-placement controls, zero-node template or RuntimeClass rejection evidence; nonzero capacity or direct placement recovery. |
| C026, C044 | [Managed-addon cases](../src/scenarios/aksAddonEndToEndCases.ts) | Managed cost addon on ARM64 with exec-format evidence, or managed Typha host-port/taint scheduling failure; supported architecture/capacity controls. Placement is deliberately changed in the owned cluster, not a claimed natural rollout. |
| C084 | [Snapshot telemetry](../src/scenarios/aksSnapshotEndToEndCases.ts) | Azure Files data-plane snapshot timestamps compared with independent Azure snapshots and wall clock; management-plane snapshot control/recovery. |
| C008 | [Audit telemetry](../src/scenarios/aksTelemetryEndToEndCases.ts) | Actual audit export to owned storage: small valid audit record versus large truncated inner JSON, with valid outer JSON; declared supported-version recovery must export the complete large event. |
| C010 | [Private networking](../src/scenarios/aksPrivateEndToEndCases.ts) | Owned hub/spoke, private DNS, UAMI and a second private AKS create request; working hub DNS plus intended VNet-link permission denial, then scoped permission recovery. |
| C089 | Shared lifecycle's original disk case | Ordinary filesystem RWX rejection with RWO sentinel controls, as described below. |

Shared cleanup tracks the primary and explicitly registered auxiliary node resource
groups. Subscription-scoped policy definitions have their own persisted intent and
owner metadata checks; assignments are scoped to the owned resource group. Cleanup
failures remain failures and retain state. These protections have not been tested
for the new paths. Broad Azure permissions and some privileged Kubernetes actions
are required; do not run against an existing non-disposable environment.

Case handlers may need additional input through `--case-parameters`, a JSON file
of non-secret string values. They do not accept arbitrary lifecycle scripts.
Representative inputs are listed below; the case's `validate` function is the
authoritative required-input list:

| Family | Required additional inputs |
| --- | --- |
| Image volumes | `artifactImage`, `artifactSubPath`, `artifactFile`, `artifactFileSha256`; C027 also `affectedNodeImageVersion`. Artifact content must already exist at a reviewed digest; the infrastructure is created by the case. |
| Windows | `windowsProbeImage`, `windowsNodeVmSize`, `windowsNodeImageVersion`; C002/C023/C069 require `windowsOsSku`; C023 adds `recoveryKubernetesVersion`, `recoveryWindowsNodeImageVersion`. |
| Azure Files | `fileDriverImage`; C078 adds `affectedFileDriverVersion`. Account keys are obtained in memory, written only through a temporary private Secret request, and not retained as evidence. |
| Disk clones/caching | C088 `sourceZone`, `destinationZone`; C092 `diskZone`; C090 `snapshotRegion`. All disk handlers and C089 require `--disk-driver-image`. |
| Identity/host | C093 `pythonImage`; C025 `affectedNodeImageVersion`, `hostProbeImage`. |
| Capacity | C048 `azureCliVersion`, `poolNodeCeiling: "4"`; C046 `armNodeVmSize`, `armProbeImage`. |
| Managed addons | C026 `armNodeVmSize`, `costDeployment`, `costContainer`, `costImage`; C044 `typhaImage`. |
| Telemetry/private | C008 `auditLargeBytes` and `recoveryKubernetesVersion`; C010 `networkProbeImage`. |

The normal shared cluster starts with one Linux node; cases may add Windows, ARM64,
zonal or control/subject pools. C048 requests four-node controls, C010 creates a
second private cluster plus an ACI DNS probe, C076 provisions premium file shares,
and snapshot cases retain copies until cleanup. Review per-case quotas and cost
before any future execution. There is no universal one-node or low-cost guarantee.
At the original checkpoint, verification was deferred. The 2026-09-19 permission
allows validation; it does not retroactively establish that these handlers work.

## Final 57 Authored Paths

The following handlers extend the same fresh-AKS provisioning boundary. These are
source-informed implementations, not proof that every command or assertion works
on a current Azure CLI, API, chart, or node image. Nothing in this table was run.
Where the original report leaves configuration details unspecified, the handler
requires explicit reviewed inputs and can fail its setup or recovery conditions.

| IDs | Code | Intended mechanism and important boundary |
| --- | --- | --- |
| C003, C006, C007, C079 | [File platform](../src/scenarios/aksFilePlatformEndToEndCases.ts) | Owned encrypted NFS/helper-image comparison, managed-identity SMB helper failure, secure-transfer-preserving unencrypted NFS rejection, and secretless inline account parsing with a persistent-volume control. |
| C014, C016, C030, C049 | [Pinned charts](../src/scenarios/aksChartEndToEndCases.ts) | Real ALB chart image-path error and pre-delete hook scheduling, Calico operator certificate RBAC, and preexisting VPA CRDs versus the managed addon. CRDs and permissions are changed only in the disposable cluster. |
| C040, C057, C058 | [Dataplane/DNS](../src/scenarios/aksDataplaneEndToEndCases.ts) | Calico FIPS initialization errors with traffic observed separately, actual ingress-only Cilium admission rejection, and pinned CoreDNS reverse-DNS behavior with forward-query controls. FIPS removal is a disposable compatibility control, not a production recommendation. |
| C042, C043, C045 | [Advanced scaling](../src/scenarios/aksAdvancedScalingEndToEndCases.ts) | Actual deallocated-node health thresholds, GPU time-slicing scale-from-zero overshoot, and topology-constrained scale-in with managed autoscaler logs. GPU pool ceiling is two; a warm single-node recovery is not a fix to autoscaler estimation. |
| C018, C066, C068 | [Application Gateway for Containers](../src/scenarios/aksGatewayEndToEndCases.ts) | Owned AGC/subnet/controller identity, restart/association capacity failure, default-root health probe, and wildcard routing. Probe case uses a non-successful root response; exact reporter HTTP status remains a fidelity detail. |
| C055, C091 | [Disk capacity](../src/scenarios/aksDiskCapacityEndToEndCases.ts) | Mounted Windows source clone versus quiesced control, and bounded CSI/provider attachment-limit disagreement. Raw provider limits and actual scheduling/attach events are required. |
| C012, C028 | [Managed extensions](../src/scenarios/aksExtensionEndToEndCases.ts) | Flux OCI chart retrieval using an owned registry, and Dapr initialization blocked by Automatic namespace policy. Controls use declared working extension versions; no policy bypass. |
| C074, C080 | [Private Files](../src/scenarios/aksPrivateFileEndToEndCases.ts) | Owned endpoint/DNS and explicit canonical-versus-private-link SMB identity target; real CSI subnet-policy mutation. C074 exercises explicit server-hostname configuration, not every dynamic-provisioning variant. |
| C033, C065 | [Azure RBAC](../src/scenarios/aksAuthorizationEndToEndCases.ts) | Authenticated Entra access versus incomplete impersonation, and built-in Reader HTTPRoute denial with a narrow custom-role recovery. C033 uses an owned service principal rather than an unrelated human account. Tokens stay inside the probe. |
| C004, C034, C051 | [Provisioning/upgrade](../src/scenarios/aksProvisioningEndToEndCases.ts) | Customer-managed disk encryption versus NAP, encrypted VNet/API-integration creation, and deprecated-API upgrade rejection followed by the declared lookback. C004 does not assert the extra private/BYOCNI variant. C051's baseline proves version availability, not a separate successful upgrade preflight. |
| C053, C070 | [gRPC](../src/scenarios/aksGrpcEndToEndCases.ts) | Real grpcio server streaming and bidirectional first-response timing across direct and AGC paths, with pinned controller-version recovery. A specific reset or half-close dependency is required, not any network timeout. |
| C071, C072, C075 | [File failures](../src/scenarios/aksFileFailureEndToEndCases.ts) | Actual snapshot-copy network denial, CIFS cipher negotiation, and a copy failure after destination creation with orphan inventory. C071 does not claim the source's successful AAD-login or sovereign-cloud variant without separate evidence. |
| C085 | [Cross-subscription storage](../src/scenarios/aksCrossSubscriptionEndToEndCases.ts) | Real second-subscription account/share and driver scope mismatch, with separately persisted resource-group ownership. Requires authorization in both subscriptions. |
| C081 | [Snapshot deletion](../src/scenarios/aksSnapshotDeleteEndToEndCases.ts) | Two real snapshots and independent disposable sentinel backup; unintended share deletion or lease failure, then a declared corrected driver version. Recreated test data is explicitly not preservation of the original lost snapshot. |
| C019 | [Node DNS](../src/scenarios/aksNodeDnsEndToEndCases.ts) | Custom actual resolver versus NPD fallback logs on a declared node image, then an expected recovery-image check. Privileged host access is required for read-only node diagnostics. |
| C005, C041, C063 | [Managed startup](../src/scenarios/aksManagedStartupEndToEndCases.ts) | Cost addon disk-zone attachment, managed Istio Gateway image generation, and app-routing informer failure with missing Gateway API resources. Scheduler-only zone rejection does not satisfy the disk-attachment oracle. C063 is a controlled dependency-removal mechanism. |
| C013, C017, C020, C056 | [Managed telemetry](../src/scenarios/aksManagedTelemetryEndToEndCases.ts) | Prometheus target collection, Retina aggregate fields, NAP log delivery, and Hubble DNS metric detail. Each needs working telemetry/activity controls; alternative event/flow observations are not reported as a repaired exporter. |
| C031, C032 | [Identity metadata](../src/scenarios/aksIdentityBindingEndToEndCases.ts) | Managed ArgoCD injection/version comparison and actual Identity Binding token-path change. These assert metadata/filesystem behavior, not a completed cloud authorization workflow. |
| C039, C064 | [Ingress/IPAM](../src/scenarios/aksIngressControllerEndToEndCases.ts) | BYOCNI Cilium/cloud-controller address competition and an isolated ingress worker crash caused by a bounded source-specific auth redirect. Images, charts and request shape are explicit inputs. |
| C021, C022, C035 | [Network configuration](../src/scenarios/aksNetworkConfigurationEndToEndCases.ts) | Actual BYOCNI CIDR persistence, managed Typha assignment to an ACI node, and Automatic isolation/SKU validation. C021's control proves CNI allocation, not the private-API routing variant. Source failure must actually appear. |
| C036, C062 | [Routing detail](../src/scenarios/aksRoutingDetailEndToEndCases.ts) | Real app-routing private-DNS omission with a manual supported-record workaround, and AGC cookie path behavior using a standard cookie jar and identifiable backends. |
| C060, C061 | [Policy interaction](../src/scenarios/aksPolicyInteractionEndToEndCases.ts) | Mesh ServiceEntry authorization boundary with explicit egress enforcement, and real Cilium crash/restart following a reviewed source policy. NetworkPolicy recovery is not reported as repaired external AuthorizationPolicy enforcement. |
| C015 | [Proxy bootstrap](../src/scenarios/aksProxyBootstrapEndToEndCases.ts) | Owned rejecting Squid proxy, lowercase APT exclusion control, actual AKS bootstrap failure and a declared corrected Kubernetes version with the same proxy policy. |
| C052 | [Windows SQL networking](../src/scenarios/aksWindowsSqlEndToEndCases.ts) | Owned SQL, NAT and separate node/Pod subnets; Linux endpoint control, Windows NAT source denial, and fixed-image recovery without retaining an extra public firewall exception. |
| C037 | [Cross-tenant Flux](../src/scenarios/aksCrossTenantEndToEndCases.ts) | Owned target-tenant UAMI and private Azure DevOps repository, working-versus-affected Flux versions, tenant-metadata error and actual fetch recovery. Uses a working cross-tenant release control, not a second same-tenant deployment. |

### Inputs And Privileges

The case `validate` functions declare their exact inputs. Additional requirements
introduced by this batch include:

- Reviewed local upstream chart archives with SHA-256 inputs, such as
  `affectedChartArchive`/`affectedChartSha256` and the matching recovery chart.
  These are build artifacts, not pre-provisioned test environments. The runner
  installs them on its owned AKS cluster; it never accepts arbitrary lifecycle
  shell scripts. Chart-specific values and immutable component images must be
  reviewed before execution; a chart hash alone does not lock every image it pulls.
- Source-specific non-secret settings such as metric/aggregation ConfigMap data,
  namespace-scoped Cilium policy specs, extension configuration keys, and bounded
  auth redirect request shapes. These must come from the reported configuration,
  not be tuned after observing a failed verification run.
- Windows SQL images containing compatible `sqlcmd` binaries and a Linux SQL
  control image; grpcio images for the streaming fixtures; Squid and APT images
  for bootstrap; compatible privileged host diagnostic images for node/CIFS cases.
- `targetSubscription` and `devOpsOrganization` for C037, with authority to create
  a private project, seed its repository, grant an owned target-tenant service
  principal project Reader access, and delete that project/principal registration.
  Both tenants must be distinct and the caller must be authorized in both. No
  production project is selected automatically. Credentials/tokens are acquired at
  execution time and are not intended as evidence or command-line parameters.
- `storageSubscription` for C085, and supported source/recovery versions where
  required. Version strings and image digests are user-supplied constraints, not
  claims that Azure can deploy historical managed releases today.

The extended lifecycle persists ownership intent for secondary groups, auxiliary
clusters, Azure role/policy definitions, and the DevOps project. The
[DevOps cleanup helper](../src/cluster/provisioning/aksDevOpsOwnership.ts) uses the
recorded unique project name/description and principal ID, not an arbitrary
organization-wide deletion. Insufficient cleanup permissions fail the attempt and
retain state. A cleanup failure in one dependency can prevent later cleanup work;
operators must retain the entire state directory and resolve the failure rather
than assuming all resources are gone. These new paths have not been tested.

C004 deliberately enables Key Vault purge protection. Azure soft-deletion and
retention may preserve a vault/key tombstone after active resource-group deletion;
the runner does not bypass purge protection or promise immediate permanent erasure.
Other cases may create premium storage, extra AKS clusters, Windows/ARM64/GPU pools,
Azure Monitor ingestion, AGC, ACI, SQL and ACR resources. C051 can wait a declared
lookback of up to one day only with its separate acknowledgement. There is no
universal cheap-run or wall-clock guarantee; review budgets and all external scopes
before any future execution.

### Verification Boundary

Authoring all handlers does not establish successful compilation, runtime API
compatibility, exact historical reproduction, causal grading, or reliable cleanup.
Some baselines and recoveries are explicitly narrower controls, as shown above.
These differences must be reviewed against the intended diagnosis before a case
can be qualified. The original source register and prior component/live results
remain unchanged; none of these 89 was run or promoted to scored eligibility.

## C089 Authored Path

Source: [Azure Disk CSI #2122](https://github.com/kubernetes-sigs/azuredisk-csi-driver/issues/2122).
The case is an ordinary Azure Disk **filesystem** volume requesting
`ReadWriteMany`, not shared raw-block disk support or a general concurrency test.

The authored lifecycle is intended to:

1. Check explicit public-Azure subscription, region, Kubernetes version, VM SKU,
   immutable probe image and expected managed-disk driver image inputs.
2. Create a fresh owner-tagged resource group and one-node AKS cluster, with an
   explicitly named managed node resource group and a private kubeconfig/SSH key.
   It does not reuse an existing cluster or switch the current kubectl context.
3. Reject an unexpected Kubernetes version or driver image instead of substituting
   it. The managed driver check requires its declared image to match the supplied
   digest exactly; a tag-only managed deployment fails that check even if its
   runtime content might be equivalent. This strict gate has not been exercised.
4. Create an ordinary `disk.csi.azure.com`/`Standard_LRS` filesystem StorageClass.
   Establish a bound, Ready single-writer control with a readable sentinel.
5. Request an RWX filesystem claim, retaining its UID-scoped events. Require a
   Pending PVC and a ProvisioningFailed event identifying unsupported
   `MULTI_NODE_MULTI_WRITER`; do not accept quota, network, or image-pull failures
   as proof of the intended mechanism.
6. Replace only the fault workload/claim with a supported single-writer variant,
   verify its sentinel and recheck the baseline. This is an explicit replacement
   control, not an assertion that switching to RWO satisfies an application's
   genuine multi-writer requirement.
7. Remove only the owner-tagged group and confirm absence of both the group and
   the AKS managed node group. Record cleanup failures rather than deleting an
   unowned or unexpected group.

This C089 path creates billable infrastructure. Its intended peak fixture size is one AKS
node, its OS disk, and two provisioned data volumes plus normal managed AKS network
resources; requesting 1 GiB does not guarantee that Azure bills only 1 GiB.
Local command/time bounds are not a monetary cap or remote-operation cancellation.
Node SKU, registrations, quotas, regional version availability, compatible CLI,
and permission to create/delete the owned infrastructure remain prerequisites.

State includes phase outcomes, owner, subscription, group names, cluster ID/UID,
requested version/driver, and a kubeconfig path. Credentials are not printed in
the result, but the state directory contains a private kubeconfig and SSH key;
do not publish that directory. Lifecycle observations are research/evaluator
material, not a reviewed model-visible packet. No scored diagnosis contract or
independent qualification is supplied by this implementation.

## Commands For Later Use

These commands are documented for a future approved verification step; none was
executed during authoring. From `ai-assistant/evals`:

```sh
npm run eval:observability -- list-end-to-end-authoring
```

The execution command intentionally requires two acknowledgements. Other authored
IDs use the same entrypoint and supply `--case-parameters "$PARAMETER_FILE"` where
needed; file cases use `fileDriverImage` there instead of `--disk-driver-image`:

```sh
npm run eval:observability -- run-end-to-end \
  --scenario aks-c089-v1 \
  --subscription "$TEST_SUBSCRIPTION" --location "$TEST_REGION" \
  --kubernetes-version "$AKS_VERSION" --node-vm-size "$NODE_SKU" \
  --probe-image "$PROBE_IMAGE_DIGEST" \
  --disk-driver-image "$MANAGED_DISK_DRIVER_IMAGE_DIGEST" \
  --state-dir "$NEW_TRIAL_DIRECTORY" \
  --accept-azure-costs --acknowledge-unverified-implementation

npm run eval:observability -- cleanup-end-to-end \
  --state-dir "$TRIAL_DIRECTORY"
```

`cleanup-end-to-end` reads its dedicated saved state format. The component
`cleanup-candidate` command is not interchangeable with it. Do not run either
against copied, untrusted, or manually rewritten state. Review and test the new
code before the first cloud run; the acknowledgement is not qualification.

## Source Gaps And Remaining Work

The 89-entry inventory records case-specific dependencies such as Windows node
images, managed addon releases, private DNS, Azure identities, storage handles,
GPU quotas, regional feature support, and cross-subscription/cross-tenant ownership.
It does not implement these dependencies or substitute synthetic API errors.

One source detail already changes a naive implementation: C078's
[original missing-folder report](https://github.com/kubernetes-sigs/azurefile-csi-driver/issues/1296)
was addressed by [automatic folder creation](https://github.com/kubernetes-sigs/azurefile-csi-driver/pull/2699),
linked to the v1.34.0 release. An affected image must be pinned before treating an
absent `folderName` as the expected mount fault. The historical register/source
digest is preserved; no old score or result was reclassified.

Before enabling another full-AKS case, author its actual infrastructure and fixture
code, complete its source/configuration details, preserve recovery and cleanup,
and retain the case-specific execution path. All 89 requested IDs now have authored
paths, but do not promote them by changing a status flag or handing the runner
arbitrary scripts. Source/version prerequisites and the narrower control boundaries
above remain review work. Verification remains deferred until explicitly requested.