// dsh-skill-indexer · router
//
// Two-level intent routing: L1 category scoring (keyword x IDF) chooses a
// category, then L2 skill scoring ranks within it. A three-state fallback
// (hit / low-confidence / miss) downgrades to a flat top-k when the category
// signal is weak or ambiguous, and reports a miss with no fabricated match.

import {
	categoryScore,
	skillScore,
	buildDfMap,
	queryUnitCount,
} from './score.js';

/**
 * Whether the top-3 category scores are ambiguous (at least two within 0.1).
 * @param sorted - category score rows, sorted by normalized score descending.
 * @returns true when the ranking is too close to trust.
 */
function ambiguousTop3(sorted) {
	if (sorted.length < 3) return false;
	const [a, b, c] = sorted.slice(0, 3).map((row) => row.normalized);
	return a - b < 0.1 || b - c < 0.1;
}

/**
 * Rank a skill list by L2 score, then usage_count, then id (deterministic).
 * @param skills - the candidate skill records.
 * @param query - the raw intent string.
 * @param dfMap - the document-frequency map.
 * @param N - total skill count.
 * @param k - how many top ids to return.
 * @returns the top-k skill ids.
 */
function rankSkills(skills, query, dfMap, N, k) {
	const rows = skills.map((skill) => ({
		id: skill.id,
		score: skillScore(skill, query, dfMap, N),
		usage: skill.usage_count ?? 0,
	}));
	rows.sort((a, b) => b.score - a.score || b.usage - a.usage || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return rows.slice(0, k).map((row) => row.id);
}

/**
 * Route one intent against a built index.
 * @param index - the built skills index.
 * @param query - the natural-language intent.
 * @param options - `{ theta1, theta2, topk }` overrides.
 * @returns `{ state, intent, categories, hits }` (text rendered separately).
 */
export function routeIntent(index, query, options = {}) {
	const theta1 = typeof options.theta1 === 'number' ? options.theta1 : 0.35;
	const theta2 = typeof options.theta2 === 'number' ? options.theta2 : 0.12;
	const topk = typeof options.topk === 'number' ? options.topk : 5;
	const skills = index.skills ?? [];
	const N = skills.length;
	const dfMap = buildDfMap(skills);
	const K = Math.max(1, queryUnitCount(query));

	// L1: score each non-general category; keep only categories that actually
	// matched the query (zero-score rows would otherwise tie at 0 and make the
	// top-3 "ambiguous", wrongly downgrading a clear hit to low confidence).
	const catRows = [];
	for (const cat of index.categories ?? []) {
		if (cat.id === 'general') continue;
		const raw = categoryScore(cat, query, dfMap, N);
		const normalized = raw / K;
		if (normalized > 0) catRows.push({ id: cat.id, raw, normalized });
	}
	catRows.sort((a, b) => b.normalized - a.normalized || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

	const maxC = catRows.length ? catRows[0].normalized : 0;

	// Three-state decision (§5.5).
	let state;
	if (maxC < theta2) {
		state = 'miss';
	} else if (maxC >= theta1 && !ambiguousTop3(catRows)) {
		state = 'hit';
	} else {
		state = 'low';
	}

	const result = { state, intent: query, categories: [], hits: [] };

	if (state === 'hit') {
		// Top-2 categories; rank skills within the primary category.
		result.categories = catRows.slice(0, 2).map((row) => row.id);
		const primaryId = result.categories[0];
		const members = skills.filter((s) => (s.categories ?? []).includes(primaryId));
		result.hits = rankSkills(members, query, dfMap, N, topk);
	} else if (state === 'low') {
		// Flat top-k across the whole library as "可能相关候选".
		result.categories = catRows.slice(0, 2).map((row) => row.id);
		result.hits = rankSkills(skills, query, dfMap, N, topk);
	}
	// miss: categories/hits stay empty.

	return result;
}
