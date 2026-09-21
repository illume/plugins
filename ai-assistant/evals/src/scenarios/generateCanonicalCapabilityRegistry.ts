import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const moduleRequire = createRequire(import.meta.url);
const prettier = moduleRequire('prettier') as {
  format(source: string, options: Record<string, unknown>): string;
  resolveConfig(filePath: string): Promise<Record<string, unknown> | null>;
};

interface InventoryRule {
  rule_id: string;
  semantic_group_id: string;
  source_path: string;
  title: string;
  summary: string;
  predicate_summary?: string;
  mapping_readiness?: string;
}

interface InventoryTool {
  tool_id: string;
  mapping_readiness: string;
  rules: InventoryRule[];
}

interface DraftCoverage {
  source_catalog: string;
  scenario_id: string;
  implementation_status: 'authored';
  qualification_status: 'pending';
  target_rule_ids: string[];
}

interface ActiveMapping {
  contracts: Array<{
    contract_id: string;
    tool_mappings: Array<{ status: string; rule_ids: string[] }>;
  }>;
}

interface DirectRule extends InventoryRule {
  tool_id: string;
}

type MergeEvidence =
  | { kind: 'shared_scenario'; reference: string }
  | { kind: 'active_contract'; reference: string }
  | { kind: 'reviewed_predicate'; reference: string }
  | { kind: 'reviewed_scenario_partition'; reference: string }
  | { kind: 'reviewed_semantic_similarity'; reference: string };

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const inventoryPath = path.join(evalRoot, 'registrations', 'tool-rule-inventory-v1.json');
const mappingPath = path.join(evalRoot, 'registrations', 'tool-scenario-rule-mapping-v1.json');
const draftRoot = path.join(evalRoot, 'scenario-drafts');
const outputPath = path.join(evalRoot, 'registrations', 'canonical-capability-registry-v1.json');
const documentationPath = path.resolve(
  evalRoot,
  '..',
  'docs',
  'kubernetes-canonical-capability-registry.md'
);

const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as {
  tools: InventoryTool[];
};
const activeMapping = JSON.parse(readFileSync(mappingPath, 'utf8')) as ActiveMapping;
const directRules: DirectRule[] = inventory.tools.flatMap(tool =>
  tool.rules
    .filter(rule => (rule.mapping_readiness ?? tool.mapping_readiness) === 'direct_predicate')
    .map(rule => ({ ...rule, tool_id: tool.tool_id }))
);
const ruleById = new Map(directRules.map(rule => [rule.rule_id, rule] as const));

const draftCoverage: DraftCoverage[] = readdirSync(draftRoot)
  .map(directory => path.join(draftRoot, directory, 'coverage.json'))
  .filter(existsSync)
  .map(file => JSON.parse(readFileSync(file, 'utf8')) as DraftCoverage)
  .sort((left, right) => left.scenario_id.localeCompare(right.scenario_id));
const canonicalEvidenceCoverage = draftCoverage.filter(coverage =>
  /^registrations\/rule-gap-scenarios-v[1-5]\.json$/.test(coverage.source_catalog)
);

const parent = new Map(directRules.map(rule => [rule.rule_id, rule.rule_id] as const));
const find = (ruleId: string): string => {
  const current = parent.get(ruleId);
  assert.ok(current, `unknown direct rule ${ruleId}`);
  if (current === ruleId) return ruleId;
  const root = find(current);
  parent.set(ruleId, root);
  return root;
};
const union = (left: string, right: string): void => {
  const leftRoot = find(left);
  const rightRoot = find(right);
  if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
};

const scenarioIdsByRule = new Map<string, string[]>();
for (const coverage of draftCoverage) {
  const directTargetIds = coverage.target_rule_ids.filter(ruleId => ruleById.has(ruleId));
  for (const ruleId of directTargetIds) {
    const scenarioIds = scenarioIdsByRule.get(ruleId) ?? [];
    scenarioIds.push(coverage.scenario_id);
    scenarioIdsByRule.set(ruleId, scenarioIds);
  }
}
const canonicalScenarioIdsByRule = new Map<string, string[]>();
for (const coverage of canonicalEvidenceCoverage) {
  for (const ruleId of coverage.target_rule_ids.filter(ruleId => ruleById.has(ruleId))) {
    const scenarioIds = canonicalScenarioIdsByRule.get(ruleId) ?? [];
    scenarioIds.push(coverage.scenario_id);
    canonicalScenarioIdsByRule.set(ruleId, scenarioIds);
  }
}

const rulesByToolLocalGroup = new Map<string, DirectRule[]>();
for (const rule of directRules) {
  const members = rulesByToolLocalGroup.get(rule.semantic_group_id) ?? [];
  members.push(rule);
  rulesByToolLocalGroup.set(rule.semantic_group_id, members);
}

