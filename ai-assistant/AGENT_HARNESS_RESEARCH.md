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

### Best result

For the highest troubleshooting quality—not merely the smallest change—use a
**hybrid custom `StateGraph` with bounded `createAgent` investigators**:

1. A deterministic graph owns `scope → triage → collect → analyze → verify →
   recommend/remediate` transitions.
2. Read-only investigator agents choose tools within each collection phase,
   constrained by trusted cluster context, tool/call budgets, and evidence
   requirements.
3. A verification node checks every claimed cause against collected evidence
   and either requests a bounded follow-up or reports uncertainty.
4. Remediation is a separate branch with least-privilege tools, preview/diff,
   LangGraph interruption, user approval, precondition checks, and post-action
   verification.
5. Checkpoints preserve investigation state and approvals; stream adapters
   expose progress, evidence, and final answers to the current UI.

This should outperform a single ReAct loop on long or ambiguous incidents
because the workflow guarantees evidence collection and verification while
retaining agent flexibility inside each phase. It is also easier to evaluate and
audit. The cost is the most implementation work and an explicit
`@langchain/langgraph` dependency. A separate service is optional: use an
in-process graph first, then move the same boundary server-side only if durable
background runs, centralized credentials, or multi-user scale require it.

## Options

| Option | Strengths | Costs and gaps | Fit |
| --- | --- | --- | --- |
| `langchain.createAgent` | Prebuilt ReAct loop; tools can run in parallel; middleware for limits, retries, summarization, PII, tool selection, and human review; supports streaming and checkpointing | The existing session's UI events and approval flow need adapters | **Best first step** |
| Hybrid `StateGraph` + `createAgent` nodes | Deterministic incident phases plus flexible tool-using investigators; strongest evidence, safety, audit, and evaluation boundaries | Highest design and integration effort | **Best result** |
| `@langchain/langgraph` `StateGraph` only | Explicit nodes, conditional edges, subgraphs, durable state, interrupts, and replay | More orchestration code; custom graphs must own routing, prompts, and error policy | Best for fixed runbook-like workflows |
| Continue the custom LCEL/session loop | No migration and complete control of current UI behavior | Continues to own loop limits, state transitions, retries, persistence, and observability manually | Reasonable baseline, not a modern harness |
| Multiple specialist agents with supervisor/handoffs | Strong domain separation for workloads, networking, storage, policy, and observability | More calls, latency, routing failure modes, and harder evaluation; specialists can duplicate work | Add only after one graph is measured |
| Separate LangGraph service | Server-side credentials, durable storage, centralized policy, and long-running work | New deployment, API/stream bridge, RBAC, availability, and operations burden | Best deployment for durable/background investigations, not required for quality |

`@langchain/langgraph` is currently installed transitively by `langchain`, so the
prototype does not import it directly. A future custom `StateGraph` should add it
as an explicit first-party dependency rather than rely on package hoisting.

## Modern agent harness feature list

