// dsh-skill-indexer · scanner tests

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseSkillDocument, scanRoot, unquote } from '../src/scanner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WB = path.join(HERE, 'fixtures', 'workbuddy');

test('unquote strips only the outermost paired quotes', () => {
	assert.equal(unquote('"hello"'), 'hello');
	assert.equal(unquote("'hello'"), 'hello');
	assert.equal(unquote('hello'), 'hello');
	assert.equal(unquote('"a:b"'), 'a:b');
	assert.equal(unquote('"unbalanced'), '"unbalanced');
});

test('parseSkillDocument reads top-level fields and skips nested lines', () => {
	const text = [
		'---',
		'name: pdf-to-markdown',
		'description: Convert a PDF into Markdown.',
		'metadata:',
		'  owner: buddy',
		'  license: MIT',
		'---',
		'# Body',
	].join('\n');
	const { data, body, warnings } = parseSkillDocument(text);
	assert.equal(data.name, 'pdf-to-markdown');
	assert.equal(data.description, 'Convert a PDF into Markdown.');
	// Nested children under `metadata:` must be skipped entirely.
	assert.equal(data.owner, undefined);
	assert.equal(data.license, undefined);
	assert.ok(body.includes('# Body'));
	assert.deepEqual(warnings, []);
});

test('parseSkillDocument keeps description_zh intact', () => {
	const text = ['---', 'name: x', 'description: English', 'description_zh: 中文描述', '---', 'body'].join('\n');
	assert.equal(parseSkillDocument(text).data.description_zh, '中文描述');
});

test('parseSkillDocument warns on missing frontmatter', () => {
	const { data, warnings } = parseSkillDocument('no frontmatter here');
	assert.deepEqual(warnings, ['missing_frontmatter']);
	assert.deepEqual(data, {});
});

test('parseSkillDocument reads a full multi-line block scalar', () => {
	const text = ['---', 'name: x', 'description: |', '  line one', '  line two', 'version: 1', '---', 'body'].join('\n');
	const { data, warnings } = parseSkillDocument(text);
	assert.equal(data.description, 'line one\nline two');
	assert.equal(data.version, '1');
	assert.deepEqual(warnings, []);
});

test('scanRoot finds every SKILL.md and ignores loose files', () => {
	const res = scanRoot(WB, 'workbuddy');
	assert.equal(res.exists, true);
	assert.deepEqual(
		res.skills.map((s) => s.name).sort(),
		['etf-filter', 'git-finish-work', 'meta-principles', 'pdf-to-markdown', 'unknown-thing'],
	);
	assert.equal(res.count, 5);
	assert.equal(res.warnings.length, 0);
});

test('scanRoot warns on a missing root', () => {
	const res = scanRoot(path.join(WB, 'does-not-exist'), 'x');
	assert.equal(res.exists, false);
	assert.equal(res.warnings[0].reason, 'root_missing');
});
