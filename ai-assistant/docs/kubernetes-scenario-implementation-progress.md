# Scenarios Goal implementation progress

Status: agent-authored, qualification pending, 2026-09-20

The implementation batches contain 200 complete draft bundles under
`evals/scenario-drafts/`. Each bundle has a scenario manifest, candidate packet,
evaluator packet, setup manifest, and exact coverage metadata. The separate draft
root keeps the active qualified roster fixed at 275.
Surveyed tools are not installed or executed; their rule IDs provide source provenance
for normalized predicates evaluated from the generated Kubernetes evidence.

## Coverage added

- Rule occurrences authored: 1780
- Tool-local semantic groups authored: 440
- Tools represented: 12
- Qualified scenarios added: 0

| Source catalogue                         | Authored scenarios | Rules | Rule progress | Groups | Group progress |
| ---------------------------------------- | -----------------: | ----: | ------------: | -----: | -------------: |
| registrations/rule-gap-scenarios-v1.json |                100 |  1055 |        100.0% |    179 |         100.0% |
| registrations/rule-gap-scenarios-v2.json |                 42 |   530 |        100.0% |    156 |         100.0% |
| registrations/rule-gap-scenarios-v3.json |                 58 |   195 |        100.0% |    106 |         100.0% |

| Tool                  | Authored rule occurrences |
| --------------------- | ------------------------: |
| falco                 |                        69 |
| headlamp              |                         7 |
| kube-bench            |                      1370 |
| kube-linter           |                        45 |
| kube-score            |                        24 |
| kubernetes-mixin      |                        41 |
| kubescape             |                        50 |
| kubevious             |                        13 |
| node-problem-detector |                        52 |
| pluto                 |                        42 |
| polaris               |                        34 |
| popeye                |                        33 |

