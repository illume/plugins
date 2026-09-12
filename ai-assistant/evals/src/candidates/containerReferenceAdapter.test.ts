/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeCommandRunner } from '../cluster/commandRunner.js';
import { loadScenario } from '../scenarios/loader.js';
import { HolmesGptAdapter } from './holmesGptAdapter.js';
import { K8sGptAdapter } from './k8sGptAdapter.js';
import { qualifyReferenceAdapter } from './referenceQualification.js';

const image = `registry.example/reference@sha256:${'a'.repeat(64)}`;
const input = {
  packet: loadScenario('core-service-selector-fault-v1').candidatePacket,
  observations: [],
  evidence_digest: 'b'.repeat(64),
};

test('concrete reference adapters require immutable image digests', () => {
  assert.throws(
    () => new HolmesGptAdapter({ image: 'registry.example/holmes:latest', kubeconfigPath: '/k' }),
    /pinned by sha256/
  );
});

for (const Adapter of [HolmesGptAdapter, K8sGptAdapter]) {
  test(`${Adapter.name} qualifies image startup, health, and fixed-submission parity`, async () => {
    const fake = createFakeCommandRunner([
      {
        match: ['docker', 'image', 'inspect', image],
        result: { status: 0, stdout: '[]', stderr: '' },
      },
      {
        match: ['docker', 'run', '--rm'],
        result: { status: 0, stdout: 'version', stderr: '' },
      },
    ]);
    const adapter = new Adapter({
      image,
      kubeconfigPath: '/tmp/eval-kubeconfig',
      runner: fake.runner,
    });
    const disposition = await qualifyReferenceAdapter(
      adapter,
      input,
      '{"schema_version":"1.0.0","cause_facts":[]}'
    );

    assert.equal(disposition.status, 'eligible');
    const expectedPrefix = [
      'run',
      '--rm',
      '--network=none',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=16m',
      ...(Adapter === K8sGptAdapter
        ? ['--tmpfs', '/home/nonroot/.config:rw,noexec,nosuid,size=16m']
        : []),
      '--volume',
      '/tmp/eval-kubeconfig:/root/.kube/config:ro',
      image,
    ];
    assert.deepEqual(fake.calls[1]?.args.slice(0, expectedPrefix.length), expectedPrefix);
  });
}
