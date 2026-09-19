import assert from 'node:assert/strict';
import { isIPv4 } from 'node:net';
import type { CommandResult } from '../cluster/commandRunner.js';
import {
  metadata, namespaced, probePod, readyPod, requiredParameter,
  type AksCaseContext, type AksEndToEndCase,
} from './aksEndToEndCases.js';

export function hairpinProbeOutcome(result: CommandResult) {
  if (result.status === 0 && /<h1>Welcome to nginx!<\/h1>/i.test(result.stdout)) return 'healthy';
  if (result.status === 28) return 'timeout';
  return 'inconclusive';
}

export function assertHairpinExpectation(results: CommandResult[], expectation: string) {
  assert.ok(['reproduce-fault', 'healthy-control'].includes(expectation));
  assert.equal(results.length, 6, 'Three paired Service-IP and DNS probes are required');
  const outcomes = results.map(hairpinProbeOutcome);
  assert.ok(!outcomes.includes('inconclusive'), 'Probe error or unexpected response: not a hairpin reproduction');
  const expected = expectation === 'reproduce-fault' ? 'timeout' : 'healthy';
  assert.ok(outcomes.every(outcome => outcome === expected),
    expectation === 'reproduce-fault' ? 'Historical hairpin fault not reproduced' : 'Healthy-image hairpin control failed');
  return { expectation, outcomes, faultObserved: expected === 'timeout', qualified: false };
}

function serverPod(context: AksCaseContext, name: string) {
  const pod: any = probePod(context, name);
  pod.metadata.labels.app = name;
  pod.spec.nodeSelector = { 'kubernetes.io/os': 'linux' };
  pod.spec.containers.push({
    name: 'server', image: context.parameters.serverImage,
    ports: [{ name: 'http', containerPort: 80 }],
    readinessProbe: { httpGet: { path: '/', port: 'http' }, initialDelaySeconds: 1, periodSeconds: 2 },
    resources: { requests: { cpu: '10m', memory: '32Mi' }, limits: { cpu: '100m', memory: '96Mi' } },
  });
  return pod;
}

async function serviceBackend(context: AksCaseContext, uid: string, service = 'hairpin') {
  await context.poll(() => {
    const slices = JSON.parse(context.run(namespaced(context, [
      'get', 'endpointslices', '-l', `kubernetes.io/service-name=${service}`, '-o', 'json',
    ])));
    const endpoints = slices.items.flatMap((slice: any) => slice.endpoints ?? []);
    context.save('service-endpoints', slices);
    return endpoints.length === 1 && endpoints[0].targetRef?.uid === uid && endpoints[0].conditions?.ready === true;
  }, 'Service selects exactly the intended ready backend');
}

const kubenetHairpin: AksEndToEndCase = {
  networkPlugin: 'kubenet',
  validate(parameters) {
    requiredParameter(parameters, 'serverImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
    requiredParameter(parameters, 'nodeImageVersion', /^AKSUbuntu-2404[a-zA-Z0-9._-]+$/);
    requiredParameter(parameters, 'expectation', /^(reproduce-fault|healthy-control)$/);
  },
  async run(context) {
    const expectation = requiredParameter(context.parameters, 'expectation', /^(reproduce-fault|healthy-control)$/);
    assert.match(context.kubernetesVersion, /^1\.35\.\d+$/, 'C159 source configuration requires AKS 1.35');
    const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
    assert.equal(cluster.networkProfile?.networkPlugin, 'kubenet');
    const nodes = JSON.parse(context.run(['get', 'nodes', '-o', 'json']));
    assert.equal(nodes.items.length, 1, 'This bounded case requires exactly one owned node');
    const node = nodes.items[0];
    assert.equal(node.metadata?.labels?.['kubernetes.azure.com/node-image-version'], context.parameters.nodeImageVersion);
    assert.match(node.status?.nodeInfo?.osImage ?? '', /Ubuntu 24\.04/);
    context.save('hairpin-environment', { node, network: cluster.networkProfile, parameters: context.parameters });
    const serviceName = `hairpin.${context.namespace}.svc.cluster.local`;
    let serviceIp = '';
    let subjectIp = '';
    let sequence = 0;
    const probe = (pod: string, address: string) => {
      const result = context.kube(namespaced(context, ['exec', pod, '-c', 'probe', '--',
        'curl', '--silent', '--show-error', '--fail', '--connect-timeout', '3', '--max-time', '5', '--noproxy', '*', `http://${address}/`]));
      context.save(`probe-${++sequence}`, { pod, address, at: new Date().toISOString(), result, outcome: hairpinProbeOutcome(result) });
      return result;
    };
    const healthy = (pod: string, address: string) => {
      const result = probe(pod, address);
      assert.equal(hairpinProbeOutcome(result), 'healthy', `${pod} to ${address} control failed`);
      return result;
    };
    await context.phase('baseline', async () => {
      context.create('hairpin-subject', serverPod(context, 'subject'));
      context.create('hairpin-client', probePod(context, 'client'));
      context.create('hairpin-service', {
        apiVersion: 'v1', kind: 'Service', metadata: metadata(context, 'hairpin'),
        spec: { selector: { app: 'subject' }, ports: [{ port: 80, targetPort: 80, protocol: 'TCP' }] },
      });
      const subject = await readyPod(context, 'subject');
      await readyPod(context, 'client');
      await serviceBackend(context, subject.metadata.uid);
      subjectIp = subject.status.podIP;
      serviceIp = context.read('service', 'hairpin').spec.clusterIP;
      assert.match(subjectIp, /^\d+\.\d+\.\d+\.\d+$/);
      assert.match(serviceIp, /^\d+\.\d+\.\d+\.\d+$/);
      return {
        subject, serviceIp,
        controls: [healthy('subject', '127.0.0.1'), healthy('subject', subjectIp),
          healthy('client', serviceIp), healthy('client', serviceName)],
      };
    });
    await context.phase('fault', async () => {
      const results = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        healthy('subject', '127.0.0.1');
        healthy('client', serviceIp);
        results.push(probe('subject', serviceIp), probe('subject', serviceName));
      }
      context.save('hairpin-observations', { results, expectation });
      return assertHairpinExpectation(results, expectation);
    });
    await context.phase('recovery', async () => {
      context.create('hairpin-alternate', serverPod(context, 'alternate'));
      const alternate = await readyPod(context, 'alternate');
      const service = context.read('service', 'hairpin');
      assert.equal(service.metadata.labels['headlamp-e2e-owner'], context.owner);
      service.spec.selector = { app: 'alternate' };
      context.replace('hairpin-service-recovery', service);
      await serviceBackend(context, alternate.metadata.uid);
      return {
        kind: 'non-self-backend-control-not-a-kernel-fix', alternate,
        controls: [healthy('subject', serviceIp), healthy('subject', serviceName),
          healthy('subject', subjectIp), healthy('client', serviceIp)],
      };
    });
  },
};

