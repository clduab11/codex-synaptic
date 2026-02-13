# Quick Start (Codex-Synaptic + Codex macOS)

Last reviewed: 2026-02-10

## 1. Install and build

```bash
npm install
npm run build
```

## 2. Verify CLI health

```bash
npm run cli -- system status
```

Expected output in a cold shell:

```text
System not started. Run `codex-synaptic system start` first.
```

Expected output after startup:

```bash
npm run cli -- system start
```

This command prints a telemetry snapshot and then exits cleanly in one-shot mode.

If you need to keep the foreground process alive for debugging, run with `CODEX_CLI_AUTO_SHUTDOWN=0`.

## 3. Run a minimal local workflow

```bash
npm run cli -- reasoning plan "Stabilize codex-synaptic release readiness" --require-consensus --json
npm run cli -- openai usage --json
npm run cli -- hive-mind spawn "Verify macOS readiness smoke flow" --codex --dry-run
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

If preflight needs to ignore additional known local runtime artifacts for your environment, use:

```bash
CODEX_RELEASE_PREFLIGHT_EPHEMERAL_ALLOWLIST=".codex-synaptic/runtime.pid,tmp/runtime.lock" npm run release:preflight
```

## Next docs

- macOS operating modes and workflows: [`docs/guides/codex-macos-workflows.md`](./codex-macos-workflows.md)
- Codex passthrough details: [`docs/cli/codex-passthrough.md`](../cli/codex-passthrough.md)
- MCP setup: [`docs/mcp/README.md`](../mcp/README.md)
- Readiness roadmap: [`docs/roadmaps/codex-macos-2026-rekick.md`](../roadmaps/codex-macos-2026-rekick.md)
