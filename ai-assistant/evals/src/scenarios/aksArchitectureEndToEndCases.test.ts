import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AksCaseContext } from './aksEndToEndCases.js';
import { listAksEndToEndAuthoring } from './aksEndToEndScenarios.js';
import {
  aksArchitectureEndToEndCases,
  controllerPlatformProof,
  isControllerArchitectureFailure,
} from './aksArchitectureEndToEndCases.js';

function proof(architecture: string, version: string) {
  const config = Buffer.from(JSON.stringify({ architecture, os: 'linux' }));
  const manifest = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.oci.image.manifest.v1+json',
      config: {
        size: config.length,
        digest: `sha256:${createHash('sha256').update(config).digest('hex')}`,
      },
      layers: [],
    })
  );
  const image = `mcr.microsoft.com/application-lb/images/alb-controller:${version}@sha256:${createHash(
    'sha256'
  )
    .update(manifest)
    .digest('hex')}`;
  return { image, config, manifest };
}

test('C119 binds platform claims to exact image manifest and configuration bytes', () => {
  const affected = proof('amd64', '1.8.9');
  assert.equal(
    controllerPlatformProof(affected.image, affected.manifest, affected.config, 'amd64')
      .architecture,
    'amd64'
  );
  const fixed = proof('arm64', '1.11.1');
  assert.equal(
    controllerPlatformProof(fixed.image, fixed.manifest, fixed.config, 'arm64').architecture,
    'arm64'
  );
  assert.throws(
    () => controllerPlatformProof(affected.image, affected.manifest, affected.config, 'arm64'),
    /platform/
  );
  assert.throws(
    () =>
      controllerPlatformProof(
        affected.image,
        Buffer.concat([affected.manifest, Buffer.from(' ')]),
        affected.config,
        'amd64'
      ),
    /digest/
  );
  assert.throws(
    () => controllerPlatformProof(affected.image, affected.manifest, fixed.config, 'amd64'),
    /config/
  );
});

test('C119 accepts only actual target-container architecture errors, not registry or foreign events', () => {
  const affected = proof('amd64', '1.8.9');
  const pod = {
    metadata: { uid: 'owned' },
    spec: { containers: [{ name: 'controller', image: affected.image }] },
    status: {
      phase: 'Pending',
      containerStatuses: [
        {
          name: 'controller',
          state: { waiting: { message: 'exec /alb-controller: exec format error' } },
        },
      ],
    },
  };
  assert.equal(isControllerArchitectureFailure(pod, { items: [] }, affected.image), true);
  const events = { items: [{ involvedObject: { uid: 'other' }, message: 'exec format error' }] };
  assert.throws(() => isControllerArchitectureFailure(pod, events, affected.image), /Foreign/);
  pod.status.containerStatuses[0]!.state.waiting.message = 'ImagePullBackOff';
  assert.equal(isControllerArchitectureFailure(pod, { items: [] }, affected.image), false);
  pod.status.containerStatuses[0]!.state.waiting.message = 'unauthorized: exec format error';
  assert.throws(
    () => isControllerArchitectureFailure(pod, { items: [] }, affected.image),
    /Registry or network/
  );
});

