# Testing Strategy

## Unit Tests

- Maintain existing tests in `tests/` for legacy implementation.
- Add unit tests per bounded context package as they are introduced.
- Target high coverage for new contexts to prevent regressions.

## Integration Tests

- Validate old CLI → new API compatibility.
- Test Codex for macOS adapter with a mock Codex instance.
- Exercise cross-context workflows (Swarm → Consensus → Mesh).

## Performance Tests

- Benchmark against baseline metrics in `README.md`.
- Track agent boot time, mesh formation time, and consensus latency.
- Validate scaling targets for large agent pools.

## End-to-End Tests

- Reproduce demo scenarios (refactoring, security audit, research synthesis).
- Validate failure handling (agent crashes, network partitions, consensus failures).
