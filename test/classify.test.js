// dsh-skill-indexer · classify tests

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySkill } from '../src/classify.js';
import { parseOverridesYaml } from '../src/overrides.js';

test('classifySkill assigns finance', () => {
	assert.deepEqual(classifySkill('查询/筛选场内ETF基金', ['etf', '基金']), ['finance']);
});

test('classifySkill assigns git-workflow', () => {
	assert.deepEqual(classifySkill('Git branch-aware commit workflow', ['commit', 'git']), ['git-workflow']);
});

test('classifySkill falls back to general on zero hits', () => {
	assert.deepEqual(classifySkill('does something unrelated', ['something', 'unrelated']), ['general']);
});

test('classifySkill picks the primary domain and adds secondary at >= 2 hits', () => {
	// "估值" is shared by finance and ib; "cim" is ib-only -> ib wins, finance stays at 1.
	assert.deepEqual(classifySkill('投资银行CIM估值建模', ['估值', 'cim']), ['ib']);
});

test('parseOverridesYaml parses inline list and bare scalar', () => {
	const yaml = [
		'overrides:',
		'  git-finish-work: ["git-workflow", "delivery"]',
		'  pdf-to-markdown: docs',
	].join('\n');
	const o = parseOverridesYaml(yaml);
	assert.deepEqual(o['git-finish-work'], ['git-workflow', 'delivery']);
	assert.deepEqual(o['pdf-to-markdown'], ['docs']);
});
