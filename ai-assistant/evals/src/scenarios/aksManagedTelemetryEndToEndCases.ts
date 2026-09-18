import assert from 'node:assert/strict';
import { metadata, namespaced, probePod, readyPod, requiredParameter, type AksCaseContext, type AksEndToEndCase } from './aksEndToEndCases.js';

async function monitored(context: AksCaseContext) {
  const workspace = context.az(['monitor', 'log-analytics', 'workspace', 'create', '--resource-group', context.resourceGroup, '--workspace-name', 'telemetry', '--location', context.location,
    '--retention-time', '30', '--tags', `headlamp-e2e-owner=${context.owner}`]);
  context.az(['aks', 'enable-addons', '--resource-group', context.resourceGroup, '--name', 'research', '--addons', 'monitoring', '--workspace-resource-id', workspace.id]);
  context.az(['monitor', 'diagnostic-settings', 'create', '--name', 'research', '--resource', context.clusterId, '--workspace', workspace.id, '--export-to-resource-specific', 'true',
    '--logs', JSON.stringify([{ category: 'kube-scheduler', enabled: true }])]);
  const query = (kql: string) => context.az(['monitor', 'log-analytics', 'query', '--workspace', workspace.customerId, '--analytics-query', kql]);
  return { workspace, query };
}

const napLogs: AksEndToEndCase = {
  validate(parameters) { requiredParameter(parameters, 'napCategory', /^karpenter-(?:events|nodes|controllers)$/); requiredParameter(parameters, 'observationSeconds', /^(60|120|180|300)$/); },
  async run(context) {
    const { workspace, query } = await monitored(context);
    const category = context.parameters.napCategory!;
    context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'research', '--node-provisioning-mode', 'Auto']);
    context.az(['monitor', 'diagnostic-settings', 'create', '--name', 'research', '--resource', context.clusterId, '--workspace', workspace.id, '--export-to-resource-specific', 'true',
      '--logs', JSON.stringify([{ category: 'kube-scheduler', enabled: true }, { category, enabled: true }])]);
    const scheduler = () => query(`AKSControlPlane | where TimeGenerated > ago(20m) | where _ResourceId =~ '${context.clusterId}' and Category == 'kube-scheduler' | take 20`);
    const nap = () => query(`AKSControlPlane | where TimeGenerated > ago(20m) | where _ResourceId =~ '${context.clusterId}' and Category == '${category}' | take 20`);
    await context.phase('baseline', async () => {
      context.create('control', probePod(context, 'control')); await readyPod(context, 'control');
      let rows: any; await context.poll(() => { rows = scheduler(); return Array.isArray(rows) && rows.length > 0; }, 'Scheduler logs arrive at same destination'); return rows;
    });
    await context.phase('fault', async () => {
      const spec: any = probePod(context, 'subject'); spec.spec.nodeSelector = { 'kubernetes.azure.com/mode': 'user' };
      context.create('demand', spec); let claims: any;
      await context.poll(() => { claims = JSON.parse(context.run(['get', 'nodeclaims', '-o', 'json'])); return claims.items.length > 0; }, 'Real automatic node provisioning activity');
      const samples = [];
      for (let seconds = 0; seconds < Number(context.parameters.observationSeconds); seconds += 10) {
        const data = nap(); samples.push({ at: new Date().toISOString(), rows: data });
        assert.ok(Array.isArray(data) && data.length === 0, 'NAP logs appeared; absence not reproduced'); await context.wait(10000);
      }
      const independent = JSON.parse(context.run(['get', 'events', '-A', '-o', 'json'])).items.filter((event: any) => /karpenter|nodeclaim/i.test(JSON.stringify(event.source ?? event.reportingController ?? '')));
      assert.ok(independent.length > 0); return { claims, independent, samples, scheduler: scheduler() };
    });
    await context.phase('recovery', async () => {
      const claims = JSON.parse(context.run(['get', 'nodeclaims', '-o', 'json']));
      const events = JSON.parse(context.run(['get', 'events', '-A', '-o', 'json'])).items.filter((event: any) => event.involvedObject?.kind === 'NodeClaim');
      assert.ok(claims.items.length > 0 && events.length > 0);
      return { claims, events, recovery: 'Supported direct NodeClaim/event observation, not a claim that Azure diagnostic export was repaired' };
    });
  },
};

