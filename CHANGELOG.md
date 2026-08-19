# Changelog

## [0.1.0] - 2026-08-19

### Added

- Scan `~/.workbuddy/skills` and `$DSH_HOME/skills` and build a two-level
  (category + skill) recall index, with sha256-based incremental rebuilds.
- Intent routing via keyword × IDF scoring with hit / low-confidence / miss
  three-state fallback (substring matching, not token-set intersection).
- `skill_index` model-facing tool and `/skill-index` slash command.
- Hand-rolled YAML-subset frontmatter parsing, including full multi-line block
  scalars and nested-metadata skipping.
- `categories.yaml` override support on top of the built-in domain keyword table.
- `node:test` unit test suite (scan / extract / classify / indexer / score /
  router) with synthetic fixtures.
