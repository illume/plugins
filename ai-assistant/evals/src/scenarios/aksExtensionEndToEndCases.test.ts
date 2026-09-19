import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aksExtensionEndToEndCases,
  assertMissingCommitServer,
  commitServerInventory,
} from './aksExtensionEndToEndCases.js';
import type { AksCaseContext } from './aksEndToEndCases.js';
import { listAksEndToEndAuthoring } from './aksEndToEndScenarios.js';

const affectedImage = `mcr.microsoft.com/oss/v2/argoproj/argocd:v3.2.5@sha256:${'a'.repeat(64)}`;

test('C158 keeps absent paths separate from dangling symlinks and permission failures', () => {
  for (const commitPath of ['absent', 'executable', 'dangling-symlink', 'not-executable']) {
    assert.equal(
      commitServerInventory({
        status: 0,
        stdout: JSON.stringify({ baseExecutable: true, commitPath }),
        stderr: '',
      }).commitPath,
      commitPath
    );
  }
  assert.throws(
    () => commitServerInventory({ status: 127, stdout: '', stderr: 'shell missing' }),
    /inspection failed/
  );
  assert.throws(
    () =>
      commitServerInventory({
        status: 0,
        stdout: '{"baseExecutable":false,"commitPath":"absent"}',
        stderr: '',
      }),
    /base executable/
  );
  assert.throws(
    () =>
      commitServerInventory({
        status: 0,
        stdout: '{"baseExecutable":true,"commitPath":"unknown"}',
        stderr: '',
      }),
    /Unknown/
  );
});

test('C158 requires the exact missing-executable startup and actual Pod/runtime identity', () => {
  const pod = {
    metadata: { uid: 'subject' },
    spec: { nodeName: 'node', containers: [{ image: affectedImage }] },
    status: {
      phase: 'Failed',
      containerStatuses: [
        {
          name: 'controller',
          restartCount: 0,
          imageID: affectedImage,
          state: { terminated: { exitCode: 127 } },
        },
      ],
    },
  };
  const logs = {
    status: 0,
    stdout:
      '[FATAL tini (7)] exec /usr/local/bin/argocd-commit-server failed: No such file or directory',
    stderr: '',
  };
  assertMissingCommitServer(pod, { items: [] }, logs, affectedImage);
  assert.throws(
    () =>
      assertMissingCommitServer(
        pod,
        { items: [{ involvedObject: { uid: 'other' } }] },
        logs,
        affectedImage
      ),
    /Foreign/
  );
  assert.throws(
    () => assertMissingCommitServer(pod, { items: [] }, { ...logs, status: 1 }, affectedImage),
    /logs unavailable/
  );
  assert.throws(() =>
    assertMissingCommitServer(
      pod,
      { items: [] },
      { ...logs, stdout: logs.stdout.replace('No such file or directory', 'Permission denied') },
      affectedImage
    )
  );
  pod.status.containerStatuses[0]!.state.terminated.exitCode = 1;
  assert.throws(
    () => assertMissingCommitServer(pod, { items: [] }, logs, affectedImage),
    /missing-executable exit/
  );
});

