# Evaluation architecture

This document explains how the evaluation package is divided, which module
owns each stage, and how data crosses the candidate, grading, storage, and
publication boundaries.

## How the code fits together

An evaluation flows through these ownership boundaries:

1. [`src/cli.ts`](src/cli.ts) parses commands and delegates work. It does not
   own evaluation policy.
2. [`src/runner/orchestrate.ts`](src/runner/orchestrate.ts) chooses the cluster,
   scenarios, and candidates for one run. It delegates each configuration to
   [`src/runner/candidatePass.ts`](src/runner/candidatePass.ts), the reusable
   pass boundary for future repeat and comparison scheduling.
3. [`src/runner/trialRunner.ts`](src/runner/trialRunner.ts) owns a trial from
   setup through cleanup. It keeps harness health, answer quality, safety, and
   cleanup validity separate so one kind of failure cannot hide another.
4. [`src/cluster/clusterAdapter.ts`](src/cluster/clusterAdapter.ts) and
   [`src/candidates/candidateAdapter.ts`](src/candidates/candidateAdapter.ts)
   are the two main ports. Cluster adapters normalize simulated, local, and AKS
   environments; candidate adapters normalize scripted controls and the real
   Headlamp CLI.
5. [`src/contracts/evaluationContracts.ts`](src/contracts/evaluationContracts.ts)
   separates the candidate-visible scenario packet from protected grader truth
   and defines the canonical terminal `TrialResult`.
6. [`src/storage/bundleWriter.ts`](src/storage/bundleWriter.ts) stores the
   canonical evidence. Reports, public results, and LangSmith/OTLP files are
   derived projections: useful views that can be rebuilt, not alternate
   sources of truth.
   Real Headlamp CLI attempts add metadata-only model usage and tool events to
   that evidence through an owner-readable JSONL file in the subprocess's
   isolated data directory. Absence or malformed telemetry remains
   unobservable and cannot produce a mutation-safety pass.
7. [`src/storage/contractReferences.ts`](src/storage/contractReferences.ts)
   archives scenario inputs and grader/verifier/policy/schema implementation
   bytes in separate candidate-visible and protected access domains. The
   clean-room reader verifies every referenced digest.
8. [`src/scenarios/caseLogic.ts`](src/scenarios/caseLogic.ts) is a stable
   registry facade. Mechanism-specific preflight and observation logic lives
   under `src/scenarios/cases/`, so new storage, authorization, and operator
   families do not expand one central implementation file.

## Data flow

```text
scenario fixtures + candidate-safe packet
                  |
                  v
       cluster observations -> candidate adapter
                                  |
                                  v
                         diagnosis sidecar
                                  |
                  protected evaluator packet
                                  |
                                  v
       TrialResult -> closed bundle -> reports / exports -> public results
```