function architectureContext(directory: string, failure?: string) {
  const parameters: Record<string, string> = {
    armNodeVmSize: 'Standard_D2ps_v6',
    amdNodeImageVersion: 'AKSUbuntu-amd-test',
    armNodeImageVersion: 'AKSUbuntu-arm-test',
    nodeCeiling: '2',
  };
  for (const [prefix, architecture, version] of [
    ['affected', 'amd64', '1.8.9'],
    ['fixed', 'arm64', '1.11.1'],
  ]) {
    const artifact = proof(architecture!, version!);
    parameters[`${prefix}ControllerImage`] = artifact.image;
    for (const [key, bytes] of [
      ['Manifest', artifact.manifest],
      ['Config', artifact.config],
    ] as const) {
      const file = path.join(directory, `${prefix}-${key}.json`);
      writeFileSync(file, bytes);
      parameters[`${prefix}${key}`] = file;
    }
  }
  const node = (name: string, architecture: string, pool: string) => ({
    metadata: {
      name,
      uid: `${name}-uid`,
      labels: {
        agentpool: pool,
        'kubernetes.azure.com/node-image-version':
          parameters[architecture === 'amd64' ? 'amdNodeImageVersion' : 'armNodeImageVersion'],
      },
    },
    status: { nodeInfo: { architecture }, conditions: [{ type: 'Ready', status: 'True' }] },
  });
  const amd = node('amd', 'amd64', 'system');
  const arm = node('arm', 'arm64', 'armcompat');
  const pods = new Map<string, any>();
  const evidence = new Map<string, any>();
  const phases: string[] = [];
  const azureCalls: string[][] = [];
  const kubernetesCalls: string[][] = [];
  let nodes = [amd];
  let sequence = 0;
  const context = {
    namespace: 'owned',
    owner: 'owner',
    resourceGroup: 'owned-group',
    kubernetesVersion: '1.35.7',
    parameters,
    az(args: string[]) {
      azureCalls.push(args);
      assert.equal(args[0], 'aks');
      assert.equal(args[1], 'nodepool');
      if (args[2] === 'add') {
        assert.equal(args[args.indexOf('--node-count') + 1], '1');
        assert.equal(args[args.indexOf('--node-vm-size') + 1], parameters.armNodeVmSize);
        nodes =
          failure === 'too-many-nodes' ? [amd, arm, node('extra', 'amd64', 'other')] : [amd, arm];
        return {};
      }
      assert.equal(args[2], 'show');
      return {
        count: 1,
        enableAutoScaling: false,
        nodeImageVersion: failure === 'wrong-arm-image' ? 'other' : parameters.armNodeImageVersion,
      };
    },
    create(_name: string, resource: any) {
      assert.equal(resource.kind, 'Pod');
      const pod = structuredClone(resource);
      const architecture = pod.spec.nodeSelector['kubernetes.io/arch'];
      pod.metadata.uid = `pod-${++sequence}`;
      pod.spec.nodeName = architecture === 'amd64' ? 'amd' : 'arm';
      const image = pod.spec.containers[0].image;
      const affectedArm = architecture === 'arm64' && image === parameters.affectedControllerImage;
      const success = !affectedArm || failure === 'no-fault';
      const brokenControl = pod.metadata.name === 'amd-control' && failure === 'control-failed';
      const brokenRecovery =
        pod.metadata.name === 'arm-subject' && !affectedArm && failure === 'recovery-failed';
      pod.status = {
        phase: brokenControl || brokenRecovery ? 'Failed' : success ? 'Succeeded' : 'Pending',
        containerStatuses: [
          {
            name: 'controller',
            restartCount: 0,
            imageID: failure === 'wrong-runtime' ? 'repo@sha256:other' : image,
            state: success
              ? { terminated: { exitCode: brokenControl || brokenRecovery ? 1 : 0 } }
              : {
                  waiting: {
                    message:
                      failure === 'registry-failure'
                        ? 'unauthorized: pull access denied'
                        : 'exec /alb-controller: exec format error',
                  },
                },
          },
        ],
      };
      pods.set(pod.metadata.name, pod);
    },
    read(kind: string, name: string) {
      assert.equal(kind, 'pod');
      assert.ok(pods.has(name));
      return structuredClone(pods.get(name));
    },
    run(args: string[]) {
      kubernetesCalls.push(args);
      if (args[0] === 'get' && args[1] === 'nodes') return JSON.stringify({ items: nodes });
      if (args[0] === 'get' && args[1] === 'node')
        return JSON.stringify(
          args[2] === 'amd'
            ? amd
            : failure === 'wrong-architecture'
            ? { ...arm, status: { ...arm.status, nodeInfo: { architecture: 'amd64' } } }
            : arm
        );
      if (args.includes('events'))
        return JSON.stringify({
          items:
            failure === 'foreign-event'
              ? [{ involvedObject: { uid: 'foreign' }, message: 'exec format error' }]
              : [],
        });
      if (args.includes('delete')) {
        pods.delete(args[args.indexOf('delete') + 2]!);
        return '';
      }
      assert.ok(args.includes('--ignore-not-found'));
      return '';
    },
    kube(args: string[]) {
      kubernetesCalls.push(args);
      assert.ok(args.includes('logs'));
      return {
        status: 0,
        stdout:
          failure === 'no-help' ? 'startup completed' : 'Usage: alb-controller\nFlags:\n  --help',
        stderr: '',
      };
    },
    save(name: string, value: unknown) {
      evidence.set(name, structuredClone(value));
    },
    async poll(action: () => boolean, label: string) {
      assert.ok(action(), label);
    },
    async phase(name: string, action: () => Promise<unknown>) {
      phases.push(name);
      evidence.set(name, await action());
    },
  } as unknown as AksCaseContext;
  return { context, pods, evidence, phases, azureCalls, kubernetesCalls };
}

