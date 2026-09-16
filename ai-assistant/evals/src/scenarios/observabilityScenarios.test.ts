import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  aksObservabilityScenarios as observabilityScenarios,
  localObservabilityScenarios,
} from './observabilityScenarios.js';
import {
  cleanupAksObservability,
  hasEffectiveAksDeny,
  validateAksObservabilityState,
  withAksObservabilityFault,
} from '../cluster/provisioning/aksObservability.js';
import type { CommandRunner } from '../cluster/commandRunner.js';
import {
  evaluateLiveObservabilityCandidate,
  liveAzureFaultFacts,
  readLiveAzureTool,
} from '../runner/observabilityEvaluation.js';
import { verifyLocalObservability } from '../cluster/provisioning/localObservability.js';

test('AKS observability scenarios have real baseline, fault, and recovery definitions', () => {
  assert.equal(observabilityScenarios.length, 2);
  for (const scenario of observabilityScenarios) {
    assert.ok(scenario.id.startsWith('aks-'));
    assert.ok(scenario.baseline && scenario.fault && scenario.recovery);
    assert.ok(!('response' in scenario));
    assert.ok(!/datadog|splunk/i.test(JSON.stringify(scenario)));
  }
});

const deny = {
  value: [
    {
      effectiveSecurityRules: [
        {
          name: 'securityRules/block-aks',
          access: 'Deny',
          direction: 'Inbound',
          protocol: 'Tcp',
          priority: 100,
          sourceAddressPrefix: '10.240.0.0/24',
          destinationAddressPrefix: '10.240.1.4/32',
          destinationPortRange: '8080-8080',
        },
      ],
    },
  ],
};

function fakeAzure(
  directory: string,
  settings: {
    failSetup?: boolean;
    noFault?: boolean;
    noRecovery?: boolean;
    wrongOwner?: boolean;
    failDelete?: boolean;
    orphanNodes?: boolean;
    execFailure?: boolean;
  } = {}
) {
  const calls: Array<{ command: string; args: string[] }> = [];
  let created = false;
  let everCreated = false;
  let injected = false;
  let scaled = false;
  let recovered = false;
  let owner = '';
  const success = (value: unknown = {}) => ({
    status: 0,
    stdout: JSON.stringify(value),
    stderr: '',
  });
  const healthy = {
    metadata: { name: 'workload-1' },
    status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
  };
  const runner: CommandRunner = (executable, args) => {
    calls.push({ command: executable, args });
    const starts = (...prefix: string[]) => prefix.every((word, index) => args[index] === word);
    if (executable === 'ssh-keygen') return success();
    if (executable === 'az') {
      if (starts('cloud', 'show')) return { status: 0, stdout: 'AzureCloud', stderr: '' };
      if (starts('account', 'show')) return success({ id: '00000000-0000-0000-0000-000000000001' });
      if (starts('group', 'exists'))
        return success(
          everCreated && args.some(arg => arg.endsWith('-nodes')) && settings.orphanNodes
            ? true
            : created
        );
      if (starts('group', 'create')) {
        created = true;
        everCreated = true;
        owner = args.find(arg => arg.startsWith('headlamp-observability-owner='))!.split('=')[1]!;
        return success();
      }
      if (starts('group', 'show'))
        return success({
          tags: { 'headlamp-observability-owner': settings.wrongOwner ? 'other' : owner },
        });
      if (starts('group', 'delete')) {
        if (settings.failDelete) return { status: 1, stdout: '', stderr: 'denied' };
        created = false;
        return success();
      }
      if (starts('aks', 'create') && settings.failSetup)
        return { status: 1, stdout: '', stderr: 'quota' };
      if (starts('aks', 'get-credentials'))
        writeFileSync(path.join(directory, 'kubeconfig'), 'private');
      if (starts('network', 'nsg', 'rule', 'create')) injected = true;
      if (starts('network', 'nsg', 'rule', 'delete')) {
        injected = false;
        recovered = true;
      }
      if (starts('network', 'nic', 'list-effective-nsg')) return success(deny);
      if (starts('vm', 'run-command'))
        return success({ value: [{ message: '[stdout]\nBACKEND_HEALTHY\n[stderr]' }] });
      if (starts('aks', 'nodepool', 'show'))
        return success({ enableAutoScaling: true, maxCount: 1, count: 1 });
      if (starts('aks', 'nodepool', 'update')) recovered = true;
      return success();
    }
    if (executable === 'kubectl') {
      if (args.includes('exec'))
        return settings.execFailure
          ? { status: 1, stdout: '', stderr: 'api error' }
          : {
              status: 0,
              stdout:
                (injected && !settings.noFault) || (recovered && settings.noRecovery)
                  ? 'BLOCKED'
                  : 'CONNECTED',
              stderr: '',
            };
      if (args.includes('scale')) scaled = true;
      if (args.includes('get') && args.includes('pods'))
        return success({
          items: scaled
            ? [
                healthy,
                recovered && !settings.noRecovery
                  ? { ...healthy, metadata: { name: 'workload-2' } }
                  : { status: { phase: 'Pending' } },
              ]
            : [healthy],
        });
      if (args.includes('get') && args.includes('nodes'))
        return success({
          items: Array.from({ length: recovered && !settings.noRecovery ? 2 : 1 }, () => ({
            ...healthy,
            status: { ...healthy.status, allocatable: { cpu: '1900m' } },
          })),
        });
      if (args.includes('get') && args.includes('events'))
        return success({
          items:
            scaled && !recovered && !settings.noFault
              ? [{ reason: 'FailedScheduling', message: 'Insufficient cpu' }]
              : [],
        });
      return success();
    }
    throw new Error(`Unexpected executable ${executable}`);
  };
  return { runner, calls };
}

