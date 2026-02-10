# Codex CLI Passthrough Quick Start (macOS 2026)

This guide verifies and exercises `codex-synaptic --codex` passthrough with the current Codex CLI stack.

## Prerequisites

```bash
# Install Codex CLI
npm install -g @openai/codex
# or
brew install codex

# Verify
codex --version
```

Expected output (example):

```text
codex-cli 0.92.0
```

## 1. Basic passthrough

```bash
codex-synaptic --codex "Show current mesh, swarm, and consensus readiness for this repo"
```

Expected output indicators:

```text
🔀 Codex CLI Passthrough Mode Activated
📚 Building Codex-Synaptic context for passthrough...
🚀 Passing through to Codex CLI: ...
```

## 2. Safe preview mode

```bash
codex-synaptic --codex --dry-run "Plan a bounded codex-synaptic upgrade"
```

Expected output indicators:

```text
Prompt Preview
Context lines: ...
Generated Artifacts
```

## 3. Verbose diagnostics

```bash
codex-synaptic --codex --verbose "Inspect Codex-Synaptic release drift"
```

Use this mode when validating context truncation, discovered AGENTS directives, and attached local state.

## 4. Prime shells automatically

```bash
# ~/.zshrc
source /absolute/path/to/codex-synaptic/scripts/codex-shell-prime.zsh
```

Optional environment flags:

- `CODEX_SYNAPTIC_PRIME_DISABLE=1` disables shell priming.
- `CODEX_SYNAPTIC_PRIME_PROMPT="..."` overrides the startup prompt.

## 5. Cloud handoff (optional)

If you want work to continue remotely after local planning:

```bash
codex cloud list --json
codex cloud exec --env <env-id> "Implement Codex-Synaptic release checklist gates"
codex cloud status <task-id>
codex cloud apply <task-id>
```

Expected output indicators:

```text
TASK_ID ...
status: queued|running|succeeded|failed
Applied diff for task ...
```

## Troubleshooting

### `--codex` says CLI is missing

```bash
which codex
codex --help
```

Then reinstall:

```bash
npm install -g @openai/codex
# or
brew install codex
```

### Authentication issues

```bash
codex login
```

### Keep context lean

- Use `--dry-run` first for very large repositories.
- Keep AGENTS/README concise and current; passthrough includes both.
- Prefer targeted prompts over broad, multi-question prompts.

---

Status: Active
Last reviewed: 2026-02-10
