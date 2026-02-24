# Codex macOS Workflows (Local, Worktree, Cloud + MCP)

Last reviewed: 2026-02-14  
Audience: contributors using Codex app/CLI on macOS (Apple Silicon) with Codex-Synaptic.

## Source Of Truth

This guide is aligned with:

- `codex --help`
- `codex mcp --help`
- `codex mcp add --help`
- OpenAI Codex docs:
  - `https://developers.openai.com/codex/quickstart/`
  - `https://developers.openai.com/codex/app/`
  - `https://developers.openai.com/codex/app/features/`
  - `https://developers.openai.com/codex/cli/features/`
  - `https://developers.openai.com/codex/security/`

## Bootstrap And Launch Gate (Run First)

```bash
cd /absolute/path/to/codex-synaptic
npm install
npm run build

# verify codex + mcp command surfaces
codex --help
codex mcp --help
codex mcp add --help

# one-command bootstrap + strict readiness gate
node dist/cli/index.js launch --json

# explicit strict form for CI/automation
node dist/cli/index.js launch --strict --json
```

Launch defaults:

- Detached runtime authority (`background start`) that remains running after success.
- Required MCP gate set: `mcp-filesystem`, `mcp-playwright`, `mcp-desktop-commander`.
- Hard-stop behavior in strict mode: first failing gate exits non-zero with remediation commands.

Typical first Codex app prompt in this repo:

```text
Launch codex-synaptic and determine health/status prior to beginning repository work.
```

### Launch Failure Remediation Examples

```bash
# Codex auth missing
codex login

# Docker registry auth for MCP images
node dist/cli/index.js env docker-login mcp-filesystem mcp-playwright mcp-desktop-commander

# MCP runtime or registration drift
node dist/cli/index.js env up mcp-filesystem mcp-playwright mcp-desktop-commander
node dist/cli/index.js env codex-register mcp-filesystem mcp-playwright mcp-desktop-commander --replace

# Re-run hard gate
node dist/cli/index.js launch --strict --json
```

## Runtime Model (Deterministic)

Use one orchestrator authority at a time:

- Detached authority: `background start` + attach/monitor/TUI against daemon.
- In-process authority: `system start` + `system monitor` in current shell.

If a daemon is already running, local `system start` is blocked to prevent split-brain (unless explicitly overridden with `CODEX_ALLOW_LOCAL_WITH_DAEMON=1`).

### Daemon-Centric Operations

```bash
node dist/cli/index.js background start
node dist/cli/index.js background status
node dist/cli/index.js background attach --watch --interval 2000
node dist/cli/index.js background logs --tail 100
node dist/cli/index.js background restart
node dist/cli/index.js background stop --timeout 10000
```

### Local Session Operations

```bash
node dist/cli/index.js system start
node dist/cli/index.js system status
node dist/cli/index.js system monitor --interval 2000
node dist/cli/index.js system stop
```

### Terminal Dashboard (TUI)

```bash
# attach to daemon (preferred when detached runtime is active)
node dist/cli/index.js tui --attach-daemon --interval 1000

# force local dashboard
node dist/cli/index.js tui --local --interval 1000
```

## Codex App Modes

OpenAI Codex app modes:

- `Local`: edits current project directory.
- `Worktree`: isolates changes in a dedicated git worktree.
- `Cloud`: remote execution in configured cloud environment.

Reference: `https://developers.openai.com/codex/app/features/`.

## Local Mode (Fastest Inner Loop)

```bash
codex -C /absolute/path/to/codex-synaptic
# non-interactive:
codex exec -C /absolute/path/to/codex-synaptic "Audit consensus gating and suggest minimal fixes"
```

Recommended checks:

```bash
npm run lint
npm test
node dist/cli/index.js system status
```

## Worktree Mode (Parallel-Safe)

```bash
git worktree add ../codex-synaptic-macos-2026 -b codex/macos-2026-readiness
codex -C ../codex-synaptic-macos-2026
```

Cleanup:

```bash
git worktree remove ../codex-synaptic-macos-2026
```

## Cloud Mode (Remote Execution)

```bash
codex cloud list --json
codex cloud exec --env <env-id> --branch main "Run codex-synaptic release preflight and propose fixes"
codex cloud status <task-id>
codex cloud diff <task-id>
codex cloud apply <task-id>
```

## MCP Setup (Filesystem + Playwright + Desktop Commander)

```bash
# inspect profiles and codex registration targets
node dist/cli/index.js env plan mcp-filesystem mcp-playwright mcp-desktop-commander

# authenticate required Docker registries (for private GHCR images)
node dist/cli/index.js env docker-login mcp-filesystem mcp-playwright mcp-desktop-commander

# safest default: filesystem read-only
node dist/cli/index.js env up mcp-filesystem mcp-playwright mcp-desktop-commander

# optional controlled-write filesystem mode (explicit opt-in required)
node dist/cli/index.js env up mcp-filesystem --filesystem-mode controlled-write --allow-filesystem-write

# health/status diagnostics
node dist/cli/index.js env status mcp-filesystem mcp-playwright mcp-desktop-commander

# register HTTP MCP servers with Codex CLI config
node dist/cli/index.js env codex-register mcp-filesystem mcp-playwright mcp-desktop-commander --replace
codex mcp list --json
```

Expected indicators:

- `env status` returns `running: yes` and `healthy: yes` for active profiles.
- `launch --json` returns `ok: true` and `nextAction: "continue"`.
- `doctor` reports MCP profile checks passing and registration present.

## Sandbox And Approval Recommendations

From Codex security guidance (`https://developers.openai.com/codex/security/`):

1. Default for trusted repo work: `workspace-write` + `on-request` approvals (Codex `--full-auto` behavior).
2. For unfamiliar/untrusted code: start in `read-only` mode.
3. Use danger-full-access only in explicitly isolated environments.

Practical examples:

```bash
codex --sandbox workspace-write --ask-for-approval on-request
codex --sandbox read-only --ask-for-approval on-request
```

## Recommended Daily Loop

```bash
# 1) refresh build + readiness
npm run build
node dist/cli/index.js launch --strict --json

# 2) run focused work
codex exec "Implement one bounded fix with tests"

# 3) verify before merge
npm run lint && npm test
npm run release:preflight
```
