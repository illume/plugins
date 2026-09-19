import assert from 'node:assert/strict';
import { gatewayEnvironment, validateGateway } from './aksGatewayEndToEndCases.js';
import { metadata, namespaced, probePod, readyPod, requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

const privateAppDns: AksEndToEndCase = {
  customNetwork: true,
  validate(parameters) { requiredParameter(parameters, 'recordWindowSeconds', /^(60|120|180|300)$/); },
  async run(context) {
    assert.ok(context.subnetId); const vnet = context.subnetId.slice(0, context.subnetId.lastIndexOf('/subnets/'));
    const zone = context.az(['network', 'private-dns', 'zone', 'create', '--resource-group', context.resourceGroup, '--name', 'research.internal', '--tags', `headlamp-e2e-owner=${context.owner}`]);
    context.az(['network', 'private-dns', 'link', 'vnet', 'create', '--resource-group', context.resourceGroup, '--zone-name', zone.name, '--name', 'cluster', '--virtual-network', vnet, '--registration-enabled', 'false']);
    context.az(['network', 'private-dns', 'record-set', 'a', 'add-record', '--resource-group', context.resourceGroup, '--zone-name', zone.name, '--record-set-name', 'control', '--ipv4-address', '192.0.2.66']);
    context.az(['aks', 'approuting', 'enable', '--resource-group', context.resourceGroup, '--name', 'research']);
    context.az(['aks', 'approuting', 'zone', 'add', '--resource-group', context.resourceGroup, '--name', 'research', '--ids', zone.id, '--attach-zones']);
    context.create('internal-controller', { apiVersion: 'approuting.kubernetes.azure.com/v1alpha1', kind: 'NginxIngressController', metadata: { name: 'internal' }, spec: {
      ingressClassName: 'research-internal', controllerNamePrefix: 'research-internal', loadBalancerAnnotations: { 'service.beta.kubernetes.io/azure-load-balancer-internal': 'true' } } });
    const backend: any = probePod(context, 'backend'); backend.metadata.labels.app = 'backend'; backend.spec.containers[0].command = ['sh', '-c', 'mkdir -p /tmp/www; echo owned-dns >/tmp/www/index.html; exec httpd -f -p 8080 -h /tmp/www'];
    context.create('backend', backend); await readyPod(context, 'backend'); context.create('client', probePod(context, 'client')); await readyPod(context, 'client');
    context.create('backend-service', { apiVersion: 'v1', kind: 'Service', metadata: metadata(context, 'backend'), spec: { selector: { app: 'backend' }, ports: [{ port: 80, targetPort: 8080 }] } });
    const lookup = (hostname: string) => context.kube(namespaced(context, ['exec', 'client', '--', 'nslookup', hostname]));
    let address = '';
    await context.phase('baseline', async () => { const result = lookup('control.research.internal'); assert.equal(result.status, 0); assert.match(result.stdout, /192\.0\.2\.66/); return { result, zone }; });
    await context.phase('fault', async () => {
      context.create('internal-ingress', { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: metadata(context, 'subject'), spec: {
        ingressClassName: 'research-internal', rules: [{ host: 'subject.research.internal', http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'backend', port: { number: 80 } } } }] } }] } });
      await context.poll(() => { address = context.read('ingress', 'subject').status?.loadBalancer?.ingress?.[0]?.ip ?? ''; return !!address; }, 'Internal ingress IP');
      const direct = context.kube(namespaced(context, ['exec', 'client', '--', 'wget', '-q', '-T', '5', '--header', 'Host: subject.research.internal', '-O', '-', `http://${address}/`])); assert.equal(direct.status, 0);
      const samples = [];
      for (let seconds = 0; seconds < Number(context.parameters.recordWindowSeconds); seconds += 10) {
        const records = context.az(['network', 'private-dns', 'record-set', 'a', 'list', '--resource-group', context.resourceGroup, '--zone-name', zone.name]);
        assert.ok(!records.some((record: any) => record.name === 'subject')); samples.push(records); await context.wait(10000);
      }
      assert.notEqual(lookup('subject.research.internal').status, 0); return { ingress: context.read('ingress', 'subject'), direct, samples };
    });
    await context.phase('recovery', async () => {
      context.az(['network', 'private-dns', 'record-set', 'a', 'add-record', '--resource-group', context.resourceGroup, '--zone-name', zone.name, '--record-set-name', 'subject', '--ipv4-address', address]);
      await context.poll(() => lookup('subject.research.internal').status === 0, 'Supported explicit private DNS record');
      const traffic = context.run(namespaced(context, ['exec', 'client', '--', 'wget', '-q', '-T', '5', '-O', '-', 'http://subject.research.internal/'])); assert.equal(traffic.trim(), 'owned-dns');
      return { lookup: lookup('subject.research.internal'), traffic, recovery: 'Owned explicit DNS record workaround, not claimed controller auto-registration repair' };
    });
  },
};