| Area | Modern harness capability | First-party implementation option |
| --- | --- | --- |
| Core loop | Tool-capable model loop, parallel calls, deterministic stop conditions, recursion/call budgets | `createAgent`, `modelCallLimitMiddleware`, `toolCallLimitMiddleware` |
| Workflow | Explicit phases, conditional routing, retries, subgraphs, parallel branches | `StateGraph` |
| Context | Typed, read-only request context kept separate from persisted agent state | `contextSchema`, `createMiddleware` |
| State and memory | Thread-scoped state, checkpoints, resume, replay/time travel, long-term store boundary | LangGraph checkpointer and store APIs |
| Human control | Pause before consequential actions; approve, edit, or reject; resume safely | `humanInTheLoopMiddleware`/interrupts plus a checkpointer |
| Tool governance | Typed schemas, allowlists, least privilege, dynamic selection, per-tool policy, idempotency | LangChain tools, `llmToolSelectorMiddleware`, custom `wrapToolCall` |
| Reliability | Cancellation, deadlines, bounded retries/backoff, normalized tool errors, model fallback | `AbortSignal`, `modelRetryMiddleware`, `toolRetryMiddleware`, `modelFallbackMiddleware` |
| Context budget | Token accounting, summarization, old tool-result removal, prompt caching | `summarizationMiddleware`, `contextEditingMiddleware`, provider prompt-cache middleware |
| Streaming | Token, message, update, task, tool-progress, and final-state events | Agent/LangGraph stream modes and stream transformers |
| Safety and privacy | Input/output/tool-result filtering, secret redaction, prompt-injection boundaries, safe checkpoint contents | `piiMiddleware`, custom middleware, existing `redactSecrets` |
| Observability | Correlated run/step/tool IDs, timings, token/cost usage, state transitions, errors, redacted traces | LangChain callbacks/middleware; host-owned telemetry destination |
| Evidence | Provenance, timestamps, resource identity/version, confidence, contradiction and missing-evidence tracking | Custom state schema and verification nodes |
| Planning | Explicit task list, dependency-aware steps, bounded replanning | `todoListMiddleware` or custom graph state |
| Knowledge | Dynamic system context, routed runbooks/skills, retrieval with source attribution | `dynamicSystemPromptMiddleware` plus existing Skills |
| Structured output | Validated incident findings, evidence, next actions, and remediation plans | `responseFormat` with Zod/JSON Schema |
| Testing and evaluation | Deterministic models/tools, trajectory assertions, replay, golden incidents, regression and safety scoring | LangChain test models, `toolEmulatorMiddleware`, checkpoints, repository-owned eval suite |
| Operations | Concurrency/rate limits, quotas, isolation, versioned graph/prompt/tool contracts, graceful recovery | Host/deployment responsibility around the graph |

LangChain provides much of the agent machinery. The host still owns Kubernetes
authorization, tenancy, durable storage, UI behavior, telemetry destinations,
evaluation data, and product policy.

## Implementation building blocks

The existing `langchain` package exposes first-party middleware that can be
composed around `createAgent` without a new runtime service:

- `createMiddleware`: custom before/after agent/model hooks, model/tool wrappers,
  typed context/state, middleware-owned tools, and stream transformers.
- `dynamicSystemPromptMiddleware`: inject the selected cluster context and
  routed Skills/runbooks per invocation.
- `summarizationMiddleware` and `contextEditingMiddleware`: bound long incident
  histories and remove stale tool payloads.
- `modelRetryMiddleware`, `toolRetryMiddleware`, and
  `modelFallbackMiddleware`: consistent reliability policy.
- `llmToolSelectorMiddleware`: reduce the tool set exposed to the main model.
  It can improve tool precision/context size, but an LLM-based selector may add
  model cost and must be benchmarked against the current `ToolPlanner`.
- `piiMiddleware` plus custom `wrapToolCall`: generic PII handling while
  preserving the existing Kubernetes Secret, kubeconfig, token, and certificate
  redaction patterns.
- `humanInTheLoopMiddleware`: graph-native approve/edit/reject. It requires a
  checkpointer, stable thread IDs, and an approval-resume UI adapter.
- `todoListMiddleware`: explicit multi-step investigation state when a custom
  graph is not yet justified.

Use raw `StateGraph` when middleware cannot guarantee the required sequence—for
example, collecting evidence before diagnosis or verifying a remediation after
execution.

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

## Current gaps and highest-impact improvements

