# Ten AKS Candidate Component Checks

Date: 2026-09-18. Related work: https://github.com/illume/plugins/pull/25.

## Results

All **ten declared local component/mechanism checks** passed their baseline,
fault, recovery/control, and owned-resource cleanup assertions on their first
scenario attempt. Saved observations were inspected independently after execution.
Ten namespaces and two CRDs were independently verified absent, then the dedicated
kind cluster was deleted and its node-container absence verified.

These are **not ten full AKS incident reproductions, qualified eval scenarios, or
model-diagnosis passes**. C001/C029/C054 exercise underlying Kubernetes mechanisms
instead of the managed addons or AKS operations in the source reports. C094/C098/C100
exercise actual admission using server-side dry runs, not running applications or
Azure token exchange. C095/C096/C097/C099 include actual persisted workload or
admission failures. All qualification statuses remain pending; no model ran.

There are now **11 implemented component mechanisms and 89 unimplemented plans**
in the 100-candidate catalogue. Ten were exercised in this batch; the earlier
C059 CoreDNS implementation remains offline-verified only. None of the 100 is
admitted to the scored portfolio or labelled observability-only verified.

| Candidate | Observed fault | Recovery/control that passed | Scope |
| --- | --- | --- | --- |
| C001 | Two generated CRDs advertised the same short name; an object in the lower-priority group returned NotFound through the short name but was present through the qualified name. | Qualified lookup returned the intended object. | Discovery ambiguity, not Flux/ACStor installation; recovery changes the lookup, not the CRDs. |
| C029 | Replacing an owned Deployment with a different selector was rejected as immutable; its selector stayed unchanged. | Delete and recreate the owned Deployment with the new selector; rollout succeeded. | Kubernetes update constraint, not an ArgoCD extension upgrade or in-place repair. |
| C054 | With one healthy Pod and `minAvailable: 1`, disruptionsAllowed became zero and policy/v1 eviction was denied. | Set `minAvailable: 0`; allowed disruption became one and eviction succeeded. | Real eviction/PDB admission, not a node drain or AKS upgrade. |
| C094 | The pinned webhook injected proxy/init containers for the annotation value `"false"`. | Admission without the proxy annotation omitted both injected containers. | Server-side dry-run Pod admission; annotation absence is the workaround control. |
| C095 | Injected `azwi-proxy` entered CreateContainerConfigError when Pod `runAsUser: 0` conflicted with its non-root requirement. | A separate Pod using `runAsUser: 1000` became Ready with the proxy. | Real kubelet security-context rejection; no Azure authentication. |
| C096 | Application exited zero while the ordinary proxy sidecar stayed running and the Job remained incomplete in five consecutive samples. | A fresh short Job without the proxy arrangement completed. | Bounded Job-lifecycle observation, not proof it would remain stuck indefinitely or repair of the original Job. |
| C097 | ResourceQuota rejected the mutated Pod because proxy/init containers lacked CPU/memory requests and limits. | A new Pod without proxy injection was admitted and became Ready under the same quota. | Real mutation plus quota admission; quota was not weakened. |
| C098 | A second admission request changed the admitted Pod's ServiceAccount to B but retained A's injected client-ID metadata. | A fresh Pod starting with B received B's client-ID metadata. | Two real admission requests with explicit intervening mutation, not two-webhook ordering in one request or an authorization exploit. |
| C099 | Pinned webhook mutation removed a native init sidecar's restartPolicy; the sidecar ran and the application stayed PodInitializing. | A separate Pod without identity mutation retained `restartPolicy: Always` and became Ready. | Actual mutation/startup behavior; no Azure token exchange. |
| C100 | Putting the client-ID annotation on a Service rather than its ServiceAccount left admitted Pod client-ID metadata absent while other identity metadata remained. | Restore the ServiceAccount annotation; a fresh admission returned the intended client ID. | Metadata lookup only, not a successful authentication probe. |

The identity cases' recovery phases often use a corrected replacement or a new
admission request. They do not prove in-place recovery of the original object or
the safety of disabling proxy/identity functionality in a production workload.
The fault workloads were removed by owned-namespace cleanup afterward.

## Environment And Fidelity

- Dedicated single-node kind cluster `pr25-research-20260918`, Linux ARM64,
  Kubernetes **v1.29.2**, containerd 1.7.13. The active `headlamp-ai-evals` environment
  was not used. API endpoint was loopback `https://127.0.0.1:56443`, with a separate
  kubeconfig and explicit context for all candidate commands.
- kubectl **v1.36.1** on macOS ARM64. This is outside supported client/server version
  skew and is a verification limitation, particularly for discovery and serialization.
  Repeat with a compatible client before claiming portable or qualified behavior.
