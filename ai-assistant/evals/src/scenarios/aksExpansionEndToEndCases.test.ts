import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aksNetworkArguments, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';
import { aksExpansionEndToEndCases, additiveAllowPolicy, assertHairpinExpectation, cidrEgressPolicy, hairpinProbeOutcome, namedPortPolicy, parseNpmSets, referencedPodSets } from './aksExpansionEndToEndCases.js';
import { listAksEndToEndAuthoring } from './aksEndToEndScenarios.js';
import { normalizeOwnedAksContext } from '../cluster/provisioning/aksEndToEnd.js';
import type { CommandRunner } from '../cluster/commandRunner.js';

function definition(options: Partial<AksEndToEndCase>): AksEndToEndCase {
  return { validate() {}, async run() {}, ...options };
}

test('AKS network selection preserves existing modes and explicitly supports kubenet', () => {
  assert.deepEqual(aksNetworkArguments(), ['--network-plugin', 'azure', '--network-plugin-mode', 'overlay']);
  assert.deepEqual(aksNetworkArguments(definition({ nodeSubnetNetworking: true })), ['--network-plugin', 'azure']);
  assert.deepEqual(aksNetworkArguments(definition({ bringYourOwnCni: true })), ['--network-plugin', 'none', '--no-wait']);
  assert.deepEqual(aksNetworkArguments(definition({ networkPlugin: 'kubenet' })), ['--network-plugin', 'kubenet']);
});

test('kubenet rejects incompatible CNI options before provisioning', () => {
  for (const options of [
    { bringYourOwnCni: true }, { nodeSubnetNetworking: true }, { dynamicPodSubnet: true },
    { networkDataplane: 'cilium' as const }, { enableAcns: true }, { networkPolicy: 'azure' as const },
  ]) assert.throws(() => aksNetworkArguments(definition({ networkPlugin: 'kubenet', ...options })));
});

test('hairpin oracle distinguishes healthy controls, timeouts and unrelated failures', () => {
  const healthy = { status: 0, stdout: '<h1>Welcome to nginx!</h1>', stderr: '' };
  const timeout = { status: 28, stdout: '', stderr: 'curl: (28) Connection timed out' };
  assert.equal(hairpinProbeOutcome(healthy), 'healthy');
  assert.equal(hairpinProbeOutcome(timeout), 'timeout');
  for (const status of [0, 6, 7, 22, 127]) assert.equal(hairpinProbeOutcome({ status, stdout: '', stderr: '' }), 'inconclusive');
  assert.equal(assertHairpinExpectation(Array(6).fill(healthy), 'healthy-control').faultObserved, false);
  assert.equal(assertHairpinExpectation(Array(6).fill(timeout), 'reproduce-fault').faultObserved, true);
  assert.throws(() => assertHairpinExpectation(Array(6).fill(healthy), 'reproduce-fault'), /not reproduced/);
  assert.throws(() => assertHairpinExpectation(Array(6).fill(timeout), 'healthy-control'), /control failed/);
  assert.throws(() => assertHairpinExpectation([timeout], 'reproduce-fault'), /paired/);
  assert.throws(() => assertHairpinExpectation([...Array(5).fill(timeout), healthy], 'reproduce-fault'));
});

test('C159 requires immutable images, exact node image and an explicit outcome expectation', () => {
  const handler = aksExpansionEndToEndCases['aks-c159-v1'];
  assert.ok(handler);
  const parameters = { serverImage: `nginx@sha256:${'a'.repeat(64)}`,
    nodeImageVersion: 'AKSUbuntu-2404gen2containerd-202608.14.0', expectation: 'healthy-control' };
  assert.deepEqual(aksNetworkArguments(handler), ['--network-plugin', 'kubenet']);
  handler.validate(parameters);
  for (const name of Object.keys(parameters)) assert.throws(() => handler.validate({ ...parameters, [name]: '' }));
  assert.throws(() => handler.validate({ ...parameters, serverImage: 'nginx:alpine' }));
  assert.throws(() => handler.validate({ ...parameters, expectation: 'auto' }));
});