| Priority | Gap today | Why it matters | Research-backed improvement |
| --- | --- | --- | --- |
| P0 | No graph-to-`AssistantSession` stream adapter | Blocks use in the real UI and hides model/tool/state progress | Map agent message/update events to current text, tool progress, approval, cancellation, and final-history events |
| P0 | Harness does not inject trusted Kubernetes context | Model-selected scope could target the wrong cluster/namespace; tool wrappers currently depend on host context | Define typed invocation context and middleware that configures tools from host-owned scope, never model arguments |
| P0 | No evaluation harness for Kubernetes diagnoses | Architecture changes cannot be shown to improve correctness or safety | Build a versioned incident set covering CrashLoop, OOM, Pending, rollout, DNS/network, storage, RBAC, partial access, stale data, and unsafe remediation; score evidence, cause, calls, latency, and policy |
| P1 | Prototype has no checkpointed approval/resume | Current approval is outside graph state and only one request can be pending | Add stable thread IDs and a checkpointer, then adapt graph-native approve/edit/reject while preserving current auto-approval policy |
| P1 | No evidence schema or verification phase | A fluent answer can be unsupported or based on stale/partial results | Add typed findings with provenance and a verifier node that rejects unsupported claims and reports uncertainty |
| P1 | Conversation/tool payloads lack a token-budget policy | Long troubleshooting sessions can overflow context or become expensive and inaccurate | Add summarization plus tool-result pruning; retain recent evidence and structured findings rather than raw payloads |
| P1 | Retry, timeout, and idempotency policy is inconsistent | Kubernetes APIs and observability endpoints fail transiently; retrying writes can be unsafe | Add operation deadlines and retry middleware for models/read-only tools only; require idempotency keys/preconditions for mutations |
| P1 | Security is boundary-specific rather than harness-wide | Existing redaction is strong but must also cover streams, checkpoints, traces, model input, and errors | Wrap all model/tool/checkpoint/telemetry boundaries and retain Kubernetes-specific detectors |
| P2 | Skills and system context are session-specific plumbing | A migration could silently lose runbook routing or inject stale context | Move them behind typed dynamic prompt middleware and test source attribution |
| P2 | Current tool planning and direct-calling paths overlap | Extra planning can add latency and behavior differs by provider | Benchmark current `ToolPlanner`, direct tools, and `llmToolSelectorMiddleware`; keep the simplest winner per tool-count tier |
| P2 | No provider fallback or uniform retry telemetry | Outages terminate investigations or trigger ad hoc fallback behavior | Add bounded model retry/fallback with visible provider transitions and usage metrics |
| P3 | No specialist graph/subagents | Very broad incidents may benefit from domain expertise | Add only if evaluation shows the hybrid single-graph approach misses cross-domain cases; cap fan-out and deduplicate evidence |

### Recommended sequence for big gains

1. **Measure first:** add the Kubernetes incident evaluation set and baseline the
   current session and prototype.
2. **Make the prototype usable and safe:** stream adapter, trusted context,
   cancellation/deadlines, and end-to-end redaction.
3. **Improve answer quality:** structured evidence plus a verification node.
4. **Support long/consequential runs:** context budgeting, checkpointing, and
   graph-native approval/resume.
5. **Optimize after measurement:** tool selection, retries/fallback, prompt
   caching, and only then specialist agents or a separate service.

This order targets correctness and safety before architectural sophistication.
The evaluation suite is the deciding mechanism for “best”: prefer the option
that produces the highest evidence-grounded diagnosis and safe-action scores
within acceptable latency and call budgets.

## First-party references

- [LangChain agents](https://docs.langchain.com/oss/javascript/langchain/agents)
- [LangChain middleware](https://docs.langchain.com/oss/javascript/langchain/middleware)
- [LangChain human-in-the-loop](https://docs.langchain.com/oss/javascript/langchain/human-in-the-loop)
- [LangChain multi-agent patterns](https://docs.langchain.com/oss/javascript/langchain/multi-agent)
- [LangGraph workflows and agents](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts)
- [LangGraph streaming](https://docs.langchain.com/oss/javascript/langgraph/streaming)
- [LangChain.js agent middleware source](https://github.com/langchain-ai/langchainjs/tree/main/libs/langchain/src/agents/middleware)
- [LangGraph.js source](https://github.com/langchain-ai/langgraphjs/tree/main/libs/langgraph/src)
