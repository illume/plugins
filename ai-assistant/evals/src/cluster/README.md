# Cluster integration

This folder owns the evaluator's cluster boundary: its contract and composition live here, concrete backends live under `adapters/`, and environment provisioning lives under `provisioning/`. Keeping these layers distinct prevents cluster creation policy from leaking into per-trial Kubernetes operations.

Start with:

- [`clusterAdapter.ts`](clusterAdapter.ts) for the shared operations and observation types.
- [`adapterFactory.ts`](adapterFactory.ts) for profile and execution-mode selection.
- [`profile.ts`](profile.ts) for cluster profile loading and validation.
- [`commandRunner.ts`](commandRunner.ts) for the injectable external-command boundary.
- [`adapters/`](adapters/) for simulated, kubectl, Minikube, and AKS implementations.
- [`provisioning/`](provisioning/) for explicit environment setup and teardown commands.

Adapters return normalized observations rather than leaking backend clients into the rest of the evaluator. Connection data stays ephemeral and is not canonical evidence.
