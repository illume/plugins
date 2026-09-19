import assert from 'node:assert/strict';
import { isIPv4 } from 'node:net';
import yaml from 'js-yaml';
import type { CommandResult } from '../cluster/commandRunner.js';
import { chartInput } from './aksChartCaseSupport.js';
import {
  metadata,
  namespaced,
  probePod,
  readyPod,
  requiredParameter,
  type AksCaseContext,
  type AksEndToEndCase,
} from './aksEndToEndCases.js';

function chartObjects(manifest: string): any[] {
  const objects = yaml
    .loadAll(manifest)
    .filter(object => object !== null && object !== undefined) as any[];
  assert.ok(objects.length > 0, 'Empty chart output is not a compatibility control');
  assert.ok(
    objects.every(
      object =>
        object &&
        typeof object === 'object' &&
        typeof object.apiVersion === 'string' &&
        typeof object.kind === 'string' &&
        object.metadata?.name
    ),
    'Malformed chart object'
  );
  assert.ok(
    objects.every(
      object =>
        object.metadata.name === 'scaphandre' &&
        object.metadata.labels?.['app.kubernetes.io/name'] === 'scaphandre'
    ),
    'Unexpected upstream chart resource identity'
  );
  const allowed = new Set([
    'PodSecurityPolicy',
    'DaemonSet',
    'Service',
    'ServiceAccount',
    'ClusterRole',
    'ClusterRoleBinding',
  ]);
  assert.ok(
    objects.every(
      object => allowed.has(object.kind) && !object.metadata.annotations?.['helm.sh/hook']
    ),
    'Unexpected chart resource kind or hook'
  );
  assert.equal(
    new Set(objects.map(object => `${object.apiVersion}/${object.kind}/${object.metadata.name}`))
      .size,
    objects.length,
    'Duplicate chart object'
  );
  return objects;
}

export function assertScaphandreManifest(
  manifest: string,
  exporterImage: string,
  removedApi: boolean
) {
  const objects = chartObjects(manifest);
  const policies = objects.filter(object => object.kind === 'PodSecurityPolicy');
  if (removedApi) {
    assert.equal(policies.length, 1, 'Affected chart must render the reported PSP');
    assert.equal(policies[0].apiVersion, 'policy/v1beta1');
  } else assert.equal(policies.length, 0, 'Fixed chart still requests removed PSP API');
  const workloads = objects.filter(object => object.kind === 'DaemonSet');
  assert.equal(workloads.length, 1, 'Expected one real exporter DaemonSet');
  const containers = workloads[0].spec?.template?.spec?.containers;
  assert.equal(containers?.length, 1, 'Unexpected exporter containers');
  assert.equal(containers[0].image, exporterImage, 'Chart must use the reviewed exporter digest');
  assert.ok(
    !objects.some(object => object.kind === 'Secret' || object.kind === 'CustomResourceDefinition'),
    'Unexpected secret or CRD in chart'
  );
  return objects.map(object => ({
    apiVersion: object.apiVersion,
    kind: object.kind,
    name: object.metadata.name,
  }));
}

