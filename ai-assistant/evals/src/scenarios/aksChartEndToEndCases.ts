import assert from 'node:assert/strict';
import { chartInput, installChart, deployment, deploymentPods, available, controllerLogs } from './aksChartCaseSupport.js';
import { metadata, namespaced, objectEvents, requiredParameter, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';

function valuePath(target: Record<string, any>, key: string, value: unknown) {
  assert.match(key, /^[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)*$/);
  const parts = key.split('.'); let current = target;
  for (const part of parts.slice(0, -1)) { assert.ok(!['constructor', 'prototype', '__proto__'].includes(part)); current[part] ??= {}; current = current[part]; }
  const leaf = parts.at(-1)!; assert.ok(!['constructor', 'prototype', '__proto__'].includes(leaf)); current[leaf] = value;
}

const albImagePath: AksEndToEndCase = {
  enableOidc: true,
  validate(parameters) {
    chartInput(parameters, 'affectedChart'); chartInput(parameters, 'recoveryChart');
    requiredParameter(parameters, 'sourceControllerImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
    for (const name of ['registryValueKey', 'repositoryValueKey', 'tagValueKey']) requiredParameter(parameters, name, /^[a-zA-Z][a-zA-Z0-9.]+$/);
    requiredParameter(parameters, 'controllerDeployment', /^[a-z0-9][a-z0-9-]+$/);
    requiredParameter(parameters, 'imageTag', /^[a-zA-Z0-9_.-]+$/);
  },
  async run(context) {
    const registry = `hl${context.owner.replaceAll('-', '').slice(0, 22)}`;
    const repository = 'owned/alb-controller';
    context.az(['acr', 'create', '--resource-group', context.resourceGroup, '--name', registry, '--location', context.location, '--sku', 'Basic', '--admin-enabled', 'false', '--tags', `headlamp-e2e-owner=${context.owner}`]);
    context.az(['acr', 'import', '--name', registry, '--source', context.parameters.sourceControllerImage!, '--image', `${repository}:${context.parameters.imageTag}`]);
    const acr = context.az(['acr', 'show', '--name', registry, '--resource-group', context.resourceGroup]);
    context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'research', '--attach-acr', acr.id]);
    const values: Record<string, any> = {};
    valuePath(values, context.parameters.registryValueKey!, acr.loginServer);
    valuePath(values, context.parameters.repositoryValueKey!, repository);
    valuePath(values, context.parameters.tagValueKey!, context.parameters.imageTag!);
    const target = context.parameters.controllerDeployment!;
    const expected = `${acr.loginServer}/${repository}:${context.parameters.imageTag}`;
    await context.phase('baseline', async () => {
      installChart(context, 'alb', 'recoveryChart', 'alb-system', values);
      const current = await available(context, 'alb-system', target);
      assert.ok(current.spec.template.spec.containers.some((container: any) => container.image === expected));
      return current;
    });
    await context.phase('fault', async () => {
      installChart(context, 'alb', 'affectedChart', 'alb-system', values, false);
      let evidence: unknown;
      await context.poll(() => {
        const current = deployment(context, 'alb-system', target); const pods = deploymentPods(context, 'alb-system', target);
        const bad = current.spec.template.spec.containers.find((container: any) => container.image.startsWith(`${acr.loginServer}/public/`));
        evidence = { current, pods, expected }; context.save('image-path-observation', evidence);
        return !!bad && pods.items.some((pod: any) => pod.status?.containerStatuses?.some((container: any) =>
          container.image === bad.image && ['ImagePullBackOff', 'ErrImagePull'].includes(container.state?.waiting?.reason)));
      }, 'Injected public image path and pull failure'); return evidence;
    });
    await context.phase('recovery', async () => { installChart(context, 'alb', 'recoveryChart', 'alb-system', values); return available(context, 'alb-system', target); });
  },
};