const kubeBenchComponent = (rule: DirectRule): string => {
  if (rule.tool_id !== 'kube-bench') return 'tool-local';
  if (rule.source_path.endsWith('/node.yaml')) return 'kubelet';
  if (rule.source_path.endsWith('/etcd.yaml')) return 'etcd';
  if (rule.source_path.endsWith('/policies.yaml')) return 'policy';
  if (rule.source_path.endsWith('/controlplane.yaml')) return 'control-plane-policy';
  if (rule.source_path.endsWith('/managedservices.yaml')) return 'managed-service';
  if (rule.source_path === 'cfg/rh-0.7/master.yaml') {
    const legacySection = rule.rule_id.match(/-master-(\d+)-/)?.[1];
    return (
      {
        '2': 'api-server',
        '3': 'controller-manager',
        '4': 'scheduler',
        '5': 'etcd',
      }[legacySection ?? ''] ?? 'master-file'
    );
  }
  const masterSection = rule.rule_id.match(/-master-\d+-(\d+)-/)?.[1];
  return (
    {
      '2': 'api-server',
      '3': 'controller-manager',
      '4': 'scheduler',
    }[masterSection ?? ''] ?? 'master-file'
  );
};

for (const rules of rulesByToolLocalGroup.values()) {
  const partitions = new Map<string, DirectRule[]>();
  for (const rule of rules) {
    const scenarioKey = (canonicalScenarioIdsByRule.get(rule.rule_id) ?? []).sort().join('|');
    const partitionKey = `${kubeBenchComponent(rule)}:${
      scenarioKey === '' ? 'unassigned' : `scenario:${scenarioKey}`
    }`;
    const members = partitions.get(partitionKey) ?? [];
    members.push(rule);
    partitions.set(partitionKey, members);
  }
  for (const members of partitions.values()) {
    for (let index = 1; index < members.length; index += 1) {
      union(members[0]!.rule_id, members[index]!.rule_id);
    }
  }
}

const evidenceByReference = new Map<string, MergeEvidence>();
for (const coverage of draftCoverage) {
  const directTargetIds = coverage.target_rule_ids.filter(ruleId => ruleById.has(ruleId));
  if (directTargetIds.length > 0) {
    evidenceByReference.set(`shared_scenario:${coverage.scenario_id}`, {
      kind: 'shared_scenario',
      reference: coverage.scenario_id,
    });
  }
}

