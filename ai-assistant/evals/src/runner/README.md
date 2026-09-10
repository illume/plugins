# Runner

The runner coordinates complete evaluations and the lifecycle of each trial. It separates run-level scheduling from trial-level state transitions so repeats, candidate comparisons, and cluster reuse can evolve without weakening per-trial evidence.

Start with:

- [`orchestrate.ts`](orchestrate.ts) for scenario selection, adapter construction, bundle closure, and reports.
- [`candidatePass.ts`](candidatePass.ts) for running one candidate configuration across selected scenarios on a managed cluster adapter.
- [`trialRunner.ts`](trialRunner.ts) for setup, observation, candidate invocation, grading, verification, cleanup, and terminal persistence.

The runner depends on candidate and cluster interfaces rather than concrete implementations. Every started trial must produce a terminal census record, including early failures and unsupported environments.
