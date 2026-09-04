# Agent harness research

## Recommendation

Start with LangChain's `createAgent` in `ai-common`. It is a first-party,
LangGraph-backed ReAct harness already available through this project's existing
`langchain` dependency. It supplies the model/tool loop, middleware, streaming,
state, and checkpoint hooks without another runtime dependency or service.

Keep the current `LangChainAssistantSession` as the production path while the
prototype is evaluated. Moving it behind the harness is not a mechanical
replacement: the current session owns UI streaming, response caching, skill
routing, tool-result formatting, and approval events.

## Options

| Option | Strengths | Costs and gaps | Fit |
| --- | --- | --- | --- |
| `langchain.createAgent` | Prebuilt ReAct loop; tools can run in parallel; middleware for limits, retries, summarization, PII, tool selection, and human review; supports streaming and checkpointing | The existing session's UI events and approval flow need adapters | **Best first step** |
| `@langchain/langgraph` `StateGraph` | Explicit nodes, conditional edges, subgraphs, durable state, interrupts, and replay; can encode triage → gather evidence → validate → recommend | More code and tests; should be a direct dependency before importing it; custom graphs must own routing and error policy | Best when the troubleshooting workflow must be deterministic |
| Continue the custom LCEL/session loop | No migration and complete control of current UI behavior | Continues to own loop limits, state transitions, retries, persistence, and observability manually | Reasonable baseline, not a modern harness |
| Separate LangGraph service | Server-side credentials, durable storage, centralized policy, and long-running work | New deployment, API and streaming bridge, RBAC, availability, and operations burden | Consider only for durable/background investigations |

`@langchain/langgraph` is currently installed transitively by `langchain`, so the
prototype does not import it directly. A future custom `StateGraph` should add it
as an explicit first-party dependency rather than rely on package hoisting.

## What a modern harness needs

- A bounded model/tool loop with cancellation, timeouts, call budgets, and
  predictable termination.
- Typed tools, argument validation, parallel execution where safe, normalized
  errors, retry policy, and idempotency guidance.
- Per-run context separated from persistent thread state, checkpointing, and
  resumable human-in-the-loop interrupts.
- Token and state-size management through trimming or summarization.
- Incremental model, tool, and state streaming suitable for the UI.
- Policy middleware for approvals, sensitive-data handling, tool allowlists,
  and model/tool fallback.
- Traceable model calls, tool inputs/results, timing, token use, state
  transitions, and stable correlation IDs.
- Deterministic test models, tool fakes, replayable checkpoints, and evaluation
  scenarios.

LangChain provides most of these as `createAgent` features or first-party
middleware. The host still owns authorization, durable storage, product UI,
telemetry destinations, and policy decisions.

## Kubernetes troubleshooting requirements

1. **Scope is trusted context, not model input.** Cluster, namespace, user, and
   impersonation data must come from Headlamp and be injected into tools. The
   model must not select credentials or silently broaden scope.
2. **Read before write.** Gather workload status, conditions, owner references,
   events, logs, rollout state, nodes, and relevant observability data before
   proposing a cause.
3. **Evidence has provenance.** Record cluster, namespace, resource UID,
   observation time, and tool errors. Distinguish observations from hypotheses
   and state confidence and missing evidence.
4. **Mutations require a boundary.** Default to read-only RBAC. Show the exact
   target and change, require approval, re-check resource version/preconditions,
   and report the result. Approval does not replace Kubernetes authorization.
5. **Secrets need defense in depth.** Avoid fetching Secret payloads by default,
   redact sensitive API and log content, and do not persist credentials in
   checkpoints or traces.
6. **Investigations must be bounded.** Limit calls, retries, log size, time
   range, fan-out, and concurrency. Kubernetes discovery can otherwise expand
   across an entire cluster.
7. **Failures are data.** Preserve 403, 404, timeout, partial-result, and stale
   resource errors so the agent does not convert missing access into a false
   diagnosis.
8. **The output should be operational.** Summarize likely causes, supporting
   evidence, ruled-out causes, safe next checks, rollback/remediation options,
   and any action awaiting approval.

## Prototype

`packages/ai-common/src/agents/langchain/createAgentHarness.ts` is a deliberately
small adapter that:

- waits for current MCP discovery and reuses all enabled built-in and MCP
  LangChain tools;
- uses the existing AI Assistant system prompt by default;
- creates the first-party LangGraph-backed agent with per-run model and tool
  call limits; and
- accepts the existing provider-independent `BaseChatModel`.

The focused test executes a real model → tool → model graph with a deterministic
model and verifies that tool discovery completes before graph construction.

The prototype does **not** replace the production session yet. Before doing so:

1. adapt graph stream events to `AssistantSession` updates;
2. preserve skill routing, Kubernetes context, redaction, and tool-result
   formatting;
3. map sensitive tools to the existing approval UI, or adopt LangGraph
   interrupts with a host-owned checkpointer and thread ID;
4. decide whether browser sessions need durable persistence;
5. add Kubernetes diagnosis and cancellation scenarios; and
6. compare quality, latency, call count, and failure behavior with the current
   loop.

## First-party references

- [LangChain agents](https://docs.langchain.com/oss/javascript/langchain/agents)
- [LangChain middleware](https://docs.langchain.com/oss/javascript/langchain/middleware)
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [LangGraph streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming)
