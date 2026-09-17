/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readClosedBundle } from '../storage/bundleReader.js';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratchDir.js';
import { isCandidateSpec, runEvaluation, selectScenarios } from './orchestrate.js';

test('selectScenarios: local-kwok defaults to exactly the generated KWOK-compatible subset', () => {
  const scenarios = selectScenarios('local-kwok', undefined, undefined, { phase: 1 });
  const ids = scenarios.map(s => s.manifest.scenario_id).sort();
  assert.deepEqual(ids, ['core-service-selector-fault-v1', 'core-service-selector-healthy-v1']);
});

test('selectScenarios: aks defaults to every scenario declaring aks support', () => {
  const scenarios = selectScenarios('aks', undefined, undefined, { phase: 1 });
  const ids = scenarios.map(s => s.manifest.scenario_id).sort();
  assert.deepEqual(ids, [
    'core-pending-underdetermined-v1',
    'core-service-selector-fault-v1',
    'core-service-selector-healthy-v1',
    'core-unschedulable-capacity-v1',
  ]);
});

test('selectScenarios: explicitly requesting an incompatible case on local-kwok is a hard error', () => {
  assert.throws(
    () => selectScenarios('local-kwok', ['core-unschedulable-capacity-v1']),
    /not in the generated KWOK-compatible subset/
  );
});

test('selectScenarios: explicitly requesting an unknown case is a hard error', () => {
  assert.throws(
    () => selectScenarios('local-kwok', ['does-not-exist']),
    /unknown or inactive scenario/
  );
});

test('selectScenarios: portfolio, split, and stratum filters compose', () => {
  const scenarios = selectScenarios('local-minikube', undefined, undefined, {
    phase: 1,
    split: 'capability',
    stratum: 'fault_diagnosis',
  });
  assert.deepEqual(scenarios.map(scenario => scenario.manifest.scenario_id).sort(), [
    'core-service-selector-fault-v1',
    'core-unschedulable-capacity-v1',
  ]);
});

test('selectScenarios: explicit IDs must match portfolio filters', () => {
  assert.throws(
    () =>
      selectScenarios('local-minikube', ['core-service-selector-fault-v1'], undefined, {
        phase: 2,
      }),
    /does not match the requested portfolio selection/
  );
});

test('isCandidateSpec: recognizes every valid spec and rejects anything else', () => {
  assert.equal(isCandidateSpec('reference'), true);
  assert.equal(isCandidateSpec('partial'), true);
  assert.equal(isCandidateSpec('abstaining'), true);
  assert.equal(isCandidateSpec('overconfident'), true);
  assert.equal(isCandidateSpec('unsupported-evidence'), true);
  assert.equal(isCandidateSpec('unsafe-effective'), true);
  assert.equal(isCandidateSpec('injected'), true);
  assert.equal(isCandidateSpec('headlamp-cli'), true);
  assert.equal(isCandidateSpec('headlamp-cli-legacy'), true);
  assert.equal(isCandidateSpec('holmesgpt'), true);
  assert.equal(isCandidateSpec('k8sgpt'), true);
  assert.equal(isCandidateSpec('kubectl-ai'), true);
  assert.equal(isCandidateSpec('not-a-real-spec'), false);
});

test('runEvaluation: rejects Holmes repair scenarios before candidate execution', async () => {
  const dir = makeScratchDir('orchestrate-holmes-repair');
  try {
    await assert.rejects(
      runEvaluation({
        runId: 'run_holmes_repair',
        runsRoot: dir,
        profile: 'local-minikube',
        mode: 'real',
        cases: ['core-service-selector-repair-v1'],
        candidate: 'holmesgpt',
        holmesModel: 'azure/gpt-4o',
      }),
      /holmesgpt does not support repair_submission@1\.0\.0 scenarios: core-service-selector-repair-v1/
    );
  } finally {
    removeScratchDir(dir);
  }
});

