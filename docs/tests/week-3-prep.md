# Week 3 Test Checklist (Preparation)

Run these suites as multi-tenancy and analytics features land. Execute them in a separate terminal from the development session.

## 1. Core Regression
```bash
npm test
```
- Ensures existing Vitest coverage stays green while new tenancy/analytics code evolves.

## 2. Targeted Suites (post-implementation)
- `vitest run tests/memory --runInBand` – validates tenant-aware memory adapters once implemented.
- `vitest run tests/core/task-scheduler-quota.test.ts` – checks tenant quota enforcement during scheduling.
- `vitest run tests/api --runInBand` – re-checks REST surfaces when tenant headers/params are added.
- `vitest run tests/cli --runInBand` – covers new `codex-synaptic tenant *` commands.
- `vitest run tests/tenancy --runInBand` – exercises `TenantManager` persistence and policy handling.

## 3. Optional Load/Integration
- k6 or artillery scenario (TBD) simulating concurrent tenant traffic across planner + consensus flows.
- Manual exporter dry-run: `npm run export:metrics -- --tenant tenant-a --limit 100` (use `--tenant all` for aggregate view).
- Manual quota smoke test: `codex-synaptic tenant quota <tenantId> --max-concurrent 6 --token <admin-token>` followed by `codex-synaptic tenant quota <tenantId> --clear`.
- Manual tenant smoke test: `codex-synaptic tenant create --name Example --id example --token <admin-token> && codex-synaptic tenant list --token <admin-token>`.

Document results in `docs/reports/test-execution.md` (to be created) for Sprint 3 readiness.
