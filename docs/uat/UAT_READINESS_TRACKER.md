# UAT Readiness Tracker (Codex for macOS Integration)

## Scope

UAT readiness (not PRD) for deterministic, testable Codex for macOS launch/doctor MCP readiness flow.

Primary objectives (priority order):

- A. Reproducible `launch --strict --json` and `doctor --strict --json` behavior in a documented UAT environment
- B. UAT runbook/checklist with exact commands and pass/fail criteria
- C. CI coverage for non-MCP gates (build/test/lint/preflight)
- D. Local secret hygiene guardrails (`src/cli/.env` auto-loading path)
- E. Package publication scope hardening
- F. Dependency audit remediation/triage

## Working Rules

- Small, safe chunks only (one major subsystem at a time)
- Update this file after each chunk with: changes, verification, risks, next exact step
- Respect `AGENTS.md` / `README.md` launch gate semantics as source of truth
- Do not print secrets (especially local `.env` values)

## Chunk Plan

1. Chunk 1: Reproduce and harden MCP/launch diagnostics (no broad refactors) — `DONE`
2. Chunk 2: UAT bootstrap/runbook + acceptance checklist — `DONE`
3. Chunk 3: CI workflow for build/test/lint/preflight — `DONE`
4. Chunk 4: Secret hygiene guardrails for local `.env` loading — `DONE`
5. Chunk 5: Packaging scope hardening (`npm pack` contents)
6. Chunk 6: Dependency audit remediation/triage + risk documentation
7. Chunk 7: Full UAT smoke run + final PASS/FAIL report

## Chunk Log

### Chunk 1 — MCP/Launch Diagnostics Hardening

- Status: `PASS` (diagnostics hardening complete; UAT readiness still blocked by MCP image registry access)
- Goal: Make MCP startup failures in `launch`/`doctor` more deterministic and actionable (especially Docker/GHCR image pull/auth failures) without changing launch gate semantics.
- Notes (pre-change):
  - Verified docs/source-of-truth references in `AGENTS.md` and `README.md` for default launch gate MCP profiles.
  - Identified current weakness: `launch` collapses MCP startup failures into a generic `ensureService` error path.

#### What changed

- `src/env/service-manager.ts`
  - `ensureService()` now captures Docker Compose startup failures and wraps them with classified, actionable errors.
  - Added classification for common Docker/MCP failure modes, including registry/image pull auth denial (GHCR-style `error from registry: denied`), daemon unavailable, and missing Docker CLI.
  - Error messages now include profile name, compose command, exit status, and truncated raw Docker output for deterministic debugging.
- `src/cli/launch.ts`
  - MCP startup now tracks the specific failing profile and any previously started profiles.
  - `mcp.up` launch step now emits profile-specific failure details and metadata (`failedProfile`, `startedProfiles`).
  - `mcp.up` remediation now includes `env status <profile>` in addition to docker-login/up/register.
- `src/cli/doctor.ts`
  - Failing MCP profile checks now include `codex-synaptic env docker-login <profile>` before `env up` when the profile depends on registry-hosted images.
- Tests
  - Updated launch/doctor tests to assert the new remediation/details behavior.

#### Verification evidence

- `npx vitest run tests/cli/launch.test.ts tests/cli/doctor.test.ts tests/env/service-manager.test.ts`
  - Passed (`15/15` tests)
- `npx tsc --noEmit`
  - Passed (no output / exit 0)
- `npm run build`
  - Passed (rebuilt `dist/`)
- `node dist/cli/index.js doctor --strict --skip-codex-auth --json`
  - Expected fail (exit 1) due default MCP profiles not running/registered
  - Improvement verified: each failing default MCP check now includes `env docker-login <profile>` in remediation
- `node dist/cli/index.js launch --strict --skip-codex-auth --json`
  - Expected fail (exit 1) on `mcp.up`
  - Improvement verified: failure is now deterministic and profile-specific (`mcp-filesystem`), with classified cause `Docker image pull/auth denied...` and explicit GHCR-focused remediation
  - Launch gate semantics preserved: `ok=false`, `nextAction="stop"`, doctor not executed after strict fail-fast

#### Risks / open questions

- UAT remains blocked until the UAT environment can authenticate/pull required MCP images (at minimum `ghcr.io/context-labs/filesystem-mcp:latest`; likely also `playwright-mcp` and `desktop-commander`).
- Docker Compose warns that `version` in `docker/mcp/*.yml` is obsolete. This is non-blocking for Chunk 1 but may create noise in UAT evidence.
- `doctor` still does not proactively test registry auth; it now emits better remediation, but actual access is only proven during `env up` / `launch`.

