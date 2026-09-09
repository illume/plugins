# Candidates

Candidate adapters normalize every system being evaluated behind one invocation contract. This lets the trial runner treat deterministic controls and the real Headlamp CLI alike while keeping subprocess, provider, and environment handling out of the runner.

Start with:

- [`candidateAdapter.ts`](candidateAdapter.ts) for candidate-visible inputs and normalized results.
- [`headlampCli.ts`](headlampCli.ts) for the real CLI subprocess boundary and sanitized telemetry ingestion.
- [`scripted.ts`](scripted.ts) for deterministic reference, failure, and malformed controls.
- [`providerDetection.ts`](providerDetection.ts) for parsing provider discovery output.

Candidates receive the candidate packet, retrieved observations, and explicitly supplied ephemeral environment only. Protected evaluator truth must never cross this boundary.