export function assertRemovedPspError(result: CommandResult) {
  assert.notEqual(result.status, 0, 'Affected chart admission unexpectedly succeeded');
  assert.match(
    result.stderr,
    /no matches for kind ["']PodSecurityPolicy["'] in version ["']policy\/v1beta1["']/
  );
  assert.ok(
    !/Unauthorized|Forbidden|connection refused|context .*does not exist/i.test(result.stderr),
    'Unrelated cluster failure is not a removed-API reproduction'
  );
}

function exporterImage(parameters: Record<string, string>) {
  return requiredParameter(
    parameters,
    'exporterImage',
    /^[a-zA-Z0-9./:_-]+:[a-zA-Z0-9._-]+@sha256:[a-f0-9]{64}$/
  );
}

const removedPodSecurityPolicy: AksEndToEndCase = {
  validate(parameters) {
    const affected = chartInput(parameters, 'affectedChart');
    const fixed = chartInput(parameters, 'fixedChart');
    assert.notEqual(affected, fixed, 'Independent affected/fixed chart archives required');
    assert.notEqual(parameters.affectedChartSha256, parameters.fixedChartSha256);
    exporterImage(parameters);
  },
  async run(context) {
    const match = /^1\.(\d+)\.\d+$/.exec(context.kubernetesVersion);
    assert.ok(match && Number(match[1]) >= 25, 'C244 requires Kubernetes after PSP removal');
    const image = exporterImage(context.parameters);
    const imageSeparator = image.lastIndexOf(':', image.indexOf('@'));
    const repository = image.slice(0, imageSeparator);
    const tagDigest = image.slice(imageSeparator + 1);
    const release = `scaphandre-${context.owner.slice(0, 8)}`;
    const chartArgs = (prefix: string) => [
      release,
      chartInput(context.parameters, prefix),
      '--namespace',
      context.namespace,
      '--set-string',
      `image.name=${repository}`,
      '--set-string',
      `image.tag=${tagDigest}`,
      '--set',
      'serviceMonitor.enabled=false',
    ];
    const operations: Array<{ operation: string; result: CommandResult }> = [];
    const helm = (name: string, args: string[]) => {
      const result = context.helm(args);
      operations.push({ operation: name, result });
      context.save(`psp-${name}`, result);
      return result;
    };
    const noPersistedRelease = () => {
      const releases = helm('release-inventory', [
        'list',
        '--namespace',
        context.namespace,
        '--all',
        '--output',
        'json',
      ]);
      assert.equal(releases.status, 0, 'Helm release inventory unavailable');
      assert.ok(Array.isArray(JSON.parse(releases.stdout)));
      assert.ok(
        !JSON.parse(releases.stdout).some((item: any) => item.name === release),
        'Dry-run unexpectedly persisted a Helm release'
      );
      const namespacedObjects = JSON.parse(
        context.run(
          namespaced(context, [
            'get',
            'daemonsets,pods,services,serviceaccounts,roles,rolebindings',
            '-l',
            'app.kubernetes.io/name=scaphandre',
            '-o',
            'json',
          ])
        )
      );
      const clusterObjects = JSON.parse(
        context.run([
          'get',
          'clusterroles,clusterrolebindings',
          '-l',
          'app.kubernetes.io/name=scaphandre',
          '-o',
          'json',
        ])
      );
      assert.equal(
        namespacedObjects.items.length,
        0,
        'Dry-run unexpectedly persisted workload resources'
      );
      assert.equal(clusterObjects.items.length, 0, 'Dry-run unexpectedly persisted cluster RBAC');
      return { release, persistedObjects: 0 };
    };
    const fixedControl = () => {
      const result = helm('fixed-server-dry-run', [
        'install',
        ...chartArgs('fixedChart'),
        '--dry-run=server',
        '--output',
        'json',
      ]);
      assert.equal(result.status, 0, 'Fixed chart server dry-run failed; not a working control');
      const rendered = JSON.parse(result.stdout);
      assert.equal(typeof rendered.manifest, 'string', 'Helm release manifest missing');
      const resources = assertScaphandreManifest(rendered.manifest, image, false);
      return {
        resources,
        ...noPersistedRelease(),
        scope: 'helm-server-dry-run-only',
        energyMeasured: false,
      };
    };
    await context.phase('baseline', async () => {
      const versions = context.run(['api-versions']).trim().split(/\s+/);
      assert.ok(versions.includes('policy/v1'));
      const resources = JSON.parse(context.run(['get', '--raw', '/apis/policy/v1']));
      assert.ok(Array.isArray(resources.resources));
      assert.ok(!resources.resources.some((item: any) => item.kind === 'PodSecurityPolicy'));
      assert.ok(
        !versions.includes('policy/v1beta1'),
        'Unexpected legacy policy API; do not manufacture a removed-API fault'
      );
      noPersistedRelease();
      context.create('energy-admission-witness', {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: metadata(context, 'energy-admission-witness'),
        data: { sentinel: context.owner },
      });
      assert.equal(
        context.read('configmap', 'energy-admission-witness').data.sentinel,
        context.owner
      );
      return { policyApi: resources, control: fixedControl() };
    });
    await context.phase('fault', async () => {
      const rendered = helm('affected-template', [
        'template',
        ...chartArgs('affectedChart'),
        '--kube-version',
        context.kubernetesVersion,
      ]);
      assert.equal(rendered.status, 0, 'Local chart rendering failed before API mapping');
      const resources = assertScaphandreManifest(rendered.stdout, image, true);
      const result = helm('affected-server-dry-run', [
        'install',
        ...chartArgs('affectedChart'),
        '--dry-run=server',
        '--output',
        'json',
      ]);
      assertRemovedPspError(result);
      assert.equal(
        context.read('configmap', 'energy-admission-witness').data.sentinel,
        context.owner
      );
      return {
        resources,
        result,
        ...noPersistedRelease(),
        faultObserved: true,
        scope: 'removed-api-mapping-not-exporter-runtime',
        energyMeasured: false,
      };
    });
    await context.phase('recovery', async () => {
      const control = fixedControl();
      const witness = context.read('configmap', 'energy-admission-witness');
      assert.equal(witness.metadata.labels['headlamp-e2e-owner'], context.owner);
      context.run(
        namespaced(context, [
          'delete',
          'configmap',
          'energy-admission-witness',
          '--wait=true',
          '--timeout=30s',
        ])
      );
      assert.equal(
        context
          .run(
            namespaced(context, [
              'get',
              'configmap',
              'energy-admission-witness',
              '--ignore-not-found',
              '-o',
              'name',
            ])
          )
          .trim(),
        ''
      );
      return {
        ...control,
        kind: 'fixed-chart-admission-control-not-energy-validation',
        operations: operations.length,
      };
    });
  },
};

export function scaphandreScrapeConfig(address: string, fallback: boolean) {
  assert.ok(isIPv4(address), 'Exporter address must be IPv4');
  return {
    global: { scrape_interval: '3s', scrape_timeout: '2s' },
    scrape_configs: [
      {
        job_name: 'scaphandre',
        metrics_path: '/metrics',
        scheme: 'http',
        static_configs: [{ targets: [`${address}:8080`] }],
        ...(fallback ? { fallback_scrape_protocol: 'PrometheusText0.0.4' } : {}),
      },
    ],
  };
}

export function scaphandreHttpEvidence(result: CommandResult) {
  assert.equal(result.status, 0, 'Exporter HTTP probe failed; no protocol diagnosis');
  const delimiter = '\nC249_HTTP_METADATA\n';
  const boundary = result.stdout.lastIndexOf(delimiter);
  assert.ok(boundary >= 0, 'Missing structured HTTP metadata');
  const metrics = result.stdout.slice(0, boundary);
  const response = JSON.parse(result.stdout.slice(boundary + delimiter.length));
  assert.equal(response.http_code, 200);
  assert.equal(response.exitcode, 0);
  assert.ok(
    typeof response.content_type === 'string' || response.content_type === null,
    'Missing content type metadata'
  );
  assert.match(
    metrics,
    /^scaph_host_power_microwatts(?:\{[^\n]*\})?\s+\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?:\s|$)/m,
    'Real host power series absent; sensor availability or exporter health is unresolved'
  );
  return {
    httpCode: response.http_code,
    contentType: response.content_type,
    hostMetricPresent: true,
    measurementValidity: 'not-assessed',
    energyMeasured: false,
  };
}

