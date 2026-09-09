# Scenarios

Scenario code loads versioned case files and connects each scenario identity to the cluster observations needed to evaluate it. This keeps on-disk scenario content and mechanism-specific behavior out of the generic runner.

Start with:

- [`loader.ts`](loader.ts) for loading and cross-validating manifests, candidate packets, evaluator packets, and compatibility declarations.
- [`caseLogic.ts`](caseLogic.ts) for the scenario-ID registry.
- [`cases/`](cases/) for implementations of scenario-family preflight and observation behavior.

Candidate and evaluator packets remain separate throughout loading. Adding a scenario normally means adding validated files under `evals/scenarios` and registering focused case logic, not modifying the trial runner.
