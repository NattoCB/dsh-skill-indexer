# dsh-skill-indexer

<!-- Hero -->
<div align="center">
  <b style="font-size: 1.15em;">让 agent 用一句话意图，从本机所有 SKILL.md 里召回对的技能。</b><br /><br />
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
  <a href="https://img.shields.io/badge/node-%3E%3D18-339933"><img alt="Node" src="https://img.shields.io/badge/node-%3E%3D18-339933" /></a><br /><br />
  <img alt="两级召回索引" src="https://img.shields.io/badge/-两级召回索引-4d6bfe" />
  <img alt="意图路由" src="https://img.shields.io/badge/-意图路由-4d6bfe" />
  <img alt="三态回退" src="https://img.shields.io/badge/-三态回退-4d6bfe" />
  <img alt="零第三方依赖" src="https://img.shields.io/badge/-零第三方依赖-4d6bfe" />
  <img alt="只读源目录" src="https://img.shields.io/badge/-只读源目录-4d6bfe" />
  <img alt="哈希增量" src="https://img.shields.io/badge/-哈希增量-4d6bfe" /><br /><br />
  <b>接入面</b> —— <code>skill_index</code> 工具 / <code>/skill-index</code> 命令 / <code>cordis.patch.yml</code>
</div>

> 一个 DSH host bundle 插件：把本机所有 `SKILL.md`（默认 `~/.workbuddy/skills` + `$DSH_HOME/skills`）建成两级（大类 → 技能）召回索引，用一句话意图路由到最匹配的技能，命中/低置信/未命中三态回退。接入面：`skill_index` 模型工具、`/skill-index` 命令、`cordis.patch.yml` 配置——纯本地、只读源目录、零第三方运行时依赖。
>
> A DSH host bundle plugin that builds a two-level (category → skill) recall index over every local `SKILL.md` and routes a natural-language intent to the best-matching skills — three-state (hit / low / miss) fallback, read-only against the source trees, zero third-party runtime deps.

## ✨ 功能一览

- **🗂️ 两级召回索引**：扫描 `~/.workbuddy/skills` 与 `$DSH_HOME/skills`，解析 `SKILL.md` frontmatter（手写 YAML 子集，block scalar 全量解析），抽取触发词/关键词并归纳大类，产出 `skills-index.json`（UTF-8、无 ASCII 转义、2 空格缩进）。
- **🎯 一句话意图路由**：L1 大类打分（关键词覆盖 × IDF，`pos_weight=1/(1+start/10)`）命中大类，L2 类内技能排序（词表 = keywords ∪ triggers ∪ name，trigger 命中 ×1.5）；短查询靠单个词即可命中（「把这周的ETF拉出来画个图」→ `etf`）。
- **🔁 三态回退**：`hit` 命中 / `low` 低置信（回退全库 flat top-k）/ `miss` 未命中（明确告知）；默认 `θ1=0.35`、`θ2=0.12`。
- **⚡ 零第三方运行时依赖**：scan/parse/extract/classify/index/route 只用 `node:fs/path/crypto`，唯一外部包是宿主自带的 `@deepseek-ai/dsh-tools`（`defineTool`）。
- **🔒 只读 + 哈希增量**：不改动技能源目录，索引与 `usage.log` 只写 `dataDir`；`scan` 按内容 hash 对比，未变技能保留 `usage_count`/`last_used`，无变更时提示 "(no changes)"。
- **🧩 人工大类覆盖**：`categories.yaml` 可对指定技能直接指定大类，优先级高于内置词表归纳。

## Quick Start

### 前置

- DSH（DeepSeek Harness）web profile
- Node.js ≥ 18

### 安装

```bash
dsh plugin --profile web add github:NattoCB/dsh-skill-indexer
```

或手工把 `cordis.patch.yml` 的 `insert` 段合并进目标 profile 的 patch，然后 `pnpm install`。

### 运行

安装后 host 启动即自动建索引。手动控制：

```bash
/skill-index scan                        # 重建索引（无变更时提示 "no changes"）
/skill-index query 把这周的ETF拉出来画个图  # 意图召回
/skill-index categories                  # 打印大类表
/skill-index status                      # 索引状态与各 root 计数
```

agent 侧直接调用模型工具：

```text
skill_index(query="把这个PDF转成markdown")
# → { state, intent, categories, hits, text }；text 为可直接注入的上下文
```

开发 / 测试：

```bash
npm test          # node --test，43/43 通过
npm run demo      # 扫描默认 roots 并路由示例意图
```

## Configuration

通过 `cordis.patch.yml` 的 `config` 段配置：

| Key | Default | Meaning |
|:----|:--------|:--------|
| `roots` | `[]`（缺省 `~/.workbuddy/skills` + `$DSH_HOME/skills`） | 扫描根目录；路径数组或 `[{path, type}]` |
| `theta1` | `0.35` | 命中阈值（`max_c ≥ θ1` → hit） |
| `theta2` | `0.12` | 未命中阈值（`max_c < θ2` → miss） |
| `dataDir` | `$DSH_HOME/skill-indexer` | `skills-index.json` 与 `usage.log` 输出目录 |
| `categoriesYaml` | `''` | 可选 `categories.yaml` 人工大类覆盖，优先级最高 |

`categories.yaml` 示例：

```yaml
overrides:
  git-finish-work: ["git-workflow", "delivery"]
  pdf-to-markdown: docs
```

## 设计要点

- **匹配原语**：子串匹配（英文小写化去标点、中文直接子串），不是 token 集合交集；`idf = ln((N+1)/(df+1)) + 1`。
- **确定性**：全流程无随机数，同输入字节级一致（除 `generated_at`）。
- **`id` 规则**：唯一名 → `id = name`；跨 root 重名 → `name@type`（如 `pdf-to-markdown@dsh`）；`categories[].skills` 与 `skills[].id` 引用闭合。
- **源规格**：skill-indexer PRD v1.1（2026-08-19，本地文档未公开）——两级索引、三态回退、哈希增量与验收标准 A1–A5 / B1–B5 / C1–C4。
- **非目标**：无常驻进程、无 HTTP 服务、无 UI、无 embedding/GraphRAG。

## 已知限制

- 中文关键词按「连续中文串」抽取，长串会粘住短词（如「当面对高杠杆」粘住「高杠杆」），短查询召回偏弱。
- 内置大类词表（10 类）是 MVP 覆盖；跨机部署前建议在目标语料上做 `θ1/θ2` 网格标定并增补词表。

---

<div align="center">

[GitHub](https://github.com/NattoCB/dsh-skill-indexer) · [Issues](https://github.com/NattoCB/dsh-skill-indexer/issues) · MIT License

</div>
