# Runtime Architecture Delta (2026-02-13)

## Scope

This note captures the observed runtime/operator gaps before the Codex macOS readiness changes and the target architecture now implemented in this branch.

## Baseline Gaps

1. Daemon and in-process runtime could diverge without an explicit attach path, creating split-brain risk.
2. `system status` and monitor surfaces depended on local process state and did not reliably reflect detached daemon reality.
3. The terminal dashboard path was placeholder/fallback oriented and not wired to live telemetry.
4. MCP service profile support did not include Desktop Commander and lacked standardized health/registration diagnostics.
5. MCP bridge calls to external orchestrators did not expose clear timeout/retry semantics and structured error responses.

## Implemented Runtime Model

1. **Single-authority daemon state**
   - Detached daemon publishes socket-based runtime APIs and periodic runtime snapshots.
   - CLI commands can query daemon state directly (`status`, telemetry watch, shutdown/restart control).
2. **Split-brain prevention**
   - Local `system start` path blocks when daemon is active unless an explicit override is supplied.
   - Dashboard defaults to daemon attach if available.
3. **Production-capable TUI**
   - Ink-based TUI reads live snapshots from either daemon or local runtime.
   - Fallback mode remains only for missing optional dependencies.
4. **Profile-driven MCP operations**
   - Filesystem + Playwright + Desktop Commander are first-class MCP profiles.
   - Health checks, required env reporting, and Codex MCP registration helpers are exposed through CLI.
5. **Hardened bridge semantics**
   - HTTP bridge path includes timeout/retry/backoff and structured responses for both success and failure envelopes.

## Operational Result

The operator path now has a deterministic lifecycle:

- Start/attach/status/stop/restart all converge on daemon-backed state when detached mode is used.
- TUI and monitor views no longer require guessing which runtime is authoritative.
- MCP profile setup and Codex registration can be validated via a single doctor workflow.
