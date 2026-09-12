# Scenarios

Scenario code loads versioned case files and connects each scenario identity to the cluster observations needed to evaluate it. This keeps on-disk scenario content and mechanism-specific behavior out of the generic runner.

Start with:

- [`loader.ts`](loader.ts) for loading and cross-validating manifests, candidate packets, evaluator packets, and compatibility declarations.
- [`admission.ts`](admission.ts) for portfolio census, lineage/admission invariants, and Phase 2 selectors.
- [`caseLogic.ts`](caseLogic.ts) for the scenario-ID registry.
- [`cases/`](cases/) for implementations of scenario-family preflight and observation behavior.

Candidate and evaluator packets remain separate throughout loading. Adding a scenario normally means adding validated files under `evals/scenarios` and registering focused case logic, not modifying the trial runner.

Phase 2 anchors and generated descendants are `active` with
`qualification_status: qualified` after the 2026-09-12 review. Future scenarios remain
`draft` with `qualification_status: pending` until every
admission control passes. An active scenario must be qualified, and generated or
transformed descendants must identify a qualified parent before they can enter
eligible evidence.
