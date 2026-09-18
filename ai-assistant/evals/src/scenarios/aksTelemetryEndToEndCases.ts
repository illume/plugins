import assert from 'node:assert/strict';
import { chmodSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { metadata, requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

const auditTruncation: AksEndToEndCase = {
  validate(parameters) {
    requiredParameter(parameters, 'auditLargeBytes', /^(32768|49152|65536)$/);
    requiredParameter(parameters, 'recoveryKubernetesVersion', /^1\.\d+\.\d+$/);
  },
  async run(context) {
    const account = `audit${context.owner.replaceAll('-', '').slice(0, 19)}`;
    const storage = context.az(['storage', 'account', 'create', '--name', account, '--resource-group', context.resourceGroup,
      '--location', context.location, '--sku', 'Standard_LRS', '--kind', 'StorageV2', '--https-only', 'true',
      '--allow-blob-public-access', 'false', '--min-tls-version', 'TLS1_2', '--tags', `headlamp-e2e-owner=${context.owner}`]);
    const categories = context.az(['monitor', 'diagnostic-settings', 'categories', 'list', '--resource', context.clusterId]);
    assert.ok(categories.value?.some((category: any) => category.name === 'kube-audit'), 'Audit category unavailable');
    context.az(['monitor', 'diagnostic-settings', 'create', '--name', 'research-audit', '--resource', context.clusterId,
      '--storage-account', storage.id, '--logs', JSON.stringify([{ category: 'kube-audit', enabled: true }])]);
    const key = context.az(['storage', 'account', 'keys', 'list', '--resource-group', context.resourceGroup, '--account-name', account])[0]?.value;
    assert.ok(typeof key === 'string' && key.length > 0);
    const storageArgs = ['--account-name', account, '--account-key', key];
    let serial = 0;
    const capture = (name: string) => {
      const exists = context.az(['storage', 'container', 'exists', '--name', 'insights-logs-kube-audit', ...storageArgs]);
      if (!exists.exists) return [];
      const blobs = context.az(['storage', 'blob', 'list', '--container-name', 'insights-logs-kube-audit', '--num-results', '100', ...storageArgs]);
      assert.ok(blobs.length <= 100, 'Audit blob budget exceeded');
      const matching: Array<{ blob: string; inner: string; parsed: unknown | null }> = [];
      for (const blob of blobs) {
        assert.ok(blob.properties?.contentLength <= 4 * 1024 * 1024, 'Audit blob exceeds capture budget');
        const file = path.join(context.artifactDirectory, `audit-export-${++serial}.jsonl`);
        context.az(['storage', 'blob', 'download', '--container-name', 'insights-logs-kube-audit', '--name', blob.name,
          '--file', file, '--overwrite', 'true', ...storageArgs]);
        chmodSync(file, 0o600);
        for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
          const outer = JSON.parse(line);
          const records = Array.isArray(outer.records) ? outer.records : [outer];
          for (const record of records) {
            const inner = record.properties?.log;
            if (typeof inner !== 'string' || !inner.includes(context.namespace) || !inner.includes(name)) continue;
            let parsed: unknown | null = null;
            try { parsed = JSON.parse(inner); } catch {}
            matching.push({ blob: blob.name, inner, parsed });
          }
        }
      }
      context.save(`audit-${name}-matched`, matching); return matching;
    };
    const operation = (name: string, bytes: number) => context.create(`audit-request-${name}`, {
      apiVersion: 'v1', kind: 'ConfigMap', metadata: metadata(context, name), data: { marker: `trial-${context.owner}`, payload: 'x'.repeat(bytes) },
    });
    const validRecord = (records: ReturnType<typeof capture>, name: string, bytes: number) => records.find(item => {
      const event = item.parsed as any;
      return event?.verb === 'create' && event.objectRef?.name === name && event.requestObject?.data?.payload?.length === bytes;
    });
    await context.phase('baseline', async () => {
      operation('small-control', 256); let control: ReturnType<typeof capture> = [];
      await context.poll(() => { control = capture('small-control'); return !!validRecord(control, 'small-control', 256); }, 'Small exported audit event');
      return control;
    });
    await context.phase('fault', async () => {
      const bytes = Number(context.parameters.auditLargeBytes); operation('large-subject', bytes);
      let records: ReturnType<typeof capture> = [];
      await context.poll(() => {
        records = capture('large-subject');
        return records.some(record => record.parsed === null && Buffer.byteLength(record.inner, 'utf8') >= 15 * 1024 && Buffer.byteLength(record.inner, 'utf8') <= 17 * 1024);
      }, 'Invalid inner audit JSON near source truncation boundary');
      assert.ok(!validRecord(records, 'large-subject', bytes), 'Complete large event also exported; truncation attribution ambiguous');
      return { requestedBytes: bytes, records };
    });
    await context.phase('recovery', async () => {
      context.az(['aks', 'upgrade', '--resource-group', context.resourceGroup, '--name', 'research', '--kubernetes-version', context.parameters.recoveryKubernetesVersion!, '--yes']);
      const cluster = context.az(['aks', 'show', '--resource-group', context.resourceGroup, '--name', 'research']);
      assert.equal(cluster.currentKubernetesVersion ?? cluster.kubernetesVersion, context.parameters.recoveryKubernetesVersion);
      const bytes = Number(context.parameters.auditLargeBytes); operation('large-recovery', bytes);
      let records: ReturnType<typeof capture> = [];
      await context.poll(() => { records = capture('large-recovery'); return !!validRecord(records, 'large-recovery', bytes); }, 'Complete large audit event after supported upgrade');
      return { clusterVersion: cluster.currentKubernetesVersion, records };
    });
  },
};

export const aksTelemetryEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c008-v1': auditTruncation,
};