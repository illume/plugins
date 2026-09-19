import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import type { AksCaseContext } from './aksEndToEndCases.js';
import { listAksEndToEndAuthoring } from './aksEndToEndScenarios.js';
import {
  aksEnergyEndToEndCases,
  assertRemovedPspError,
  assertScaphandreManifest,
  scaphandreHttpEvidence,
  scaphandreScrapeConfig,
  scaphandreTargetEvidence,
} from './aksEnergyEndToEndCases.js';

const image = `hubblo/scaphandre:v0.5.0@sha256:${'a'.repeat(64)}`;
const chartMetadata = { name: 'scaphandre', labels: { 'app.kubernetes.io/name': 'scaphandre' } };
const exporter = {
  apiVersion: 'apps/v1',
  kind: 'DaemonSet',
  metadata: chartMetadata,
  spec: { template: { spec: { containers: [{ name: 'exporter', image }] } } },
};
const psp = { apiVersion: 'policy/v1beta1', kind: 'PodSecurityPolicy', metadata: chartMetadata };

test('C244 requires a real exporter manifest, exact image and the appropriate PSP shape', () => {
  const affected = `${JSON.stringify(exporter)}\n---\n${JSON.stringify(psp)}`;
  assert.equal(assertScaphandreManifest(affected, image, true).length, 2);
  assert.equal(assertScaphandreManifest(JSON.stringify(exporter), image, false).length, 1);
  assert.throws(() => assertScaphandreManifest(affected, image, false), /still requests/);
  assert.throws(
    () => assertScaphandreManifest(JSON.stringify(exporter), image, true),
    /reported PSP/
  );
  assert.throws(() => assertScaphandreManifest('', image, false), /Empty/);
  assert.throws(
    () => assertScaphandreManifest(JSON.stringify(exporter), 'other-image', false),
    /reviewed exporter digest/
  );
  assert.throws(
    () =>
      assertScaphandreManifest(
        `${JSON.stringify(exporter)}\n---\n${JSON.stringify(exporter)}`,
        image,
        false
      ),
    /Duplicate/
  );
  assert.throws(
    () =>
      assertScaphandreManifest(JSON.stringify({ ...exporter, kind: 'Deployment' }), image, false),
    /resource kind/
  );
});

test('C244 accepts only the reported removed-API mapping error', () => {
  const result = {
    status: 1,
    stdout: '',
    stderr:
      'INSTALLATION FAILED: no matches for kind "PodSecurityPolicy" in version "policy/v1beta1" ensure CRDs are installed first',
  };
  assertRemovedPspError(result);
  assert.throws(() => assertRemovedPspError({ ...result, status: 0 }), /unexpectedly succeeded/);
  assert.throws(
    () => assertRemovedPspError({ ...result, stderr: result.stderr + ' Forbidden' }),
    /Unrelated/
  );
  assert.throws(() =>
    assertRemovedPspError({ ...result, stderr: 'no matches for kind "ServiceMonitor"' })
  );
});

