# Changelog

Notable public changes are recorded here. Roflock uses Semantic Versioning;
while the project is below 1.0, a minor release may include documented breaking
changes and a patch release remains compatible within that minor line.

## [Unreleased]

### Added

- release-ready open-source, operator, language, CLI, Studio/Playground, driver,
  MCP, API, and security documentation;
- cross-platform packed-artifact validation and npm OIDC publishing workflow.

## [0.1.0] - unreleased

### Added

- `.roflock` 0.1 parser/compiler, Graph IR 1.0, diagnostics, hashing, validation,
  and graph rendering;
- arbitrary authored workflow registration and immutable run snapshots;
- durable graph runtime with bounded retries, typed outcomes, recovery, controls,
  approvals, evidence, usage, and Change Passports;
- CLI, local daemon, bundled Studio, isolated browser Playground, MCP v1, and
  authenticated control-surface API;
- AgentDriver production seam with Codex, Claude Code, and OpenCode drivers,
  preserved Cursor/custom provider compatibility, conformance, sessions, and
  truthful cancellation;
- Apache-2.0 licensing with no core capability gates.

### Compatibility

- `roleflock` remains a deprecated executable alias;
- `ROLEFLOCK_*`, `~/.roleflock`, `roleflock.db`, `@roleflock/*`, historical
  graph IDs, wire headers/cookies, media types, Git refs, events, and published
  status-check identifiers remain supported where applicable.

[Unreleased]: https://github.com/Fikrifrds/roflock/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Fikrifrds/roflock/releases/tag/v0.1.0
