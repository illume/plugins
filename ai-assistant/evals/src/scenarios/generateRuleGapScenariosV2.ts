/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SCENARIOS_GOAL } from './scenariosGoal.js';

const moduleRequire = createRequire(import.meta.url);
const prettier = moduleRequire('prettier') as {
  format(source: string, options: Record<string, unknown>): string;
  resolveConfig(filePath: string): Promise<Record<string, unknown> | null>;
};

type Category =
  | 'workload_configuration'
  | 'control_plane_host_hardening'
  | 'runtime_node_failure'
  | 'operations_deprecation';
type Feasibility = 'manifest_only' | 'live_cluster' | 'telemetry' | 'host' | 'runtime';
type SelectionTrack = 'falco_chain' | 'node_problem_detector' | 'policy' | 'operations';
type ClusterProfile = 'local-kwok' | 'local-minikube' | 'aks';

interface InventoryRule {
  rule_id: string;
  semantic_group_id: string;
  info_url: string;
  mapping_readiness?: 'direct_predicate' | 'requires_decomposition' | 'reference_only';
}

interface InventoryTool {
  tool_id: string;
  revision: string;
  mapping_readiness: 'direct_predicate' | 'requires_decomposition' | 'reference_only';
  rules: InventoryRule[];
}

interface Blueprint {
  slug: string;
  title: string;
  selectionTrack: SelectionTrack;
  category: Category;
  feasibility: Feasibility;
  resources: string[];
  setup: string;
  trigger: string;
  healthy: string;
  ruleIds: string[];
  semanticGroupIds?: string[];
  mechanisms?: string[];
  profiles?: ClusterProfile[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const inventoryPath = path.join(evalRoot, 'registrations', 'tool-rule-inventory-v1.json');
const mappingPath = path.join(evalRoot, 'registrations', 'tool-scenario-rule-mapping-v1.json');
const v1Path = path.join(evalRoot, 'registrations', 'rule-gap-scenarios-v1.json');
const outputPath = path.join(evalRoot, 'registrations', 'rule-gap-scenarios-v2.json');
const documentationPath = path.resolve(
  evalRoot,
  '..',
  'docs',
  'kubernetes-rule-gap-scenarios-v2.md'
);

const falco = (
  slug: string,
  title: string,
  resources: string[],
  setup: string,
  trigger: string,
  healthy: string,
  ruleIds: string[],
  semanticGroupIds: string[] = [],
  mechanisms?: string[]
): Blueprint => ({
  slug,
  title,
  selectionTrack: 'falco_chain',
  category: 'runtime_node_failure',
  feasibility: 'runtime',
  resources,
  setup,
  trigger,
  healthy,
  ruleIds,
  semanticGroupIds,
  mechanisms,
});

const npd = (
  slug: string,
  title: string,
  resources: string[],
  setup: string,
  trigger: string,
  healthy: string,
  ruleIds: string[],
  profiles?: ClusterProfile[]
): Blueprint => ({
  slug,
  title,
  selectionTrack: 'node_problem_detector',
  category: 'runtime_node_failure',
  feasibility: 'host',
  resources,
  setup,
  trigger,
  healthy,
  ruleIds,
  profiles,
});

const policy = (
  slug: string,
  title: string,
  resources: string[],
  trigger: string,
  healthy: string,
  ruleIds: string[],
  semanticGroupIds: string[] = [],
  feasibility: Feasibility = 'manifest_only'
): Blueprint => ({
  slug,
  title,
  selectionTrack: 'policy',
  category: 'workload_configuration',
  feasibility,
  resources,
  setup: `Create one isolated ${resources.join(
    ', '
  )} fixture satisfying the target predicate and a control differing only in that predicate.`,
  trigger,
  healthy,
  ruleIds,
  semanticGroupIds,
});

const operations = (
  slug: string,
  title: string,
  resources: string[],
  setup: string,
  trigger: string,
  healthy: string,
  ruleIds: string[],
  feasibility: Feasibility
): Blueprint => ({
  slug,
  title,
  selectionTrack: 'operations',
  category: 'operations_deprecation',
  feasibility,
  resources,
  setup,
  trigger,
  healthy,
  ruleIds,
});

const blueprints: Blueprint[] = [
  falco(
    'falco-privileged-host-filesystem-escape',
    'Privileged container mounts and inspects host storage',
    ['Pod', 'Node', 'hostPath', 'block device'],
    'Launch an explicitly root, privileged container with a writable hostPath and use mount and debugfs to inspect the exposed host block device.',
    'The privileged PID 1 starts with broad capabilities and a writable host mount, then opens the host path and raw device through mount and debugfs.',
    'A non-root, non-privileged container has no hostPath, added capabilities, or raw-device access.',
    [
      'falco:rule:launch-privileged-container:178d44e5e3b2',
      'falco:rule:container-run-as-root-user:0f00443cc5d9',
      'falco:rule:launch-excessively-capable-container:bc2e8040b513',
      'falco:rule:launch-sensitive-mount-container:1588c89d5f81',
      'falco:rule:container-access-to-host-sensitive-paths:5ed108f8e2ca',
      'falco:rule:privileged-container-device-access:5244f74ad8a2',
      'falco:rule:mount-launched-in-privileged-container:78aaf4e4e896',
      'falco:rule:debugfs-launched-in-privileged-container:ffdf716d7790',
      'kube-linter:check:privileged-container',
      'kube-score:check:container-security-context-privileged',
      'polaris:check:runAsPrivileged',
      'kubescape:rule:rule-privilege-escalation',
      'kube-linter:check:run-as-non-root',
      'kube-score:check:container-security-context-user-group-id',
      'polaris:check:runAsRootAllowed',
      'popeye:code:302',
      'popeye:code:306',
      'kubescape:rule:non-root-containers',
      'kube-linter:check:writable-host-mount',
      'polaris:check:hostPathSet',
      'kubescape:rule:alert-any-hostpath',
      'kubescape:rule:alert-rw-hostpath',
    ],
    [
      'kube-bench:semantic:minimize-the-admission-of-privileged-containers:a3f657a94c44',
      'kube-bench:semantic:minimize-the-admission-of-privileged-containers-not-scored:dd8899fd8160',
      'kube-bench:semantic:minimize-the-admission-of-root-containers:b4e3b53237b1',
      'kube-bench:semantic:minimize-the-admission-of-root-containers-not-scored:d351ac87d96f',
      'kube-bench:semantic:minimize-the-admission-of-hostpath-volumes:55a2439723fe',
    ],
    [
      'manifest parser',
      'normalized predicate evaluator',
      'Kubernetes API',
      'runtime syscall evidence capture',
    ]
  ),
  falco(
    'falco-namespace-breakout',
    'Container attempts namespace breakout',
    ['Pod', 'host PID namespace target'],
    'Run an unprivileged container helper that creates a user or mount namespace and then uses setns against a host process namespace.',
    'The container calls unshare without CAP_SYS_ADMIN and subsequently calls setns outside recognized runtime behavior.',
    'The workload performs neither unshare nor unauthorized setns operations.',
    [
      'falco:rule:change-namespace-privileges-via-unshare:f5eda80cc464',
      'falco:rule:change-thread-namespace:8c29b880e857',
    ]
  ),
  falco(
    'falco-web-server-netcat-reverse-shell',
    'Web server launches a netcat reverse shell',
    ['Deployment', 'Pod', 'callback listener'],
    'Have a containerized web-server process execute a shell that starts netcat with remote-command options and redirects its standard streams to a callback socket.',
    'A web-server ancestor spawns both a shell and netcat, whose command line enables remote execution and whose descriptors are duplicated onto a network socket.',
    'The web server never spawns shells, network tools, or socket-backed standard streams.',
    [
      'falco:rule:web-server-spawned-shell:a8283d223a6c',
      'falco:rule:web-server-spawned-suspicious-child-process:9f9902691d80',
      'falco:rule:reverse-shell-from-web-server:46f8fe13d8d9',
      'falco:rule:run-shell-untrusted:bfb7c5bdbdf5',
      'falco:rule:netcat-remote-code-execution-in-container:84c8a6959cba',
      'falco:rule:redirect-stdout-stdin-to-network-connection-in-container:9e554fed9f0a',
    ]
  ),
  falco(
    'falco-staged-payload-installation',
    'Downloaded payload is decoded, staged, and installed',
    ['Deployment', 'Pod', 'HTTP payload endpoint'],
    'Download an encoded payload into a hidden file under /dev/shm, decode it as executable content, chmod and execute it, then create a binary subdirectory and rename the implant into place.',
    'One payload chain downloads, creates, marks executable, runs, and installs an upper-layer binary through /dev/shm and a standard binary directory.',
    'The immutable container neither downloads nor creates, executes, or installs new binaries.',
    [
      'falco:rule:launch-ingress-remote-file-copy-tools-in-container:d97a598d969b',
      'falco:rule:decoding-payload-in-container:70c0494f20e6',
      'falco:rule:container-drift-detected-open-create:de420a538b7c',
      'falco:rule:container-drift-detected-chmod:3a4856596f35',
      'falco:rule:drop-and-execute-new-binary-in-container:5be09274e133',
      'falco:rule:execution-from-dev-shm:5d39e529b6c0',
      'falco:rule:create-hidden-files-or-directories:b7e28e6ea4c1',
      'falco:rule:mkdir-binary-dirs:058ac83c000e',
      'falco:rule:write-below-binary-dir:25d3b0fd8a70',
      'falco:rule:modify-binary-dirs:4f3667d0a033',
    ]
  ),
  falco(
    'falco-gpu-cryptominer',
    'GPU cryptominer profiles hardware and joins a pool',
    ['GPU-enabled Pod', 'GPU device', 'controlled miner endpoint'],
    'In a GPU-capable container, run a GPU query tool followed by a known miner whose command line and destination use Stratum and a recognized pool endpoint.',
    'The workload queries and opens a GPU device, executes a known miner, and connects to a miner pool using Stratum.',
    'A non-GPU workload launches no GPU utilities or miners and contacts no mining pool.',
    [
      'falco:rule:known-cryptominer-process-executed:b455a4edaec0',
      'falco:rule:detect-crypto-miners-using-the-stratum-protocol:658dfb6b5916',
      'falco:rule:detect-outbound-connections-to-common-miner-pool-ports:aaeaf015587e',
      'falco:rule:gpu-management-tool-run-in-container:8323fd65e9e4',
      'falco:rule:container-accessing-gpu-device:c64813dc59ac',
    ]
  ),
  falco(
    'falco-credential-search-ssh-persistence',
    'Credential search leads to SSH-key persistence',
    ['Pod', 'credential fixture', 'SSH directory'],
    'Use grep and find to locate private keys, AWS credentials, and SSH files, read the selected material, and append a controlled key to authorized_keys.',
    'An untrusted process searches credential patterns, reads SSH and sensitive files, then writes authorized_keys.',
    'The workload neither searches credential material nor modifies authorized_keys.',
    [
      'falco:rule:search-private-keys-or-passwords:426bdd939052',
      'falco:rule:find-aws-credentials:dcd0cbd4fbe7',
      'falco:rule:read-ssh-information:05b2fb21270d',
      'falco:rule:read-sensitive-file-untrusted:11b25034a58c',
      'falco:rule:adding-ssh-keys-to-authorized-keys:ce923c874a0c',
    ]
  ),
  falco(
    'falco-shell-profile-persistence',
    'Non-shell process modifies the root shell profile',
    ['Pod', 'root home fixture'],
    'Have a non-shell helper read and then append a controlled startup command to /root/.bashrc.',
    'A non-shell process opens a root shell configuration file for reading and writing.',
    'No non-shell process reads or changes root shell profiles.',
    [
      'falco:rule:read-shell-configuration-file:05ca18b4764d',
      'falco:rule:modify-shell-configuration-file:f9b107241e00',
      'falco:rule:write-below-root:81d6c2348fea',
    ]
  ),
  falco(
    'falco-cron-persistence',
    'Process installs a cron persistence file',
    ['Pod', 'cron directory fixture'],
    'Have an untrusted process create and write a controlled executable entry under /etc/cron.d.',
    'The same open-write operation creates a cron job below /etc.',
    'No untrusted process writes cron configuration.',
    ['falco:rule:schedule-cron-jobs:3d7559f0bc6b', 'falco:rule:write-below-etc:44d1fc654f0a']
  ),
  falco(
    'falco-in-cluster-kubectl-exfiltration',
    'In-cluster kubectl copies data from another Pod',
    ['helper Pod', 'victim Pod', 'ServiceAccount', 'controlled artifact'],
    'Run kubectl cp from an unprofiled helper container using an automatically mounted dedicated ServiceAccount token against a victim Pod containing a controlled artifact.',
    'Kubectl executes inside a container, uses its mounted ServiceAccount token to connect to kubernetes.default.svc, and causes entrypoint tar to read the victim artifact.',
    'The helper disables ServiceAccount token automount, has no Kubernetes client, and performs no Pod file copy.',
    [
      'falco:rule:kubernetes-client-tool-launched-in-container:54a1525afb42',
      'falco:rule:contact-k8s-api-server-from-container:d90e4c308e67',
      'falco:rule:exfiltrating-artifacts-via-kubernetes-control-plane:8645de6a93d1',
      'polaris:check:automountServiceAccountToken',
      'popeye:code:301',
      'kubescape:rule:automount-service-account',
      'kubescape:rule:serviceaccount-token-mount',
    ],
    [
      'kube-bench:semantic:ensure-that-service-account-tokens-are-only-mounted-where-necessary:643d7fa0e0f1',
      'kube-bench:semantic:ensure-that-service-account-tokens-are-only-mounted-where-necessary-not-scored:c802da5380d2',
    ],
    [
      'manifest parser',
      'normalized predicate evaluator',
      'Kubernetes API',
      'runtime syscall evidence capture',
    ]
  ),
  falco(
    'falco-ec2-metadata-access',
    'Container contacts the instance metadata address',
    ['Pod', 'routable metadata fixture'],
    'Have an ordinary application container connect to 169.254.169.254 outside the kube-system namespace.',
    'An outbound container connection has destination IP 169.254.169.254 and matches neither metadata allowlist.',
    'The application container never contacts the link-local metadata address.',
    [
      'falco:rule:contact-cloud-metadata-service-from-container:3a65e75ac7a5',
      'falco:rule:contact-ec2-instance-metadata-service-from-container:5d5712a95235',
    ]
  ),
  falco(
    'falco-interactive-container-network-recon',
    'Interactive Python scanner probes cluster and external networks',
    ['Pod', 'NodePort Service', 'controlled UDP responder'],
    'Open a TTY shell, run a basic identity command, then execute a Python scanner that opens AF_PACKET, sends unusual UDP probes externally and to a NodePort, and receives the replies.',
    'An interactive container session performs reconnaissance while one interpreted scanner creates a packet socket and exchanges nonstandard UDP traffic across local, NodePort, and external boundaries.',
    'The workload has no interactive shell or raw-socket scanner and communicates only with profiled local endpoints.',
    [
      'falco:rule:terminal-shell-in-container:e0e5b21bd369',
      'falco:rule:basic-interactive-reconnaissance:aba786e15715',
      'falco:rule:packet-socket-created-in-container:f751e8039a8c',
      'falco:rule:unexpected-udp-traffic:d77c31abed62',
      'falco:rule:network-connection-outside-local-subnet:0477732bfb31',
      'falco:rule:unexpected-k8s-nodeport-connection:735720a4fef8',
      'falco:rule:interpreted-procs-inbound-network-activity:bcbc8e61c3d9',
      'falco:rule:interpreted-procs-outbound-network-activity:619acdc41ceb',
      'falco:rule:unexpected-inbound-connection-source:760b20b46f45',
    ]
  ),
  falco(
    'falco-truncate-logs-and-shell-history',
    'Cleanup process truncates logs and shell history',
    ['Pod', 'log fixture', 'shell-history fixture'],
    'Use one controlled cleanup process to open a critical log and shell-history file with truncation.',
    'The process truncates both a recognized access log and a recognized shell-history path.',
    'Critical logs and shell-history files remain intact.',
    [
      'falco:rule:clear-log-activities:bdc30194c7e5',
      'falco:rule:delete-or-rename-shell-history:3613d13c8d75',
    ]
  ),
  falco(
    'falco-malicious-npm-network-tool',
    'NPM lifecycle script launches a network tool',
    ['Pod', 'controlled NPM package', 'package registry fixture'],
    'Install a controlled NPM package inside a container whose lifecycle script launches netcat without enabling remote-command behavior.',
    'NPM starts as an in-container package manager and a network-tool descendant executes during that installation.',
    'The container performs no runtime package installation or lifecycle-script network execution.',
    [
      'falco:rule:launch-package-management-process-in-container:a650f0c82231',
      'falco:rule:network-tool-executed-during-npm-package-install:82dee9e1175d',
      'falco:rule:launch-suspicious-network-tool-in-container:c0395069418f',
    ]
  ),
  npd(
    'npd-kernel-null-pointer',
    'Kernel reports a null-pointer dereference',
    ['Node', 'kernel journal', 'kernel log fixture'],
    'Replay one kernel null-pointer message through equivalent pinned kmsg and kern.log monitor inputs.',
    'The extracted line matches `BUG: unable to handle kernel NULL pointer dereference at .*`.',
    'The control stream contains no kernel null-pointer signature.',
    [
      'node-problem-detector:source:kernel-monitor-filelog-kerneloops:733200df203d',
      'node-problem-detector:source:kernel-monitor-kerneloops:37c07a03da32',
    ]
  ),
  npd(
    'npd-kernel-divide-error',
    'Kernel reports a divide error',
    ['Node', 'kernel journal', 'kernel log fixture'],
    'Replay one kernel divide-error message through equivalent pinned kmsg and kern.log monitor inputs.',
    'The extracted line matches `divide error: 0000 \\[#\\d+\\] SMP`.',
    'The control stream contains no kernel divide-error signature.',
    [
      'node-problem-detector:source:kernel-monitor-filelog-kerneloops:cf0fb0641bfe',
      'node-problem-detector:source:kernel-monitor-kerneloops:eb6e411f1ef5',
    ]
  ),
  npd(
    'npd-docker-task-stall',
    'Docker task remains blocked',
    ['Node', 'kernel journal'],
    'Emit one exact Docker blocked-task line into sources consumed by the pinned kmsg and filelog monitors.',
    'The line is `task docker:123 blocked for more than 120 seconds.`.',
    'No Docker task exceeds the blocked-task threshold.',
    [
      'node-problem-detector:source:kernel-monitor-dockerhung:b6f69006e18e',
      'node-problem-detector:source:kernel-monitor-filelog-dockerhung:62e4e402e4c2',
      'node-problem-detector:source:kernel-monitor-filelog-taskhung:7052d7b95a5b',
      'node-problem-detector:source:kernel-monitor-taskhung:fb692fc0ed95',
    ]
  ),
  npd(
    'npd-unregister-netdevice-burst',
    'Network device unregister repeatedly stalls',
    ['Node', 'kernel journal', 'log counter'],
    'Emit the same unregister_netdevice line three times within twenty minutes across the kernel sources.',
    'Three lines equal the pinned unregister_netdevice signature within the counter window.',
    'Fewer than three matching lines occur in twenty minutes.',
    [
      'node-problem-detector:source:kernel-monitor-counter-unregisternetdevice:c917dd4ddf3c',
      'node-problem-detector:source:kernel-monitor-filelog-unregisternetdevice:676b757ff593',
      'node-problem-detector:source:kernel-monitor-unregisternetdevice:0011e9b30246',
    ]
  ),
  npd(
    'npd-disk-bad-block',
    'Disk health log reports a bad block',
    ['Node', 'disk health log'],
    'Replay one SMART bad-sector message through the pinned disk log monitor input.',
    'The extracted line matches the pinned DiskBadBlock signature.',
    'The control stream contains no SMART bad-sector signature.',
    ['node-problem-detector:source:disk-log-message-filelog-diskbadblock:39e9e14f9017']
  ),
  npd(
    'npd-ext4-error',
    'Kernel reports an EXT4 error',
    ['Node', 'kernel journal'],
    'Replay one EXT4 error message through the pinned kernel monitor input.',
    'The extracted line matches the pinned Ext4Error signature.',
    'The control stream contains no EXT4 error signature.',
    ['node-problem-detector:source:kernel-monitor-ext4error:fe0bbbbd558b']
  ),
  npd(
    'npd-ext4-warning',
    'Kernel reports an EXT4 warning',
    ['Node', 'kernel journal'],
    'Replay one EXT4 warning message through the pinned kernel monitor input.',
    'The extracted line matches the pinned Ext4Warning signature.',
    'The control stream contains no EXT4 warning signature.',
    ['node-problem-detector:source:kernel-monitor-ext4warning:377b6c11a8dc']
  ),
  npd(
    'npd-buffer-io-error',
    'Kernel reports a buffer I/O error',
    ['Node', 'kernel journal'],
    'Replay one buffer I/O error message through the pinned kernel monitor input.',
    'The extracted line matches the pinned IOError signature.',
    'The control stream contains no buffer I/O error signature.',
    ['node-problem-detector:source:kernel-monitor-ioerror:3fcbe1499b18']
  ),
  npd(
    'npd-xfs-shutdown',
    'Kernel reports a forced XFS shutdown',
    ['Node', 'kernel journal'],
    'Replay one XFS forced-shutdown message through the pinned kernel monitor input.',
    'The extracted line matches the pinned XfsHasShutdown signature.',
    'The control stream contains no XFS forced-shutdown signature.',
    ['node-problem-detector:source:kernel-monitor-xfshasshutdown:ec077e9f89c9']
  ),
  npd(
    'npd-cper-corrected',
    'Kernel reports a corrected CPER hardware error',
    ['Node', 'kernel journal'],
    'Replay one corrected CPER hardware-error message through the pinned kernel monitor input.',
    'The extracted line matches the pinned CPER corrected-severity signature.',
    'The control stream contains no corrected CPER hardware error.',
    ['node-problem-detector:source:kernel-monitor-cperhardwareerrorcorrected:791a13e1109d']
  ),
  npd(
    'npd-cper-recoverable',
    'Kernel reports a recoverable CPER hardware error',
    ['Node', 'kernel journal'],
    'Replay one recoverable CPER hardware-error message through the pinned kernel monitor input.',
    'The extracted line matches the pinned CPER recoverable-severity signature.',
    'The control stream contains no recoverable CPER hardware error.',
    ['node-problem-detector:source:kernel-monitor-cperhardwareerrorrecoverable:4cd4e22eac09']
  ),
  npd(
    'npd-cper-fatal',
    'Kernel reports a fatal CPER hardware error',
    ['Node', 'kernel journal'],
    'Replay one fatal CPER hardware-error message through the pinned kernel monitor input.',
    'The extracted line matches the pinned CPER fatal-severity signature.',
    'The control stream contains no fatal CPER hardware error.',
    ['node-problem-detector:source:kernel-monitor-cperhardwareerrorfatal:896301f33454']
  ),
  npd(
    'npd-memory-read-error',
    'Kernel reports a corrected memory-read error',
    ['Node', 'kernel journal'],
    'Replay one corrected memory-read error message through the pinned kernel monitor input.',
    'The extracted line matches the pinned MemoryReadError signature.',
    'The control stream contains no corrected memory-read error.',
    ['node-problem-detector:source:kernel-monitor-memoryreaderror:b5dce8123ff9']
  ),
  npd(
    'npd-corrupt-docker-overlay',
    'Docker overlay storage is corrupt',
    ['Node', 'container runtime log'],
    'Repeat one Docker overlay readlink failure ten times within the pinned counter window.',
    'The same overlay readlink line satisfies the direct and counter CorruptDockerOverlay2 rules.',
    'Docker overlay path resolution completes without an error.',
    [
      'node-problem-detector:source:docker-monitor-corruptdockeroverlay2:a9def150ddfc',
      'node-problem-detector:source:docker-monitor-counter-corruptdockeroverlay2:b707d71a5c66',
    ]
  ),
  npd(
    'npd-docker-container-startup-failure',
    'Docker container startup fails',
    ['Node', 'container runtime log'],
    'Replay one Docker container startup failure through the pinned runtime monitor input.',
    'The extracted line matches the pinned DockerContainerStartupFailure signature.',
    'Docker starts the container without a matching error.',
    ['node-problem-detector:source:docker-monitor-dockercontainerstartupfailure:465231770743']
  ),
  npd(
    'npd-windows-container-creation-failure',
    'Windows container creation fails',
    ['Windows Node', 'containerd log'],
    'Replay one Windows container diff-ID extraction failure through the pinned containerd monitor input.',
    'The extracted line matches the pinned ContainerCreationFailed signature.',
    'Windows container creation completes without a matching error.',
    [
      'node-problem-detector:source:windows-containerd-monitor-filelog-containercreationfailed:79b88899fd31',
    ],
    ['aks']
  ),
  npd(
    'npd-windows-hcs-empty-layerchain',
    'Windows HCS reports an empty layerchain',
    ['Windows Node', 'containerd log'],
    'Replay one empty HCS layerchain failure through the pinned containerd monitor input.',
    'The extracted line matches the pinned HcsEmptyLayerchain signature.',
    'Windows HCS receives a nonempty layerchain.',
    [
      'node-problem-detector:source:windows-containerd-monitor-filelog-hcsemptylayerchain:9dacbdbf4b8a',
    ],
    ['aks']
  ),
  npd(
    'npd-containerd-start',
    'Systemd starts containerd',
    ['Node', 'systemd journal'],
    'Restart containerd and capture the pinned systemd start message.',
    'The extracted line matches the configured ContainerdStart signature.',
    'Containerd remains continuously active during the observation window.',
    ['node-problem-detector:source:systemd-monitor-containerdstart:75d8ccfc6f76']
  ),
  npd(
    'npd-docker-start',
    'Systemd starts Docker',
    ['Node', 'systemd journal'],
    'Restart Docker and capture the pinned systemd start message.',
    'The extracted line matches the configured DockerStart signature.',
    'Docker remains continuously active during the observation window.',
    ['node-problem-detector:source:systemd-monitor-dockerstart:01a285748f16']
  ),
  npd(
    'npd-kubelet-start',
    'Systemd starts kubelet',
    ['Node', 'systemd journal'],
    'Restart kubelet and capture the pinned systemd start message.',
    'The extracted line matches the configured KubeletStart signature.',
    'Kubelet remains continuously active during the observation window.',
    ['node-problem-detector:source:systemd-monitor-kubeletstart:92ac1168f324']
  ),
  policy(
    'writable-container-root-filesystem',
    'Container root filesystem is writable',
    ['Deployment', 'Pod'],
    'securityContext.readOnlyRootFilesystem is false',
    'securityContext.readOnlyRootFilesystem is true',
    [
      'kube-linter:check:no-read-only-root-fs',
      'kube-score:check:container-security-context-readonlyrootfilesystem',
      'polaris:check:notReadOnlyRootFilesystem',
      'kubescape:rule:immutable-container-filesystem',
    ]
  ),
  policy(
    'net-raw-capability',
    'Container retains the NET_RAW capability',
    ['Deployment', 'Pod'],
    'NET_RAW is added and neither NET_RAW nor ALL is dropped',
    'the container drops ALL capabilities and adds no NET_RAW',
    [
      'kube-linter:check:drop-net-raw-capability',
      'polaris:check:insecureCapabilities',
      'kubescape:rule:drop-capability-netraw',
    ],
    [
      'kube-bench:semantic:minimize-the-admission-of-containers-with-capabilities-assigned:230d8d67b2c2',
      'kube-bench:semantic:minimize-the-admission-of-containers-with-the-net-raw-capability:9ee71067e2b9',
      'kube-bench:semantic:minimize-the-admission-of-containers-with-added-capabilities:67dd76b9854e',
      'kube-bench:semantic:minimize-the-admission-of-containers-with-the-net-raw-capability-not-scored:b8f1afd1e354',
      'kube-bench:semantic:minimize-the-admission-of-containers-with-added-capabilities-not-scored:4b30556f2fb1',
      'kube-bench:semantic:minimize-the-admission-of-containers-with-capabilities-assigned-not-scored:8522664af5b9',
    ]
  ),
  policy(
    'host-network-namespace',
    'Pod shares the host network namespace',
    ['Deployment', 'Pod'],
    'spec.hostNetwork is true',
    'spec.hostNetwork is false',
    [
      'kube-linter:check:host-network',
      'polaris:check:hostNetworkSet',
      'kubescape:rule:host-network-access',
    ],
    [
      'kube-bench:semantic:minimize-the-admission-of-containers-wishing-to-share-the-host-network-namespace:0aa80a0e6015',
    ]
  ),
  policy(
    'cluster-admin-rolebinding',
    'RoleBinding grants cluster-admin',
    ['RoleBinding', 'ClusterRole'],
    'a RoleBinding references the cluster-admin ClusterRole',
    'the RoleBinding references a namespace-scoped least-privilege Role',
    [
      'kube-linter:check:cluster-admin-role-binding',
      'polaris:check:rolebindingClusterAdminClusterRole',
      'kubescape:rule:cluster-admin-role',
      'kubescape:rule:rule-list-all-cluster-admins-v1',
    ],
    [
      'kube-bench:semantic:ensure-that-the-cluster-admin-role-is-only-used-where-required:6ee02842bc81',
      'kube-bench:semantic:ensure-that-the-cluster-admin-role-is-only-used-where-required-not-scored:c32760f11274',
    ]
  ),
  policy(
    'namespace-without-network-policy',
    'Namespace workload has no selecting NetworkPolicy',
    ['Namespace', 'Deployment', 'Pod', 'NetworkPolicy'],
    'a workload exists in a namespace with no selecting NetworkPolicy',
    'ingress and egress NetworkPolicies select the workload',
    [
      'kube-linter:check:non-isolated-pod',
      'kube-score:check:pod-networkpolicy',
      'polaris:check:missingNetworkPolicy',
      'popeye:code:1204',
      'kubescape:rule:internal-networking',
    ],
    ['kube-bench:semantic:ensure-that-all-namespaces-have-network-policies-defined:cd4394f0581c'],
    'live_cluster'
  ),
  policy(
    'dangling-network-policy-selector',
    'NetworkPolicy selector matches no workload',
    ['NetworkPolicy', 'Deployment', 'Pod'],
    'a NetworkPolicy podSelector matches no workload in its namespace',
    'the selector matches exactly one workload',
    [
      'kube-linter:check:dangling-networkpolicy',
      'kube-score:check:networkpolicy-targets-pod',
      'kubevious:rule:network-policy-pod-selector-ref',
      'popeye:code:1200',
      'kubescape:rule:dangling-networkpolicy',
    ]
  ),
  operations(
    'container-start-rollout-stalled',
    'Container start failure stalls a Deployment rollout',
    ['Deployment', 'ReplicaSet', 'Pod', 'kube-state-metrics'],
    'Roll out a Deployment whose new container remains waiting long enough for the desired and available replica counts to diverge and the rollout deadline to expire.',
    'A new Deployment revision has a waiting container while available replicas remain below desired replicas through the rollout alert windows.',
    'The new container starts, the rollout completes before its deadline, and desired, updated, ready, and available replicas converge.',
    [
      'kubernetes-mixin:alert:KubeContainerWaiting',
      'kubernetes-mixin:alert:KubeDeploymentReplicasMismatch',
      'kubernetes-mixin:alert:KubeDeploymentRolloutStuck',
    ],
    'telemetry'
  ),
  operations(
    'hpa-capacity-mismatch',
    'HPA demand exceeds workload and cluster capacity',
    ['HorizontalPodAutoscaler', 'Deployment', 'Node', 'kube-state-metrics'],
    'Drive an HPA to its maximum while desired replicas remain above current replicas and projected CPU and memory demand at all HPA maxima meets or exceeds cluster capacity.',
    'The HPA is maxed out, desired replicas fail to converge, configured availability bounds are unsafe, and aggregate maximum demand exhausts CPU and memory capacity.',
    'The HPA has safe minimum and maximum bounds, current replicas converge to desired replicas below maxReplicas, and projected demand remains below allocatable capacity.',
    [
      'polaris:check:hpaMaxAvailability',
      'polaris:check:hpaMinAvailability',
      'kubernetes-mixin:alert:KubeHpaMaxedOut',
      'kubernetes-mixin:alert:KubeHpaReplicasMismatch',
      'popeye:code:604',
      'popeye:code:605',
    ],
    'telemetry'
  ),
  operations(
    'legacy-rbac-v1beta1-bundle',
    'Legacy RBAC v1beta1 object bundle',
    ['RBAC manifest bundle'],
    'Create a multi-document manifest containing the Role, RoleList, RoleBinding, RoleBindingList, ClusterRole, ClusterRoleList, ClusterRoleBinding, and ClusterRoleBindingList kinds at rbac.authorization.k8s.io/v1beta1.',
    'Every document in the fixture uses the removed rbac.authorization.k8s.io/v1beta1 API version.',
    'The equivalent RBAC object bundle uses rbac.authorization.k8s.io/v1.',
    [
      'pluto:source:k8s-clusterrole-rbac-authorization-k8s-io-v1beta1-removed-v1-22-0:1b7f11176fcc',
      'pluto:source:k8s-clusterrolebinding-rbac-authorization-k8s-io-v1beta1-removed-v1-22-0:13590a19933d',
      'pluto:source:k8s-clusterrolebindinglist-rbac-authorization-k8s-io-v1beta1-removed-v1-:521c76115f65',
      'pluto:source:k8s-clusterrolelist-rbac-authorization-k8s-io-v1beta1-removed-v1-22-0:f6d534c7f52b',
      'pluto:source:k8s-role-rbac-authorization-k8s-io-v1beta1-removed-v1-22-0:ce63663a377a',
      'pluto:source:k8s-rolebinding-rbac-authorization-k8s-io-v1beta1-removed-v1-22-0:09c0aee201dc',
      'pluto:source:k8s-rolebindinglist-rbac-authorization-k8s-io-v1beta1-removed-v1-22-0:5b576e61dbd3',
      'pluto:source:k8s-rolelist-rbac-authorization-k8s-io-v1beta1-removed-v1-22-0:682bed0b376c',
    ],
    'manifest_only'
  ),
];

const defaultMechanisms: Record<Feasibility, string[]> = {
  manifest_only: ['manifest parser', 'normalized predicate evaluator'],
  live_cluster: ['Kubernetes API', 'resource relationship observation'],
  telemetry: ['Kubernetes API', 'time-series metric evidence', 'bounded observation window'],
  host: ['node log fixture', 'node log evidence capture'],
  runtime: ['Kubernetes API', 'node or container runtime observation'],
};
const defaultProfiles: Record<Feasibility, ClusterProfile[]> = {
  manifest_only: ['local-kwok', 'local-minikube', 'aks'],
  live_cluster: ['local-kwok', 'local-minikube', 'aks'],
  telemetry: ['local-minikube', 'aks'],
  host: ['local-minikube', 'aks'],
  runtime: ['local-minikube', 'aks'],
};

const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as { tools: InventoryTool[] };
const mapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as {
  rule_mappings: Array<{ rules: Array<{ rule_id: string; status: string }> }>;
};
const v1 = JSON.parse(readFileSync(v1Path, 'utf8')) as {
  scenarios: Array<{
    scenario_id: string;
    title: string;
    trigger_predicate: string;
    target_rule_ids: string[];
  }>;
};
const inventoryRules = inventory.tools.flatMap(tool =>
  tool.rules.map(rule => ({
    ...rule,
    tool_id: tool.tool_id,
    revision: tool.revision,
    readiness: rule.mapping_readiness ?? tool.mapping_readiness,
  }))
);
const byId = new Map(inventoryRules.map(rule => [rule.rule_id, rule]));
const byGroup = new Map<string, typeof inventoryRules>();
for (const rule of inventoryRules) {
  const members = byGroup.get(rule.semantic_group_id) ?? [];
  members.push(rule);
  byGroup.set(rule.semantic_group_id, members);
}
const statusById = new Map(
  mapping.rule_mappings.flatMap(entry =>
    entry.rules.map(rule => [rule.rule_id, rule.status] as const)
  )
);
const v1TargetIds = new Set(v1.scenarios.flatMap(scenario => scenario.target_rule_ids));

assert.equal(blueprints.length, 42, 'expected exactly 42 blueprints');
assert.deepEqual(
  Object.fromEntries(
    [...new Set(blueprints.map(item => item.selectionTrack))]
      .sort()
      .map(track => [track, blueprints.filter(item => item.selectionTrack === track).length])
  ),
  { falco_chain: 13, node_problem_detector: 20, operations: 3, policy: 6 }
);

const claimedRuleIds = new Set<string>();
const scenarios = blueprints.map(item => {
  const selected = new Map<string, (typeof inventoryRules)[number]>();
  for (const ruleId of item.ruleIds) {
    const rule = byId.get(ruleId);
    assert.ok(rule, `unknown target rule ${ruleId}`);
    selected.set(ruleId, rule);
  }
  for (const groupId of item.semanticGroupIds ?? []) {
    const members = byGroup.get(groupId);
    assert.ok(members?.length, `unknown semantic group ${groupId}`);
    for (const rule of members) selected.set(rule.rule_id, rule);
  }
  const targetRules = [...selected.values()].sort((left, right) =>
    left.rule_id.localeCompare(right.rule_id)
  );
  for (const rule of targetRules) {
    assert.equal(rule.readiness, 'direct_predicate', `${rule.rule_id} is not direct`);
    assert.equal(statusById.get(rule.rule_id), 'uncovered', `${rule.rule_id} is not uncovered`);
    assert.equal(v1TargetIds.has(rule.rule_id), false, `${rule.rule_id} overlaps v1`);
    assert.equal(claimedRuleIds.has(rule.rule_id), false, `${rule.rule_id} is targeted twice`);
    assert.ok(rule.info_url.includes(rule.revision), `${rule.rule_id} URL is not revision-pinned`);
    claimedRuleIds.add(rule.rule_id);
  }
  return {
    scenario_id: `rule-gap-${item.slug}`,
    title: item.title,
    selection_track: item.selectionTrack,
    category: item.category,
    setup_summary: item.setup,
    trigger_predicate: item.trigger,
    expected_finding: `Identify ${item.title.toLowerCase()} and cite the exact field, status, event, log, syscall, or metric satisfying the trigger.`,
    healthy_condition: item.healthy,
    required_resources: item.resources,
    required_mechanisms: item.mechanisms ?? defaultMechanisms[item.feasibility],
    supported_cluster_profiles: item.profiles ?? defaultProfiles[item.feasibility],
    feasibility: item.feasibility,
    target_rule_ids: targetRules.map(rule => rule.rule_id),
    target_semantic_group_ids: [...new Set(targetRules.map(rule => rule.semantic_group_id))].sort(),
    target_tool_ids: [...new Set(targetRules.map(rule => rule.tool_id))].sort(),
    target_rule_count: targetRules.length,
    provenance_refs: [...new Set(targetRules.map(rule => rule.info_url))].sort(),
    lifecycle_state: 'draft',
    qualification_status: 'pending',
    qualification_blockers: [
      {
        kind: 'setup',
        detail:
          'Generate and validate the isolated fixture and healthy control with source-grounded agents.',
      },
      {
        kind: 'observation',
        detail: 'Prove the required evidence is stable for a bounded observation window.',
      },
      {
        kind: 'oracle',
        detail:
          'Generate positive, healthy-control, and confounder assertions, then verify them with a separate critic agent.',
      },
      {
        kind: 'leakage',
        detail: 'Keep rule names and expected findings out of candidate-visible inputs.',
      },
    ],
  };
});

const summarize = <T extends string>(
  values: T[],
  count: (value: T) => number
): Record<string, number> =>
  Object.fromEntries([...new Set(values)].sort().map(value => [value, count(value)]));
const targetIds = scenarios.flatMap(scenario => scenario.target_rule_ids);
const targetGroups = new Set(scenarios.flatMap(scenario => scenario.target_semantic_group_ids));
assert.equal(targetIds.length, 530, 'expected 530 target occurrences');
assert.equal(targetGroups.size, 156, 'expected 156 target semantic groups');

const categoryCounts = {
  workload_configuration: 6,
  control_plane_host_hardening: 0,
  runtime_node_failure: 33,
  operations_deprecation: 3,
};
const coverageByTool = summarize(
  targetIds.map(ruleId => byId.get(ruleId)!.tool_id),
  toolId => targetIds.filter(ruleId => byId.get(ruleId)!.tool_id === toolId).length
);
const coverageByFeasibility = summarize(
  scenarios.map(scenario => scenario.feasibility),
  feasibility =>
    scenarios
      .filter(scenario => scenario.feasibility === feasibility)
      .reduce((total, scenario) => total + scenario.target_rule_count, 0)
);
const scenarioCountsByFeasibility = summarize(
  scenarios.map(scenario => scenario.feasibility),
  feasibility => scenarios.filter(scenario => scenario.feasibility === feasibility).length
);
const coverageBySelectionTrack = summarize(
  scenarios.map(scenario => scenario.selection_track),
  track =>
    scenarios
      .filter(scenario => scenario.selection_track === track)
      .reduce((total, scenario) => total + scenario.target_rule_count, 0)
);
const scenarioCountsBySelectionTrack = summarize(
  scenarios.map(scenario => scenario.selection_track),
  track => scenarios.filter(scenario => scenario.selection_track === track).length
);
const document = {
  schema_version: '1.0.0',
  batch_id: 'rule-gap-scenarios-v2',
  generated_at: '2026-09-20',
  review_status: 'provisional',
  inventory_path: 'registrations/tool-rule-inventory-v1.json',
  mapping_path: 'registrations/tool-scenario-rule-mapping-v1.json',
  prior_batch_path: 'registrations/rule-gap-scenarios-v1.json',
  scenarios_goal: SCENARIOS_GOAL,
  optimization_objective:
    'Maximize marginal semantic-group coverage with coherent root-cause fixtures after excluding covered and v1-targeted rule occurrences.',
  methodology: {
    selection:
      'Use the reviewed 13 Falco, 20 single-trigger Node Problem Detector, 6 policy, and 3 operations proposals with exact rule and semantic-group IDs.',
    deduplication:
      'Reject covered targets, v1 targets, and duplicate v2 occurrences; expand every selected kube-bench semantic group exactly.',
    qualification:
      'Drafts remain outside the active roster until setup, observation, oracle, and leakage blockers are resolved.',
  },
  total_scenarios: scenarios.length,
  total_target_rules: targetIds.length,
  total_target_semantic_groups: targetGroups.size,
  category_counts: categoryCounts,
  coverage_by_tool: coverageByTool,
  coverage_by_feasibility: coverageByFeasibility,
  scenario_counts_by_feasibility: scenarioCountsByFeasibility,
  coverage_by_selection_track: coverageBySelectionTrack,
  scenario_counts_by_selection_track: scenarioCountsBySelectionTrack,
  scenarios,
};

const prettierConfig = (await prettier.resolveConfig(outputPath)) ?? {};
writeFileSync(
  outputPath,
  prettier.format(JSON.stringify(document), { ...prettierConfig, parser: 'json' })
);

const coveredRules = inventoryRules.filter(rule => statusById.get(rule.rule_id) === 'covered');
const combinedRules = new Set([
  ...coveredRules.map(rule => rule.rule_id),
  ...v1TargetIds,
  ...targetIds,
]);
const combinedGroups = new Set(
  [...combinedRules].map(ruleId => {
    const rule = byId.get(ruleId);
    assert.ok(rule, ruleId);
    return rule.semantic_group_id;
  })
);
const combinedTools = new Set([...combinedRules].map(ruleId => byId.get(ruleId)!.tool_id));
const inventoryGroups = new Set(inventoryRules.map(rule => rule.semantic_group_id));
const directRules = inventoryRules.filter(rule => rule.readiness === 'direct_predicate');
const directGroups = new Set(directRules.map(rule => rule.semantic_group_id));
const percentage = (part: number, whole: number): string => ((part / whole) * 100).toFixed(1);
const markdown = [
  '# Kubernetes rule-gap draft scenarios v2',
  '',
  'Status: draft and pending, 2026-09-20',
  '',
  'This second catalogue maximizes marginal semantic coverage after excluding every',
  'rule occurrence already covered by the active 275-scenario roster or targeted by',
  '[the v1 draft catalogue](kubernetes-rule-gap-scenarios.md). Its machine-readable',
  'source is',
  '[`rule-gap-scenarios-v2.json`](../evals/registrations/rule-gap-scenarios-v2.json),',
  'generated by',
  '[`generateRuleGapScenariosV2.ts`](../evals/src/scenarios/generateRuleGapScenariosV2.ts).',
  '',
  '## Scenarios Goal',
  '',
  `> ${SCENARIOS_GOAL.statement}`,
  '',
  'See [Scenarios Goal](kubernetes-scenarios-goal.md) for the canonical denominator,',
  'risk model, milestones, and qualification gates.',
  '',
  'This batch optimizes progress toward that goal. Its tool-local groups are not the',
  'canonical completion denominator, and targets count only after qualification.',
  'The scenarios reproduce Kubernetes states and normalized predicates; they do not install',
  'or execute the surveyed tools named by `target_rule_ids`.',
  '',
  '## Objective and constraints',
  '',
  '- Select only revision-pinned, uncovered `direct_predicate` occurrences.',
  '- Reuse no v1 target and assign every v2 occurrence to exactly one scenario.',
  '- Expand selected kube-bench semantic groups to every profile occurrence.',
  '- Keep one coherent action chain or root setup per scenario with an explicit healthy control.',
  '- Keep all entries `draft` and `pending`; none joins the active roster.',
  '',
  '## Why 42',
  '',
  'The reviewed frontier contains all 13 coherent Falco chains and 20 single-trigger',
  'Node Problem Detector fixtures, plus 6 non-duplicative policy cases and 3 operations',
  'cases. The NPD unit is one independently triggerable fixture, except equivalent',
  'source patterns or direct-and-counter rules activated by the same exact log line',
  'remain together. This preserves all 28 NPD occurrences in 20 semantic groups without',
  'hiding parameterized cases inside a scenario. Three policy groups merge into the',
  'Falco host-filesystem chain and the service-account-token group merges into the Falco',
  'kubectl exfiltration chain, avoiding four duplicate roots while retaining every target.',
  '',
  'This is a constrained, locally optimized frontier rather than a proof of the global',
  'minimum. Causal coherence is a reviewed property that is not encoded in the source',
  'inventory, so a conventional set-cover solver would incorrectly merge unrelated',
  'failures. The selected batch averages',
  `**${(targetGroups.size / scenarios.length).toFixed(1)} semantic groups** and`,
  `**${(targetIds.length / scenarios.length).toFixed(1)} occurrences** per draft.`,
  '',
  '## Marginal coverage',
  '',
  `The 42 drafts add **${targetIds.length}** exact rule occurrences in **${targetGroups.size}**`,
  `tool-local semantic groups across **${Object.keys(coverageByTool).length}** tools.`,
  '',
  '| Tool | Occurrences |',
  '| --- | ---: |',
  ...Object.entries(coverageByTool).map(([tool, count]) => `| ${tool} | ${count} |`),
  '',
  '| Selection track | Drafts | Occurrences |',
  '| --- | ---: | ---: |',
  ...Object.entries(scenarioCountsBySelectionTrack).map(
    ([track, count]) => `| ${track} | ${count} | ${coverageBySelectionTrack[track]} |`
  ),
  '',
  '| Feasibility | Drafts | Occurrences |',
  '| --- | ---: | ---: |',
  ...Object.entries(scenarioCountsByFeasibility).map(
    ([feasibility, count]) =>
      `| ${feasibility} | ${count} | ${coverageByFeasibility[feasibility]} |`
  ),
  '',
  '## Combined accounting',
  '',
  '| Surface | Occurrences | Semantic groups | Tools |',
  '| --- | ---: | ---: | ---: |',
  `| Existing covered + v1 drafts + v2 drafts | ${combinedRules.size.toLocaleString(
    'en-US'
  )} | ${combinedGroups.size.toLocaleString('en-US')} | ${combinedTools.size} |`,
  '',
  `Combined targets represent **${percentage(combinedRules.size, inventoryRules.length)}%** of`,
  `all ${inventoryRules.length.toLocaleString('en-US')} occurrences and **${percentage(
    combinedGroups.size,
    inventoryGroups.size
  )}%** of all ${inventoryGroups.size.toLocaleString('en-US')} semantic groups. Against`,
  `only the direct-predicate surface, they represent **${percentage(
    combinedRules.size,
    directRules.length
  )}%** of occurrences and **${percentage(combinedGroups.size, directGroups.size)}%** of`,
  'semantic groups.',
  '',
  'This is combined target accounting, not all-rule coverage and not an end-to-end',
  'candidate result. The v1 and v2 entries remain unqualified drafts; profile-expanded',
  'kube-bench occurrences must not be read as independent behaviors.',
  '',
  '## Qualification plan',
  '',
  '1. Implement the six manifest-only cases first. They exercise 233 occurrences with',
  '   deterministic fixtures and provide the cheapest validation of the mapping model.',
  '2. Add the shared Prometheus fixture and qualify the two telemetry cases together.',
  '3. Build one runtime evidence harness, then qualify the 13 action chains individually',
  '   against normalized predicates with per-event oracles and harmless payloads.',
  '4. Build one node-log replay harness, then qualify the 20 host fixtures one trigger at',
  '   a time. Keep Windows cases AKS-only and Linux cases on disposable nodes.',
  '5. Freeze each oracle before candidate runs, retain healthy controls, and promote a',
  '   draft into the active roster only after setup, observation, cleanup, and leakage',
  '   review pass.',
  '',
  '## Draft catalogue',
  '',
  '| Scenario ID | Selection track | Title | Occurrences | Groups |',
  '| --- | --- | --- | ---: | ---: |',
  ...scenarios.map(
    scenario =>
      `| ${scenario.scenario_id} | ${scenario.selection_track} | ${scenario.title} | ${scenario.target_rule_count} | ${scenario.target_semantic_group_ids.length} |`
  ),
  '',
].join('\n');
const markdownConfig = (await prettier.resolveConfig(documentationPath)) ?? {};
writeFileSync(
  documentationPath,
  prettier.format(markdown, { ...markdownConfig, parser: 'markdown' })
);

console.log(
  `Wrote ${scenarios.length} v2 drafts targeting ${targetIds.length} rule occurrences in ${targetGroups.size} semantic groups.`
);
