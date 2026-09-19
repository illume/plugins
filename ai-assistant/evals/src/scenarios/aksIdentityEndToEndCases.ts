import assert from 'node:assert/strict';
import { metadata, namespaced, probePod, readyPod, requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

const tokenExchangeProgram = `import json, os, sys, urllib.parse, urllib.request, urllib.error
tenant = os.environ['RESEARCH_TENANT']
client = os.environ['RESEARCH_CLIENT']
with open('/var/run/research/token', encoding='utf8') as stream:
    assertion = stream.read()
payload = urllib.parse.urlencode({'client_id': client, 'scope': 'https://management.azure.com/.default', 'grant_type': 'client_credentials', 'client_assertion_type': 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer', 'client_assertion': assertion}).encode()
request = urllib.request.Request('https://login.microsoftonline.com/' + tenant + '/oauth2/v2.0/token', data=payload)
try:
    with urllib.request.urlopen(request, timeout=20) as response:
        token = json.load(response)['access_token']
except urllib.error.HTTPError as failure:
    detail = json.loads(failure.read(65536))
    print(json.dumps({'stage': 'exchange', 'status': failure.code, 'codes': detail.get('error_codes', [])}))
    sys.exit(12)
except Exception:
    print(json.dumps({'stage': 'exchange', 'status': 'transport-error'}))
    sys.exit(13)
try:
    request = urllib.request.Request('https://management.azure.com' + os.environ['RESEARCH_RESOURCE'] + '?api-version=2021-04-01', headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(request, timeout=20) as response:
        resource = json.load(response)
    print(json.dumps({'stage': 'read', 'status': 200, 'resource_id': resource['id']}))
except urllib.error.HTTPError as failure:
    print(json.dumps({'stage': 'read', 'status': failure.code}))
    sys.exit(14)
except Exception:
    print(json.dumps({'stage': 'read', 'status': 'transport-error'}))
    sys.exit(15)
`;

const issuerSlash: AksEndToEndCase = {
  enableOidc: true,
  validate(parameters) {
    requiredParameter(parameters, 'pythonImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
  },
  async run(context) {
    const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
    const issuer = cluster.oidcIssuerProfile?.issuerUrl;
    assert.ok(typeof issuer === 'string' && issuer.startsWith('https://') && issuer.endsWith('/'), 'Expected published OIDC issuer with trailing slash');
    const identity = context.az(['identity', 'create', '--resource-group', context.resourceGroup, '--name', 'exchange-subject', '--location', context.location, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const account = context.az(['account', 'show']);
    const scope = `/subscriptions/${context.subscription}/resourceGroups/${context.resourceGroup}`;
    context.az(['role', 'assignment', 'create', '--assignee-object-id', identity.principalId, '--assignee-principal-type', 'ServicePrincipal', '--role', 'Reader', '--scope', scope]);
    context.create('exchange-serviceaccount', { apiVersion: 'v1', kind: 'ServiceAccount', metadata: metadata(context, 'exchange') });
    const credential = (published: string) => context.az(['identity', 'federated-credential', 'create',
      '--resource-group', context.resourceGroup, '--identity-name', 'exchange-subject', '--name', 'trial',
      '--issuer', published, '--subject', `system:serviceaccount:${context.namespace}:exchange`, '--audiences', 'api://AzureADTokenExchange']);
    const removeCredential = () => context.az(['identity', 'federated-credential', 'delete', '--resource-group', context.resourceGroup,
      '--identity-name', 'exchange-subject', '--name', 'trial', '--yes']);
    const pod: any = probePod(context, 'exchange');
    pod.spec.serviceAccountName = 'exchange';
    pod.spec.containers[0].image = context.parameters.pythonImage;
    pod.spec.containers[0].command = ['python', '-c', 'import time; time.sleep(3600)'];
    pod.spec.containers[0].env = [
      { name: 'RESEARCH_TENANT', value: account.tenantId }, { name: 'RESEARCH_CLIENT', value: identity.clientId },
      { name: 'RESEARCH_RESOURCE', value: scope },
    ];
    pod.spec.volumes = [{ name: 'token', projected: { sources: [{ serviceAccountToken: { path: 'token', audience: 'api://AzureADTokenExchange', expirationSeconds: 3600 } }] } }];
    pod.spec.containers[0].volumeMounts = [{ name: 'token', mountPath: '/var/run/research', readOnly: true }];
    const exchange = () => {
      const result = context.kube(namespaced(context, ['exec', 'exchange', '--', 'python', '-c', tokenExchangeProgram]));
      let outcome: any;
      try { outcome = JSON.parse(result.stdout.trim()); } catch { throw new Error('Credential probe did not return a sanitized outcome'); }
      return { exitStatus: result.status, outcome };
    };
    const success = async () => {
      let result: ReturnType<typeof exchange> | undefined;
      await context.poll(() => { result = exchange(); context.save('exchange-attempt', result); return result.exitStatus === 0 && result.outcome.status === 200 && result.outcome.resource_id.toLowerCase() === scope.toLowerCase(); }, 'Federated identity authorized read');
      return result;
    };
    await context.phase('baseline', async () => {
      credential(issuer); context.create('exchange-pod', pod); await readyPod(context, 'exchange');
      return { issuer, subject: `system:serviceaccount:${context.namespace}:exchange`, probe: await success() };
    });
    await context.phase('fault', async () => {
      removeCredential(); credential(issuer.slice(0, -1));
      const actual = context.az(['identity', 'federated-credential', 'show', '--resource-group', context.resourceGroup, '--identity-name', 'exchange-subject', '--name', 'trial']);
      assert.equal(actual.issuer, issuer.slice(0, -1));
      let failure: ReturnType<typeof exchange> | undefined;
      await context.poll(() => {
        failure = exchange(); context.save('exchange-mismatch-attempt', failure);
        return failure.exitStatus !== 0 && failure.outcome.stage === 'exchange' && failure.outcome.codes?.includes(70021);
      }, 'No matching federated identity record');
      return { publishedIssuer: issuer, configuredIssuer: actual.issuer, probe: failure };
    });
    await context.phase('recovery', async () => { removeCredential(); credential(issuer); return success(); });
  },
};

const nodeKubectlPath: AksEndToEndCase = {
  validate(parameters) {
    requiredParameter(parameters, 'affectedNodeImageVersion', /^[a-zA-Z0-9._-]+$/);
    requiredParameter(parameters, 'hostProbeImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
  },
  async run(context) {
    const nodes = JSON.parse(context.run(['get', 'nodes', '-o', 'json']));
    assert.equal(nodes.items.length, 1);
    const node = nodes.items[0];
    assert.equal(node.metadata.labels?.['kubernetes.azure.com/node-image-version'], context.parameters.affectedNodeImageVersion, 'Affected image unavailable');
    assert.ok(node.status.conditions.some((condition: any) => condition.type === 'Ready' && condition.status === 'True'));
    const pod: any = probePod(context, 'host-path');
    pod.spec.nodeName = node.metadata.name;
    pod.spec.containers[0].image = context.parameters.hostProbeImage;
    pod.spec.containers[0].securityContext = { privileged: true, readOnlyRootFilesystem: true };
    pod.spec.containers[0].volumeMounts = [{ name: 'host', mountPath: '/host', readOnly: true }];
    pod.spec.volumes = [{ name: 'host', hostPath: { path: '/', type: 'Directory' } }];
    const execute = (script: string) => context.kube(namespaced(context, [
      'exec', 'host-path', '--', 'chroot', '/host', '/usr/bin/env', '-i',
      'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', '/bin/sh', '-c', script,
    ]));
    await context.phase('baseline', async () => {
      context.create('host-probe', pod); await readyPod(context, 'host-path');
      const result = execute('/opt/bin/kubectl version --client=true -o json');
      assert.equal(result.status, 0);
      return { node: { name: node.metadata.name, image: context.parameters.affectedNodeImageVersion }, client: JSON.parse(result.stdout) };
    });
    await context.phase('fault', async () => {
      const result = execute('kubectl version --client=true -o json');
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /kubectl.*not found|not found.*kubectl/);
      return { result, path: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' };
    });
    await context.phase('recovery', async () => {
      const result = execute('/opt/bin/kubectl version --client=true -o json'); assert.equal(result.status, 0);
      const current = JSON.parse(context.run(['get', 'node', node.metadata.name, '-o', 'json']));
      assert.ok(current.status.conditions.some((condition: any) => condition.type === 'Ready' && condition.status === 'True'));
      return { client: JSON.parse(result.stdout), nodeReady: true, recovery: 'Explicit executable path; host PATH and kubelet configuration unchanged' };
    });
  },
};

export const aksIdentityEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c025-v1': nodeKubectlPath,
  'aks-c093-v1': issuerSlash,
};