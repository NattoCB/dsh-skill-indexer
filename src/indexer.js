// dsh-skill-indexer · indexer
//
// Builds the skills-index.json data model and applies hash-based incremental
// rebuilds (preserving usage stats for unchanged skills). JSON is written as
// raw UTF-8 (no ASCII escaping) with 2-space indentation, matching the PRD.

import fs from 'node:fs';
import path from 'node:path';
import { scanRoot } from './scanner.js';
import { extractTriggers, extractKeywords } from './extract.js';
import { CATEGORIES, classifySkill, applyOverrides } from './classify.js';

/**
 * Read a previously written index, or null when absent/corrupt.
 * @param outPath - absolute path to `skills-index.json`.
 * @returns the parsed index or null.
 */
export function loadIndex(outPath) {
	try {
		return JSON.parse(fs.readFileSync(outPath, 'utf8'));
	} catch {
		return null;
	}
}

/**
 * Write an index to disk as raw UTF-8 JSON with 2-space indentation.
 * @param outPath - absolute path to `skills-index.json`.
 * @param index - the index object.
 */
export function saveIndex(outPath, index) {
	fs.mkdirSync(path.dirname(outPath), { recursive: true });
	fs.writeFileSync(outPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

/**
 * Build the full two-level index from a list of roots.
 * @param roots - `[{ path, type }]`.
 * @param options - `{ oldIndex, overrides }`.
 * @returns the index object.
 */
export function buildIndex(roots, options = {}) {
	const { oldIndex, overrides } = options;
	const warnings = [];
	const rootInfos = [];
	const skills = [];

	for (const { path: rootPath, type } of roots) {
		const res = scanRoot(rootPath, type);
		rootInfos.push({ path: rootPath, type, count: res.count });
		for (const s of res.skills) skills.push(s);
		for (const w of res.warnings) warnings.push(w);
	}

	// Assign ids: unique name -> id = name; cross-root duplicate -> name@type;
	// defensive numeric suffix guards a same-type duplicate.
	const nameCount = new Map();
	for (const s of skills) nameCount.set(s.name, (nameCount.get(s.name) ?? 0) + 1);
	const idSeen = new Map();
	for (const s of skills) {
		let id = s.name;
		if ((nameCount.get(s.name) ?? 0) > 1) id = `${s.name}@${s.root_type}`;
		const n = idSeen.get(id) ?? 0;
		if (n > 0) id = `${id}#${n + 1}`;
		idSeen.set(id, (idSeen.get(id) ?? 0) + 1);
		s.id = id;
	}

	// Enrich: triggers, keywords, categories.
	const categoriesBySkill = new Map();
	for (const s of skills) {
		s.triggers = extractTriggers(s.description);
		s.keywords = extractKeywords(s.description);
		s.categories = classifySkill(s.description, s.keywords);
		s.deps = [];
		categoriesBySkill.set(s.id, s.categories);
	}
	applyOverrides(categoriesBySkill, overrides);
	for (const s of skills) s.categories = categoriesBySkill.get(s.id);

	// Category records with member skill ids.
	const categories = CATEGORIES.map((cat) => ({
		id: cat.id,
		name: cat.name,
		desc: cat.desc,
		keywords: cat.keywords,
		skills: skills.filter((s) => s.categories.includes(cat.id)).map((s) => s.id),
	}));

	// Hash incremental: carry usage stats forward for unchanged skills.
	const oldById = new Map();
	for (const os of oldIndex?.skills ?? []) oldById.set(os.id, os);
	for (const s of skills) {
		const old = oldById.get(s.id);
		if (old && old.hash === s.hash) {
			s.usage_count = old.usage_count ?? 0;
			s.last_used = old.last_used ?? null;
		} else {
			s.usage_count = 0;
			s.last_used = null;
		}
	}

	// Strip internal-only fields and sort for byte-stable output. Skills sort by
	// id; warnings by path then reason — neither depends on filesystem order.
	const cleanSkills = skills
		.map(({ root_type, ...rest }) => rest)
		.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const cleanWarnings = warnings
		.slice()
		.sort((a, b) => {
			if (a.path !== b.path) return a.path < b.path ? -1 : 1;
			if (a.reason !== b.reason) return a.reason < b.reason ? -1 : 1;
			return 0;
		});

	return {
		version: 1,
		generated_at: new Date().toISOString(),
		roots: rootInfos,
		categories,
		skills: cleanSkills,
		warnings: cleanWarnings,
	};
}
