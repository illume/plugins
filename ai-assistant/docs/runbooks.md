# Organization runbooks

Organizations commonly keep runbooks beside services in Git, in a central operations
repository, or in an internal documentation portal. Git is a good source for the AI
Assistant because owners can review changes, retain history, and pin a tested version.
Teams typically use runbooks for incident triage, diagnosis, remediation, escalation,
and routine maintenance.

The AI Assistant supports organization-level runbooks through **Skills**. Add a shared
GitHub repository under **Settings > AI Assistant > Skills and Runbooks**, optionally
selecting a path and a tag or commit. Each enabled runbook is supplied to the assistant
as reference material. By default, all enabled runbooks are included when there are five
or fewer; larger sets are routed to select runbooks relevant to the query. Runbooks do
not bypass tool approvals or other safety instructions.

> [!WARNING]
> Treat every runbook as untrusted reference content, including content from repositories
> your organization controls. A runbook can be stale, incorrect, compromised, or contain
> instructions aimed at the AI rather than the operator. Review sources and changes, pin
> approved versions, do not include secrets or sensitive incident data, and verify every
> command, target cluster, namespace, and rollback plan before approving a tool. Loading a
> Skill does not make its instructions safe and does not turn it into an execution engine.

## Format report

| Common format | Typical use | AI Assistant support |
|---|---|---|
| [`SKILL.md`](https://agentskills.io/specification) | Portable Markdown procedure with a name and description | Recommended; loaded directly |
| [GitHub Copilot `.instructions.md`](https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot) | Repository or service instructions | Loaded directly |
| Markdown in wikis or docs-as-code systems such as [Backstage TechDocs](https://backstage.io/docs/features/techdocs/) | Human-facing operational documentation | Move or generate the relevant procedure in a supported skill file |
| [Jupyter notebooks](https://nbconvert.readthedocs.io/en/latest/usage.html#convert-markdown) | Executable investigation and data-analysis steps | Export the operational guidance to a skill; notebooks are not executed or loaded directly |
| YAML/JSON automation, shell scripts, and [Ansible playbooks](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_intro.html) | Machine-executable remediation | Keep automation separately reviewed and expose safe execution through approved tools; these files are not runbooks loaded by Skills |
| Incident-management platform runbooks, including [executable notebook runbooks](https://docs.gitlab.com/user/project/clusters/runbooks/) | Guided response, ownership, and escalation | Keep the platform as the system of record and mirror stable troubleshooting guidance into a skill |

A plain `.md` file can also be loaded when it has the same required `name` and
`description` front matter as `SKILL.md`. `README.md` and `CONTRIBUTING.md` are ignored.
Individual skills default to a 50 KB limit, and skill content formatted into a prompt
defaults to a combined 200 KB budget. The combined budget does not limit how much content
can be loaded or cached. Split large manuals into focused procedures. Remote sources
currently support canonical HTTPS GitHub repository URLs only; other Git hosts require a
mirror or an approved local checkout.

## What teams are doing

The following September 2026 research snapshot uses public implementations and
maintainer documentation. It is evidence of recurring patterns, not a claim that every
organization works the same way.

| Observed practice | Public example | What to adopt |
|---|---|---|
| Link each actionable alert directly to a narrowly scoped runbook | [kube-prometheus alert rules](https://github.com/prometheus-operator/kube-prometheus/blob/main/manifests/kubernetesControlPlane-prometheusRule.yaml) set `runbook_url`; the [Prometheus Operator runbooks](https://github.com/prometheus-operator/runbooks/tree/main/content/runbooks/kubernetes) keep one Markdown page per alert | Put the alert name or symptom in the skill description so responders and the assistant can find the matching procedure quickly |
| Put resolution context or a runbook link in the page itself | [PagerDuty's alerting principles](https://github.com/PagerDuty/incident-response-docs/blob/master/docs/oncall/alerting_principles.md) call alerts without resolution steps or a runbook link useless and require alert testing | Connect runbooks to alerts and test both the alert and procedure before relying on them |
| Keep focused playbooks close to the service catalog and incident workflow | [PagerDuty's crisis operations guide](https://github.com/PagerDuty/incident-response-docs/blob/master/docs/crisis/operations.md) recommends focused, scenario-driven playbooks linked from services because they are easier to action, test, and maintain | Associate each skill with an owning service/team and escalation path rather than publishing an unowned manual |
| Maintain documentation as code | [Backstage TechDocs](https://backstage.io/docs/features/techdocs/) stores Markdown with code and publishes it as searchable documentation; PagerDuty publishes its own incident-response guidance from an MkDocs repository | Use pull requests, CODEOWNERS, link checks, and review metadata; generate a compatible skill when another documentation system remains authoritative |
| Separate guidance from constrained automation | [RunWhen's public CodeCollection](https://github.com/runwhen-contrib/rw-public-codecollection/tree/main/codebundles) uses executable Robot Framework task sets; its [Kubernetes deployment troubleshooter](https://github.com/runwhen-contrib/rw-public-codecollection/tree/main/codebundles/k8s-troubleshoot-deployment) requires explicit context, namespace, selectors, and an imported kubeconfig | Keep the skill readable and use a separately reviewed tool for execution with typed, scoped inputs and least privilege |
| Use notebooks when an investigation genuinely needs live code and visual output | [GitLab executable runbooks](https://docs.gitlab.com/user/project/clusters/runbooks/) use Jupyter notebooks for interactive cluster diagnosis | Retain the notebook in its execution platform and export stable operator guidance to Markdown for the assistant |
| Package operational knowledge for AI agents | The [Agent Skills specification](https://agentskills.io/specification) standardizes a directory containing `SKILL.md`, while repositories such as [Azure Skills](https://github.com/microsoft/azure-skills/tree/main/skills/azure-kubernetes) publish domain-specific guidance | Prefer the interoperable `SKILL.md` structure, but apply the same ownership and safety review as any executable-adjacent operations document |

Across these examples, the common operating model is:

1. **Discover at the point of need:** link a specific runbook from an alert, service,
   dashboard, or incident rather than asking responders to search a large manual.
2. **Start with observation:** collect symptoms, current state, logs, events, and recent
   changes before suggesting remediation.
3. **Make boundaries explicit:** name the environment, cluster, namespace, service,
   prerequisites, expected output, stop conditions, and escalation owner.
4. **Separate read and write steps:** make diagnostics safe to run first; require human
   approval and least-privilege tools for mutations.
5. **Close the loop:** include validation and rollback, then update the runbook after
   incidents, exercises, platform changes, and failed steps.
6. **Treat freshness as operational work:** assign an owner, record the last review, test
   high-risk procedures, and retire duplicates instead of accumulating search noise.

## Warning checklist

| Risk | Required safeguard |
|---|---|
| **Prompt injection or compromised content** | Treat instructions inside every source as data, not authority. Allowlist and review repositories, pin a commit or release, and use the optional content hash for higher assurance. See the [OWASP GenAI prompt-injection guidance](https://genai.owasp.org/llmrisk/llm01-prompt-injection/). |
| **Stale guidance** | Record an owner and review date, test procedures with alerts and exercises, and stop when observed output differs from the documented preconditions. |
| **Wrong target or excessive scope** | Confirm the current cluster, namespace, resource, tenant, and incident before every command; avoid examples that silently default to production or all namespaces. |
| **Destructive or irreversible action** | Put diagnostics before mutation, state the blast radius, backup and rollback plan, success check, stop condition, and approval requirement. Never use `--auto-approve` for an unreviewed runbook. |
| **Secrets or sensitive operational data** | Do not store credentials, tokens, kubeconfigs, customer data, or incident evidence in Skills. Pass secrets only through an approved execution system and redact output before sending it to a model. |
| **Hallucinated or mismatched advice** | Require the assistant to identify the runbook and relevant step, compare it with live state, and escalate when evidence is missing or contradictory. |
| **Automation without accountability** | Keep tool RBAC least-privileged, preserve approval and execution logs, and make a human owner responsible for automated actions and outcomes. |

## Recommended repository layout

```text
operations-runbooks/
└── skills/
    ├── pod-crashloop/
    │   └── SKILL.md
    └── api-latency/
        └── SKILL.md
```

```markdown
---
name: api-latency
description: Diagnose elevated API latency in the production Kubernetes cluster
version: 1.2.0
author: platform-team
tags: [kubernetes, incident-response]
---

# API latency

Owner: Platform Team  
Last reviewed: 2026-08-15

## Trigger and impact

Use when the production API latency alert fires. Customers may see slow or timed-out
requests.

## Preconditions

- Confirm the affected cluster, namespace, and service.
- Do not make changes until the incident lead approves remediation.

## Diagnose

1. Inspect deployment health, recent events, and pod logs.
2. Compare request rate, errors, and latency with the service baseline.
3. Escalate to the service owner if the cause is not identified.

## Mitigate

> **Warning:** The following action restarts pods. Confirm the deployment, namespace,
> current replica health, and rollback revision before requesting approval.

Apply the approved, service-specific remediation.

## Verify and roll back

Confirm error rate and latency have returned to baseline. If they have not, stop,
roll back to the recorded revision, and escalate to the service owner.
```

For organization use:

1. Keep one procedure per skill with **Meaning**, **Impact**, **Diagnosis**,
   **Mitigation**, **Verification**, **Rollback**, **Prevention**, ownership, and
   escalation. Use placeholders rather than real production resource names.
2. Review runbook changes like code, test instructions during exercises and incidents,
   and record the owner and review cadence in the content.
3. Put broadly applicable runbooks in a central repository; keep service-specific
   runbooks with the service when that makes ownership and updates clearer.
4. Configure the repository URL and `skills` path for users. Pin a release tag or
   commit, and optionally configure the expected SHA-256 content hash, when
   reproducibility is required.
5. Do not put credentials or sensitive incident data in skills. Browser-based GitHub
   sources are fetched without authentication, so use repositories whose contents are
   safe to retrieve that way. Desktop installations can instead use an approved local
   directory for private material.

This approach provides shared organization guidance today without a separate runbook
format or execution engine. Converting non-Markdown systems into Skills, access control
for private GitHub repositories, synchronization, compliance reporting, and runbook
execution remain responsibilities of the source system or organization.