export function namedPortPolicy(context: Pick<AksCaseContext, 'namespace' | 'owner'>, port: string | number | null) {
  return {
    apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy',
    metadata: { name: 'named-port', namespace: context.namespace, labels: { 'headlamp-e2e-owner': context.owner } },
    spec: { podSelector: { matchLabels: { app: 'subject' } }, policyTypes: ['Ingress'],
      ingress: port === null ? [] : [{ ports: [{ protocol: 'TCP', port }] }],
    },
  };
}

function validateNpmParameters(parameters: Record<string, string>) {
    requiredParameter(parameters, 'serverImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
    requiredParameter(parameters, 'nodeImageVersion', /^AKSUbuntu-[a-zA-Z0-9._-]+$/);
    requiredParameter(parameters, 'npmImage', /^[a-zA-Z0-9./_-]+(?::[a-zA-Z0-9._-]+|@sha256:[a-f0-9]{64})$/);
    requiredParameter(parameters, 'expectation', /^(reproduce-fault|healthy-control)$/);
}

function npmEnvironment(context: AksCaseContext) {
  const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
  assert.equal(cluster.networkProfile?.networkPlugin, 'azure');
  assert.equal(cluster.networkProfile?.networkPolicy, 'azure');
  const nodes = JSON.parse(context.run(['get', 'nodes', '-o', 'json']));
  assert.equal(nodes.items.length, 1);
  assert.equal(nodes.items[0].metadata.labels['kubernetes.azure.com/node-image-version'], context.parameters.nodeImageVersion);
  const npm = JSON.parse(context.run(['-n', 'kube-system', 'get', 'daemonset', 'azure-npm', '-o', 'json']));
  const actualImages = npm.spec.template.spec.containers.map((container: any) => container.image);
  context.save('npm-image-preflight', { expected: context.parameters.npmImage, actualImages, daemonSet: npm });
  assert.ok(actualImages.includes(context.parameters.npmImage), 'Managed NPM image differs from the declared pin; workload not started');
  assert.equal(npm.status?.numberReady, 1);
  assert.equal(npm.status?.desiredNumberScheduled, 1);
  const systemPods = JSON.parse(context.run(['-n', 'kube-system', 'get', 'pods', '-o', 'json']));
  const evidence = { node: nodes.items[0], network: cluster.networkProfile, daemonSet: npm,
    pods: systemPods.items.filter((pod: any) => pod.metadata.ownerReferences?.some((owner: any) => owner.uid === npm.metadata.uid)) };
  context.save('npm-environment', evidence);
  return evidence;
}

const namedPortCompatibility: AksEndToEndCase = {
  nodeSubnetNetworking: true, networkPolicy: 'azure',
  validate(parameters) {
    validateNpmParameters(parameters);
    if (parameters.expectation === 'reproduce-fault') assert.match(parameters.npmImage!, /:v1\.0\.33$/, 'Historical mode requires the reported NPM release');
  },
  async run(context) {
    const expectation = requiredParameter(context.parameters, 'expectation', /^(reproduce-fault|healthy-control)$/);
    npmEnvironment(context);
    const policies = () => JSON.parse(context.run(namespaced(context, ['get', 'networkpolicies', '-o', 'json']))).items;
    assert.equal(policies().length, 0, 'Unexpected preexisting namespace policies');
    let address = '';
    let sequence = 0;
    const probe = (pod: string, target: string, port: number) => {
      const result = context.kube(namespaced(context, ['exec', pod, '-c', 'probe', '--', 'curl',
        '--silent', '--show-error', '--fail', '--connect-timeout', '3', '--max-time', '5', '--noproxy', '*', `http://${target}:${port}/`]));
      context.save(`named-port-probe-${++sequence}`, { pod, target, port, result, outcome: hairpinProbeOutcome(result) });
      return hairpinProbeOutcome(result);
    };
    const matrix = () => ({ allowed: probe('client', address, 80), restricted: probe('client', address, 81),
      server80: probe('subject', '127.0.0.1', 80), server81: probe('subject', '127.0.0.1', 81) });
    const converged = async (allowed: string, restricted: string) => {
      let observations: ReturnType<typeof matrix>;
      await context.poll(() => {
        observations = matrix();
        return observations.allowed === allowed && observations.restricted === restricted &&
          observations.server80 === 'healthy' && observations.server81 === 'healthy';
      }, 'Policy traffic matrix');
      return observations!;
    };
    const changePort = (port: number | string) => {
      const current = context.read('networkpolicy', 'named-port');
      assert.equal(current.metadata.labels['headlamp-e2e-owner'], context.owner);
      assert.equal(policies().length, 1);
      const desired = namedPortPolicy(context, port);
      current.spec = desired.spec;
      context.replace('named-port-policy', current);
    };
    await context.phase('baseline', async () => {
      context.create('dual-port-config', { apiVersion: 'v1', kind: 'ConfigMap', metadata: metadata(context, 'dual-port'),
        data: { 'default.conf': 'server { listen 80; listen 81; location / { root /usr/share/nginx/html; index index.html; } }\n' } });
      const subject: any = serverPod(context, 'subject');
      subject.spec.containers[1].ports = [{ name: 'serve-80', containerPort: 80 }, { name: 'serve-81', containerPort: 81 }];
      subject.spec.containers[1].readinessProbe.httpGet.port = 80;
      subject.spec.volumes = [{ name: 'config', configMap: { name: 'dual-port' } }];
      subject.spec.containers[1].volumeMounts = [{ name: 'config', mountPath: '/etc/nginx/conf.d', readOnly: true }];
      context.create('named-port-subject', subject);
      context.create('named-port-client', probePod(context, 'client'));
      context.create('named-port-service', { apiVersion: 'v1', kind: 'Service', metadata: metadata(context, 'dual-port'),
        spec: { selector: { app: 'subject' }, ports: [80, 81].map(port => ({ name: `serve-${port}`, port, targetPort: port })) } });
      const ready = await readyPod(context, 'subject');
      await readyPod(context, 'client');
      await serviceBackend(context, ready.metadata.uid, 'dual-port');
      address = context.read('service', 'dual-port').spec.clusterIP;
      const open = await converged('healthy', 'healthy');
      context.create('named-port-policy', namedPortPolicy(context, null));
      const denied = await converged('timeout', 'timeout');
      changePort(80);
      const numeric = await converged('healthy', 'timeout');
      return { open, denied, numeric };
    });
    await context.phase('fault', async () => {
      changePort('serve-80');
      const restricted = expectation === 'reproduce-fault' ? 'healthy' : 'timeout';
      const initial = await converged('healthy', restricted);
      const repeated = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const observed = matrix();
        repeated.push(observed);
        assert.deepEqual(observed, initial, 'Named-port enforcement is unstable');
      }
      return { expectation, faultObserved: expectation === 'reproduce-fault', initial, repeated };
    });
    await context.phase('recovery', async () => {
      changePort(80);
      const numeric = await converged('healthy', 'timeout');
      context.run(namespaced(context, ['delete', 'networkpolicy', 'named-port', '--wait=true', '--timeout=30s']));
      assert.equal(policies().length, 0);
      return { kind: 'numeric-port-control-and-owned-policy-removal', numeric, restored: await converged('healthy', 'healthy') };
    });
  },
};