export function scaphandreTargetEvidence(payload: any, address: string) {
  assert.equal(payload?.status, 'success');
  const targets = payload.data?.activeTargets;
  assert.ok(
    Array.isArray(targets) && targets.length === 1,
    'Expected exactly one observed scrape target'
  );
  const target = targets[0];
  assert.equal(target.scrapeUrl, `http://${address}:8080/metrics`);
  assert.equal(target.labels?.job, 'scaphandre');
  assert.ok(['up', 'down', 'unknown'].includes(target.health));
  assert.equal(typeof target.lastError, 'string');
  assert.ok(
    typeof target.lastScrape === 'string' && Number.isFinite(Date.parse(target.lastScrape)),
    'Invalid scrape timestamp'
  );
  const completed = Date.parse(target.lastScrape) > 0;
  assert.ok(completed || target.health === 'unknown', 'No completed scrape observation');
  return {
    health: target.health,
    lastError: target.lastError,
    lastScrape: target.lastScrape,
    scrapeUrl: target.scrapeUrl,
    completed,
  };
}

const missingScrapeContentType: AksEndToEndCase = {
  validate(parameters) {
    for (const field of ['exporterImage', 'prometheusImage'])
      requiredParameter(parameters, field, /^[a-zA-Z0-9./:_-]+@sha256:[a-f0-9]{64}$/);
    requiredParameter(parameters, 'prometheusVersion', /^3\.0\.0$/);
    requiredParameter(parameters, 'nodeImageVersion', /^AKSUbuntu-[a-zA-Z0-9._-]+$/);
    requiredParameter(parameters, 'acceptReadOnlyHostMetrics', /^true$/);
  },
  async run(context) {
    const nodes = JSON.parse(context.run(['get', 'nodes', '-o', 'json']));
    assert.equal(nodes.items.length, 1);
    assert.equal(
      nodes.items[0].metadata.labels['kubernetes.azure.com/node-image-version'],
      context.parameters.nodeImageVersion
    );
    let exporter: any;
    let address = '';
    let sequence = 0;
    const curl = (url: string, extra: string[] = []) =>
      context.kube(
        namespaced(context, [
          'exec',
          'client',
          '--',
          'curl',
          '--silent',
          '--show-error',
          '--fail',
          '--max-time',
          '8',
          '--noproxy',
          '*',
          ...extra,
          url,
        ])
      );
    const sameExporter = () => {
      const current = context.read('pod', 'scaphandre');
      assert.equal(current.metadata.uid, exporter.metadata.uid);
      assert.deepEqual(
        current.status.containerStatuses.map((item: any) => ({
          imageID: item.imageID,
          restartCount: item.restartCount,
        })),
        exporter.status.containerStatuses.map((item: any) => ({
          imageID: item.imageID,
          restartCount: item.restartCount,
        })),
        'Exporter restarted or changed during comparison'
      );
      return current;
    };
    const http = () => {
      sameExporter();
      const evidence = scaphandreHttpEvidence(
        curl(`http://${address}:8080/metrics`, ['--write-out', '\nC249_HTTP_METADATA\n%{json}'])
      );
      assert.ok(
        evidence.contentType === null || evidence.contentType.trim() === '',
        'Source missing Content-Type symptom is not present'
      );
      context.save(`scrape-http-${++sequence}`, evidence);
      return evidence;
    };
    const scraper = async (name: string, fallback: boolean) => {
      context.create(`${name}-config`, {
        apiVersion: 'v1',
        kind: 'ConfigMap',
        metadata: metadata(context, `${name}-config`),
        data: { 'prometheus.yml': yaml.dump(scaphandreScrapeConfig(address, fallback)) },
      });
      context.create(`${name}-pod`, {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: metadata(context, name),
        spec: {
          automountServiceAccountToken: false,
          restartPolicy: 'Never',
          securityContext: { runAsUser: 65534, runAsGroup: 65534, fsGroup: 65534 },
          containers: [
            {
              name: 'prometheus',
              image: context.parameters.prometheusImage,
              args: [
                '--config.file=/config/prometheus.yml',
                '--storage.tsdb.path=/prometheus',
                '--storage.tsdb.retention.time=15m',
                '--storage.tsdb.retention.size=32MB',
              ],
              securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] } },
              readinessProbe: { httpGet: { path: '/-/ready', port: 9090 }, periodSeconds: 2 },
              resources: {
                requests: { cpu: '50m', memory: '128Mi' },
                limits: { cpu: '500m', memory: '512Mi' },
              },
              volumeMounts: [
                { name: 'config', mountPath: '/config', readOnly: true },
                { name: 'data', mountPath: '/prometheus' },
              ],
            },
          ],
          volumes: [
            { name: 'config', configMap: { name: `${name}-config` } },
            { name: 'data', emptyDir: { sizeLimit: '64Mi' } },
          ],
        },
      });
      const pod = await readyPod(context, name);
      const version = curl(`http://${pod.status.podIP}:9090/api/v1/status/buildinfo`);
      assert.equal(version.status, 0);
      const response = JSON.parse(version.stdout);
      assert.equal(response.status, 'success');
      assert.equal(
        response.data?.version,
        context.parameters.prometheusVersion,
        'Prometheus version pin mismatch'
      );
      return pod;
    };
    const target = (pod: any) => {
      sameExporter();
      const current = context.read('pod', pod.metadata.name);
      assert.equal(current.metadata.uid, pod.metadata.uid, 'Scraper was replaced');
      assert.deepEqual(
        current.status.containerStatuses.map((item: any) => ({
          imageID: item.imageID,
          restartCount: item.restartCount,
        })),
        pod.status.containerStatuses.map((item: any) => ({
          imageID: item.imageID,
          restartCount: item.restartCount,
        })),
        'Scraper restarted or changed during comparison'
      );
      const result = curl(`http://${pod.status.podIP}:9090/api/v1/targets`);
      assert.equal(result.status, 0, 'Prometheus target API unavailable');
      const evidence = scaphandreTargetEvidence(JSON.parse(result.stdout), address);
      context.save(`scrape-target-${++sequence}`, { scraper: pod.metadata.name, ...evidence });
      return evidence;
    };
    const healthy = async (pod: any) => {
      await context.poll(() => {
        const evidence = target(pod);
        return evidence.completed && evidence.health === 'up' && evidence.lastError === '';
      }, 'Fallback scraper successfully parses exporter metrics');
      return target(pod);
    };
    let control: any;
    let subject: any;
    await context.phase('baseline', async () => {
      context.create('scaphandre-pod', {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: metadata(context, 'scaphandre'),
        spec: {
          automountServiceAccountToken: false,
          restartPolicy: 'Never',
          containers: [
            {
              name: 'exporter',
              image: context.parameters.exporterImage,
              command: ['/usr/local/bin/scaphandre'],
              args: ['prometheus', '--address', '0.0.0.0', '--port', '8080'],
              securityContext: {
                runAsUser: 0,
                allowPrivilegeEscalation: false,
                capabilities: { drop: ['ALL'] },
              },
              readinessProbe: { httpGet: { path: '/metrics', port: 8080 }, periodSeconds: 2 },
              resources: {
                requests: { cpu: '50m', memory: '64Mi' },
                limits: { cpu: '200m', memory: '256Mi' },
              },
              volumeMounts: [
                { name: 'proc', mountPath: '/proc', readOnly: true },
                { name: 'sys', mountPath: '/sys', readOnly: true },
              ],
            },
          ],
          volumes: [
            { name: 'proc', hostPath: { path: '/proc', type: 'Directory' } },
            { name: 'sys', hostPath: { path: '/sys', type: 'Directory' } },
          ],
        },
      });
      context.create('scrape-client', probePod(context, 'client'));
      exporter = await readyPod(context, 'scaphandre');
      address = exporter.status.podIP;
      await readyPod(context, 'client');
      const sensor = context.kube(
        namespaced(context, [
          'exec',
          'scaphandre',
          '-c',
          'exporter',
          '--',
          '/bin/sh',
          '-c',
          'for counter in /sys/class/powercap/*/energy_uj /sys/class/powercap/*/*/energy_uj; do ' +
            'if [ -r "$counter" ]; then value=$(cat "$counter") || continue; ' +
            'case "$value" in ""|*[!0-9]*) continue;; esac; printf "readable-rapl-counter\\n"; exit 0; fi; done; exit 1',
        ])
      );
      assert.equal(
        sensor.status,
        0,
        'No readable RAPL energy source; this environment cannot qualify the energy-exporter experiment'
      );
      assert.equal(sensor.stdout.trim(), 'readable-rapl-counter');
      context.save('sensor-preflight', {
        readableRaplCounter: true,
        measurementValidity: 'not-assessed',
        energyMeasured: false,
      });
      const response = http();
      control = await scraper('control', true);
      return {
        response,
        control: await healthy(control),
        node: nodes.items[0],
        scope: 'scrape-compatibility-only',
        energyMeasured: false,
      };
    });
    await context.phase('fault', async () => {
      subject = await scraper('subject', false);
      const isMissingHeader = (evidence: ReturnType<typeof target>) =>
        evidence.completed &&
        evidence.health === 'down' &&
        /content.?type/i.test(evidence.lastError) &&
        /blank|missing|empty/i.test(evidence.lastError);
      await context.poll(
        () => isMissingHeader(target(subject)),
        'Strict Prometheus target rejects absent Content-Type'
      );
      const samples = [];
      let previous = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        let evidence = target(subject);
        await context.poll(() => {
          evidence = target(subject);
          return evidence.lastScrape !== previous;
        }, 'Next completed strict scrape');
        assert.ok(isMissingHeader(evidence), 'Unrelated scrape failure cannot reproduce C249');
        previous = evidence.lastScrape;
        samples.push(evidence);
        http();
        await healthy(control);
      }
      return {
        faultObserved: true,
        samples,
        exporterUid: exporter.metadata.uid,
        scope: 'header-contract-not-energy-validity',
      };
    });
    await context.phase('recovery', async () => {
      const current = context.read('pod', 'subject');
      assert.equal(current.metadata.uid, subject.metadata.uid);
      assert.equal(current.metadata.labels['headlamp-e2e-owner'], context.owner);
      context.run(
        namespaced(context, ['delete', 'pod', 'subject', '--wait=true', '--timeout=60s'])
      );
      const config = context.read('configmap', 'subject-config');
      assert.equal(config.metadata.labels['headlamp-e2e-owner'], context.owner);
      context.run(
        namespaced(context, [
          'delete',
          'configmap',
          'subject-config',
          '--wait=true',
          '--timeout=30s',
        ])
      );
      const recovered = await scraper('subject', true);
      assert.notEqual(
        recovered.metadata.uid,
        subject.metadata.uid,
        'Recovery must be an explicit replacement scraper'
      );
      return {
        kind: 'scoped-fallback-protocol-and-scraper-replacement',
        recovered: await healthy(recovered),
        control: await healthy(control),
        response: http(),
        energyMeasured: false,
      };
    });
  },
};

export const aksEnergyEndToEndCases: Record<string, AksEndToEndCase> = {
  'aks-c244-v1': removedPodSecurityPolicy,
  'aks-c249-v1': missingScrapeContentType,
};
