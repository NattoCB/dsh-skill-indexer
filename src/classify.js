// dsh-skill-indexer · classify
//
// Induces a skill's L1 categories from a built-in domain keyword table, with
// an optional `categories.yaml` override taking highest priority. English
// keywords are stored lowercased so they match both lowercased skill keywords
// and lowercased queries.

/**
 * Built-in domain keyword table (MVP coverage of the local skill landscape,
 * §5.3). `keywords` are lowercase English or verbatim CJK substrings.
 * Overlaps (e.g. "估值" in finance and ib) are intentional: a skill touching
 * several domains lands in several categories.
 */
export const CATEGORIES = [
	{ id: 'finance', name: '金融数据', desc: 'ETF/股票/基金行情与筛选、资金流向', keywords: ['etf', '股票', '行情', '基金', '资金', 'k线', '涨跌', 'a股', '指数', '估值'] },
	{ id: 'git-workflow', name: 'Git/代码交付', desc: 'commit/merge/分支/打包', keywords: ['commit', 'merge', '分支', 'git', '提交', '打包', 'dev'] },
	{ id: 'docs', name: '文档处理', desc: 'PDF/markdown/docx/排版/转换/报告', keywords: ['pdf', 'markdown', 'docx', '排版', '转换', '报告'] },
	{ id: 'security', name: '代码安全', desc: '安全审查/后门/CVE/供应链/审计', keywords: ['安全审查', '后门', 'cve', '供应链', '审计'] },
	{ id: 'ib', name: '投行建模', desc: 'CIM/LBO/DCF/comps/估值/并购/交易', keywords: ['cim', 'lbo', 'dcf', 'comps', '估值', '并购', '交易'] },
	{ id: 'decision', name: '决策框架', desc: '决策/原则/仲裁/权衡/优先级', keywords: ['决策', '原则', '仲裁', '权衡', '优先级'] },
	{ id: 'knowledge-map', name: '知识地图', desc: '全景/课程/SVG/知识', keywords: ['全景', '课程', 'svg', '知识'] },
	{ id: 'tutoring', name: '学习辅导', desc: '学习/讲解/笔记/辅导', keywords: ['学习', '讲解', '笔记', '辅导'] },
	{ id: 'data-query', name: '数据查询', desc: '行情/资讯/新闻/搜索/公告', keywords: ['行情', '资讯', '新闻', '搜索', '公告'] },
	{ id: 'general', name: '通用', desc: '未归类的通用技能', keywords: [] },
];

/**
 * Classify one skill by counting how many keywords of each domain appear in
 * its description+keywords text. The highest-count domain is primary; other
 * domains with >= 2 hits join as secondary categories. Zero hits across all
 * domains classifies as `general`.
 * @param description - the skill description.
 * @param keywords - the skill's extracted keywords.
 * @returns an ordered category id array (primary first).
 */
export function classifySkill(description, keywords) {
	const haystack = `${String(description).toLowerCase()} ${keywords.join(' ').toLowerCase()}`;

	const counts = new Map();
	for (const cat of CATEGORIES) {
		if (cat.id === 'general') continue;
		let n = 0;
		for (const kw of cat.keywords) {
			if (haystack.includes(kw)) n += 1;
		}
		if (n > 0) counts.set(cat.id, n);
	}

	let primary = 'general';
	let best = 0;
	for (const [id, n] of counts) {
		if (n > best) {
			best = n;
			primary = id;
		}
	}

	if (primary === 'general') return ['general'];
	const categories = [primary];
	for (const [id, n] of counts) {
		if (id !== primary && n >= 2) categories.push(id);
	}
	return categories;
}

/**
 * Apply an explicit `categories.yaml` override map (`skill_id -> [category ids]`).
 * Overrides replace the auto-induced categories entirely for the named skill.
 * @param categoriesBySkill - mutable map of skill id -> category id array.
 * @param overrides - `{ [skillId]: string[] }` from `categories.yaml`.
 * @returns the same map, mutated in place.
 */
export function applyOverrides(categoriesBySkill, overrides) {
	for (const [skillId, cats] of Object.entries(overrides ?? {})) {
		if (!categoriesBySkill.has(skillId)) continue;
		const list = (Array.isArray(cats) ? cats : [cats]).filter((c) => typeof c === 'string' && c);
		if (list.length) categoriesBySkill.set(skillId, list);
	}
	return categoriesBySkill;
}
