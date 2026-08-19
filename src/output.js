// dsh-skill-indexer · output
//
// Renders the routing result into the stable "注入文本" an agent actually
// consumes (§5.5). Format is fixed so downstream agents can parse it.

/**
 * Render the category table ("可用大类").
 * @param index - the built index.
 * @returns the table text.
 */
export function renderCategoryTable(index) {
	const cats = (index.categories ?? []).filter((c) => c.skills.length > 0);
	const lines = [`可用大类（共 ${cats.length} 类）：`];
	for (const c of cats) {
		lines.push(`- ${c.id} ${c.name}（${c.skills.length} 个技能）：${c.desc}`);
	}
	return lines.join('\n');
}

/**
 * Resolve a skill id to its record.
 * @param index - the built index.
 * @param id - the skill id.
 * @returns the skill record or undefined.
 */
function skillById(index, id) {
	return (index.skills ?? []).find((s) => s.id === id);
}

/**
 * Render the full injection text for a routing result.
 * @param index - the built index.
 * @param result - the `routeIntent` result.
 * @returns the injection text.
 */
export function renderInjectionText(index, result) {
	const lines = ['【技能路由】', renderCategoryTable(index), ''];

	if (result.state === 'miss') {
		lines.push('未命中任何技能大类。如需使用技能，请用 /skill 呼出或明确提及技能能力。');
		return lines.join('\n');
	}

	if (result.state === 'hit') {
		const primary = (index.categories ?? []).find((c) => c.id === result.categories[0]);
		const second = (index.categories ?? []).find((c) => c.id === result.categories[1]);
		lines.push('当前意图命中大类：');
		if (primary) lines.push(`- ${primary.id} ${primary.name}（主）`);
		if (second) lines.push(`- ${second.id} ${second.name}（次）`);
		lines.push('');
		if (primary) {
			lines.push('该类可用技能：');
			for (const sid of result.hits) {
				const s = skillById(index, sid);
				if (!s) continue;
				const trig = (s.triggers ?? []).slice(0, 3).join('、');
				lines.push(`- ${s.id}：${s.one_liner}${trig ? `（触发：${trig}）` : ''}`);
			}
		}
	} else {
		lines.push('当前意图未明确命中单一类别，以下是全库可能相关候选：');
		for (const sid of result.hits) {
			const s = skillById(index, sid);
			if (s) lines.push(`- ${s.id}：${s.one_liner}`);
		}
	}

	return lines.join('\n');
}
