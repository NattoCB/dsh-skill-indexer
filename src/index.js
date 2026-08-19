// dsh-skill-indexer
//
// A DSH host cordis plugin that builds a two-level (category + skill) recall
// index over the local SKILL.md trees and routes a natural-language intent to
// the best-matching skills. The surface is:
//
//   - `skill_index` model-facing tool: query -> routing block (three-state).
//   - `/skill-index` slash command: scan | query | categories | status.
//
// The plugin is READ-ONLY against the skill source directories: every artifact
// (skills-index.json, usage.log) is written to `dataDir` (default
// $DSH_HOME/skill-indexer). It imports nothing beyond node builtins and the
// `defineTool` helper from @deepseek-ai/dsh-tools.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { buildIndex, loadIndex, saveIndex } from './indexer.js';
import { routeIntent } from './router.js';
import { renderCategoryTable, renderInjectionText } from './output.js';
import { loadOverrides } from './overrides.js';

/** Cordis plugin name (also the loader row id). */
export const name = 'skill-indexer';

/**
 * Infer a root source type from its path.
 * @param p - a skill root directory path.
 * @returns `workbuddy`, `dsh`, or the directory basename.
 */
function deriveType(p) {
	if (p.includes('.workbuddy')) return 'workbuddy';
	if (p.includes('.dsh')) return 'dsh';
	return path.basename(p);
}

/**
 * The default skill roots: ~/.workbuddy/skills and $DSH_HOME/skills.
 * @returns `[{ path, type }]`.
 */
function defaultRoots() {
	const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
	return [
		{ path: path.join(os.homedir(), '.workbuddy', 'skills'), type: 'workbuddy' },
		{ path: path.join(dshHome, 'skills'), type: 'dsh' },
	];
}

/**
 * Normalize the `config.roots` value into `[{ path, type }]`.
 * @param config - the plugin config object.
 * @returns the normalized roots.
 */
function normalizeRoots(config) {
	const raw = config.roots ?? [];
	if (!Array.isArray(raw) || raw.length === 0) return defaultRoots();
	return raw.map((r) => {
		if (typeof r === 'string') return { path: r, type: deriveType(r) };
		return { path: r.path, type: r.type || deriveType(r.path) };
	});
}

/**
 * A stable fingerprint of an index's skill set (id + content hash), used to
 * detect "no changes" between two scans.
 * @param index - an index object (may be null).
 * @returns the fingerprint string.
 */
function fingerprint(index) {
	if (!index?.skills?.length) return '';
	return index.skills.map((s) => `${s.id}:${s.hash}`).sort().join(',');
}

/**
 * Install the skill-indexer service on one cordis context.
 * @param ctx - the cordis context this plugin is applied to.
 * @param config - the plugin config from cordis.patch.yml.
 */
export const apply = (ctx, config) => {
	const service = new SkillIndexerService(ctx, config || {});
	ctx.inject(['tools'], (sctx) => service.registerTool(sctx));
	ctx.inject(['commands'], (sctx) => service.registerCommand(sctx));
};

class SkillIndexerService {
	constructor(ctx, config) {
		this.ctx = ctx;
		this.config = config;
		this.roots = normalizeRoots(config);
		this.theta1 = typeof config.theta1 === 'number' ? config.theta1 : 0.35;
		this.theta2 = typeof config.theta2 === 'number' ? config.theta2 : 0.12;
		this.index = null;
		this.lastChanged = true;

		const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
		const dataDir = config.dataDir || path.join(dshHome, 'skill-indexer');
		this.outPath = path.join(dataDir, 'skills-index.json');
		this.usageLogPath = path.join(dataDir, 'usage.log');
		this.categoriesYaml = config.categoriesYaml || '';

		// Kick off the initial scan; failures are logged, never thrown, so a
		// missing skill root cannot block the plugin from mounting.
		void this._init();
	}

	/** Build (or rebuild) the index and persist it. */
	async scan() {
		const oldIndex = loadIndex(this.outPath);
		const overrides = this.categoriesYaml ? loadOverrides(this.categoriesYaml) : {};
		this.index = buildIndex(this.roots, { oldIndex, overrides });
		this.lastChanged = fingerprint(oldIndex) !== fingerprint(this.index);
		saveIndex(this.outPath, this.index);
		return this.index;
	}