const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/\((?:automated|manual|scored|not scored|not applicable)\)\)?/g, '')
    .replace(/^cis benchmark \d+(?:\.\d+)*\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const rulesByNormalizedTitle = new Map<string, DirectRule[]>();
for (const rule of directRules) {
  const normalizedTitle = normalizeTitle(rule.title);
  if (normalizedTitle.length < 15) continue;
  const members = rulesByNormalizedTitle.get(normalizedTitle) ?? [];
  members.push(rule);
  rulesByNormalizedTitle.set(normalizedTitle, members);
}
const reviewedTitleGroups = [...rulesByNormalizedTitle.entries()]
  .filter(
    ([, rules]) =>
      new Set(rules.map(rule => rule.tool_id)).size > 1 &&
      new Set(rules.map(rule => find(rule.rule_id))).size > 1
  )
  .sort(([left], [right]) => left.localeCompare(right));
assert.equal(reviewedTitleGroups.length, 47);
assert.equal(
  createHash('sha256')
    .update(reviewedTitleGroups.map(([title]) => title).join('\n'))
    .digest('hex'),
  '9f73436c513bf5c864397cf17ea22f5f4346a108e0c6d9c1c6a1454428e86cdd'
);
const reviewedTitlesByRule = new Map<string, string[]>();
for (const [normalizedTitle, rules] of reviewedTitleGroups) {
  for (let index = 1; index < rules.length; index += 1) {
    union(rules[0]!.rule_id, rules[index]!.rule_id);
  }
  for (const rule of rules) {
    const titles = reviewedTitlesByRule.get(rule.rule_id) ?? [];
    titles.push(normalizedTitle);
    reviewedTitlesByRule.set(rule.rule_id, titles);
  }
  evidenceByReference.set(`reviewed_predicate:${normalizedTitle}`, {
    kind: 'reviewed_predicate',
    reference: normalizedTitle,
  });
}

const mergeAllScenarioIds = new Set([
  'rule-gap-cluster-admin-rolebinding',
  'rule-gap-container-allows-privilege-escalation',
  'rule-gap-container-binds-host-port',
  'rule-gap-container-references-missing-secret',
  'rule-gap-container-unmasks-proc',
  'rule-gap-cpu-limit-missing',
  'rule-gap-cpu-request-missing',
  'rule-gap-dangling-hpa-target',
  'rule-gap-dangling-ingress-backend',
  'rule-gap-dangling-network-policy-selector',
  'rule-gap-duplicate-environment-variable',
  'rule-gap-host-network-namespace',
  'rule-gap-hpa-references-missing-target',
  'rule-gap-httproute-references-missing-backend',
  'rule-gap-image-pull-policy',
  'rule-gap-ingress-has-no-tls',
  'rule-gap-kernel-default-protection-disabled',
  'rule-gap-latest-image-tag',
  'rule-gap-memory-limit-missing',
  'rule-gap-memory-request-missing',
  'rule-gap-memory-requirements-missing',
  'rule-gap-missing-liveness-probe',
  'rule-gap-missing-pod-disruption-budget',
  'rule-gap-missing-readiness-probe',
  'rule-gap-missing-service-account',
  'rule-gap-missing-topology-spread',
  'rule-gap-pdb-blocks-all-disruptions',
  'rule-gap-pdb-exceeds-hpa-minimum',
  'rule-gap-pod-mounts-container-runtime-socket',
  'rule-gap-pod-references-missing-service-account',
  'rule-gap-pod-sets-unsafe-sysctl',
  'rule-gap-pod-shares-host-ipc',
  'rule-gap-rbac-subject-can-create-pods',
  'rule-gap-rbac-subject-can-exec-into-pods',
  'rule-gap-service-uses-nodeport',
  'rule-gap-workload-selector-mismatch',
  'rule-gap-writable-container-root-filesystem',
]);
const keepSeparateScenarioIds = new Set([
  'rule-gap-container-image-tag-omitted',
  'rule-gap-container-references-missing-configmap',
  'rule-gap-deployment-uses-extensions-v1beta1',
  'rule-gap-hpa-capacity-mismatch',
  'rule-gap-hpa-minimum-replicas-too-low',
  'rule-gap-image-not-pinned',
  'rule-gap-ingress-references-missing-service',
  'rule-gap-ingress-without-valid-tls',
  'rule-gap-insufficient-replicas',
  'rule-gap-job-failed',
  'rule-gap-job-not-completed',
  'rule-gap-kubelet-unhealthy',
  'rule-gap-missing-pod-anti-affinity',
  'rule-gap-node-not-ready',
  'rule-gap-persistent-volume-phase-errors',
  'rule-gap-pod-containers-not-ready',
  'rule-gap-pod-crash-loop',
  'rule-gap-pod-evicted',
  'rule-gap-pod-misses-priority-class',
  'rule-gap-pod-oom-killed',
  'rule-gap-pod-uses-default-service-account',
  'rule-gap-rbac-role-uses-wildcards',
  'rule-gap-rbac-subject-can-read-secrets',
  'rule-gap-secret-exposed-through-environment',
  'rule-gap-unsafe-probe-suite',
]);
const customScenarioPartitions = new Map<
  string,
  Array<{ partition: string; matches: (rule: DirectRule) => boolean }>
>([
  [
    'rule-gap-blocked-image-registry',
    [{ partition: 'kubescape-blocklist', matches: rule => rule.tool_id === 'kubescape' }],
  ],
  [
    'rule-gap-container-missing-seccomp-profile',
    [
      {
        partition: 'runtime-default',
        matches: rule =>
          rule.tool_id === 'kube-bench' ||
          rule.rule_id.endsWith('set-seccomp-profile-RuntimeDefault'),
      },
      {
        partition: 'profile-configured',
        matches: rule =>
          rule.rule_id === 'kube-score:check:container-seccomp-profile' ||
          rule.rule_id === 'kubescape:rule:set-seccomp-profile',
      },
    ],
  ],
  [
    'rule-gap-cpu-requirements-missing',
    [
      {
        partition: 'cpu-request-and-limit',
        matches: rule => rule.tool_id !== 'kube-score',
      },
    ],
  ],
  [
    'rule-gap-falco-in-cluster-kubectl-exfiltration',
    [
      {
        partition: 'token-mounted',
        matches: rule =>
          rule.tool_id === 'kube-bench' ||
          rule.rule_id === 'kubescape:rule:serviceaccount-token-mount' ||
          rule.rule_id === 'popeye:code:301',
      },
      {
        partition: 'automount-enabled',
        matches: rule =>
          rule.rule_id === 'kubescape:rule:automount-service-account' ||
          rule.rule_id === 'polaris:check:automountServiceAccountToken',
      },
    ],
  ],
  [
    'rule-gap-falco-privileged-host-filesystem-escape',
    [
      {
        partition: 'privileged-container',
        matches: rule =>
          rule.tool_id !== 'falco' &&
          /privileged-container|security-context-privileged|runAsPrivileged|rule-privilege-escalation/.test(
            rule.rule_id
          ),
      },
      {
        partition: 'root-container',
        matches: rule =>
          rule.tool_id !== 'falco' &&
          /root-container|run-as-non-root|user-group-id|non-root-containers|runAsRootAllowed|popeye:code:30[26]/.test(
            rule.rule_id
          ),
      },
      {
        partition: 'any-hostpath',
        matches: rule =>
          rule.tool_id !== 'falco' &&
          (/minimize-the-admission-of-hostpath/.test(rule.rule_id) ||
            ['kubescape:rule:alert-any-hostpath', 'polaris:check:hostPathSet'].includes(
              rule.rule_id
            )),
      },
      {
        partition: 'writable-hostpath',
        matches: rule =>
          ['kube-linter:check:writable-host-mount', 'kubescape:rule:alert-rw-hostpath'].includes(
            rule.rule_id
          ),
      },
    ],
  ],
  [
    'rule-gap-namespace-without-network-policy',
    [
      {
        partition: 'namespace-has-no-policy',
        matches: rule =>
          rule.tool_id === 'kube-bench' || rule.rule_id === 'kubescape:rule:internal-networking',
      },
      {
        partition: 'pod-not-selected',
        matches: rule => ['kube-linter', 'kube-score', 'polaris', 'popeye'].includes(rule.tool_id),
      },
    ],
  ],
  [
    'rule-gap-net-raw-capability',
    [
      {
        partition: 'net-raw',
        matches: rule =>
          /net-raw|netraw/i.test(rule.rule_id) &&
          rule.rule_id !== 'polaris:check:insecureCapabilities',
      },
    ],
  ],
  [
    'rule-gap-non-rolling-deployment',
    [
      {
        partition: 'explicit-non-rolling-strategy',
        matches: rule => rule.tool_id !== 'kube-score',
      },
    ],
  ],
  [
    'rule-gap-pod-shares-host-pid',
    [
      {
        partition: 'host-pid',
        matches: rule => rule.rule_id !== 'kubescape:rule:host-pid-ipc-privileges',
      },
    ],
  ],
]);

const candidateScenarioIds = canonicalEvidenceCoverage
  .filter(coverage => {
    const roots = new Set(
      coverage.target_rule_ids.filter(ruleId => ruleById.has(ruleId)).map(ruleId => find(ruleId))
    );
    const tools = new Set(
      coverage.target_rule_ids
        .map(ruleId => ruleById.get(ruleId)?.tool_id)
        .filter((toolId): toolId is string => Boolean(toolId))
    );
    return roots.size > 1 && tools.size > 1;
  })
  .map(coverage => coverage.scenario_id)
  .sort();
const reviewedScenarioIds = [
  ...mergeAllScenarioIds,
  ...keepSeparateScenarioIds,
  ...customScenarioPartitions.keys(),
].sort();
assert.deepEqual(reviewedScenarioIds, candidateScenarioIds);

const reviewedScenarioPartitionsByRule = new Map<string, string[]>();
for (const coverage of canonicalEvidenceCoverage.filter(entry =>
  mergeAllScenarioIds.has(entry.scenario_id)
)) {
  const targetRules = coverage.target_rule_ids.filter(ruleId => ruleById.has(ruleId));
  for (let index = 1; index < targetRules.length; index += 1)
    union(targetRules[0]!, targetRules[index]!);
  for (const ruleId of targetRules) {
    reviewedScenarioPartitionsByRule.set(ruleId, [`${coverage.scenario_id}:all`]);
  }
}
for (const coverage of canonicalEvidenceCoverage.filter(entry =>
  customScenarioPartitions.has(entry.scenario_id)
)) {
  const targetRules = coverage.target_rule_ids
    .map(ruleId => ruleById.get(ruleId))
    .filter(Boolean) as DirectRule[];
  const claimed = new Set<string>();
  for (const partition of customScenarioPartitions.get(coverage.scenario_id)!) {
    const members = targetRules.filter(partition.matches);
    assert.ok(members.length > 1, `${coverage.scenario_id}:${partition.partition}`);
    for (let index = 1; index < members.length; index += 1)
      union(members[0]!.rule_id, members[index]!.rule_id);
    for (const member of members) {
      assert.equal(claimed.has(member.rule_id), false, `${coverage.scenario_id}:${member.rule_id}`);
      claimed.add(member.rule_id);
      const references = reviewedScenarioPartitionsByRule.get(member.rule_id) ?? [];
      references.push(`${coverage.scenario_id}:${partition.partition}`);
      reviewedScenarioPartitionsByRule.set(member.rule_id, references);
    }
  }
}
for (const references of reviewedScenarioPartitionsByRule.values()) {
  for (const reference of references) {
    evidenceByReference.set(`reviewed_scenario_partition:${reference}`, {
      kind: 'reviewed_scenario_partition',
      reference,
    });
  }
}

for (const contract of activeMapping.contracts) {
  const coveredRuleIds = contract.tool_mappings
    .filter(mapping => mapping.status === 'covered')
    .flatMap(mapping => mapping.rule_ids)
    .filter(ruleId => ruleById.has(ruleId));
  for (let index = 1; index < coveredRuleIds.length; index += 1) {
    union(coveredRuleIds[0]!, coveredRuleIds[index]!);
  }
  if (coveredRuleIds.length > 0) {
    evidenceByReference.set(`active_contract:${contract.contract_id}`, {
      kind: 'active_contract',
      reference: contract.contract_id,
    });
  }
}

const slug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
const digest = (values: string[]): string =>
  createHash('sha256')
    .update([...values].sort().join('\n'))
    .digest('hex')
    .slice(0, 12);
const titleFor = (rules: DirectRule[]): string =>
  [...rules].sort((left, right) => {
    const predicateDifference =
      Number(Boolean(right.predicate_summary)) - Number(Boolean(left.predicate_summary));
    return (
      predicateDifference ||
      left.title.length - right.title.length ||
      left.title.localeCompare(right.title)
    );
  })[0]!.title;

const buildCapabilities = () => {
  const rulesByRoot = new Map<string, DirectRule[]>();
  for (const rule of directRules) {
    const root = find(rule.rule_id);
    const members = rulesByRoot.get(root) ?? [];
    members.push(rule);
    rulesByRoot.set(root, members);
  }
  return [...rulesByRoot.values()]
    .map(rules => {
      const sourceRuleIds = rules.map(rule => rule.rule_id).sort();
      const sourceSemanticGroupIds = [...new Set(rules.map(rule => rule.semantic_group_id))].sort();
      const sourceToolIds = [...new Set(rules.map(rule => rule.tool_id))].sort();
      const scenarioIds = [
        ...new Set(sourceRuleIds.flatMap(ruleId => scenarioIdsByRule.get(ruleId) ?? [])),
      ].sort();
      const activeContractIds = activeMapping.contracts
        .filter(contract =>
          contract.tool_mappings.some(
            mapping =>
              mapping.status === 'covered' &&
              mapping.rule_ids.some(ruleId => sourceRuleIds.includes(ruleId))
          )
        )
        .map(contract => contract.contract_id)
        .sort();
      const mergeEvidence: MergeEvidence[] = [
        ...activeContractIds.map(contractId =>
          evidenceByReference.get(`active_contract:${contractId}`)
        ),
        ...[
          ...new Set(sourceRuleIds.flatMap(ruleId => reviewedTitlesByRule.get(ruleId) ?? [])),
        ].map(title => evidenceByReference.get(`reviewed_predicate:${title}`)),
        ...[
          ...new Set(
            sourceRuleIds.flatMap(ruleId => reviewedScenarioPartitionsByRule.get(ruleId) ?? [])
          ),
        ].map(reference => evidenceByReference.get(`reviewed_scenario_partition:${reference}`)),
        ...[
          ...new Set(sourceRuleIds.flatMap(ruleId => reviewedSimilarityByRule.get(ruleId) ?? [])),
        ].map(reference => evidenceByReference.get(`reviewed_semantic_similarity:${reference}`)),
      ].filter((value): value is MergeEvidence => Boolean(value));
      const title = titleFor(rules);
      return {
        canonical_capability_id: `canonical:${slug(title)}:${digest(sourceRuleIds)}`,
        title,
        predicate_summary:
          rules.find(rule => rule.predicate_summary)?.predicate_summary ??
          rules.find(rule => rule.summary)?.summary ??
          title,
        review_status: sourceToolIds.length > 1 ? 'evidence_backed' : 'reviewed_single_tool',
        source_rule_ids: sourceRuleIds,
        source_semantic_group_ids: sourceSemanticGroupIds,
        source_tool_ids: sourceToolIds,
        scenario_ids: scenarioIds,
        active_contract_ids: activeContractIds,
        merge_evidence: mergeEvidence,
        coverage: {
          targeted: scenarioIds.length > 0 || activeContractIds.length > 0,
          implemented: scenarioIds.length > 0,
          qualified: activeContractIds.length > 0,
        },
      };
    })
    .sort((left, right) =>
      left.canonical_capability_id.localeCompare(right.canonical_capability_id)
    );
};

let reviewedSimilarityByRule = new Map<string, string[]>();
let capabilities = buildCapabilities();
let capabilityByRule = new Map(
  capabilities.flatMap(capability =>
    capability.source_rule_ids.map(ruleId => [ruleId, capability] as const)
  )
);

const unresolvedScenarioCandidates = canonicalEvidenceCoverage
  .map(coverage => {
    const capabilityIds = new Set(
      coverage.target_rule_ids
        .filter(ruleId => ruleById.has(ruleId))
        .map(ruleId => capabilityByRule.get(ruleId)!.canonical_capability_id)
    );
    const candidateCapabilities = [...capabilityIds].map(
      capabilityId =>
        capabilities.find(capability => capability.canonical_capability_id === capabilityId)!
    );
    const sourceToolIds = [
      ...new Set(candidateCapabilities.flatMap(capability => capability.source_tool_ids)),
    ].sort();
    return {
      candidate_id: `candidate:scenario:${coverage.scenario_id}`,
      candidate_kind: 'scenario_co_target' as const,
      normalized_title: coverage.scenario_id.replace(/^rule-gap-/, '').replace(/-/g, ' '),
      capability_ids: [...capabilityIds].sort(),
      source_rule_ids: [
        ...new Set(candidateCapabilities.flatMap(capability => capability.source_rule_ids)),
      ].sort(),
      source_semantic_group_ids: [
        ...new Set(
          candidateCapabilities.flatMap(capability => capability.source_semantic_group_ids)
        ),
      ].sort(),
      source_tool_ids: sourceToolIds,
      titles: [...new Set(candidateCapabilities.map(capability => capability.title))].sort(),
      review_reason:
        'A scenario co-targets these capabilities, but coherent scenario coverage does not prove predicate equivalence.',
    };
  })
  .filter(candidate => candidate.capability_ids.length > 1 && candidate.source_tool_ids.length > 1)
  .filter(
    candidate =>
      !reviewedScenarioIds.includes(candidate.candidate_id.replace('candidate:scenario:', ''))
  )
  .sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));

