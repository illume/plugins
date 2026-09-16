export const aksObservabilityScenarios = [
  {
    id: 'aks-private-backend-nsg-deny-v1',
    title: 'Azure NSG blocks an AKS workload from its private backend',
    tool: 'azure_network_config_read',
    baseline: 'A Ready AKS Pod successfully fetches HTTP from a private VM.',
    fault: 'Deny TCP 8080 from the AKS node subnet in the backend NIC NSG.',
    recovery: 'Delete only the injected rule and confirm Pod HTTP connectivity returns.',
  },
  {
    id: 'aks-autoscaler-max-count-v1',
    title: 'AKS autoscaler maximum prevents a Pending workload from scaling out',
    tool: 'azure_cost_capacity_read',
    baseline: 'One CPU-requesting replica is Ready on a dedicated autoscaling user pool.',
    fault:
      'Scale to two replicas with CPU requests that cannot fit on the pool capped at one node.',
    recovery:
      'Raise the pool maximum to two and verify automatic scale-out and both replicas Ready.',
  },
] as const;

export type ObservabilityScenarioId = (typeof aksObservabilityScenarios)[number]['id'];

export const localObservabilityScenarios = [
  {
    id: 'prometheus-scrape-outage-v1',
    title: 'Prometheus loses a previously healthy exporter',
    tool: 'prometheus_read',
    baseline: 'A real Prometheus server scrapes the running exporter with up=1.',
    fault: 'Stop the exporter HTTP process and observe up=0.',
    recovery: 'Restart the exporter HTTP process and observe up=1 again.',
  },
  {
    id: 'grafana-dashboard-datasource-drift-v1',
    title: 'A Grafana dashboard references a nonexistent datasource UID',
    tool: 'grafana_read',
    baseline: 'A real Grafana datasource proxy successfully queries Prometheus.',
    fault:
      'Change the saved dashboard datasource UID and observe the panel datasource no longer resolves.',
    recovery: 'Restore the saved UID and verify the query succeeds again.',
  },
] as const;

export const observabilityScenarios = [
  ...aksObservabilityScenarios,
  ...localObservabilityScenarios,
];
