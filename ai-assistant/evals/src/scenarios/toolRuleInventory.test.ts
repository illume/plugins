/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { Ajv, type AnySchema } from 'ajv';

interface RuleInventoryItem {
  rule_id: string;
  semantic_group_id: string;
  summary: string;
  summary_origin: 'native' | 'derived';
  info_url: string;
  id_origin: 'native' | 'derived';
  [key: string]: unknown;
}

interface ToolInventory {
  tool_id: string;
  repository: string;
  revision: string;
  id_origin: 'native' | 'derived';
  mapping_readiness: 'direct_predicate' | 'requires_decomposition' | 'reference_only';
  rule_count: number;
  semantic_group_count: number;
  rules: RuleInventoryItem[];
}

interface RuleInventory {
  review_status: 'provisional' | 'reviewed';
  total_tools: number;
  total_rules: number;
  total_semantic_groups: number;
  tools: ToolInventory[];
}

const here = path.dirname(fileURLToPath(import.meta.url));
const evalRoot = path.resolve(here, '..', '..');
const aiAssistantRoot = path.resolve(evalRoot, '..');
const inventoryPath = path.join(evalRoot, 'registrations', 'tool-rule-inventory-v1.json');
const schemaPath = path.join(evalRoot, 'schema', 'tool-rule-inventory.schema.json');
const listRoot = path.join(aiAssistantRoot, 'docs', 'rule-inventories');

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

test('tool rule inventory is complete, unique, and separate from coverage', () => {
  const schema = readJson(schemaPath) as AnySchema;
  const inventory = readJson(inventoryPath) as RuleInventory;
  const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
    schema
  );

  assert.equal(validate(inventory), true, JSON.stringify(validate.errors));
  assert.equal(inventory.total_tools, inventory.tools.length);
  assert.equal(inventory.review_status, 'provisional');
  assert.equal(
    inventory.total_rules,
    inventory.tools.reduce((sum, tool) => sum + tool.rules.length, 0)
  );
  assert.equal(
    inventory.total_semantic_groups,
    inventory.tools.reduce((sum, tool) => sum + tool.semantic_group_count, 0)
  );

  const toolIds = new Set<string>();
  const ruleIds = new Set<string>();
  const semanticGroupIds = new Set<string>();
  const reviewedMultiTitleGroups = new Set([
    'node-problem-detector',
    'kstatus',
    'kyverno',
    'kube-bench',
    'pluto',
  ]);
  for (const tool of inventory.tools) {
    assert.equal(toolIds.has(tool.tool_id), false, `duplicate tool ID ${tool.tool_id}`);
    toolIds.add(tool.tool_id);
    assert.equal(tool.rule_count, tool.rules.length, `${tool.tool_id} rule count`);
    assert.equal(
      tool.semantic_group_count,
      new Set(tool.rules.map(rule => rule.semantic_group_id)).size,
      `${tool.tool_id} semantic group count`
    );
    const groupedRules = new Map<string, RuleInventoryItem[]>();
    for (const rule of tool.rules) {
      const rules = groupedRules.get(rule.semantic_group_id) ?? [];
      rules.push(rule);
      groupedRules.set(rule.semantic_group_id, rules);
    }
    for (const [groupId, rules] of groupedRules) {
      const titles = new Set(rules.map(rule => rule.title));
      if (rules.length > 1 && titles.size > 1) {
        assert.equal(
          reviewedMultiTitleGroups.has(tool.tool_id),
          true,
          `${groupId} unexpectedly merges different titles`
        );
      }
    }

    const markdown = readFileSync(path.join(listRoot, `${tool.tool_id}.md`), 'utf8');
    assert.equal(
      markdown.match(/^\| `[^\n]+/gm)?.length ?? 0,
      tool.rule_count,
      `${tool.tool_id} Markdown row count`
    );

    for (const rule of tool.rules) {
      assert.equal(ruleIds.has(rule.rule_id), false, `duplicate rule ID ${rule.rule_id}`);
      ruleIds.add(rule.rule_id);
      assert.equal(rule.id_origin, tool.id_origin, `${rule.rule_id} ID origin`);
      assert.ok(rule.semantic_group_id.startsWith(`${tool.tool_id}:semantic:`));
      assert.ok(rule.summary.trim().length >= 3, `${rule.rule_id} needs a summary`);
      assert.ok(rule.summary.length <= 320, `${rule.rule_id} summary is too long`);
      semanticGroupIds.add(rule.semantic_group_id);
      assert.ok(
        rule.info_url.startsWith(`${tool.repository}/blob/${tool.revision}/`),
        `${rule.rule_id} must link to its pinned source`
      );
      assert.equal('coverage_status' in rule, false, `${rule.rule_id} has premature coverage`);
      assert.equal('scenario_ids' in rule, false, `${rule.rule_id} has premature scenarios`);
      if (rule.id_origin === 'derived') {
        const semanticPart = rule.rule_id.split(':').at(-2) ?? '';
        assert.match(semanticPart, /[a-z]{3}/, `${rule.rule_id} needs a readable segment`);
      }
    }
  }

  assert.equal(ruleIds.size, inventory.total_rules);
  assert.equal(semanticGroupIds.size, inventory.total_semantic_groups);
  assert.deepEqual(
    readdirSync(listRoot)
      .filter(file => file.endsWith('.md'))
      .sort(),
    inventory.tools.map(tool => `${tool.tool_id}.md`).sort()
  );
});
