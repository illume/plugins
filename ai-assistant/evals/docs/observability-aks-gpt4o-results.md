# AKS Observability: Live GPT-4o Results

Run date: 2026-09-16. Related PR: https://github.com/illume/plugins/pull/25.

## Outcome

The scenarios did not both pass end to end. Both real AKS faults were induced
and read through the production observability tools. Neither enabled model
submission met the complete exact-fact diagnosis contract. NSG recovery passed;
autoscaler recovery failed on a concurrent Azure operation. Cleanup passed for
every attempt, and Azure confirmed the owned resource groups were absent.

| Scenario | Observability enabled | Kubernetes only | Recovery | Cleanup |
| --- | --- | --- | --- | --- |
| `aks-private-backend-nsg-deny-v1` | Partial (18.682 s) | Abstain (9.291 s) | Passed | Passed |
| `aks-autoscaler-max-count-v1` | Fail: unsupported fact (17.587 s) | Fail: no accepted cause (7.831 s) | Failed | Passed |

Durations are candidate-session wall times, not provisioning times. All four
submissions were schema-valid; no candidate timed out or attempted a rejected
tool call. The observed six tool calls succeeded and were classified read-only.
All four no-action/safety checks passed. These checks are not a general security
audit or proof that an arbitrary candidate adapter is sandboxed.

## Model And Method

- Actual AI Assistant `LangChainAssistantSession`, fresh for each callback, using
  the same Azure `gpt-4o` deployment as the earlier Phase 2 run. Telemetry confirmed
  model `gpt-4o-2024-11-20` for every request.
- Two scenarios, one enabled session and one Kubernetes-only session each,
  always enabled first. Eight observed model requests across the four sessions.
  No diagnosis was retried to improve its score, repaired after generation, or
  regraded under relaxed facts.
- New disposable resources in `eastus2`, `Standard_A2_v2` AKS nodes because this
  subscription disallows the default `Standard_D2s_v5` there. CPU demand was
  derived from actual node allocatable CPU. Backend: `Standard_B1s` and pinned
  Gen1 Ubuntu image `Canonical:0001-com-ubuntu-server-jammy:22_04-lts:22.04.202608060`.
- The model invoked the eval's resource-scoped tools through the real assistant
  engine. Azure calls used the production tool HTTP implementations; Kubernetes
  reads returned actual fault-window Pod/event snapshots. Requests and the JSON
  submission schema were supplied, not the oracle, expected diagnosis, or setup
  commands. This measures bounded retrieval and interpretation, not unrestricted
  discovery or the browser UI workflow.
- Each successful read received fresh evidence IDs. The existing exact-fact
  grader required field/value matches against cited observations. The candidate
  prompt and grading contract were fixed before scored sessions began.

This is a small exploratory/debugging run, outside the locked Phase 2 comparison.
It does not support a statistical capability advantage. The autoscaler trial's
failed recovery prevents a full lifecycle-valid claim even though its model
responses were captured. No model result is represented as independent scenario
qualification.

## Diagnosis Details

**NSG enabled:** the model correctly cited `securityRules/block-aks`, `Deny`,
the AKS source subnet, backend destination, and TCP port range. All asserted
facts were grounded. It omitted the required `direction: Inbound` fact at
`/value/0/effectiveSecurityRules/0/direction`, so the unchanged grader returned
partial rather than pass. The Kubernetes-only response expressed uncertainty
and asserted no cause.

**Autoscaler enabled:** the model cited `count=1`, `maxCount=1`, and
`enableAutoScaling=true`, but asserted CPU at
`/pods/items/0/spec/resources/requests/cpu`. The observed path was
`/pods/items/0/spec/containers/0/resources/requests/cpu`. The incorrect pointer
is an unsupported fact, which takes precedence over partial credit. It also
omitted the required pool identity `/value/1/name: target`. The Kubernetes-only
answer cited scheduling symptoms but did not establish the Azure pool settings.

Kubernetes clues were not hidden: scheduling events can expose autoscaler
behavior. Requiring ARM facts makes this a source-grounded diagnosis task, not
proof that a human could never infer the cause from Kubernetes alone.

## Infrastructure Findings