test('authoring discovery includes implemented expansion cases without admitting research-only entries', () => {
  const entries = listAksEndToEndAuthoring();
  const hairpin = entries.find(entry => entry.candidate_id === 'AKS-C159');
  assert.ok(hairpin);
  assert.equal(hairpin.scenario_id, 'aks-c159-v1');
  assert.equal(hairpin.source, 'https://github.com/Azure/AKS/issues/5669');
  assert.equal(hairpin.fidelity, 'mechanism-adaptation');
  assert.equal(hairpin.execution_eligible, false);
  assert.equal(hairpin.qualification, 'pending');
  assert.equal(hairpin.verification_status, 'see-attempt-reports');
  assert.ok(!entries.some(entry => entry.candidate_id === 'AKS-C101'));
});

test('owned admin kubeconfig is normalized only after checking context count and server', () => {
  const calls: string[][] = [];
  const runner: CommandRunner = (command, args) => {
    assert.equal(command, 'kubectl'); calls.push(args);
    const stdout = args.includes('get-contexts') ? 'research-admin\n'
      : args.includes('view') ? 'https://owned.example.test:443' : '';
    return { status: 0, stdout, stderr: '' };
  };
  normalizeOwnedAksContext('/private/test/kubeconfig', 'owner', ['owned.example.test'], runner);
  assert.deepEqual(calls.at(-1), ['--kubeconfig', '/private/test/kubeconfig', 'config', 'rename-context', 'research-admin', 'owner']);
  assert.throws(() => normalizeOwnedAksContext('/private/test/kubeconfig', 'owner', ['other.example.test'], runner), /another cluster/);
  assert.throws(() => normalizeOwnedAksContext('/private/test/kubeconfig', 'owner', ['owned.example.test'],
    () => ({ status: 0, stdout: 'first\nsecond\n', stderr: '' })), /exactly one/);
});

test('C192 keeps deny-all, numeric and named-port policy semantics distinct', () => {
  const context = { namespace: 'owned', owner: 'test-owner' };
  assert.deepEqual(namedPortPolicy(context, null).spec.ingress, []);
  assert.deepEqual(namedPortPolicy(context, 80).spec.ingress, [{ ports: [{ protocol: 'TCP', port: 80 }] }]);
  assert.deepEqual(namedPortPolicy(context, 'serve-80').spec.ingress, [{ ports: [{ protocol: 'TCP', port: 'serve-80' }] }]);
  const handler = aksExpansionEndToEndCases['aks-c192-v1'];
  assert.ok(handler);
  assert.equal(handler.networkPolicy, 'azure');
  assert.deepEqual(aksNetworkArguments(handler), ['--network-plugin', 'azure']);
  const parameters = { serverImage: `nginx@sha256:${'a'.repeat(64)}`, nodeImageVersion: 'AKSUbuntu-2404gen2containerd-202609.03.1',
    npmImage: 'mcr.microsoft.com/containernetworking/azure-npm:v1.7.0', expectation: 'healthy-control' };
  handler.validate(parameters);
  assert.throws(() => handler.validate({ ...parameters, expectation: 'reproduce-fault' }), /reported NPM release/);
  handler.validate({ ...parameters, npmImage: 'mcr.microsoft.com/containernetworking/azure-npm:v1.0.33', expectation: 'reproduce-fault' });
  assert.equal(listAksEndToEndAuthoring().find(entry => entry.candidate_id === 'AKS-C192')?.execution_eligible, false);
});

