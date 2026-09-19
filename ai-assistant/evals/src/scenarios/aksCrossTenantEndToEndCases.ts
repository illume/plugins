import assert from 'node:assert/strict';
import { devOpsRequest, type OwnedDevOpsProject } from '../cluster/provisioning/aksDevOpsOwnership.js';
import { requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

const crossTenantFlux: AksEndToEndCase = {
  enableOidc: true,
  validate(parameters) {
    requiredParameter(parameters, 'targetSubscription', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
    requiredParameter(parameters, 'devOpsOrganization', /^[a-zA-Z0-9][a-zA-Z0-9-]{1,49}$/);
    for (const field of ['affectedExtensionVersion', 'recoveryExtensionVersion']) requiredParameter(parameters, field, /^\d+\.\d+\.\d+$/);
    for (const field of ['tenantConfigurationKey', 'clientConfigurationKey']) requiredParameter(parameters, field, /^[a-zA-Z][a-zA-Z0-9._-]+$/);
  },
  async run(context) {
    const subscription = context.parameters.targetSubscription!; const organization = context.parameters.devOpsOrganization!;
    const group = context.createSecondaryResourceGroup(subscription);
    const primaryAccount = context.az(['account', 'show']); const other = (args: string[]) => context.secondaryAzure(subscription, args);
    const targetAccount = other(['account', 'show']); assert.notEqual(primaryAccount.tenantId.toLowerCase(), targetAccount.tenantId.toLowerCase(), 'Two distinct authorized tenants required');
    const identity = other(['identity', 'create', '--resource-group', group, '--name', 'flux-target', '--location', context.location, '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const issuer = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']).oidcIssuerProfile.issuerUrl;
    other(['identity', 'federated-credential', 'create', '--resource-group', group, '--identity-name', 'flux-target', '--name', 'source-controller', '--issuer', issuer,
      '--subject', 'system:serviceaccount:flux-system:source-controller', '--audiences', 'api://AzureADTokenExchange']);
    const token = other(['account', 'get-access-token', '--resource', '499b84ac-1321-427f-aa17-267ca6975798']).accessToken;
    assert.ok(typeof token === 'string' && token.length > 0);
    const request = (route: string, method = 'GET', body?: unknown, graph = false) => devOpsRequest(token, organization, route, method, body, graph);
    const owned: OwnedDevOpsProject = { organization, subscription, projectName: `hl-${context.owner}`, principalId: identity.principalId };
    const existing = await request(`/_apis/projects/${owned.projectName}?api-version=7.1`); assert.equal(existing.status, 404, 'Refusing existing DevOps project');
    context.recordDevOpsOwnership(owned);
    await request('/_apis/projects?api-version=7.1', 'POST', { name: owned.projectName, description: `Owned AKS reproduction ${context.owner}`, visibility: 'private',
      capabilities: { versioncontrol: { sourceControlType: 'Git' }, processTemplate: { templateTypeId: '6b724908-ef14-45cf-84f8-768b5384da45' } } });
    let project: any;
    for (let attempt = 0; attempt < 60; attempt++) { const response = await request(`/_apis/projects/${owned.projectName}?api-version=7.1`); if (response.body?.state === 'wellFormed') { project = response.body; break; } await context.wait(5000); }
    assert.ok(project?.id, 'Owned DevOps project did not finish creation'); owned.projectId = project.id; context.recordDevOpsOwnership(owned);
    const repos = await request(`/${project.id}/_apis/git/repositories?api-version=7.1`); assert.equal(repos.body.value.length, 1); const repo = repos.body.value[0];
    const push = await request(`/${project.id}/_apis/git/repositories/${repo.id}/pushes?api-version=7.1`, 'POST', {
      refUpdates: [{ name: 'refs/heads/main', oldObjectId: '0'.repeat(40) }], commits: [{ comment: 'Owned reproduction fixture', changes: [{ changeType: 'add', item: { path: '/fixture.yaml' },
        newContent: { content: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: harmless-source\ndata:\n  sample: owned\n', contentType: 'rawtext' } }] }] });
    const commit = push.body.commits?.[0]?.commitId; assert.ok(commit);
    const principal = await request('/_apis/graph/serviceprincipals?api-version=7.1-preview.1', 'POST', { originId: identity.principalId }, true);
    owned.principalDescriptor = principal.body.descriptor; context.recordDevOpsOwnership(owned);
    const descriptor = await request(`/_apis/graph/descriptors/${project.id}?api-version=7.1-preview.1`, 'GET', undefined, true);
    const groups = await request(`/_apis/graph/groups?scopeDescriptor=${encodeURIComponent(descriptor.body.value)}&api-version=7.1-preview.1`, 'GET', undefined, true);
    const readers = groups.body.value.find((item: any) => item.displayName === 'Readers'); assert.ok(readers);
    await request(`/_apis/graph/memberships/${encodeURIComponent(owned.principalDescriptor!)}/${encodeURIComponent(readers.descriptor)}?api-version=7.1-preview.1`, 'PUT', {}, true);
    const settings = [`${context.parameters.tenantConfigurationKey}=${targetAccount.tenantId}`, `${context.parameters.clientConfigurationKey}=${identity.clientId}`];
    const install = (version: string) => context.az(['k8s-extension', 'create', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', 'flux',
      '--extension-type', 'microsoft.flux', '--version', version, '--auto-upgrade-minor-version', 'false', '--configuration-settings', ...settings]);
    const source = () => JSON.parse(context.run(['-n', 'flux-system', 'get', 'gitrepository', 'owned-source', '-o', 'json']));
    const ready = () => { const value = source(); return value.status?.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'True') && value.status?.artifact?.revision?.includes(commit); };
    const reconcile = () => context.run(['-n', 'flux-system', 'annotate', 'gitrepository/owned-source', `reconcile.fluxcd.io/requestedAt=${Date.now()}`, '--overwrite']);
    await context.phase('baseline', async () => {
      install(context.parameters.recoveryExtensionVersion!);
      context.create('owned-git-source', { apiVersion: 'source.toolkit.fluxcd.io/v1', kind: 'GitRepository', metadata: { name: 'owned-source', namespace: 'flux-system' }, spec: {
        interval: '10s', url: repo.remoteUrl, provider: 'azure', ref: { branch: 'main' } } });
      await context.poll(ready, 'Private target-tenant repository fetch using working Flux'); return { source: source(), repository: repo.id, intendedTenant: targetAccount.tenantId, scope: 'Working cross-tenant release control, not a separate same-tenant deployment' };
    });
    await context.phase('fault', async () => {
      context.az(['k8s-extension', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', 'flux', '--version', context.parameters.affectedExtensionVersion!]); reconcile();
      let evidence: unknown;
      await context.poll(() => {
        const pods = JSON.parse(context.run(['-n', 'flux-system', 'get', 'pods', '-l', 'app=source-controller', '-o', 'json']));
        const tenantIds = pods.items.flatMap((pod: any) => pod.spec.containers.flatMap((container: any) => (container.env ?? []).filter((variable: any) => variable.name === 'AZURE_TENANT_ID').map((variable: any) => variable.value)));
        const actual = source(); const wrongTenant = tenantIds.includes(primaryAccount.tenantId);
        evidence = { source: actual, tenantIds, intendedTenant: targetAccount.tenantId }; context.save('cross-tenant-propagation', evidence);
        return wrongTenant && actual.status?.conditions?.some((condition: any) => condition.type === 'Ready' && condition.status === 'False' && /auth|credential|tenant|AADSTS/i.test(condition.message ?? ''));
      }, 'Wrong tenant metadata and real repository authentication failure'); return evidence;
    });
    await context.phase('recovery', async () => {
      context.az(['k8s-extension', 'update', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--cluster-type', 'managedClusters', '--name', 'flux', '--version', context.parameters.recoveryExtensionVersion!, '--configuration-settings', ...settings]);
      reconcile(); await context.poll(ready, 'Restored cross-tenant repository access'); return source();
    });
  },
};

export const aksCrossTenantEndToEndCases: Record<string, AksEndToEndCase> = { 'aks-c037-v1': crossTenantFlux };