export function additiveAllowPolicy(context: Pick<AksCaseContext, 'namespace' | 'owner'>, peer: 'frontend' | 'test') {
  return {
    apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy',
    metadata: { name: `allow-${peer}`, namespace: context.namespace, labels: { 'headlamp-e2e-owner': context.owner } },
    spec: { podSelector: { matchLabels: { app: 'webapp', role: 'backend' } }, policyTypes: ['Ingress'],
      ingress: [{ from: [{ namespaceSelector: {}, podSelector: {
        matchLabels: peer === 'frontend' ? { app: 'webapp', role: 'frontend' } : { app: 'test' },
      } }] }],
    },
  };
}

function ownedNamespace(context: AksCaseContext, suffix: string): AksCaseContext {
  const namespace = `${context.namespace}-${suffix}`;
  context.create(`${suffix}-namespace`, { apiVersion: 'v1', kind: 'Namespace', metadata: {
    name: namespace, labels: { 'headlamp-e2e-owner': context.owner },
  } });
  return { ...context, namespace,
    create: (name, resource) => context.create(`${suffix}-${name}`, resource),
    replace: (name, resource) => context.replace(`${suffix}-${name}`, resource),
    save: (name, evidence) => context.save(`${suffix}-${name}`, evidence),
    read: (kind, name) => JSON.parse(context.run(['--namespace', namespace, 'get', kind, name, '-o', 'json'])),
  };
}

function httpEvidence(context: AksCaseContext) {
  let sequence = 0;
  return (pod: string, address: string, port = 80) => {
    const result = context.kube(namespaced(context, ['exec', pod, '-c', 'probe', '--', 'curl',
      '--silent', '--show-error', '--fail', '--connect-timeout', '3', '--max-time', '5', '--noproxy', '*', `http://${address}:${port}/`]));
    const outcome = hairpinProbeOutcome(result);
    context.save(`http-${++sequence}`, { at: new Date().toISOString(), pod, address, port, result, outcome });
    assert.notEqual(outcome, 'inconclusive', 'Probe failure is not evidence of policy enforcement');
    return outcome;
  };
}

async function removeOwnedPolicy(context: AksCaseContext, name: string) {
  const policy = context.read('networkpolicy', name);
  assert.equal(policy.metadata.labels?.['headlamp-e2e-owner'], context.owner);
  context.run(namespaced(context, ['delete', 'networkpolicy', name, '--wait=true', '--timeout=30s']));
}