function hairpinContext(expectation: string, observedStatus: number, wrongImage = false) {
  const objects = new Map<string, any>();
  const evidence = new Map<string, any>();
  const phases: string[] = [];
  const nodeImageVersion = 'AKSUbuntu-2404gen2containerd-202609.03.1';
  const persistObject = (_name: string, resource: any) => {
    const object = structuredClone(resource);
    object.metadata.uid ??= `${object.metadata.name}-uid`;
    if (object.kind === 'Pod') object.status = {
      podIP: object.metadata.name === 'subject' ? '10.244.0.2' : '10.244.0.3',
      conditions: [{ type: 'Ready', status: 'True' }],
    };
    if (object.kind === 'Service') object.spec.clusterIP ??= '10.0.0.2';
    objects.set(`${object.kind.toLowerCase()}/${object.metadata.name}`, object);
  };
  const context = {
    namespace: 'owned', owner: 'owner', resourceGroup: 'owned-group', kubernetesVersion: '1.35.7',
    probeImage: `curl@sha256:${'b'.repeat(64)}`,
    parameters: { expectation, nodeImageVersion, serverImage: `nginx@sha256:${'a'.repeat(64)}` },
    az(args: string[]) {
      assert.deepEqual(args, ['aks', 'show', '--resource-group', 'owned-group', '--name', 'research']);
      return { networkProfile: { networkPlugin: 'kubenet' } };
    },
    create: persistObject, replace: persistObject,
    read(kind: string, name: string) {
      const object = objects.get(`${kind}/${name}`);
      assert.ok(object, `${kind}/${name} missing`);
      return structuredClone(object);
    },
    run(args: string[]) {
      if (args.includes('nodes')) return JSON.stringify({ items: [{
        metadata: { labels: { 'kubernetes.azure.com/node-image-version': wrongImage ? 'other-image' : nodeImageVersion } },
        status: { nodeInfo: { osImage: 'Ubuntu 24.04.3 LTS' } },
      }] });
      assert.ok(args.includes('endpointslices'));
      const selector = objects.get('service/hairpin').spec.selector.app;
      return JSON.stringify({ items: [{ endpoints: [{ targetRef: { uid: `${selector}-uid` }, conditions: { ready: true } }] }] });
    },
    kube(args: string[]) {
      assert.ok(args.includes('curl'));
      const caller = args[args.indexOf('exec') + 1];
      const destination = args.at(-1)!;
      const selfCall = caller === 'subject' && /http:\/\/(10\.0\.0\.2|hairpin\.)/.test(destination) &&
        objects.get('service/hairpin').spec.selector.app === 'subject';
      const status = selfCall ? observedStatus : 0;
      return { status, stdout: status === 0 ? '<h1>Welcome to nginx!</h1>' : '', stderr: status === 0 ? '' : 'synthetic test failure' };
    },
    save(name: string, value: unknown) { evidence.set(name, structuredClone(value)); },
    async poll(action: () => boolean, label: string) { assert.ok(action(), label); },
    async phase(name: string, action: () => Promise<unknown>) {
      phases.push(name); evidence.set(name, await action());
    },
  } as unknown as AksCaseContext;
  return { context, evidence, phases, objects };
}

test('C193 uses additive peers with namespace and pod selectors in the same clause', () => {
  const context = { namespace: 'owned', owner: 'owner' };
  const frontend = additiveAllowPolicy(context, 'frontend');
  const other = additiveAllowPolicy(context, 'test');
  assert.deepEqual(frontend.spec.podSelector.matchLabels, { app: 'webapp', role: 'backend' });
  assert.deepEqual(frontend.spec.ingress, [{ from: [{ namespaceSelector: {}, podSelector: { matchLabels: { app: 'webapp', role: 'frontend' } } }] }]);
  assert.deepEqual(other.spec.ingress, [{ from: [{ namespaceSelector: {}, podSelector: { matchLabels: { app: 'test' } } }] }]);
  assert.notEqual(frontend.metadata.name, other.metadata.name);
  assert.equal(listAksEndToEndAuthoring().find(entry => entry.candidate_id === 'AKS-C193')?.execution_eligible, false);
});

test('C186 canonicalizes the CIDR while keeping the exclusion in only one additive rule', () => {
  const context = { namespace: 'owned', owner: 'owner' };
  const excluded = cidrEgressPolicy(context, '10.224.2.31', true);
  const allowed = cidrEgressPolicy(context, '10.224.2.31', false);
  assert.deepEqual(excluded.spec.egress[1], { to: [{ ipBlock: { cidr: '10.224.2.0/24', except: ['10.224.2.31/32'] } }] });
  assert.deepEqual(allowed.spec.egress[1], { to: [{ ipBlock: { cidr: '10.224.2.0/24' } }] });
  assert.deepEqual(excluded.spec.podSelector, { matchLabels: { type: 'client' } });
  for (const address of ['invalid', '10.224.2.999', '2001:db8::1']) assert.throws(() => cidrEgressPolicy(context, address, true));
  assert.equal(listAksEndToEndAuthoring().find(entry => entry.candidate_id === 'AKS-C186')?.execution_eligible, false);
});