const albUninstall: AksEndToEndCase = {
  enableOidc: true,
  validate(parameters) {
    chartInput(parameters, 'affectedChart');
    requiredParameter(parameters, 'controllerDeployment', /^[a-z0-9][a-z0-9-]+$/);
    requiredParameter(parameters, 'tolerationsValueKey', /^[a-zA-Z][a-zA-Z0-9.]+$/);
  },
  async run(context) {
    const nodes = JSON.parse(context.run(['get', 'nodes', '-o', 'json'])); assert.ok(nodes.items.length > 0);
    const taint = (remove: boolean) => { for (const node of nodes.items) context.run(['taint', 'nodes', node.metadata.name, remove ? 'research-' : 'research=reserved:NoSchedule', '--overwrite']); };
    const values: Record<string, any> = {};
    valuePath(values, context.parameters.tolerationsValueKey!, [{ key: 'research', operator: 'Equal', value: 'reserved', effect: 'NoSchedule' }]);
    await context.phase('baseline', async () => {
      installChart(context, 'alb', 'affectedChart', 'alb-system', values);
      await available(context, 'alb-system', context.parameters.controllerDeployment!);
      const removed = context.helm(['uninstall', 'alb', '-n', 'alb-system', '--wait', '--timeout', '90s']); assert.equal(removed.status, 0);
      installChart(context, 'alb', 'affectedChart', 'alb-system', values); taint(false);
      return available(context, 'alb-system', context.parameters.controllerDeployment!);
    });
    await context.phase('fault', async () => {
      const uninstall = context.helm(['uninstall', 'alb', '-n', 'alb-system', '--wait', '--timeout', '60s']); assert.notEqual(uninstall.status, 0);
      const jobs = JSON.parse(context.run(['-n', 'alb-system', 'get', 'jobs', '-o', 'json']));
      const hook = jobs.items.find((job: any) => job.metadata.annotations?.['helm.sh/hook']?.includes('pre-delete'));
      assert.ok(hook, 'No real pre-delete hook observed');
      const pods = JSON.parse(context.run(['-n', 'alb-system', 'get', 'pods', '-l', `job-name=${hook.metadata.name}`, '-o', 'json']));
      assert.ok(pods.items.length > 0); const pod = pods.items[0];
      const events = JSON.parse(context.run(['-n', 'alb-system', 'get', 'events', '--field-selector', `involvedObject.uid=${pod.metadata.uid}`, '-o', 'json']));
      assert.equal(pod.status.phase, 'Pending');
      assert.ok(events.items.some((event: any) => event.reason === 'FailedScheduling' && /untolerated taint|had taint/i.test(event.message ?? '')));
      return { uninstall, hook, pod, events };
    });
    await context.phase('recovery', async () => {
      taint(true);
      const result = context.helm(['uninstall', 'alb', '-n', 'alb-system', '--wait', '--timeout', '120s']); assert.equal(result.status, 0);
      const releases = context.helm(['list', '-n', 'alb-system', '--all', '-o', 'json']); assert.equal(releases.status, 0);
      assert.ok(!JSON.parse(releases.stdout).some((release: any) => release.name === 'alb')); return { result, releases: JSON.parse(releases.stdout) };
    });
  },
};

const calicoCertificate: AksEndToEndCase = {
  validate(parameters) {
    chartInput(parameters, 'affectedOperator'); chartInput(parameters, 'controlOperator');
    for (const field of ['operatorRole', 'operatorDeployment', 'apiServerDeployment']) requiredParameter(parameters, field, /^[a-zA-Z0-9:._-]+$/);
  },
  async run(context) {
    const configure = (prefix: string) => {
      installChart(context, 'tigera', prefix, 'tigera-operator', { installation: { kubernetesProvider: 'AKS' }, apiServer: { enabled: true } }, false);
    };
    await context.phase('baseline', async () => {
      configure('controlOperator'); await available(context, 'tigera-operator', context.parameters.operatorDeployment!);
      const server = await available(context, 'calico-apiserver', context.parameters.apiServerDeployment!);
      const secret = context.run(['-n', 'calico-apiserver', 'get', 'secret', 'calico-apiserver-certs', '-o', 'jsonpath={.metadata.uid}']);
      assert.ok(secret.trim()); return { server, certificateSecretUid: secret.trim() };
    });
    await context.phase('fault', async () => {
      configure('affectedOperator');
      context.run(['-n', 'calico-apiserver', 'delete', 'secret', 'calico-apiserver-certs']);
      context.run(['-n', 'calico-apiserver', 'rollout', 'restart', `deployment/${context.parameters.apiServerDeployment}`]);
      let captured: unknown;
      await context.poll(() => {
        const logs = controllerLogs(context, 'tigera-operator', context.parameters.operatorDeployment!);
        const pods = deploymentPods(context, 'calico-apiserver', context.parameters.apiServerDeployment!);
        const events = JSON.parse(context.run(['-n', 'calico-apiserver', 'get', 'events', '-o', 'json']));
        captured = { logs, pods, events }; context.save('operator-rbac-observation', captured);
        return /forbidden/i.test(logs.stdout + logs.stderr) && /mutatingwebhookconfigurations/i.test(logs.stdout + logs.stderr) &&
          events.items.some((event: any) => event.reason === 'FailedMount' && /calico-apiserver-certs.*not found/i.test(event.message ?? ''));
      }, 'Missing operator permission blocks certificate reconciliation'); return captured;
    });
    await context.phase('recovery', async () => {
      const role = JSON.parse(context.run(['get', 'clusterrole', context.parameters.operatorRole!, '-o', 'json']));
      role.rules.push({ apiGroups: ['admissionregistration.k8s.io'], resources: ['mutatingwebhookconfigurations'], verbs: ['get', 'list', 'watch'] });
      context.replace('operator-role-recovery', role);
      const server = await available(context, 'calico-apiserver', context.parameters.apiServerDeployment!);
      const uid = context.run(['-n', 'calico-apiserver', 'get', 'secret', 'calico-apiserver-certs', '-o', 'jsonpath={.metadata.uid}']);
      assert.ok(uid.trim()); return { server, certificateSecretUid: uid.trim() };
    });
  },
};

