// dsh-skill-indexer · router tests

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildIndex } from '../src/indexer.js';
import { routeIntent } from '../src/router.js';
import { renderInjectionText } from '../src/output.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOTS = [
	{ path: path.join(HERE, 'fixtures', 'workbuddy'), type: 'workbuddy' },
	{ path: path.join(HERE, 'fixtures', 'dsh'), type: 'dsh' },
];
const index = buildIndex(ROOTS, {});

test('routes an ETF intent to finance / etf-filter', () => {
	const r = routeIntent(index, '把这周的ETF拉出来画个图');
	assert.equal(r.state, 'hit');
	assert.ok(r.categories.includes('finance'));
	assert.ok(r.hits.includes('etf-filter'));
});

test('routes a git intent to git-workflow / git-finish-work', () => {
	const r = routeIntent(index, '帮我提交今天的代码改动');
	assert.equal(r.state, 'hit');
	assert.ok(r.categories.includes('git-workflow'));
	assert.ok(r.hits.includes('git-finish-work'));
});

test('routes a decision intent to decision / meta-principles', () => {
	const r = routeIntent(index, '讲一下高杠杆决策怎么裁决');
	assert.equal(r.state, 'hit');
	assert.ok(r.categories.includes('decision'));
	assert.ok(r.hits.includes('meta-principles'));
});

test('misses an unrelated intent', () => {
	const r = routeIntent(index, '帮我订个外卖');
	assert.equal(r.state, 'miss');
	assert.deepEqual(r.hits, []);
});

test('falls back to low confidence below theta1 with flat top-k', () => {
	const r = routeIntent(index, '把这周的ETF拉出来画个图', { theta1: 10, theta2: 0 });
	assert.equal(r.state, 'low');
	assert.ok(r.hits.length > 0);
});

test('renders the injection text template', () => {
	const r = routeIntent(index, '把这周的ETF拉出来画个图');
	const text = renderInjectionText(index, r);
	assert.ok(text.includes('【技能路由】'));
	assert.ok(text.includes('可用大类'));
	assert.ok(text.includes('etf-filter'));
});

test('renders a miss with the category table and a hint', () => {
	const r = routeIntent(index, '帮我订个外卖');
	const text = renderInjectionText(index, r);
	assert.ok(text.includes('未命中任何技能大类'));
	assert.ok(text.includes('可用大类'));
});

test('routing is deterministic for identical input', () => {
	const a = JSON.stringify(routeIntent(index, '把这周的ETF拉出来画个图'));
	const b = JSON.stringify(routeIntent(index, '把这周的ETF拉出来画个图'));
	assert.equal(a, b);
});
