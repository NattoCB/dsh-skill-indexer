// dsh-skill-indexer · indexer tests

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildIndex } from '../src/indexer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WB = path.join(HERE, 'fixtures', 'workbuddy');
const DSH = path.join(HERE, 'fixtures', 'dsh');
const ROOTS = [
	{ path: WB, type: 'workbuddy' },
	{ path: DSH, type: 'dsh' },
];

test('buildIndex counts skills and dedupes cross-root names', () => {
	const index = buildIndex(ROOTS, {});
	assert.equal(index.skills.length, 7);
	const ids = new Set(index.skills.map((s) => s.id));
	assert.ok(ids.has('pdf-to-markdown@workbuddy'));
	assert.ok(ids.has('pdf-to-markdown@dsh'));
	assert.ok(ids.has('etf-filter'));
});

test('buildIndex keeps category references closed', () => {
	const index = buildIndex(ROOTS, {});
	const finance = index.categories.find((c) => c.id === 'finance');
	assert.ok(finance.skills.includes('etf-filter'));
	const skillIds = new Set(index.skills.map((s) => s.id));
	for (const c of index.categories) {
		for (const sid of c.skills) assert.ok(skillIds.has(sid), `dangling category ref: ${sid}`);
	}
});

test('buildIndex preserves usage stats for unchanged hashes', () => {
	const index = buildIndex(ROOTS, {});
	index.skills[0].usage_count = 42;
	index.skills[0].last_used = '2026-01-01T00:00:00Z';
	const rebuilt = buildIndex(ROOTS, { oldIndex: index });
	const byId = new Map(rebuilt.skills.map((s) => [s.id, s]));
	assert.equal(byId.get(index.skills[0].id).usage_count, 42);
	assert.equal(byId.get(index.skills[0].id).last_used, '2026-01-01T00:00:00Z');
});

test('buildIndex emits deterministic output (modulo generated_at)', () => {
	const strip = (i) => {
		const { generated_at, ...rest } = i;
		return JSON.stringify(rest);
	};
	assert.equal(strip(buildIndex(ROOTS, {})), strip(buildIndex(ROOTS, {})));
});
