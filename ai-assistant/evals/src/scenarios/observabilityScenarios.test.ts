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
  observabilityMain,
} from '../runner/observabilityEvaluation.js';
import { verifyLocalObservability } from '../cluster/provisioning/localObservability.js';
import {
  buildAksCandidateScenarioPlans,
  loadAksCandidateScenarioPlans,
} from './aksCandidateScenarios.js';
import { listScenarioIds } from './loader.js';
import { corednsCandidateResources } from './aksCandidateReproductions.js';
import {
  cleanupAksCandidateReproduction,
  verifyAksCandidateReproduction,
} from '../cluster/provisioning/aksCandidateReproduction.js';

function fakeCoreDns(failure?: 'baseline' | 'unrelated-fault' | 'recovery' | 'cleanup' | 'owner') {
  let namespace: any;
  let config: any;
  let pod: any;
  let configurationCount = 0;
  let cleanupStarted = false;
  const calls: string[][] = [];
  const runner: CommandRunner = (command, args) => {
    assert.equal(command, 'kubectl');
    assert.equal(args[0], '--kubeconfig');
    assert.equal(args[2], '--context');
    assert.equal(args[3], 'research-only');
    assert.equal(args[4], '--request-timeout=10s');
    const operation = args.slice(5);
    const scoped = operation[0] === '--namespace' ? operation.slice(2) : operation;
    if (operation[0] === '--namespace') assert.equal(operation[1], namespace.metadata.name);
    calls.push(scoped);
    const result = (value: unknown = '', status = 0) => ({
      status,
      stdout: typeof value === 'string' ? value : JSON.stringify(value),
      stderr: '',
    });
    if (scoped[0] === 'config') {
      if (configurationCount >= 3) cleanupStarted = true;
      return result('https://127.0.0.1:6443');
    }
    if (scoped[0] === 'auth') return result('yes');
    if (['create', 'replace'].includes(scoped[0]!)) {
      const resource = JSON.parse(readFileSync(scoped[2]!, 'utf8'));
      if (resource.kind === 'Namespace')
        namespace = { ...resource, metadata: { ...resource.metadata, uid: 'owned-uid' } };
      if (resource.kind === 'ConfigMap') {
        config = resource;
        configurationCount++;
      }
      if (resource.kind === 'Pod' && resource.metadata.name === 'dns') pod = resource;
      return result();
    }
    if (scoped[0] === 'get' && scoped[1] === 'namespace') {
      if (failure === 'owner' && cleanupStarted && namespace)
        return result({ ...namespace, metadata: { ...namespace.metadata, labels: {} } });
      return result(namespace ?? '');
    }
    if (scoped[0] === 'delete' && scoped[1] === 'namespace') {
      if (failure === 'cleanup') return result('', 1);
      namespace = undefined;
      return result();
    }
    if (scoped[0] === 'delete' && scoped[1] === 'pod') return result();
    if (scoped[0] === 'get' && scoped[1] === 'service')
      return result({ spec: { clusterIP: '10.96.0.10' } });
    if (scoped[0] === 'get' && scoped[1] === 'configmap') return result(config);
    if (scoped[0] === 'get' && scoped[1] === 'pod') {
      const fault = config?.data.Corefile.startsWith('.');
      const ready =
        scoped[2] === 'probe' ||
        (!fault &&
          !(failure === 'baseline' && configurationCount === 1) &&
          !(failure === 'recovery' && configurationCount === 3));
      return result({
        ...pod,
        status: {
          conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
          containerStatuses: [{ name: 'coredns', restartCount: fault ? 1 : 0 }],
        },
      });
    }
    if (scoped[0] === 'logs')
      return result(
        failure === 'unrelated-fault'
          ? 'unrelated plugin failure'
          : 'zone is not a valid domain name: .example.test'
      );
    if (scoped[0] === 'exec') return result('Name: answer.example.test\nAddress: 192.0.2.10');
    throw new Error(`Unexpected kubectl operation ${scoped[0]}`);
  };
  return { runner, calls };
}