test('C194 distinguishes policy-referenced Job membership from unrelated or namespace-wide sets', () => {
  const snapshot = [
    'create azure-npm-job hash:ip family inet', 'add azure-npm-job 10.0.0.2',
    'create azure-npm-ns hash:net family inet', 'add azure-npm-ns 10.0.0.2', 'add azure-npm-ns 10.0.0.3',
    'create azure-npm-unused hash:ip family inet', 'add azure-npm-unused 10.0.0.2',
    'create azure-npm-list list:set', 'add azure-npm-list azure-npm-job',
  ].join('\n');
  const rules = '-A TEST -m set --match-set azure-npm-list src -j ACCEPT\n-A TEST -m set --match-set azure-npm-ns dst -j ACCEPT';
  assert.deepEqual(referencedPodSets(snapshot, rules, '10.0.0.2', '10.0.0.3'), ['azure-npm-job']);
  assert.equal(parseNpmSets(snapshot).get('azure-npm-job')?.members.has('10.0.0.2'), true);
  assert.deepEqual(referencedPodSets(snapshot.replace('add azure-npm-job 10.0.0.2', ''), rules, '10.0.0.2', '10.0.0.3'), []);
  assert.throws(() => parseNpmSets(''), /No readable/);
  assert.throws(() => parseNpmSets('add azure-npm-missing 10.0.0.2'), /preceding/);
  assert.throws(() => referencedPodSets(snapshot, '--match-set azure-npm-missing src', '10.0.0.2', '10.0.0.3'), /absent/);
});

test('C159 exercises independent baseline, declared outcome and non-self recovery in both modes', async () => {
  const handler = aksExpansionEndToEndCases['aks-c159-v1'];
  assert.ok(handler);
  for (const expectation of ['healthy-control', 'reproduce-fault']) {
    const fixture = hairpinContext(expectation, expectation === 'healthy-control' ? 0 : 28);
    await handler.run(fixture.context);
    assert.deepEqual(fixture.phases, ['baseline', 'fault', 'recovery']);
    assert.equal(fixture.evidence.get('fault').faultObserved, expectation === 'reproduce-fault');
    assert.equal(fixture.evidence.get('recovery').kind, 'non-self-backend-control-not-a-kernel-fix');
    assert.equal(fixture.objects.get('service/hairpin').spec.selector.app, 'alternate');
    assert.equal([...fixture.evidence.keys()].filter(name => name.startsWith('probe-')).length, 20);
  }
});

test('C159 stops on image substitution or inconclusive traffic instead of reporting success', async () => {
  const handler = aksExpansionEndToEndCases['aks-c159-v1'];
  assert.ok(handler);
  const substituted = hairpinContext('healthy-control', 0, true);
  await assert.rejects(handler.run(substituted.context));
  assert.deepEqual(substituted.phases, []);
  const inconclusive = hairpinContext('reproduce-fault', 6);
  await assert.rejects(handler.run(inconclusive.context), /not a hairpin reproduction/);
  assert.deepEqual(inconclusive.phases, ['baseline', 'fault']);
  assert.ok(!inconclusive.evidence.has('recovery'));
});

test('C192 lifecycle proves enforcement controls before accepting named-port outcomes', async () => {
  const handler = aksExpansionEndToEndCases['aks-c192-v1'];
  assert.ok(handler);
  for (const expectation of ['healthy-control', 'reproduce-fault']) {
    const fixture = hairpinContext(expectation, 0);
    const context = fixture.context;
    context.parameters.npmImage = 'mcr.microsoft.com/containernetworking/azure-npm:v1.0.33';
    const policyTransitions: Array<string | number | null> = [];
    const originalCreate = context.create;
    context.create = (name, resource: any) => {
      originalCreate(name, resource);
      if (resource.kind === 'NetworkPolicy') policyTransitions.push(resource.spec.ingress[0]?.ports[0]?.port ?? null);
    };
    context.replace = context.create;
    const originalRun = context.run;
    context.run = args => {
      if (args.includes('nodes')) return originalRun(args);
      if (args.includes('daemonset')) return JSON.stringify({ metadata: { uid: 'npm-uid' },
        spec: { template: { spec: { containers: [{ image: context.parameters.npmImage }] } } },
        status: { numberReady: 1, desiredNumberScheduled: 1 } });
      if (args.includes('pods')) return JSON.stringify({ items: [{ metadata: { ownerReferences: [{ uid: 'npm-uid' }] } }] });
      if (args.includes('endpointslices')) return JSON.stringify({ items: [{ endpoints: [{ targetRef: { uid: 'subject-uid' }, conditions: { ready: true } }] }] });
      if (args.includes('networkpolicies')) return JSON.stringify({ items: [...fixture.objects.values()].filter(object => object.kind === 'NetworkPolicy') });
      assert.ok(args.includes('delete') && args.includes('networkpolicy'));
      fixture.objects.delete('networkpolicy/named-port'); return '';
    };
    context.az = args => {
      assert.deepEqual(args, ['aks', 'show', '--resource-group', 'owned-group', '--name', 'research']);
      return { networkProfile: { networkPlugin: 'azure', networkPolicy: 'azure' } };
    };
    context.kube = args => {
      const caller = args[args.indexOf('exec') + 1];
      const target = new URL(args.at(-1)!);
      const policy = fixture.objects.get('networkpolicy/named-port');
      const port = policy?.spec.ingress[0]?.ports[0]?.port;
      const allowed = caller === 'subject' || !policy ||
        (port === 80 && (target.port === '' || target.port === '80')) ||
        (port === 'serve-80' && (expectation === 'reproduce-fault' || target.port === '' || target.port === '80'));
      return { status: allowed ? 0 : 28, stdout: allowed ? '<h1>Welcome to nginx!</h1>' : '', stderr: allowed ? '' : 'synthetic timeout' };
    };
    await handler.run(context);
    assert.deepEqual(fixture.phases, ['baseline', 'fault', 'recovery']);
    assert.deepEqual(policyTransitions, [null, 80, 'serve-80', 80]);
    assert.equal(fixture.evidence.get('baseline').denied.restricted, 'timeout');
    assert.equal(fixture.evidence.get('baseline').numeric.allowed, 'healthy');
    assert.equal(fixture.evidence.get('baseline').numeric.restricted, 'timeout');
    assert.equal(fixture.evidence.get('fault').faultObserved, expectation === 'reproduce-fault');
    assert.equal(fixture.evidence.get('recovery').restored.restricted, 'healthy');
    assert.ok(!fixture.objects.has('networkpolicy/named-port'));
  }
});