test('runEvaluation: rejects K8sGPT repair scenarios before candidate execution', async () => {
  const dir = makeScratchDir('orchestrate-k8sgpt-repair');
  try {
    await assert.rejects(
      runEvaluation({
        runId: 'run_k8sgpt_repair',
        runsRoot: dir,
        profile: 'local-minikube',
        mode: 'real',
        cases: ['core-service-selector-repair-v1'],
        candidate: 'k8sgpt',
      }),
      /k8sgpt does not support repair_submission@1\.0\.0 scenarios: core-service-selector-repair-v1/
    );
  } finally {
    removeScratchDir(dir);
  }
});

test('runEvaluation: requires an explicit K8sGPT explain model', async () => {
  const dir = makeScratchDir('orchestrate-k8sgpt-model');
  try {
    await assert.rejects(
      runEvaluation({
        runId: 'run_k8sgpt_model',
        runsRoot: dir,
        profile: 'local-minikube',
        mode: 'real',
        cases: ['core-pvc-storageclass-healthy-v1'],
        candidate: 'k8sgpt',
      }),
      /k8sgpt requires --k8sgpt-model <model>/
    );
    assert.equal(existsSync(path.join(dir, 'run_k8sgpt_model')), false);
  } finally {
    removeScratchDir(dir);
  }
});

test('runEvaluation: rejects a K8sGPT baseline on a non-isolated profile before writing a bundle', async () => {
  const dir = makeScratchDir('orchestrate-k8sgpt-profile');
  try {
    await assert.rejects(
      runEvaluation({
        runId: 'run_k8sgpt_profile',
        runsRoot: dir,
        profile: 'aks',
        mode: 'real',
        cases: ['core-service-selector-healthy-v1'],
        candidate: 'reference',
        baseline: 'k8sgpt',
        k8sGptModel: 'gpt-4o',
        k8sGptDeployment: 'gpt-4o',
      }),
      /k8sgpt requires --profile local-minikube/
    );
    assert.equal(existsSync(path.join(dir, 'run_k8sgpt_profile')), false);
  } finally {
    removeScratchDir(dir);
  }
});

test('runEvaluation: kubectl-ai admission fails before writing bundles', async () => {
  const dir = makeScratchDir('orchestrate-kubectl-ai');
  try {
    for (const baseline of [false, true]) {
      const base = {
        runId: 'run_kubectl_ai',
        runsRoot: dir,
        profile: 'local-minikube' as const,
        mode: 'real' as const,
        cases: ['core-pvc-storageclass-healthy-v1'],
        candidate: baseline ? ('reference' as const) : ('kubectl-ai' as const),
        ...(baseline ? { baseline: 'kubectl-ai' as const } : {}),
      };
      await assert.rejects(runEvaluation(base), /requires --kubectl-ai-image/);
      await assert.rejects(runEvaluation({ ...base, mode: 'dry-run' }), /requires --execute real/);
      await assert.rejects(
        runEvaluation({ ...base, cases: ['core-service-selector-repair-v1'] }),
        /kubectl-ai does not support repair/
      );
      assert.equal(existsSync(path.join(dir, base.runId)), false);
    }
  } finally {
    removeScratchDir(dir);
  }
});

test('runEvaluation: end-to-end local-kwok run with baseline/candidate produces regression deltas', async () => {
  const dir = makeScratchDir('orchestrate-e2e');
  try {
    const contractStoreRoot = path.join(dir, 'contracts');
    const outcome = await runEvaluation({
      runId: 'run_e2e_1',
      runsRoot: dir,
      contractStoreRoot,
      profile: 'local-kwok',
      mode: 'dry-run',
      selection: { phase: 1 },
      candidate: 'reference',
      baseline: 'wrong',
    });
    assert.equal(outcome.trials.length, 4); // 2 scenarios x 2 candidate passes
    const passing = outcome.trials.filter(t => t.candidate_id === 'scripted-reference');
    assert.equal(passing.length, 2);
    assert.ok(passing.every(t => t.dimensions.root_cause.outcome === 'pass'));
    const bundle = readClosedBundle(dir, outcome.runId, contractStoreRoot);
    const schemaReferences = bundle.contractReferences.filter(
      reference => reference.role === 'schema'
    );
    const schemaFileNames = readdirSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema')
    )
      .filter(fileName => fileName.endsWith('.schema.json'))
      .sort();
    assert.deepEqual(
      [...new Set(schemaReferences.map(reference => path.basename(reference.uri)))].sort(),
      schemaFileNames
    );
    assert.equal(schemaReferences.length, schemaFileNames.length * passing.length);
    assert.deepEqual(
      [...new Set(bundle.contractReferences.map(reference => reference.role))].sort(),
      [
        'candidate_packet',
        'evaluator_packet',
        'fixture',
        'grader',
        'manifest',
        'policy',
        'schema',
        'verifier',
      ]
    );
    const graderReference = bundle.contractReferences.find(
      reference => reference.role === 'grader'
    );
    assert.match(
      graderReference?.uri ?? '',
      /^contracts:\/\/protected-contract-store\/implementations\/grader\/[a-f0-9]{64}\//
    );

    const protectedReference = bundle.contractReferences.find(
      reference => reference.role === 'evaluator_packet'
    );
    assert.ok(protectedReference);
    const protectedPath = path.join(
      contractStoreRoot,
      ...protectedReference.uri.slice('contracts://'.length).split('/')
    );
    const original = readFileSync(protectedPath, 'utf8');
    writeFileSync(protectedPath, `${original}\n`, 'utf8');
    assert.throws(
      () => readClosedBundle(dir, outcome.runId, contractStoreRoot),
      /contract digest mismatch/
    );
  } finally {
    removeScratchDir(dir);
  }
});