for (const scenario of observabilityScenarios) {
  test(`${scenario.id}: provisions, induces, observes, recovers, and deletes owned resources`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'aks-observability-'));
    const directory = path.join(root, 'run');
    const fake = fakeAzure(directory);
    const runner = fake.runner;
    try {
      let invoked = false;
      const result = await withAksObservabilityFault(
        {
          scenario: scenario.id,
          subscription: '00000000-0000-0000-0000-000000000001',
          location: 'eastus2',
          stateDirectory: directory,
          workloadImage: `busybox@sha256:${'a'.repeat(64)}`,
          acceptAzureCosts: true,
          runner,
          wait: async () => {},
        },
        async evidence => {
          invoked = true;
          assert.ok(evidence.fault && evidence.baseline);
          return 'candidate';
        }
      );
      assert.equal(invoked, true);
      assert.equal(result.cleanup, 'passed');
      assert.equal(statSync(directory).mode & 0o777, 0o700);
      assert.equal(statSync(path.join(directory, 'kubeconfig')).mode & 0o777, 0o600);
      assert.ok(fake.calls.some(call => call.args[0] === 'aks' && call.args[1] === 'create'));
      for (const call of fake.calls.filter(
        call => call.command === 'az' && call.args[0] !== 'cloud'
      ))
        assert.ok(call.args.includes('--subscription'));
      for (const call of fake.calls.filter(call => call.command === 'kubectl'))
        assert.equal(call.args[1], path.join(directory, 'kubeconfig'));
      const phases = JSON.parse(readFileSync(path.join(directory, 'lifecycle.json'), 'utf8')).map(
        (entry: { phase: string }) => entry.phase
      );
      assert.deepEqual(phases, [
        'setup-started',
        'baseline-passed',
        'fault-observed',
        'recovery-passed',
        'cleanup-started',
        'cleanup-passed',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('NSG oracle rejects unrelated, allowing, wrong-port, or wrong-source rules', () => {
  assert.equal(hasEffectiveAksDeny(deny), true);
  for (const [field, value] of [
    ['access', 'Allow'],
    ['sourceAddressPrefix', '*'],
    ['destinationPortRange', '443'],
    ['direction', 'Outbound'],
    ['priority', 200],
  ]) {
    const changed = structuredClone(deny);
    Object.assign(changed.value[0]!.effectiveSecurityRules[0]!, { [String(field)]: value });
    assert.equal(hasEffectiveAksDeny(changed), false);
  }
});

for (const setting of [
  'failSetup',
  'noFault',
  'noRecovery',
  'wrongOwner',
  'failDelete',
  'orphanNodes',
  'execFailure',
] as const) {
  test(`AKS lifecycle fails closed on ${setting} and records cleanup disposition`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'aks-failure-'));
    const directory = path.join(root, 'run');
    const fake = fakeAzure(directory, { [setting]: true });
    try {
      await assert.rejects(
        withAksObservabilityFault(
          {
            scenario: 'aks-private-backend-nsg-deny-v1',
            subscription: '00000000-0000-0000-0000-000000000001',
            location: 'eastus2',
            stateDirectory: directory,
            workloadImage: `busybox@sha256:${'a'.repeat(64)}`,
            acceptAzureCosts: true,
            runner: fake.runner,
            wait: async () => {},
          },
          async () => 'result'
        )
      );
      const state = JSON.parse(readFileSync(path.join(directory, 'state.json'), 'utf8'));
      assert.equal(
        state.cleanup,
        ['wrongOwner', 'failDelete', 'orphanNodes'].includes(setting) ? 'failed' : 'passed'
      );
      if (setting === 'wrongOwner')
        assert.ok(!fake.calls.some(call => call.args[0] === 'group' && call.args[1] === 'delete'));
      if (setting === 'noFault' || setting === 'execFailure' || setting === 'failSetup') {
        const phases = readFileSync(path.join(directory, 'lifecycle.json'), 'utf8');
        assert.ok(!phases.includes('fault-observed'));
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('a failing candidate does not leave provisioned AKS resources running', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aks-candidate-failure-'));
  const directory = path.join(root, 'run');
  const fake = fakeAzure(directory);
  try {
    await assert.rejects(
      withAksObservabilityFault(
        {
          scenario: 'aks-autoscaler-max-count-v1',
          subscription: '00000000-0000-0000-0000-000000000001',
          location: 'eastus2',
          stateDirectory: directory,
          workloadImage: `busybox@sha256:${'a'.repeat(64)}`,
          acceptAzureCosts: true,
          runner: fake.runner,
          wait: async () => {},
        },
        async () => {
          throw new Error('candidate failed');
        }
      ),
      /candidate failed/
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(directory, 'state.json'), 'utf8')).cleanup,
      'passed'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const scenario of localObservabilityScenarios) {
  test(`${scenario.id}: real-service lifecycle dispatch and cleanup`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'local-observability-'));
    const directory = path.join(root, 'run');
    const active = new Set<string>();
    const labels = new Map<string, string>();
    let stopped = false;
    let dashboardUid = 'eval-prometheus';
    const runner: CommandRunner = (_, args) => {
      if (args[0] === 'run' || args[0] === 'create') {
        const name = args[args.indexOf('--name') + 1]!;
        active.add(name);
        labels.set(name, args[args.indexOf('--label') + 1]!.split('=')[1]!);
      }
      if (args[0] === 'exec' && args.includes('killall')) stopped = true;
      if (args[0] === 'exec' && !args.includes('killall')) stopped = false;
      if (args[0] === 'port')
        return {
          status: 0,
          stdout: args.includes('3000/tcp') ? '127.0.0.1:33000' : '127.0.0.1:39090',
          stderr: '',
        };
      if (args[0] === 'inspect')
        return {
          status: 0,
          stdout: JSON.stringify([
            {
              Config: { Labels: { 'headlamp-observability-owner': labels.get(args[1]!) } },
              NetworkSettings: { Networks: { bridge: { IPAddress: '172.17.0.10' } } },
            },
          ]),
          stderr: '',
        };
      if (args[0] === 'container')
        return {
          status: 0,
          stdout: [...active].find(name => args.some(arg => arg === `name=^/${name}$`)) ?? '',
          stderr: '',
        };
      if (args[0] === 'rm') active.delete(args.at(-1)!);
      return { status: 0, stdout: '', stderr: '' };
    };
    const transport: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/health') return Response.json({ database: 'ok' });
      if (url.pathname === '/api/serviceaccounts') return Response.json({ id: 1 });
      if (url.pathname.endsWith('/tokens')) return Response.json({ key: 'reader' });
      if (url.pathname === '/api/datasources') return Response.json({});
      if (url.pathname === '/api/dashboards/db') {
        dashboardUid = JSON.parse(String(init?.body)).dashboard.panels[0].datasource.uid;
        return Response.json({});
      }
      if (url.pathname === '/api/dashboards/uid/eval')
        return Response.json({ dashboard: { panels: [{ datasource: { uid: dashboardUid } }] } });
      if (url.pathname.includes('/missing-datasource/')) return new Response('', { status: 404 });
      if (url.pathname.endsWith('/api/v1/query'))
        return Response.json({
          data: { result: [{ metric: { job: 'backend' }, value: [1, stopped ? '0' : '1'] }] },
        });
      throw new Error(`Unexpected endpoint ${url.pathname}`);
    };
    try {
      const result = await verifyLocalObservability({
        scenario: scenario.id,
        stateDirectory: directory,
        exporterImage: `busybox@sha256:${'a'.repeat(64)}`,
        runner,
        transport,
        wait: async () => {},
      });
      assert.equal(result.lifecycle, 'passed');
      assert.equal(active.size, 0);
      assert.ok(result.evidence.some(item => item.phase === 'fault-observed'));
      assert.ok(result.evidence.some(item => item.phase === 'recovery-passed'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('cleanup rejects arbitrary resource group names in a state file', () => {
  assert.throws(() =>
    validateAksObservabilityState({
      version: 1,
      owner: '00000000-0000-0000-0000-000000000002',
      subscription: '00000000-0000-0000-0000-000000000001',
      resourceGroup: 'production',
    })
  );
});

test('production Azure reader performs scoped live HTTP and rejects cross-subscription continuation', async () => {
  const clusterId =
    '/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test/providers/Microsoft.ContainerService/managedClusters/eval';
  const evidence = {
    task: 'Investigate',
    clusterId,
    resourceId: clusterId,
    tool: 'azure_cost_capacity_read' as const,
    args: { action: 'node_pools', clusterResourceId: clusterId },
    kubernetesSnapshot: {},
    baseline: {},
    fault: {},
  };
  const response = {
    value: [{ name: 'target', properties: { count: 1, maxCount: 1, enableAutoScaling: true } }],
  };
  let requests = 0;
  const actual = await readLiveAzureTool(
    evidence,
    () => ({ status: 0, stdout: 'test-token', stderr: '' }),
    async (url, init) => {
      requests++;
      assert.equal(
        String(url),
        `https://management.azure.com${clusterId}/agentPools?api-version=2024-07-01`
      );
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token');
      return new Response(JSON.stringify(response));
    }
  );
  assert.equal(requests, 1);
  const facts = liveAzureFaultFacts(evidence.tool, actual);
  assert.equal(facts.length, 4);
  assert.throws(() =>
    liveAzureFaultFacts(evidence.tool, {
      value: [{ name: 'target', properties: { count: 1, maxCount: 2, enableAutoScaling: true } }],
    })
  );
  await assert.rejects(
    readLiveAzureTool(
      evidence,
      () => ({ status: 0, stdout: 'test-token', stderr: '' }),
      async () =>
        new Response('', {
          status: 202,
          headers: { location: 'https://management.azure.com/subscriptions/other/result' },
        })
    ),
    /Cross-subscription/
  );
  const candidate = async (
    input: Parameters<Parameters<typeof evaluateLiveObservabilityCandidate>[2]>[0]
  ) => {
    if (!input.enabledTools.includes(evidence.tool))
      return JSON.stringify({
        schema_version: '1.0.0',
        cause_facts: [],
        resource_refs: [],
        evidence_refs: [],
        alternative_dispositions: [],
        uncertainty: { is_uncertain: true },
        proposed_actions: [{ operation: 'no_action', description: 'Insufficient evidence' }],
      });
    const output = await input.callTool(evidence.tool, evidence.args);
    return JSON.stringify({
      schema_version: '1.0.0',
      cause_facts: facts.map(({ resource_ref, field_path, observed_value }) => ({
        resource_ref,
        field_path,
        observed_value,
      })),
      resource_refs: [`tool/${evidence.tool}`],
      evidence_refs: [output.observations[0]!.evidence_id],
      alternative_dispositions: [],
      uncertainty: { is_uncertain: false },
      proposed_actions: [{ operation: 'no_action', description: 'Read only' }],
    });
  };
  assert.equal(
    (await evaluateLiveObservabilityCandidate(evidence, facts, candidate, async () => actual, true))
      .passed,
    true
  );
  assert.equal(
    (
      await evaluateLiveObservabilityCandidate(
        evidence,
        facts,
        candidate,
        async () => {
          throw new Error('Disabled candidate cannot read Azure');
        },
        false
      )
    ).passed,
    false
  );
});

test('Azure provisioning fails before commands without explicit cost consent', async () => {
  let calls = 0;
  await assert.rejects(
    withAksObservabilityFault(
      {
        scenario: 'aks-autoscaler-max-count-v1',
        subscription: '00000000-0000-0000-0000-000000000001',
        location: 'eastus2',
        stateDirectory: '/unused',
        workloadImage: `busybox@sha256:${'a'.repeat(64)}`,
        acceptAzureCosts: false,
        runner: () => {
          calls++;
          throw new Error('Must not run');
        },
      },
      async () => null
    ),
    /accept-azure-costs/
  );
  assert.equal(calls, 0);
});
