# GitHub Codex Action + MCP Runbook

This repository includes two Codex GitHub Actions workflows:

- `.github/workflows/codex-pr-review-mcp.yml`
- `.github/workflows/codex-viral-growth-mcp.yml`

Both use `openai/codex-action` with:

- `safety-strategy: unsafe` (explicitly requested for this repo)
- `sandbox: workspace-write`
- a Codex home config at `.github/codex/configs/mcp-full.toml`
- artifact upload enabled for auditability

## How to run

### Codex PR Review workflow

**Automatic triggers:**
- Runs automatically on PR events: opened, synchronize, reopened, ready_for_review
- Only runs on non-draft PRs from non-fork branches (fork PRs are blocked to protect secrets)

**Manual trigger:**
1. Navigate to Actions → "Codex PR Review (MCP-Enhanced)"
2. Click "Run workflow"
3. Required input:
   - `pr_number`: Pull request number to review (e.g., `42`)
4. Click "Run workflow" button

**Key configuration:**
- `safety-strategy: unsafe`
- `sandbox: workspace-write` with `network_access=true`
- Codex home: `.github/codex/configs/mcp-full.toml`
- Model: `gpt-5-codex` with `effort: high`

**Outputs:**
- Artifact: `codex-pr-review-{pr_number}` (retained 14 days)
- PR comment with review feedback (if Codex produces output)
- Logs available in workflow run details

### Codex Viral Growth Brief workflow

**Scheduled trigger:**
- Runs weekly on Mondays at 14:00 UTC (cron: `0 14 * * 1`)
- To change schedule, edit the `cron:` expression in `.github/workflows/codex-viral-growth-mcp.yml`

**Manual trigger:**
1. Navigate to Actions → "Codex Viral Growth Brief (MCP-Enhanced)"
2. Click "Run workflow"
3. Optional inputs:
   - `focus`: Focus area for the brief (e.g., "developer adoption", "GitHub visibility", "enterprise GTM") - leave empty for general brief
   - `post_issue`: Check this to create a GitHub issue with the generated brief (default: unchecked)
4. Click "Run workflow" button

**Key configuration:**
- `safety-strategy: unsafe`
- `sandbox: workspace-write` with `network_access=true`
- Codex home: `.github/codex/configs/mcp-full.toml`
- Model: `gpt-5-codex` with `effort: high`

**Outputs:**
- Artifact: `codex-viral-growth-brief` (retained 14 days)
- Optional GitHub issue (if `post_issue` input is true)
- Logs available in workflow run details

## Why dependencies are installed before Codex

`codex-action` runs Codex with sandboxing. In `workspace-write`, network is often disabled by default unless enabled in config. To avoid flaky runtime installs, workflows pre-install project and MCP dependencies before `Run Codex`.

## Required GitHub secrets

Minimum:

- `OPENAI_API_KEY`

Recommended MCP secrets:

- `CONTEXT7_API_KEY`
- `BRAVE_API_KEY`
- `FIRECRAWL_API_KEY`
- `FIRECRAWL_API_URL` (only for self-hosted Firecrawl)
- `JINA_API_KEY`
- `DEEPWIKI_API_KEY` (required for private DeepWiki/Devin mode)

## Official provider references used for configuration

- OpenAI Codex Action:
  - https://github.com/openai/codex-action
- OpenAI Codex config reference:
  - https://developers.openai.com/codex/config-reference
- Brave MCP:
  - https://github.com/brave/brave-search-mcp-server
- Firecrawl MCP:
  - https://github.com/firecrawl/firecrawl-mcp-server
- Jina MCP:
  - https://github.com/jina-ai/MCP
- Context7 MCP:
  - https://github.com/upstash/context7
- DeepWiki MCP:
  - https://mcp.deepwiki.com/
  - https://docs.devin.ai/work-with-devin/deepwiki-mcp

## MCP configuration notes

The shared Codex config lives at:

- `.github/codex/configs/mcp-full.toml`

It defines all requested MCP servers:

- `context7` via remote HTTP (`https://mcp.context7.com/mcp`)
- `brave` via local stdio command (`brave-search-mcp-server`)
- `firecrawl` via local stdio command (`firecrawl-mcp`)
- `jina` via remote HTTP (`https://mcp.jina.ai/v1`)
- `deepwiki` via remote HTTP (`https://mcp.deepwiki.com/mcp`)

All MCP entries are `required = false` so Codex can proceed if any provider is down or secret is missing.

## Security posture caveat

`safety-strategy: unsafe` is high risk. It is intentionally used here by request. To reduce blast radius:

1. PR workflow skips forked PRs by default.
2. Codex run and comment-post run in separate jobs.
3. The second job runs on a fresh runner.
4. Actions are pinned to commit SHAs.

If you later want a safer mode, switch to `drop-sudo` (recommended by `openai/codex-action`) or `unprivileged-user`.
