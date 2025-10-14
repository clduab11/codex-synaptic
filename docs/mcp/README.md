# Codex-Synaptic MCP Service Catalog

Codex-Synaptic can lazily spin MCP servers whenever a workflow or tool needs them. Each service is described below, along with the Docker Compose fragment used by the environment manager (`codex-synaptic env ...`).

## How It Works

1. When a workflow requests a tool supplied by an MCP server (e.g., GitHub PR fetch), Codex-Synaptic calls the environment manager to ensure the corresponding service is running.
2. The manager executes `docker compose -f docker/mcp/docker-compose.<service>.yml up -d`, waits for the service to become healthy (if a health probe is defined), then registers the MCP tools dynamically.
3. When work is done you may shut services down with `codex-synaptic env down <service>`.

All images listed below are free to run. You may substitute your own fork or custom build—just update the compose file and restart.

## Available MCP Profiles

| Profile | Compose File | Default Port | Env Vars | Notes |
|---------|--------------|--------------|---------|-------|
| `mcp-github` | `docker/mcp/docker-compose.github.yml` | 7010 | `GITHUB_TOKEN` | GitHub MCP for repository/issues/PR automation. Requires a PAT with appropriate scopes. |
| `mcp-context7` | `docker/mcp/docker-compose.context7.yml` | 7020 | `CONTEXT7_API_KEY` | Context7 high-level browser automation. |
| `mcp-playwright` | `docker/mcp/docker-compose.playwright.yml` | 7030 | — | Playwright MCP worker with Chromium automation. |
| `mcp-filesystem` | `docker/mcp/docker-compose.filesystem.yml` | 7040 | — | Read-only access to the workspace (mounts `../../`). Adjust the compose file if you need write access. |
| `mcp-tavily` | `docker/mcp/docker-compose.tavily.yml` | 7050 | `TAVILY_API_KEY` | Tavily search MCP for quick web lookups. |
| `mcp-firecrawl` | `docker/mcp/docker-compose.firecrawl.yml` | 7060 | `FIRECRAWL_API_KEY` | Firecrawl crawler MCP for deep web extraction. |

> **Heads-up:** Image tags reference the public Context Labs/Firecrawl registries at the time of writing. Swap to your preferred tags or pin to specific digests in production.

## CLI Quick Reference

```bash
# List defined MCP/observability/vector profiles
codex-synaptic env list

# Spin up GitHub MCP (waits for health by default)
codex-synaptic env up mcp-github

# Check status of multiple services
codex-synaptic env status mcp-github mcp-playwright

# Tear down when you are done
codex-synaptic env down mcp-github
```

Add or modify compose fragments under `docker/mcp/` and they will show up automatically in `codex-synaptic env list`.
