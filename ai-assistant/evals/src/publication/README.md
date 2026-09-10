# Publication

Publication converts a private closed bundle into an immutable, redacted result suitable for the repository. This second projection step lets reviewers inspect qualification summaries without exposing candidate prompts, raw trajectories, secrets, or environment details.

Start with [`publish.ts`](publish.ts) for disclosure-profile enforcement, immutable run publication, and regeneration of the top-level results index and report.

Published data is derived from a validated closed bundle. Generated aggregate views must be reproducible from immutable publication directories, and redaction must happen before files enter `evals/results`.
