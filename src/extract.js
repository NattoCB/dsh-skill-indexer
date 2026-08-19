// dsh-skill-indexer · extract
//
// Extracts triggers (quoted phrases inside the description) and keywords
// (lowercased English words + continuous CJK fragments) from a skill
// description. Keywords feed the substring-matching scorer; they are never
// used for token-set intersection.

/** Quoted spans across ASCII and CJK quote pairs. */
const QUOTE_RE = /"([^"\n]{1,80})"|“([^”\n]{1,80})”|'([^'\n]{1,80})'|‘([^’\n]{1,80})’/g;
/** Continuous CJK runs, broken by punctuation / latin / digits. */
const CJK_RUN_RE = /[\u3400-\u9fff]+/g;
/** Alphanumeric runs (lowercased input expected). */
const EN_RE = /[a-z0-9]+/g;

/**
 * Extract trigger phrases from a description.
 * Any quoted span counts, in any of the four quote styles; results are
 * deduplicated and capped at the first 8 in appearance order. A description
 * with no quoted spans yields `[]` without a warning (long English workflows
 * like git-finish-work legitimately have none).
 * @param description - the skill description.
 * @returns up to 8 unique trigger phrases.
 */
export function extractTriggers(description) {
	const out = [];
	const seen = new Set();
	QUOTE_RE.lastIndex = 0;
	let m;
	while ((m = QUOTE_RE.exec(description)) !== null) {
		const t = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim();
		if (!t || seen.has(t)) continue;
		seen.add(t);
		out.push(t);
		if (out.length >= 8) break;
	}
	return out;
}

/**
 * Extract candidate keywords from a description.
 * English tokens are lowercased, length >= 3, and must contain at least one
 * letter (pure-digit runs are dropped). Chinese fragments are continuous CJK
 * runs; runs longer than 8 chars are split into deterministic 8-char chunks,
 * and the top 12 fragments by length are kept. The two sets merge and
 * deduplicate into one lexically-sorted list (stable for byte-identical JSON).
 * @param description - the skill description.
 * @returns a deterministic keyword array.
 */
export function extractKeywords(description) {
	const lower = String(description).toLowerCase();

	const en = new Set();
	EN_RE.lastIndex = 0;
	let m;
	while ((m = EN_RE.exec(lower)) !== null) {
		const w = m[0];
		if (w.length >= 3 && /[a-z]/.test(w)) en.add(w);
	}

	const runs = [];
	CJK_RUN_RE.lastIndex = 0;
	while ((m = CJK_RUN_RE.exec(description)) !== null) runs.push(m[0]);

	const cjk = [];
	const seenCjk = new Set();
	for (const run of runs) {
		for (let i = 0; i < run.length; i += 8) {
			const chunk = run.slice(i, i + 8);
			if (chunk.length >= 2 && !seenCjk.has(chunk)) {
				seenCjk.add(chunk);
				cjk.push(chunk);
			}
		}
	}
	// Longer CJK fragments are more discriminative, so prefer them.
	cjk.sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
	const topCjk = cjk.slice(0, 12);

	const merged = new Set([...en, ...topCjk]);
	return [...merged].sort();
}
