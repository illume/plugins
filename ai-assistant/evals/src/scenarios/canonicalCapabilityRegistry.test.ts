import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { Ajv, type AnySchema } from 'ajv';

interface Capability {
  canonical_capability_id: string;
  review_status: 'evidence_backed' | 'reviewed_single_tool';
  source_rule_ids: string[];
  source_semantic_group_ids: string[];
  source_tool_ids: string[];
  scenario_ids: string[];
  active_contract_ids: string[];
  merge_evidence: Array<{ kind: string; reference: string }>;
  coverage: { targeted: boolean; implemented: boolean; qualified: boolean };
}

interface Registry {
  review_status: 'provisional' | 'reviewed';
  canonicalization_complete: boolean;
  total_direct_predicate_occurrences: number;
  total_tool_local_semantic_groups: number;
  total_canonical_capabilities: number;
  evidence_backed_cross_tool_capabilities: number;
  reviewed_single_tool_capabilities: number;
  split_tool_local_group_count: number;
  reviewed_scenario_candidate_count: number;
  reviewed_similarity_candidate_count: number;
  reviewed_similarity_merge_count: number;
  reviewed_similarity_keep_separate_count: number;
  similarity_review: {
    candidate_set_hash: string;
    merge_candidate_ids: string[];
    keep_separate_candidate_ids: string[];
    decisions: Array<{
      candidate_id: string;
      decision: 'merge' | 'keep_separate';
      source_rule_ids: string[];
    }>;
  };
  unresolved_similarity_candidate_count: number;
  unresolved_candidate_count: number;
  capabilities: Capability[];
  unresolved_candidates: Array<{
    candidate_id: string;
    candidate_kind: 'scenario_co_target' | 'semantic_similarity';
    similarity_score?: number;
    capability_ids: string[];
    source_rule_ids: string[];
    source_semantic_group_ids: string[];
    source_tool_ids: string[];
  }>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(path.join(evalRoot, relativePath), 'utf8')) as T;
const registry = readJson<Registry>('registrations/canonical-capability-registry-v1.json');
const inventory = readJson<{
  tools: Array<{
    tool_id: string;
    mapping_readiness: string;
    rules: Array<{ rule_id: string; semantic_group_id: string; mapping_readiness?: string }>;
  }>;
}>('registrations/tool-rule-inventory-v1.json');

test('canonical capability registry matches its schema and declared totals', () => {
  const schema = readJson<AnySchema>('schema/canonical-capability-registry.schema.json');
  const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
    schema
  );
  assert.equal(validate(registry), true, JSON.stringify(validate.errors));
  assert.equal(registry.review_status, 'reviewed');
  assert.equal(registry.canonicalization_complete, true);
  assert.equal(registry.total_direct_predicate_occurrences, 6088);
  assert.equal(registry.total_tool_local_semantic_groups, 1496);
  assert.equal(registry.total_canonical_capabilities, 1271);
  assert.equal(registry.evidence_backed_cross_tool_capabilities, 122);
  assert.equal(registry.split_tool_local_group_count, 11);
  assert.ok(registry.reviewed_scenario_candidate_count > 0);
  assert.ok(registry.reviewed_similarity_candidate_count > 0);
  assert.equal(
    registry.reviewed_similarity_merge_count + registry.reviewed_similarity_keep_separate_count,
    registry.reviewed_similarity_candidate_count
  );
  assert.match(registry.similarity_review.candidate_set_hash, /^[0-9a-f]{64}$/);
  assert.equal(
    registry.similarity_review.merge_candidate_ids.length,
    registry.reviewed_similarity_merge_count
  );
  assert.equal(
    registry.similarity_review.keep_separate_candidate_ids.length,
    registry.reviewed_similarity_keep_separate_count
  );
  assert.equal(
    registry.similarity_review.decisions.length,
    registry.reviewed_similarity_candidate_count
  );
  assert.equal(
    new Set([
      ...registry.similarity_review.merge_candidate_ids,
      ...registry.similarity_review.keep_separate_candidate_ids,
    ]).size,
    registry.reviewed_similarity_candidate_count
  );
  assert.equal(registry.unresolved_similarity_candidate_count, 0);
  assert.equal(registry.unresolved_candidate_count, 0);
  assert.equal(registry.total_canonical_capabilities, registry.capabilities.length);
  assert.equal(registry.unresolved_candidate_count, registry.unresolved_candidates.length);
  assert.equal(
    registry.evidence_backed_cross_tool_capabilities + registry.reviewed_single_tool_capabilities,
    registry.capabilities.length
  );
});