	async _init() {
		try {
			await this.scan();
			this.ctx.logger?.info?.(
				`[skill-indexer] indexed ${this.index.skills.length} skills ` +
				`(${this.index.categories.length} categories, ${this.index.warnings.length} warnings)`,
			);
		} catch (err) {
			this.ctx.logger?.warn?.(`[skill-indexer] initial scan failed: ${err.message}`);
		}
	}

	/** Route a query and attach the rendered injection text. */
	route(query) {
		if (!this.index) throw new Error('skill-indexer index not built; run /skill-index scan');
		const result = routeIntent(this.index, query, { theta1: this.theta1, theta2: this.theta2 });
		this._logUsage(result);
		result.text = renderInjectionText(this.index, result);
		return result;
	}

	_logUsage(result) {
		try {
			fs.appendFileSync(
				this.usageLogPath,
				`${JSON.stringify({ ts: new Date().toISOString(), query: result.intent, hits: result.hits, outcome: result.state })}\n`,
				'utf8',
			);
		} catch {
			// usage.log is best-effort; a failed write must not break routing.
		}
	}

	/** Register the `skill_index` model-facing tool. */
	registerTool(sctx) {
		const service = this;
		try {
			const tools = sctx.tools;
			if (!tools?.register) return;
			tools.register(defineTool({
				name: 'skill_index',
				description: 'Route a natural-language intent to the best-matching local skills using two-level recall (category first, then skills within it). Use it when you know WHAT the user wants to do but are unsure WHICH skill to load; the result lists candidate skills you can then load with the skill tool.',
				parameters: {
					query: {
						type: 'string',
						required: true,
						description: 'The natural-language intent to route, e.g. "把这周的ETF拉出来画个图" or "帮我提交今天的代码改动".',
					},
				},
				output: {
					schema: {
						type: 'object',
						additionalProperties: false,
						properties: {
							state: { type: 'string', required: true },
							intent: { type: 'string', required: true },
							categories: { type: 'array', items: { type: 'string' }, required: true },
							hits: { type: 'array', items: { type: 'string' }, required: true },
							text: { type: 'string', required: true },
						},
					},
					render: (args, value) => [{ type: 'text', text: value.text }],
				},
				async execute(args) {
					return service.route(args.query);
				},
			}));
		} catch (err) {
			this.ctx.logger?.warn?.(`[skill-indexer] tool registration failed: ${err.message}`);
		}
	}

	/** Register the `/skill-index` slash command. */
	registerCommand(sctx) {
		try {
			sctx.commands?.register({
				name: 'skill-index',
				description: 'Rebuild or inspect the skill recall index: scan | query <intent> | categories | status',
				input: { hint: '[scan|query <intent>|categories|status]' },
				handler: (inv) => this.handleCommand(inv),
			});
		} catch (err) {
			this.ctx.logger?.warn?.(`[skill-indexer] command registration failed: ${err.message}`);
		}
	}

	async handleCommand(inv) {
		const arg = (inv.input?.trim?.() || '').trim();
		const [cmd, ...rest] = arg.split(/\s+/);

		switch (cmd) {
			case 'scan': {
				try {
					await this.scan();
					const change = this.lastChanged ? '' : ' (no changes)';
					return {
						kind: 'success',
						text: `indexed ${this.index.skills.length} skills, ${this.index.categories.length} categories, ${this.index.warnings.length} warnings${change}`,
					};
				} catch (e) {
					return { kind: 'error', text: `scan failed: ${e.message}` };
				}
			}
			case 'query': {
				const q = rest.join(' ');
				if (!q) return { kind: 'error', text: 'usage: /skill-index query <intent>' };
				try {
					return { kind: 'success', text: this.route(q).text };
				} catch (e) {
					return { kind: 'error', text: `query failed: ${e.message}` };
				}
			}
			case 'categories': {
				if (!this.index) return { kind: 'error', text: 'no index; run /skill-index scan' };
				return { kind: 'success', text: renderCategoryTable(this.index) };
			}
			case 'status':
				return {
					kind: 'success',
					text: this.index
						? `indexed=${this.index.skills.length} skills, roots=${this.index.roots.map((r) => `${r.type}:${r.count}`).join(', ')}`
						: 'not indexed',
				};
			default:
				return { kind: 'success', text: 'usage: /skill-index [scan|query <intent>|categories|status]' };
		}
	}
}