const similarityStopWords = new Set(
  'a an and are as at be by check checks configured configuration ensure ensures for from has have if in into is it its more must not of on or reports set should than that the their this to use used uses using verify when where which with'.split(
    ' '
  )
);
const semanticTokens = (value: string): Set<string> =>
  new Set(
    value
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(token => token.length > 2 && !similarityStopWords.has(token))
  );
const capabilityTokens = new Map(
  capabilities.map(capability => [
    capability.canonical_capability_id,
    semanticTokens(`${capability.title} ${capability.predicate_summary}`),
  ])
);
const unresolvedSimilarityCandidates = capabilities
  .flatMap((left, leftIndex) =>
    capabilities.slice(leftIndex + 1).flatMap(right => {
      if (left.source_tool_ids.some(toolId => right.source_tool_ids.includes(toolId))) return [];
      const leftTokens = capabilityTokens.get(left.canonical_capability_id)!;
      const rightTokens = capabilityTokens.get(right.canonical_capability_id)!;
      const intersection = [...leftTokens].filter(token => rightTokens.has(token)).length;
      if (intersection < 2) return [];
      const unionSize = new Set([...leftTokens, ...rightTokens]).size;
      const similarityScore = intersection / unionSize;
      if (similarityScore < 0.42) return [];
      const capabilityIds = [left.canonical_capability_id, right.canonical_capability_id].sort();
      return [
        {
          candidate_id: `candidate:similarity:${digest(capabilityIds)}`,
          candidate_kind: 'semantic_similarity' as const,
          normalized_title: `${left.title} <> ${right.title}`,
          similarity_score: Number(similarityScore.toFixed(4)),
          capability_ids: capabilityIds,
          source_rule_ids: [...new Set([...left.source_rule_ids, ...right.source_rule_ids])].sort(),
          source_semantic_group_ids: [
            ...new Set([...left.source_semantic_group_ids, ...right.source_semantic_group_ids]),
          ].sort(),
          source_tool_ids: [...new Set([...left.source_tool_ids, ...right.source_tool_ids])].sort(),
          titles: [left.title, right.title].sort(),
          review_reason:
            'Cross-tool predicate text has high token overlap, but subject, trigger, evidence, negative condition, and platform scope require explicit review.',
        },
      ];
    })
  )
  .sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));

