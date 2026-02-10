# Codex macOS Workflows (Local, Worktree, Cloud)

Last reviewed: 2026-02-10
Audience: contributors using macOS (Apple Silicon) with Codex app/CLI and Codex-Synaptic.

## Prerequisites

```bash
# Codex CLI
codex --version

# Codex-Synaptic project deps
npm install
npm run build
```

Expected output indicators:

```text
codex-cli <version>
.../dist/cli/index.js generated
```

## Local Mode (fastest inner loop)

Use this when editing directly in your current repository checkout.

```bash
codex -C /absolute/path/to/codex-synaptic
# or non-interactive:
codex exec -C /absolute/path/to/codex-synaptic "Audit consensus gating and suggest minimal fixes"
```

Recommended project checks:

```bash
npm run lint
npm test
node dist/cli/index.js system status
```

Expected output indicators:

```text
PASS/FAIL from eslint and vitest
System not started. Run `codex-synaptic system start` first.
or a full status snapshot when already running.
```

## Worktree Mode (parallel-safe development)

Use this for isolated tracks and reviewable diffs.

```bash
# create feature worktree
git worktree add ../codex-synaptic-macos-2026 -b codex/macos-2026-readiness

# open codex in new worktree
codex -C ../codex-synaptic-macos-2026
```

Expected output indicators:

```text
Preparing worktree (new branch 'codex/macos-2026-readiness')
HEAD is now at ...
```

Cleanup when merged:

```bash
git worktree remove ../codex-synaptic-macos-2026
```

## Cloud Mode (remote execution)

Use this when tasks should run remotely and apply back locally.

```bash
codex cloud list --json
codex cloud exec --env <env-id> --branch main "Run codex-synaptic release preflight and propose fixes"
codex cloud status <task-id>
codex cloud diff <task-id>
codex cloud apply <task-id>
```

Expected output indicators:

```text
TASK_ID ...
status: queued|running|succeeded|failed
Applied diff for task ...
```

## Skills and Automations: Safe Usage Rules

1. Prefer worktree mode for broad/refactor tasks.
2. Keep prompts single-purpose; avoid packing unrelated asks into one run.
3. Require consensus for high-risk flows:

```bash
node dist/cli/index.js reasoning plan "Production-impacting release update" --require-consensus
```

4. Validate automation outputs before apply/merge.
5. For recurring automations, include explicit gating in prompt text (for example: "skip if lint fails", "do not mutate release branches").

## MCP Integration Setup (docs/tooling)

Codex-Synaptic exposes MCP service profiles via `env` commands.

```bash
# list profiles
node dist/cli/index.js env list

# bring up MCP services
node dist/cli/index.js env up mcp-filesystem
node dist/cli/index.js env up mcp-playwright

# check health
node dist/cli/index.js env status mcp-filesystem mcp-playwright

# inspect Codex CLI MCP registry
codex mcp list
```

Expected output indicators:

```text
mcp-filesystem ... running/healthy
mcp-playwright ... running/healthy
<registered MCP servers from codex mcp list>
```

## Recommended Daily Loop

```bash
# 1) refresh build
npm run build

# 2) run focused work (local or worktree)
codex exec "Implement one bounded fix with tests"

# 3) verify
npm run lint && npm test

# 4) release preflight before merge/release
npm run release:preflight
```
