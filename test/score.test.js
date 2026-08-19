// dsh-skill-indexer · score tests

import test from 'node:test';
import assert from 'node:assert/strict';
import {
	preprocessQuery,
	posWeight,
	idf,
	buildDfMap,
	queryUnitCount,
	categoryScore,
	skillScore,
} from '../src/score.js';

test('preprocessQuery lowercases and strips punctuation', () => {
	assert.equal(preprocessQuery('  把这周的ETF,拉出来画个图！  '), '把这周的etf 拉出来画个图');
	assert.equal(preprocessQuery('  Hello, World!  '), 'hello world');
});

test('posWeight decays with match position', () => {
	assert.equal(posWeight(0), 1);
	assert.ok(posWeight(10) < posWeight(0));
	assert.ok(posWeight(10) > 0);
});

test('idf decreases as document frequency grows', () => {
	assert.ok(idf(0, 10) > idf(5, 10));
	assert.ok(idf(9, 10) > 0);
});

test('buildDfMap counts each skill once per keyword', () => {
	const df = buildDfMap([
		{ keywords: ['etf', '基金'] },
		{ keywords: ['etf'] },
	]);
	assert.equal(df.get('etf'), 2);
	assert.equal(df.get('基金'), 1);
	assert.equal(df.get('absent'), undefined);
});

test('queryUnitCount estimates english words + cjk segments', () => {
	assert.equal(queryUnitCount('把这周的ETF拉出来画个图'), 3); // 1 en + 2 cjk runs
	assert.equal(queryUnitCount('hello world'), 2);
	assert.equal(queryUnitCount(''), 0);
});

test('categoryScore rewards a matching keyword and zeroes otherwise', () => {
	const cat = { id: 'finance', keywords: ['etf', '股票'] };
	const df = buildDfMap([{ keywords: ['etf'] }]);
	assert.ok(categoryScore(cat, '把这周的ETF拉出来画个图', df, 1) > 0);
	assert.equal(categoryScore(cat, '完全无关的查询', df, 1), 0);
});

test('skillScore adds trigger hits at higher weight than keyword hits', () => {
	const df = buildDfMap([{ keywords: ['筛选场内'] }]);
	const kwOnly = { name: 'x', keywords: ['筛选场内'], triggers: [] };
	const trigOnly = { name: 'x', keywords: [], triggers: ['筛选场内'] };
	const a = skillScore(kwOnly, '筛选场内', df, 1);
	const b = skillScore(trigOnly, '筛选场内', df, 1);
	assert.ok(a > 0);
	assert.ok(b > a); // same word as trigger weighs x1.5 over keyword
});

test('skillScore is zero when nothing matches', () => {
	const df = buildDfMap([{ keywords: ['etf'] }]);
	const s = { name: 'x', keywords: ['etf'], triggers: ['宽基etf'] };
	assert.equal(skillScore(s, '完全不相关', df, 1), 0);
});
