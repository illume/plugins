# Evaluation Integrity

These rules apply to `ai-assistant/evals/`.

- Deterministic product logic is encouraged when it solves a documented real-world
  need, runs in the normal product path, and generalizes beyond benchmark cases.
- Mechanical processing may validate schemas, copy candidate-visible evidence,
  normalize formatting, redact secrets, and enforce safety. It must not add scored
  diagnoses, hypotheses, recommendations, or confidence.
- Never design semantic prompts, validators, or post-processing from protected truth,
  grader aliases, expected answers, scenario IDs, or observed benchmark failures.
- Once benchmark results inform a semantic feature, those cases are development data.
  Confirm the feature on fresh preregistered cases or holdouts from unseen lineages.
- Product-system comparisons may credit independently justified deterministic
  semantics, but must disclose them and include an ablation. Model comparisons must
  give every candidate the same ontology/rules.
- Preserve all valid adverse runs; do not retry or select rounds for a better score.
- If benchmark-targeted semantic synthesis is found, remove it, retract affected
  claims, mark the runs contaminated, and rerun from a clean revision.
