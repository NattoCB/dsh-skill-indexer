// dsh-skill-indexer · extract tests

import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTriggers, extractKeywords } from '../src/extract.js';

test('extractTriggers collects quoted phrases and dedupes', () => {
	const d = '当用户询问"筛选/推荐某类ETF"、"低估值行业ETF"、"高股息"时使用，也支持"高股息"。';
	assert.deepEqual(extractTriggers(d), ['筛选/推荐某类ETF', '低估值行业ETF', '高股息']);
});

test('extractTriggers returns empty for a description without quotes', () => {
	assert.deepEqual(extractTriggers('Branch-aware Git completion workflow.'), []);
});

test('extractKeywords merges english words and chinese fragments', () => {
	const k = extractKeywords('筛选场内ETF基金，低估值行业ETF');
	assert.ok(k.includes('etf'));
	assert.ok(k.includes('筛选场内'));
	assert.ok(k.includes('基金'));
	assert.ok(k.includes('低估值行业'));
});

test('extractKeywords drops short english and pure-digit tokens', () => {
	const k = extractKeywords('ab 1234 useful');
	assert.ok(!k.includes('ab'));
	assert.ok(!k.includes('1234'));
	assert.ok(k.includes('useful'));
});
