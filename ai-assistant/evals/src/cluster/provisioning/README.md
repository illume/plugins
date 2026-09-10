# Cluster provisioning

Provisioning contains explicit environment lifecycle commands that prepare or remove infrastructure outside an evaluation trial. This separation ensures adapter preflight and trial execution cannot create cloud resources as a side effect.

Start with [`aks.ts`](aks.ts) for deterministic AKS resource naming, setup, kubeconfig preparation, and deletion used by the CLI's `aks:setup` and `aks:delete` commands.

Provisioning is invoked only by explicit operator commands. Trial adapters may consume the resulting connection configuration, but they must not call setup or deletion functions.