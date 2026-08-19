// dsh-skill-indexer · score
//
// Pure scoring primitives for the two-level router. The single matching
// primitive is substring membership (`w in q`) — never token-set
// intersection — so a short query like "把这周的ETF拉出来画个图" still hits
// the keyword "etf". Everything is deterministic: no randomness, no set
// iteration into output order.

/**
 * Normalize a query: lowercase, strip punctuation (keep CJK / letters /
 * digits), and collapse whitespace.
 * @param query - the raw intent string.
 * @returns the normalized query.
 */
export function preprocessQuery(query) {
	return String(query)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Position weight: earlier matches weigh more.
 * @param startIndex - the zero-based index of the keyword in the query.
 * @returns `1 / (1 + startIndex / 10)`.
 */
export function posWeight(startIndex) {
	return 1 / (1 + startIndex / 10);
}

/**
 * Inverse document frequency over the keyword vocabulary.
 * @param df - number of skills whose keywords contain the word.
 * @param N - total skill count.
 * @returns `ln((N + 1) / (df + 1)) + 1`.
 */
export function idf(df, N) {
	return Math.log((N + 1) / (df + 1)) + 1;
}

/**
 * Build the document-frequency map over all skills' keywords.
 * @param skills - the index skill records.
 * @returns `Map<word, df>` with lowercased word keys.
 */
export function buildDfMap(skills) {
	const df = new Map();
	for (const skill of skills) {
		const seen = new Set();
		for (const w of skill.keywords ?? []) {
			const wl = String(w).toLowerCase();
			if (seen.has(wl)) continue;
			seen.add(wl);
			df.set(wl, (df.get(wl) ?? 0) + 1);
		}
	}
	return df;
}

/**
 * Estimate the normalization divisor K: distinct English words + continuous
 * CJK segment count in the query (a coarse magnitude estimate, §5.5).
 * @param query - the raw intent string.
 * @returns a positive integer (>= 1).
 */
export function queryUnitCount(query) {
	const pre = preprocessQuery(query);
	const en = new Set(pre.match(/[a-z0-9]+/g) ?? []);
	const cjk = pre.match(/[\u3400-\u9fff]+/g) ?? [];
	return en.size + cjk.length;
}

/**
 * Score one category against a query using its fixed keyword table (L1).
 * Skill keywords/triggers are deliberately NOT merged into the category
 * table — a large category would otherwise soak up every query.
 * @param category - the category record (`{ id, keywords }`).
 * @param query - the raw intent string.
 * @param dfMap - the document-frequency map.
 * @param N - total skill count.
 * @returns the raw (unnormalized) category score.
 */
export function categoryScore(category, query, dfMap, N) {
	const q = preprocessQuery(query);
	let score = 0;
	const seen = new Set();
	for (const w of category.keywords ?? []) {
		if (seen.has(w)) continue;
		const idx = q.indexOf(w);
		if (idx === -1) continue;
		seen.add(w);
		score += idf(dfMap.get(w) ?? 0, N) * posWeight(idx);
	}
	return score;
}

/**
 * Score one skill against a query (L2). The skill's word set is
 * `keywords ∪ triggers ∪ name`; trigger hits weigh x1.5 (they are hand-tagged
 * high-precision signals).
 * @param skill - the skill record.
 * @param query - the raw intent string.
 * @param dfMap - the document-frequency map.
 * @param N - total skill count.
 * @returns the raw skill score.
 */
export function skillScore(skill, query, dfMap, N) {
	const q = preprocessQuery(query);
	let score = 0;
	const seen = new Set();

	const addHit = (word, weight) => {
		const idx = q.indexOf(word);
		if (idx === -1 || seen.has(word)) return;
		seen.add(word);
		score += idf(dfMap.get(word) ?? 0, N) * posWeight(idx) * weight;
	};

	for (const w of skill.keywords ?? []) addHit(String(w).toLowerCase(), 1);
	addHit(String(skill.name).toLowerCase(), 1);
	for (const t of skill.triggers ?? []) addHit(String(t).toLowerCase(), 1.5);

	return score;
}
