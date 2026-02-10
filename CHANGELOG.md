# Changelog

All notable changes to Codex-Synaptic are documented here.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)  
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

### Added

- `docs/roadmaps/codex-macos-2026-rekick.md` readiness baseline + gap report.
- `docs/guides/codex-macos-workflows.md` with Local/Worktree/Cloud operation guidance.
- `scripts/release-preflight.mjs` and `npm run release:preflight` release hygiene gate.
- Consensus manager tests for feasible quorum downgrade and eligible-voter finalization.

### Changed

- OpenAI coding model defaults now prioritize Codex-family routing (`gpt-5.3-codex` -> `gpt-5-codex` -> `gpt-5`).
- Responses API guidance aligned across README/docs for agentic coding workflows.
- Hive-mind and bootstrap paths now ensure quorum-capable consensus coordinator availability.
- Autoscaler scale-down now records deferred reductions when daemon runtime is inactive.
- README and docs index rewritten for 2026 release-readiness narrative and checklist.

### Archived

- 2025 planning artifacts now explicitly marked archived in:
  - `docs/integration/OPENAI_PLATFORM_2025_INTEGRATION.md`
  - `docs/plans/sprint-2-implementation-plan.md`
  - `docs/plans/week-3-backlog.md`

## [1.0.0] - Historical baseline

- Initial public baseline for Codex-Synaptic TypeScript orchestration runtime.