| Scenario                                             | Rules | Groups | Tools | Exact coverage                                                                                       |
| ---------------------------------------------------- | ----: | -----: | ----: | ---------------------------------------------------------------------------------------------------- |
| rule-gap-writable-container-root-filesystem          |     4 |      4 |     4 | [rules](../evals/scenario-drafts/rule-gap-writable-container-root-filesystem/coverage.json)          |
| rule-gap-net-raw-capability                          |   117 |      9 |     4 | [rules](../evals/scenario-drafts/rule-gap-net-raw-capability/coverage.json)                          |
| rule-gap-host-network-namespace                      |    47 |      4 |     4 | [rules](../evals/scenario-drafts/rule-gap-host-network-namespace/coverage.json)                      |
| rule-gap-cluster-admin-rolebinding                   |    52 |      6 |     4 | [rules](../evals/scenario-drafts/rule-gap-cluster-admin-rolebinding/coverage.json)                   |
| rule-gap-namespace-without-network-policy            |    29 |      6 |     6 | [rules](../evals/scenario-drafts/rule-gap-namespace-without-network-policy/coverage.json)            |
| rule-gap-dangling-network-policy-selector            |     5 |      5 |     5 | [rules](../evals/scenario-drafts/rule-gap-dangling-network-policy-selector/coverage.json)            |
| rule-gap-missing-liveness-probe                      |     4 |      4 |     4 | [rules](../evals/scenario-drafts/rule-gap-missing-liveness-probe/coverage.json)                      |
| rule-gap-missing-readiness-probe                     |     4 |      4 |     4 | [rules](../evals/scenario-drafts/rule-gap-missing-readiness-probe/coverage.json)                     |
| rule-gap-cpu-requirements-missing                    |     3 |      3 |     3 | [rules](../evals/scenario-drafts/rule-gap-cpu-requirements-missing/coverage.json)                    |
| rule-gap-memory-requirements-missing                 |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-memory-requirements-missing/coverage.json)                 |
| rule-gap-latest-image-tag                            |     3 |      3 |     3 | [rules](../evals/scenario-drafts/rule-gap-latest-image-tag/coverage.json)                            |
| rule-gap-image-not-pinned                            |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-image-not-pinned/coverage.json)                            |
| rule-gap-insufficient-replicas                       |     4 |      4 |     4 | [rules](../evals/scenario-drafts/rule-gap-insufficient-replicas/coverage.json)                       |
| rule-gap-dangling-ingress-backend                    |     5 |      5 |     5 | [rules](../evals/scenario-drafts/rule-gap-dangling-ingress-backend/coverage.json)                    |
| rule-gap-missing-service-account                     |     3 |      3 |     3 | [rules](../evals/scenario-drafts/rule-gap-missing-service-account/coverage.json)                     |
| rule-gap-duplicate-environment-variable              |     3 |      3 |     3 | [rules](../evals/scenario-drafts/rule-gap-duplicate-environment-variable/coverage.json)              |
| rule-gap-unsafe-probe-suite                          |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-unsafe-probe-suite/coverage.json)                          |
| rule-gap-liveness-port-not-exposed                   |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-liveness-port-not-exposed/coverage.json)                   |
| rule-gap-readiness-port-not-exposed                  |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-readiness-port-not-exposed/coverage.json)                  |
| rule-gap-startup-port-not-exposed                    |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-startup-port-not-exposed/coverage.json)                    |
| rule-gap-cpu-request-missing                         |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-cpu-request-missing/coverage.json)                         |
| rule-gap-cpu-limit-missing                           |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-cpu-limit-missing/coverage.json)                           |
| rule-gap-memory-request-missing                      |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-memory-request-missing/coverage.json)                      |
| rule-gap-memory-limit-missing                        |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-memory-limit-missing/coverage.json)                        |
| rule-gap-image-pull-policy                           |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-image-pull-policy/coverage.json)                           |
| rule-gap-blocked-image-registry                      |     3 |      3 |     2 | [rules](../evals/scenario-drafts/rule-gap-blocked-image-registry/coverage.json)                      |
| rule-gap-missing-pod-disruption-budget               |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-missing-pod-disruption-budget/coverage.json)               |
| rule-gap-pdb-policy-missing                          |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-pdb-policy-missing/coverage.json)                          |
| rule-gap-pdb-blocks-all-disruptions                  |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-pdb-blocks-all-disruptions/coverage.json)                  |
| rule-gap-pdb-exceeds-hpa-minimum                     |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-pdb-exceeds-hpa-minimum/coverage.json)                     |
| rule-gap-missing-pod-anti-affinity                   |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-missing-pod-anti-affinity/coverage.json)                   |
| rule-gap-missing-topology-spread                     |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-missing-topology-spread/coverage.json)                     |
| rule-gap-non-rolling-deployment                      |     3 |      3 |     3 | [rules](../evals/scenario-drafts/rule-gap-non-rolling-deployment/coverage.json)                      |
| rule-gap-workload-selector-mismatch                  |     3 |      3 |     3 | [rules](../evals/scenario-drafts/rule-gap-workload-selector-mismatch/coverage.json)                  |
| rule-gap-dangling-hpa-target                         |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-dangling-hpa-target/coverage.json)                         |
| rule-gap-ingress-without-valid-tls                   |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-ingress-without-valid-tls/coverage.json)                   |
| rule-gap-deprecated-certificate-signing-request      |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-certificate-signing-request/coverage.json)      |
| rule-gap-deprecated-cronjob-apis                     |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-cronjob-apis/coverage.json)                     |
| rule-gap-deprecated-daemonset-apis                   |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-daemonset-apis/coverage.json)                   |
| rule-gap-deprecated-deployment-apis                  |     3 |      3 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-deployment-apis/coverage.json)                  |
| rule-gap-deprecated-hpa-apis                         |     4 |      4 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-hpa-apis/coverage.json)                         |
| rule-gap-deprecated-ingress-apis                     |     3 |      3 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-ingress-apis/coverage.json)                     |
| rule-gap-deprecated-pdb-apis                         |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-pdb-apis/coverage.json)                         |
| rule-gap-deprecated-pod-security-policy-apis         |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-pod-security-policy-apis/coverage.json)         |
| rule-gap-deprecated-priority-class-apis              |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-priority-class-apis/coverage.json)              |
| rule-gap-deprecated-replicaset-apis                  |     3 |      3 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-replicaset-apis/coverage.json)                  |
| rule-gap-deprecated-runtime-class-api                |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-runtime-class-api/coverage.json)                |
| rule-gap-deprecated-statefulset-apis                 |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-statefulset-apis/coverage.json)                 |
| rule-gap-deprecated-storage-class-api                |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-storage-class-api/coverage.json)                |
| rule-gap-deprecated-volume-attachment-api            |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-volume-attachment-api/coverage.json)            |
| rule-gap-pod-crash-loop                              |     3 |      3 |     3 | [rules](../evals/scenario-drafts/rule-gap-pod-crash-loop/coverage.json)                              |
| rule-gap-pod-containers-not-ready                    |     3 |      3 |     3 | [rules](../evals/scenario-drafts/rule-gap-pod-containers-not-ready/coverage.json)                    |
| rule-gap-pod-evicted                                 |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-pod-evicted/coverage.json)                                 |
| rule-gap-node-not-ready                              |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-node-not-ready/coverage.json)                              |
| rule-gap-node-unreachable                            |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-node-unreachable/coverage.json)                            |
| rule-gap-node-pressure                               |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-node-pressure/coverage.json)                               |
| rule-gap-kubelet-unhealthy                           |     3 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-kubelet-unhealthy/coverage.json)                           |
| rule-gap-persistent-volume-phase-errors              |     3 |      3 |     2 | [rules](../evals/scenario-drafts/rule-gap-persistent-volume-phase-errors/coverage.json)              |
| rule-gap-persistent-volume-claim-phase-errors        |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-persistent-volume-claim-phase-errors/coverage.json)        |
| rule-gap-persistent-volume-filling-up                |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-persistent-volume-filling-up/coverage.json)                |
| rule-gap-persistent-volume-inodes-filling-up         |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-persistent-volume-inodes-filling-up/coverage.json)         |
| rule-gap-job-failed                                  |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-job-failed/coverage.json)                                  |
| rule-gap-job-not-completed                           |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-job-not-completed/coverage.json)                           |
| rule-gap-api-error-budget-burn                       |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-api-error-budget-burn/coverage.json)                       |
| rule-gap-cluster-certificate-expiration              |     3 |      3 |     1 | [rules](../evals/scenario-drafts/rule-gap-cluster-certificate-expiration/coverage.json)              |
| rule-gap-daemonset-rollout-failure                   |     3 |      3 |     1 | [rules](../evals/scenario-drafts/rule-gap-daemonset-rollout-failure/coverage.json)                   |
| rule-gap-statefulset-rollout-failure                 |     3 |      3 |     1 | [rules](../evals/scenario-drafts/rule-gap-statefulset-rollout-failure/coverage.json)                 |
| rule-gap-cluster-resource-overcommit                 |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-cluster-resource-overcommit/coverage.json)                 |
| rule-gap-pod-image-pull-failure                      |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-pod-image-pull-failure/coverage.json)                      |
| rule-gap-pod-invalid-config-reference                |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-pod-invalid-config-reference/coverage.json)                |
| rule-gap-pod-oom-killed                              |     4 |      3 |     3 | [rules](../evals/scenario-drafts/rule-gap-pod-oom-killed/coverage.json)                              |
| rule-gap-pod-unschedulable                           |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-pod-unschedulable/coverage.json)                           |
| rule-gap-readonly-node-filesystem                    |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-readonly-node-filesystem/coverage.json)                    |
| rule-gap-corrupt-container-image                     |     3 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-corrupt-container-image/coverage.json)                     |
| rule-gap-containerd-unhealthy                        |     2 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-containerd-unhealthy/coverage.json)                        |
| rule-gap-docker-unhealthy                            |     2 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-docker-unhealthy/coverage.json)                            |
| rule-gap-frequent-containerd-restarts                |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-frequent-containerd-restarts/coverage.json)                |
| rule-gap-frequent-docker-restarts                    |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-frequent-docker-restarts/coverage.json)                    |
| rule-gap-frequent-kubelet-restarts                   |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-frequent-kubelet-restarts/coverage.json)                   |
| rule-gap-node-dns-unreachable                        |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-node-dns-unreachable/coverage.json)                        |
| rule-gap-node-conntrack-full                         |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-node-conntrack-full/coverage.json)                         |
| rule-gap-falco-privileged-host-filesystem-escape     |   128 |     27 |     7 | [rules](../evals/scenario-drafts/rule-gap-falco-privileged-host-filesystem-escape/coverage.json)     |
| rule-gap-falco-namespace-breakout                    |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-falco-namespace-breakout/coverage.json)                    |
| rule-gap-falco-web-server-netcat-reverse-shell       |     6 |      6 |     1 | [rules](../evals/scenario-drafts/rule-gap-falco-web-server-netcat-reverse-shell/coverage.json)       |
| rule-gap-falco-staged-payload-installation           |    10 |     10 |     1 | [rules](../evals/scenario-drafts/rule-gap-falco-staged-payload-installation/coverage.json)           |
| rule-gap-falco-gpu-cryptominer                       |     5 |      5 |     1 | [rules](../evals/scenario-drafts/rule-gap-falco-gpu-cryptominer/coverage.json)                       |
| rule-gap-falco-credential-search-ssh-persistence     |     5 |      5 |     1 | [rules](../evals/scenario-drafts/rule-gap-falco-credential-search-ssh-persistence/coverage.json)     |
| rule-gap-falco-shell-profile-persistence             |     3 |      3 |     1 | [rules](../evals/scenario-drafts/rule-gap-falco-shell-profile-persistence/coverage.json)             |
| rule-gap-falco-cron-persistence                      |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-falco-cron-persistence/coverage.json)                      |
| rule-gap-falco-in-cluster-kubectl-exfiltration       |    54 |      9 |     5 | [rules](../evals/scenario-drafts/rule-gap-falco-in-cluster-kubectl-exfiltration/coverage.json)       |
| rule-gap-falco-ec2-metadata-access                   |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-falco-ec2-metadata-access/coverage.json)                   |
| rule-gap-falco-interactive-container-network-recon   |     9 |      9 |     1 | [rules](../evals/scenario-drafts/rule-gap-falco-interactive-container-network-recon/coverage.json)   |
| rule-gap-falco-truncate-logs-and-shell-history       |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-falco-truncate-logs-and-shell-history/coverage.json)       |
| rule-gap-falco-malicious-npm-network-tool            |     3 |      3 |     1 | [rules](../evals/scenario-drafts/rule-gap-falco-malicious-npm-network-tool/coverage.json)            |
| rule-gap-container-start-rollout-stalled             |     3 |      3 |     1 | [rules](../evals/scenario-drafts/rule-gap-container-start-rollout-stalled/coverage.json)             |
| rule-gap-hpa-capacity-mismatch                       |     6 |      6 |     3 | [rules](../evals/scenario-drafts/rule-gap-hpa-capacity-mismatch/coverage.json)                       |
| rule-gap-legacy-rbac-v1beta1-bundle                  |     8 |      8 |     1 | [rules](../evals/scenario-drafts/rule-gap-legacy-rbac-v1beta1-bundle/coverage.json)                  |
| rule-gap-anonymous-kubelet-auth                      |    67 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-anonymous-kubelet-auth/coverage.json)                      |
| rule-gap-alwaysallow-authorization                   |    77 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-alwaysallow-authorization/coverage.json)                   |
| rule-gap-node-authorizer-missing                     |    29 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-node-authorizer-missing/coverage.json)                     |
| rule-gap-rbac-authorizer-missing                     |    29 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-rbac-authorizer-missing/coverage.json)                     |
| rule-gap-etcd-client-cert-auth-disabled              |    33 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-etcd-client-cert-auth-disabled/coverage.json)              |
| rule-gap-etcd-peer-cert-auth-disabled                |    33 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-etcd-peer-cert-auth-disabled/coverage.json)                |
| rule-gap-alwaysadmit-enabled                         |    33 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-alwaysadmit-enabled/coverage.json)                         |
| rule-gap-serviceaccount-admission-missing            |    33 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-serviceaccount-admission-missing/coverage.json)            |
| rule-gap-namespace-lifecycle-admission-missing       |    33 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-namespace-lifecycle-admission-missing/coverage.json)       |
| rule-gap-node-restriction-admission-missing          |    33 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-node-restriction-admission-missing/coverage.json)          |
| rule-gap-event-rate-limit-admission-missing          |    28 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-event-rate-limit-admission-missing/coverage.json)          |
| rule-gap-always-pull-images-admission-missing        |    32 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-always-pull-images-admission-missing/coverage.json)        |
| rule-gap-secret-encryption-provider-missing          |    29 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-secret-encryption-provider-missing/coverage.json)          |
| rule-gap-audit-log-path-missing                      |    32 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-audit-log-path-missing/coverage.json)                      |
| rule-gap-audit-log-retention-too-short               |    29 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-audit-log-retention-too-short/coverage.json)               |
| rule-gap-audit-log-backups-too-few                   |    29 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-audit-log-backups-too-few/coverage.json)                   |
| rule-gap-audit-log-file-too-small                    |    29 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-audit-log-file-too-small/coverage.json)                    |
| rule-gap-service-account-token-lookup-disabled       |    33 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-service-account-token-lookup-disabled/coverage.json)       |
| rule-gap-etcd-client-keypair-missing                 |    33 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-etcd-client-keypair-missing/coverage.json)                 |
| rule-gap-component-profiling-enabled                 |    86 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-component-profiling-enabled/coverage.json)                 |
| rule-gap-kubelet-read-only-port                      |    15 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-kubelet-read-only-port/coverage.json)                      |
| rule-gap-unbounded-streaming-idle-timeout            |    45 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-unbounded-streaming-idle-timeout/coverage.json)            |
| rule-gap-kernel-default-protection-disabled          |    21 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-kernel-default-protection-disabled/coverage.json)          |
| rule-gap-event-qps-throttles-auditability            |    12 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-event-qps-throttles-auditability/coverage.json)            |
| rule-gap-kubelet-server-cert-rotation-disabled       |    43 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-kubelet-server-cert-rotation-disabled/coverage.json)       |
| rule-gap-npd-kernel-null-pointer                     |     2 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-kernel-null-pointer/coverage.json)                     |
| rule-gap-npd-kernel-divide-error                     |     2 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-kernel-divide-error/coverage.json)                     |
| rule-gap-npd-docker-task-stall                       |     4 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-docker-task-stall/coverage.json)                       |
| rule-gap-npd-unregister-netdevice-burst              |     3 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-unregister-netdevice-burst/coverage.json)              |
| rule-gap-npd-disk-bad-block                          |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-disk-bad-block/coverage.json)                          |
| rule-gap-npd-ext4-error                              |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-ext4-error/coverage.json)                              |
| rule-gap-npd-ext4-warning                            |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-ext4-warning/coverage.json)                            |
| rule-gap-npd-buffer-io-error                         |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-buffer-io-error/coverage.json)                         |
| rule-gap-npd-xfs-shutdown                            |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-xfs-shutdown/coverage.json)                            |
| rule-gap-npd-cper-corrected                          |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-cper-corrected/coverage.json)                          |
| rule-gap-npd-cper-recoverable                        |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-cper-recoverable/coverage.json)                        |
| rule-gap-npd-cper-fatal                              |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-cper-fatal/coverage.json)                              |
| rule-gap-npd-memory-read-error                       |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-memory-read-error/coverage.json)                       |
| rule-gap-npd-corrupt-docker-overlay                  |     2 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-corrupt-docker-overlay/coverage.json)                  |
| rule-gap-npd-docker-container-startup-failure        |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-docker-container-startup-failure/coverage.json)        |
| rule-gap-npd-windows-container-creation-failure      |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-windows-container-creation-failure/coverage.json)      |
| rule-gap-npd-windows-hcs-empty-layerchain            |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-windows-hcs-empty-layerchain/coverage.json)            |
| rule-gap-npd-containerd-start                        |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-containerd-start/coverage.json)                        |
| rule-gap-npd-docker-start                            |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-docker-start/coverage.json)                            |
| rule-gap-npd-kubelet-start                           |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-kubelet-start/coverage.json)                           |
| rule-gap-pod-shares-host-ipc                         |    47 |      4 |     4 | [rules](../evals/scenario-drafts/rule-gap-pod-shares-host-ipc/coverage.json)                         |
| rule-gap-pod-shares-host-pid                         |    48 |      5 |     4 | [rules](../evals/scenario-drafts/rule-gap-pod-shares-host-pid/coverage.json)                         |
| rule-gap-container-allows-privilege-escalation       |     3 |      3 |     3 | [rules](../evals/scenario-drafts/rule-gap-container-allows-privilege-escalation/coverage.json)       |
| rule-gap-container-unmasks-proc                      |     3 |      3 |     3 | [rules](../evals/scenario-drafts/rule-gap-container-unmasks-proc/coverage.json)                      |
| rule-gap-container-missing-seccomp-profile           |     6 |      4 |     3 | [rules](../evals/scenario-drafts/rule-gap-container-missing-seccomp-profile/coverage.json)           |
| rule-gap-container-image-tag-omitted                 |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-container-image-tag-omitted/coverage.json)                 |
| rule-gap-service-uses-nodeport                       |     3 |      3 |     3 | [rules](../evals/scenario-drafts/rule-gap-service-uses-nodeport/coverage.json)                       |
| rule-gap-hpa-minimum-replicas-too-low                |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-hpa-minimum-replicas-too-low/coverage.json)                |
| rule-gap-secret-exposed-through-environment          |     5 |      5 |     3 | [rules](../evals/scenario-drafts/rule-gap-secret-exposed-through-environment/coverage.json)          |
| rule-gap-pod-uses-default-service-account            |     4 |      4 |     3 | [rules](../evals/scenario-drafts/rule-gap-pod-uses-default-service-account/coverage.json)            |
| rule-gap-rbac-subject-can-create-pods                |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-rbac-subject-can-create-pods/coverage.json)                |
| rule-gap-rbac-subject-can-read-secrets               |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-rbac-subject-can-read-secrets/coverage.json)               |
| rule-gap-rbac-role-uses-wildcards                    |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-rbac-role-uses-wildcards/coverage.json)                    |
| rule-gap-rbac-subject-can-exec-into-pods             |     3 |      3 |     2 | [rules](../evals/scenario-drafts/rule-gap-rbac-subject-can-exec-into-pods/coverage.json)             |
| rule-gap-container-references-missing-configmap      |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-container-references-missing-configmap/coverage.json)      |
| rule-gap-container-references-missing-secret         |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-container-references-missing-secret/coverage.json)         |
| rule-gap-pod-references-missing-service-account      |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-pod-references-missing-service-account/coverage.json)      |
| rule-gap-rolebinding-references-missing-role         |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-rolebinding-references-missing-role/coverage.json)         |
| rule-gap-servicemonitor-selector-matches-no-service  |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-servicemonitor-selector-matches-no-service/coverage.json)  |
| rule-gap-hpa-references-missing-target               |     3 |      3 |     3 | [rules](../evals/scenario-drafts/rule-gap-hpa-references-missing-target/coverage.json)               |
| rule-gap-deployment-has-no-pdb                       |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-deployment-has-no-pdb/coverage.json)                       |
| rule-gap-statefulset-has-no-pdb                      |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-statefulset-has-no-pdb/coverage.json)                      |
| rule-gap-pdb-omits-unhealthy-eviction-policy         |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-pdb-omits-unhealthy-eviction-policy/coverage.json)         |
| rule-gap-cronjob-misses-starting-deadline            |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-cronjob-misses-starting-deadline/coverage.json)            |
| rule-gap-ingress-has-no-tls                          |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-ingress-has-no-tls/coverage.json)                          |
| rule-gap-ingress-references-missing-service          |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-ingress-references-missing-service/coverage.json)          |
| rule-gap-gateway-references-missing-class            |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-gateway-references-missing-class/coverage.json)            |
| rule-gap-httproute-references-missing-backend        |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-httproute-references-missing-backend/coverage.json)        |
| rule-gap-pod-mounts-container-runtime-socket         |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-pod-mounts-container-runtime-socket/coverage.json)         |
| rule-gap-pod-sets-unsafe-sysctl                      |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-pod-sets-unsafe-sysctl/coverage.json)                      |
| rule-gap-pod-misses-priority-class                   |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-pod-misses-priority-class/coverage.json)                   |
| rule-gap-container-binds-host-port                   |     2 |      2 |     2 | [rules](../evals/scenario-drafts/rule-gap-container-binds-host-port/coverage.json)                   |
| rule-gap-cpu-throttling-sustained                    |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-cpu-throttling-sustained/coverage.json)                    |
| rule-gap-aggregated-api-unavailable                  |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-aggregated-api-unavailable/coverage.json)                  |
| rule-gap-deployment-generation-stale                 |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-deployment-generation-stale/coverage.json)                 |
| rule-gap-kubelet-certificate-renewal-fails           |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-kubelet-certificate-renewal-fails/coverage.json)           |
| rule-gap-kubelet-pleg-duration-high                  |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-kubelet-pleg-duration-high/coverage.json)                  |
| rule-gap-pod-startup-latency-high                    |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-pod-startup-latency-high/coverage.json)                    |
| rule-gap-node-readiness-flaps                        |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-node-readiness-flaps/coverage.json)                        |
| rule-gap-resource-quota-exceeded                     |     3 |      3 |     1 | [rules](../evals/scenario-drafts/rule-gap-resource-quota-exceeded/coverage.json)                     |
| rule-gap-fileless-memfd-execution                    |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-fileless-memfd-execution/coverage.json)                    |
| rule-gap-release-agent-container-escape              |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-release-agent-container-escape/coverage.json)              |
| rule-gap-container-loads-kernel-module               |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-container-loads-kernel-module/coverage.json)               |
| rule-gap-process-uses-ptrace                         |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-process-uses-ptrace/coverage.json)                         |
| rule-gap-process-reads-proc-environ                  |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-process-reads-proc-environ/coverage.json)                  |
| rule-gap-process-sets-setuid-bit                     |     2 |      2 |     1 | [rules](../evals/scenario-drafts/rule-gap-process-sets-setuid-bit/coverage.json)                     |
| rule-gap-sensitive-file-symlink-created              |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-sensitive-file-symlink-created/coverage.json)              |
| rule-gap-npd-ntp-is-down                             |     2 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-ntp-is-down/coverage.json)                             |
| rule-gap-npd-iptables-version-mismatch               |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-iptables-version-mismatch/coverage.json)               |
| rule-gap-npd-kernel-oops                             |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-kernel-oops/coverage.json)                             |
| rule-gap-npd-vmcore-created                          |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-vmcore-created/coverage.json)                          |
| rule-gap-npd-windows-defender-threat                 |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-windows-defender-threat/coverage.json)                 |
| rule-gap-npd-windows-kubeproxy-unhealthy             |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-npd-windows-kubeproxy-unhealthy/coverage.json)             |
| rule-gap-deprecated-crd-v1beta1                      |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-crd-v1beta1/coverage.json)                      |
| rule-gap-deprecated-endpointslice-v1beta1            |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-endpointslice-v1beta1/coverage.json)            |
| rule-gap-deprecated-apiservice-v1beta1               |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-apiservice-v1beta1/coverage.json)               |
| rule-gap-deprecated-validating-webhook-v1beta1       |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-validating-webhook-v1beta1/coverage.json)       |
| rule-gap-deprecated-cert-manager-certificate-v1beta1 |     1 |      1 |     1 | [rules](../evals/scenario-drafts/rule-gap-deprecated-cert-manager-certificate-v1beta1/coverage.json) |

## Next qualification steps

1. Generate generic Kubernetes API observation logic for the declared field paths.
2. Run setup and healthy-control manifests on KWOK, minikube, and AKS as declared.
3. Capture evidence and run the evaluator oracle without exposing target rule names.
4. Promote each scenario only after all admission controls pass.

Governing objective: **Scenarios Goal**.
