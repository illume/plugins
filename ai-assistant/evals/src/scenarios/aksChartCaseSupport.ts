import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { requiredParameter, type AksCaseContext } from './aksEndToEndCases.js';

export function chartInput(parameters: Record<string, string>, prefix: string) {
  const archive = requiredParameter(parameters, `${prefix}Archive`, /^\/.+\.tgz$/);
  const digest = requiredParameter(parameters, `${prefix}Sha256`, /^[a-f0-9]{64}$/);
  assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), digest, `${prefix} archive does not match its declared pin`);
  return archive;
}

export function installChart(context: AksCaseContext, release: string, prefix: string, namespace: string, values: unknown, wait = true) {
  const archive = chartInput(context.parameters, prefix);
  const file = path.join(context.artifactDirectory, `${release}-${prefix}-values.json`);
  writeFileSync(file, JSON.stringify(values, null, 2), { mode: 0o600 });
  const result = context.helm(['upgrade', '--install', release, archive, '--namespace', namespace, '--create-namespace',
    '--values', file, '--timeout', '5m', ...(wait ? ['--wait'] : [])]);
  context.save(`${release}-${prefix}-operation`, result);
  assert.equal(result.status, 0, `${release} chart installation failed`);
  return result;
}

export function deployment(context: AksCaseContext, namespace: string, name: string) {
  return JSON.parse(context.run(['-n', namespace, 'get', 'deployment', name, '-o', 'json']));
}

export function deploymentPods(context: AksCaseContext, namespace: string, name: string) {
  const current = deployment(context, namespace, name);
  const labels = Object.entries(current.spec.selector.matchLabels).map(([key, value]) => `${key}=${value}`).join(',');
  return JSON.parse(context.run(['-n', namespace, 'get', 'pods', '-l', labels, '-o', 'json']));
}

export async function available(context: AksCaseContext, namespace: string, name: string) {
  await context.poll(() => {
    const result = context.kube(['-n', namespace, 'get', 'deployment', name, '-o', 'json']);
    if (result.status !== 0) return false;
    const object = JSON.parse(result.stdout);
    return object.status?.observedGeneration >= object.metadata.generation && object.status?.availableReplicas >= (object.spec.replicas ?? 1);
  }, `${namespace}/${name} available`);
  return deployment(context, namespace, name);
}

export function controllerLogs(context: AksCaseContext, namespace: string, name: string) {
  return context.kube(['-n', namespace, 'logs', `deployment/${name}`, '--all-containers=true', '--tail=100']);
}