const cookieServer = `import http.server,os
class Handler(http.server.BaseHTTPRequestHandler):
  def do_GET(self):
    body=os.environ['BACKEND'].encode();self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
http.server.HTTPServer(('0.0.0.0',8080),Handler).serve_forever()
`;
const cookieProbe = `import urllib.request,http.cookiejar,json,sys
jar=http.cookiejar.CookieJar();opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar));responses=[]
for index in range(20):
  path='/a/page' if index%2==0 else '/b/page'
  with opener.open(sys.argv[1]+path,timeout=5) as response:responses.append({'path':path,'backend':response.read().decode()})
print(json.dumps({'responses':responses,'cookies':[{'name':cookie.name,'path':cookie.path,'domain':cookie.domain} for cookie in jar]}))
`;
const cookieAffinity: AksEndToEndCase = {
  customNetwork: true, enableOidc: true,
  validate(parameters) { validateGateway(parameters); requiredParameter(parameters, 'pythonImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/); },
  async run(context) {
    const gateway = await gatewayEnvironment(context, 'recoveryGateway');
    for (const name of ['backend-one', 'backend-two']) {
      const pod: any = probePod(context, name); pod.metadata.labels.app = 'affinity'; pod.spec.containers[0].image = context.parameters.pythonImage;
      pod.spec.containers[0].command = ['python', '-c', cookieServer]; pod.spec.containers[0].env = [{ name: 'BACKEND', value: name }]; context.create(name, pod); await readyPod(context, name);
    }
    const service = context.read('service', 'backend'); service.spec.selector = { app: 'affinity' }; context.replace('affinity-service', service);
    const route = context.read('httproute', 'route'); delete route.spec.hostnames; context.replace('address-route', route);
    context.create('affinity-policy', { apiVersion: 'alb.networking.azure.io/v1', kind: 'BackendTrafficPolicy', metadata: metadata(context, 'affinity'), spec: {
      targetRefs: [{ group: '', kind: 'Service', name: 'backend' }], default: { sessionAffinity: { affinityType: 'managed-cookie', cookieName: 'research-affinity' } } } });
    const client: any = probePod(context, 'cookie-client'); client.spec.containers[0].image = context.parameters.pythonImage; client.spec.containers[0].command = ['python', '-c', 'import time; time.sleep(3600)'];
    context.create('cookie-client', client); await readyPod(context, 'cookie-client');
    const probe = () => JSON.parse(context.run(namespaced(context, ['exec', 'cookie-client', '--', 'python', '-c', cookieProbe, `http://${gateway.address}`])));
    const sticky = (sample: any) => { assert.ok(sample.cookies.some((cookie: any) => cookie.path === '/')); assert.equal(new Set(sample.responses.map((response: any) => response.backend)).size, 1); };
    await context.phase('baseline', async () => { const sample = probe(); sticky(sample); return sample; });
    await context.phase('fault', async () => {
      await gateway.install('affectedGateway'); const samples = [];
      for (let attempt = 0; attempt < 3; attempt++) samples.push(probe());
      assert.ok(samples.some(sample => sample.cookies.some((cookie: any) => cookie.path !== '/') && new Set(sample.responses.map((response: any) => response.backend)).size > 1), 'No path-scoped cookie affinity failure'); return samples;
    });
    await context.phase('recovery', async () => { await gateway.install('recoveryGateway'); const sample = probe(); sticky(sample); return sample; });
  },
};

export const aksRoutingDetailEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c036-v1': privateAppDns,
  'aks-c062-v1': cookieAffinity,
};