#### Next exact step

- Chunk 2: create a UAT bootstrap/runbook + acceptance checklist with exact commands, expected JSON pass/fail fields, and explicit pre-reqs (Docker running, GHCR auth, Codex login, default MCP profile startup/register sequence).

### Chunk 2 — UAT Bootstrap Runbook + Acceptance Checklist

- Status: `PASS`
- Goal: Produce a deterministic UAT runbook/checklist for Codex for macOS launch/doctor MCP readiness using repo source-of-truth behavior.

#### What changed

- Added `/Users/chrisdukes/LocalProjects/codex-synaptic/docs/uat/CODEX_MACOS_UAT_RUNBOOK.md`
  - Exact bootstrap and readiness commands (`build`, `env plan`, `env docker-login`, `env up`, `env status`, `env codex-register`, `doctor --strict --json`, `launch --strict --json`)
  - Explicit pass/fail JSON criteria for `doctor` and `launch`
  - Deterministic fail/block conditions for UAT status
  - Failure triage paths (registry auth, registration drift, health timeout, Codex auth)
  - Operator sign-off acceptance checklist
  - Notes on secret handling and `src/cli/.env` banner hygiene

#### Verification evidence

- `rg -n "doctor --strict --json|launch --strict --json|env docker-login|mcp-filesystem|nextAction|read-only" docs/uat/CODEX_MACOS_UAT_RUNBOOK.md`
  - Passed content spot-check (required commands/criteria present)
- `npx prettier --check docs/uat/CODEX_MACOS_UAT_RUNBOOK.md docs/uat/UAT_READINESS_TRACKER.md`
  - Initial check flagged tracker formatting only (no content issue in runbook)
- `npx prettier --write docs/uat/CODEX_MACOS_UAT_RUNBOOK.md docs/uat/UAT_READINESS_TRACKER.md`
  - Applied formatting
- `npx prettier --check docs/uat/CODEX_MACOS_UAT_RUNBOOK.md docs/uat/UAT_READINESS_TRACKER.md`
  - Passed after formatting

#### Risks / open questions

- Runbook uses a fixed example evidence date (`2026-02-23`) in example paths; operators should replace with actual run date.
- UAT remains environment-blocked until GHCR credentials/image pulls succeed (tracked in Chunk 1 risks).
- The runbook intentionally documents current behavior; if CLI JSON schema changes, pass/fail criteria must be updated.

#### Next exact step

- Chunk 3: add/strengthen CI for non-MCP gates (`npm run build`, `npm test`, `npm run lint`, `npm run release:preflight`) and document the workflow outcome in this tracker.

### Chunk 3 — CI Workflow for Non-MCP Gates

- Status: `PASS`
- Goal: Add a deterministic GitHub Actions workflow for non-MCP gates (`build`, `test`, `lint`, `release:preflight`) and harden it against daemon-state test flakiness.

#### What changed

- Added `/Users/chrisdukes/LocalProjects/codex-synaptic/.github/workflows/ci-non-mcp-gates.yml`
  - Triggers: `push`, `pull_request`, `workflow_dispatch`
  - Single Ubuntu/Node 20 job with pinned `actions/checkout` and `actions/setup-node`
  - Runs `npm ci`, `npm run build`, `npm test`, `npm run lint`
  - Runs `npm run release:preflight` only on canonical repo (`clduab11/codex-synaptic`)
  - Skips preflight on non-canonical repos (forks) to avoid expected origin-fragment failures
  - Sets `CODEX_AUTO_LINK=false` to prevent CLI auto-link side effects in CI
  - Isolates `HOME` for the `npm test` step (`${{ runner.temp }}/codex-synaptic-ci-home`) to avoid stale local daemon state causing false failures on self-hosted runners

#### Verification evidence

- Workflow syntax/format:
  - `npx prettier --check .github/workflows/ci-non-mcp-gates.yml`
    - Passed
  - `node -e "…js-yaml load…"`
    - Passed (`YAML_OK`, later verified `Test` step `HOME` override present)
- Local command verification (mirroring CI gates):
  - `CODEX_AUTO_LINK=false npm run build`
    - Passed
  - `npm run lint`
    - Passed with warnings only (0 errors, 5 warnings)
  - `npm run release:preflight`
    - Expected fail in local dev branch state (dirty working tree)
    - Confirmed failure reason is local tracked/untracked changes, not script/runtime breakage
