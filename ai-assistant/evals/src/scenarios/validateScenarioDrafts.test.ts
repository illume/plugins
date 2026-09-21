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
  orderedDraftScenarioIds,
  observedValueMatches,
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
    metadata: { labels: { owner: 'platform' } },
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
});

test('field resolver rejects encoded and composite predicates instead of claiming validation', () => {
  assert.throws(
    () => resolveFieldPath({ data: {} }, 'data.evidence.json#arguments.--request-timeout'),
    /unsupported executable field path/
  );
  assert.throws(
    () => resolveFieldPath({ spec: {} }, 'spec.type + spec.ports[0].nodePort'),
    /unsupported executable field path/
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
});
