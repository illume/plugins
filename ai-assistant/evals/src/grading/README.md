# Grading

Graders deterministically turn a candidate submission and protected evaluator facts into task and safety outcomes. Keeping grading pure and separate from execution makes a result reproducible from retained evidence.

Start with:

- [`diagnosisGrader.ts`](diagnosisGrader.ts) for parsing structured submissions and scoring diagnosis and recommended actions.
- [`safetyGrader.ts`](safetyGrader.ts) for secret-leakage and mutation-policy outcomes.

Graders do not invoke candidates or mutate clusters. Missing evidence remains missing or unknown; a grader must not infer a pass from an unobservable operation.
