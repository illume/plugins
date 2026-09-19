import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  metadata,
  namespaced,
  objectEvents,
  requiredParameter,
  type AksCaseContext,
  type AksEndToEndCase,
} from './aksEndToEndCases.js';

export function controllerPlatformProof(
  image: string,
  manifestBytes: Buffer,
  configBytes: Buffer,
  architecture: 'amd64' | 'arm64'
) {
  assert.match(
    image,
    /^mcr\.microsoft\.com\/application-lb\/images\/alb-controller:1\.(?:8\.9|11\.1)@sha256:[a-f0-9]{64}$/
  );
  const digest = (bytes: Buffer) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  assert.equal(
    image.split('@')[1],
    digest(manifestBytes),
    'Image digest does not match the reviewed platform manifest'
  );
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.schemaVersion, 2);
  assert.ok(
    [
      'application/vnd.docker.distribution.manifest.v2+json',
      'application/vnd.oci.image.manifest.v1+json',
    ].includes(manifest.mediaType)
  );
  assert.equal(
    manifest.manifests,
    undefined,
    'Use a reviewed platform manifest, not an unexamined index'
  );
  assert.equal(
    manifest.config?.digest,
    digest(configBytes),
    'Image config is not bound to the reviewed manifest'
  );
  assert.equal(manifest.config?.size, configBytes.length);
  const config = JSON.parse(configBytes.toString('utf8'));
  assert.equal(config.os, 'linux');
  assert.equal(config.architecture, architecture, 'Image platform does not match the experiment');
  return {
    image,
    manifestDigest: digest(manifestBytes),
    configDigest: digest(configBytes),
    os: config.os,
    architecture,
  };
}

function readProof(
  parameters: Record<string, string>,
  prefix: 'affected' | 'fixed',
  architecture: 'amd64' | 'arm64'
) {
  const version = prefix === 'affected' ? '1.8.9' : '1.11.1';
  const image = requiredParameter(
    parameters,
    `${prefix}ControllerImage`,
    /^mcr\.microsoft\.com\/application-lb\/images\/alb-controller:[0-9.]+@sha256:[a-f0-9]{64}$/
  );
  assert.ok(
    image.startsWith(`mcr.microsoft.com/application-lb/images/alb-controller:${version}@`),
    'Controller version must match the reviewed source/control release'
  );
  const manifest = requiredParameter(parameters, `${prefix}Manifest`, /^\/.+\.json$/);
  const config = requiredParameter(parameters, `${prefix}Config`, /^\/.+\.json$/);
  return controllerPlatformProof(image, readFileSync(manifest), readFileSync(config), architecture);
}

export function isControllerArchitectureFailure(pod: any, events: any, expectedImage: string) {
  assert.ok(pod.metadata?.uid, 'Missing actual Pod identity');
  assert.equal(pod.spec?.containers?.length, 1);
  assert.equal(pod.spec.containers[0].image, expectedImage);
  if (pod.status?.phase === 'Succeeded') return false;
  const statuses = pod.status?.containerStatuses ?? [];
  const messages = statuses
    .filter((item: any) => item.name === 'controller')
    .flatMap((item: any) =>
      [item.state?.waiting?.message, item.state?.terminated?.message].filter(
        (message: unknown) => typeof message === 'string'
      )
    );
  assert.ok(Array.isArray(events?.items), 'Missing UID-scoped event collection');
  for (const event of events.items) {
    assert.equal(
      event.involvedObject?.uid,
      pod.metadata.uid,
      'Foreign Pod event cannot establish this failure'
    );
    if (typeof event.message === 'string') messages.push(event.message);
  }
  assert.ok(
    !messages.some((message: string) =>
      /unauthorized|authentication required|no such host|i\/o timeout|pull access denied|429 Too Many/i.test(
        message
      )
    ),
    'Registry or network failure is not an architecture reproduction'
  );
  const running = statuses.some((item: any) => item.name === 'controller' && item.state?.running);
  return !running && messages.some((message: string) => /exec format error/i.test(message));
}

