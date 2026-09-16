import type { JsonValue } from '../canonicalJson.js';

export type ObservabilityToolName =
  | 'datadog_read'
  | 'splunk_read'
  | 'grafana_read'
  | 'prometheus_read'
  | 'azure_monitor_traces_read'
  | 'azure_network_config_read';

export interface ObservabilityScenario {
  schemaVersion: '1.0.0';
  source: 'synthetic';
  visibility: 'public';
  id: string;
  family: string;
  lifecycle: 'draft';
  qualification: 'pending';
  task: string;
  kubernetesEvidence: JsonValue;
  requiredTool: ObservabilityToolName;
  investigation: Record<string, unknown>;
  request: {
    url: string;
    method: 'GET' | 'POST';
    body?: Record<string, JsonValue>;
  };
  response: JsonValue;
  expectedFacts: Array<{ field_path: string; observed_value: string }>;
}

const healthyKubernetesEvidence: JsonValue = {
  namespace: 'checkout',
  deployment: { name: 'checkout', replicas: 3, readyReplicas: 3, updatedReplicas: 3 },
  pods: { phase: 'Running', ready: true, restarts: 0 },
  service: { name: 'checkout', selector: { app: 'checkout' }, readyEndpoints: 3 },
  events: [],
  logs: 'Request processing delayed; detailed dependency telemetry is exported externally.',
};

const start = '2026-09-16T10:00:00Z';
const end = '2026-09-16T11:00:00Z';
const nic =
  '/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/eval-nodes/providers/Microsoft.Network/networkInterfaces/worker';
const readOnlyTask =
  ' Investigate only from retrieved evidence; do not change resources. Report insufficient evidence if the cause cannot be established. The read requests below describe the bounded fixture API, not the answer.';

type Family = Pick<
  ObservabilityScenario,
  'family' | 'task' | 'requiredTool' | 'investigation' | 'request'
> & {
  variants: Array<Pick<ObservabilityScenario, 'response' | 'expectedFacts'>>;
};