test('reviewed synonym decisions survive transitive canonical merges', () => {
  const capabilityIdByRule = new Map(
    registry.capabilities.flatMap(capability =>
      capability.source_rule_ids.map(
        ruleId => [ruleId, capability.canonical_capability_id] as const
      )
    )
  );
  for (const decision of registry.similarity_review.decisions) {
    const finalCapabilityIds = new Set(
      decision.source_rule_ids.map(ruleId => capabilityIdByRule.get(ruleId))
    );
    assert.equal(
      decision.decision === 'merge' ? finalCapabilityIds.size === 1 : finalCapabilityIds.size > 1,
      true,
      decision.candidate_id
    );
  }
});

test('every direct-predicate occurrence is assigned exactly once', () => {
  const directRules = inventory.tools.flatMap(tool =>
    tool.rules
      .filter(rule => (rule.mapping_readiness ?? tool.mapping_readiness) === 'direct_predicate')
      .map(rule => ({ ...rule, tool_id: tool.tool_id }))
  );
  const assignedRuleIds = registry.capabilities.flatMap(capability => capability.source_rule_ids);
  assert.equal(assignedRuleIds.length, directRules.length);
  assert.equal(new Set(assignedRuleIds).size, directRules.length);
  assert.deepEqual([...assignedRuleIds].sort(), directRules.map(rule => rule.rule_id).sort());
  assert.equal(registry.total_direct_predicate_occurrences, directRules.length);
  assert.equal(
    registry.total_tool_local_semantic_groups,
    new Set(directRules.map(rule => rule.semantic_group_id)).size
  );

  const ruleById = new Map(directRules.map(rule => [rule.rule_id, rule] as const));
  for (const capability of registry.capabilities) {
    const members = capability.source_rule_ids.map(ruleId => ruleById.get(ruleId)!);
    assert.deepEqual(
      capability.source_semantic_group_ids,
      [...new Set(members.map(rule => rule.semantic_group_id))].sort()
    );
    assert.deepEqual(
      capability.source_tool_ids,
      [...new Set(members.map(rule => rule.tool_id))].sort()
    );
  }
});

test('cross-tool merges have explicit scenario or active-contract evidence', () => {
  for (const capability of registry.capabilities) {
    if (capability.source_tool_ids.length === 1) continue;
    assert.equal(capability.review_status, 'evidence_backed', capability.canonical_capability_id);
    assert.ok(capability.merge_evidence.length > 0, capability.canonical_capability_id);
    for (const evidence of capability.merge_evidence) {
      if (evidence.kind === 'active_contract') {
        assert.ok(capability.active_contract_ids.includes(evidence.reference));
      } else if (evidence.kind === 'reviewed_predicate') {
        assert.ok(evidence.reference.length >= 15);
      } else if (evidence.kind === 'reviewed_scenario_partition') {
        assert.match(evidence.reference, /^rule-gap-[a-z0-9-]+:[a-z0-9-]+$/);
      } else if (evidence.kind === 'reviewed_semantic_similarity') {
        assert.match(evidence.reference, /^candidate:similarity:[0-9a-f]{12}$/);
      } else {
        assert.fail(`unknown evidence kind ${evidence.kind}`);
      }
    }
  }
});

test('reviewed scenario partitions do not collapse independent predicates', () => {
  const capabilityByRuleId = new Map(
    registry.capabilities.flatMap(capability =>
      capability.source_rule_ids.map(
        ruleId => [ruleId, capability.canonical_capability_id] as const
      )
    )
  );
  for (const directory of readdirSync(path.join(evalRoot, 'scenario-drafts'))) {
    const coveragePath = path.join(evalRoot, 'scenario-drafts', directory, 'coverage.json');
    if (!existsSync(coveragePath)) continue;
    const coverage = JSON.parse(readFileSync(coveragePath, 'utf8')) as {
      scenario_id: string;
      target_rule_ids: string[];
    };
    const capabilityIds = new Set(
      coverage.target_rule_ids.map(ruleId => capabilityByRuleId.get(ruleId)).filter(Boolean)
    );
    assert.ok(capabilityIds.size >= 1, coverage.scenario_id);
  }
  const capabilityByRule = new Map(
    registry.capabilities.flatMap(capability =>
      capability.source_rule_ids.map(
        ruleId => [ruleId, capability.canonical_capability_id] as const
      )
    )
  );
  assert.notEqual(
    capabilityByRule.get('falco:rule:launch-privileged-container:178d44e5e3b2'),
    capabilityByRule.get('falco:rule:container-run-as-root-user:0f00443cc5d9')
  );
  assert.notEqual(
    capabilityByRule.get('falco:rule:launch-privileged-container:178d44e5e3b2'),
    capabilityByRule.get('falco:rule:launch-sensitive-mount-container:1588c89d5f81')
  );
});