function imageContext(failure?: string) {
  const parameters = {
    affectedImage,
    controlImage: `quay.io/argoproj/argocd:v3.2.5@sha256:${'b'.repeat(64)}`,
    nodeImageVersion: 'AKSUbuntu-2404gen2containerd-test',
  };
  const node = {
    metadata: {
      name: 'owned-node',
      uid: 'node-uid',
      labels: { 'kubernetes.azure.com/node-image-version': parameters.nodeImageVersion },
    },
    status: { nodeInfo: { architecture: 'amd64' } },
  };
  const phases: string[] = [];
  const evidence = new Map<string, any>();
  const pods = new Map<string, any>();
  const commands: string[][] = [];
  let sequence = 0;
  const context = {
    namespace: 'owned',
    owner: 'owner',
    probeImage: 'unused',
    parameters,
    create(_name: string, resource: any) {
      assert.equal(resource.kind, 'Pod');
      const pod = structuredClone(resource);
      pod.metadata.uid = `pod-${++sequence}`;
      pod.spec.nodeName = node.metadata.name;
      const inspecting = pod.spec.containers[0].command[0] === '/bin/sh';
      const affected = pod.spec.containers[0].image === affectedImage;
      const fail =
        !inspecting &&
        (affected ||
          failure === 'control-execution' ||
          (failure === 'recovery-execution' && phases.includes('recovery')));
      pod.status = {
        phase: inspecting ? 'Running' : fail ? 'Failed' : 'Succeeded',
        conditions: [{ type: 'Ready', status: 'True' }],
        containerStatuses: [
          {
            name: 'controller',
            imageID:
              failure === 'runtime-image' ? 'wrong@sha256:wrong' : pod.spec.containers[0].image,
            restartCount: 0,
            state: inspecting ? { running: {} } : { terminated: { exitCode: fail ? 127 : 0 } },
          },
        ],
      };
      pods.set(pod.metadata.name, pod);
    },
    read(kind: string, name: string) {
      assert.equal(kind, 'pod');
      assert.ok(pods.has(name));
      const pod = structuredClone(pods.get(name));
      if (failure === 'replaced-control' && phases.includes('fault') && name === 'commit-control')
        pod.metadata.uid = 'foreign';
      if (
        failure === 'restarted-inspector' &&
        phases.includes('fault') &&
        name === 'affected-inspect'
      )
        pod.status.containerStatuses[0].restartCount = 1;
      if (failure === 'foreign-owner' && phases.includes('recovery') && name === 'commit-subject')
        pod.metadata.labels['headlamp-e2e-owner'] = 'someone-else';
      return pod;
    },
    run(args: string[]) {
      commands.push(args);
      if (args[0] === 'get' && args[1] === 'nodes') return JSON.stringify({ items: [node] });
      if (args[0] === 'get' && args[1] === 'node')
        return JSON.stringify(
          failure === 'changed-node'
            ? { ...node, metadata: { ...node.metadata, uid: 'foreign' } }
            : node
        );
      if (args.includes('events')) {
        const uid = args[args.indexOf('--field-selector') + 1]!.split('=')[1];
        return JSON.stringify({
          items:
            failure === 'foreign-event'
              ? [{ involvedObject: { uid: 'foreign' }, message: 'Failed' }]
              : failure === 'registry'
              ? [{ involvedObject: { uid }, reason: 'Failed', message: 'unauthorized' }]
              : [],
        });
      }
      if (args.includes('delete')) {
        pods.delete(args[args.indexOf('delete') + 2]!);
        return '';
      }
      assert.ok(args.includes('--ignore-not-found'));
      return failure === 'delete-incomplete' ? 'pod/commit-subject' : '';
    },
    kube(args: string[]) {
      commands.push(args);
      const name = args[args.indexOf(args.includes('exec') ? 'exec' : 'logs') + 1]!;
      const pod = pods.get(name);
      assert.ok(pod);
      const affected = pod.spec.containers[0].image === affectedImage;
      if (args.includes('/bin/sh')) {
        let commitPath = affected ? 'absent' : 'executable';
        if (affected && failure === 'dangling') commitPath = 'dangling-symlink';
        if (affected && failure === 'source-fixed') commitPath = 'executable';
        return {
          status: failure === 'inspection' ? 1 : 0,
          stdout: JSON.stringify({ baseExecutable: true, commitPath }),
          stderr: '',
        };
      }
      if (args.includes('exec'))
        return {
          status: failure === 'base-execution' ? 1 : 0,
          stdout: 'Usage: argocd [command]',
          stderr: '',
        };
      if (affected)
        return {
          status: failure === 'logs' ? 1 : 0,
          stdout:
            failure === 'permission'
              ? '[FATAL tini (7)] exec /usr/local/bin/argocd-commit-server failed: Permission denied'
              : '[FATAL tini (7)] exec /usr/local/bin/argocd-commit-server failed: No such file or directory',
          stderr: '',
        };
      return {
        status: 0,
        stdout: failure === 'help-output' ? 'running' : 'Usage: argocd-commit-server [flags]',
        stderr: '',
      };
    },
    save(name: string, value: unknown) {
      evidence.set(name, structuredClone(value));
    },
    async poll(action: () => boolean, message: string) {
      assert.ok(action(), message);
    },
    async phase(name: string, action: () => Promise<unknown>) {
      phases.push(name);
      evidence.set(name, await action());
    },
    az() {
      throw Error('No additional Azure operation allowed in this image-content case');
    },
  } as unknown as AksCaseContext;
  return { context, pods, phases, evidence, commands };
}

test('C158 exercises unaffected binary controls and source-path failure before replacing the subject image', async () => {
  const handler = aksExtensionEndToEndCases['aks-c158-v1'];
  assert.ok(handler);
  const fixture = imageContext();
  handler.validate(fixture.context.parameters);
  await handler.run(fixture.context);
  assert.deepEqual(fixture.phases, ['baseline', 'fault', 'recovery']);
  assert.equal(fixture.evidence.get('fault').inventory.commitPath, 'absent');
  assert.equal(fixture.evidence.get('fault').faultObserved, true);
  assert.equal(fixture.evidence.get('recovery').extensionInstalled, false);
  assert.equal(fixture.evidence.get('recovery').repositoryAccessed, false);
  assert.equal(
    fixture.pods.get('commit-subject').spec.containers[0].image,
    fixture.context.parameters.controlImage
  );
  assert.equal(fixture.commands.filter(args => args.includes('delete')).length, 1);
  assert.ok(
    [...fixture.pods.values()].every(
      pod =>
        pod.spec.automountServiceAccountToken === false &&
        pod.spec.securityContext.runAsUser === 999
    )
  );
  for (const parameter of Object.keys(fixture.context.parameters))
    assert.throws(() => handler.validate({ ...fixture.context.parameters, [parameter]: '' }));
});

test('C158 rejects content, identity, startup and recovery mismatches rather than grading them as the reported defect', async () => {
  const handler = aksExtensionEndToEndCases['aks-c158-v1'];
  assert.ok(handler);
  for (const failure of [
    'inspection',
    'base-execution',
    'control-execution',
    'runtime-image',
    'changed-node',
    'help-output',
    'dangling',
    'source-fixed',
    'permission',
    'logs',
    'registry',
    'foreign-event',
    'replaced-control',
    'restarted-inspector',
    'foreign-owner',
    'delete-incomplete',
    'recovery-execution',
  ]) {
    const fixture = imageContext(failure);
    await assert.rejects(handler.run(fixture.context), failure);
    assert.ok(!fixture.evidence.has('recovery'), failure);
  }
});

test('C158 discovery retains source identity and pending qualification', () => {
  const entry = listAksEndToEndAuthoring().find(item => item.candidate_id === 'AKS-C158');
  assert.ok(entry);
  assert.equal(entry.source, 'https://github.com/Azure/AKS/issues/5850');
  assert.equal(entry.fidelity, 'mechanism-adaptation');
  assert.equal(entry.qualification, 'pending');
  assert.equal(entry.execution_eligible, false);
});