const additivePolicyCompatibility: AksEndToEndCase = {
  nodeSubnetNetworking: true, networkPolicy: 'azure',
  validate(parameters) { validateNpmParameters(parameters); },
  async run(context) {
    const expectation = requiredParameter(context.parameters, 'expectation', /^(reproduce-fault|healthy-control)$/);
    if (expectation === 'reproduce-fault') assert.equal(context.kubernetesVersion, '1.16.7', 'Historical C193 requires the reported Kubernetes version');
    const environment = npmEnvironment(context);
    const trials: Array<{ context: AksCaseContext; order: Array<'frontend' | 'test'>; probe: ReturnType<typeof httpEvidence>; address: string; sink: string }> = [];
    const matrix = (trial: typeof trials[number]) => ({
      frontend: trial.probe('frontend', trial.address), test: trial.probe('test', trial.address),
      outsider: trial.probe('outsider', trial.address), local: trial.probe('subject', '127.0.0.1'),
      backendEgress: trial.probe('subject', trial.sink), sinkControl: trial.probe('outsider', trial.sink),
    });
    const expectMatrix = async (trial: typeof trials[number], frontend: string, test: string, outsider: string, backendEgress = 'healthy') => {
      const expected = { frontend, test, outsider, local: 'healthy', backendEgress, sinkControl: 'healthy' };
      let observed: ReturnType<typeof matrix>;
      await context.poll(() => {
        observed = matrix(trial);
        return Object.entries(expected).every(([key, value]) => observed[key as keyof typeof observed] === value);
      }, 'Additive policy traffic matrix');
      return observed!;
    };
    await context.phase('baseline', async () => {
      const evidence = [];
      for (const order of [['frontend', 'test'], ['test', 'frontend']] as const) {
        const scoped = ownedNamespace(context, `${order[0]}-first`);
        const subject: any = serverPod(scoped, 'subject');
        subject.metadata.labels = { ...subject.metadata.labels, app: 'webapp', role: 'backend' };
        scoped.create('subject', subject);
        scoped.create('sink', serverPod(scoped, 'sink'));
        for (const name of ['frontend', 'test', 'outsider']) {
          const client: any = probePod(scoped, name);
          client.metadata.labels = { ...client.metadata.labels, ...(name === 'frontend'
            ? { app: 'webapp', role: 'frontend' } : { app: name }) };
          scoped.create(name, client);
          await readyPod(scoped, name);
        }
        const ready = await readyPod(scoped, 'subject');
        const sink = await readyPod(scoped, 'sink');
        const trial = { context: scoped, order: [...order], probe: httpEvidence(scoped), address: ready.status.podIP, sink: sink.status.podIP };
        trials.push(trial);
        const open = await expectMatrix(trial, 'healthy', 'healthy', 'healthy');
        scoped.create(`allow-${order[0]}`, additiveAllowPolicy(scoped, order[0]));
        const isolated = await expectMatrix(trial, order[0] === 'frontend' ? 'healthy' : 'timeout', order[0] === 'test' ? 'healthy' : 'timeout', 'timeout');
        evidence.push({ order, open, isolated });
      }
      return { environment, trials: evidence };
    });
    await context.phase('fault', async () => {
      const evidence = [];
      for (const trial of trials) {
        const second = trial.order[1]!;
        trial.context.create(`allow-${second}`, additiveAllowPolicy(trial.context, second));
        const expected = expectation === 'healthy-control' ? 'healthy' : 'timeout';
        const converged = await expectMatrix(trial, expected, expected, 'timeout', expected);
        const samples = [];
        for (let attempt = 0; attempt < 3; attempt++) {
          const observed = matrix(trial); samples.push(observed);
          assert.deepEqual(observed, converged, 'Additive policy behavior did not remain stable');
        }
        evidence.push({ order: trial.order, samples });
      }
      return { expectation, faultObserved: expectation === 'reproduce-fault', trials: evidence };
    });
    await context.phase('recovery', async () => {
      const evidence = [];
      for (const trial of trials) {
        for (const peer of trial.order) await removeOwnedPolicy(trial.context, `allow-${peer}`);
        evidence.push({ order: trial.order, restored: await expectMatrix(trial, 'healthy', 'healthy', 'healthy') });
      }
      return { kind: 'owned-policy-removal-no-npm-restart', trials: evidence };
    });
  },
};

export function cidrEgressPolicy(context: Pick<AksCaseContext, 'namespace' | 'owner'>, address: string, exclusion: boolean) {
  assert.ok(isIPv4(address), 'C186 requires a real IPv4 backend');
  const cidr = `${address.split('.').slice(0, 3).join('.')}.0/24`;
  return {
    apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy',
    metadata: { name: exclusion ? 'exclude-backend' : 'allow-range', namespace: context.namespace,
      labels: { 'headlamp-e2e-owner': context.owner } },
    spec: { podSelector: { matchLabels: { type: 'client' } }, policyTypes: ['Egress'],
      egress: [{ ports: [{ protocol: 'UDP', port: 53 }] },
        { to: [{ ipBlock: { cidr, ...(exclusion ? { except: [`${address}/32`] } : {}) } }] }],
    },
  };
}

const overlappingCidrCompatibility: AksEndToEndCase = {
  nodeSubnetNetworking: true, networkPolicy: 'azure',
  validate(parameters) {
    validateNpmParameters(parameters);
    if (parameters.expectation === 'reproduce-fault') assert.match(parameters.npmImage!, /:v1\.1\.0$/, 'C186 requires the reported NPM release');
  },
  async run(context) {
    const expectation = requiredParameter(context.parameters, 'expectation', /^(reproduce-fault|healthy-control)$/);
    const environment = npmEnvironment(context);
    const probe = httpEvidence(context);
    let podIp = '';
    let serviceIp = '';
    const matrix = () => ({ direct: probe('client', podIp), service: probe('client', serviceIp),
      unaffected: probe('control', podIp), local: probe('subject', '127.0.0.1') });
    const expectTraffic = async (outcome: string) => {
      let observed: ReturnType<typeof matrix>;
      await context.poll(() => {
        observed = matrix();
        return observed.direct === outcome && observed.service === outcome &&
          observed.unaffected === 'healthy' && observed.local === 'healthy';
      }, 'CIDR direct and Service-path controls');
      return observed!;
    };
    await context.phase('baseline', async () => {
      context.create('cidr-subject', serverPod(context, 'subject'));
      const client: any = probePod(context, 'client'); client.metadata.labels.type = 'client';
      context.create('cidr-client', client);
      context.create('cidr-control', probePod(context, 'control'));
      context.create('cidr-service', { apiVersion: 'v1', kind: 'Service', metadata: metadata(context, 'cidr-server'),
        spec: { selector: { app: 'subject' }, ports: [{ port: 80, targetPort: 80 }] } });
      const subject = await readyPod(context, 'subject');
      await readyPod(context, 'client'); await readyPod(context, 'control');
      await serviceBackend(context, subject.metadata.uid, 'cidr-server');
      podIp = subject.status.podIP; assert.ok(isIPv4(podIp));
      serviceIp = context.read('service', 'cidr-server').spec.clusterIP; assert.ok(isIPv4(serviceIp));
      const open = await expectTraffic('healthy');
      context.create('cidr-exclusion', cidrEgressPolicy(context, podIp, true));
      const excluded = await expectTraffic('timeout');
      return { environment, open, excluded, podIp, serviceIp };
    });
    await context.phase('fault', async () => {
      context.create('cidr-overlap', cidrEgressPolicy(context, podIp, false));
      const expected = expectation === 'reproduce-fault' ? 'timeout' : 'healthy';
      const initial = await expectTraffic(expected);
      const samples = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const observed = matrix(); samples.push(observed);
        assert.deepEqual(observed, initial, 'Overlapping CIDR behavior is unstable');
      }
      return { expectation, faultObserved: expectation === 'reproduce-fault', samples };
    });
    await context.phase('recovery', async () => {
      await removeOwnedPolicy(context, 'exclude-backend');
      const allowOnly = await expectTraffic('healthy');
      await removeOwnedPolicy(context, 'allow-range');
      return { kind: 'remove-overlapping-exclusion-then-owned-allow', allowOnly, restored: await expectTraffic('healthy') };
    });
  },
};

