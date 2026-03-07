# codex-synaptic

Codex-Synaptic is an **appliance-grade global CLI + daemon** for Codex on macOS. Install once, attach to any repository, run a deterministic launch gate, and only then execute bounded workflows.

## Product model

- **Codex is the cockpit**: app threads, VS Code extension, automations, approvals, and worktrees.
- **Synaptic is the engine room**: daemon lifecycle, readiness checks, MCP routing, telemetry, and release hygiene.
- **Launch Gate is the contract**: `codex-synaptic launch --strict --json` is the first command for every workflow.
- **Optional engines**:
  - `ruflo` adapter (optional, capability upgrade only)
  - `ruv-FANN` adapter (optional, capability upgrade only)

## 5-minute first run

```bash
# 1) Install globally
npm install -g codex-synaptic

# 2) Verify global CLI
codex-synaptic --help

# 3) Attach current repository
codex-synaptic project attach .

# 4) Run deterministic launch gate
codex-synaptic launch --strict --json

# 5) Apply safe remediations (from fixes[].safeUnderSandbox=true), rerun launch
codex-synaptic launch --strict --json
```

When `ok=true`, start your bounded workflow and produce a report artifact (diff summary, validation log, and follow-up backlog).

## Attach a new repository

```bash
cd /path/to/target-repo
codex-synaptic project attach .
codex-synaptic launch --strict --json
```

Synaptic discovers and uses:

- `AGENTS.md` for Codex instructions
- `.codex/config.toml` for Codex project config and MCP
- `.codex-synaptic/project.json` for Synaptic project-local behavior (optional)

## Worktree + sandbox safety

- Daemon state is global and **outside** repository/worktree paths (default: `~/.codex-synaptic`).
- Preferred sandbox for development and launch remediations: `workspace-write`.
- Launch report explicitly marks unsafe remediations with `safeUnderSandbox=false` and indicates minimal extra allowlist needs.

See:
- `docs/launch-gate.md`
- `docs/codex-usage.md`
- `docs/sandbox-and-rules.md`
