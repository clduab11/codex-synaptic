# Launch Gate

`codex-synaptic launch --strict --json` is the deterministic readiness contract for this appliance.

## Strict JSON schema

```json
{
  "ok": true,
  "capabilities": ["..."],
  "checks": [
    { "name": "...", "status": "pass|fail|warn", "detail": "..." }
  ],
  "fixes": [
    { "why": "...", "command": "...", "safeUnderSandbox": true }
  ],
  "nextActions": ["..."]
}
```

## Required checks

The gate emits at least:
- `runtime.node`
- `runtime.npm`
- `repo.dependencies`
- `repo.build`
- `repo.typecheck`
- `repo.test`
- `daemon.health`
- `mcp.config`
- `worktree.state_location`
- optional capability checks (`optional.ruflo`, `optional.ruv-fann`) as non-blocking warnings

## Remediation semantics

- `safeUnderSandbox=true` means the fix is expected to run under workspace-write.
- `safeUnderSandbox=false` means the fix needs additional host allowlist or elevated rules.
- Apply safe fixes first, rerun launch, and only then proceed to workflow execution.

## Failure handling contract

- In strict mode, the command exits non-zero when `ok=false`.
- Optional engines can downgrade capabilities but must not fail core boot.
