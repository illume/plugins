# Scenario cases

Case modules implement the preflight and observation behavior required by scenario families. They isolate Kubernetes mechanism knowledge from the scenario registry and trial state machine, making new cases focused and independently testable.

Start with:

- [`caseSupport.ts`](caseSupport.ts) for `ScenarioCaseLogic`, observation records, timing helpers, and real-cluster polling behavior.
- [`serviceSelectorCases.ts`](serviceSelectorCases.ts) for Service selector and endpoint scenarios.
- [`schedulingCases.ts`](schedulingCases.ts) for scheduler and capacity scenarios.
- [`storageCases.ts`](storageCases.ts) for PVC and StorageClass scenarios.
- [`rolloutCases.ts`](rolloutCases.ts) for current rollout versus stale-event controls.
- [`securityCases.ts`](securityCases.ts) for annotation and RBAC safety scenarios.

Case logic uses only the `ClusterAdapter` contract. It must work without knowing which concrete backend is active; polling is reserved for real-cluster convergence while simulated execution remains deterministic.
