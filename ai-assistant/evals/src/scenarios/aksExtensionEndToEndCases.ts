import assert from 'node:assert/strict';
import { chartInput } from './aksChartCaseSupport.js';
import { metadata, namespaced, objectEvents, probePod, readyPod, requiredParameter, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';
import type { CommandResult } from '../cluster/commandRunner.js';

function extension(context: AksCaseContext, name: string, type: string, version: string, settings: string[] = []) {
  const operation = context.attemptAz(['k8s-extension', 'create', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters',
    '--name', name, '--extension-type', type, '--version', version, '--auto-upgrade-minor-version', 'false',
    ...(settings.length ? ['--configuration-settings', ...settings] : [])]);
  context.save(`${name}-${version}-install`, operation); return operation;
}

function removeExtension(context: AksCaseContext, name: string) {
  context.az(['k8s-extension', 'delete', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', name, '--yes']);
}

const fluxHome: AksEndToEndCase = {
  validate(parameters) {
    requiredParameter(parameters, 'affectedExtensionVersion', /^\d+\.\d+\.\d+$/);
    requiredParameter(parameters, 'controlExtensionVersion', /^\d+\.\d+\.\d+$/);
    requiredParameter(parameters, 'sourceChartOci', /^.+@sha256:[a-f0-9]{64}$/);
    requiredParameter(parameters, 'sourceChartName', /^[a-z0-9][a-z0-9-]*$/);
    requiredParameter(parameters, 'sourceChartVersion', /^\d+\.\d+\.\d+$/);
  },
  async run(context) {
    const registry = `flux${context.owner.replaceAll('-', '').slice(0, 20)}`;
    context.az(['acr', 'create', '--resource-group', context.resourceGroup, '--name', registry, '--location', context.location, '--sku', 'Basic', '--admin-enabled', 'false', '--tags', `headlamp-e2e-owner=${context.owner}`]);
    context.az(['acr', 'import', '--name', registry, '--source', context.parameters.sourceChartOci!, '--image', `charts/${context.parameters.sourceChartName}:${context.parameters.sourceChartVersion}`]);
    const acr = context.az(['acr', 'show', '--resource-group', context.resourceGroup, '--name', registry]);
    const install = (version: string, overrides: string[] = []) => {
      const result = extension(context, 'flux', 'microsoft.flux', version, overrides); assert.equal(result.status, 0);
      const actual = context.az(['k8s-extension', 'show', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', 'flux']);
      const principal = actual.identity?.principalId; assert.ok(principal, 'Managed extension identity required');
      context.az(['role', 'assignment', 'create', '--assignee-object-id', principal, '--assignee-principal-type', 'ServicePrincipal', '--role', 'AcrPull', '--scope', acr.id]);
      return actual;
    };
    const source = () => context.read('helmrepository', 'source');
    const chart = () => context.read('helmchart', 'chart');
    const ready = () => chart().status?.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'True');
    const reconcile = () => context.run(['-n', context.namespace, 'annotate', 'helmrepository/source', `reconcile.fluxcd.io/requestedAt=${Date.now()}`, '--overwrite']);
    await context.phase('baseline', async () => {
      const installed = install(context.parameters.controlExtensionVersion!);
      context.create('oci-source', { apiVersion: 'source.toolkit.fluxcd.io/v1beta2', kind: 'HelmRepository', metadata: metadata(context, 'source'),
        spec: { interval: '10s', type: 'oci', provider: 'azure', url: `oci://${acr.loginServer}/charts` } });
      context.create('oci-chart', { apiVersion: 'source.toolkit.fluxcd.io/v1beta2', kind: 'HelmChart', metadata: metadata(context, 'chart'),
        spec: { interval: '10s', chart: context.parameters.sourceChartName, version: context.parameters.sourceChartVersion, sourceRef: { kind: 'HelmRepository', name: 'source' } } });
      await context.poll(ready, 'Owned OCI chart fetched by control Flux'); return { installed, source: source(), chart: chart() };
    });
    await context.phase('fault', async () => {
      context.az(['k8s-extension', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', 'flux', '--version', context.parameters.affectedExtensionVersion!]);
      reconcile(); let logs: any;
      await context.poll(() => {
        logs = context.kube(['-n', 'flux-system', 'logs', 'deployment/source-controller', '--tail=100']);
        context.save('flux-oci-failure', { logs, source: source(), chart: chart() });
        return /\/dev\/null\/\.config\/helm\/registry\/config.json.*not a directory/i.test(logs.stdout + logs.stderr);
      }, 'Reported Flux HOME registry error'); return { logs, source: source(), chart: chart() };
    });
    await context.phase('recovery', async () => {
      context.az(['k8s-extension', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', 'flux',
        '--configuration-settings', 'source-controller.extraEnvVars[0].name=DOCKER_CONFIG', 'source-controller.extraEnvVars[0].value=/tmp/docker',
        'source-controller.extraEnvVars[1].name=HELM_CONFIG_HOME', 'source-controller.extraEnvVars[1].value=/tmp/helm']);
      reconcile(); await context.poll(ready, 'OCI source after supported writable config override'); return { source: source(), chart: chart() };
    });
  },
};

const automaticDapr: AksEndToEndCase = {
  automatic: true,
  validate(parameters) {
    requiredParameter(parameters, 'affectedExtensionVersion', /^\d+\.\d+\.\d+$/);
    requiredParameter(parameters, 'recoveryExtensionVersion', /^\d+\.\d+\.\d+$/);
  },
  async run(context) {
    const workloads = () => JSON.parse(context.run(['-n', 'dapr-system', 'get', 'deployments', '-o', 'json']));
    const ready = () => { const items = workloads().items; return items.length > 0 && items.every((item: any) => item.status?.availableReplicas >= (item.spec.replicas ?? 1)); };
    await context.phase('baseline', async () => {
      const result = extension(context, 'dapr', 'microsoft.dapr', context.parameters.recoveryExtensionVersion!); assert.equal(result.status, 0);
      await context.poll(ready, 'Supported Dapr extension on Automatic'); const evidence = workloads(); removeExtension(context, 'dapr'); return evidence;
    });
    await context.phase('fault', async () => {
      const result = extension(context, 'dapr', 'microsoft.dapr', context.parameters.affectedExtensionVersion!);
      const extensionState = context.az(['k8s-extension', 'show', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', 'dapr']);
      const events = context.kube(['-n', 'dapr-system', 'get', 'events', '-o', 'json']);
      const diagnostic = JSON.stringify(extensionState) + result.stderr + events.stdout;
      assert.match(diagnostic, /aks-managed-protect-system-namespaces/); assert.match(diagnostic, /serviceaccount|service.account/i); assert.match(diagnostic, /denied|forbidden/i);
      assert.ok(result.status !== 0 || extensionState.provisioningState !== 'Succeeded'); return { result, extensionState, events };
    });
    await context.phase('recovery', async () => {
      removeExtension(context, 'dapr'); const result = extension(context, 'dapr', 'microsoft.dapr', context.parameters.recoveryExtensionVersion!); assert.equal(result.status, 0);
      await context.poll(ready, 'Dapr initialization without disabling namespace protection'); return { result, deployments: workloads() };
    });
  },
};

export function commitServerInventory(result: CommandResult) {
  assert.equal(result.status, 0, 'Image file inspection failed');
  const inventory = JSON.parse(result.stdout);
  assert.equal(inventory?.baseExecutable, true, 'ArgoCD base executable is not a healthy control');
  assert.ok(['absent', 'executable', 'dangling-symlink', 'not-executable'].includes(inventory.commitPath), 'Unknown image file state');
  return { baseExecutable: true, commitPath: inventory.commitPath as string };
}

export function assertMissingCommitServer(pod: any, events: any, logs: CommandResult, image: string) {
  assert.ok(pod.metadata?.uid && pod.spec?.nodeName, 'Actual scheduled Pod identity required');
  assert.equal(pod.spec.containers.length, 1);
  assert.equal(pod.spec.containers[0].image, image);
  const container = pod.status?.containerStatuses?.find((item: any) => item.name === 'controller');
  assert.equal(pod.status?.phase, 'Failed');
  assert.equal(container?.state?.terminated?.exitCode, 127, 'Expected tini missing-executable exit');
  assert.equal(container.restartCount, 0);
  assert.equal(container.imageID?.split('@').at(-1), image.split('@')[1], 'Fault image identity mismatch');
  assert.ok(Array.isArray(events?.items));
  for (const event of events.items) {
    assert.equal(event.involvedObject?.uid, pod.metadata.uid, 'Foreign Pod event');
    assert.ok(!/unauthorized|ImagePullBackOff|ErrImagePull|FailedScheduling|no such host|exec format error/i.test(`${event.reason ?? ''} ${event.message ?? ''}`), 'Unrelated startup failure cannot reproduce C158');
  }
  assert.equal(logs.status, 0, 'Controller startup logs unavailable');
  assert.match(logs.stdout, /\[FATAL tini \(\d+\)\] exec \/usr\/local\/bin\/argocd-commit-server failed: No such file or directory/);
  assert.ok(!/Permission denied|exec format error/i.test(logs.stdout), 'Wrong executable failure');
}

const missingCommitServer: AksEndToEndCase = {
  validate(parameters) {
    requiredParameter(parameters, 'affectedImage', /^mcr\.microsoft\.com\/oss\/v2\/argoproj\/argocd:v3\.2\.5@sha256:[a-f0-9]{64}$/);
    requiredParameter(parameters, 'controlImage', /^quay\.io\/argoproj\/argocd:v3\.2\.5@sha256:[a-f0-9]{64}$/);
    requiredParameter(parameters, 'nodeImageVersion', /^AKSUbuntu-[a-zA-Z0-9._-]+$/);
  },
  async run(context) {
    const affectedImage = context.parameters.affectedImage!;
    const controlImage = context.parameters.controlImage!;
    const nodes = JSON.parse(context.run(['get', 'nodes', '-o', 'json']));
    assert.equal(nodes.items.length, 1, 'C158 requires one owned node');
    const node = nodes.items[0];
    assert.equal(node.status.nodeInfo.architecture, 'amd64');
    assert.equal(node.metadata.labels['kubernetes.azure.com/node-image-version'], context.parameters.nodeImageVersion);
    assert.ok(node.metadata.uid);
    const pod = (name: string, image: string, inspect: boolean) => {
      const resource: any = probePod(context, name);
      resource.spec.nodeSelector = { 'kubernetes.io/os': 'linux', 'kubernetes.io/arch': 'amd64' };
      resource.spec.activeDeadlineSeconds = inspect ? 900 : 90;
      resource.spec.securityContext = { runAsUser: 999, runAsGroup: 999 };
      resource.spec.containers[0].name = 'controller';
      resource.spec.containers[0].image = image;
      resource.spec.containers[0].resources = { requests: { cpu: '25m', memory: '64Mi' }, limits: { cpu: '250m', memory: '256Mi' } };
      resource.spec.containers[0].command = inspect ? ['/bin/sh', '-c', 'exec tail -f /dev/null']
        : ['/usr/bin/tini', '--', '/usr/local/bin/argocd-commit-server'];
      if (!inspect) resource.spec.containers[0].args = ['--help'];
      return resource;
    };
    const identities = new Map<string, { uid: string; image: string }>();
    const current = (name: string) => {
      const identity = identities.get(name); assert.ok(identity);
      const object = context.read('pod', name);
      assert.equal(object.metadata.uid, identity.uid, 'Pod changed during image comparison');
      assert.equal(object.spec.nodeName, node.metadata.name);
      assert.equal(object.spec.containers[0].image, identity.image);
      const actualNode = JSON.parse(context.run(['get', 'node', node.metadata.name, '-o', 'json']));
      assert.equal(actualNode.metadata.uid, node.metadata.uid, 'Node changed during image comparison');
      assert.equal(actualNode.metadata.labels['kubernetes.azure.com/node-image-version'], context.parameters.nodeImageVersion);
      const status = object.status?.containerStatuses?.find((item: any) => item.name === 'controller');
      assert.equal(status?.restartCount, 0);
      assert.equal(status?.imageID?.split('@').at(-1), identity.image.split('@')[1], 'Image content changed');
      return object;
    };
    let sequence = 0;
    const inspect = (name: string) => {
      current(name);
      const result = context.kube(namespaced(context, ['exec', name, '-c', 'controller', '--', '/bin/sh', '-c',
        'test -x /usr/local/bin/argocd || exit 11; ' +
        'if test -L /usr/local/bin/argocd-commit-server && ! test -e /usr/local/bin/argocd-commit-server; then state=dangling-symlink; ' +
        'elif test -x /usr/local/bin/argocd-commit-server; then state=executable; ' +
        'elif test -e /usr/local/bin/argocd-commit-server; then state=not-executable; else state=absent; fi; ' +
        'printf \'{"baseExecutable":true,"commitPath":"%s"}\\n\' "$state"']));
      context.save(`commit-server-inspection-${++sequence}`, { name, result });
      return commitServerInventory(result);
    };
    const help = (name: string) => {
      current(name);
      const result = context.kube(namespaced(context, ['exec', name, '-c', 'controller', '--', '/usr/local/bin/argocd', '--help']));
      context.save(`argocd-base-help-${++sequence}`, { name, result });
      assert.equal(result.status, 0, 'ArgoCD base command does not run');
      assert.match(result.stdout, /Usage:/); assert.match(result.stdout, /argocd/);
    };
    const completed = async (name: string, image: string) => {
      const uid = context.read('pod', name).metadata.uid; assert.ok(uid);
      const existing = identities.get(name);
      if (existing) { assert.equal(uid, existing.uid, 'Control Pod was replaced'); assert.equal(image, existing.image); }
      identities.set(name, { uid, image });
      await context.poll(() => {
        const object = context.read('pod', name);
        assert.equal(object.metadata.uid, uid);
        assert.notEqual(object.status?.phase, 'Failed', 'Commit-server help is not a working control');
        return object.status?.phase === 'Succeeded';
      }, 'Commit-server help completes');
      const object = current(name);
      assert.equal(object.status.containerStatuses[0].state?.terminated?.exitCode, 0);
      const logs = context.kube(namespaced(context, ['logs', name, '-c', 'controller', '--tail=100']));
      assert.equal(logs.status, 0); assert.match(logs.stdout, /Usage:/); assert.match(logs.stdout, /argocd-commit-server/);
      context.save(`commit-server-help-${++sequence}`, { object, logs });
      return { pod: object, help: logs.stdout };
    };
    await context.phase('baseline', async () => {
      const inventories: Record<string, unknown> = {};
      for (const [name, image] of [['affected-inspect', affectedImage], ['control-inspect', controlImage]]) {
        context.create(name!, pod(name!, image!, true));
        const ready = await readyPod(context, name!);
        identities.set(name!, { uid: ready.metadata.uid, image: image! });
        help(name!); inventories[name!] = inspect(name!);
      }
      assert.equal(inspect('control-inspect').commitPath, 'executable');
      context.create('commit-control', pod('commit-control', controlImage, false));
      return { node, inventories, control: await completed('commit-control', controlImage), scope: 'binary-content-adaptation-not-extension-install' };
    });
    await context.phase('fault', async () => {
      const inventory = inspect('affected-inspect');
      assert.equal(inventory.commitPath, 'absent', 'Missing-path source symptom not present; dangling symlink or permissions are different faults');
      context.create('commit-subject', pod('commit-subject', affectedImage, false));
      const uid = context.read('pod', 'commit-subject').metadata.uid; assert.ok(uid);
      identities.set('commit-subject', { uid, image: affectedImage });
      await context.poll(() => {
        const object = context.read('pod', 'commit-subject'); assert.equal(object.metadata.uid, uid);
        const events = objectEvents(context, object); context.save('commit-subject-startup', { object, events });
        assert.notEqual(object.status?.phase, 'Succeeded', 'Affected commit-server ran; fault not reproduced');
        return object.status?.phase === 'Failed';
      }, 'Affected tini startup fails');
      const object = current('commit-subject');
      const events = objectEvents(context, object);
      const logs = context.kube(namespaced(context, ['logs', 'commit-subject', '-c', 'controller', '--tail=100']));
      context.save('commit-subject-failure', { object, events, logs });
      assertMissingCommitServer(object, events, logs, affectedImage);
      assert.equal(inspect('affected-inspect').commitPath, 'absent');
      help('affected-inspect'); await completed('commit-control', controlImage);
      return { inventory, object, events, logs, faultObserved: true, extensionInstalled: false };
    });
    await context.phase('recovery', async () => {
      const object = current('commit-subject');
      assert.equal(object.metadata.labels['headlamp-e2e-owner'], context.owner);
      context.run(namespaced(context, ['delete', 'pod', 'commit-subject', '--wait=true', '--timeout=60s']));
      assert.equal(context.run(namespaced(context, ['get', 'pod', 'commit-subject', '--ignore-not-found', '-o', 'name'])).trim(), '');
      identities.delete('commit-subject');
      context.create('commit-recovery', pod('commit-subject', controlImage, false));
      const recovered = await completed('commit-subject', controlImage);
      assert.notEqual(recovered.pod.metadata.uid, object.metadata.uid);
      assert.equal(inspect('affected-inspect').commitPath, 'absent');
      return { ...recovered, kind: 'official-image-binary-control-not-managed-extension-repair', extensionInstalled: false, repositoryAccessed: false };
    });
  },
};

export const aksExtensionEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c012-v1': fluxHome,
  'aks-c028-v1': automaticDapr,
  'aks-c158-v1': missingCommitServer,
};