function chartContext(directory: string, failure?: string) {
  const parameters: Record<string, string> = { exporterImage: image };
  for (const prefix of ['affectedChart', 'fixedChart']) {
    const bytes = Buffer.from(prefix);
    const archive = path.join(directory, `${prefix}.tgz`);
    writeFileSync(archive, bytes);
    parameters[`${prefix}Archive`] = archive;
    parameters[`${prefix}Sha256`] = createHash('sha256').update(bytes).digest('hex');
  }
  const phases: string[] = [];
  const commands: string[][] = [];
  const evidence = new Map<string, any>();
  let witness: any;
  const context = {
    owner: 'owner',
    namespace: 'owned',
    kubernetesVersion: '1.35.7',
    parameters,
    create(_name: string, object: any) {
      assert.equal(object.kind, 'ConfigMap');
      witness = structuredClone(object);
    },
    read(kind: string, name: string) {
      assert.equal(kind, 'configmap');
      assert.equal(name, 'energy-admission-witness');
      return witness;
    },
    save(name: string, object: unknown) {
      evidence.set(name, object);
    },
    run(args: string[]) {
      commands.push(args);
      if (args[0] === 'api-versions')
        return failure === 'legacy-api' ? 'policy/v1\npolicy/v1beta1' : 'policy/v1';
      if (args.includes('--raw')) return JSON.stringify({ resources: [{ kind: 'Eviction' }] });
      if (args.includes('configmap')) {
        if (args.includes('delete')) witness = undefined;
        return '';
      }
      assert.ok(args.includes('app.kubernetes.io/name=scaphandre'));
      return JSON.stringify({
        items: failure === 'leaked-resource' ? [{ metadata: chartMetadata }] : [],
      });
    },
    helm(args: string[]) {
      commands.push(args);
      const result = { status: 0, stdout: '[]', stderr: '' };
      if (args[0] === 'list') return result;
      assert.ok(args.includes('image.name=hubblo/scaphandre'));
      assert.ok(args.includes(`image.tag=v0.5.0@sha256:${'a'.repeat(64)}`));
      if (args[0] === 'template')
        return { ...result, stdout: `${JSON.stringify(exporter)}\n---\n${JSON.stringify(psp)}` };
      assert.equal(args[0], 'install');
      assert.ok(args.includes('--dry-run=server'));
      if (args.includes(parameters.affectedChartArchive!))
        return {
          status: 1,
          stdout: '',
          stderr:
            failure === 'unrelated'
              ? 'Forbidden: access denied'
              : 'no matches for kind "PodSecurityPolicy" in version "policy/v1beta1"',
        };
      return {
        ...result,
        stdout: JSON.stringify({
          manifest: failure === 'bad-control' ? '' : JSON.stringify(exporter),
        }),
      };
    },
    async phase(name: string, action: () => Promise<unknown>) {
      phases.push(name);
      evidence.set(name, await action());
    },
  } as unknown as AksCaseContext;
  return { context, parameters, phases, commands, evidence, witness: () => witness };
}

