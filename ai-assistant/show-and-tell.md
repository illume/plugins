---
theme: default
title: Building a Kubernetes AI Assistant we can trust
author: René Dudfield
layout: cover
transition: slide-left
mdc: true
---

# Building a Kubernetes AI Assistant we can trust

I started with one question:

## What would the best Kubernetes AI evaluation system look like?

That led to three connected PRs:

- [PR #30: evaluation infrastructure and comparisons](https://github.com/illume/plugins/pull/30)
- [PR #25: read-only observability integrations](https://github.com/illume/plugins/pull/25)
- [PR #27: LangGraph-backed agent harness](https://github.com/illume/plugins/pull/27)

<!-- Start with the chronology: evaluation research first, then product changes. -->

---

## What I am presenting

- <span class="section-letter letter-a">A</span>. First, the research and five-phase roadmap
- <span class="section-letter letter-b">B</span>. Phase 2: a best-in-class Kubernetes eval framework
- <span class="section-letter letter-c">C</span>. Gathering context through observability
- <span class="section-letter letter-d">D</span>. Modernizing the harness: reliability, latency, and caching
- <span class="section-letter letter-e">E</span>. Real customer problems and broader scenario sources
- <span class="section-letter letter-f">F</span>. Deterministic rules as the counterbalance to LLMs
- <span class="section-letter letter-g">G</span>. Results and lessons from the evals
- <span class="section-letter letter-h">H</span>. Benefits for people and what comes next

<!-- Preview the argument, not every implementation detail. -->

---

## <span class="section-letter letter-a">A</span>. First, the research

### 576 unique cited URLs across four core documents

The research covered:

- Agent benchmarks and graders
- Safety, leakage, and contamination
- Statistics and matched comparisons
- Kubernetes fixtures and realistic environments
- Production feedback and continuing governance

**The research itself was a deliverable.**

<!-- The methodology came before adding more cases or making model claims. -->

---

## <span class="section-letter letter-a">A</span>. The five-phase roadmap

Each phase has evidence gates, not just a date:

- **Phase 1:** local developer loop with Azure/AKS portability
- **Phase 2:** best-in-class Kubernetes eval framework: trustworthy regression,
  repair, and comparison
- **Phase 3:** capability breadth, robustness, and grader validation
- **Phase 4:** adversarial, concurrent, and observability validity
- **Phase 5:** deployment validity and continuing governance

**PHASE 2 REACHED: A BEST-IN-CLASS KUBERNETES EVAL FRAMEWORK**

<!-- Phase 2 made the later observability and harness experiments measurable. -->

---

## <span class="section-letter letter-a">A</span>. The end goal: Phase 5

> **What works, for whom, and under which model, cluster, and tool versions?**

A continuously governed eval system that:

- Validates offline scores against blinded experts and real outcomes
- Measures human reliance and deployment impact **before** making claims
- Turns privacy-reviewed production incidents into regressions while preserving
  fresh holdouts
- Detects drift and severe events
- Recalibrates, narrows, suspends, or retires capabilities when evidence expires

**The outcome:** a living safety and quality system, not a permanent leaderboard.

<!-- Phase 5 is continuing governance, not simply more test cases. -->

---

## <span class="section-letter letter-b">B</span>. Phase 2: the best Kubernetes eval framework stage

Phase 1 built the smallest complete loop.

Phase 2 combined controls that other inspected systems split across suites:

- Reproduce and verify the fault
- Separate candidate evidence from evaluator truth
- Grade grounded diagnosis and uncertainty
- Bind repairs to approval and exact scope
- Verify recovery, collateral state, and cleanup

That was the point where I could say the measurement design was **“better than
any existing Kubernetes evals”** for its declared scope.

<!-- Better measurement validity, not a model-superiority claim. -->

---

## <span class="section-letter letter-b">B</span>. What Phase 2 delivered

- **275** active, qualified public scenarios
- Protected evaluator truth and deterministic graders
- Approval-bound repairs, postconditions, rollback, and collateral checks
- Headlamp, HolmesGPT, and `kubectl-ai` comparisons; K8sGPT as an explain-only
  native reference
- Explicit provider, task, safety, grader, and cleanup failure ownership

**Only then** did I move into observability and harness modernization.

I finally had a credible way to tell whether changes helped.

---

## <span class="section-letter letter-c">C</span>. Gathering context is the secret sauce

Kubernetes incidents rarely live in one API.

[PR #25](https://github.com/illume/plugins/pull/25) added read-only access to:

- Kubernetes/AKS resources, Events, logs, diagnostics, networking, capacity,
  cost, and security
- Prometheus, Grafana, Datadog, Splunk, and Azure Monitor
- External tools over MCP using stdio, streamable HTTP, or SSE

**Benefit:** correlate a symptom with the log, metric, network rule, or platform
setting that explains it.

---

## <span class="section-letter letter-c">C</span>. Shorter and safer evidence paths

Direct REST removed avoidable hops:

```text
Before: UI -> Electron -> MCP -> process -> REST
After:  UI --------------------------> REST
```

- No provider SDK dependency
- Fewer process and transport boundaries
- Configured providers appear automatically

But “read-only” still requires bounded queries, validation, approval, redaction,
and a threat model. A GET can leak data or run an expensive query.

<!-- Context collection is product capability, not prompt decoration. -->

---

## <span class="section-letter letter-d">D</span>. Modernizing the harness and making it dependable

[PR #27](https://github.com/illume/plugins/pull/27) introduced a first-party
LangGraph harness:

- Bounded model/tool calls and parallel execution
- Result preservation, approvals, redaction, and end-to-end cancellation
- Sanitized telemetry and externally validated evidence references
- Proactive diagnosis in batches of up to 32 Events
- Stable, cacheable system/schema prefixes separated from volatile cluster evidence

Stopping the UI is not cancellation: the process, MCP request, or tool must stop
too, while completed evidence survives.

---

## <span class="section-letter letter-d">D</span>. The harness result was humbling

A matched run was humbling: harness **17/25**, legacy **18/25**. No quality gain.

Supplied-evidence mode later removed 29 failed tool attempts and cut requests
**41 -> 28** and tokens **110,479 -> 68,800**.

**Lesson:** a newer architecture is not automatically a better assistant.

Keep the legacy path as a controlled comparison until evidence supports removal.

---

## <span class="section-letter letter-d">D</span>. Latency and prompt caching

Latency profiling then found the provider owned over **99%** of turn time while
agent construction was under **4 ms**. Compact structured output reduced
provider p50 by **20.5%** and output tokens by **50.3%**. Keep prompt prefixes
byte-stable and record cache-read tokens; never assume a hit.

**Lesson:** optimize measured bottlenecks, not architectural assumptions.

---

## <span class="section-letter letter-e">E</span>. Real customer problems

Across two research rounds covering Azure/AKS customer reports and upstream issues:

- **32 searches -> 1,322 issue results**
- **969 distinct reports** after deduplication and overlap exclusion
- **319** issue-body/reproduction excerpts reviewed
- **250** admitted scenario candidates: 100 original + 150 expansion

These are user/operator and component-engineering reports, not 969 confirmed
customer incidents.

**Benefit:** the roadmap follows problems people actually reported, not only
faults that are convenient to demo.

---

## <span class="section-letter letter-e">E</span>. More sources for possible scenarios

Customer reports were only one channel.

- **7,427** rule, check, alert, health, and runbook occurrences
- **23** pinned tools
- Kubernetes documentation and tests
- Issue -> fix -> regression-test chains
- Operator repositories, benchmarks, chaos suites, and postmortems

**Important:** these are scenario seeds. They become distinct qualified scenarios
only after deduplication, reproduction, oracle review, and cleanup validation.

<!-- Source volume is opportunity, not qualified coverage. -->

---

## <span class="section-letter letter-e">E</span>. The problem space is broad

The sources cover:

- Networking, NSGs, and DNS
- Autoscaling, capacity, and upgrades
- Identity and security
- Performance and energy/resource waste
- GPUs and eBPF tools such as Inspektor Gadget

This is a roadmap grounded in observed needs, not only convenient demo faults.

---

## <span class="section-letter letter-f">F</span>. Deterministic rules-based systems are the counterbalance to LLMs

**The combination is better than either by itself.**

Headlamp already has a **very basic rules-based diagnosis engine**. It gathers
known Kubernetes signals and turns common failure states into immediate findings
without needing an LLM.

- Rules are fast, consistent, and testable
- LLMs connect systems, explain evidence, and handle unfamiliar combinations
- Rules should establish facts; the model should not invent them

**The combination gives predictable common answers plus flexible investigation.**

---

## <span class="section-letter letter-f">F</span>. No rules system covered everything

The 23-tool inventory collapsed:

- **7,427** source occurrences
- **2,654** tool-local groups for review

None covered all 275 scenarios at predicate level.

Combined, reviewed predicates covered **103/275 (37.5%)**. The best single tool
was kstatus at **47/275 (17.1%)**.

Against the qualified GPT-5.4 AI Assistant run:

- **103**: rules covered and AI Assistant passed
- **0**: rules covered but AI Assistant failed
- **172**: AI Assistant passed without strict reviewed rule coverage

```text
collectors -> relationships -> deterministic findings -> LLM investigation
```

<!-- Rules are source-reviewed predicate coverage; AI Assistant is a live 275/275 run. -->

---

## <span class="section-letter letter-g">G</span>. Results: scenario scale

- **275** active qualified scenarios + **980** draft bundles = **1,255** total
- Drafts represent **5,299** pinned rule occurrences across **12** tools
- First-pass Minikube disposition: **664 passed, 301 skipped, 15 failed**
- **22/23** metric-backed cases pass using real Prometheus, API-server, kubelet,
  cAdvisor, kube-state-metrics, and CSI evidence

---

## <span class="section-letter letter-g">G</span>. Results: the evals found real bugs

The evals found invalid shell assumptions, wrong metric labels,
controller/admission differences, telemetry gaps, and cleanup bugs.

A **25/25** result was withdrawn after benchmark-derived semantic processing was
found. The eval caught our invalid success.

**Honest failure is a useful result. Contaminated success is not.**

---

## <span class="section-letter letter-h">H</span>. What people get

- One investigation flow across cluster, cloud, logs, metrics, and dashboards
- Faster, cited answers with clearer uncertainty and fewer guesses
- Deterministic findings plus flexible LLM investigation
- Safer read-only access and approval-bound changes
- Reproducible regressions instead of anecdotal prompts

---

## <span class="section-letter letter-h">H</span>. What comes next

- Finish authoring and qualifying a **2,000+ scenario** Kubernetes portfolio
- Build a deterministic diagnosis rules engine from the reviewed capabilities
- Compare **rules-only, LLM-only, and hybrid** systems on fresh scenario families
- Run counterbalanced tool/model comparisons and evaluate diagnosis batching
- Continuously promote production failures into privacy-reviewed regressions

**Takeaway:** the durable result is not a single model score. It is a loop:

```text
real incident -> bounded evidence -> safe agent -> measured result -> regression
```

That loop makes troubleshooting faster **and** future AI improvements harder to
overclaim.

<!-- End on the feedback loop, then invite questions or a demo. -->

---

## References

- [Hackathon notes](https://gist.github.com/illume/0a43c4e8cdb42daece8c43f8ee3f376d)
- [PR #25: observability integrations](https://github.com/illume/plugins/pull/25)
- [PR #27: agent harness](https://github.com/illume/plugins/pull/27)
- [PR #30: evaluation infrastructure](https://github.com/illume/plugins/pull/30)