test('authored scenarios have unique canonical target sets', () => {
  const capabilityIdByRule = new Map(
    registry.capabilities.flatMap(capability =>
      capability.source_rule_ids.map(
        ruleId => [ruleId, capability.canonical_capability_id] as const
      )
    )
  );
  const scenarioByTargetSet = new Map<string, string>();
  for (const directory of readdirSync(path.join(evalRoot, 'scenario-drafts'))) {
    const coveragePath = path.join(evalRoot, 'scenario-drafts', directory, 'coverage.json');
    if (!existsSync(coveragePath)) continue;
    const coverage = JSON.parse(readFileSync(coveragePath, 'utf8')) as {
      scenario_id: string;
      target_rule_ids: string[];
    };
    const targetSet = [
      ...new Set(coverage.target_rule_ids.map(ruleId => capabilityIdByRule.get(ruleId))),
    ]
      .sort()
      .join('|');
    assert.equal(
      scenarioByTargetSet.has(targetSet),
      false,
      `${coverage.scenario_id} duplicates ${scenarioByTargetSet.get(targetSet)}`
    );
    scenarioByTargetSet.set(targetSet, coverage.scenario_id);
  }
});

test('v6 through v9 batches own whole capabilities without changing frozen merge evidence', () => {
  const capabilityIdByRule = new Map(
    registry.capabilities.flatMap(capability =>
      capability.source_rule_ids.map(
        ruleId => [ruleId, capability.canonical_capability_id] as const
      )
    )
  );
  for (const directory of readdirSync(path.join(evalRoot, 'scenario-drafts'))) {
    const coveragePath = path.join(evalRoot, 'scenario-drafts', directory, 'coverage.json');
    if (!existsSync(coveragePath)) continue;
    const coverage = JSON.parse(readFileSync(coveragePath, 'utf8')) as {
      source_catalog: string;
      scenario_id: string;
      target_rule_ids: string[];
    };
    if (!/^registrations\/rule-gap-scenarios-v[6-9]\.json$/.test(coverage.source_catalog)) {
      continue;
    }
    const capabilityIds = new Set(
      coverage.target_rule_ids.map(ruleId => capabilityIdByRule.get(ruleId)).filter(Boolean)
    );
    assert.equal(capabilityIds.size, 1, coverage.scenario_id);
  }

  const reviewedScenarioRefs = registry.capabilities.flatMap(capability =>
    capability.merge_evidence
      .filter(evidence => evidence.kind === 'reviewed_scenario_partition')
      .map(evidence => evidence.reference)
  );
  assert.equal(
    reviewedScenarioRefs.some(reference => /rule-gap-v[6-9]-/.test(reference)),
    false
  );
});

test('reviewed similarity decisions preserve component, polarity, and threshold boundaries', () => {
  const capabilityByRule = new Map(
    registry.capabilities.flatMap(capability =>
      capability.source_rule_ids.map(
        ruleId => [ruleId, capability.canonical_capability_id] as const
      )
    )
  );
  const same = (left: string, right: string) =>
    assert.equal(capabilityByRule.get(left), capabilityByRule.get(right), `${left} <> ${right}`);
  const separate = (left: string, right: string) =>
    assert.notEqual(capabilityByRule.get(left), capabilityByRule.get(right), `${left} <> ${right}`);

  same(
    'kubescape:rule:ensure-that-the-api-server-tls-cert-file-and-tls-private-key-file-arguments-are-set-as-appropriate',
    'kube-bench:source:ack-1-0-master-1-2-28-ensure-that-the-tls-cert-file-and-tls-private-key-:9536b4de8426'
  );
  same(
    'kubescape:rule:validate-kubelet-tls-configuration-updated',
    'kube-bench:source:ack-1-0-node-4-2-9-ensure-that-the-tls-cert-file-and-tls-private-key-fil:311ba5de31bb'
  );
  same(
    'kubescape:rule:ensure-that-the-scheduler-profiling-argument-is-set-to-false',
    'kube-bench:source:ack-1-0-master-1-4-1-ensure-that-the-profiling-argument-is-set-to-false-:b4a8fc1b176c'
  );

  separate(
    'kubescape:rule:ensure-that-the-api-server-tls-cert-file-and-tls-private-key-file-arguments-are-set-as-appropriate',
    'kubescape:rule:validate-kubelet-tls-configuration-updated'
  );
  separate(
    'kubescape:rule:ensure-that-the-api-server-service-account-key-file-argument-is-set-as-appropriate',
    'kubescape:rule:ensure-that-the-controller-manager-service-account-private-key-file-argument-is-set-as-appropriate'
  );
  separate(
    'kube-bench:source:rh-1-0-node-4-2-6-ensure-that-the-protect-kernel-defaults-argument-is-no:89b021f2ea41',
    'kubescape:rule:kubelet-protect-kernel-defaults'
  );
  separate(
    'kubescape:rule:ensure-that-the-admin.conf-file-permissions-are-set-to-600',
    'kube-bench:source:cis-1-5-master-1-1-13-ensure-that-the-admin-conf-file-permissions-are-se:67caff30a98e'
  );
});