const dnsMetric: AksEndToEndCase = {
  networkDataplane: 'cilium', enableAcns: true,
  validate(parameters) { requiredParameter(parameters, 'metricsPort', /^[0-9]{2,5}$/); assert.ok(Number(parameters.metricsPort) <= 65535); requiredParameter(parameters, 'ciliumImage', /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/); },
  async run(context) {
    context.create('client', probePod(context, 'client')); await readyPod(context, 'client');
    const nodeName = context.read('pod', 'client').spec.nodeName;
    const agent = JSON.parse(context.run(['-n', 'kube-system', 'get', 'pods', '-l', 'k8s-app=cilium', '-o', 'json'])).items.find((pod: any) => pod.spec.nodeName === nodeName);
    assert.ok(agent?.spec.containers.some((container: any) => container.image === context.parameters.ciliumImage));
    context.create('dns-policy', { apiVersion: 'cilium.io/v2', kind: 'CiliumNetworkPolicy', metadata: metadata(context, 'dns'), spec: {
      endpointSelector: {}, egress: [{ toEndpoints: [{ matchLabels: { 'k8s:io.kubernetes.pod.namespace': 'kube-system', 'k8s:k8s-app': 'kube-dns' } }],
        toPorts: [{ ports: [{ port: '53', protocol: 'ANY' }], rules: { dns: [{ matchPattern: '*' }] } }] }] } });
    const query = () => context.kube(namespaced(context, ['exec', 'client', '--', 'nslookup', 'kubernetes.default.svc.cluster.local']));
    const metrics = () => context.run(namespaced(context, ['exec', 'client', '--', 'wget', '-q', '-T', '5', '-O', '-', `http://${agent.status.podIP}:${context.parameters.metricsPort}/metrics`]));
    const count = (text: string) => text.split('\n').filter(line => line.startsWith('hubble_dns_queries_total')).reduce((sum, line) => sum + Number(line.trim().split(/\s+/).at(-1)), 0);
    let baseline = 0;
    await context.phase('baseline', async () => { assert.equal(query().status, 0); const text = metrics(); assert.ok(text.includes('hubble_dns_queries_total')); baseline = count(text); return { metrics: text, query: query() }; });
    await context.phase('fault', async () => {
      for (let index = 0; index < 5; index++) assert.equal(query().status, 0);
      let text = ''; await context.poll(() => { text = metrics(); return count(text) > baseline; }, 'DNS counter increments for owned queries');
      const series = text.split('\n').filter(line => line.startsWith('hubble_dns_queries_total'));
      assert.ok(series.length > 0 && series.every(line => !/\bquery=/.test(line))); return { series, baseline, observed: count(text) };
    });
    await context.phase('recovery', async () => {
      assert.equal(query().status, 0);
      const flows = context.kube(['-n', 'kube-system', 'exec', agent.metadata.name, '-c', 'cilium-agent', '--', 'hubble', 'observe', '--protocol', 'dns', '--last', '20', '-o', 'json']);
      assert.equal(flows.status, 0); assert.match(flows.stdout, /kubernetes\.default\.svc\.cluster\.local/);
      return { flows: flows.stdout, recovery: 'Query detail from real DNS flow observations; metric schema unchanged' };
    });
  },
};

const prometheusTargets: AksEndToEndCase = {
  validate(parameters) {
    requiredParameter(parameters, 'controlMetric', /^[a-zA-Z_:][a-zA-Z0-9_:]+$/); requiredParameter(parameters, 'targetMetric', /^[a-zA-Z_:][a-zA-Z0-9_:]+$/);
    for (const name of ['affectedMetricsData', 'recoveryMetricsData']) {
      const data = JSON.parse(requiredParameter(parameters, name, /^\{.*\}$/s));
      assert.ok(data && !Array.isArray(data) && Object.values(data).every(value => typeof value === 'string'));
    }
    requiredParameter(parameters, 'ingestionWindowSeconds', /^(60|120|180|300)$/);
  },
  async run(context) {
    const resource = context.az(['resource', 'create', '--resource-group', context.resourceGroup, '--name', 'prometheus', '--resource-type', 'Microsoft.Monitor/accounts',
      '--api-version', '2023-04-03', '--location', context.location, '--properties', '{}', '--tags', `headlamp-e2e-owner=${context.owner}`]);
    context.az(['aks', 'update', '--resource-group', context.resourceGroup, '--name', 'research', '--enable-azure-monitor-metrics', '--azure-monitor-workspace-resource-id', resource.id]);
    const properties = context.az(['resource', 'show', '--ids', resource.id, '--api-version', '2023-04-03']);
    const endpoint = properties.properties?.metrics?.prometheusQueryEndpoint; assert.ok(typeof endpoint === 'string' && new URL(endpoint).protocol === 'https:');
    const query = (metric: string) => context.az(['rest', '--method', 'get', '--url', `${endpoint.replace(/\/$/, '')}/api/v1/query?query=${encodeURIComponent(metric)}`, '--resource', 'https://prometheus.monitor.azure.com']);
    const values = (metric: string) => { const response = query(metric); assert.equal(response.status, 'success'); assert.ok(Array.isArray(response.data?.result)); return response.data.result; };
    const configure = (parameter: string) => {
      const existing = context.kube(['-n', 'kube-system', 'get', 'configmap', 'ama-metrics-settings-configmap', '-o', 'json']);
      const config = existing.status === 0 ? JSON.parse(existing.stdout) : { apiVersion: 'v1', kind: 'ConfigMap', metadata: { name: 'ama-metrics-settings-configmap', namespace: 'kube-system' } };
      config.data = JSON.parse(context.parameters[parameter]!);
      if (existing.status === 0) context.replace(parameter, config); else context.create(parameter, config);
      return config;
    };
    await context.phase('baseline', async () => {
      await context.poll(() => values(context.parameters.controlMetric!).length > 0, 'Managed metric ingestion control');
      return { workspaceId: resource.id, control: values(context.parameters.controlMetric!) };
    });
    await context.phase('fault', async () => {
      const config = configure('affectedMetricsData'); const samples = [];
      for (let seconds = 0; seconds < Number(context.parameters.ingestionWindowSeconds); seconds += 10) {
        const target = values(context.parameters.targetMetric!); assert.equal(target.length, 0, 'Requested target metric present');
        samples.push({ at: new Date().toISOString(), target }); await context.wait(10000);
      }
      assert.ok(values(context.parameters.controlMetric!).length > 0);
      return { config, samples, control: values(context.parameters.controlMetric!), scope: 'Declared supported target only; required settings must be reviewed for this addon version' };
    });
    await context.phase('recovery', async () => {
      const config = configure('recoveryMetricsData'); await context.poll(() => values(context.parameters.targetMetric!).length > 0, 'Supported target collection');
      return { config, target: values(context.parameters.targetMetric!) };
    });
  },
};