const families: Family[] = [
  {
    family: 'external-queue-lag',
    task: 'Checkout processing is delayed while all Pods are ready. Identify which externally managed dependency queue has accumulated a backlog. These queues and their history are not stored in Kubernetes.',
    requiredTool: 'prometheus_read',
    investigation: { action: 'query', query: 'checkout_dependency_backlog', time: end },
    request: {
      url: `https://prometheus.eval.invalid/api/v1/query?query=checkout_dependency_backlog&time=${encodeURIComponent(
        end
      )}`,
      method: 'GET',
    },
    variants: ['payments', 'inventory'].map(dependency => ({
      response: {
        status: 'success',
        data: {
          resultType: 'vector',
          result: ['payments', 'inventory'].map(name => ({
            metric: { __name__: 'checkout_dependency_backlog', dependency: name },
            value: [1789556400, name === dependency ? '4200' : '0'],
          })),
        },
      },
      expectedFacts: [
        {
          field_path: `/data/result/${dependency === 'payments' ? 0 : 1}/metric/dependency`,
          observed_value: dependency,
        },
        {
          field_path: `/data/result/${dependency === 'payments' ? 0 : 1}/value/1`,
          observed_value: '4200',
        },
      ],
    })),
  },
  {
    family: 'payment-api-rejection',
    task: 'Checkout reports failed payments. The payment provider exports its rejection audit to Datadog, not to the caller Pod logs. Establish why that provider is rejecting calls during the incident.',
    requiredTool: 'datadog_read',
    investigation: {
      action: 'logs',
      query: 'service:payment-provider env:production',
      from: start,
      to: end,
      limit: 10,
    },
    request: {
      url: 'https://datadog.eval.invalid/api/v2/logs/events/search',
      method: 'POST',
      body: {
        filter: { query: 'service:payment-provider env:production', from: start, to: end },
        page: { limit: 10 },
        sort: 'timestamp',
      },
    },
    variants: ['TENANT_QUOTA_EXCEEDED', 'MERCHANT_ACCOUNT_SUSPENDED'].map(error => ({
      response: {
        data: [
          {
            id: 'payment-request',
            type: 'log',
            attributes: {
              timestamp: '2026-09-16T10:30:00Z',
              service: 'payment-provider',
              message: 'Payment rejected',
              attributes: { error: { code: error } },
            },
          },
        ],
      },
      expectedFacts: [
        { field_path: '/data/0/attributes/attributes/error/code', observed_value: error },
      ],
    })),
  },
  {
    family: 'external-gateway-tls',
    task: 'Checkout cannot reach the partner API through the external gateway. Only the gateway audit in Splunk records the TLS handshake failure. Identify the failing TLS check, without changing certificates or Kubernetes resources.',
    requiredTool: 'splunk_read',
    investigation: {
      action: 'search',
      query: 'search index=partner_gateway service=checkout | table peer error_code',
      earliestTime: start,
      latestTime: end,
      limit: 10,
    },
    request: {
      url: 'https://splunk.eval.invalid/services/search/jobs/oneshot',
      method: 'POST',
      body: {
        search: 'search index=partner_gateway service=checkout | table peer error_code',
        earliest_time: start,
        latest_time: end,
        count: '10',
        output_mode: 'json',
      },
    },
    variants: ['CERTIFICATE_EXPIRED', 'CERTIFICATE_HOSTNAME_MISMATCH'].map(error => ({
      response: { results: [{ peer: 'partner.example.invalid', error_code: error }] },
      expectedFacts: [{ field_path: '/results/0/error_code', observed_value: error }],
    })),
  },
  {
    family: 'dashboard-scope-drift',
    task: 'The Grafana dashboard checkout-overview reports zero production traffic, but Kubernetes health is normal. It is maintained in external Grafana storage, not a ConfigMap. Inspect its traffic panel and identify the scope error. The intended datasource UID is prod-metrics and the intended namespace is checkout.',
    requiredTool: 'grafana_read',
    investigation: { action: 'get_dashboard', uid: 'checkout-overview' },
    request: {
      url: 'https://grafana.eval.invalid/api/dashboards/uid/checkout-overview',
      method: 'GET',
    },
    variants: [
      {
        response: {
          dashboard: {
            uid: 'checkout-overview',
            title: 'Checkout',
            panels: [
              {
                id: 1,
                title: 'Traffic',
                datasource: { type: 'prometheus', uid: 'staging-metrics' },
                targets: [
                  { refId: 'A', expr: 'sum(rate(http_requests_total{namespace="checkout"}[5m]))' },
                ],
              },
            ],
          },
        },
        expectedFacts: [
          { field_path: '/dashboard/panels/0/datasource/uid', observed_value: 'staging-metrics' },
        ],
      },
      {
        response: {
          dashboard: {
            uid: 'checkout-overview',
            title: 'Checkout',
            panels: [
              {
                id: 1,
                title: 'Traffic',
                datasource: { type: 'prometheus', uid: 'prod-metrics' },
                targets: [
                  {
                    refId: 'A',
                    expr: 'sum(rate(http_requests_total{namespace="checkout-retired"}[5m]))',
                  },
                ],
              },
            ],
          },
        },
        expectedFacts: [
          {
            field_path: '/dashboard/panels/0/targets/0/expr',
            observed_value: 'sum(rate(http_requests_total{namespace="checkout-retired"}[5m]))',
          },
        ],
      },
    ],
  },
  {
    family: 'azure-dependency-failure',
    task: 'Checkout requests fail intermittently, although Kubernetes remains healthy. Dependency spans are exported only to Azure Monitor. Identify the failing managed service and its returned error code from the incident window.',
    requiredTool: 'azure_monitor_traces_read',
    investigation: {
      query:
        'AppDependencies | where AppRoleName == "checkout" | project Target, ResultCode, Success',
      start,
      end,
    },
    request: {
      url: 'https://api.loganalytics.azure.com/v1/workspaces/eval-workspace/query',
      method: 'POST',
      body: {
        query:
          'AppDependencies | where AppRoleName == "checkout" | project Target, ResultCode, Success\n| take 100',
        timespan: '2026-09-16T10:00:00.000Z/2026-09-16T11:00:00.000Z',
      },
    },
    variants: (
      [
        ['orders.documents.azure.com', '429'],
        ['orders.database.windows.net', '40501'],
      ] as const
    ).map(([target, code]) => ({
      response: {
        tables: [
          {
            name: 'PrimaryResult',
            columns: [
              { name: 'Target', type: 'string' },
              { name: 'ResultCode', type: 'string' },
              { name: 'Success', type: 'bool' },
            ],
            rows: [[target, code, false]],
          },
        ],
      },
      expectedFacts: [
        { field_path: '/tables/0/rows/0/0', observed_value: target },
        { field_path: '/tables/0/rows/0/1', observed_value: code },
      ],
    })),
  },
  {
    family: 'aks-effective-route',
    task: 'AKS checkout traffic to 10.90.0.10 fails. Kubernetes Service endpoints and NetworkPolicies are healthy. The node NIC effective routes are maintained by Azure, outside the Kubernetes API. The approved next hop for 10.90.0.0/24 is VirtualAppliance 10.0.0.4. Identify the effective-route discrepancy.',
    requiredTool: 'azure_network_config_read',
    investigation: { action: 'effective_routes', resourceId: nic },
    request: {
      url: `https://management.azure.com${nic}/effectiveRouteTable?api-version=2023-09-01`,
      method: 'POST',
    },
    variants: [
      {
        response: {
          value: [
            {
              name: 'partner-route',
              addressPrefix: ['10.90.0.0/24'],
              state: 'Active',
              source: 'User',
              nextHopType: 'None',
              nextHopIpAddress: [],
            },
          ],
        },
        expectedFacts: [{ field_path: '/value/0/nextHopType', observed_value: 'None' }],
      },
      {
        response: {
          value: [
            {
              name: 'partner-route',
              addressPrefix: ['10.90.0.0/24'],
              state: 'Active',
              source: 'User',
              nextHopType: 'VirtualAppliance',
              nextHopIpAddress: ['10.0.0.99'],
            },
          ],
        },
        expectedFacts: [
          { field_path: '/value/0/nextHopType', observed_value: 'VirtualAppliance' },
          { field_path: '/value/0/nextHopIpAddress/0', observed_value: '10.0.0.99' },
        ],
      },
    ],
  },
];

export const observabilityScenarios: ObservabilityScenario[] = families.flatMap(family =>
  family.variants.map((variant, index) => ({
    schemaVersion: '1.0.0',
    source: 'synthetic',
    visibility: 'public',
    id: `observability-${family.family}-${index === 0 ? 'a' : 'b'}-v1`,
    family: family.family,
    lifecycle: 'draft',
    qualification: 'pending',
    task: family.task + readOnlyTask,
    kubernetesEvidence: structuredClone(healthyKubernetesEvidence),
    requiredTool: family.requiredTool,
    investigation: family.investigation,
    request: family.request,
    ...variant,
  }))
);

export function observabilityCandidatePacket(scenario: ObservabilityScenario) {
  return {
    task: scenario.task,
    kubernetesEvidence: structuredClone(scenario.kubernetesEvidence),
    allowMutations: false,
    requiredSubmissionSchema: 'diagnosis_submission@1.0.0',
    readRequests: [{ tool: scenario.requiredTool, args: structuredClone(scenario.investigation) }],
  };
}