assert.equal(unresolvedSimilarityCandidates.length, 85);
assert.equal(
  createHash('sha256')
    .update(unresolvedSimilarityCandidates.map(candidate => candidate.candidate_id).join('\n'))
    .digest('hex'),
  '1a4f3953dbeb301fd86d69721c1ebc85e5482591142ba56e7f96401eab6043db'
);
const reviewedSimilarityMergeIds = new Set([
  'candidate:similarity:07206c104c48',
  'candidate:similarity:0943b0ea4174',
  'candidate:similarity:0b1dcf954092',
  'candidate:similarity:0c3c3913daa0',
  'candidate:similarity:134302b7b1a8',
  'candidate:similarity:16ce3006a7a8',
  'candidate:similarity:1d6257fedd28',
  'candidate:similarity:21fa5a6e0441',
  'candidate:similarity:22cf56aa31ef',
  'candidate:similarity:27e7dc1a66ff',
  'candidate:similarity:299f2fa81f6a',
  'candidate:similarity:2a615efe76da',
  'candidate:similarity:2f66cd457332',
  'candidate:similarity:369079ccc016',
  'candidate:similarity:490b0dd34db9',
  'candidate:similarity:4d84e5c491fe',
  'candidate:similarity:4f93ba8071ec',
  'candidate:similarity:50d483673cf7',
  'candidate:similarity:5748da47a2ec',
  'candidate:similarity:5ace3d70f630',
  'candidate:similarity:6d76cafce681',
  'candidate:similarity:746b87f20de7',
  'candidate:similarity:78793908ca5b',
  'candidate:similarity:7e14902eb2c5',
  'candidate:similarity:8295c40e19b8',
  'candidate:similarity:91ce42133a3a',
  'candidate:similarity:91edef7887af',
  'candidate:similarity:921c58730a0a',
  'candidate:similarity:942c8ff921d9',
  'candidate:similarity:9760f88e95fd',
  'candidate:similarity:977fc28e376d',
  'candidate:similarity:99f2b597d887',
  'candidate:similarity:9eb4847e831b',
  'candidate:similarity:a114ab0ce26d',
  'candidate:similarity:a6635593ef42',
  'candidate:similarity:a83a33734b5a',
  'candidate:similarity:ace8a4c1ad4b',
  'candidate:similarity:b4a3ae3f6a97',
  'candidate:similarity:b9431bd16253',
  'candidate:similarity:bf9e0cca6c96',
  'candidate:similarity:c28fe6b98afe',
  'candidate:similarity:c65037a4bbb1',
  'candidate:similarity:c88f2f991d17',
  'candidate:similarity:c9e6775febe6',
  'candidate:similarity:cba52c5fd05a',
  'candidate:similarity:cc24b8da4509',
  'candidate:similarity:d13c9f0263b9',
  'candidate:similarity:d1eb6d345a40',
  'candidate:similarity:d5eb267b9dd3',
  'candidate:similarity:d5f16d1aaf44',
  'candidate:similarity:d716a0a805a4',
  'candidate:similarity:e3806123b84c',
  'candidate:similarity:e795708bac10',
  'candidate:similarity:e7c39ef6fd36',
  'candidate:similarity:e7c81ee4d96e',
  'candidate:similarity:eaa336cce8a1',
  'candidate:similarity:ef4854a433be',
  'candidate:similarity:f43ecf73194a',
  'candidate:similarity:f825843e60b6',
  'candidate:similarity:f980ce870618',
]);
const candidateIds = new Set(
  unresolvedSimilarityCandidates.map(candidate => candidate.candidate_id)
);
for (const candidateId of reviewedSimilarityMergeIds) assert.ok(candidateIds.has(candidateId));
const reviewedSimilarityKeepSeparateIds = new Set(
  unresolvedSimilarityCandidates
    .map(candidate => candidate.candidate_id)
    .filter(candidateId => !reviewedSimilarityMergeIds.has(candidateId))
);
assert.equal(reviewedSimilarityMergeIds.size, 60);
assert.equal(reviewedSimilarityKeepSeparateIds.size, 25);

