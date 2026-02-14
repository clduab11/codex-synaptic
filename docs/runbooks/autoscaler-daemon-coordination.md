# Autoscaler And Daemon Coordination Runbook

Last updated: 2026-02-13

This runbook documents how autoscaling behavior relates to detached daemon operation, and how to run status/monitoring commands without introducing split-brain runtime behavior.

## 1. Runtime Authority Model

- The detached daemon is the authoritative runtime when started with `background start`.
- `system status`, `system monitor`, and `background attach` can read daemon-backed state.
- If daemon mode is active, local in-process startup is blocked by default to avoid running two independent orchestrators.

Override (use sparingly):

```bash
CODEX_ALLOW_LOCAL_WITH_DAEMON=1 node dist/cli/index.js system start
```

## 2. Why This Matters For Autoscaling

Autoscaler decisions and lifecycle actions are only reliable when all operator surfaces look at the same runtime authority.

Before this update, it was possible to read local session state while a daemon was active. The CLI now routes status/monitor surfaces to daemon state when available, preventing silent drift between dashboards and detached runtime behavior.

## 3. Standard Operational Modes

### Production / Long-Running Mode (Recommended)

Use detached mode and attach dashboards:

```bash
node dist/cli/index.js background start
node dist/cli/index.js background status
node dist/cli/index.js background attach --watch --interval 2000
node dist/cli/index.js tui --attach-daemon --interval 1000
```

### Local Debug Mode

Run an in-process orchestrator when detached daemon is not active:

```bash
node dist/cli/index.js system start
node dist/cli/index.js system monitor --interval 2000
node dist/cli/index.js system stop
```

### Test Isolation Mode

If testing requires deterministic local behavior, stop daemon first:

```bash
node dist/cli/index.js background stop --timeout 10000
node dist/cli/index.js system start
```

## 4. Command Reference (Current CLI Surface)

### Daemon Lifecycle

```bash
node dist/cli/index.js background start
node dist/cli/index.js background status
node dist/cli/index.js background attach --watch
node dist/cli/index.js background logs --tail 100
node dist/cli/index.js background restart --timeout 10000
node dist/cli/index.js background stop --timeout 10000
```

### Runtime Status And Telemetry

```bash
node dist/cli/index.js system status
node dist/cli/index.js system monitor --interval 2000
node dist/cli/index.js tui --attach-daemon
node dist/cli/index.js doctor --strict
```

## 5. Troubleshooting

### Symptom: `system start` refuses to start

Cause: detached daemon already running.

Check:

```bash
node dist/cli/index.js background status
```

Resolution:

1. Preferred: use attach/monitor commands against daemon.
2. Alternative: stop daemon first, then start local session.
3. Last resort: set `CODEX_ALLOW_LOCAL_WITH_DAEMON=1` if dual runtime is intentional.

### Symptom: Dashboard shows no daemon telemetry

Check:

```bash
node dist/cli/index.js background status
node dist/cli/index.js background logs --tail 100
```

Resolution:

```bash
node dist/cli/index.js background restart
node dist/cli/index.js background attach --watch
```

### Symptom: Autoscaling appears ineffective or stale

Run an authoritative health sweep:

```bash
node dist/cli/index.js system status
node dist/cli/index.js system monitor --interval 2000
node dist/cli/index.js doctor --strict
```

If daemon is offline, start it and re-check:

```bash
node dist/cli/index.js background start
node dist/cli/index.js background status
```

## 6. Configuration Reference

Autoscaling configuration is defined in `config/system.json` under `scaling`, for example:

```json
{
  "scaling": {
    "enabled": true,
    "minAgents": 4,
    "maxAgents": 40,
    "scaleUpThreshold": 0.75,
    "scaleDownThreshold": 0.35,
    "cooldownMs": 45000
  }
}
```

After changing scaling config, restart runtime authority to apply changes:

```bash
node dist/cli/index.js background restart
```

## 7. Related Docs

- `docs/guides/codex-macos-workflows.md`
- `docs/mcp/README.md`
- `docs/observability/README.md`
- `docs/reports/runtime-architecture-delta-2026-02-13.md`
