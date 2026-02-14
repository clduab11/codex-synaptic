# Quick Start (Codex-Synaptic + Codex macOS)

Last reviewed: 2026-02-14

## 1. Install and build

```bash
npm install
npm run build
```

## 2. Run launch gate

```bash
npm run cli -- launch --strict --json
```

Expected success indicators:

```text
ok: true
nextAction: continue
```

If launch fails, stop repository work and run the remediation commands returned in the report.
For Docker registry-denied errors, run:

```bash
npm run cli -- env docker-login mcp-filesystem mcp-playwright mcp-desktop-commander
```

## 3. Optional direct runtime inspection

```bash
npm run cli -- system status
```

## 4. Run a minimal local workflow

```bash
npm run cli -- reasoning plan "Stabilize codex-synaptic release readiness" --require-consensus --json
npm run cli -- openai usage --json
npm run cli -- hive-mind spawn "Verify macOS readiness smoke flow" --codex --dry-run
```

## 5. Use Codex passthrough

```bash
codex-synaptic --codex --dry-run "Inspect current readiness blockers and propose bounded fixes"
```

## 6. Run verification gates

```bash
npm run lint
npm test
npm run release:preflight
```

If preflight needs to ignore additional known local runtime artifacts for your environment, use:

```bash
CODEX_RELEASE_PREFLIGHT_EPHEMERAL_ALLOWLIST=".codex-synaptic/runtime.pid,tmp/runtime.lock" npm run release:preflight
```

## Next docs

- macOS operating modes and workflows: [`docs/guides/codex-macos-workflows.md`](./codex-macos-workflows.md)
- Codex passthrough details: [`docs/cli/codex-passthrough.md`](../cli/codex-passthrough.md)
- MCP setup: [`docs/mcp/README.md`](../mcp/README.md)
- Readiness roadmap: [`docs/roadmaps/codex-macos-2026-rekick.md`](../roadmaps/codex-macos-2026-rekick.md)
