import assert from 'node:assert/strict';
import { addPool, namespaced, probePod, readyPod, requiredParameter, type AksEndToEndCase } from './aksEndToEndCases.js';

const nodeDnsFallback: AksEndToEndCase = {
  dnsServiceIp: '10.91.0.53', serviceCidr: '10.91.0.0/16',
  validate(parameters) {
    requiredParameter(parameters, 'affectedNodeImageVersion', /^[a-zA-Z0-9._-]+$/); requiredParameter(parameters, 'recoveryNodeImageVersion', /^[a-zA-Z0-9._-]+$/);
    requiredParameter(parameters, 'hostProbeImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
  },
  async run(context) {
    const affected = await addPool(context, 'dnscheck', ['--os-sku', 'Ubuntu']); assert.equal(affected.nodeImageVersion, context.parameters.affectedNodeImageVersion);
    const dns = JSON.parse(context.run(['-n', 'kube-system', 'get', 'service', 'kube-dns', '-o', 'json'])); assert.equal(dns.spec.clusterIP, '10.91.0.53');
    const build = () => {
      const pod: any = probePod(context, 'node-probe'); pod.spec.nodeSelector = { agentpool: 'dnscheck' }; pod.spec.hostPID = true;
      pod.spec.containers[0].image = context.parameters.hostProbeImage; pod.spec.containers[0].securityContext = { privileged: true };
      pod.spec.volumes = [{ name: 'host', hostPath: { path: '/', type: 'Directory' } }]; pod.spec.containers[0].volumeMounts = [{ name: 'host', mountPath: '/host', readOnly: true }];
      context.create('node-probe', pod);
    };
    const journal = () => context.kube(namespaced(context, ['exec', 'node-probe', '--', 'chroot', '/host', 'journalctl', '-u', 'node-problem-detector', '--since', '-5min', '--no-pager', '-n', '100']));
    const query = () => context.kube(namespaced(context, ['exec', 'node-probe', '--', 'nslookup', 'kubernetes.default.svc.cluster.local', dns.spec.clusterIP]));
    await context.phase('baseline', async () => { build(); const pod = await readyPod(context, 'node-probe'); assert.equal(query().status, 0); return { pod, dns, query: query() }; });
    await context.phase('fault', async () => {
      let logs: any;
      await context.poll(() => { logs = journal(); context.save('npd-wrong-dns', logs); return logs.status === 0 && /10\.0\.0\.10/.test(logs.stdout) && /dns|resolve/i.test(logs.stdout) && /fail|timeout|unhealthy/i.test(logs.stdout); }, 'NPD fallback DNS mismatch');
      assert.equal(query().status, 0); return { logs, actualResolver: dns.spec.clusterIP, healthyQuery: query(), nodeImage: affected.nodeImageVersion };
    });
    await context.phase('recovery', async () => {
      context.az(['aks', 'nodepool', 'upgrade', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'dnscheck', '--node-image-only']);
      const updated = context.az(['aks', 'nodepool', 'show', '--resource-group', context.resourceGroup, '--cluster-name', 'research', '--name', 'dnscheck']); assert.equal(updated.nodeImageVersion, context.parameters.recoveryNodeImageVersion);
      context.run(namespaced(context, ['delete', 'pod', 'node-probe', '--ignore-not-found', '--wait=true', '--timeout=90s'])); build(); await readyPod(context, 'node-probe');
      let logs: any;
      await context.poll(() => { logs = journal(); return logs.status === 0 && logs.stdout.includes(dns.spec.clusterIP) && !/10\.0\.0\.10.*(?:fail|timeout)/i.test(logs.stdout); }, 'Corrected NPD resolver evidence');
      assert.equal(query().status, 0); return { updated, logs, query: query() };
    });
  },
};

export const aksNodeDnsEndToEndCases: Record<string, AksEndToEndCase> = { 'aks-c019-v1': nodeDnsFallback };