function npmPolicyContext(expectation: string, staleCompletion = false) {
  const fixture = hairpinContext(expectation, 0);
  const context = fixture.context;
  const objects = new Map<string, any>();
  const phases = fixture.phases;
  let nextIp = 10;
  const key = (namespace: string, kind: string, name: string) => `${namespace}/${kind.toLowerCase()}/${name}`;
  const get = (namespace: string, kind: string, name: string) => {
    const object = objects.get(key(namespace, kind, name));
    assert.ok(object, `${kind}/${name} absent in ${namespace}`);
    return structuredClone(object);
  };
  const create = (_name: string, value: any) => {
    const resource = structuredClone(value);
    resource.metadata.uid ??= `${resource.metadata.namespace}-${resource.metadata.name}-uid`;
    if (resource.kind === 'Pod') resource.status = { phase: 'Running', podIP: `10.224.0.${nextIp++}`,
      conditions: [{ type: 'Ready', status: 'True' }] };
    if (resource.kind === 'Service') resource.spec.clusterIP = '10.0.0.2';
    objects.set(key(resource.metadata.namespace ?? '', resource.kind, resource.metadata.name), resource);
    if (resource.kind === 'Job') create('job-pod', {
      apiVersion: 'v1', kind: 'Pod', metadata: { name: 'membership-job-pod', namespace: resource.metadata.namespace,
        labels: { ...resource.spec.template.metadata.labels, 'job-name': resource.metadata.name },
        ownerReferences: [{ uid: resource.metadata.uid }] }, spec: resource.spec.template.spec,
    });
  };
  context.create = create; context.replace = create;
  context.read = (kind, name) => get(context.namespace, kind, name);
  context.wait = async () => {};
  context.kubernetesVersion = '1.16.7';
  context.parameters.npmImage = 'mcr.microsoft.com/containernetworking/azure-npm:v1.0.28';
  const npmPod = { metadata: { name: 'npm-pod', uid: 'npm-uid-pod', ownerReferences: [{ uid: 'npm-uid' }] },
    spec: { containers: [{ name: 'npm', image: context.parameters.npmImage }] },
    status: { containerStatuses: [{ name: 'npm', restartCount: 0, imageID: 'npm-image' }] } };
  const namespaceFor = (args: string[]) => args.includes('--namespace') ? args[args.indexOf('--namespace') + 1]! : context.namespace;
  const membership = () => {
    const pod = objects.get(key(context.namespace, 'pod', 'membership-job-pod'));
    const control = objects.get(key(context.namespace, 'pod', 'control'));
    const retained = pod && (pod.status.phase === 'Running' || expectation === 'reproduce-fault' || staleCompletion);
    return ['create azure-npm-job hash:ip family inet', ...(retained ? [`add azure-npm-job ${pod.status.podIP}`] : []),
      'create azure-npm-namespace hash:net family inet', ...(pod ? [`add azure-npm-namespace ${pod.status.podIP}`] : []),
      ...(control ? [`add azure-npm-namespace ${control.status.podIP}`] : [])].join('\n');
  };
  const originalRun = context.run;
  context.run = args => {
    if (args.includes('nodes')) return originalRun(args);
    if (args.includes('daemonset')) return JSON.stringify({ metadata: { uid: 'npm-uid' },
      spec: { template: { spec: { containers: npmPod.spec.containers } } }, status: { numberReady: 1, desiredNumberScheduled: 1 } });
    if (args[0] === '-n' && args[1] === 'kube-system') {
      if (args.includes('pods')) return JSON.stringify({ items: [npmPod] });
      if (args.includes('get')) return JSON.stringify(npmPod);
      if (args.includes('ipset')) return membership();
      assert.ok(args.includes('iptables-save')); return '-A TEST --match-set azure-npm-job src -j ACCEPT';
    }
    const namespace = namespaceFor(args);
    if (args.includes('get')) {
      const kind = args[args.indexOf('get') + 1]!;
      if (kind === 'pods') return JSON.stringify({ items: [...objects.values()].filter(object => object.kind === 'Pod' &&
        object.metadata.namespace === namespace && object.metadata.labels['job-name'] === 'membership-job') });
      if (kind === 'endpointslices') return JSON.stringify({ items: [{ endpoints: [{ targetRef: { uid: get(namespace, 'pod', 'subject').metadata.uid }, conditions: { ready: true } }] }] });
      return JSON.stringify(get(namespace, kind, args[args.indexOf('get') + 2]!));
    }
    if (args.includes('delete')) {
      const kind = args[args.indexOf('delete') + 1]!;
      const name = args[args.indexOf('delete') + 2]!;
      objects.delete(key(namespace, kind, name));
      if (kind === 'job') objects.delete(key(namespace, 'pod', 'membership-job-pod'));
      return '';
    }
    assert.ok(args.includes('exec') && args.includes('printf "done\\n" > /tmp/finish'));
    objects.get(key(namespace, 'pod', 'membership-job-pod')).status.phase = 'Succeeded';
    return '';
  };
  context.az = () => ({ networkProfile: { networkPlugin: 'azure', networkPolicy: 'azure' } });
  const matches = (labels: Record<string, string>, wanted: Record<string, string>) => Object.entries(wanted).every(([name, value]) => labels[name] === value);
  context.kube = args => {
    assert.ok(args.includes('curl'));
    const namespace = namespaceFor(args);
    const caller = get(namespace, 'pod', args[args.indexOf('exec') + 1]!);
    const target = new URL(args.at(-1)!);
    const subject = [...objects.values()].find(object => object.kind === 'Pod' && object.metadata.namespace === namespace &&
      object.status?.podIP === target.hostname) ?? get(namespace, 'pod', 'subject');
    let allowed = true;
    const policies = [...objects.values()].filter(object => object.kind === 'NetworkPolicy' && object.metadata.namespace === namespace);
    const ingress = policies.filter(policy => policy.spec.policyTypes.includes('Ingress') && matches(subject.metadata.labels, policy.spec.podSelector.matchLabels));
    const egress = policies.filter(policy => policy.spec.policyTypes.includes('Egress') && matches(caller.metadata.labels, policy.spec.podSelector.matchLabels));
    if (target.hostname !== '127.0.0.1' && ingress.length) {
      allowed = ingress.some(policy => policy.spec.ingress.some((rule: any) => rule.from.some((peer: any) => matches(caller.metadata.labels, peer.podSelector.matchLabels))));
      if (ingress.length === 2 && expectation === 'reproduce-fault') allowed = false;
    }
    if (egress.length) {
      allowed = egress.some(policy => policy.metadata.name === 'allow-range');
      if (egress.length === 2 && expectation === 'reproduce-fault') allowed = false;
    }
    return { status: allowed ? 0 : 28, stdout: allowed ? '<h1>Welcome to nginx!</h1>' : '', stderr: allowed ? '' : 'synthetic timeout' };
  };
  return { context, phases, evidence: fixture.evidence, objects };
}

