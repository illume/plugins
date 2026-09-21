# Kubernetes canonical capability registry

Status: reviewed and frozen, 2026-09-20

This registry is the mandatory canonicalization gate before another rule-gap
scenario batch. It assigns every direct-predicate occurrence exactly once, merges
only evidence-backed equivalents, and exposes title matches as review candidates
rather than silently treating similar wording as equivalent behavior.

## Current result

- Direct-predicate occurrences: 6088
- Tool-local semantic groups: 1496
- Canonical capabilities: 1271
- Evidence-backed cross-tool capabilities: 122
- Reviewed single-tool capabilities: 1149
- Tool-local groups split by occurrence evidence: 11
- Reviewed scenario co-target candidates: 71
- Reviewed exact-title merge sets: 47
- Reviewed semantic-similarity candidates: 85
- Semantic-similarity merges / separations: 60 / 25
- Unresolved candidates: 0
- Unresolved semantic-similarity candidates: 0
- Targeted / implemented / qualified: 1132 / 1131 / 1

The denominator is frozen for the pinned direct-predicate inventory. Future
scenario batches must target canonical IDs that are not already implemented.

## Review queue

No unresolved canonicalization candidates.
