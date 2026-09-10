# Exporters

Exporters create offline projections of canonical trial results for external observability formats. They are projections rather than alternate sources of truth, so integrations can evolve or be regenerated without rerunning a candidate.

Start with:

- [`writeExports.ts`](writeExports.ts) for writing all supported projections and receipts.
- [`langsmith.ts`](langsmith.ts) for the LangSmith mapping.
- [`otlp.ts`](otlp.ts) for the OpenTelemetry mapping.

Exporter code must not contact external services during an evaluation run. Unsupported fields and lossy mappings are declared in projection metadata instead of being silently discarded.