test('C186 proves exclusion, overlap, independent controls and removal in both modes', async () => {
  const handler = aksExpansionEndToEndCases['aks-c186-v1']; assert.ok(handler);
  for (const expectation of ['healthy-control', 'reproduce-fault']) {
    const fixture = npmPolicyContext(expectation);
    await handler.run(fixture.context);
    assert.deepEqual(fixture.phases, ['baseline', 'fault', 'recovery']);
    assert.equal(fixture.evidence.get('baseline').excluded.direct, 'timeout');
    assert.equal(fixture.evidence.get('fault').faultObserved, expectation === 'reproduce-fault');
    assert.equal(fixture.evidence.get('recovery').allowOnly.direct, 'healthy');
    assert.ok(![...fixture.objects.values()].some(object => object.kind === 'NetworkPolicy'));
  }
});

test('C193 validates both policy orders without restarting the enforcement agent', async () => {
  const handler = aksExpansionEndToEndCases['aks-c193-v1']; assert.ok(handler);
  const fixture = npmPolicyContext('healthy-control');
  await handler.run(fixture.context);
  assert.deepEqual(fixture.phases, ['baseline', 'fault', 'recovery']);
  assert.deepEqual(fixture.evidence.get('fault').trials.map((trial: any) => trial.order), [['frontend', 'test'], ['test', 'frontend']]);
  assert.equal(fixture.evidence.get('fault').faultObserved, false);
  assert.ok(fixture.evidence.get('fault').trials.every((trial: any) => trial.samples.every((sample: any) => sample.backendEgress === 'healthy' && sample.sinkControl === 'healthy')));
  assert.equal(fixture.evidence.get('recovery').kind, 'owned-policy-removal-no-npm-restart');
  assert.ok(![...fixture.objects.values()].some(object => object.kind === 'NetworkPolicy'));
});

