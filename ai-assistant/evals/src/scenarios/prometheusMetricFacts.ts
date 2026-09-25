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

import type { PrometheusSample } from '../cluster/clusterAdapter.js';
import type { AcceptedFact } from '../contracts/evaluationContracts.js';

const quote = (value: string): string => JSON.stringify(value);

const addNamespace = (selector: string, namespace: string): string => {
  const match = /^([^\{]+)(?:\{(.*)\})?$/.exec(selector);
  if (!match) throw new Error(`invalid metric selector: ${selector}`);
  const labels = [match[2], `namespace=${quote(namespace)}`].filter(Boolean).join(',');
  return `${match[1]}{${labels}}`;
};

const addContainer = (selector: string, container: string): string => {
  const match = /^([^\{]+)(?:\{(.*)\})?$/.exec(selector);
  if (!match) throw new Error(`invalid metric selector: ${selector}`);
  const labels = [match[2], `container=${quote(container)}`].filter(Boolean).join(',');
  return `${match[1]}{${labels}}`;
};

const metricSelector = (fact: AcceptedFact): string => {
  const selector = fact.resource_ref.slice('metric/'.length);
  if (!selector || selector.includes(' + '))
    throw new Error(`compound metric requires an explicit query: ${fact.resource_ref}`);
  return selector;
};

/** Builds one truth-valued PromQL query for a committed evaluator metric fact. */
export function prometheusQueryForFact(fact: AcceptedFact, namespace: string): string {
  if (fact.resource_ref.includes(' + ')) {
    if (fact.field_path.includes('requests.cpu')) {
      return `sum(kube_resourcequota{namespace=${quote(
        namespace
      )},type="hard",resource="requests.cpu"}) / clamp_min(sum(kube_node_status_allocatable{resource="cpu",unit="core"}), 0.001) ${
        fact.fact_id === 'healthy-control' ? '<= 1.0' : '> 1.5'
      }`;
    }
    if (fact.field_path.includes('requests.memory')) {
      return `sum(kube_resourcequota{namespace=${quote(
        namespace
      )},type="hard",resource="requests.memory"}) / clamp_min(sum(kube_node_status_allocatable{resource="memory",unit="byte"}), 1) ${
        fact.fact_id === 'healthy-control' ? '<= 1.0' : '> 1.5'
      }`;
    }
  }
  const selector = metricSelector(fact);
  switch (fact.fact_id) {
    case 'crash-loop-restarts-increase':
      return `increase(${addNamespace(selector, namespace)}[2m]) > 0`;
    case 'readiness-signal-absent':
      return `max_over_time(${addNamespace(selector, namespace)}[2m]) == 0`;
    case 'eviction-counter-increase':
      return `increase(${selector}[2m]) > 0`;
    case 'evicted-status-sustained':
      return `max_over_time(${addNamespace(selector, namespace)}[30s]) == 1`;
    case 'node-not-ready-metric':
    case 'memory-pressure-sustained':
    case 'persistent-volume-failed-metric':
      return `min_over_time(${selector}[30s]) == 1`;
    case 'kubelet-target-down':
      return `absent_over_time(${selector}[2m]) or max_over_time(${selector}[2m]) == 0`;
    case 'volume-free-bytes-low':
      return `${addNamespace(selector, namespace)} / ${addNamespace(
        'kubelet_volume_stats_capacity_bytes{persistentvolumeclaim="bytes-filling"}',
        namespace
      )} < 0.10`;
    case 'volume-free-bytes-exhaustion-predicted':
      return `predict_linear(${addNamespace(selector, namespace)}[2m], 21600) < 0`;
    case 'volume-free-inodes-low':
      return `${addNamespace(selector, namespace)} / ${addNamespace(
        'kubelet_volume_stats_inodes{persistentvolumeclaim="inodes-filling"}',
        namespace
      )} < 0.10`;
    case 'volume-inode-exhaustion-predicted':
      return `predict_linear(${addNamespace(selector, namespace)}[2m], 21600) < 0`;
    case 'job-failure-metric':
      return `${addNamespace(selector, namespace)} >= 1`;
    case 'job-age-exceeds-window':
      return `time() - ${addNamespace(selector, namespace)} > 10`;
    case 'api-fast-burn':
      return `sum(increase(apiserver_request_total{group="burn.telemetry.example",code=~"5.."}[1m])) / clamp_min(sum(increase(apiserver_request_total{group="burn.telemetry.example"}[1m])), 1) > 0.05`;
    case 'certificate-warning-horizon-crossed':
      return `histogram_quantile(0.01, sum by (le) (rate(${selector}_bucket[2m]))) < 604800`;
    case 'daemonset-unavailable-sustained':
      return `min_over_time(${addNamespace(selector, namespace)}[2m]) > 0`;
    case 'statefulset-ready-mismatch-sustained':
      return `max_over_time(${addNamespace(selector, namespace)}[2m]) < ${addNamespace(
        'kube_statefulset_replicas{statefulset="not-ready-db"}',
        namespace
      )}`;
    case 'cluster-cpu-requests-over-allocatable':
      return `sum(kube_pod_container_resource_requests{namespace=${quote(
        namespace
      )},resource="cpu",unit="core"}) / clamp_min(sum(kube_node_status_allocatable{resource="cpu",unit="core"}), 0.001) > 1`;
    case 'cluster-memory-requests-over-allocatable':
      return `sum(kube_pod_container_resource_requests{namespace=${quote(
        namespace
      )},resource="memory",unit="byte"}) / clamp_min(sum(kube_node_status_allocatable{resource="memory",unit="byte"}), 1) > 1`;
    case 'trigger-evidence':
      if (selector.startsWith('container_cpu_cfs_throttled_periods_total')) {
        return `sum(rate(${addNamespace(
          addContainer(selector, ''),
          namespace
        )}[2m])) / clamp_min(sum(rate(${addNamespace(
          'container_cpu_cfs_periods_total{pod="cpu-throttle-probe",container=""}',
          namespace
        )}[2m])), 0.001) > 0.8`;
      }
      if (selector.startsWith('kubelet_pleg_relist_duration_seconds_bucket')) {
        return `histogram_quantile(0.99, sum by (le) (rate(${selector}[2m]))) > 10`;
      }
      if (selector.startsWith('kubelet_pod_start_duration_seconds_bucket')) {
        return `histogram_quantile(0.99, sum by (le) (rate(${selector}[2m]))) > 30`;
      }
      break;
    case 'healthy-or-confounding-state':
      if (selector.startsWith('container_cpu_cfs_throttled_periods_total')) {
        return `sum(rate(${addNamespace(
          addContainer(selector, ''),
          namespace
        )}[2m])) / clamp_min(sum(rate(${addNamespace(
          'container_cpu_cfs_periods_total{pod="cpu-throttle-probe",container=""}',
          namespace
        )}[2m])), 0.001) < 0.2`;
      }
      if (selector.startsWith('kubelet_pleg_relist_duration_seconds_bucket')) {
        return `histogram_quantile(0.99, sum by (le) (rate(${selector}[2m]))) < 1`;
      }
      if (selector.startsWith('kubelet_pod_start_duration_seconds_bucket')) {
        return `histogram_quantile(0.99, sum by (le) (rate(${selector}[2m]))) < 5`;
      }
      break;
    case 'aggregated-api-unavailable-metric':
      return `max_over_time(${selector}[30s]) == 1`;
    case 'client-renewal-errors-increase':
    case 'server-renewal-errors-increase':
      return `increase(${selector}[2m]) > 0`;
    case 'renewal-denials-recorded':
      return `increase(${selector}[2m]) >= 2`;
  }
  throw new Error(`no Prometheus query mapping for ${fact.fact_id}: ${fact.resource_ref}`);
}

/** Filtered PromQL returns at least one finite sample only when its predicate is true. */
export function prometheusFactMatched(samples: PrometheusSample[]): boolean {
  return samples.some(sample => Number.isFinite(sample.value));
}

/** Builds an unfiltered query for threshold diagnostics when the predicate is false. */
export function prometheusDiagnosticQueryForFact(
  fact: AcceptedFact,
  namespace: string
): string | undefined {
  const selector = fact.resource_ref.slice('metric/'.length);
  if (
    fact.fact_id === 'trigger-evidence' &&
    selector.startsWith('container_cpu_cfs_throttled_periods_total')
  ) {
    return `sum(rate(${addNamespace(
      addContainer(selector, ''),
      namespace
    )}[2m])) / clamp_min(sum(rate(${addNamespace(
      'container_cpu_cfs_periods_total{pod="cpu-throttle-probe",container=""}',
      namespace
    )}[2m])), 0.001)`;
  }
  if (
    fact.fact_id === 'trigger-evidence' &&
    selector.startsWith('kubelet_pleg_relist_duration_seconds_bucket')
  ) {
    return `histogram_quantile(0.99, sum by (le) (rate(${selector}[2m])))`;
  }
  return undefined;
}

/** Builds a raw selector query for contradiction facts without a predicate mapping. */
export function prometheusRawQueryForFact(fact: AcceptedFact, namespace: string): string {
  const selector = metricSelector(fact);
  return /^(?:kube_|container_)/.test(selector) && !selector.startsWith('kube_node_')
    ? addNamespace(selector, namespace)
    : selector;
}
