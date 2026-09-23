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
import type { AcceptedFact } from '../contracts/evaluationContracts.js';
import {
  prometheusFactMatched,
  prometheusQueryForFact,
  prometheusRawQueryForFact,
} from './prometheusMetricFacts.js';

const fact = (overrides: Partial<AcceptedFact>): AcceptedFact => ({
  fact_id: 'crash-loop-restarts-increase',
  resource_ref: 'metric/kube_pod_container_status_restarts_total{pod="crash-loop",container="app"}',
  field_path: 'increase[10m]',
  observed_value: '> 0',
  ...overrides,
});

test('Prometheus queries scope namespaced kube-state metrics to the trial', () => {
  const query = prometheusQueryForFact(fact({}), 'trial');
  assert.match(query, /namespace="trial"/);
  assert.match(query, /increase\(/);
  assert.match(query, /> 0$/);
});

test('Prometheus queries map cAdvisor and quota predicates explicitly', () => {
  assert.match(
    prometheusQueryForFact(
      fact({
        fact_id: 'trigger-evidence',
        resource_ref: 'metric/container_cpu_cfs_throttled_periods_total{pod="cpu-throttle-probe"}',
      }),
      'trial'
    ),
    /container_cpu_cfs_periods_total.*namespace="trial"/
  );
  assert.match(
    prometheusQueryForFact(
      fact({
        fact_id: 'trigger-evidence',
        resource_ref: 'metric/kube_resourcequota + kube_node_status_allocatable',
        field_path: 'sum(hard requests.cpu) / sum(allocatable cpu)',
      }),
      'trial'
    ),
    /kube_resourcequota\{namespace="trial".*> 1\.5/
  );
});

test('raw contradiction selectors retain namespace isolation', () => {
  assert.match(
    prometheusRawQueryForFact(fact({ fact_id: 'invented-zero-restarts' }), 'trial'),
    /namespace="trial"/
  );
});

test('filtered Prometheus results require a finite sample, including retained zeroes', () => {
  assert.equal(prometheusFactMatched([]), false);
  assert.equal(prometheusFactMatched([{ labels: {}, timestamp: 1, value: 0 }]), true);
  assert.equal(prometheusFactMatched([{ labels: {}, timestamp: 1, value: 1 }]), true);
});
