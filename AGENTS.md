# AGENTS.md — Codex-Synaptic Launch-Gated Operating Contract

This repository is operated as a **global CLI + daemon appliance** for Codex (macOS app + VS Code extension).

## 1) Launch Gate is mandatory

Run this before implementation work:

```bash
codex-synaptic launch --strict --json
```

Treat it as a hard gate:
- If `ok=false`, stop and apply remediations first.
- Only proceed when `ok=true`.

## 2) Golden path

1. `launch --strict --json`
2. Apply safe remediations (`fixes[].safeUnderSandbox=true`)
3. Re-run `launch --strict --json`
4. Run bounded workflow
5. Produce report (diff summary + verification + follow-up)

## 3) Command policy

Allowed by default under workspace-write:
- `npm install`, `npm run build`, `npm run test`, `npm exec tsc -- --noEmit`
- `codex-synaptic launch --strict --json`
- `codex-synaptic background status|start|attach|logs|stop`
- `codex-synaptic project attach|list`

Needs explicit elevated allowlist (mark as unsafe in reports):
- Host-level installs (`brew install`, `npm install -g`)
- Docker credential operations (`codex-synaptic env docker-login ...`)
- Commands requiring access beyond repository/workspace scope

## 4) Worktree and daemon state

- Assume automations run in dedicated worktrees.
- Never store daemon state in the repository or worktree.
- Default daemon state path: `~/.codex-synaptic`.
- Optional override: `CODEX_SYNAPTIC_STATE_DIR` must point outside repo/worktree.

## 5) Project config model

Per attached project:
- `AGENTS.md` → instruction policy
- `.codex/config.toml` → Codex runtime + MCP config
- `.codex-synaptic/project.json` → Synaptic project-local settings

Trust + config bootstrap:
1. Create `.codex/config.toml` with workspace-write defaults.
2. Keep MCP definitions minimal and local-safe.
3. Attach repo via `codex-synaptic project attach <path>`.

## 6) Optional engines

`ruflo` and `ruv-FANN` are optional adapters. Missing engines must never block core launch readiness.