reviewedSimilarityByRule = new Map<string, string[]>();
for (const candidate of unresolvedSimilarityCandidates) {
  if (!reviewedSimilarityMergeIds.has(candidate.candidate_id)) continue;
  const members = candidate.capability_ids.flatMap(
    capabilityId =>
      capabilities.find(capability => capability.canonical_capability_id === capabilityId)!
        .source_rule_ids
  );
  for (let index = 1; index < members.length; index += 1) union(members[0]!, members[index]!);
  for (const ruleId of members) {
    const references = reviewedSimilarityByRule.get(ruleId) ?? [];
    references.push(candidate.candidate_id);
    reviewedSimilarityByRule.set(ruleId, references);
  }
  evidenceByReference.set(`reviewed_semantic_similarity:${candidate.candidate_id}`, {
    kind: 'reviewed_semantic_similarity',
    reference: candidate.candidate_id,
  });
}
capabilities = buildCapabilities();
capabilityByRule = new Map(
  capabilities.flatMap(capability =>
    capability.source_rule_ids.map(ruleId => [ruleId, capability] as const)
  )
);
const similarityReviewDecisions = unresolvedSimilarityCandidates.map(candidate => {
  const decision = reviewedSimilarityMergeIds.has(candidate.candidate_id)
    ? ('merge' as const)
    : ('keep_separate' as const);
  const finalCapabilityIds = new Set(
    candidate.source_rule_ids.map(ruleId => capabilityByRule.get(ruleId)!.canonical_capability_id)
  );
  assert.equal(
    decision === 'merge' ? finalCapabilityIds.size === 1 : finalCapabilityIds.size > 1,
    true,
    `${candidate.candidate_id} ${decision} violated by transitive closure`
  );
  return {
    candidate_id: candidate.candidate_id,
    decision,
    source_rule_ids: candidate.source_rule_ids,
  };
});
const unresolvedCandidates = [...unresolvedScenarioCandidates].sort((left, right) =>
  left.candidate_id.localeCompare(right.candidate_id)
);