test('CoreDNS candidate verifies real-read lifecycle boundaries and retains private evidence', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'aks-c059-'));
  const stateDirectory = path.join(directory, 'trial');
  const fake = fakeCoreDns();
  try {
    const result = await verifyAksCandidateReproduction({
      scenario: 'aks-c059-v1',
      stateDirectory,
      kubeconfig: path.join(directory, 'kubeconfig'),
      context: 'research-only',
      acceptClusterMutations: true,
      corednsImage: `coredns@sha256:${'a'.repeat(64)}`,
      probeImage: `busybox@sha256:${'b'.repeat(64)}`,
      runner: fake.runner,
      wait: async () => {},
    });
    assert.deepEqual(result.phases, {
      baseline: 'passed',
      fault: 'passed',
      recovery: 'passed',
      cleanup: 'passed',
    });
    assert.equal(result.qualification, 'pending');
    assert.equal(result.modelInvocations, 0);
    assert.equal(fake.calls.filter(args => args[0] === 'exec').length, 6);
    assert.equal(fake.calls.filter(args => args[0] === 'delete' && args[1] === 'pod').length, 2);
    const candidate = JSON.parse(
      readFileSync(path.join(stateDirectory, 'candidate-evidence.json'), 'utf8')
    );
    assert.ok(!('required' in candidate));
    assert.equal(candidate.observations.pod.status.containerStatuses[0].restartCount, 1);
    const evaluator = JSON.parse(
      readFileSync(path.join(stateDirectory, 'evaluator-evidence.json'), 'utf8')
    );
    assert.equal(evaluator.required[0].field_path, '/data/Corefile');
    assert.equal(statSync(stateDirectory).mode & 0o777, 0o700);
    assert.equal(
      statSync(path.join(stateDirectory, 'reproduction-state.json')).mode & 0o777,
      0o600
    );
    cleanupAksCandidateReproduction(stateDirectory, fake.runner);
    assert.equal(
      fake.calls.filter(args => args[0] === 'delete' && args[1] === 'namespace').length,
      1
    );
    const callsBeforeReuse = fake.calls.length;
    await assert.rejects(
      verifyAksCandidateReproduction({
        scenario: 'aks-c059-v1',
        stateDirectory,
        kubeconfig: path.join(directory, 'kubeconfig'),
        context: 'research-only',
        acceptClusterMutations: true,
        corednsImage: `coredns@sha256:${'a'.repeat(64)}`,
        probeImage: `busybox@sha256:${'b'.repeat(64)}`,
        runner: fake.runner,
      }),
      /EEXIST/
    );
    assert.ok(
      fake.calls.slice(callsBeforeReuse).every(args => ['config', 'auth'].includes(args[0]!))
    );
    await assert.rejects(
      verifyAksCandidateReproduction({
        scenario: 'aks-c059-v1',
        stateDirectory,
        kubeconfig: path.join(directory, 'kubeconfig'),
        context: 'research-only',
        acceptClusterMutations: false,
        corednsImage: `coredns@sha256:${'a'.repeat(64)}`,
        probeImage: `busybox@sha256:${'b'.repeat(64)}`,
        runner: () => {
          throw new Error('Must not invoke kubectl');
        },
      }),
      /acknowledgement/
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const changed of ['server', 'uid'] as const) {
  test(`CoreDNS candidate cleanup refuses changed ${changed}`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aks-c059-cleanup-'));
    const owner = '11111111-2222-4333-8444-555555555555';
    const state = {
      schema_version: 'aks-component-reproduction@1.0.0',
      scenario: 'aks-c059-v1',
      owner,
      namespace: `hl-aks-c059-${owner}`,
      namespaceUid: 'original',
      kubeconfig: '/explicit/kubeconfig',
      context: 'research-only',
      server: 'https://127.0.0.1:6443',
      phases: { cleanup: 'not-run' },
    };
    const calls: string[][] = [];
    const runner: CommandRunner = (_, args) => {
      calls.push(args);
      if (args.includes('config'))
        return {
          status: 0,
          stdout: changed === 'server' ? 'https://127.0.0.1:7443' : state.server,
          stderr: '',
        };
      if (args.includes('get'))
        return {
          status: 0,
          stdout: JSON.stringify({
            metadata: { uid: 'replacement', labels: { 'headlamp-research-owner': owner } },
          }),
          stderr: '',
        };
      throw new Error('Deletion must not be attempted');
    };
    try {
      writeFileSync(path.join(directory, 'reproduction-state.json'), JSON.stringify(state));
      assert.throws(
        () => cleanupAksCandidateReproduction(directory, runner),
        changed === 'server' ? /different cluster/ : /UID changed/
      );
      assert.ok(calls.every(args => !args.includes('delete')));
      assert.equal(
        JSON.parse(readFileSync(path.join(directory, 'reproduction-state.json'), 'utf8')).phases
          .cleanup,
        'failed'
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

for (const failure of ['baseline', 'unrelated-fault', 'recovery', 'cleanup', 'owner'] as const) {
  test(`CoreDNS candidate retains ${failure} failure and does not claim lifecycle success`, async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aks-c059-failure-'));
    const stateDirectory = path.join(directory, 'trial');
    const fake = fakeCoreDns(failure);
    try {
      await assert.rejects(
        verifyAksCandidateReproduction({
          scenario: 'aks-c059-v1',
          stateDirectory,
          kubeconfig: path.join(directory, 'kubeconfig'),
          context: 'research-only',
          acceptClusterMutations: true,
          corednsImage: `coredns@sha256:${'a'.repeat(64)}`,
          probeImage: `busybox@sha256:${'b'.repeat(64)}`,
          runner: fake.runner,
          wait: async () => {},
        })
      );
      const state = JSON.parse(
        readFileSync(path.join(stateDirectory, 'reproduction-state.json'), 'utf8')
      );
      assert.equal(
        state.phases[
          failure === 'unrelated-fault'
            ? 'fault'
            : ['cleanup', 'owner'].includes(failure)
            ? 'cleanup'
            : failure
        ],
        'failed'
      );
      if (failure === 'owner')
        assert.equal(
          fake.calls.filter(args => args[0] === 'delete' && args[1] === 'namespace').length,
          0
        );
      if (failure === 'baseline') {
        assert.equal(state.phases.fault, 'not-run');
        assert.equal(state.phases.recovery, 'not-run');
      }
      if (failure === 'unrelated-fault') assert.equal(state.phases.recovery, 'not-run');
      if (!['cleanup', 'owner'].includes(failure)) assert.equal(state.phases.cleanup, 'passed');
      state.namespace = 'kube-system';
      writeFileSync(path.join(stateDirectory, 'reproduction-state.json'), JSON.stringify(state));
      assert.throws(() =>
        cleanupAksCandidateReproduction(stateDirectory, () => {
          throw new Error('Must not invoke kubectl');
        })
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('CoreDNS candidate manifests isolate baseline fault and recovery without changing cluster DNS', () => {
  const owner = '11111111-2222-4333-8444-555555555555';
  const options = {
    owner,
    namespace: `hl-aks-c059-${owner}`,
    corednsImage: `coredns/coredns@sha256:${'a'.repeat(64)}`,
    probeImage: `busybox@sha256:${'b'.repeat(64)}`,
  };
  const baseline = corednsCandidateResources({ ...options, phase: 'baseline' });
  const fault = corednsCandidateResources({ ...options, phase: 'fault' });
  const recovery = corednsCandidateResources({ ...options, phase: 'recovery' });
  assert.equal(fault.config.data.Corefile, `.${baseline.config.data.Corefile}`);
  assert.equal(recovery.config.data.Corefile, baseline.config.data.Corefile);
  for (const resources of [baseline, fault, recovery]) {
    for (const resource of Object.values(resources)) {
      assert.equal(resource.metadata.namespace, options.namespace);
      assert.equal(resource.metadata.labels['headlamp-research-owner'], owner);
    }
    assert.equal(resources.pod.spec.automountServiceAccountToken, false);
    assert.equal(resources.service.spec.selector.app, resources.pod.metadata.name);
    assert.ok(!JSON.stringify(resources).includes('kube-system'));
  }
  assert.throws(() =>
    corednsCandidateResources({ ...options, namespace: 'kube-system', phase: 'fault' })
  );
  assert.throws(
    () => corednsCandidateResources({ ...options, corednsImage: 'coredns:latest', phase: 'fault' }),
    /immutable/
  );
});

test('all 100 researched candidates track implementation separately from scored eligibility', () => {
  const plans = loadAksCandidateScenarioPlans();
  const register = JSON.parse(
    readFileSync(new URL('../../../docs/aks-candidate-register.json', import.meta.url), 'utf8')
  );
  assert.equal(plans.length, 100);
  assert.equal(new Set(plans.map(plan => plan.scenario_id)).size, 100);
  assert.equal(new Set(plans.map(plan => plan.candidate_view.task_prompt)).size, 100);
  assert.equal(new Set(plans.map(plan => plan.evaluator_plan.baseline.procedure)).size, 100);
  assert.deepEqual(
    plans.map(plan => plan.candidate_id),
    register.candidates.map((candidate: any) => candidate.id)
  );
  const runnable = new Set([
    ...listScenarioIds(),
    ...observabilityScenarios.map(scenario => scenario.id),
    ...localObservabilityScenarios.map(scenario => scenario.id),
  ]);
  for (const [index, plan] of plans.entries()) {
    const candidate = register.candidates[index];
    assert.equal(plan.scenario_id, `${candidate.id.toLowerCase()}-v1`);
    assert.equal(plan.lifecycle_state, 'draft');
    assert.equal(plan.execution.eligible, false);
    assert.equal(
      plan.execution.implementation,
      candidate.id === 'AKS-C059' ? 'isolated-component-implemented' : 'not-implemented'
    );
    assert.equal(plan.execution.qualification, 'pending');
    assert.deepEqual(plan.execution.results, []);
    assert.equal(plan.provenance.source_url, candidate.source);
    assert.equal(plan.provenance.source_body_sha256, candidate.sourceBodySha256);
    assert.equal(plan.provenance.reproduction_status, 'feasible-not-run');
    assert.equal(plan.evidence_classification.label, candidate.evidence);
    assert.equal(plan.evidence_classification.observability_only_verified, false);
    assert.equal(plan.evaluator_plan.fault.procedure, candidate.trigger);
    assert.equal(plan.evaluator_plan.fault.pass_condition, candidate.oracle);
    assert.equal(plan.evaluator_plan.recovery.procedure, candidate.recovery);
    assert.deepEqual(Object.keys(plan.candidate_view).sort(), [
      'instructions',
      'mode',
      'task_prompt',
    ]);
    assert.deepEqual(
      plan.evaluator_plan.controls.map(control => control.kind),
      ['healthy', 'insufficient-evidence']
    );
    assert.ok(plan.evaluator_plan.observations.length >= 2);
    assert.ok(!runnable.has(plan.scenario_id));
  }
});

test('draft discovery is offline and does not admit drafts to the execution runner', async context => {
  const output: unknown[] = [];
  context.mock.method(console, 'log', (value: string) => output.push(JSON.parse(value)));
  await observabilityMain(['list-drafts']);
  const listing = output.pop() as Array<{ scenario_id: string; execution_eligible: boolean }>;
  assert.equal(listing.length, 100);
  assert.ok(listing.every(plan => plan.execution_eligible === false));
  await observabilityMain(['show-draft', '--scenario', 'aks-c100-v1']);
  assert.deepEqual(
    output.pop(),
    loadAksCandidateScenarioPlans().find(plan => plan.scenario_id === 'aks-c100-v1')
  );
  await assert.rejects(observabilityMain(['show-draft']), /listed draft/);
  await assert.rejects(
    observabilityMain(['show-draft', '--scenario', 'aks-c999-v1']),
    /listed draft/
  );
  await assert.rejects(
    observabilityMain([
      'run',
      '--scenario',
      'aks-c001-v1',
      '--state-dir',
      '/unused-draft-state',
      '--accept-azure-costs',
    ]),
    /listed AKS case/
  );
  await observabilityMain(['list']);
  const implemented = output.pop() as Array<{ id: string }>;
  assert.ok(implemented.every(plan => !listing.some(draft => draft.scenario_id === plan.id)));
  await observabilityMain(['list-reproductions']);
  assert.deepEqual(
    (output.pop() as Array<{ id: string }>).map(item => item.id),
    ['aks-c059-v1']
  );
  await assert.rejects(
    observabilityMain(['verify-candidate', '--scenario', 'aks-c001-v1', '--state-dir', '/unused']),
    /No reproduction implementation/
  );
  await assert.rejects(
    observabilityMain(['verify-candidate', '--scenario', 'aks-c059-v1', '--state-dir', '/unused']),
    /--kubeconfig/
  );
});

test('research scenario plans preserve provenance and separate tasks from evaluator truth', () => {
  const candidate = {
    id: 'AKS-C001',
    source: 'https://github.com/Azure/AKS/issues/1',
    family: 'network',
    scenario: 'Private evaluator diagnosis',
    trigger: 'Private injection procedure',
    oracle: 'Private oracle observation',
    recovery: 'Private recovery procedure',
    fidelity: 'version-dependent',
    environment: 'A pinned historical environment',
    evidence: 'O',
    sourceTitle: 'Private source title',
    sourceCreatedAt: '2026-01-01',
    sourceUpdatedAt: '2026-01-02',
    sourceBodySha256: 'a'.repeat(64),
    reproductionStatus: 'feasible-not-run',
  };
  const register = { target: 1, researchDate: '2026-09-17', candidates: [candidate] };
  const designs = [
    {
      candidateId: 'AKS-C001',
      task: 'Investigate the failed request.',
      baseline: 'The request succeeds in the control.',
      evidence: ['Request result and network observations'],
    },
  ];
  const [plan] = buildAksCandidateScenarioPlans(register, designs);
  assert.equal(plan!.scenario_id, 'aks-c001-v1');
  assert.equal(plan!.execution.eligible, false);
  assert.equal(plan!.execution.qualification, 'pending');
  assert.equal(plan!.evidence_classification.observability_only_verified, false);
  assert.equal(plan!.provenance.source_body_sha256, candidate.sourceBodySha256);
  assert.equal(plan!.evaluator_plan.fault.procedure, candidate.trigger);
  assert.equal(plan!.evaluator_plan.fault.pass_condition, candidate.oracle);
  assert.equal(plan!.evaluator_plan.recovery.procedure, candidate.recovery);
  assert.ok(plan!.evaluator_plan.availability_gate.includes('Mark blocked'));
  assert.ok(!JSON.stringify(plan!.candidate_view).includes('Private'));
  designs[0]!.evidence.push('later mutation');
  assert.equal(plan!.evaluator_plan.observations.length, 1);
  assert.throws(() => buildAksCandidateScenarioPlans(register, []));
  assert.throws(
    () => buildAksCandidateScenarioPlans(register, [{ ...designs[0], candidateId: 'AKS-C002' }]),
    /Missing scenario design/
  );
  assert.throws(() =>
    buildAksCandidateScenarioPlans(
      { ...register, candidates: [{ ...candidate, evidence: 'verified' }] },
      designs
    )
  );
  assert.throws(() =>
    buildAksCandidateScenarioPlans(
      { ...register, candidates: [{ ...candidate, reproductionStatus: 'passed' }] },
      designs
    )
  );
  assert.throws(
    () =>
      buildAksCandidateScenarioPlans(
        { ...register, target: 2, candidates: [candidate, candidate] },
        [designs[0], designs[0]]
      ),
    /Duplicate candidate/
  );
});

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
          nodeVmSize: 'Standard_A2_v2',
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
      const backend = fake.calls.find(call => call.args[0] === 'vm' && call.args[1] === 'create');
      if (backend) {
        assert.ok(
          backend.args.includes('Canonical:0001-com-ubuntu-server-jammy:22_04-lts:22.04.202608060')
        );
        assert.ok(!backend.args.includes('--security-type'));
      }
      for (const call of fake.calls.filter(call => call.args.includes('--node-vm-size'))) {
        assert.equal(call.args[call.args.indexOf('--node-vm-size') + 1], 'Standard_A2_v2');
      }
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

for (const outcome of [
  'transient-conflict',
  'persistent-conflict',
  'permission-denied',
  'invalid-update',
]) {
  test(`autoscaler recovery handles ${outcome} without repeating the candidate`, async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'aks-recovery-'));
    const directory = path.join(root, 'run');
    const fake = fakeAzure(directory);
    let updates = 0;
    let candidates = 0;
    let waits = 0;
    const runner: CommandRunner = (executable, args) => {
      if (executable === 'az' && args.slice(0, 3).join(' ') === 'aks nodepool update') {
        updates++;
        if (outcome !== 'transient-conflict' || updates === 1) {
          return {
            status: 1,
            stdout: '',
            stderr: outcome.includes('conflict')
              ? '(OperationNotAllowed) There is an in-progress PutExtensionAddonHandler.PUT operation on the managed cluster.'
              : outcome === 'permission-denied'
              ? '(AuthorizationFailed) Permission denied.'
              : '(OperationNotAllowed) Invalid maximum count.',
          };
        }
      }
      return fake.runner(executable, args);
    };
    try {
      const run = withAksObservabilityFault(
        {
          scenario: 'aks-autoscaler-max-count-v1',
          subscription: '00000000-0000-0000-0000-000000000001',
          location: 'eastus2',
          stateDirectory: directory,
          workloadImage: `busybox@sha256:${'a'.repeat(64)}`,
          acceptAzureCosts: true,
          runner,
          wait: async () => {
            waits++;
          },
        },
        async () => {
          candidates++;
          return 'retained-result';
        }
      );
      if (outcome === 'transient-conflict') {
        const result = await run;
        assert.equal(result.candidate, 'retained-result');
        assert.equal(updates, 2);
        assert.equal(waits, 1);
      } else {
        await assert.rejects(
          run,
          outcome === 'persistent-conflict' ? /did not converge/ : /recovery failed/
        );
        assert.equal(updates, outcome === 'persistent-conflict' ? 60 : 1);
        assert.equal(waits, outcome === 'persistent-conflict' ? 59 : 0);
      }
      assert.equal(candidates, 1);
      assert.equal(
        JSON.parse(readFileSync(path.join(directory, 'state.json'), 'utf8')).cleanup,
        'passed'
      );
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