const armControllerBinary: AksEndToEndCase = {
  validate(parameters) {
    readProof(parameters, 'affected', 'amd64');
    readProof(parameters, 'fixed', 'arm64');
    requiredParameter(parameters, 'armNodeVmSize', /^Standard_[a-zA-Z0-9_]+$/);
    requiredParameter(parameters, 'amdNodeImageVersion', /^AKSUbuntu-[a-zA-Z0-9._-]+$/);
    requiredParameter(parameters, 'armNodeImageVersion', /^AKSUbuntu-[a-zA-Z0-9._-]+$/);
    requiredParameter(parameters, 'nodeCeiling', /^2$/);
  },
  async run(context) {
    const affected = readProof(context.parameters, 'affected', 'amd64');
    const fixed = readProof(context.parameters, 'fixed', 'arm64');
    context.save('controller-platform-proofs', {
      affected,
      fixed,
      scope: 'binary-platform-adaptation-not-helm-installation',
    });
    const nodes = () => JSON.parse(context.run(['get', 'nodes', '-o', 'json'])).items;
    const originalNodes = nodes();
    assert.equal(originalNodes.length, 1, 'C119 starts with one owned AMD64 node');
    assert.equal(originalNodes[0].status.nodeInfo.architecture, 'amd64');
    assert.equal(
      originalNodes[0].metadata.labels['kubernetes.azure.com/node-image-version'],
      context.parameters.amdNodeImageVersion
    );
    const nodeReady = (node: any) =>
      node.status?.conditions?.some(
        (condition: any) => condition.type === 'Ready' && condition.status === 'True'
      );
    assert.ok(nodeReady(originalNodes[0]), 'AMD64 node is not Ready');
    const nodeFor = (pod: any, architecture: string) => {
      assert.ok(pod.spec.nodeName, 'Pod has not been placed on a node');
      const node = JSON.parse(context.run(['get', 'node', pod.spec.nodeName, '-o', 'json']));
      assert.equal(node.status.nodeInfo.architecture, architecture);
      assert.equal(
        node.metadata.labels['kubernetes.azure.com/node-image-version'],
        context.parameters[architecture === 'amd64' ? 'amdNodeImageVersion' : 'armNodeImageVersion']
      );
      if (architecture === 'arm64') assert.equal(node.metadata.labels.agentpool, 'armcompat');
      else
        assert.equal(
          node.metadata.uid,
          originalNodes[0].metadata.uid,
          'AMD64 control node changed'
        );
      return node;
    };
    const workload = (name: string, image: string, architecture: string) => ({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: metadata(context, name),
      spec: {
        restartPolicy: 'Never',
        automountServiceAccountToken: false,
        activeDeadlineSeconds: 90,
        nodeSelector: {
          'kubernetes.io/os': 'linux',
          'kubernetes.io/arch': architecture,
          ...(architecture === 'arm64' ? { agentpool: 'armcompat' } : {}),
        },
        containers: [
          {
            name: 'controller',
            image,
            command: ['/alb-controller'],
            args: ['--help'],
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ['ALL'] },
              seccompProfile: { type: 'RuntimeDefault' },
            },
            resources: {
              requests: { cpu: '25m', memory: '32Mi' },
              limits: { cpu: '250m', memory: '128Mi' },
            },
          },
        ],
      },
    });
    const successfulHelp = async (name: string, image: string, architecture: string) => {
      await context.poll(() => {
        const pod = context.read('pod', name);
        context.save(`${name}-completion`, pod);
        assert.notEqual(
          pod.status?.phase,
          'Failed',
          'Controller help failed, not a working control'
        );
        return pod.status?.phase === 'Succeeded';
      }, `${name} controller help exits successfully`);
      const pod = context.read('pod', name);
      assert.equal(pod.spec.containers[0].image, image);
      const status = pod.status.containerStatuses?.find((item: any) => item.name === 'controller');
      assert.equal(status?.state?.terminated?.exitCode, 0);
      assert.equal(status?.restartCount, 0);
      assert.equal(
        status?.imageID?.split('@').at(-1),
        image.split('@')[1],
        'Runtime image is not the pinned platform manifest'
      );
      const node = nodeFor(pod, architecture);
      const logs = context.kube(
        namespaced(context, ['logs', name, '-c', 'controller', '--tail=100'])
      );
      assert.equal(logs.status, 0, 'Controller help output unavailable');
      assert.match(
        logs.stdout,
        /(?:Usage|Flags|Options):/i,
        'No controller help output; do not infer success from exit code alone'
      );
      context.save(`${name}-help`, logs);
      return { pod, node, help: logs.stdout };
    };
    await context.phase('baseline', async () => {
      context.create('controller-amd-baseline', workload('amd-control', affected.image, 'amd64'));
      const amd = await successfulHelp('amd-control', affected.image, 'amd64');
      context.az([
        'aks',
        'nodepool',
        'add',
        '--resource-group',
        context.resourceGroup,
        '--cluster-name',
        'research',
        '--name',
        'armcompat',
        '--node-vm-size',
        context.parameters.armNodeVmSize!,
        '--node-count',
        '1',
        '--mode',
        'User',
        '--os-sku',
        'Ubuntu',
        '--kubernetes-version',
        context.kubernetesVersion,
        '--tags',
        `headlamp-e2e-owner=${context.owner}`,
      ]);
      await context.poll(() => {
        const current = nodes();
        assert.ok(current.length <= 2, 'Two-node ceiling exceeded');
        const arm = current.filter((node: any) => node.metadata.labels.agentpool === 'armcompat');
        return arm.length === 1 && nodeReady(arm[0]);
      }, 'One owned ARM64 node is Ready');
      const pool = context.az([
        'aks',
        'nodepool',
        'show',
        '--resource-group',
        context.resourceGroup,
        '--cluster-name',
        'research',
        '--name',
        'armcompat',
      ]);
      assert.equal(pool.count, 1);
      assert.ok(!pool.enableAutoScaling);
      assert.equal(pool.nodeImageVersion, context.parameters.armNodeImageVersion);
      context.create('controller-arm-baseline', workload('arm-control', fixed.image, 'arm64'));
      const arm = await successfulHelp('arm-control', fixed.image, 'arm64');
      return { amd, arm, pool, scope: 'help-only-no-cloud-identity-or-load-balancer' };
    });
    await context.phase('fault', async () => {
      context.create('controller-arm-subject', workload('arm-subject', affected.image, 'arm64'));
      let observation: unknown;
      await context.poll(() => {
        const pod = context.read('pod', 'arm-subject');
        if (!pod.spec.nodeName) return false;
        const node = nodeFor(pod, 'arm64');
        const events = objectEvents(context, pod);
        observation = { pod, node, events };
        context.save('controller-architecture-observation', observation);
        assert.notEqual(
          pod.status?.phase,
          'Succeeded',
          'Affected image executed on ARM64; fault not reproduced'
        );
        return isControllerArchitectureFailure(pod, events, affected.image);
      }, 'Affected ALB binary has an execution-format failure on ARM64');
      await successfulHelp('amd-control', affected.image, 'amd64');
      return {
        observation,
        faultObserved: true,
        scope: 'pinned-amd64-binary-on-arm64-not-a-chart-install',
        qualified: false,
      };
    });
    await context.phase('recovery', async () => {
      const subject = context.read('pod', 'arm-subject');
      assert.equal(subject.metadata.labels['headlamp-e2e-owner'], context.owner);
      const oldUid = subject.metadata.uid;
      context.run(
        namespaced(context, ['delete', 'pod', 'arm-subject', '--wait=true', '--timeout=60s'])
      );
      assert.equal(
        context
          .run(
            namespaced(context, ['get', 'pod', 'arm-subject', '--ignore-not-found', '-o', 'name'])
          )
          .trim(),
        ''
      );
      context.create('controller-arm-recovery', workload('arm-subject', fixed.image, 'arm64'));
      const recovery = await successfulHelp('arm-subject', fixed.image, 'arm64');
      assert.notEqual(recovery.pod.metadata.uid, oldUid);
      assert.equal(nodes().length, 2, 'Unexpected cluster size at recovery');
      return {
        ...recovery,
        kind: 'new-arm64-capable-binary-control',
        controllerReconciled: false,
        loadBalancerProvisioned: false,
      };
    });
  },
};

export const aksArchitectureEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c119-v1': armControllerBinary,
};
