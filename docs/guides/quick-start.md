# Quick Start (Codex-Synaptic + Codex macOS)

Last reviewed: 2026-02-10

## 1. Install and build

```bash
npm install
npm run build
```

## 2. Verify CLI health

```bash
node dist/cli/index.js system status
```

Expected output includes JSON with system, agent, mesh, swarm, and consensus state.

## 3. Run a minimal local workflow

```bash
node dist/cli/index.js system start
node dist/cli/index.js reasoning plan "Stabilize codex-synaptic release readiness" --require-consensus
node dist/cli/index.js openai usage --json
```

## 4. Use Codex passthrough

```bash
codex-synaptic --codex --dry-run "Inspect current readiness blockers and propose bounded fixes"
```

## 5. Run verification gates

```bash
npm run lint
npm test
npm run release:preflight
```

## Next docs

- macOS operating modes and workflows: [`docs/guides/codex-macos-workflows.md`](./codex-macos-workflows.md)
- Codex passthrough details: [`docs/cli/codex-passthrough.md`](../cli/codex-passthrough.md)
- MCP setup: [`docs/mcp/README.md`](../mcp/README.md)
- Readiness roadmap: [`docs/roadmaps/codex-macos-2026-rekick.md`](../roadmaps/codex-macos-2026-rekick.md)
