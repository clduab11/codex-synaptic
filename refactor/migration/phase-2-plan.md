# Migration Plan: Phase 2 — Parallel Implementation

## Goals

- Create `/packages` monorepo structure alongside `src/`.
- Implement bounded contexts with language-agnostic APIs.
- Preserve existing CLI behavior via compatibility adapters.

## Deliverables

- Initial `/packages` layout with context READMEs.
- gRPC/REST service stubs for key contexts.
- Compatibility adapters for existing CLI commands.

## Acceptance Criteria

- New contexts compile and can run in parallel with existing code.
- Old CLI routes successfully proxy to new APIs.