test('C244 compares real chart operations without installing an energy collector', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'energy-chart-'));
  try {
    const fixture = chartContext(directory);
    const handler = aksEnergyEndToEndCases['aks-c244-v1'];
    assert.ok(handler);
    handler.validate(fixture.parameters);
    await handler.run(fixture.context);
    assert.deepEqual(fixture.phases, ['baseline', 'fault', 'recovery']);
    assert.equal(fixture.evidence.get('fault').faultObserved, true);
    assert.equal(fixture.evidence.get('recovery').energyMeasured, false);
    assert.equal(fixture.evidence.get('recovery').persistedObjects, 0);
    assert.equal(fixture.witness(), undefined);
    assert.equal(fixture.commands.filter(args => args[0] === 'install').length, 3);
    assert.ok(
      fixture.commands
        .filter(args => args[0] === 'install')
        .every(args => args.includes('--dry-run=server'))
    );
    writeFileSync(fixture.parameters.affectedChartArchive!, 'changed');
    assert.throws(() => handler.validate(fixture.parameters), /declared pin/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('C244 stops on unrelated failures, leaked resources, unavailable controls or legacy API support', async () => {
  const handler = aksEnergyEndToEndCases['aks-c244-v1'];
  assert.ok(handler);
  for (const failure of ['unrelated', 'leaked-resource', 'bad-control', 'legacy-api']) {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'energy-chart-'));
    try {
      const fixture = chartContext(directory, failure);
      await assert.rejects(handler.run(fixture.context));
      assert.ok(!fixture.phases.includes('recovery'));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
});

test('C249 scopes the fallback to the same single exporter target', () => {
  const fixed = scaphandreScrapeConfig('10.0.0.8', true);
  const strict = scaphandreScrapeConfig('10.0.0.8', false);
  assert.equal(fixed.scrape_configs[0]?.fallback_scrape_protocol, 'PrometheusText0.0.4');
  assert.equal(strict.scrape_configs[0]?.fallback_scrape_protocol, undefined);
  const withoutFallback = structuredClone(fixed);
  delete withoutFallback.scrape_configs[0]!.fallback_scrape_protocol;
  assert.deepEqual(withoutFallback, strict);
});

test('C249 requires a real HTTP response and host series without asserting measurement accuracy', () => {
  const result = {
    status: 0,
    stdout:
      'scaph_host_power_microwatts 0\nC249_HTTP_METADATA\n' +
      JSON.stringify({ http_code: 200, exitcode: 0, content_type: null }),
    stderr: '',
  };
  const evidence = scaphandreHttpEvidence(result);
  assert.equal(evidence.hostMetricPresent, true);
  assert.equal(evidence.energyMeasured, false);
  assert.equal(evidence.measurementValidity, 'not-assessed');
  assert.throws(() => scaphandreHttpEvidence({ ...result, status: 28 }), /HTTP probe failed/);
  assert.throws(
    () =>
      scaphandreHttpEvidence({
        ...result,
        stdout: result.stdout.replace('scaph_host_power_microwatts 0', 'unrelated 1'),
      }),
    /series absent/
  );
});

test('C249 rejects other targets and incomplete scrape observations', () => {
  const payload = {
    status: 'success',
    data: {
      activeTargets: [
        {
          scrapeUrl: 'http://10.0.0.8:8080/metrics',
          labels: { job: 'scaphandre' },
          health: 'down',
          lastError: 'blank Content-Type',
          lastScrape: '2026-09-19T00:00:00Z',
        },
      ],
    },
  };
  assert.equal(scaphandreTargetEvidence(payload, '10.0.0.8').health, 'down');
  assert.throws(() => scaphandreTargetEvidence(payload, '10.0.0.9'));
  payload.data.activeTargets[0]!.lastScrape = '0001-01-01T00:00:00Z';
  assert.throws(() => scaphandreTargetEvidence(payload, '10.0.0.8'), /completed scrape/);
  payload.data.activeTargets[0]!.health = 'unknown';
  assert.equal(scaphandreTargetEvidence(payload, '10.0.0.8').completed, false);
});

function scrapeContext(failure?: string) {
  const objects = new Map<string, any>();
  const evidence = new Map<string, any>();
  const phases: string[] = [];
  let sequence = 0;
  let scrapeSequence = 0;
  let firstTarget = true;
  const parameters = {
    exporterImage: `scaphandre@sha256:${'a'.repeat(64)}`,
    prometheusImage: `prometheus@sha256:${'b'.repeat(64)}`,
    prometheusVersion: '3.0.0',
    nodeImageVersion: 'AKSUbuntu-2404gen2containerd-202609.03.1',
    acceptReadOnlyHostMetrics: 'true',
  };
  const context = {
    namespace: 'owned',
    owner: 'owner',
    probeImage: `curl@sha256:${'c'.repeat(64)}`,
    parameters,
    create(_name: string, resource: any) {
      const value = structuredClone(resource);
      value.metadata.uid = `uid-${++sequence}`;
      if (value.kind === 'Pod')
        value.status = {
          podIP: `10.0.0.${sequence}`,
          conditions: [{ type: 'Ready', status: 'True' }],
          containerStatuses: value.spec.containers.map((container: any) => ({
            name: container.name,
            imageID: container.image,
            restartCount: 0,
          })),
        };
      objects.set(`${value.kind.toLowerCase()}/${value.metadata.name}`, value);
    },
    read(kind: string, name: string) {
      const object = structuredClone(objects.get(`${kind}/${name}`));
      assert.ok(object);
      if (failure === 'restart' && phases.includes('fault') && name === 'scaphandre')
        object.status.containerStatuses[0].restartCount++;
      if (failure === 'scraper-restart' && phases.includes('fault') && name === 'control')
        object.status.containerStatuses[0].restartCount++;
      return object;
    },
    run(args: string[]) {
      if (args.includes('nodes'))
        return JSON.stringify({
          items: [
            {
              metadata: {
                labels: { 'kubernetes.azure.com/node-image-version': parameters.nodeImageVersion },
              },
            },
          ],
        });
      assert.ok(args.includes('delete'));
      const position = args.indexOf('delete');
      objects.delete(`${args[position + 1]}/${args[position + 2]}`);
      return '';
    },
    kube(args: string[]) {
      if (args.includes('/bin/sh'))
        return {
          status: failure === 'sensor-mount' ? 1 : 0,
          stdout: failure === 'sensor-mount' ? '' : 'readable-rapl-counter\n',
          stderr: '',
        };
      const url = new URL(args.at(-1)!);
      const exporter = objects.get('pod/scaphandre');
      if (url.port === '8080')
        return {
          status: 0,
          stderr: '',
          stdout:
            (failure === 'sensor' ? 'other_metric 0' : 'scaph_host_power_microwatts 0') +
            '\nC249_HTTP_METADATA\n' +
            JSON.stringify({
              http_code: 200,
              exitcode: 0,
              content_type: failure === 'fixed-header' ? 'text/plain' : null,
            }),
        };
      const scraper = [...objects.values()].find(
        object => object.kind === 'Pod' && object.status.podIP === url.hostname
      );
      assert.ok(scraper);
      if (url.pathname.endsWith('buildinfo'))
        return {
          status: 0,
          stderr: '',
          stdout: JSON.stringify({
            status: 'success',
            data: { version: failure === 'version' ? '2.55.0' : '3.0.0' },
          }),
        };
      const config: any = yaml.load(
        objects.get(`configmap/${scraper.metadata.name}-config`).data['prometheus.yml']
      );
      const fallback = !!config.scrape_configs[0].fallback_scrape_protocol;
      const pending = firstTarget;
      firstTarget = false;
      const healthy = fallback && failure !== 'control';
      return {
        status: 0,
        stderr: '',
        stdout: JSON.stringify({
          status: 'success',
          data: {
            activeTargets: [
              {
                scrapeUrl: `http://${exporter.status.podIP}:8080/metrics`,
                labels: { job: 'scaphandre' },
                health: pending ? 'unknown' : healthy ? 'up' : 'down',
                lastError:
                  pending || healthy
                    ? ''
                    : failure === 'unrelated' || failure === 'control'
                    ? 'connection refused'
                    : 'non-compliant scrape target sending blank Content-Type',
                lastScrape: pending
                  ? '0001-01-01T00:00:00Z'
                  : new Date(Date.UTC(2026, 8, 19, 0, 0, ++scrapeSequence)).toISOString(),
              },
            ],
          },
        }),
      };
    },
    save(name: string, value: unknown) {
      evidence.set(name, structuredClone(value));
    },
    async poll(action: () => boolean, message: string) {
      for (let attempt = 0; attempt < 3; attempt++) if (action()) return;
      throw Error(message);
    },
    async phase(name: string, action: () => Promise<unknown>) {
      phases.push(name);
      evidence.set(name, await action());
    },
  } as unknown as AksCaseContext;
  return { context, objects, evidence, phases };
}

test('C249 compares strict and fallback scrapes of one unchanged real exporter identity', async () => {
  const fixture = scrapeContext();
  const handler = aksEnergyEndToEndCases['aks-c249-v1'];
  assert.ok(handler);
  handler.validate(fixture.context.parameters);
  await handler.run(fixture.context);
  assert.deepEqual(fixture.phases, ['baseline', 'fault', 'recovery']);
  assert.equal(fixture.evidence.get('fault').samples.length, 3);
  assert.equal(
    new Set(fixture.evidence.get('fault').samples.map((item: any) => item.lastScrape)).size,
    3
  );
  assert.equal(fixture.evidence.get('fault').faultObserved, true);
  assert.equal(fixture.evidence.get('recovery').recovered.health, 'up');
  assert.equal(fixture.evidence.get('recovery').energyMeasured, false);
  const exporter = fixture.objects.get('pod/scaphandre');
  assert.ok(exporter.spec.containers[0].volumeMounts.every((mount: any) => mount.readOnly));
  assert.equal(exporter.spec.containers[0].securityContext.allowPrivilegeEscalation, false);
  assert.equal(exporter.spec.automountServiceAccountToken, false);
});

test('C249 blocks unavailable sensors, repaired source headers, version skew, unrelated failures and restarts', async () => {
  const handler = aksEnergyEndToEndCases['aks-c249-v1'];
  assert.ok(handler);
  for (const failure of [
    'sensor',
    'sensor-mount',
    'fixed-header',
    'version',
    'control',
    'unrelated',
    'restart',
    'scraper-restart',
  ]) {
    const fixture = scrapeContext(failure);
    await assert.rejects(handler.run(fixture.context));
    assert.ok(!fixture.evidence.has('recovery'));
    assert.ok(!fixture.evidence.has('fault'));
  }
  assert.throws(() =>
    handler.validate({ ...scrapeContext().context.parameters, acceptReadOnlyHostMetrics: 'false' })
  );
});

test('energy discovery admits authored paths only and does not promote the withdrawn PID hypothesis', () => {
  const entries = listAksEndToEndAuthoring();
  for (const id of ['AKS-C244', 'AKS-C249']) {
    const entry = entries.find(item => item.candidate_id === id);
    assert.ok(entry);
    assert.equal(entry.execution_eligible, false);
    assert.equal(entry.qualification, 'pending');
  }
  assert.ok(!entries.some(item => item.candidate_id === 'AKS-C243'));
});