const preexistingVpa: AksEndToEndCase = {
  validate(parameters) { chartInput(parameters, 'goldilocksChart'); requiredParameter(parameters, 'vpaSelector', /^[a-zA-Z0-9_.=,/-]+$/); },
  async run(context) {
    const managed = () => JSON.parse(context.run(['-n', 'kube-system', 'get', 'pods', '-l', context.parameters.vpaSelector!, '-o', 'json']));
    const ready = () => managed().items.some((pod: any) => pod.status?.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'True'));
    await context.phase('baseline', async () => {
      context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'research', '--enable-vpa']);
      await context.poll(ready, 'Clean managed VPA installation'); const baseline = managed();
      context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'research', '--disable-vpa']);
      await context.poll(() => managed().items.length === 0, 'Managed VPA teardown before ownership case');
      return baseline;
    });
    await context.phase('fault', async () => {
      installChart(context, 'goldilocks', 'goldilocksChart', 'goldilocks', { vpa: { enabled: true } });
      const crds = JSON.parse(context.run(['get', 'crds', '-o', 'json'])).items.filter((crd: any) => crd.spec.group === 'autoscaling.k8s.io');
      assert.ok(crds.some((crd: any) => crd.metadata.name === 'verticalpodautoscalers.autoscaling.k8s.io'));
      context.save('preexisting-vpa-crds', crds);
      context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'research', '--enable-vpa']);
      const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
      assert.equal(cluster.workloadAutoScalerProfile?.verticalPodAutoscaler?.enabled, true);
      for (let sample = 0; sample < 12; sample++) {
        assert.equal(ready(), false, 'Managed VPA became ready; collision not reproduced');
        await context.wait(5000);
      }
      return { cluster: cluster.workloadAutoScalerProfile, existing: crds, managed: managed() };
    });
    await context.phase('recovery', async () => {
      context.save('vpa-test-resources', JSON.parse(context.run(['get', 'verticalpodautoscalers.autoscaling.k8s.io', '-A', '-o', 'json'])));
      const uninstall = context.helm(['uninstall', 'goldilocks', '-n', 'goldilocks', '--wait', '--timeout', '90s']); assert.equal(uninstall.status, 0);
      for (const name of ['verticalpodautoscalers.autoscaling.k8s.io', 'verticalpodautoscalercheckpoints.autoscaling.k8s.io']) context.run(['delete', 'crd', name, '--ignore-not-found', '--wait=true', '--timeout=60s']);
      context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'research', '--disable-vpa']);
      context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'research', '--enable-vpa']);
      await context.poll(ready, 'Managed VPA after owned CRD migration'); return managed();
    });
  },
};

export const aksChartEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c014-v1': albImagePath,
  'aks-c016-v1': calicoCertificate,
  'aks-c030-v1': albUninstall,
  'aks-c049-v1': preexistingVpa,
};