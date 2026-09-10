# Cluster adapters

Concrete adapters implement the shared `ClusterAdapter` contract for simulated state, kubectl-backed KWOK, Minikube, and AKS. Grouping implementations here makes the available execution substrates visible while keeping profiles, factories, and provisioning policy outside backend behavior.

Start with:

- [`simulatedAdapter.ts`](simulatedAdapter.ts) for deterministic in-memory execution.
- [`kubectlAdapter.ts`](kubectlAdapter.ts) for shared kubectl-backed operations.
- [`kwokAdapter.ts`](kwokAdapter.ts) for isolated local KWOK lifecycle behavior.
- [`minikubeAdapter.ts`](minikubeAdapter.ts) for local scheduler-backed execution.
- [`aksAdapter.ts`](aksAdapter.ts) for preflight and connectivity to an already-provisioned AKS cluster.

Implementations depend on the parent [`clusterAdapter.ts`](../clusterAdapter.ts) contract and normalize results into its types. They may validate or use an existing environment, but creating or deleting infrastructure belongs in [`provisioning/`](../provisioning/).