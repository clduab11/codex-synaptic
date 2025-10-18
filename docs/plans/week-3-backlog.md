# Week 3 Backlog – Multi-Tenancy & Analytics Expansion

## Objectives
- Introduce foundational multi-tenancy controls so Codex-Synaptic can isolate customer workloads.
- Expand analytics coverage across reasoning planner + validation gating to validate production readiness.
- Prepare integration tests/fixtures that combine planner, consensus, and observability layers.

## Primary Workstreams
1. **Multi-Tenancy Foundations**
   - Design tenant-aware schemas for memory/telemetry tables (namespacing, retention policies).
   - Extend agent registry + scheduler to accept tenant context on task submission.
   - Ensure REST + CLI surfaces accept `--tenant`/`X-Codex-Tenant` headers with validation.
   - Add AuthN/AuthZ hooks for tenant scoping; update admin CLI to manage tenant lifecycle.

2. **Analytics & Dashboards**
   - Instrument reasoning plan lifecycle metrics (approval latency, rejection rate, checkpoint cadence).
   - Add exporter transformations for tenant-scoped metrics; refresh Grafana template with new panels.
   - Build scorecards that combine tool optimiser outcomes + consensus decisions for executive reporting.

3. **Validation & Testing**
   - Draft integration tests covering gated plans under heavy load (Vitest suite or k6 scenario).
   - Define acceptance criteria for multi-tenant isolation (no cross-tenant data leakage, scoped queries).
   - Capture success metrics and alarms in runbooks (update telemetry + validation runbooks accordingly).

## Dependencies & Research
- Assess memory database migration impact (SQLite namespaces vs. external store like Postgres).
- Coordinate with SecurityWorker/ComplianceWorker owners on tenant isolation requirements.
- Review infrastructure capacity for additional observability data volume.

## Deliverables
- Design notes + schema migration plan under `docs/architecture/multi-tenancy.md` (draft).
- Updated CLI/API specs documenting tenant flags + analytics endpoints (initial scaffolding committed).
- New dashboard/exporter snapshots demonstrating tenant-scoped analytics.
- Acceptance test checklist published to `tests/README.md`.
- Stakeholder brief circulated (`docs/reports/week3-stakeholder-brief.md`).

## Agent Role Owners & Coordination
- **ArchitectWorker**: Drive multi-tenancy schema design + migration sequencing.
- **SecurityWorker / ComplianceWorker**: Validate isolation controls, define tenant policy templates, oversee audit hooks.
- **AnalystWorker**: Shape analytics KPIs (approval latency, rejection density, tenant activity) and dashboard requirements.
- **OpsWorker**: Operationalize exporter automation, ensure runbooks cover tenant-aware alerts.
- **PlanningWorker**: Maintain dependency map and coordinate delivery cadence with Sprint ceremonies.
- **ReviewWorker**: Establish quality gates for tenant-aware code paths and analytics diffs.
- **AutomationWorker**: Script exporter scheduling and validation policy rollouts once designs land.

## Open Questions
- Do we introduce tenant-specific consensus pools or reuse global quorum?
- Is Qdrant/Redis vector store required for tenant isolation in Week 3 or deferred?
- Which marketplace integrations depend on analytics rollup (partner team alignment needed)?
