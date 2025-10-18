# Multi-Tenancy Architecture Draft

_Status: Draft (2025-10-14)_

## Goals
- Provide hard tenant isolation for memory, telemetry, and scheduler workloads.
- Ensure every API/CLI surface can operate within a tenant context.
- Preserve backwards compatibility for single-tenant deployments via feature flags.

## Requirements
1. **Identity & Auth**
   - Extend authentication middleware to issue tenant-scoped sessions.
   - Support `X-Codex-Tenant` header and CLI `--tenant` flag with role-based validation.
2. **Storage Isolation**
   - Introduce tenant-aware namespaces in SQLite (separate tables or attached databases).
   - Ensure vector memory and future external stores (Qdrant/Redis/Postgres) respect tenant scope.
3. **Scheduler & Agents**
   - Propagate tenant context across `TaskScheduler`, `AgentRegistry`, and worker payloads.
   - Enforce resource quotas per tenant (CPU, memory, concurrency) via `ResourceManager`.
4. **Telemetry & Analytics**
   - Tag all telemetry events (`tool_usage`, `reasoning_runs`, `consensus_events`) with tenant metadata.
   - Expose analytics APIs for tenant-level dashboards.
5. **Governance & Auditing**
   - Maintain audit logs for tenant lifecycle operations.
   - Ensure consensus decisions record tenant scope to prevent cross-tenant quorum blending.

## High-Level Architecture
```
CLI/API Request
   │
   ├─ Auth Middleware ──► TenantResolver
   │                       ├─ validates identity
   │                       ├─ loads tenant policy
   │                       └─ emits TenantContext { id, quotas, capabilities }
   │
   ├─ Service Layer (Scheduler, Memory, ReasoningPlanner, ToolOptimizer)
   │       └─ receives TenantContext and enforces scoped reads/writes
   │
   └─ Persistence (SQLite / Vector / Telemetry sinks)
           └─ Tables keyed by tenant_id or isolated schema
```

## Data Model Proposal
- `tenants` table: `id`, `name`, `status`, `created_at`, `updated_at`, `metadata`.
- `tenant_policies`: gating/approval requirements, quota configs.
- Update existing tables with `tenant_id` (indexed). For high-write tables consider partitioning per tenant.
- Provide migration scripts under `scripts/migrations/` with feature flag `TENANCY_ENABLED`.

## Quota Configuration
- Baseline quotas are defined in `config/system.json` under `tenancy.defaultQuota` (e.g., `maxConcurrentTasks`).
- During system boot `TenantManager.configureDefaultQuota` registers these limits with `ResourceManager` and backfills any tenants without explicit policies.
- Operators can override quotas per tenant via CLI/API and remove overrides (setting the policy quota to `null`) to fall back to the configured defaults.

## API & CLI Surfaces
- REST: `POST /v1/tenants`, `GET /v1/tenants/:id`, `POST /v1/tenants/:id/policies`, with authentication guards.
- REST quotas: `GET /v1/tenants/:id/quota` to inspect effective quotas; `POST /v1/tenants/:id/quota` to set or clear overrides (null payload reverts to defaults).
- CLI: `codex-synaptic tenant create|list|quota|audit`; `tenant quota` accepts `--max-concurrent`, `--cpu`, `--memory`, or `--clear` to manage overrides safely.
- Existing endpoints accept `tenantId` query/header; respond with `400` if tenancy enforced and missing.

## Scheduler Integration
- Extend `TaskRequest` with `tenantId`.
- Update `TaskScheduler.submitTask` to read quotas from `TenantQuotaManager` (new component).
- Agents receive `context.tenantId` so custom logic can respect tenant boundaries.

## Telemetry & Analytics
- `CodexMemorySystem` persists telemetry with `tenant_id` and payload `tenantId` annotations so exporters can disambiguate tenants.
- Exporter (`scripts/observability/exporter.ts`) now accepts `--tenant all|<id>` to emit global or tenant-scoped metrics.
- Prometheus metrics expose `tenant` labels for tool usage, reasoning runs, and consensus events to unlock per-tenant dashboards.
- Grafana template includes tenant usage/status panels to visualise quota impact prior to enforcement.

## Rollout Strategy
1. **Phase 0 (Now)** – Design docs, tenant schema draft, feature flag scaffolding.
2. **Phase 1** – Implement tenant registry & CLI, optional flag off by default.
3. **Phase 2** – Migrate memory + telemetry writes/read to include tenant context. Provide dual-write if needed.
4. **Phase 3** – Enforce tenant context in scheduler/agent runtime. Add quota enforcement & tests.
5. **Phase 4** – Enable tenancy by default in staging. Run load tests and security review before production.

## Current Implementation Snapshot (2025-10-14)
- Feature flag: `CODEX_TENANCY_ENABLED=1` toggles tenant-aware memory schema and resolver wiring.
- Tenant registry: `TenantManager` persists tenants/policies via `CodexMemorySystem` namespaces.
- API: `/v1/tenants` supports basic list/create operations protected by Bearer authorization.
- CLI: `codex-synaptic tenant list|create|show` surfaces registry state for operators.
- Reasoning planner & tool optimiser propagate optional `tenantId` context into persistence.

## Testing Plan
- Unit tests for `TenantResolver` and memory adapter matching tenant scoping.
- Integration tests: submit tasks from multiple tenants and verify isolation (Vitest or e2e harness).
- Load tests: ensure scheduler respects quotas under concurrency.
- Security tests: attempt cross-tenant access, expect `403`.

## Open Questions
- Should we switch from SQLite to an external RDBMS for multi-tenant scaling?
- How do we manage tenant-signed consensus proposals (separate RAFT groups vs. shared with metadata)?
- Do we encrypt per-tenant data at rest (envelope keys) in the initial milestone?

## Next Steps
- Finalise schema changes and add migration scripts.
- Implement `TenantResolver` stub and wire feature flag plumbing.
- Update Week 3 backlog status once Phase 0 artifacts are approved.
