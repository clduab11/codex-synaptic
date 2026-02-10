# Codex macOS 2026 Readiness Rekick

Date: 2026-02-10
Owner: Codex-Synaptic maintainers
Scope: move from beta hardening (~60%) to internal-release-ready baseline aligned with current Codex app + Responses API ecosystem.

## Phase 1 Baseline: Current vs Target

| Area | Current (before rekick) | Target (readiness milestone) | Gap |
| --- | --- | --- | --- |
| README status + roadmap | Mixed 2025/2026 claims, stale roadmap quarters, version drift (`v2.x` claims vs `package.json` `1.0.0`) | 2026-dated status, archived 2025 roadmap notes, consistent release language | High |
| Model defaults | Mixed legacy defaults (`gpt-4o-mini`, OSS fallbacks for coding paths) | Codex-family-first defaults for coding workflows with fallback chain | High |
| API guidance | Responses API present but docs/config examples inconsistent | Responses API-first guidance everywhere for agentic coding | Medium |
| Codex macOS modes | Local/worktree/cloud flows scattered or outdated | Single practical macOS workflow doc with commands + expected outputs | High |
| Consensus reliability | Quorum can be infeasible with low coordinator count; completion condition tied to total agent count in edge path | Feasible quorum clamp + completion based on eligible voters | High |
| Autoscaler scale-down | Non-daemon runs produce noisy/unactionable retirement warnings | Guarded fallback with deferred scale-down telemetry when daemon inactive | Medium |
| Packaging/release hygiene | No preflight for folder/remote alignment and package sanity | One command preflight gate for release prep | High |

## Explicit Drift Flags (resolved by this milestone)

- Stale roadmap windows (`Q1 2025`, `Q2 2025`) existed in active README roadmap sections.
- Version narrative mismatch existed: README presented `v2.x` as current while package metadata is `1.0.0`.
- OpenAI model guidance referenced outdated Codex CLI packaging and non-Codex-first defaults for coding.

## Phase Plan and Outputs

1. Phase 1: Baseline + gap report
   - This document captures current-vs-target gaps and explicit drift flags.
2. Phase 2: Model/runtime modernization
   - Switch default coding model guidance to Codex-family (primary + fallback + deprecation-safe options).
   - Normalize routing defaults to Responses API coding models.
3. Phase 3: Codex macOS workflow alignment
   - Document Local vs Worktree vs Cloud operations for macOS.
   - Add skills/automations/MCP safe-use guidance with practical command examples.
4. Phase 4: Stability blockers
   - Consensus: guard infeasible quorum and voter-population finalization path.
   - Autoscaler: defer non-daemon scale-down gracefully with telemetry.
   - Packaging: add release preflight command for remote/folder/package checks.
5. Phase 5: Release hygiene
   - Reconcile status, roadmap, and version narrative; archive 2025 roadmap artifacts explicitly.
   - Add measurable release-readiness checklist.
6. Phase 6: Verification
   - Run lint, tests, and representative CLI smoke commands; publish results and residual risk.

## Residual Risk Policy

- Any unresolved blocker in this milestone must include:
  - explicit risk level,
  - owner handoff,
  - and a bounded follow-up action.
