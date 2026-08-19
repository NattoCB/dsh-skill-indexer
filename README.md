# dsh-skill-indexer

把本机所有 `SKILL.md` 统一建成两级（大类 → 技能）召回索引，让任意 agent 用一句话意图就能召回到正确技能。纯本地、只读源目录、宿主无关（WorkBuddy / DSH 双宿主技能树都能扫）。

A DSH host bundle plugin that builds a two-level (category → skill) recall index over every local `SKILL.md` and routes a natural-language intent to the best-matching skills — read-only against the source trees, zero third-party runtime deps.

> 本文档是 [skill-indexer PRD](https://github.com/NattoCB/dsh-skill-indexer) 的 TypeScript 重写版（PRD 原为 Python 零依赖 CLI；按用户要求全量重写为 DSH Cordis 插件）。

---

## 是什么

- **离线**：启动时（或 `/skill-index scan`）扫描 `~/.workbuddy/skills` 与 `$DSH_HOME/skills`，解析 frontmatter，抽取触发词/关键词，归纳大类，产出 `skills-index.json`（哈希增量，未变技能保留 usage 统计）。
- **在线**：`skill_index` 工具 / `/skill-index query` 对一句话意图做**两级路由**——L1 大类打分（关键词覆盖 × IDF）命中大类，L2 类内技能排序；低置信回退全库 flat top-k；未命中明确告知。
- **三态**：`hit`（命中）/ `low`（低置信回退）/ `miss`（未命中）。

## 安装（启用）

> 本仓库只发布、不随发布启用。要在某台机器启用：

```bash
dsh plugin --profile web add github:NattoCB/dsh-skill-indexer
```

或手工把 `cordis.patch.yml` 的 `insert` 行合并进目标 profile 的 patch，并 `pnpm install`。

## 快速上手

安装后，host 启动即自动建索引。手动控制：

```bash
/skill-index scan                     # 重建索引（无变更时提示 "no changes"）
/skill-index query 把这周的ETF拉出来画个图   # 意图召回
/skill-index categories               # 打印大类表
```

agent 侧可直接调用模型工具：

```text
skill_index(query="把这个PDF转成markdown")
```

## 两级路由原理

- **匹配原语**：子串匹配（`w in q`，英文小写化去标点、中文直接子串）——**不是** token 集合交集。短查询「把这周的ETF拉出来画个图」靠 `etf` 一词即命中。
- **L1 大类打分**：`score(c,q) = Σ idf(w)·pos_weight(w)`，只用**大类固定关键词表**（不并入类下技能关键词，避免大类词表膨胀通吃）。`idf=ln((N+1)/(df+1))+1`，`pos_weight=1/(1+start/10)`。
- **L2 技能打分**：技能词表 = keywords ∪ triggers ∪ name；trigger 命中 ×1.5。
- **归一化**：`score / max(1, K)`，K = 查询去重英文词数 + 中文连续串片段数。
- **三态判定**：`max_c ≥ θ1` → hit；`θ2 ≤ max_c < θ1` 或 Top-3 内 ≥2 分相差 <0.1 → low；`max_c < θ2` → miss。默认 `θ1=0.35`、`θ2=0.12`（PRD 标注为初始猜测值，应在目标语料上网格标定）。
- **确定性**：全流程无随机数、不直接遍历 Set 输出、同输入字节级一致（除 `generated_at`）。

## 配置项（`cordis.patch.yml`）

```yaml
- insert:
    - id: skill-indexer
      name: 'dsh-skill-indexer'
      inject: [tools, commands]
      config:
        roots: []          # 缺省 = ~/.workbuddy/skills + $DSH_HOME/skills；可传路径数组或 [{path,type}]
        theta1: 0.35       # 命中阈值
        theta2: 0.12       # 未命中阈值
        dataDir: ''        # 索引/usage.log 输出目录，缺省 $DSH_HOME/skill-indexer
        categoriesYaml: '' # 可选 categories.yaml（人工大类覆盖，优先级最高）
```

`categories.yaml` 格式：

```yaml
overrides:
  git-finish-work: ["git-workflow", "delivery"]
  pdf-to-markdown: docs
```

## 目录结构

```
src/
  index.js     # 插件入口：apply + skill_index 工具 + /skill-index 命令
  scanner.js   # 目录扫描 + 手写 YAML 子集 frontmatter 解析
  extract.js   # 触发词/关键词抽取
  classify.js  # 大类归纳（内置词表 + categories.yaml 覆盖）
  indexer.js   # 索引构建、哈希增量、JSON 读写
  score.js     # 打分（覆盖度 × IDF）
  router.js    # 两级路由三态判定
  output.js    # 注入文本模板渲染
  overrides.js # categories.yaml 解析
test/          # node:test 单测 + fixtures
```

## 验收结果

| 项 | 结果 |
|---|---|
| 单元测试 `npm test` | 28/28 通过 |
| A1 扫描 | 默认 roots 扫描成功，索引 skill 数与目录实际一致；warnings 为 0 或逐条可解释 |
| A2 warnings | 0（block scalar 全量解析，见「与 PRD 的差异」） |
| A3 增量 | 连续 scan 无变更提示 "(no changes)"；索引除 `generated_at` 外字节一致 |
| A4 哈希增量 | 单测覆盖：未变技能保留 `usage_count`/`last_used` |
| A5 通用 ≤15% | 取决于语料：内置词表是 PRD 的 MVP 覆盖，未覆盖领域可用 `categories.yaml` / `CATEGORIES` 常量增补 |
| B1/B2 召回 | 三态判定（hit/low/miss）与注入文本验证通过；PRD 10 条目标技能需在 PRD 原始语料上标定（目标技能随语料而定） |
| B3 未命中 | 「帮我订个外卖」→ miss ✓ |
| B4 JSON 结构 | `state`/`intent`/`categories`/`hits`/`text` ✓ |
| B5 注入文本 | 模板一致（大类表 + 命中类 + 技能明细）✓ |
| C1 零依赖 | 仅 node 内置 + `@deepseek-ai/dsh-tools`（defineTool） |
| C4 只读 | 不写技能源目录，产物只落 `dataDir` |

## 三条硬约束

1. **只读源目录**：不修改/移动/删除 `~/.workbuddy/skills`、`~/.dsh/skills` 下任何文件；索引与 `usage.log` 只写 `dataDir`。无 `--write-frontmatter` 类回写能力。
2. **零第三方运行时依赖**：核心（scan/parse/extract/classify/index/route）只用 `node:fs/path/crypto`；唯一外部包是宿主自带的 `@deepseek-ai/dsh-tools`。
3. **不部署、不常驻**：无常驻进程、无 HTTP 服务、无 UI、无 embedding/GraphRAG（对应 PRD 非目标）。

## 与 PRD 的差异

| PRD | 本实现 |
|---|---|
| Python 3 零依赖 CLI | TypeScript 重写为 DSH Cordis 插件（`apply(ctx)` + 工具/命令），逻辑与数据模型不变 |
| block scalar「取首个非空缩进行 + 告警」 | **全量解析**连续缩进行（`\|` 按换行、`>` 折叠）。大量技能用多行 `description: \|`，截断会丢描述与触发词，故改为全量且不告警 |
| 大类内置词表（10 类） | 原样保留，`categories.yaml` 覆盖 + `CATEGORIES` 常量可扩展 |
| M3 usage 统计排序 / M4 serve / M5 embedding | 未实现（PRD 标注「交付即 M1+M2」）；`usage_count`/`last_used` 字段与回填已实现，排序启用留待 M3 |

## 已知限制

- 中文关键词抽取按 PRD「连续中文串（按标点/英文/数字断开）」实现，长串会把短词粘住（如「当面对高杠杆」粘住「高杠杆」），短查询召回偏弱。改进方向：在 CJK 串内做 2–8 字重叠滑窗（未实现，以保持与 PRD 一致）。
- 内置大类词表是 MVP，覆盖随语料变化；跨机部署前建议在目标语料上做 `θ1/θ2` 网格标定并增补词表。

## 开发 / 测试

```bash
npm test          # node --test "test/**/*.test.js"
```

fixtures 位于 `test/fixtures/`（workbuddy + dsh 两个 root，含跨 root 同名 skill 与 block scalar / 嵌套 metadata 边界）。
