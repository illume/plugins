# Evaluation source

This directory contains the executable evaluation framework. It keeps candidate execution, cluster access, grading, evidence storage, and reporting in separate folders so a change to one concern does not silently alter another.

Start with:

- [`cli.ts`](cli.ts) for command-line routing.
- [`runner/orchestrate.ts`](runner/orchestrate.ts) for complete run orchestration.
- [`runner/trialRunner.ts`](runner/trialRunner.ts) for the lifecycle of one trial.
- [`contracts/evaluationContracts.ts`](contracts/evaluationContracts.ts) for the canonical data model.
- [`storage/bundleWriter.ts`](storage/bundleWriter.ts) for persisted evidence.

Each child folder has a README describing its role, useful entry points, and architectural boundary. Test files live beside the code they exercise so behavior and its contract are easy to inspect together.
