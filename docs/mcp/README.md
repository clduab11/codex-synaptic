# Codex-Synaptic MCP Service Catalog

This catalog documents MCP profiles managed by `codex-synaptic env ...` and how to register them in Codex CLI/App.

## How It Works

1. `env up <profile...>` starts profile compose stacks and waits for health checks by default.
2. `env status <profile...>` reports runtime + health diagnostics (including probe failures).
3. `env codex-register <profile...>` writes streamable HTTP MCP entries into Codex via `codex mcp add --url ...`.

Profiles are defined in `src/env/service-manager.ts` and backed by compose files in `docker/mcp/`.

## Available MCP Profiles

| Profile | Compose File | Default Port | Required Env | Codex MCP Name | Notes |
|---------|--------------|--------------|--------------|----------------|-------|
| `mcp-github` | `docker/mcp/docker-compose.github.yml` | 7010 | `GITHUB_TOKEN` | `github` | GitHub automation and PR tooling. |
| `mcp-context7` | `docker/mcp/docker-compose.context7.yml` | 7020 | `CONTEXT7_API_KEY` | `context7` | Context7 browser/service tooling. |
| `mcp-playwright` | `docker/mcp/docker-compose.playwright.yml` | 7030 | — | `playwright-local` | Browser automation profile. |
| `mcp-filesystem` | `docker/mcp/docker-compose.filesystem.yml` | 7040 | — | `filesystem-local` | Filesystem MCP, read-only by default. |
| `mcp-tavily` | `docker/mcp/docker-compose.tavily.yml` | 7050 | `TAVILY_API_KEY` | `tavily` | Web search MCP. |
| `mcp-firecrawl` | `docker/mcp/docker-compose.firecrawl.yml` | 7060 | `FIRECRAWL_API_KEY` | `firecrawl` | Crawl/extraction MCP. |
| `mcp-desktop-commander` | `docker/mcp/docker-compose.desktop-commander.yml` | 7070 | — | `desktop-commander` | Desktop/tooling automation MCP profile. |

## Filesystem Safety Modes

`mcp-filesystem` supports explicit runtime modes:

- `read-only` (default): container mount is read-only.
- `controlled-write`: requires explicit opt-in at command time.

Examples:

```bash
# default safe mode
node dist/cli/index.js env up mcp-filesystem

# explicit controlled write mode
node dist/cli/index.js env up mcp-filesystem --filesystem-mode controlled-write --allow-filesystem-write
```

## CLI Quick Reference

```bash
# inspect profile metadata (ports, codex names, requirements)
node dist/cli/index.js env plan mcp-filesystem mcp-playwright mcp-desktop-commander

# start MCP profiles and wait for health
node dist/cli/index.js env up mcp-filesystem mcp-playwright mcp-desktop-commander

# check health + diagnostics
node dist/cli/index.js env status mcp-filesystem mcp-playwright mcp-desktop-commander

# register MCP HTTP endpoints in codex
node dist/cli/index.js env codex-register mcp-filesystem mcp-playwright mcp-desktop-commander --replace

# verify codex registry
codex mcp list --json
```

## Codex CLI/App Registration Notes

Verified `codex` CLI surface:

```bash
codex mcp --help
codex mcp add --help
```

`codex mcp add` supports streamable HTTP registration with:

- `--url <URL>`
- optional `--bearer-token-env-var <ENV_VAR>`

Codex app, CLI, and IDE extension share MCP configuration state; registration in one surface is visible in the others.

## Startup Diagnostics

Use the doctor workflow for one-pass validation:

```bash
node dist/cli/index.js doctor --strict
```

Doctor verifies:

- Codex auth state (`codex login status`)
- `codex mcp list --json` availability
- MCP profile runtime health
- MCP registration presence for default profiles (`mcp-filesystem`, `mcp-playwright`, `mcp-desktop-commander`)

For end-to-end macOS workflow guidance, see [`docs/guides/codex-macos-workflows.md`](../guides/codex-macos-workflows.md).