export function parseNpmSets(snapshot: string) {
  const sets = new Map<string, { kind: string; members: Set<string> }>();
  for (const line of snapshot.split('\n')) {
    const [operation, name, value] = line.trim().split(/\s+/);
    if (!name?.startsWith('azure-npm-')) continue;
    assert.match(name, /^azure-npm-[a-zA-Z0-9_-]+$/);
    if (operation === 'create') {
      assert.ok(value && ['hash:ip', 'hash:net', 'hash:ip,port', 'list:set'].includes(value), 'Unsupported NPM set format');
      assert.ok(!sets.has(name), 'Duplicate set definition');
      sets.set(name, { kind: value, members: new Set() });
    } else if (operation === 'add') {
      assert.ok(value && sets.has(name), 'Member has no preceding set definition');
      sets.get(name)!.members.add(value);
    }
  }
  assert.ok(sets.size > 0, 'No readable NPM sets; do not infer empty membership');
  return sets;
}

export function referencedPodSets(snapshot: string, rules: string, address: string, controlAddress: string) {
  assert.ok(isIPv4(address) && isIPv4(controlAddress) && address !== controlAddress);
  const sets = parseNpmSets(snapshot);
  const visited = new Set<string>();
  const queue = [...rules.matchAll(/--match-set\s+(azure-npm-[a-zA-Z0-9_-]+)\s+(?:src|dst)/g)].map(match => match[1]!);
  while (queue.length) {
    const name = queue.pop()!;
    if (visited.has(name)) continue;
    visited.add(name);
    const set = sets.get(name);
    assert.ok(set, 'Referenced NPM set is absent from snapshot');
    if (set.kind === 'list:set') queue.push(...set.members);
  }
  const member = (members: Set<string>, ip: string) => members.has(ip) || members.has(`${ip}/32`);
  return [...visited].filter(name => {
    const set = sets.get(name)!;
    return ['hash:ip', 'hash:net'].includes(set.kind) && member(set.members, address) && !member(set.members, controlAddress);
  });
}