- Upstream workload-identity **v1.1.0** manifests from
  [the release deployment](https://github.com/Azure/azure-workload-identity/blob/v1.1.0/deploy/azure-wi-webhook.yaml).
  The owned installation used one webhook replica, explicit resource limits, a
  fake tenant identifier with no Azure permissions, and namespace selection
  restricted to `headlamp-research-batch: "true"`. Workloads used test client-ID
  metadata; no Azure credentials or token exchange were used, and token contents
  were not captured. Kubernetes projected-token volume metadata can be present.
- The webhook and probe were requested by digest. Injected proxy/proxy-init Pods
  retained upstream `v1.1.0` tag references; ARM64 images were preloaded into the
  dedicated node and observed runtime image IDs were captured. The runner checks
  the webhook's digest-shaped image reference, not a complete digest lock for all
  injected images. Do not describe those tagged Pod specs as fully digest-pinned.

| Image | Recorded Identity |
| --- | --- |
| kind node | `kindest/node@sha256:51a1434a5397193442f0be2a297b488b6c919ce8a3931be0ce822606ea5ca245` |
| Webhook | `mcr.microsoft.com/oss/azure/workload-identity/webhook@sha256:0b909323be05aad09f67638bfe1cedd2eac9cafb9e3f10aa8d64224c939fce7b` |
| Probe | `busybox@sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0` |
| Proxy runtime content, requested as `proxy:v1.1.0` | `sha256:f234de7f801d1bdb92fdf4695fffabf5d0a933da23e6ed6dbcd46aa9c7aa52b4` |
| Proxy-init runtime content, requested as `proxy-init:v1.1.0` | `sha256:70813856491d7a6e95a10d1138b9df970a374c8b14c8bbd1ceec738bbf386fd3` |

Before scenario execution, the first kind creation encountered a host-port collision
and removed its failed node. Creation was retried with the explicit API port above.
A multi-platform image-load failure was resolved by importing ARM64 content into
the owned node. A Deployment template restartPolicy was corrected before the first
case ran. These were environment/pre-run corrections, not successful scenario
attempts or replacements of failed scored outputs.

## Execution And Cleanup

The fixed order was C001, C029, C054, C094, C095, C096, C097, C098, C099, C100.
The run log spans **06:41:09.997Z to 06:46:35.427Z** on 2026-09-18. Each case had
a fresh owned namespace and one attempt. All four recorded phase statuses are
`passed` in all ten terminal states. There were no scenario retries or model calls.

The [batch runner](../src/cluster/provisioning/aksCandidateBatch.ts) creates only
owned namespace-scoped fixtures, except C001's two uniquely named, owned CRDs.
It requires explicit kubeconfig/context, immutable probe image, and mutation
acknowledgement. Observation loops have 90-attempt/90-second bounds; in-progress
commands may extend a loop. Kubectl requests are limited to ten seconds and
processes to 90 seconds. These are local bounds, not guarantees about completion
of cluster-side work. The identity proxy-init requires networking capabilities;
do not apply the CoreDNS case's non-root/no-capabilities assumptions to this batch.

Per-case cleanup checks the recorded endpoint, owner labels, and recorded UIDs,
deletes only recognized resource names, and independently checks absence. It does
not install or remove the separately owned shared webhook. After all cases, an
independent check found no namespaces or CRDs with the research owner label and
looked up each of the **12 recorded owned resources** individually: all absent.
The dedicated cluster and node container were then removed. Completion was
independently recorded at **06:53:23.870Z**. No cluster, test workloads, or shared
webhook from this batch remains; the host runtime and unrelated eval resources
were not shut down.

## Verification And Provenance

Private artifacts: `.tmp/pr25-ten-live-20260918`. Each scenario's `attempt1`
directory contains original requests, baseline/fault/recovery observations,
component/admission metadata where relevant, and terminal state. The kubeconfig
remains private. Full phase artifacts are evaluator/research evidence, not
candidate-safe scored packets. Candidate/evaluator packet construction, exact
diagnosis alternatives, leakage review, and model controls still require work.

The recorded Git base was `3b025616950a7633fecfc69b2876b5e1a01157ad`; the new batch
implementation was uncommitted at collection time. The plan hashes and source
archive, rather than that base commit alone, identify the executed code. Current
batch code differs from the frozen source only by verified Prettier formatting;
the archive and original evidence were not rewritten.

| Artifact | SHA-256 |
| --- | --- |
| `plan-1.json` | `4f30237cbe53d9442dce173f2e939fbeab605dd1f3155aa17e3acecaaf181226` |
| `summary-1.json` | `73b813283bb8b05afd8148631977c0f79d00eb7374117469feda2caa5803e9c5` |
| `environment.json` | `8d9e5d639b628066342930d13327b29de75060946e8ed26457301f33522d23d5` |
| `sources-1.json` | `2fb230e74c2ea8dc31883792d65894a0689667a4ed9977ebad2b21762d0ea0e6` |
| `evidence-hashes.json` | `0c60e8832bb12ca9d9ef020cedc40d94d54ff0bd41ba9f1c289468080ad7344b` |
| `independent-cleanup.json` | `390f8432de18fbf9d84fc107f6b7011f066661df1ce2413e80892e77750ae531` |
| `cluster-cleanup.json` | `03bdcf7b600c5c50b668cacea6c6bc00631ea1fc62fc9b9835dcd06e193bb1a1` |

The upstream manifest SHA-256 is
`a29050f7b2b73ea1f9f65d6aa0e3c213e5ca65e2891a892c4d976597952ce587`.
The evidence-hash index covers the original requests, phase evidence, states,
environment, installation inputs, plan, log, and source snapshot. Separate cleanup
digests cover the independent checks and cluster deletion. Private case directories
are mode 0700 and their evidence files mode 0600.

Post-run checks independently asserted each saved fault and control condition, the
ten phase-state records, source snapshot hashes, and resource absence. The full
offline gate passed **410 tests**, formatting, typechecks, and catalogue freshness.
An initial formatting warning was corrected and the same gate rerun successfully.
Offline tests are not ten separate end-to-end lifecycle mocks; the saved live
observations provide the mechanism execution evidence. No browser E2E, cloud AKS
provisioning, Azure authentication, or paid model comparison is claimed.

## Remaining Work

Keep all cases pending scored qualification. For stronger verification, use a
supported client/server pair and a complete injected-image lock, then implement
the exact managed-addon or multi-webhook workflows where those are the source
claim. C098's two-request adaptation and C096's bounded observation must stay
explicit. C059 still needs its own live run. The other 89 candidates remain
unimplemented; these ten local passes do not change their status.