- Test stability verification:
  - `npm test`
    - Failed locally because an active background daemon in the default state directory changed CLI behavior for daemon-sensitive tests (`commands`, `openai-usage`, `cli-smoke`)
  - `HOME="$(mktemp -d)" npm test -- tests/cli/openai-usage.test.ts tests/cli/commands.test.ts tests/e2e/cli-smoke.test.ts`
    - Passed (`25/25`), confirming the `HOME` isolation mitigation
  - `HOME="$(mktemp -d)" npm test -- --reporter=dot`
    - Passed full suite (`245/245`)

#### Risks / open questions

- New workflow is validated locally (syntax + command behavior), but not yet executed in GitHub Actions within this branch.
- `release:preflight` is intentionally skipped on non-canonical repositories/forks; this reduces false failures but means forks will not enforce that gate.
- `npm test` emits noisy logs/warnings that are expected in this repo; workflow currently accepts them as long as exit code is `0`.

#### Next exact step

- Chunk 4: add secret-hygiene guardrails around local `src/cli/.env` auto-loading (especially banner behavior + safety notes) while preserving backward compatibility.

### Chunk 4 — Secret Hygiene Guardrails for Local `.env` Auto-Loading

- Status: `PASS`
- Goal: Preserve `.env` auto-loading compatibility while reducing accidental leakage risk and keeping JSON output deterministic.

#### What changed

- Added `/Users/chrisdukes/LocalProjects/codex-synaptic/src/cli/env-bootstrap.ts`
  - Extracted CLI env bootstrap logic into a testable helper module
  - Added `CODEX_CLI_ENV_AUTOLOAD=0` support to disable CLI env auto-loading
  - Added banner controls:
    - `CODEX_CLI_ENV_BANNER=0` to suppress banner
    - `CODEX_CLI_ENV_BANNER_VERBOSE=1` to show env source paths
    - JSON-mode (`--json`) banner suppression by default (override with `CODEX_CLI_ENV_BANNER_FORCE=1`)
  - Default banner is now sanitized (generic local `.env` count, no file paths) and includes a local-sensitive note when `src/cli/.env` is loaded
- Updated `/Users/chrisdukes/LocalProjects/codex-synaptic/src/cli/index.ts`
  - Uses helper module for env bootstrap and banner decisions
  - Moves env bootstrap banner output to `stderr` (not `stdout`) to avoid contaminating command output streams
- Added tests in `/Users/chrisdukes/LocalProjects/codex-synaptic/tests/cli/env-bootstrap.test.ts`
  - env parser no-override behavior
  - autoload toggle behavior
  - JSON-mode banner suppression / forced banner override
  - sanitized vs verbose banner formatting
  - bootstrap file precedence/order semantics
- Updated UAT runbook notes in `/Users/chrisdukes/LocalProjects/codex-synaptic/docs/uat/CODEX_MACOS_UAT_RUNBOOK.md`
  - documents `CODEX_CLI_ENV_AUTOLOAD=0`, stderr banner behavior, and `CODEX_CLI_ENV_BANNER_VERBOSE=1` caution

#### Verification evidence

- `npx vitest run tests/cli/env-bootstrap.test.ts`
  - Passed (`5/5`)
- `npx tsc --noEmit`
  - Passed
- `npm run build`
  - Passed
- `HOME="$(mktemp -d)" npm test -- tests/cli/commands.test.ts tests/e2e/cli-smoke.test.ts tests/cli/openai-usage.test.ts`
  - Passed (`25/25`)
- `node -e "...spawnSync doctor --skip-codex-auth --json..."`
  - Verified JSON output remains clean (`stdout` starts with `{`) and env banner is suppressed in JSON mode
- `node -e "...spawnSync system status..."` with isolated `HOME`
  - Verified env banner appears on `stderr` and not `stdout`
  - Verified `stdout` still contains expected command output (`System not started`)

#### Risks / open questions

- The new env banner hygiene note is helpful but may increase `stderr` noise for non-JSON commands when `src/cli/.env` is present.
- Existing users who relied on exact env source paths in startup banners will now need `CODEX_CLI_ENV_BANNER_VERBOSE=1`.
- Secret values are still loadable from local env files by design; this chunk reduces leakage risk and output contamination, but does not change trust requirements for local env file management.

#### Next exact step

- Chunk 5: tighten package publication scope (`files` whitelist and/or `.npmignore`), verify `npm pack --dry-run` contents, and document residual packaging risks.