const completedJobMembership: AksEndToEndCase = {
  nodeSubnetNetworking: true, networkPolicy: 'azure',
  validate(parameters) {
    validateNpmParameters(parameters);
    if (parameters.expectation === 'reproduce-fault') assert.match(parameters.npmImage!, /:v1\.0\.28$/, 'C194 requires the reported NPM release');
  },
  async run(context) {
    const expectation = requiredParameter(context.parameters, 'expectation', /^(reproduce-fault|healthy-control)$/);
    const environment = npmEnvironment(context);
    assert.equal(environment.pods.length, 1, 'One owned-cluster NPM pod required');
    const npmPod = environment.pods[0];
    const npmContainer = npmPod.spec.containers.find((container: any) => container.image === context.parameters.npmImage);
    assert.ok(npmContainer, 'NPM pod image differs from declared controller image');
    let snapshotIndex = 0;
    const snapshot = () => {
      const current = JSON.parse(context.run(['-n', 'kube-system', 'get', 'pod', npmPod.metadata.name, '-o', 'json']));
      assert.equal(current.metadata.uid, npmPod.metadata.uid, 'NPM restarted; membership comparison is invalid');
      assert.deepEqual(current.status?.containerStatuses?.map((container: any) => ({ name: container.name, restarts: container.restartCount, imageID: container.imageID })),
        npmPod.status?.containerStatuses?.map((container: any) => ({ name: container.name, restarts: container.restartCount, imageID: container.imageID })), 'NPM runtime changed during comparison');
      const sets = context.run(['-n', 'kube-system', 'exec', npmPod.metadata.name, '-c', npmContainer.name, '--', 'ipset', 'save']);
      const rules = context.run(['-n', 'kube-system', 'exec', npmPod.metadata.name, '-c', npmContainer.name, '--', 'iptables-save']);
      const evidence = { at: new Date().toISOString(), sets, rules };
      context.save(`job-membership-${++snapshotIndex}`, evidence);
      parseNpmSets(sets);
      return evidence;
    };
    const probe = httpEvidence(context);
    let jobPod: any;
    let jobUid = '';
    let address = '';
    let trackedSets: string[] = [];
    const checkControls = () => {
      assert.equal(probe('live-client', address), 'healthy');
      assert.equal(probe('control', address), 'timeout');
      assert.equal(probe('subject', '127.0.0.1'), 'healthy');
    };
    const membership = () => {
      const data = snapshot();
      const sets = parseNpmSets(data.sets);
      return trackedSets.filter(name => sets.get(name)?.members.has(jobPod.status.podIP) || sets.get(name)?.members.has(`${jobPod.status.podIP}/32`));
    };
    await context.phase('baseline', async () => {
      context.create('job-subject', serverPod(context, 'subject'));
      const live: any = probePod(context, 'live-client'); live.metadata.labels.source = 'job';
      context.create('job-live-client', live);
      context.create('job-control', probePod(context, 'control'));
      const pod: any = probePod(context, 'job-template');
      pod.metadata.labels.source = 'job';
      delete pod.metadata.name;
      pod.spec.containers[0].command = ['sh', '-c', 'mkfifo /tmp/finish && read -r finished < /tmp/finish'];
      context.create('job', { apiVersion: 'batch/v1', kind: 'Job', metadata: metadata(context, 'membership-job'),
        spec: { activeDeadlineSeconds: 240, backoffLimit: 0, template: { metadata: { labels: pod.metadata.labels }, spec: pod.spec } } });
      jobUid = context.read('job', 'membership-job').metadata.uid;
      await context.poll(() => {
        const pods = JSON.parse(context.run(namespaced(context, ['get', 'pods', '-l', 'job-name=membership-job', '-o', 'json']))).items;
        if (pods.length !== 1) return false;
        jobPod = pods[0];
        assert.ok(jobPod.metadata.ownerReferences.some((owner: any) => owner.uid === jobUid));
        return jobPod.status?.phase === 'Running' && jobPod.status?.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'True');
      }, 'Owned Job remains running before explicit completion');
      const subject = await readyPod(context, 'subject');
      const control = await readyPod(context, 'control'); await readyPod(context, 'live-client');
      address = subject.status.podIP;
      context.create('job-policy', { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata: metadata(context, 'job-source'),
        spec: { podSelector: { matchLabels: { app: 'subject' } }, policyTypes: ['Ingress'], ingress: [{ from: [{ podSelector: { matchLabels: { source: 'job' } } }] }] } });
      await context.poll(() => probe('control', address) === 'timeout' && probe('live-client', address) === 'healthy', 'Job policy is enforced');
      assert.equal(probe(jobPod.metadata.name, address), 'healthy');
      await context.poll(() => {
        const data = snapshot();
        trackedSets = referencedPodSets(data.sets, data.rules, jobPod.status.podIP, control.status.podIP);
        return trackedSets.length > 0;
      }, 'Running Job has policy-referenced IP membership');
      checkControls();
      return { environment, jobPod, trackedSets };
    });
    await context.phase('fault', async () => {
      context.run(namespaced(context, ['exec', jobPod.metadata.name, '-c', 'probe', '--', 'sh', '-c', 'printf "done\\n" > /tmp/finish']));
      await context.poll(() => {
        const pod = context.read('pod', jobPod.metadata.name);
        assert.equal(pod.metadata.uid, jobPod.metadata.uid);
        assert.notEqual(pod.status?.phase, 'Failed', 'Job failure is not successful completion');
        return pod.status?.phase === 'Succeeded';
      }, 'Job completes without deleting its Pod');
      const expectedStale = expectation === 'reproduce-fault';
      if (!expectedStale) await context.poll(() => membership().length === 0, 'Completed Job leaves referenced sets');
      const samples = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        await context.wait(5000);
        assert.equal(context.read('pod', jobPod.metadata.name).metadata.uid, jobPod.metadata.uid);
        const remaining = membership(); samples.push(remaining);
        assert.equal(remaining.length > 0, expectedStale, 'Completed-Pod membership does not match the declared expectation');
        checkControls();
      }
      return { expectation, faultObserved: expectedStale, completedPodRetained: true, samples, trackedSets };
    });
    await context.phase('recovery', async () => {
      const job = context.read('job', 'membership-job');
      assert.equal(job.metadata.uid, jobUid);
      assert.equal(job.metadata.labels['headlamp-e2e-owner'], context.owner);
      context.run(namespaced(context, ['delete', 'job', 'membership-job', '--cascade=foreground', '--wait=true', '--timeout=60s']));
      await context.poll(() => membership().length === 0, 'Deleted Job leaves referenced sets');
      checkControls();
      await removeOwnedPolicy(context, 'job-source');
      await context.poll(() => probe('control', address) === 'healthy', 'Removed owned policy restores control traffic');
      return { kind: 'owned-job-and-policy-removal', forcedIpReuse: false, address: jobPod.status.podIP };
    });
  },
};

export function endpointProbeOutcome(result: CommandResult) {
  let metrics: { exitcode?: number; http_code?: number; time_total?: number };
  try { metrics = JSON.parse(result.stdout); } catch { return 'inconclusive'; }
  if (!metrics || typeof metrics !== 'object' || metrics.exitcode !== result.status ||
    typeof metrics.time_total !== 'number' || !Number.isFinite(metrics.time_total) || metrics.time_total < 0) return 'inconclusive';
  if (result.status === 0 && metrics.http_code === 200) return 'healthy';
  if (metrics.http_code !== 0) return 'inconclusive';
  if (result.status === 7 && /Connection refused/i.test(result.stderr) && metrics.time_total < 2.5) return 'refused';
  if (result.status === 28 && metrics.time_total >= 2.5 && metrics.time_total < 6) return 'timeout';
  return 'inconclusive';
}

async function emptyService(context: AksCaseContext, name: string) {
  await context.poll(() => {
    const slices = JSON.parse(context.run(namespaced(context, [
      'get', 'endpointslices', '-l', `kubernetes.io/service-name=${name}`, '-o', 'json',
    ])));
    context.save(`${name}-empty-endpoints`, slices);
    return slices.items.every((slice: any) => (slice.endpoints ?? []).length === 0);
  }, 'Service has no endpoints, including unready endpoints');
}

