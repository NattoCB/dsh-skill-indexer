#!/usr/bin/env node
// Demo: scan the default skill roots and route a few sample intents.
// Run from the repo root: `node scripts/demo_query.mjs ["query1" "query2" ...]`
import os from 'node:os';
import path from 'node:path';
import { buildIndex } from '../src/indexer.js';
import { routeIntent } from '../src/router.js';
import { renderInjectionText } from '../src/output.js';

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const roots = [
	{ path: path.join(os.homedir(), '.workbuddy', 'skills'), type: 'workbuddy' },
	{ path: path.join(dshHome, 'skills'), type: 'dsh' },
];

const index = buildIndex(roots, {});
console.log(`indexed ${index.skills.length} skills (${index.warnings.length} warnings)`);

const queries = process.argv.slice(2);
const samples = queries.length
	? queries
	: [
		'把这周的ETF拉出来画个图',
		'帮我提交今天的代码改动',
		'讲一下高杠杆决策怎么裁决',
		'把这个PDF转成markdown',
	];

for (const q of samples) {
	const r = routeIntent(index, q);
	console.log(`\nQ: ${q}\n${renderInjectionText(index, r)}`);
}
