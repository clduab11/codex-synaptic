# README & AGENTS Alignment Audit (2025-10-14)

## Purpose
Assess Codex-Synaptic implementation coverage versus the commitments in `README.md` and the operational expectations set out in `AGENTS.md`. The audit highlights work that is complete, partially delivered, or missing so we can stage the next development cycles responsibly.

## Key Findings

### Delivered / In Progress
- **Reasoning planner + consensus gating** – REST/CLI support landed (`src/core/api-server.ts`, `src/core/system.ts`), matching README promises about consensus-gated reasoning.
- **Tool optimiser telemetry loops** – `/v1/tools/score` + `/v1/tools/outcome` endpoints implemented with CLI parity and new documentation (`docs/guides/adaptive-tooling.md`).
- **Runbooks & operator guidance** – Validation and telemetry runbooks published, fulfilling AGENTS directives for OpsWorker/Ops documentation.

### Gaps Requiring Attention
1. **Multi-Tenancy Isolation**
   - README implies broad enterprise readiness; AGENTS backlog references tenant managers, but no code exists under `src/tenancy/`.
   - Memory layer (`CodexMemorySystem`) stores global records with no tenant namespace or authz checks.
2. **Analytics & Dashboards**
   - Observability toolkit exports raw tool usage, but no analytics aggregation or consensus metrics surfaces described in AGENTS for AnalystWorker.
   - Grafana template lacks panels for reasoning approval latency, rejection rate, or tenant slicing.
3. **Validation Governance**
   - Consensus gating decisions are persisted but we lack policy configuration to designate which prompts must be gated (heuristic only).
   - No automation for ReviewWorker/ComplianceWorker to enforce signoffs or audit export.
4. **Operational Automation**
   - Runbooks exist but there is no CLI support for scheduled exporters or automated watchdogs as hinted in README cheat codes.
5. **Backlog Hygiene**
   - Week 3 backlog drafted, yet dependencies (database migration strategy, tenant auth model) remain unspecified and need concrete owner assignments.

### Risk Snapshot
- **Data Leakage Risk** – Without tenant scoping, future customers cannot safely co-locate workloads. This contradicts enterprise-readiness language.
- **Metrics Blind Spots** – Missing analytics hinder the AnalystWorker’s ability to prioritise hotspots, risking unmonitored gating failures.
- **Governance Drift** – Consensus heuristics may miss high-risk prompts, undermining ReviewWorker/ComplianceWorker responsibilities.

## Recommended Next Actions
1. Draft detailed multi-tenancy architecture + migration plan (see `docs/plans/week-3-backlog.md`). ✅
2. Prototype tenant-aware memory facade with feature flags for incremental rollout (initial scaffolding via `TenantManager`, resolver, schema, CLI/API stubs now landed).
3. Define analytics schema updates and extend exporter/observability template to cover reasoning+consensus KPIs.
4. Introduce configuration-driven validation policies (per prompt tag/agent type) and document escalation paths.
5. Assign agent role owners (ArchitectWorker, AnalystWorker, OpsWorker) for each major initiative with delivery checkpoints. ✅

These recommendations flow directly into the Week 3 backlog to keep README claims credible and satisfy AGENTS governance guidance.