test('unresolved candidates never merge capabilities by title alone', () => {
  const capabilityById = new Map(
    registry.capabilities.map(
      capability => [capability.canonical_capability_id, capability] as const
    )
  );
  assert.equal(
    new Set(registry.unresolved_candidates.map(candidate => candidate.candidate_id)).size,
    registry.unresolved_candidates.length
  );
  for (const candidate of registry.unresolved_candidates) {
    if (candidate.candidate_kind === 'semantic_similarity') {
      assert.ok((candidate.similarity_score ?? 0) >= 0.42);
    }
    assert.ok(candidate.capability_ids.length > 1);
    assert.ok(candidate.source_tool_ids.length > 1);
    assert.equal(new Set(candidate.capability_ids).size, candidate.capability_ids.length);
    const capabilities = candidate.capability_ids.map(
      capabilityId => capabilityById.get(capabilityId)!
    );
    assert.ok(capabilities.every(Boolean));
    assert.deepEqual(
      candidate.source_rule_ids,
      [...new Set(capabilities.flatMap(capability => capability.source_rule_ids))].sort()
    );
    assert.deepEqual(
      candidate.source_semantic_group_ids,
      [...new Set(capabilities.flatMap(capability => capability.source_semantic_group_ids))].sort()
    );
  }
});

test('later rule-gap catalogues can target only new canonical capabilities', () => {
  const laterCatalogues = readdirSync(path.join(evalRoot, 'registrations')).filter(file => {
    const match = file.match(/^rule-gap-scenarios-v(\d+)\.json$/);
    return match && Number(match[1]) > 5;
  });
  const capabilityById = new Map(
    registry.capabilities.map(
      capability => [capability.canonical_capability_id, capability] as const
    )
  );
  const capabilityIdByRule = new Map(
    registry.capabilities.flatMap(capability =>
      capability.source_rule_ids.map(
        ruleId => [ruleId, capability.canonical_capability_id] as const
      )
    )
  );
  const catalogues = laterCatalogues.map(file =>
    readJson<{
      scenarios: Array<{
        scenario_id: string;
        target_rule_ids: string[];
        target_canonical_capability_ids?: string[];
      }>;
    }>(path.join('registrations', file))
  );
  const selected = new Set<string>();
  for (const catalogue of catalogues) {
    for (const scenario of catalogue.scenarios) {
      assert.ok(scenario.target_canonical_capability_ids?.length, scenario.scenario_id);
      assert.deepEqual(
        [...scenario.target_canonical_capability_ids].sort(),
        [...new Set(scenario.target_rule_ids.map(ruleId => capabilityIdByRule.get(ruleId)))].sort(),
        scenario.scenario_id
      );
      for (const capabilityId of scenario.target_canonical_capability_ids) {
        const capability = capabilityById.get(capabilityId);
        assert.ok(capability, `${scenario.scenario_id}: ${capabilityId}`);
        assert.equal(
          capability.active_contract_ids.length,
          0,
          `${scenario.scenario_id}: ${capabilityId}`
        );
        assert.deepEqual(
          capability.scenario_ids,
          [scenario.scenario_id],
          `${scenario.scenario_id}: ${capabilityId}`
        );
        assert.equal(selected.has(capabilityId), false, `${scenario.scenario_id}: ${capabilityId}`);
        selected.add(capabilityId);
      }
    }
  }
  assert.equal(selected.size, 566);
  assert.equal(
    registry.capabilities.filter(capability => capability.coverage.targeted).length,
    1132
  );
  assert.equal(
    registry.capabilities.filter(capability => capability.coverage.implemented).length,
    1131
  );
  assert.equal(registry.capabilities.filter(capability => capability.coverage.qualified).length, 1);
});