const splitToolLocalGroupCount = [...rulesByToolLocalGroup.entries()].filter(([, rules]) => {
  const capabilityIds = new Set(
    rules.map(rule => capabilityByRule.get(rule.rule_id)!.canonical_capability_id)
  );
  return capabilityIds.size > 1;
}).length;
const evidenceBacked = capabilities.filter(
  capability => capability.review_status === 'evidence_backed'
);
const registry = {
  schema_version: '1.0.0',
  generated_at: '2026-09-20',
  review_status: 'reviewed',
  canonicalization_complete: true,
  inventory_path: 'registrations/tool-rule-inventory-v1.json',
  active_mapping_path: 'registrations/tool-scenario-rule-mapping-v1.json',
  methodology: {
    assignment_unit:
      'Each direct-predicate rule occurrence is assigned to exactly one canonical capability.',
    confirmed_merge:
      'Cross-tool merges require reviewed predicate equivalence or a shared covered active contract; scenario co-targeting alone is insufficient.',
    split_handling:
      'Tool-local groups targeted by distinct scenarios are split by their occurrence-level scenario assignments.',
    candidate_policy:
      'Reviewed exact-title predicates merge only against a frozen input hash; remaining scenario co-targets stay explicit review candidates.',
    generation_gate:
      'Do not select another rule-gap batch until every unresolved candidate is adjudicated and the registry is reviewed.',
  },
  total_direct_predicate_occurrences: directRules.length,
  total_tool_local_semantic_groups: rulesByToolLocalGroup.size,
  total_canonical_capabilities: capabilities.length,
  evidence_backed_cross_tool_capabilities: evidenceBacked.length,
  reviewed_single_tool_capabilities: capabilities.length - evidenceBacked.length,
  split_tool_local_group_count: splitToolLocalGroupCount,
  reviewed_scenario_candidate_count: reviewedScenarioIds.length,
  reviewed_similarity_candidate_count: unresolvedSimilarityCandidates.length,
  reviewed_similarity_merge_count: reviewedSimilarityMergeIds.size,
  reviewed_similarity_keep_separate_count: reviewedSimilarityKeepSeparateIds.size,
  similarity_review: {
    candidate_set_hash: '1a4f3953dbeb301fd86d69721c1ebc85e5482591142ba56e7f96401eab6043db',
    merge_candidate_ids: [...reviewedSimilarityMergeIds].sort(),
    keep_separate_candidate_ids: [...reviewedSimilarityKeepSeparateIds].sort(),
    decisions: similarityReviewDecisions,
  },
  unresolved_similarity_candidate_count: 0,
  unresolved_candidate_count: unresolvedCandidates.length,
  coverage: {
    targeted: capabilities.filter(capability => capability.coverage.targeted).length,
    implemented: capabilities.filter(capability => capability.coverage.implemented).length,
    qualified: capabilities.filter(capability => capability.coverage.qualified).length,
  },
  capabilities,
  unresolved_candidates: unresolvedCandidates,
};