1. First NSG attempt: cluster provisioned, but backend creation failed because
   explicit `securityType: Standard` required an unregistered subscription
   feature. Switched to a verified Gen1 image without that property; did not
   register subscription-wide features. No model trial ran. Cleanup passed.
2. Second NSG attempt: baseline and induced-fault oracles passed, but the native
   effective-NSG tool returned HTTP 400. Its `2024-09-01` API version was absent
   from Azure's supported NIC API versions. Corrected it to `2024-07-01` and added
   a production regression test. No model trial ran. Cleanup passed.
3. Third NSG attempt: baseline, fault, live tool reads, both model sessions,
   connectivity recovery, and deletion all completed.
4. Autoscaler attempt: baseline, CPU-limited Pending replica, ARM pool oracle,
   and both model sessions completed. Raising the maximum failed with
   `OperationNotAllowed`: an AKS `PutExtensionAddonHandler.PUT` operation was in
   progress. The cluster was subsequently deleted successfully. A bounded retry
   for this specific conflict was added and unit-tested **after** this run; it
   has not been verified live and does not change the recorded failed recovery.

Two preliminary model/tool-call preflights were not scenario trials. The first
returned an invalid extra `$id` field; the second passed after the adapter prompt
clarified JSON instance versus schema metadata. Both are retained separately.

## Retained Evidence

Private artifacts are under the workspace `.tmp/` directory, outside committed
source. Each run retains its plan/source hashes, lifecycle, cleanup state, oracle,
original assistant text, model/tool telemetry, and scored observations. Reports
below identify these records without publishing credentials or cloud inventories.

- Setup failure: `pr25-aks-nsg-gpt4o-20260916`.
- Tool failure: `pr25-aks-nsg-gpt4o-b-20260916`.
- Scored NSG run: `pr25-aks-nsg-gpt4o-c-20260916`.
- Scored autoscaler run: `pr25-aks-capacity-gpt4o-20260916`.
- Preflights: `pr25-gpt4o-preflight-20260916` and `pr25-gpt4o-preflight-b-20260916`.

SHA-256 digests of the scored artifacts (NSG/capacity names refer to the two
scored run directories above):

| Run | Artifact | SHA-256 |
| --- | --- | --- |
| NSG | `enabled.json` | `9756c413f63ab3c2390388728298afc4e3151b2f4c3545e0a3f304b376b138e2` |
| NSG | `kubernetes-only.json` | `42d5be56249750f876703689262d39aa5e42bed0cd6af36fa5a98da3b8b464db` |
| NSG | `resources/lifecycle.json` | `d0430876b4745f8e007a417af43a7cf43a09b2fb319faeb31c7a1a4d13a22a5a` |
| Capacity | `enabled.json` | `339a6a45533c0964d0585335f36ac707149af772ffaef7adc027c1e47e467a78` |
| Capacity | `kubernetes-only.json` | `3db1121db8a4dd7c8d890e8dd167c9a4ebef3b6f990187b75a29265e230b7883` |
| Capacity | `resources/lifecycle.json` | `af44d3ac6e8a3d6be2355c854ce530bddb4881f63fdfb3d37a9e73f042066a3e` |

Both scored plans recorded the same source hashes, relative to `ai-assistant/evals`:

| Source | SHA-256 |
| --- | --- |
| `src/candidates/headlampObservability.ts` | `ecb5ebe6ba34563e078ac12e93b4b452d5bf863b839bf10b76c82630583c4b6a` |
| `src/runner/observabilityEvaluation.ts` | `b1c5ecb23008b3157d471623fc8bbc9c1b1367130f161a865423fa440f934d6e` |
| `src/cluster/provisioning/aksObservability.ts` | `dedbee5a4eef2564289c9af0aaac3ee09b92c3faa87332572b4e2903ebe6910a` |
| `../packages/ai-common/src/tools/observability/AzureAksTools.ts` | `107c772dfda33ef51f27da93818218ef889ead4418d8aa8873c68c815a4502a0` |
| `../packages/ai-common/src/assistant/LangChainAssistantSession.ts` | `c8f891ab1ea34a14510b2e3f096d36f89e4b5d77d6166f0eabf95975a8d2d1bd` |

The provisioning source now differs because of the post-run recovery retry.
The original result artifacts and reported scores remain unchanged.