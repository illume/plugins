import assert from 'node:assert/strict';
import type { CommandRunner } from '../commandRunner.js';

export interface OwnedDevOpsProject {
  organization: string;
  subscription: string;
  projectName: string;
  principalId: string;
  projectId?: string;
  principalDescriptor?: string;
}

export async function devOpsRequest(token: string, organization: string, route: string, method = 'GET', body?: unknown, graph = false) {
  assert.match(organization, /^[a-zA-Z0-9][a-zA-Z0-9-]{1,49}$/);
  assert.ok(route.startsWith('/') && !route.startsWith('//') && !route.includes('..'));
  const response = await fetch(`https://${graph ? 'vssps.dev.azure.com' : 'dev.azure.com'}/${organization}${route}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return { status: 404, body: null, continuation: null };
  assert.ok(response.ok, `Owned Azure DevOps request failed with HTTP ${response.status}; body withheld`);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, continuation: response.headers.get('x-ms-continuationtoken') };
}

export async function cleanupOwnedDevOpsProject(owner: string, resource: OwnedDevOpsProject, runner: CommandRunner, wait: (ms: number) => Promise<void>) {
  assert.equal(resource.projectName, `hl-${owner}`);
  assert.match(resource.subscription, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  assert.match(resource.principalId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
  const result = runner('az', ['account', 'get-access-token', '--subscription', resource.subscription, '--resource', '499b84ac-1321-427f-aa17-267ca6975798', '--only-show-errors', '-o', 'json']);
  assert.equal(result.status, 0, 'Target-tenant Azure DevOps cleanup authorization unavailable');
  const token = JSON.parse(result.stdout).accessToken; assert.ok(typeof token === 'string' && token.length > 0);
  const read = () => devOpsRequest(token, resource.organization, `/_apis/projects/${encodeURIComponent(resource.projectName)}?api-version=7.1`);
  const project = await read();
  if (project.status !== 404) {
    assert.equal(project.body.name, resource.projectName); assert.equal(project.body.description, `Owned AKS reproduction ${owner}`);
    if (resource.projectId) assert.equal(project.body.id, resource.projectId);
    await devOpsRequest(token, resource.organization, `/_apis/projects/${project.body.id}?api-version=7.1`, 'DELETE');
    let absent = false;
    for (let attempt = 0; attempt < 60; attempt++) { if ((await read()).status === 404) { absent = true; break; } await wait(5000); }
    assert.ok(absent, 'Owned Azure DevOps project remains');
  }
  if (resource.principalDescriptor) {
    const principal = await devOpsRequest(token, resource.organization, `/_apis/graph/serviceprincipals/${encodeURIComponent(resource.principalDescriptor)}?api-version=7.1-preview.1`, 'GET', undefined, true);
    if (principal.status !== 404) {
      assert.equal(principal.body.originId.toLowerCase(), resource.principalId.toLowerCase());
      await devOpsRequest(token, resource.organization, `/_apis/graph/serviceprincipals/${encodeURIComponent(resource.principalDescriptor)}?api-version=7.1-preview.1`, 'DELETE', undefined, true);
    }
  } else {
    let continuation: string | null = null;
    for (let page = 0; page < 20; page++) {
      const result = await devOpsRequest(token, resource.organization, `/_apis/graph/serviceprincipals?api-version=7.1-preview.1${continuation ? `&continuationToken=${encodeURIComponent(continuation)}` : ''}`, 'GET', undefined, true);
      const principal = result.body?.value?.find((item: any) => item.originId?.toLowerCase() === resource.principalId.toLowerCase());
      if (principal) await devOpsRequest(token, resource.organization, `/_apis/graph/serviceprincipals/${encodeURIComponent(principal.descriptor)}?api-version=7.1-preview.1`, 'DELETE', undefined, true);
      continuation = result.continuation;
      if (!continuation) break;
      assert.ok(page < 19, 'Cannot finish owned principal inventory within page budget');
    }
  }
}