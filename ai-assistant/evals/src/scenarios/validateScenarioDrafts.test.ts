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
import test from 'node:test';
import type { JsonValue } from '../canonicalJson.js';
import {
  factValueMatches,
  orderedDraftScenarioIds,
  observedValueMatches,
  resolveFactField,
  resolveFieldPath,
  serializeObservedValue,
} from './validateScenarioDrafts.js';

test('draft validation order starts immediately after the active 275', () => {
  const ids = orderedDraftScenarioIds();
  assert.equal(ids.length, 980);
  assert.equal(ids[0], 'rule-gap-missing-liveness-probe');
  assert.equal(ids[1], 'rule-gap-missing-readiness-probe');
});

test('field resolver observes nested values, array elements, and absent fields', () => {
  const resource = {
    spec: {
      template: {
        spec: {
          containers: [{ securityContext: { readOnlyRootFilesystem: false } }],
        },
      },
    },
    metadata: {
      labels: { owner: 'platform' },
      annotations: { 'evals.kubernetes.io/apply-to-current-host': 'false' },
    },
  } as JsonValue;
  assert.equal(
    resolveFieldPath(
      resource,
      'spec.template.spec.containers[0].securityContext.readOnlyRootFilesystem'
    ),
    false
  );
  assert.equal(resolveFieldPath(resource, 'metadata.labels[owner]'), 'platform');
  assert.equal(
    resolveFieldPath(resource, 'metadata.annotations.evals.kubernetes.io/apply-to-current-host'),
    'false'
  );
  assert.equal(
    serializeObservedValue(
      resolveFieldPath(resource, 'spec.template.spec.containers[0].livenessProbe')
    ),
    '<absent>'
  );
  assert.deepEqual(
    resolveFieldPath(
      resource,
      'spec.template.spec.containers[*].securityContext.readOnlyRootFilesystem'
    ),
    [false]
  );
  assert.equal(resolveFieldPath({ items: [] }, 'items.length'), 0);
  assert.equal(
    resolveFieldPath(
      { items: [{ metadata: { name: 'web' } }, { metadata: { name: 'api' } }] },
      'items[metadata.name=missing-web].length'
    ),
    0
  );
  assert.equal(
    resolveFieldPath(
      { status: { conditions: [{ type: 'Progressing', reason: 'Deadline' }] } },
      'status.conditions[?type=Progressing].reason'
    ),
    'Deadline'
  );
  assert.deepEqual(
    resolveFieldPath({ spec: { type: 'NodePort', port: 30080 } }, 'spec.type + spec.port'),
    ['NodePort', 30080]
  );
});

test('field resolver observes JSONPath-style named container predicates', () => {
  const pod = {
    status: {
      containerStatuses: [
        {
          name: 'app',
          state: { waiting: { reason: 'CrashLoopBackOff' } },
          lastState: { terminated: { exitCode: 42 } },
        },
      ],
    },
  };
  assert.equal(
    resolveFieldPath(pod, 'status.containerStatuses[?(@.name=="app")].state.waiting.reason'),
    'CrashLoopBackOff'
  );
  assert.equal(
    resolveFieldPath(
      pod,
      'status.containerStatuses[?(@.name=="app")].lastState.terminated.exitCode'
    ),
    42
  );
});

test('field resolver rejects malformed encoded predicates instead of claiming validation', () => {
  assert.throws(
    () => resolveFactField({ data: { 'config.yaml': 3 } }, 'data.config.yaml#spec.value'),
    /is not a string/
  );
  assert.equal(
    resolveFieldPath({ spec: {} }, 'spec.securityContext + spec.containerSecurityContext'),
    '<both absent>'
  );
});

