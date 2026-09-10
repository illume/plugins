# Regressions

Regression analysis compares matched baseline and candidate trials and records whether each measured outcome improved, regressed, stayed unchanged, or could not be compared. Keeping this logic separate prepares repeated and cross-system comparisons without complicating trial execution.

Start with [`regressionDelta.ts`](regressionDelta.ts) for scenario matching and outcome-direction calculation.

Comparisons operate on terminal trial results and match by scenario identity. An absent or non-comparable outcome remains undefined rather than being coerced into improvement or regression.
