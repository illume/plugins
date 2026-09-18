import assert from 'node:assert/strict';
import { chartInput, installChart, deploymentPods, available } from './aksChartCaseSupport.js';
import { metadata, namespaced, probePod, readyPod, requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

const redirectWorker: AksEndToEndCase = {
  validate(parameters) {
    chartInput(parameters, 'affectedIngress'); chartInput(parameters, 'recoveryIngress');
    requiredParameter(parameters, 'controllerDeployment', /^[a-z0-9-]+$/);
    requiredParameter(parameters, 'requestPath', /^\/[a-zA-Z0-9_/?=&%.:-]{1,512}$/);
    requiredParameter(parameters, 'signinRedirect', /^https:\/\/[a-zA-Z0-9./?=&_$%:-]+$/);
  },
  async run(context) {
    const backend: any = probePod(context, 'backend'); backend.metadata.labels.app = 'backend';
    backend.spec.containers[0].command = ['sh', '-c', 'mkdir -p /tmp/www; echo owned >/tmp/www/index.html; exec httpd -f -p 8080 -h /tmp/www'];
    context.create('backend', backend); await readyPod(context, 'backend'); context.create('client', probePod(context, 'client')); await readyPod(context, 'client');
    context.create('backend-service', { apiVersion: 'v1', kind: 'Service', metadata: metadata(context, 'backend'), spec: { selector: { app: 'backend' }, ports: [{ port: 80, targetPort: 8080 }] } });
    const values = { controller: { service: { type: 'ClusterIP' }, admissionWebhooks: { enabled: false }, config: { 'allow-snippet-annotations': 'false' } } };
    const install = async (prefix: string) => { installChart(context, 'ingress', prefix, 'ingress-system', values); return available(context, 'ingress-system', context.parameters.controllerDeployment!); };
    const request = () => context.kube(namespaced(context, ['exec', 'client', '--', 'wget', '-S', '-T', '5', '--max-redirect=0', '--header', 'Host: auth.research.example', '-O', '-',
      `http://ingress-ingress-nginx-controller.ingress-system.svc.cluster.local${context.parameters.requestPath}`]));
    context.create('ingress', { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: {
      ...metadata(context, 'auth'), annotations: { 'nginx.ingress.kubernetes.io/auth-url': `http://backend.${context.namespace}.svc.cluster.local/unauthorized`, 'nginx.ingress.kubernetes.io/auth-signin': context.parameters.signinRedirect } },
      spec: { ingressClassName: 'nginx', rules: [{ host: 'auth.research.example', http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'backend', port: { number: 80 } } } }] } }] } });
    await context.phase('baseline', async () => { const deployment = await install('recoveryIngress'); const result = request(); assert.match(result.stderr, /HTTP\/1\.[01] (?:302|303|401)/); return { deployment, result }; });
    await context.phase('fault', async () => {
      await install('affectedIngress'); const result = request(); assert.notEqual(result.status, 0); let evidence: unknown;
      await context.poll(() => {
        const pods = deploymentPods(context, 'ingress-system', context.parameters.controllerDeployment!);
        const logs = context.kube(['-n', 'ingress-system', 'logs', `deployment/${context.parameters.controllerDeployment}`, '--all-containers=true', '--tail=150']);
        evidence = { result, pods, logs }; context.save('redirect-worker-failure', evidence);
        return /worker process.*(?:signal 11|segmentation|exited)|segmentation fault/i.test(logs.stdout + logs.stderr);
      }, 'Actual ingress worker crash for bounded redirect request'); return evidence;
    });
    await context.phase('recovery', async () => { await install('recoveryIngress'); const result = request(); assert.match(result.stderr, /HTTP\/1\.[01] (?:302|303|401)/); return result; });
  },
};

const competingIpam: AksEndToEndCase = {
  bringYourOwnCni: true, podCidr: '10.244.0.0/16',
  validate(parameters) { chartInput(parameters, 'ciliumChart'); },
  async run(context) {
    const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
    installChart(context, 'cilium', 'ciliumChart', 'kube-system', { aksbyocni: { enabled: true }, k8sServiceHost: cluster.fqdn, k8sServicePort: 443,
      ipam: { mode: 'cluster-pool', operator: { clusterPoolIPv4PodCIDRList: ['10.244.0.0/16'] } }, kubeProxyReplacement: false });
    const backend: any = probePod(context, 'backend'); backend.metadata.labels.app = 'backend'; backend.spec.containers[0].command = ['sh', '-c', 'mkdir -p /tmp/www; echo owned >/tmp/www/index.html; exec httpd -f -p 8080 -h /tmp/www'];
    context.create('backend', backend); await readyPod(context, 'backend'); context.create('client', probePod(context, 'client')); await readyPod(context, 'client');
    const service = () => context.read('service', 'backend');
    const request = () => { const ip = service().status?.loadBalancer?.ingress?.[0]?.ip; return ip ? context.kube(namespaced(context, ['exec', 'client', '--', 'wget', '-q', '-T', '5', '-O', '-', `http://${ip}/`])) : null; };
    await context.phase('baseline', async () => {
      context.create('loadbalancer', { apiVersion: 'v1', kind: 'Service', metadata: metadata(context, 'backend'), spec: { type: 'LoadBalancer', selector: { app: 'backend' }, ports: [{ port: 80, targetPort: 8080 }] } });
      await context.poll(() => request()?.status === 0, 'Single cloud-controller address owner'); return { service: service(), request: request() };
    });
    await context.phase('fault', async () => {
      context.create('ipam-pool', { apiVersion: 'cilium.io/v2alpha1', kind: 'CiliumLoadBalancerIPPool', metadata: { name: 'owned-pool', labels: { 'headlamp-e2e-owner': context.owner } }, spec: { blocks: [{ cidr: '192.0.2.0/29' }], serviceSelector: { matchLabels: { 'headlamp-e2e-owner': context.owner } } } });
      const samples: any[] = []; const addresses = new Set<string>();
      for (let count = 0; count < 18; count++) { const current = service(); samples.push(current); addresses.add(JSON.stringify(current.status?.loadBalancer?.ingress ?? [])); await context.wait(5000); }
      assert.ok(addresses.size > 1, 'No competing external-IP changes observed');
      const events = objectEventsForService(context, service());
      assert.ok(events.items.some((event: any) => /cilium/i.test(JSON.stringify(event))) && events.items.some((event: any) => /loadbalancer|cloud-controller/i.test(JSON.stringify(event))));
      assert.ok(request()?.status !== 0); return { samples, events };
    });
    await context.phase('recovery', async () => {
      context.run(['delete', 'ciliumloadbalancerippool', 'owned-pool']);
      await context.poll(() => request()?.status === 0, 'Restored single-owner load balancer'); return { service: service(), request: request() };
    });
  },
};

function objectEventsForService(context: Parameters<AksEndToEndCase['run']>[0], service: any) {
  return JSON.parse(context.run(namespaced(context, ['get', 'events', '--field-selector', `involvedObject.uid=${service.metadata.uid}`, '-o', 'json'])));
}

export const aksIngressControllerEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c039-v1': competingIpam,
  'aks-c064-v1': redirectWorker,
};