const emptyServiceCompatibility: AksEndToEndCase = {
  nodeSubnetNetworking: true, networkPolicy: 'azure',
  validate(parameters) { validateNpmParameters(parameters); },
  async run(context) {
    const expectation = requiredParameter(context.parameters, 'expectation', /^(reproduce-fault|healthy-control)$/);
    const environment = npmEnvironment(context);
    assert.equal(JSON.parse(context.run(namespaced(context, ['get', 'networkpolicies', '-o', 'json']))).items.length, 0);
    const probe = httpEvidence(context);
    let serviceIp = '';
    let subjectIp = '';
    let sequence = 0;
    const connection = (name: string) => {
      const result = context.kube(namespaced(context, ['exec', name, '-c', 'probe', '--', 'curl',
        '--verbose', '--silent', '--show-error', '--fail', '--connect-timeout', '3', '--max-time', '5',
        '--noproxy', '*', '--output', '/dev/null', '--write-out', '%{json}', `http://${serviceIp}:80/`]));
      const outcome = endpointProbeOutcome(result);
      context.save(`empty-service-probe-${++sequence}`, { at: new Date().toISOString(), name, serviceIp, result, outcome });
      assert.notEqual(outcome, 'inconclusive', 'Connection error is not a validated refusal or timeout');
      return outcome;
    };
    const controls = () => {
      for (const client of ['client', 'host-client']) assert.equal(probe(client, subjectIp), 'healthy');
    };
    const changeSelector = (app: string) => {
      const service = context.read('service', 'empty-server');
      assert.equal(service.metadata.labels['headlamp-e2e-owner'], context.owner);
      service.spec.selector = { app };
      context.replace('empty-service-selector', service);
    };
    let subjectUid = '';
    await context.phase('baseline', async () => {
      context.create('empty-service-backend', serverPod(context, 'subject'));
      context.create('empty-service-client', probePod(context, 'client'));
      const host: any = probePod(context, 'host-client');
      host.spec.hostNetwork = true;
      host.spec.dnsPolicy = 'ClusterFirstWithHostNet';
      context.create('empty-service-host-client', host);
      context.create('empty-service', { apiVersion: 'v1', kind: 'Service', metadata: metadata(context, 'empty-server'),
        spec: { selector: { app: 'unmatched' }, ports: [{ port: 80, targetPort: 80 }] } });
      const subject = await readyPod(context, 'subject');
      await readyPod(context, 'client'); await readyPod(context, 'host-client');
      subjectIp = subject.status.podIP; subjectUid = subject.metadata.uid;
      serviceIp = context.read('service', 'empty-server').spec.clusterIP;
      assert.ok(isIPv4(subjectIp) && isIPv4(serviceIp));
      await emptyService(context, 'empty-server');
      controls();
      const observations = { pod: connection('client'), host: connection('host-client') };
      assert.deepEqual(observations, { pod: 'refused', host: 'refused' }, 'Empty Service must reject before the policy is added');
      return { environment, observations, serviceIp, subjectIp };
    });
    await context.phase('fault', async () => {
      context.create('empty-service-policy', { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy',
        metadata: metadata(context, 'allow-all'), spec: { podSelector: {}, policyTypes: ['Ingress', 'Egress'], ingress: [{}], egress: [{}] } });
      await emptyService(context, 'empty-server');
      const expected = expectation === 'reproduce-fault' ? 'timeout' : 'refused';
      await context.poll(() => {
        controls();
        assert.equal(connection('host-client'), 'refused', 'Host-network control must still reject');
        return connection('client') === expected;
      }, 'Empty Service response under allow-all policy');
      const samples = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        controls();
        const sample = { pod: connection('client'), host: connection('host-client') };
        samples.push(sample); assert.deepEqual(sample, { pod: expected, host: 'refused' });
      }
      return { expectation, faultObserved: expectation === 'reproduce-fault', samples, noFirewallCauseInferred: true };
    });
    await context.phase('recovery', async () => {
      changeSelector('subject'); await serviceBackend(context, subjectUid, 'empty-server');
      controls();
      assert.equal(connection('client'), 'healthy'); assert.equal(connection('host-client'), 'healthy');
      changeSelector('unmatched'); await emptyService(context, 'empty-server');
      await removeOwnedPolicy(context, 'allow-all');
      await context.poll(() => connection('client') === 'refused' && connection('host-client') === 'refused', 'Policy removal restores empty-Service rejection');
      return { kind: 'real-backend-then-empty-service-without-policy', hostNetwork: true, hostConfigurationChanged: false };
    });
  },
};

export function destinationDropRules(snapshot: string, rules: string, address: string): string[] {
  assert.ok(isIPv4(address));
  const sets = parseNpmSets(snapshot);
  const contains = (name: string, visited = new Set<string>()): boolean => {
    assert.ok(!visited.has(name), 'Cyclic NPM list:set cannot establish target membership');
    const set = sets.get(name); assert.ok(set, 'Referenced DROP set missing from capture');
    if (set.kind === 'list:set') return [...set.members].some(member => contains(member, new Set([...visited, name])));
    return ['hash:ip', 'hash:net'].includes(set.kind) && (set.members.has(address) || set.members.has(`${address}/32`));
  };
  return rules.split('\n').filter(line => {
    if (!/^-A AZURE-NPM[^ ]* /.test(line) || !/ -j DROP(?: |$)/.test(line)) return false;
    if (/(?:^|\s)(?:-p|--protocol|--dport|--dports|--sport|--sports|-s|-d|-i|-o|--ctstate|--state|--mark|--tcp-flags)\s/.test(line)) return false;
    const matches = [...line.matchAll(/--match-set\s+(azure-npm-[a-zA-Z0-9_-]+)\s+(\S+)/g)];
    if (!matches.length || matches.some(match => match[2] !== 'dst') || /!/.test(line)) return false;
    return matches.every(match => contains(match[1]!));
  }).map(line => line.trim()).sort();
}

