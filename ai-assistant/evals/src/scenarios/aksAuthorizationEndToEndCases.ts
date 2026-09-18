import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { metadata, namespaced, probePod, readyPod, requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

export const authorizationProbe = `import json,os,ssl,sys,urllib.request,urllib.parse,urllib.error
with open('/var/run/research/token') as source: assertion=source.read()
body=urllib.parse.urlencode({'client_id':os.environ['CLIENT'],'scope':'6dae42f8-4368-4678-94ff-3960e28e3630/.default','grant_type':'client_credentials','client_assertion_type':'urn:ietf:params:oauth:client-assertion-type:jwt-bearer','client_assertion':assertion}).encode()
try:
  with urllib.request.urlopen(urllib.request.Request('https://login.microsoftonline.com/'+os.environ['TENANT']+'/oauth2/v2.0/token',data=body),timeout=20) as response: token=json.load(response)['access_token']
  request=urllib.request.Request('https://kubernetes.default.svc'+sys.argv[1],headers={'Authorization':'Bearer '+token})
  with urllib.request.urlopen(request,context=ssl.create_default_context(cafile='/var/run/research/ca.crt'),timeout=20) as response: print(json.dumps({'status':response.status}))
except urllib.error.HTTPError as failure: print(json.dumps({'status':failure.code}));sys.exit(10)
except Exception: print(json.dumps({'status':'transport-error'}));sys.exit(11)
`;

const readerHttpRoute: AksEndToEndCase = {
  azureRbac: true, enableOidc: true,
  validate(parameters) {
    requiredParameter(parameters, 'pythonImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
    const file = requiredParameter(parameters, 'gatewayApiManifest', /^\/.+\.ya?ml$/);
    const hash = requiredParameter(parameters, 'gatewayApiManifestSha256', /^[a-f0-9]{64}$/);
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), hash);
  },
  async run(context) {
    const resources = yaml.loadAll(readFileSync(context.parameters.gatewayApiManifest!, 'utf8')) as any[];
    for (const [index, resource] of resources.entries()) {
      assert.equal(resource.kind, 'CustomResourceDefinition'); assert.equal(resource.spec.group, 'gateway.networking.k8s.io');
      context.create(`gateway-api-${index}`, resource); context.run(['wait', '--for=condition=Established', `crd/${resource.metadata.name}`, '--timeout=60s']);
    }
    const identity = context.az(['identity', 'create', '--resource-group', context.resourceGroup, '--name', 'reader', '--location', context.location, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const tenant = context.az(['account', 'show']).tenantId;
    const issuer = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']).oidcIssuerProfile.issuerUrl;
    context.create('reader-account', { apiVersion: 'v1', kind: 'ServiceAccount', metadata: metadata(context, 'reader') });
    context.az(['identity', 'federated-credential', 'create', '--resource-group', context.resourceGroup, '--identity-name', 'reader', '--name', 'reader', '--issuer', issuer,
      '--subject', `system:serviceaccount:${context.namespace}:reader`, '--audiences', 'api://AzureADTokenExchange']);
    const scope = `${context.clusterId}/namespaces/${context.namespace}`;
    context.az(['role', 'assignment', 'create', '--assignee-object-id', identity.principalId, '--assignee-principal-type', 'ServicePrincipal', '--role', 'Azure Kubernetes Service RBAC Reader', '--scope', scope]);
    const pod: any = probePod(context, 'reader'); pod.spec.serviceAccountName = 'reader'; pod.spec.containers[0].image = context.parameters.pythonImage;
    pod.spec.containers[0].command = ['python', '-c', 'import time; time.sleep(3600)'];
    pod.spec.containers[0].env = [{ name: 'CLIENT', value: identity.clientId }, { name: 'TENANT', value: tenant }];
    pod.spec.volumes = [{ name: 'identity', projected: { sources: [{ serviceAccountToken: { path: 'token', audience: 'api://AzureADTokenExchange', expirationSeconds: 3600 } },
      { configMap: { name: 'kube-root-ca.crt', items: [{ key: 'ca.crt', path: 'ca.crt' }] } }] } }];
    pod.spec.containers[0].volumeMounts = [{ name: 'identity', mountPath: '/var/run/research', readOnly: true }];
    context.create('reader-pod', pod); await readyPod(context, 'reader');
    const request = (url: string) => {
      const response = context.kube(namespaced(context, ['exec', 'reader', '--', 'python', '-c', authorizationProbe, url]));
      let sanitized: any; try { sanitized = JSON.parse(response.stdout); } catch { throw new Error('Authorization probe returned no sanitized status'); }
      return { exitStatus: response.status, status: sanitized.status };
    };
    const podsPath = `/api/v1/namespaces/${context.namespace}/pods`;
    const routePath = `/apis/gateway.networking.k8s.io/v1/namespaces/${context.namespace}/httproutes`;
    const secretsPath = `/api/v1/namespaces/${context.namespace}/secrets`;
    await context.phase('baseline', async () => {
      await context.poll(() => request(podsPath).status === 200, 'Reader conventional-resource access');
      assert.equal(request(secretsPath).status, 403); return { pods: request(podsPath), secrets: request(secretsPath) };
    });
    await context.phase('fault', async () => {
      assert.equal(request(routePath).status, 403); assert.equal(request(podsPath).status, 200);
      const builtInRole = context.az(['role', 'definition', 'list', '--name', 'Azure Kubernetes Service RBAC Reader']);
      return { httpRoutes: request(routePath), conventional: request(podsPath), builtInRole };
    });
    await context.phase('recovery', async () => {
      const id = `/subscriptions/${context.subscription}/providers/Microsoft.Authorization/roleDefinitions/${context.owner}`;
      assert.equal(context.az(['role', 'definition', 'list', '--name', context.owner]).length, 0); context.registerExternalCleanup('role-definition', id);
      context.az(['role', 'definition', 'create', '--role-definition', JSON.stringify({ Name: `hl-${context.owner}`, Id: context.owner, IsCustom: true,
        Description: `Owned AKS reproduction ${context.owner}`, Actions: [], NotActions: [], DataActions: ['Microsoft.ContainerService/managedClusters/gateway.networking.k8s.io/httproutes/read'], NotDataActions: [],
        AssignableScopes: [`/subscriptions/${context.subscription}`] })]);
      context.az(['role', 'assignment', 'create', '--assignee-object-id', identity.principalId, '--assignee-principal-type', 'ServicePrincipal', '--role', context.owner, '--scope', scope]);
      await context.poll(() => request(routePath).status === 200, 'Narrow HTTPRoute read entitlement'); assert.equal(request(secretsPath).status, 403);
      return { httpRoutes: request(routePath), secrets: request(secretsPath), scope, role: id };
    });
  },
};

const entraImpersonation: AksEndToEndCase = {
  azureRbac: true, enableOidc: true,
  validate(parameters) { requiredParameter(parameters, 'pythonImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/); },
  async run(context) {
    const identity = context.az(['identity', 'create', '--resource-group', context.resourceGroup, '--name', 'review-principal', '--location', context.location, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const tenant = context.az(['account', 'show']).tenantId;
    const issuer = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']).oidcIssuerProfile.issuerUrl;
    context.create('review-serviceaccount', { apiVersion: 'v1', kind: 'ServiceAccount', metadata: metadata(context, 'review') });
    context.az(['identity', 'federated-credential', 'create', '--resource-group', context.resourceGroup, '--identity-name', 'review-principal', '--name', 'review', '--issuer', issuer,
      '--subject', `system:serviceaccount:${context.namespace}:review`, '--audiences', 'api://AzureADTokenExchange']);
    context.az(['role', 'assignment', 'create', '--assignee-object-id', identity.principalId, '--assignee-principal-type', 'ServicePrincipal', '--role', 'Azure Kubernetes Service RBAC Reader', '--scope', `${context.clusterId}/namespaces/${context.namespace}`]);
    const pod: any = probePod(context, 'review'); pod.spec.serviceAccountName = 'review'; pod.spec.containers[0].image = context.parameters.pythonImage;
    pod.spec.containers[0].command = ['python', '-c', 'import time; time.sleep(3600)'];
    pod.spec.containers[0].env = [{ name: 'CLIENT', value: identity.clientId }, { name: 'TENANT', value: tenant }];
    pod.spec.volumes = [{ name: 'identity', projected: { sources: [{ serviceAccountToken: { path: 'token', audience: 'api://AzureADTokenExchange', expirationSeconds: 3600 } },
      { configMap: { name: 'kube-root-ca.crt', items: [{ key: 'ca.crt', path: 'ca.crt' }] } }] } }];
    pod.spec.containers[0].volumeMounts = [{ name: 'identity', mountPath: '/var/run/research', readOnly: true }]; context.create('review-pod', pod); await readyPod(context, 'review');
    const authenticated = (resource: string) => {
      const result = context.kube(namespaced(context, ['exec', 'review', '--', 'python', '-c', authorizationProbe, `/api/v1/namespaces/${context.namespace}/${resource}`]));
      let data: any; try { data = JSON.parse(result.stdout); } catch { throw new Error('No sanitized authentication result'); } return data;
    };
    await context.phase('baseline', async () => {
      await context.poll(() => authenticated('pods').status === 200, 'Actual Entra principal entitlement'); assert.equal(authenticated('secrets').status, 403);
      return { principal: identity.principalId, pods: authenticated('pods'), secrets: authenticated('secrets') };
    });
    await context.phase('fault', async () => {
      const review = context.kube(namespaced(context, ['auth', 'can-i', 'list', 'pods', '--as', identity.principalId]));
      assert.notEqual(review.status, 0); assert.match(review.stdout + review.stderr, /no opinion|not.*AAD|non.AAD|not.*Azure.*AD/i);
      assert.equal(authenticated('pods').status, 200); return { review, authenticated: authenticated('pods'), identityKind: 'Owned Entra service principal, not impersonating an unrelated human account' };
    });
    await context.phase('recovery', async () => {
      assert.equal(authenticated('pods').status, 200); assert.equal(authenticated('secrets').status, 403);
      return { allowed: authenticated('pods'), denied: authenticated('secrets'), recovery: 'Use authenticated principal context; no forged identity extras or widened permissions' };
    });
  },
};

export const aksAuthorizationEndToEndCases: Record<string, AksEndToEndCase> = { 'aks-c033-v1': entraImpersonation, 'aks-c065-v1': readerHttpRoute };