# Test helpers

This folder holds utilities shared by tests but excluded from production execution paths. Keeping them here makes test-only filesystem behavior obvious and avoids adding convenience APIs to runtime modules.

Start with:

- [`scratchDir.ts`](scratchDir.ts) for creating and removing isolated directories under the evaluator's ignored test scratch area.
- [`trialResult.ts`](trialResult.ts) for complete canonical trial fixtures with focused field overrides.

Production modules must not import this folder. Helpers should remain deterministic, local, and responsible for cleaning up resources they create.