const deletedPolicyReconciliation: AksEndToEndCase = {
  nodeSubnetNetworking: true, networkPolicy: 'azure',
  validate(parameters) { validateNpmParameters(parameters); },
  async run(context) {
    const expectation = requiredParameter(context.parameters, 'expectation', /^(reproduce-fault|healthy-control)$/);
    if (expectation === 'reproduce-fault') assert.equal(context.kubernetesVersion, '1.19.7', 'Historical C133 requires the reported control-plane version');
    const environment = npmEnvironment(context);
    assert.equal(environment.pods.length, 1);
    const npm = environment.pods[0];
    const container = npm.spec.containers.find((item: any) => item.image === context.parameters.npmImage);
    assert.ok(container);
    const identity = (pod: any) => ({ uid: pod.metadata.uid,
      containers: pod.status?.containerStatuses?.map((item: any) => ({ name: item.name, imageID: item.imageID, restartCount: item.restartCount })) });
    const originalIdentity = identity(npm);
    assert.ok(originalIdentity.containers?.length, 'NPM runtime identity missing');
    let snapshots = 0;
    let address = '';
    let controlAddress = '';
    const capture = () => {
      const current = JSON.parse(context.run(['-n', 'kube-system', 'get', 'pod', npm.metadata.name, '-o', 'json']));
      assert.deepEqual(identity(current), originalIdentity, 'NPM runtime changed; reconciliation evidence is confounded');
      const sets = context.run(['-n', 'kube-system', 'exec', npm.metadata.name, '-c', container.name, '--', 'ipset', 'save']);
      const rules = context.run(['-n', 'kube-system', 'exec', npm.metadata.name, '-c', container.name, '--', 'iptables-save']);
      const evidence = { at: new Date().toISOString(), sets, rules, matchingDropRules: destinationDropRules(sets, rules, address) };
      context.save(`policy-deletion-snapshot-${++snapshots}`, evidence);
      return evidence;
    };
    const policies = () => JSON.parse(context.run(namespaced(context, ['get', 'networkpolicies', '-o', 'json']))).items;
    const probe = httpEvidence(context);
    const observe = () => {
      const dataplane = capture();
      const traffic = probe('client', address);
      assert.equal(probe('client', controlAddress), 'healthy');
      assert.equal(probe('subject', '127.0.0.1'), 'healthy');
      return { dataplane, traffic };
    };
    const policy = () => ({ ...namedPortPolicy(context, null), metadata: metadata(context, 'deletion-test') });
    let subjectUid = '';
    let enforcedRules: string[] = [];
    await context.phase('baseline', async () => {
      assert.equal(policies().length, 0, 'Unexpected policies in owned namespace');
      context.create('deletion-subject', serverPod(context, 'subject'));
      context.create('deletion-control-server', serverPod(context, 'control-server'));
      context.create('deletion-client', probePod(context, 'client'));
      const subject = await readyPod(context, 'subject');
      subjectUid = subject.metadata.uid;
      address = subject.status.podIP;
      controlAddress = (await readyPod(context, 'control-server')).status.podIP;
      await readyPod(context, 'client');
      assert.ok(isIPv4(address) && isIPv4(controlAddress));
      const open = observe(); assert.equal(open.traffic, 'healthy');
      assert.equal(open.dataplane.matchingDropRules.length, 0, 'Preexisting target DROP rules');
      context.create('deletion-policy', policy());
      await context.poll(() => {
        const denied = observe();
        enforcedRules = denied.dataplane.matchingDropRules;
        return denied.traffic === 'timeout' && enforcedRules.length > 0;
      }, 'Owned policy installs readable target DROP rules and blocks traffic');
      return { environment, open, enforcedRules, subjectUid, scope: 'single-node-conditional-adaptation' };
    });
    await context.phase('fault', async () => {
      await removeOwnedPolicy(context, 'deletion-test');
      const absent = policies(); assert.equal(absent.length, 0);
      context.save('deleted-policy-api-evidence', absent);
      const matches = (sample: ReturnType<typeof observe>) => expectation === 'healthy-control'
        ? sample.traffic === 'healthy' && sample.dataplane.matchingDropRules.length === 0
        : sample.traffic === 'timeout' && sample.dataplane.matchingDropRules.some(rule => enforcedRules.includes(rule));
      if (expectation === 'healthy-control') await context.poll(() => matches(observe()), 'Policy deletion reconciles dataplane and traffic');
      const samples = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        await context.wait(5000);
        assert.equal(policies().length, 0);
        assert.equal(context.read('pod', 'subject').metadata.uid, subjectUid);
        const sample = observe(); samples.push(sample);
        assert.ok(matches(sample), 'Deleted-policy outcome does not match declared rule and traffic evidence');
      }
      return { expectation, faultObserved: expectation === 'reproduce-fault', samples,
        rootCause: 'initiating-reconciliation-failure-not-established' };
    });
    await context.phase('recovery', async () => {
      if (expectation === 'reproduce-fault') {
        const original = observe();
        assert.equal(original.traffic, 'timeout');
        assert.ok(original.dataplane.matchingDropRules.some(rule => enforcedRules.includes(rule)));
        return { kind: 'unaffected-backend-control-not-a-repair', originalStillBlocked: true,
          unaffectedBackendHealthy: true, hostRulesChanged: false };
      }
      context.create('deletion-policy-repeat', policy());
      await context.poll(() => {
        const sample = observe(); return sample.traffic === 'timeout' && sample.dataplane.matchingDropRules.length > 0;
      }, 'Repeated policy still enforces');
      await removeOwnedPolicy(context, 'deletion-test');
      await context.poll(() => {
        const sample = observe(); return sample.traffic === 'healthy' && sample.dataplane.matchingDropRules.length === 0;
      }, 'Repeated deletion restores traffic');
      assert.equal(policies().length, 0);
      return { kind: 'repeat-owned-policy-enforcement-and-deletion', hostRulesChanged: false };
    });
  },
};

export const aksExpansionEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c133-v1': deletedPolicyReconciliation,
  'aks-c159-v1': kubenetHairpin,
  'aks-c186-v1': overlappingCidrCompatibility,
  'aks-c190-v1': emptyServiceCompatibility,
  'aks-c192-v1': namedPortCompatibility,
  'aks-c193-v1': additivePolicyCompatibility,
  'aks-c194-v1': completedJobMembership,
};