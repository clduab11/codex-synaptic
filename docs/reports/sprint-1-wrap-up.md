# Sprint 1 Wrap-Up – Instruction Graphs & Routing

## Scope & Goals
- Implement recursive AGENTS.md discovery with precedence-driven aggregation.
- Surface instruction validation and caching via the Codex-Synaptic CLI.
- Seed persona-aware routing policies that use the instruction context.

## Delivered Capabilities
- **Instruction Parser v1.0** – Precedence ordering (global → project → local → override), SQLite caching, structural validation (`src/instructions/parser.ts`).
- **CLI Integration** – `codex-synaptic instructions sync|validate|cache` commands with cache status visibility and scoped operations (`src/cli/index.ts`).
- **Routing Baseline** – Default policy set and evaluation APIs validated by Vitest suites (`src/router/router.ts`, `tests/router/router.test.ts`).
- **Documentation** – Operator guide for instruction commands and README quick-start updates (`docs/cli/instructions.md`, `README.md`).

## Acceptance Evidence
- `npm test -- tests/instructions/parser.test.ts tests/router/router.test.ts`
  - Covers cache behaviour, precedence ordering, validation errors, and routing decision logic.
- Manual verification of CLI commands against the developer sandbox (cache reporting, scoped clears).

## Telemetry & Artifacts
- Instruction cache persisted under `.codex-synaptic/instructions.db` with structured status reporting.
- Default routing policies stored in `config/routing/policies.json`; CLI shows applied rules and evaluation history.
- Cheat code and observability docs remain unchanged but reference new instruction workflows.

## Known Gaps & Follow-Ups
- Cache TTL is static (1 hour); sprint 2 backlog will externalise configuration.
- Instruction validation focuses on markdown structure; semantic checks (e.g., missing sections) deferred.
- Routing service currently files history locally; needs integration with memory namespaces for cross-session analytics.

## Exit Criteria Met
- Instruction graph ingestion and caching complete with CLI entry points.
- Routing baseline operational with deterministic tests.
- Operators briefed via documentation updates.

## Ready for Sprint 2
- Instruction context and routing artefacts now feed adaptive tooling initiatives.
- No blocking defects outstanding; proceed to adaptive tool optimisation workstreams.