const networkAggregation: AksEndToEndCase = {
  networkDataplane: 'cilium', enableAcns: true,
  validate(parameters) {
    requiredParameter(parameters, 'aggregationConfigMap', /^[a-z0-9-]+$/);
    for (const field of ['baselineAggregationData', 'affectedAggregationData', 'recoveryAggregationData']) {
      const data = JSON.parse(requiredParameter(parameters, field, /^\{.*\}$/s)); assert.ok(data && !Array.isArray(data) && Object.values(data).every(value => typeof value === 'string'));
    }
  },
  async run(context) {
    const { workspace, query } = await monitored(context);
    const backend: any = probePod(context, 'backend'); backend.metadata.labels.role = 'backend';
    backend.spec.containers[0].command = ['sh', '-c', 'mkdir -p /tmp/www; echo owned-flow >/tmp/www/index.html; exec httpd -f -p 8080 -h /tmp/www'];
    context.create('backend', backend); context.create('client', probePod(context, 'client')); await readyPod(context, 'backend'); await readyPod(context, 'client');
    const sourceIp = context.read('pod', 'client').status.podIP; const destinationIp = context.read('pod', 'backend').status.podIP;
    const configure = (parameter: string) => {
      const config = JSON.parse(context.run(['-n', 'kube-system', 'get', 'configmap', context.parameters.aggregationConfigMap!, '-o', 'json']));
      config.data = JSON.parse(context.parameters[parameter]!); context.replace(parameter, config); return config;
    };
    const readFlow = (since: string) => query(`ContainerNetworkLogs | where TimeGenerated >= datetime(${since}) | where _ResourceId =~ '${context.clusterId}' | where tostring(KubernetesMetadata) contains '${context.namespace}' | take 100`);
    const traffic = () => { const response = context.run(namespaced(context, ['exec', 'client', '--', 'wget', '-q', '-T', '5', '-O', '-', `http://${destinationIp}:8080/`])); assert.equal(response.trim(), 'owned-flow'); };
    const addresses = (row: any) => { const field = row.Ip ?? row.IP; try { return typeof field === 'string' ? JSON.parse(field) : field ?? {}; } catch { return {}; } };
    const sample = async (name: string, populated: boolean) => {
      const config = configure(name); const startedAt = new Date().toISOString(); let rows: any[] = [];
      await context.poll(() => { traffic(); rows = readFlow(startedAt); context.save(`${name}-logs`, rows); return Array.isArray(rows) && rows.length > 0; }, 'Known flow rows at managed destination');
      if (populated) assert.ok(rows.some(row => addresses(row).source === sourceIp && addresses(row).destination === destinationIp));
      else assert.ok(rows.every(row => !addresses(row).source && !addresses(row).destination) && rows.some(row => addresses(row).version || row.Encryption));
      return { config, rows, sourceIp, destinationIp, startedAt, workspace: workspace.id };
    };
    await context.phase('baseline', () => sample('baselineAggregationData', true));
    await context.phase('fault', () => sample('affectedAggregationData', false));
    await context.phase('recovery', () => sample('recoveryAggregationData', true));
  },
};

export const aksManagedTelemetryEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c013-v1': prometheusTargets,
  'aks-c017-v1': networkAggregation,
  'aks-c020-v1': napLogs,
  'aks-c056-v1': dnsMetric,
};