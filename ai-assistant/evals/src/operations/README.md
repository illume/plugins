# Operations metadata

This folder derives operational metadata used to maintain the scenario suite, including ownership, provenance, review status, and quarantine state. The boundary keeps suite governance distinct from candidate scoring.

Start with [`ownership.ts`](ownership.ts), which converts loaded scenario metadata into reportable ownership rows and identifies overdue reviews.

Operations metadata describes how evaluation cases are maintained. It must not become candidate-visible grading truth or alter a candidate submission.
