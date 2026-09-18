import assert from 'node:assert/strict';
import { addPool, metadata, namespaced, probePod, readyPod, requiredParameter, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';

async function trafficFixture(context: AksCaseContext) {
  const backend: any = probePod(context, 'backend'); backend.metadata.labels.role = 'backend';
  backend.spec.containers[0].command = ['sh', '-c', 'mkdir -p /tmp/www; printf "owned-backend\\n" >/tmp/www/index.html; exec httpd -f -p 8080 -h /tmp/www'];
  context.create('backend', backend);
  const client: any = probePod(context, 'client'); client.metadata.labels.role = 'client'; context.create('client', client);
  await readyPod(context, 'backend'); await readyPod(context, 'client');
  context.create('backend-service', { apiVersion: 'v1', kind: 'Service', metadata: metadata(context, 'backend'), spec: {
    selector: { role: 'backend' }, ports: [{ port: 80, targetPort: 8080 }] } });
  return () => context.kube(namespaced(context, ['exec', 'client', '--', 'wget', '-q', '-T', '3', '-O', '-', 'http://backend/']));
}

const ingressValidation: AksEndToEndCase = {
  networkDataplane: 'cilium', enableAcns: true,
  validate(parameters) { requiredParameter(parameters, 'ciliumImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/); },
  async run(context) {
    const agent = JSON.parse(context.run(['-n', 'kube-system', 'get', 'daemonset', 'cilium', '-o', 'json']));
    assert.ok(agent.spec.template.spec.containers.some((container: any) => container.image === context.parameters.ciliumImage));
    const request = await trafficFixture(context);
    const policy = (name: string, includeEgress: boolean) => ({ apiVersion: 'cilium.io/v2', kind: 'CiliumNetworkPolicy', metadata: metadata(context, name),
      spec: { endpointSelector: { matchLabels: { role: 'backend' } }, ingress: [{ fromEndpoints: [{ matchLabels: { role: 'client' } }] }],
        ...(includeEgress ? { egress: [] } : {}) } });
    await context.phase('baseline', async () => {
      context.create('supported-policy', policy('control', true));
      await context.poll(() => request().status === 0, 'Control policy traffic');
      const accepted = context.read('ciliumnetworkpolicy', 'control');
      context.run(namespaced(context, ['delete', 'ciliumnetworkpolicy', 'control'])); return { accepted, request: request() };
    });
    await context.phase('fault', async () => {
      const rejected = context.attemptCreate('ingress-only-policy', policy('subject', false));
      assert.notEqual(rejected.status, 0, 'Ingress-only policy accepted; fault not reproduced');
      assert.match(rejected.stderr, /validation|admission|expression/i);
      assert.match(rejected.stderr, /egress|no such key|undeclared reference/i);
      return { rejected, policy: policy('subject', false), agent };
    });
    await context.phase('recovery', async () => {
      context.create('explicit-policy', policy('subject', true));
      await context.poll(() => request().status === 0, 'Explicit policy recovery');
      return { policy: context.read('ciliumnetworkpolicy', 'subject'), request: request() };
    });
  },
};

const reverseDns: AksEndToEndCase = {
  validate(parameters) {
    for (const name of ['baselineDnsImage', 'affectedDnsImage', 'recoveryDnsImage']) requiredParameter(parameters, name, /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
  },
  async run(context) {
    context.create('dns-client', probePod(context, 'client')); await readyPod(context, 'client');
    const podIp = context.read('pod', 'client').status.podIP;
    const deploy = () => JSON.parse(context.run(['-n', 'kube-system', 'get', 'deployment', 'coredns', '-o', 'json']));
    const setImage = async (image: string, name: string) => {
      const object = deploy(); const container = object.spec.template.spec.containers.find((item: any) => item.name === 'coredns'); assert.ok(container);
      container.image = image; context.replace(`coredns-${name}`, object);
      context.run(['-n', 'kube-system', 'rollout', 'status', 'deployment/coredns', '--timeout=120s']);
      const actual = deploy(); assert.equal(actual.spec.template.spec.containers.find((item: any) => item.name === 'coredns').image, image); return actual;
    };
    const query = (name: string) => context.kube(namespaced(context, ['exec', 'client', '--', 'nslookup', name]));
    const forward = () => { const result = query('kubernetes.default.svc.cluster.local'); assert.equal(result.status, 0); return result; };
    let originalAnswer = '';
    await context.phase('baseline', async () => {
      const deployment = await setImage(context.parameters.baselineDnsImage!, 'baseline');
      const ptr = query(podIp); assert.equal(ptr.status, 0); assert.match(ptr.stdout, /name\s*=|Name:/i); originalAnswer = ptr.stdout;
      return { deployment, ptr, forward: forward(), corefile: JSON.parse(context.run(['-n', 'kube-system', 'get', 'configmap', 'coredns', '-o', 'json'])) };
    });
    await context.phase('fault', async () => {
      const deployment = await setImage(context.parameters.affectedDnsImage!, 'fault');
      const ptr = query(podIp); assert.notEqual(ptr.status, 0); assert.match(ptr.stdout + ptr.stderr, /NXDOMAIN|can't find|not found/i);
      return { deployment, ptr, originalAnswer, forward: forward() };
    });
    await context.phase('recovery', async () => {
      const deployment = await setImage(context.parameters.recoveryDnsImage!, 'recovery'); const ptr = query(podIp);
      assert.equal(ptr.status, 0); assert.match(ptr.stdout, /name\s*=|Name:/i); return { deployment, ptr, forward: forward() };
    });
  },
};

const fipsCalico: AksEndToEndCase = {
  networkPolicy: 'calico',
  validate(parameters) {
    requiredParameter(parameters, 'calicoImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
    requiredParameter(parameters, 'fipsNodeImageVersion', /^[a-zA-Z0-9._-]+$/);
  },
  async run(context) {
    const agent = JSON.parse(context.run(['-n', 'kube-system', 'get', 'daemonset', 'calico-node', '-o', 'json']));
    assert.ok(agent.spec.template.spec.containers.some((container: any) => container.image === context.parameters.calicoImage));
    const traffic = await trafficFixture(context);
    let baseline: unknown;
    await context.phase('baseline', async () => {
      assert.equal(traffic().status, 0);
      const existing = JSON.parse(context.run(['-n', 'kube-system', 'get', 'pods', '-l', 'k8s-app=calico-node', '-o', 'json']));
      const logs = existing.items.map((pod: any) => context.kube(['-n', 'kube-system', 'logs', pod.metadata.name, '-c', 'calico-node', '--tail=100']));
      assert.ok(logs.every((result: any) => !/failed.*(?:BTF|XDP)|(?:BTF|XDP).*failed/i.test(result.stdout)));
      baseline = { existing, logs, traffic: traffic() }; return baseline;
    });
    await context.phase('fault', async () => {
      const pool = await addPool(context, 'fips', ['--enable-fips-image', '--os-sku', 'Ubuntu']);
      assert.equal(pool.nodeImageVersion, context.parameters.fipsNodeImageVersion);
      let observation: unknown;
      await context.poll(() => {
        const pods = JSON.parse(context.run(['-n', 'kube-system', 'get', 'pods', '-l', 'k8s-app=calico-node', '-o', 'json']));
        for (const pod of pods.items) {
          const node = JSON.parse(context.run(['get', 'node', pod.spec.nodeName, '-o', 'json'])); if (node.metadata.labels.agentpool !== 'fips') continue;
          const logs = context.kube(['-n', 'kube-system', 'logs', pod.metadata.name, '-c', 'calico-node', '--tail=100']);
          observation = { pool, node, pod, logs, traffic: traffic() }; context.save('fips-agent-observation', observation);
          if (logs.status === 0 && /failed.*(?:BTF|XDP)|(?:BTF|XDP).*failed/i.test(logs.stdout)) return true;
        }
        return false;
      }, 'FIPS-specific Calico initialization error'); return observation;
    });
    await context.phase('recovery', async () => {
      context.az(['aks', 'nodepool', 'delete', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'fips']);
      assert.equal(traffic().status, 0);
      return { traffic: traffic(), scope: 'Removal of disposable FIPS compatibility test; not a policy-enforcement outage or production security downgrade claim', baseline };
    });
  },
};

export const aksDataplaneEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c040-v1': fipsCalico,
  'aks-c057-v1': ingressValidation,
  'aks-c058-v1': reverseDns,
};