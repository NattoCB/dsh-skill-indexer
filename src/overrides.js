// dsh-skill-indexer · overrides
//
// Minimal `categories.yaml` loader. The file is a hand-written override map
// and must not pull in a YAML dependency, so only the exact shape documented
// in the PRD (§5.3) is parsed.

import fs from 'node:fs';

/**
 * Parse a `categories.yaml` file into `{ [skillId]: string[] }`.
 *
 * Supported shape:
 * ```yaml
 * # categories.yaml
 * overrides:
 *   git-finish-work: ["git-workflow", "delivery"]
 *   pdf-to-markdown: docs
 * ```
 * The `overrides:` key may be omitted. Each indented `skill_id: value` line
 * accepts an inline `[a, b]` list or a single bare id.
 * @param filePath - absolute path to the YAML file.
 * @returns the override map (empty when the file is missing or malformed).
 */
export function loadOverrides(filePath) {
	let text;
	try {
		text = fs.readFileSync(filePath, 'utf8');
	} catch {
		return {};
	}
	return parseOverridesYaml(text);
}

/**
 * Parse override YAML text (exported for testing).
 * @param text - the raw YAML text.
 * @returns the override map.
 */
export function parseOverridesYaml(text) {
	const out = {};
	const lines = String(text).split(/\r?\n/);
	let inOverrides = false;
	for (const raw of lines) {
		const trimmed = raw.trimEnd().trim();
		if (trimmed === '' || trimmed.startsWith('#')) continue;
		if (!inOverrides) {
			if (/^overrides\s*:/.test(trimmed)) inOverrides = true;
			continue;
		}
		// A top-level (non-indented) key ends the overrides block.
		if (/^\S/.test(raw)) break;
		const colon = trimmed.indexOf(':');
		if (colon === -1) continue;
		const key = trimmed.slice(0, colon).trim();
		let value = trimmed.slice(colon + 1).trim();
		if (/^\[.*\]$/.test(value)) value = value.slice(1, -1);
		const cats = value
			.split(',')
			.map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
			.filter(Boolean);
		out[key] = cats;
	}
	return out;
}
