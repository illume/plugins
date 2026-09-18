import assert from 'node:assert/strict';
import { metadata, namespaced, probePod, readyPod, requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

const externalMeshPolicy: AksEndToEndCase = {
  networkPolicy: 'calico',
  validate(parameters) { requiredParameter(parameters, 'meshRevision', /^asm-\d+-\d+$/); },
  async run(context) {
    context.az(['aks', 'mesh', 'enable', '--resource-group', context.resourceGroup, '--name', 'research', '--revision', context.parameters.meshRevision!]);
    context.run(['label', 'namespace', context.namespace, `istio.io/rev=${context.parameters.meshRevision}`, '--overwrite']);
    const external = context.az(['container', 'create', '--resource-group', context.resourceGroup, '--name', 'external-backend', '--location', context.location,
      '--image', context.probeImage, '--os-type', 'Linux', '--cpu', '1', '--memory', '1', '--ip-address', 'Public', '--ports', '8080',
      '--command-line', 'sh -c "mkdir -p /tmp/www; echo owned-external >/tmp/www/index.html; exec httpd -f -p 8080 -h /tmp/www"', '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const address = external.ipAddress?.ip; assert.ok(typeof address === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(address));
    const client: any = probePod(context, 'client'); client.metadata.labels.app = 'client'; context.create('client', client); const injected = await readyPod(context, 'client');
    assert.ok(injected.spec.containers.some((container: any) => container.name === 'istio-proxy'));
    context.create('service-entry', { apiVersion: 'networking.istio.io/v1beta1', kind: 'ServiceEntry', metadata: metadata(context, 'external'),
      spec: { hosts: ['external.research.example'], addresses: [`${address}/32`], location: 'MESH_EXTERNAL', ports: [{ number: 8080, name: 'http', protocol: 'HTTP' }], resolution: 'STATIC', endpoints: [{ address, labels: { app: 'external' } }] } });
    const request = () => context.kube(namespaced(context, ['exec', 'client', '-c', 'probe', '--', 'wget', '-q', '-T', '5', '--header', 'Host: external.research.example', '-O', '-', `http://${address}:8080/`]));
    const boundary = { apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', metadata: metadata(context, 'egress-boundary'), spec: { podSelector: { matchLabels: { app: 'client' } }, policyTypes: ['Egress'],
      egress: [{ to: [{ ipBlock: { cidr: '0.0.0.0/0', except: [`${address}/32`] } }] }] } };
    await context.phase('baseline', async () => {
      await context.poll(() => request().status === 0, 'Owned external endpoint reachable through mesh'); context.create('enforced-egress-control', boundary);
      await context.poll(() => request().status !== 0, 'Explicit network enforcement control'); context.run(namespaced(context, ['delete', 'networkpolicy', 'egress-boundary']));
      await context.poll(() => request().status === 0, 'Restored external path'); return { injected, externalAddress: address, networkControlEnforced: true };
    });
    await context.phase('fault', async () => {
      context.create('external-authorization', { apiVersion: 'security.istio.io/v1beta1', kind: 'AuthorizationPolicy', metadata: metadata(context, 'external-deny'),
        spec: { selector: { matchLabels: { app: 'external' } }, action: 'DENY', rules: [{}] } });
      const responses = [];
      for (let sample = 0; sample < 3; sample++) { const result = request(); assert.equal(result.status, 0); assert.equal(result.stdout.trim(), 'owned-external'); responses.push(result); }
      return { responses, policy: context.read('authorizationpolicy', 'external-deny'), serviceEntry: context.read('serviceentry', 'external'), scope: 'External endpoint is outside inbound workload authorization enforcement' };
    });
    await context.phase('recovery', async () => { context.create('explicit-egress-boundary', boundary); await context.poll(() => request().status !== 0, 'Supported explicit egress enforcement'); return { policy: context.read('networkpolicy', 'egress-boundary'), request: request(), recovery: 'Explicit network enforcement, not a claim that ServiceEntry selectors enforce external authorization' }; });
  },
};

const acnsPolicyCrash: AksEndToEndCase = {
  networkDataplane: 'cilium', enableAcns: true,
  validate(parameters) {
    requiredParameter(parameters, 'ciliumImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
    const spec = JSON.parse(requiredParameter(parameters, 'reportedEgressSpec', /^\{.*\}$/s));
    assert.ok(spec && typeof spec === 'object' && !Array.isArray(spec) && spec.endpointSelector && Array.isArray(spec.egress));
  },
  async run(context) {
    const agent = JSON.parse(context.run(['-n', 'kube-system', 'get', 'daemonset', 'cilium', '-o', 'json']));
    assert.ok(agent.spec.template.spec.containers.some((container: any) => container.image === context.parameters.ciliumImage));
    context.create('client', probePod(context, 'client')); await readyPod(context, 'client');
    const query = () => context.kube(namespaced(context, ['exec', 'client', '--', 'nslookup', 'kubernetes.default.svc.cluster.local']));
    const pods = () => JSON.parse(context.run(['-n', 'kube-system', 'get', 'pods', '-l', 'k8s-app=cilium', '-o', 'json']));
    let restartCount = new Map<string, number>();
    await context.phase('baseline', async () => {
      assert.equal(query().status, 0); const agents = pods();
      restartCount = new Map(agents.items.map((pod: any) => [pod.metadata.uid, pod.status.containerStatuses.reduce((total: number, container: any) => total + container.restartCount, 0)]));
      assert.ok(agents.items.every((pod: any) => pod.status.conditions.some((condition: any) => condition.type === 'Ready' && condition.status === 'True')));
      return { agents, query: query() };
    });
    await context.phase('fault', async () => {
      context.create('reported-policy', { apiVersion: 'cilium.io/v2', kind: 'CiliumNetworkPolicy', metadata: metadata(context, 'subject'), spec: JSON.parse(context.parameters.reportedEgressSpec!) });
      let observation: unknown;
      await context.poll(() => {
        const agents = pods(); const logs = context.kube(['-n', 'kube-system', 'logs', 'daemonset/cilium', '-c', 'cilium-agent', '--previous', '--tail=100']);
        const dns = query(); observation = { agents, logs, dns }; context.save('policy-agent-crash', observation);
        return dns.status !== 0 && /panic|fatal|segmentation|crash/i.test(logs.stdout + logs.stderr) && agents.items.some((pod: any) =>
          restartCount.has(pod.metadata.uid) && pod.status.containerStatuses.reduce((total: number, container: any) => total + container.restartCount, 0) > restartCount.get(pod.metadata.uid)!);
      }, 'Policy-associated Cilium crash and DNS failure'); return observation;
    });
    await context.phase('recovery', async () => {
      context.run(namespaced(context, ['delete', 'ciliumnetworkpolicy', 'subject']));
      await context.poll(() => query().status === 0 && pods().items.every((pod: any) => pod.status.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'True')), 'Agent and DNS recovery');
      return { agents: pods(), query: query() };
    });
  },
};

export const aksPolicyInteractionEndToEndCases: Record<string, AksEndToEndCase> = { 'aks-c060-v1': externalMeshPolicy, 'aks-c061-v1': acnsPolicyCrash };