test('fact resolver decodes exact and wildcard ConfigMap YAML fields', () => {
  const resource = {
    data: {
      'config.yaml': 'authentication:\n  anonymous:\n    enabled: true\n',
      'api.yaml': 'spec:\n  containers:\n    - command: [server, --profiling=true]\n',
      'scheduler.yaml': 'spec:\n  containers:\n    - command: [scheduler, --profiling=true]\n',
    },
  } as JsonValue;
  assert.equal(
    resolveFactField(resource, 'data.config.yaml#authentication.anonymous.enabled'),
    true
  );
  assert.deepEqual(resolveFactField(resource, 'data.*.yaml#spec.containers[0].command'), [
    ['server', '--profiling=true'],
    ['scheduler', '--profiling=true'],
  ]);
  assert.equal(
    resolveFactField(
      { data: { 'payload.b64': 'IyEvYmluL3NoCnByaW50ZiBjb250cm9sbGVkXG4=' } },
      'data.payload.b64'
    ),
    '#!/bin/sh\nprintf controlled\\n'
  );
  assert.equal(
    resolveFactField(
      { data: { 'package.json': '{"scripts":{"postinstall":"printf controlled"}}' } },
      'data.package.json.scripts.postinstall'
    ),
    'printf controlled'
  );
  assert.equal(
    resolveFactField(
      {
        data: {
          'observation.json': JSON.stringify({
            field: 'authentication.anonymous.enabled',
            observedValue: 'true',
          }),
        },
      },
      'data.observation.json#authentication.anonymous.enabled'
    ),
    'true'
  );
  assert.equal(
    resolveFactField(
      {
        data: {
          'evidence.json': JSON.stringify({
            exactField: 'admissionPlugins.EventRateLimit.enabled',
            brokenValue: 'false',
          }),
        },
      },
      'data.evidence.json#admissionPlugins.EventRateLimit.enabled'
    ),
    'false'
  );
  assert.equal(
    resolveFactField(
      {
        data: {
          'healthy-control.json': JSON.stringify({
            exactField: 'admissionPlugins.EventRateLimit.enabled',
            healthyValue: 'true',
          }),
        },
      },
      'data.healthy-control.json#admissionPlugins.EventRateLimit.enabled'
    ),
    'true'
  );
});

test('observed values use evaluator canonical strings', () => {
  assert.equal(serializeObservedValue(undefined), '<absent>');
  assert.equal(serializeObservedValue(false), 'false');
  assert.equal(serializeObservedValue(['NET_RAW']), '["NET_RAW"]');
  assert.equal(serializeObservedValue({ app: 'web' }), '{"app":"web"}');
  assert.equal(
    observedValueMatches(
      '{"containerPort":8080,"name":"web","protocol":"TCP"}',
      '{"protocol":"TCP","name":"web","containerPort":8080}'
    ),
    true
  );
  assert.equal(observedValueMatches('<absent>', 'absent'), true);
  assert.equal(factValueMatches(undefined, '[]'), true);
  assert.equal(factValueMatches({}, 'field absent'), true);
  assert.equal(factValueMatches(['SYS_ADMIN'], '[SYS_ADMIN]'), true);
  assert.equal(
    factValueMatches(
      { apiGroups: [''], resources: ['pods/exec'], verbs: ['create'] },
      'apiGroups=[""]; resources=["pods/exec"]; verbs=["create"]'
    ),
    true
  );
  assert.equal(
    factValueMatches(
      '-----BEGIN PRIVATE KEY-----\nfixture\n-----END PRIVATE KEY-----',
      'PEM private-key header and footer present'
    ),
    true
  );
  assert.equal(
    factValueMatches(
      'first command\nsecond command\nthird command',
      'first command; third command'
    ),
    true
  );
  assert.equal(
    factValueMatches(['kube-apiserver', '--secure-port=6443'], 'audit-log-path argument absent'),
    true
  );
  assert.equal(
    factValueMatches(
      ['kube-apiserver', '--etcd-certfile=/tmp/client.crt'],
      'etcd-certfile present; etcd-keyfile absent'
    ),
    true
  );
  assert.equal(
    factValueMatches(
      [
        ['api', '--profiling=true'],
        ['controller', '--profiling=true'],
        ['scheduler', '--profiling=true'],
      ],
      '3 of 3 contain --profiling=true'
    ),
    true
  );
});

test('fact matcher evaluates numeric threshold predicates', () => {
  assert.equal(factValueMatches(1, '> 0'), true);
  assert.equal(factValueMatches(0, '> 0'), false);
  assert.equal(factValueMatches(0.1, '<= 0.2'), true);
});