test('C194 retains the completed Pod for observations and removes only owned Job and policy', async () => {
  const handler = aksExpansionEndToEndCases['aks-c194-v1']; assert.ok(handler);
  for (const expectation of ['healthy-control', 'reproduce-fault']) {
    const fixture = npmPolicyContext(expectation);
    await handler.run(fixture.context);
    assert.deepEqual(fixture.phases, ['baseline', 'fault', 'recovery']);
    assert.deepEqual(fixture.evidence.get('baseline').trackedSets, ['azure-npm-job']);
    assert.equal(fixture.evidence.get('fault').completedPodRetained, true);
    assert.equal(fixture.evidence.get('fault').faultObserved, expectation === 'reproduce-fault');
    assert.equal(fixture.evidence.get('recovery').forcedIpReuse, false);
    assert.ok(![...fixture.objects.values()].some(object => object.kind === 'Job'));
  }
  const stale = npmPolicyContext('healthy-control', true);
  await assert.rejects(handler.run(stale.context), /Completed Job leaves referenced sets/);
  assert.deepEqual(stale.phases, ['baseline', 'fault']);
});

test('NPM preflight records version mismatch and stops before any workload or phase', async () => {
  const handler = aksExpansionEndToEndCases['aks-c186-v1']; assert.ok(handler);
  const fixture = npmPolicyContext('healthy-control');
  const originalRun = fixture.context.run;
  fixture.context.run = args => {
    const output = originalRun(args);
    if (!args.includes('daemonset')) return output;
    const npm = JSON.parse(output);
    npm.spec.template.spec.containers[0].image = 'mcr.microsoft.com/containernetworking/azure-npm:v1.6.48-0';
    return JSON.stringify(npm);
  };
  await assert.rejects(handler.run(fixture.context), /differs from the declared pin/);
  assert.deepEqual(fixture.phases, []);
  assert.equal(fixture.objects.size, 0);
  assert.deepEqual(fixture.evidence.get('npm-image-preflight').actualImages, ['mcr.microsoft.com/containernetworking/azure-npm:v1.6.48-0']);
});

test('policy collection errors cannot become healthy controls or successful reproductions', async () => {
  for (const id of ['aks-c186-v1', 'aks-c193-v1', 'aks-c194-v1']) {
    const handler = aksExpansionEndToEndCases[id]; assert.ok(handler);
    const fixture = npmPolicyContext('healthy-control');
    fixture.context.kube = () => ({ status: 127, stdout: '', stderr: 'curl missing' });
    await assert.rejects(handler.run(fixture.context), /not evidence of policy enforcement/);
    assert.deepEqual(fixture.phases, ['baseline']);
  }
});