test('C119 executes architecture controls, observes a format error, then replaces only the owned subject', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'aks-architecture-'));
  try {
    const fixture = architectureContext(directory);
    const handler = aksArchitectureEndToEndCases['aks-c119-v1'];
    assert.ok(handler);
    handler.validate(fixture.context.parameters);
    await handler.run(fixture.context);
    assert.deepEqual(fixture.phases, ['baseline', 'fault', 'recovery']);
    assert.equal(fixture.evidence.get('fault').faultObserved, true);
    assert.equal(fixture.evidence.get('recovery').controllerReconciled, false);
    assert.equal(fixture.evidence.get('recovery').loadBalancerProvisioned, false);
    assert.equal(
      fixture.pods.get('arm-subject').spec.containers[0].image,
      fixture.context.parameters.fixedControllerImage
    );
    assert.equal(fixture.azureCalls.filter(args => args[2] === 'add').length, 1);
    assert.ok(
      [...fixture.pods.values()].every(
        pod =>
          pod.spec.automountServiceAccountToken === false &&
          pod.spec.activeDeadlineSeconds === 90 &&
          pod.spec.containers[0].command[0] === '/alb-controller' &&
          pod.spec.containers[0].args[0] === '--help'
      )
    );
    assert.equal(fixture.kubernetesCalls.filter(args => args.includes('delete')).length, 1);
    assert.throws(() => handler.validate({ ...fixture.context.parameters, nodeCeiling: '3' }));
    writeFileSync(fixture.context.parameters.fixedConfig!, '{}');
    assert.throws(() => handler.validate(fixture.context.parameters), /config/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('C119 refuses unrelated failures, node substitutions, image drift and failed recovery', async () => {
  const handler = aksArchitectureEndToEndCases['aks-c119-v1'];
  assert.ok(handler);
  for (const failure of [
    'control-failed',
    'too-many-nodes',
    'wrong-arm-image',
    'wrong-runtime',
    'wrong-architecture',
    'no-help',
    'no-fault',
    'registry-failure',
    'foreign-event',
    'recovery-failed',
  ]) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'aks-architecture-'));
    try {
      const fixture = architectureContext(directory, failure);
      await assert.rejects(handler.run(fixture.context), failure);
      assert.ok(!fixture.evidence.has('recovery'), failure);
      if (failure !== 'recovery-failed') assert.ok(!fixture.evidence.has('fault'), failure);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('C119 discovery identifies a pending mechanism adaptation without scored admission', () => {
  const entry = listAksEndToEndAuthoring().find(item => item.candidate_id === 'AKS-C119');
  assert.ok(entry);
  assert.equal(entry.scenario_id, 'aks-c119-v1');
  assert.equal(entry.source, 'https://github.com/Azure/AKS/issues/5390');
  assert.equal(entry.fidelity, 'mechanism-adaptation');
  assert.equal(entry.qualification, 'pending');
  assert.equal(entry.execution_eligible, false);
});
