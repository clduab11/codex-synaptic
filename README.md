# codex-synaptic

Distributed agent orchestration for coding workflows: mesh + swarm + consensus + Codex passthrough.

## Current Status (2026-02-10)

- Release track: **Codex macOS 2026 readiness** (from beta-hardening toward internal release).
- Package version: **`1.0.0`** (source of truth is `package.json`).
- Readiness baseline before this rekick: ~60% (consensus quorum reliability, autoscaler scale-down behavior, and packaging hygiene were blocking).
- OpenAI ecosystem alignment target:
  - Codex app for macOS launched **2026-02-02**.
  - GPT-5.3-Codex launched **2026-02-05**.
  - `codex-mini-latest` removed from API access on **2026-01-16**.

## What Changed in This Rekick

- Added a formal roadmap + gap report: [`docs/roadmaps/codex-macos-2026-rekick.md`](docs/roadmaps/codex-macos-2026-rekick.md)
- Modernized model/runtime defaults to Codex-family-first routing for coding workflows.
- Added macOS workflow documentation for Local / Worktree / Cloud operation modes.
- Hardened consensus quorum behavior and autoscaler scale-down fallback handling.
- Added release preflight command for packaging/remote hygiene.
- Archived 2025 roadmap/planning docs explicitly to remove active-roadmap ambiguity.

## Quick Start

```bash
# install + build
npm install
npm run build

# verify CLI health
node dist/cli/index.js system status

# run release gates
npm run lint
npm test
npm run release:preflight
```

## Model + Runtime Guidance (Codex-Focused)

Use **Responses API** for agentic coding flows.

| Purpose | Recommended model | Fallback | Deprecation-safe fallback |
| --- | --- | --- | --- |
| Primary coding orchestration | `gpt-5.3-codex` | `gpt-5-codex` | `gpt-5` |
| Validation / review | `gpt-5-codex` | `gpt-5-mini` | `gpt-5-nano` |
| High-complexity governance paths | `gpt-5-pro` | `gpt-5-codex` | `gpt-5` |

Notes:

- Codex-focused models should not use `codex-mini-latest` (removed 2026-01-16).
- Codex-family models are treated as Responses-first in this repo.
- Chat Completions remains supported in the ecosystem, but this project prefers Responses for reasoning/tool flows.

## Codex macOS Workflows

Full guide: [`docs/guides/codex-macos-workflows.md`](docs/guides/codex-macos-workflows.md)

### Local mode

```bash
codex -C /absolute/path/to/codex-synaptic
```

### Worktree mode

```bash
git worktree add ../codex-synaptic-macos-2026 -b codex/macos-2026-readiness
codex -C ../codex-synaptic-macos-2026
```

### Cloud mode

```bash
codex cloud list --json
codex cloud exec --env <env-id> "Run codex-synaptic readiness fixes"
codex cloud status <task-id>
codex cloud apply <task-id>
```

### Skills, automations, and MCP

- Skills/automation safety guidance and operating rules are documented in [`docs/guides/codex-macos-workflows.md`](docs/guides/codex-macos-workflows.md).
- MCP catalog and setup commands are documented in [`docs/mcp/README.md`](docs/mcp/README.md).

## Stability Blockers: Status + Mitigation

| Blocker | Status | Mitigation in repo |
| --- | --- | --- |
| Consensus quorum gating reliability | Mitigated | Quorum requirements clamp to feasible voter population; finalization now uses eligible voters, not total agents. |
| Autoscaler scale-down when daemon inactive | Mitigated (guarded fallback) | Deferred reduction telemetry + non-daemon informative logging instead of opaque failure warnings. |
| Packaging/release hygiene + remote alignment | Mitigated | `npm run release:preflight` checks directory name, origin remote, working tree cleanliness (excluding ephemeral DB files), and `npm pack --dry-run`. |

## Release Readiness Checklist

A release is considered internally ready only when all gates pass:

- [ ] `npm run lint` exits `0`.
- [ ] `npm test` exits `0`.
- [ ] Representative CLI smoke flow succeeds (`system status`, `reasoning plan --require-consensus --json`, `openai usage --json`).
- [ ] `npm run release:preflight` exits `0`.
- [ ] README, roadmap, and changelog dates are current and consistent with package version.
- [ ] No active roadmap section references 2025 phases without an explicit archival note.

## Roadmap

### 2026 active roadmap

1. Stabilize consensus/autoscaler/release hygiene paths for internal release.
2. Expand Codex macOS worktree/cloud contributor workflows and verification automation.
3. Harden MCP integration profiles and observability signals for daily operations.

### 2025 roadmap archival note

The previous 2025 phase plans are retained as historical artifacts and now explicitly marked archived:

- [`docs/integration/OPENAI_PLATFORM_2025_INTEGRATION.md`](docs/integration/OPENAI_PLATFORM_2025_INTEGRATION.md)
- [`docs/plans/sprint-2-implementation-plan.md`](docs/plans/sprint-2-implementation-plan.md)
- [`docs/plans/week-3-backlog.md`](docs/plans/week-3-backlog.md)

## Core Commands

```bash
# system
node dist/cli/index.js system start
node dist/cli/index.js system status
node dist/cli/index.js background start
node dist/cli/index.js background status

# consensus
node dist/cli/index.js consensus status
node dist/cli/index.js consensus telemetry --limit 5

# openai usage
node dist/cli/index.js openai usage --json

# codex passthrough
codex-synaptic --codex --dry-run "Inspect release readiness drift"
```

## Documentation Index

- Docs home: [`docs/README.md`](docs/README.md)
- Quick start: [`docs/guides/quick-start.md`](docs/guides/quick-start.md)
- macOS modes and workflows: [`docs/guides/codex-macos-workflows.md`](docs/guides/codex-macos-workflows.md)
- MCP setup: [`docs/mcp/README.md`](docs/mcp/README.md)
- Rekick roadmap: [`docs/roadmaps/codex-macos-2026-rekick.md`](docs/roadmaps/codex-macos-2026-rekick.md)

## Contributing

1. Create a branch (prefix `codex/` recommended for feature work).
2. Keep changes small and testable.
3. Run: `npm run lint && npm test && npm run release:preflight`.
4. Open a PR with blockers/risks called out explicitly.
