// dsh-skill-indexer · scanner
//
// Scans local skill directories and parses SKILL.md frontmatter with a
// hand-rolled YAML-subset parser. No third-party dependency is used: the PRD
// contract is "Python stdlib only", and its TypeScript rewrite keeps the same
// zero-dependency discipline (only node:fs / node:path / node:crypto).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** CJK ideograph range used to decide the one-liner truncation limit. */
const CJK_RE = /[\u3400-\u9fff]/;

/**
 * Unwrap the outermost matching pair of quotes from a frontmatter value.
 * Inner colons, quotes, and URLs are preserved verbatim, per the PRD parsing
 * boundary (§5.1). A value whose quotes do not pair up is returned unchanged.
 * @param value - the raw right-hand side of a `key: value` line.
 * @returns the unquoted value.
 */
export function unquote(value) {
	const s = String(value).trim();
	if (s.length < 2) return s;
	const first = s[0];
	const last = s[s.length - 1];
	if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
		return s.slice(1, -1);
	}
	return s;
}

/**
 * Build the one-line summary for a description.
 * Chinese descriptions truncate at 60 chars; otherwise at 160 (§5.1.4).
 * @param description - the resolved description text.
 * @returns the one-liner (untruncated when already short).
 */
export function oneLiner(description) {
	const text = String(description).trim();
	const limit = CJK_RE.test(text) ? 60 : 160;
	return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/**
 * Extract a fallback description from the first non-heading body line.
 * Used only when a skill lacks a description field entirely.
 * @param body - the SKILL.md body after frontmatter.
 * @returns a short fallback description.
 */
export function firstParagraph(body) {
	const line = String(body)
		.split(/\r?\n/)
		.map((l) => l.trim())
		.find((l) => l && !l.startsWith('#') && !l.startsWith('```'));
	return (line || '').replace(/^#+\s*/, '').slice(0, 160);
}

/**
 * Parse one SKILL.md document into frontmatter fields and body.
 *
 * Rules (§5.1.2): the first line must be `---`; the closing `---` terminates
 * frontmatter. Only top-level `key: value` lines are read — indented lines
 * (nested fields such as `metadata:` / `license:`) are skipped. Block scalars
 * (`|` / `>`) take the first following non-empty indented line and record a
 * `block_scalar_truncated` warning. Missing/unterminated frontmatter degrades
 * to a whole-document body with a warning instead of throwing.
 *
 * @param text - the complete file text.
 * @returns `{ data, body, warnings }`.
 */
export function parseSkillDocument(text) {
	const warnings = [];
	const data = {};
	const lines = String(text).split(/\r?\n/);

	if (lines[0] === undefined || lines[0].trim() !== '---') {
		warnings.push('missing_frontmatter');
		return { data, body: String(text), warnings };
	}

	let end = -1;
	for (let i = 1; i < lines.length; i += 1) {
		if (lines[i].trim() === '---') {
			end = i;
			break;
		}
	}
	if (end === -1) {
		warnings.push('unterminated_frontmatter');
		return { data, body: String(text), warnings };
	}

	const fmLines = lines.slice(1, end);
	for (let i = 0; i < fmLines.length; i += 1) {
		const raw = fmLines[i];
		if (raw.trim() === '') continue;
		if (/^[\t ]/.test(raw)) continue; // indented => nested field, skip
		const colon = raw.indexOf(':');
		if (colon === -1) continue;
		const key = raw.slice(0, colon).trim();
		let value = raw.slice(colon + 1).trim();
		if (/^[|>][+-]?$/.test(value)) {
			// Block scalar (`|` literal / `>` folded, optional `+`/`-` chomping):
			// collect every contiguous indented line as the value. This is the
			// dominant frontmatter shape in the local skill trees (multi-line
			// descriptions), so the full body is preserved rather than truncated.
			const folded = value[0] === '>';
			const parts = [];
			for (let j = i + 1; j < fmLines.length; j += 1) {
				const next = fmLines[j];
				if (next.trim() === '') continue;
				if (!/^[\t ]/.test(next)) break;
				parts.push(next.trim());
			}
			value = parts.join(folded ? ' ' : '\n');
		}
		if (key === '') continue;
		data[key] = unquote(value);
	}

	return { data, body: lines.slice(end + 1).join('\n'), warnings };
}

/**
 * SHA-256 of a full SKILL.md document, used for incremental rebuilds.
 * @param text - the file text.
 * @returns the lowercase hex digest.
 */
export function sha256(text) {
	return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Scan one skill root directory for direct-child `SKILL.md` files.
 *
 * Non-directory entries (e.g. `_bm_skillid_migration.json`) are ignored.
 * Child directories without a `SKILL.md` (case-sensitive) record a warning.
 *
 * @param rootPath - absolute path to the skill root.
 * @param type - the root's source type label (`workbuddy` | `dsh` | custom).
 * @returns `{ skills, warnings, count, exists }`.
 */
export function scanRoot(rootPath, type) {
	const warnings = [];
	const skills = [];

	let stat;
	try {
		stat = fs.statSync(rootPath);
	} catch {
		warnings.push({ path: rootPath, reason: 'root_missing' });
		return { skills, warnings, count: 0, exists: false };
	}
	if (!stat.isDirectory()) {
		warnings.push({ path: rootPath, reason: 'root_not_directory' });
		return { skills, warnings, count: 0, exists: false };
	}

	for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const skillDir = path.join(rootPath, entry.name);
		const skillMd = path.join(skillDir, 'SKILL.md');
		let text;
		try {
			text = fs.readFileSync(skillMd, 'utf8');
		} catch {
			warnings.push({ path: skillDir, reason: 'missing_skill_md' });
			continue;
		}

		const { data, body, warnings: fmWarnings } = parseSkillDocument(text);
		for (const reason of fmWarnings) warnings.push({ path: skillMd, reason });

		const name = data.name ?? '';
		const description = data.description_zh || data.description || data.description_en || '';
		if (!name) warnings.push({ path: skillMd, reason: 'missing_name' });
		if (!description) warnings.push({ path: skillMd, reason: 'missing_description' });

		skills.push({
			name: name || entry.name,
			description: description || firstParagraph(body),
			one_liner: oneLiner(description || firstParagraph(body)),
			version: data.version ?? '',
			agent_created: data.agent_created === true || data.agent_created === 'true',
			path: skillMd,
			root: rootPath,
			root_type: type,
			hash: sha256(text),
		});
	}

	return { skills, warnings, count: skills.length, exists: true };
}