test('runEvaluation: a single-candidate run has no regression-deltas rows', async () => {
  const dir = makeScratchDir('orchestrate-single');
  try {
    const outcome = await runEvaluation({
      runId: 'run_single_1',
      runsRoot: dir,
      contractStoreRoot: path.join(dir, 'contracts'),
      profile: 'local-kwok',
      mode: 'dry-run',
      selection: { phase: 1 },
      candidate: 'reference',
    });

    assert.equal(outcome.trials.length, 2);
  } finally {
    removeScratchDir(dir);
  }
});

test('runEvaluation: rejects identical baseline and candidate configurations', async () => {
  const dir = makeScratchDir('orchestrate-identical');
  try {
    await assert.rejects(
      runEvaluation({
        runId: 'run_identical',
        runsRoot: dir,
        contractStoreRoot: path.join(dir, 'contracts'),
        profile: 'local-kwok',
        mode: 'dry-run',
        candidate: 'headlamp-cli',
        baseline: 'headlamp-cli',
      }),
      /must identify distinct configurations/
    );
  } finally {
    removeScratchDir(dir);
  }
});

test('runEvaluation: rerun lineage is retained on the replacement trial', async () => {
  const dir = makeScratchDir('orchestrate-rerun');
  try {
    const outcome = await runEvaluation({
      runId: 'run_rerun',
      runsRoot: dir,
      contractStoreRoot: path.join(dir, 'contracts'),
      profile: 'local-kwok',
      mode: 'dry-run',
      candidate: 'reference',
      cases: ['core-service-selector-fault-v1'],
      supersedesTrialId: 'trial_original',
    });
    assert.equal(outcome.trials[0]?.supersedes_trial_id, 'trial_original');
    assert.equal(outcome.trials[0]?.execution_mode, 'dry-run');
  } finally {
    removeScratchDir(dir);
  }
});

test('runEvaluation: Phase 2B controls keep task and safety outcomes orthogonal', async () => {
  const controls = [
    { candidate: 'unsupported-evidence', rootCause: 'fail', safety: 'pass' },
    { candidate: 'unsafe-effective', rootCause: 'pass', safety: 'fail' },
    { candidate: 'injected', rootCause: 'pass', safety: 'fail' },
  ] as const;

  for (const control of controls) {
    const dir = makeScratchDir(`orchestrate-${control.candidate}`);
    try {
      const outcome = await runEvaluation({
        runId: `run_${control.candidate}`,
        runsRoot: dir,
        contractStoreRoot: path.join(dir, 'contracts'),
        profile: 'local-kwok',
        mode: 'dry-run',
        cases: ['core-service-selector-fault-v1'],
        candidate: control.candidate,
      });
      assert.equal(outcome.trials[0]?.dimensions.root_cause.outcome, control.rootCause);
      assert.equal(outcome.trials[0]?.safety_outcome, control.safety);
    } finally {
      removeScratchDir(dir);
    }
  }
});
