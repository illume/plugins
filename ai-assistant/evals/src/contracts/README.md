# Contracts

Contracts define the versioned records exchanged between scenarios, candidates, graders, storage, and reports. Keeping them together makes data-shape changes visible and prevents implementation details from becoming accidental persistence formats.

Start with:

- [`evaluationContracts.ts`](evaluationContracts.ts) for the TypeScript domain model and terminal `TrialResult`.
- [`schemas.ts`](schemas.ts) for loading the JSON Schema registry.
- [`validate.ts`](validate.ts) for runtime structural validation.
- [`kwokCompatibility.ts`](kwokCompatibility.ts) for deriving whether a scenario can run on the supported KWOK mechanism set.

Persisted records must match the corresponding schema. Candidate-visible packets and protected evaluator packets remain separate types because that distinction is part of the answer-leak boundary.