assert.equal(
  new Set(capabilities.flatMap(capability => capability.source_rule_ids)).size,
  directRules.length
);
const prettierConfig = (await prettier.resolveConfig(outputPath)) ?? {};
writeFileSync(
  outputPath,
  prettier.format(JSON.stringify(registry), { ...prettierConfig, parser: 'json' })
);

const markdown = [
  '# Kubernetes canonical capability registry',
  '',
  'Status: reviewed and frozen, 2026-09-20',
  '',
  'This registry is the mandatory canonicalization gate before another rule-gap',
  'scenario batch. It assigns every direct-predicate occurrence exactly once, merges',
  'only evidence-backed equivalents, and exposes title matches as review candidates',
  'rather than silently treating similar wording as equivalent behavior.',
  '',
  '## Current result',
  '',
  `- Direct-predicate occurrences: ${registry.total_direct_predicate_occurrences}`,
  `- Tool-local semantic groups: ${registry.total_tool_local_semantic_groups}`,
  `- Canonical capabilities: ${registry.total_canonical_capabilities}`,
  `- Evidence-backed cross-tool capabilities: ${registry.evidence_backed_cross_tool_capabilities}`,
  `- Reviewed single-tool capabilities: ${registry.reviewed_single_tool_capabilities}`,
  `- Tool-local groups split by occurrence evidence: ${registry.split_tool_local_group_count}`,
  `- Reviewed scenario co-target candidates: ${registry.reviewed_scenario_candidate_count}`,
  `- Reviewed exact-title merge sets: ${reviewedTitleGroups.length}`,
  `- Reviewed semantic-similarity candidates: ${registry.reviewed_similarity_candidate_count}`,
  `- Semantic-similarity merges / separations: ${registry.reviewed_similarity_merge_count} / ${registry.reviewed_similarity_keep_separate_count}`,
  `- Unresolved candidates: ${registry.unresolved_candidate_count}`,
  `- Unresolved semantic-similarity candidates: ${registry.unresolved_similarity_candidate_count}`,
  `- Targeted / implemented / qualified: ${registry.coverage.targeted} / ${registry.coverage.implemented} / ${registry.coverage.qualified}`,
  '',
  'The denominator is frozen for the pinned direct-predicate inventory. Future',
  'scenario batches must target canonical IDs that are not already implemented.',
  '',
  '## Review queue',
  '',
  ...(unresolvedCandidates.length === 0
    ? ['No unresolved canonicalization candidates.']
    : [
        '| Candidate | Tools | Capabilities | Occurrences | Normalized title |',
        '| --- | --- | ---: | ---: | --- |',
        ...unresolvedCandidates.map(
          candidate =>
            `| ${candidate.candidate_id} | ${candidate.source_tool_ids.join(', ')} | ${
              candidate.capability_ids.length
            } | ${candidate.source_rule_ids.length} | ${candidate.normalized_title} |`
        ),
      ]),
  '',
].join('\n');
const markdownConfig = (await prettier.resolveConfig(documentationPath)) ?? {};
writeFileSync(
  documentationPath,
  prettier.format(markdown, { ...markdownConfig, parser: 'markdown' })
);

console.log(
  `Wrote ${capabilities.length} reviewed capabilities from ${directRules.length} direct occurrences; ${unresolvedCandidates.length} candidates require review.`
);
