# Lifecycle health

Lifecycle health summarizes whether the evaluation system itself set up, graded, verified, and cleaned up trials reliably. It is separate from candidate quality so infrastructure failures cannot be mistaken for model failures or successes.

Start with [`health.ts`](health.ts), which derives setup and cleanup rates, failure ownership, invalid grader counts, and flake information from terminal trial results.

This code consumes completed result records only. It does not contact candidates or clusters, and it does not rewrite task outcomes.
