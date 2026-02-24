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

- Added `docs/uat/CODEX_MACOS_UAT_RUNBOOK.md`
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

- Added `.github/workflows/ci-non-mcp-gates.yml`
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

- Added `src/cli/env-bootstrap.ts`
  - Extracted CLI env bootstrap logic into a testable helper module
  - Added `CODEX_CLI_ENV_AUTOLOAD=0` support to disable CLI env auto-loading
  - Added banner controls:
    - `CODEX_CLI_ENV_BANNER=0` to suppress banner
    - `CODEX_CLI_ENV_BANNER_VERBOSE=1` to show env source paths
    - JSON-mode (`--json`) banner suppression by default (override with `CODEX_CLI_ENV_BANNER_FORCE=1`)
  - Default banner is now sanitized (generic local `.env` count, no file paths) and includes a local-sensitive note when `src/cli/.env` is loaded
- Updated `src/cli/index.ts`
  - Uses helper module for env bootstrap and banner decisions
  - Moves env bootstrap banner output to `stderr` (not `stdout`) to avoid contaminating command output streams
- Added tests in `tests/cli/env-bootstrap.test.ts`
  - env parser no-override behavior
  - autoload toggle behavior
  - JSON-mode banner suppression / forced banner override
  - sanitized vs verbose banner formatting
  - bootstrap file precedence/order semantics
- Updated UAT runbook notes in `docs/uat/CODEX_MACOS_UAT_RUNBOOK.md`
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

### Chunk 5 — Packaging Scope Hardening (`npm pack` contents)

- Status: `PASS`
- Goal: Reduce published npm tarball scope to an intentional runtime surface for the CLI without breaking launch/doctor MCP packaging expectations.

#### What changed

- Updated `package.json`
  - Added a `files` whitelist to explicitly control package contents instead of relying on `.gitignore` fallback behavior.
  - Kept compiled/runtime assets and key metadata:
    - `dist/`
    - `docker/` (required by `env`/`launch`/`doctor` service profiles via `docker/mcp/*.yml` compose paths)
    - `config/` (runtime config/strategy/GOAP manifests under repo root)
    - `.env.example`, `README.md`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`
    - `docs/codex-synaptic-cheat-codes.md` (used by `cheats sync`)
    - `.codex-improvement/SCHEMA_MASTER.yaml` (runtime schema dependency in YAML tooling)

#### Verification evidence

- Runtime packaging dependency inspection
  - Reviewed `package.json` (`main`, `bin`, scripts) and runtime path usage in `src/env/service-manager.ts` and CLI code.
  - Confirmed `env`/`launch`/`doctor` use compose files under `docker/mcp/*.yml`, so `docker/` must remain in package scope.
- Pack contents before hardening:
  - `npm pack --dry-run --json` (pre-change)
  - Result: `561` entries, `unpackedSize=3131266`, `packageSize=751486`
  - Included many non-runtime/dev artifacts (`src/`, `tests/`, `.github/`, `python/`, `refactor/`, hidden local metadata, etc.)
- Pack contents after hardening:
  - `CODEX_AUTO_LINK=false npm pack --dry-run --json`
  - Result: `285` entries, `unpackedSize=1397812`, `packageSize=319389`
  - Package now limited to `dist/`, `docker/`, `config/`, selected docs/metadata, and `package.json`
  - Improvement delta:
    - entries: `561 -> 285` (reduced by `276`)
    - unpacked size: `3131266 -> 1397812` bytes
    - tarball size: `751486 -> 319389` bytes
- Build verification (explicit per UAT chunk guidance):
  - `CODEX_AUTO_LINK=false npm run build`
    - Passed
- CLI smoke sanity:
  - `node dist/cli/index.js --help`
    - Passed (help output rendered; env banner on stderr is expected behavior from Chunk 4)

#### Risks / open questions

- This chunk validates pack scope and local CLI execution, but does **not** run an install-from-tarball smoke test (e.g. `npm pack` + temp install) yet.
- `docs/README.md` is still included alongside `docs/codex-synaptic-cheat-codes.md` due npm file inclusion behavior for the `docs/` subtree; this is acceptable but slightly broader than the single-file intent.
- Further scope reduction is possible (for example narrowing `config/` to only runtime-required subsets), but that increases risk of breaking non-launch CLI features and is not necessary for UAT readiness.

#### Next exact step

- Chunk 6: run dependency audit (`npm audit --omit=dev --audit-level=high`), triage/remediate safe upgrades, and document any residual high-severity risk with package/transitive-chain context.

### Chunk 6 — Dependency Audit Remediation / Triage

- Status: `PASS` (partial remediation applied; remaining production highs triaged and documented)
- Goal: Reduce/triage high-severity production dependency findings with minimal behavior risk, then rerun impacted gates.

#### What changed

- Updated direct dependencies in `package.json`
  - `@openai/agents`: `^0.1.10 -> ^0.1.11` (safe patch upgrade)
  - `js-yaml`: `^4.1.0 -> ^4.1.1` (safe patch upgrade; resolves direct moderate advisory)
- Updated `package-lock.json`
  - Pulled patched transitive chain under `@openai/agents`, including:
    - `@modelcontextprotocol/sdk@1.27.0`
    - `express@5.2.1`
    - `body-parser@2.2.2`
    - `qs@6.15.0`

#### Verification evidence

- Initial production audit:
  - `npm audit --omit=dev --audit-level=high --json`
  - Result (before remediation): `11 high`, `3 moderate`, `14 total`
  - High findings included:
    - `@modelcontextprotocol/sdk` (transitive)
    - `qs` / `body-parser` (transitive)
    - `sqlite3` + `node-gyp`/`tar` chain
  - Moderate finding included direct `js-yaml@4.1.0`
- Dependency path verification (before remediation):
  - `npm ls @modelcontextprotocol/sdk @openai/agents qs body-parser js-yaml --all`
  - Confirmed chain:
    - `@openai/agents@0.1.10 -> @openai/agents-core@0.1.10 -> @modelcontextprotocol/sdk@1.20.1 -> express@5.1.0 -> body-parser@2.2.0 / qs@6.14.0`
    - direct `js-yaml@4.1.0`
  - `npm ls sqlite3 node-gyp tar cacache make-fetch-happen glob rimraf minimatch --all`
    - Confirmed remaining high-severity chain roots under `sqlite3@5.1.7`
- Outdated review (for safe upgrade candidates):
  - `npm outdated --json`
  - Confirmed patch updates available for `@openai/agents` and `js-yaml`; no obvious newer `sqlite3` target surfaced
- Applied safe upgrades:
  - `CODEX_AUTO_LINK=false npm install @openai/agents@0.1.11 js-yaml@4.1.1`
    - Passed
- Post-remediation production audit:
  - `npm audit --omit=dev --audit-level=high --json`
  - Result (after remediation): `9 high`, `0 moderate`, `9 total`
  - Cleared findings:
    - `@modelcontextprotocol/sdk` high advisories
    - `qs` high advisory
    - `body-parser` moderate advisory
    - direct `js-yaml` moderate advisory
- Post-remediation dependency path verification:
  - `npm ls @openai/agents @modelcontextprotocol/sdk express body-parser qs js-yaml --all`
  - Verified patched chain:
    - `@openai/agents@0.1.11 -> @openai/agents-core@0.1.11 -> @modelcontextprotocol/sdk@1.27.0 -> express@5.2.1 -> body-parser@2.2.2 / qs@6.15.0`
    - direct `js-yaml@4.1.1`
- Required post-change gates:
  - `CODEX_AUTO_LINK=false npm run build`
    - Passed
  - `npm run lint`
    - Passed with existing warnings only (`0 errors`, `5 warnings`)
  - `HOME="$(mktemp -d)" npm test -- --reporter=dot`
    - Passed (`41` files, `250` tests)

#### Residual risk (deferred, documented)

- Remaining production highs are all tied to the `sqlite3` dependency install toolchain:
  - Direct/root:
    - `sqlite3@5.1.7` (reported high via `node-gyp` and `tar`)
  - Transitive chain under `sqlite3`:
    - `node-gyp@8.4.1`
    - `tar@6.2.1`
    - `make-fetch-happen@9.1.0 -> cacache@15.3.0`
    - `glob@7.2.3 -> minimatch@3.1.2`
    - `rimraf@3.0.2`
    - `@npmcli/move-file@1.1.2`
- Severity:
  - `high` (9 remaining findings in production audit), but all within the `sqlite3`/native-install dependency path
- Exploitability/context in this repo:
  - Primarily impacts package installation / native rebuild flows (`npm install`, `node-gyp`, tar extraction), not the normal runtime execution path for `launch`, `doctor`, or MCP readiness checks.
  - Some `tar` advisories are most relevant when extracting attacker-controlled archives (and at least one is especially relevant on macOS/APFS), which raises operator workstation risk during dependency installation but not during routine CLI command execution after install.
- Why deferred:
  - `npm audit` only reports a non-viable auto-fix path via `sqlite3@5.0.2` (`isSemVerMajor=true`, and also a downgrade relative to current `5.1.7`), which is not a safe UAT remediation.
  - No straightforward non-breaking `sqlite3` upgrade path is indicated by `npm outdated --json` in the current dependency graph.
  - Replacing `sqlite3` or refactoring storage backends is out of scope for this UAT chunk and carries higher regression risk.
- Follow-up recommendation:
  - Track upstream `sqlite3`/`node-gyp` remediation availability and re-run audit on each lockfile refresh.
  - For PRD hardening, evaluate a migration path away from `sqlite3` (or a maintained fork/path with patched install toolchain) and/or vendor strategy that avoids the vulnerable install chain.
  - In CI/UAT environments, keep dependency installation restricted to trusted registries and avoid ad-hoc installs from untrusted sources/archives.

#### Next exact step

- Chunk 7: execute the full UAT smoke from `docs/uat/CODEX_MACOS_UAT_RUNBOOK.md`, capture dated evidence artifacts, and produce a final UAT PASS/FAIL/BLOCKED report (likely `BLOCKED` if GHCR auth remains unavailable).

### Chunk 7 — Full UAT Smoke + Final Report

- Status: `BLOCKED` (environment blocker confirmed: GHCR image pull/auth); additional `launch --strict --json` stdout contamination issue discovered
- Goal: Execute the runbook smoke path end-to-end, capture evidence under a dated folder, and produce final UAT PASS/FAIL/BLOCKED determination.

#### What changed

- Captured UAT smoke evidence under `docs/uat/evidence/2026-02-24/`
  - Includes step command/output/exit artifacts, `doctor.strict.json`, `launch.strict.json`, `codex.mcp.list.json`, and status matrix `_status.tsv`
- Added final UAT report:
  - `docs/uat/UAT_FINAL_REPORT.md`
- Secret hygiene remediation during evidence capture:
  - Redacted 1 secret-like value in `codex.mcp.list.json` (`bearer_token_env_var` field contained a token-looking value for an unrelated MCP entry)
  - Original secret value was not copied into tracker/report/chat
- Added helper artifacts (without modifying original launch evidence semantics):
  - `launch.strict.payload.json` (JSON payload extracted from first `{`)
  - `launch.strict.stdout-prefix.txt` (captured non-JSON stdout prefix line)

#### Verification evidence

- Full smoke path executed (runbook-aligned; build used `CODEX_AUTO_LINK=false` to avoid local CLI auto-link side effects)
  - `CODEX_AUTO_LINK=false npm run build` → pass
  - `codex --help` / `codex mcp --help` / `codex mcp add --help` → pass
  - `codex login status` → pass (`Logged in using ChatGPT`)
  - `node dist/cli/index.js env plan mcp-filesystem mcp-playwright mcp-desktop-commander` → pass
    - verified all 3 default profiles and `mcp-filesystem` read-only default note
  - `node dist/cli/index.js env docker-login ...` → fail (non-TTY interactive login)
    - observed `error: cannot perform an interactive login from a non-TTY device`
  - `node dist/cli/index.js env up ...` → fail (expected environment blocker)
    - deterministic classified error for `mcp-filesystem`:
      - GHCR image pull/auth denied for `ghcr.io/context-labs/filesystem-mcp:latest`
  - `node dist/cli/index.js env status ...` → pass
    - all 3 profiles reported `running: no`, `healthy: no` (expected after failed `env up`)
  - `node dist/cli/index.js env codex-register ... --replace` → pass
  - `codex mcp list --json` → pass
    - required names present: `filesystem-local`, `playwright-local`, `desktop-commander`
  - `node dist/cli/index.js doctor --strict --json` → fail (expected due MCP profiles down)
    - valid JSON output
    - summary: `passed=4 failed=3 total=7`
    - failed checks were the 3 default MCP profiles only
  - `node dist/cli/index.js launch --strict --json` → fail (expected due `mcp.up` blocker)
    - payload indicates `ok=false`, `nextAction=\"stop\"`, failed step `mcp.up`, failed profile `mcp-filesystem`
    - **new issue:** stdout contained a logger line before JSON, making `launch.strict.json` invalid JSON unless post-processed

#### Risks / open questions

- **Primary blocker (environment):** UAT cannot pass until GHCR auth/image pull access is available for default MCP profile images.
- **Secondary blocker/risk (code):** `launch --strict --json` stdout contamination breaks machine-parseable JSON artifacts in this failure path (and may affect success paths if env/service logs continue to emit on stdout).
- Docker Compose warning remains noisy (non-blocking but present in evidence):
  - `version` attribute obsolete in `docker/mcp/*.yml`
- Residual dependency audit risk from Chunk 6 remains deferred:
  - `sqlite3` / `node-gyp` / `tar` install-toolchain high findings (install-time risk, not normal runtime launch path)

#### Next exact step

- Unblock + rerun:
  1. Perform interactive `docker login ghcr.io` (or configure Docker credential helper) with access to required MCP images.
  2. Fix `launch --strict --json` stdout purity (logger output should not precede JSON on stdout).
  3. Re-run Chunk 7 smoke (runbook steps 4-9 minimum, preferably full run) with a fresh dated evidence folder and update `docs/uat/UAT_FINAL_REPORT.md`.

### Chunk 7 Follow-up A — GHCR Access Recheck (Post Interactive Login)

- Status: `BLOCKED` (registry/image availability still blocking default MCP startup, but auth posture changed)
- Goal: Re-check required GHCR image pull access after operator completed interactive `docker login ghcr.io`.

#### What changed

- Verified post-login behavior for the 3 default MCP image references used by UAT launch profiles.
- Failure mode changed from registry auth `denied` to image reference resolution `not found`, indicating the host is no longer failing at the same unauthenticated registry gate.

#### Verification evidence

- `docker pull ghcr.io/context-labs/filesystem-mcp:latest`
  - Exit `1`; `failed to resolve reference ... : not found`
- `docker pull ghcr.io/context-labs/playwright-mcp:latest`
  - Exit `1`; `failed to resolve reference ... : not found`
- `docker pull ghcr.io/wonderwhy-er/desktop-commander:latest`
  - Exit `1`; `failed to resolve reference ... : not found`

#### Risks / open questions

- UAT remains environment-blocked because default MCP image references still cannot be pulled.
- Root cause is now likely one of:
  - image/tag no longer exists (`latest` tag drift),
  - repository path drift, or
  - access masking as `not found` for the logged-in principal.
- This is separate from the code-level `launch --strict --json` stdout contamination issue and should be reported independently.

#### Next exact step

- Fix `launch --strict --json` stdout purity so JSON artifacts are machine-parseable regardless of environment failure, then run targeted verification and proceed to a fresh Chunk 7 smoke re-run (expected verdict may remain `BLOCKED` if image references stay unresolved).

### Chunk 7 Follow-up B — `launch --json` Stdout Purity Fix

- Status: `PASS` (code fix + targeted verification complete; environment blockers still separate)
- Goal: Ensure `launch --json` / `launch --strict --json` emits JSON-only on stdout in failure paths (and preserve pass-path safety via test coverage) without weakening diagnostics.

#### What changed

- Updated `src/cli/launch.ts`
  - Added an internal launch option (`suppressInfoConsoleLogs`) and a scoped helper that temporarily raises logger console threshold to `WARN` while MCP services are started.
  - This suppresses info-level `Logger` console output (for example `Starting service mcp-filesystem`) during JSON launch execution while preserving warnings/errors to stderr and retaining file logging.
- Updated `src/cli/index.ts`
  - `launch` command now enables the scoped suppression automatically when `--json` is used.
- Updated `tests/cli/launch.test.ts`
  - Added a targeted regression test that simulates an info-level logger emission during MCP startup and asserts no `console.info` leakage when JSON-safe suppression is enabled.

#### Verification evidence

- Reproduced pre-fix behavior (before rebuilding `dist`):
  - `node -e "...spawnSync('node',['dist/cli/index.js','launch','--strict','--skip-codex-auth','--json'])..."`
  - Confirmed `stdoutStartsWithBrace=false`
  - First stdout line was the logger prefix (`INFO [env] Starting service mcp-filesystem ...`)
- Required build verification:
  - `CODEX_AUTO_LINK=false npm run build`
  - Passed
- Targeted tests:
  - `HOME="$(mktemp -d)" npm test -- tests/cli/launch.test.ts`
  - Passed (`5/5`)
- Runtime verification on rebuilt CLI (expected launch failure due MCP image issue, but stdout JSON must remain clean):
  - `node -e "...spawnSync('node',['dist/cli/index.js','launch','--json','--skip-codex-auth'])..."`
    - Exit `1` (expected), `stdout` parseable JSON, first stdout line `{`
  - `node -e "...spawnSync('node',['dist/cli/index.js','launch','--strict','--json','--skip-codex-auth'])..."`
    - Exit `1` (expected), `stdout` parseable JSON, first stdout line `{`

#### Risks / open questions

- The fix suppresses only info-level logger console output during MCP startup in JSON launch mode; this is intentionally narrow to avoid broader CLI logging changes.
- If future launch steps emit direct `console.log` output before JSON, additional targeted hardening may be required (current targeted runtime verification did not observe this).

#### Next exact step

- Re-run the full Chunk 7 UAT smoke with a fresh dated evidence folder, capture artifacts per runbook, then refresh the final UAT report + tracker verdict using the new GHCR `not found` evidence and the fixed launch JSON output contract.

### Chunk 7 Follow-up C — Full UAT Smoke Rerun + Report Refresh

- Status: `BLOCKED` (final blocker is now image reference availability, not launch JSON stdout contamination)
- Goal: Re-run the full Chunk 7 smoke with fresh evidence after GHCR login + launch JSON fix, then refresh the final report/tracker verdict.

#### What changed

- Captured a fresh rerun evidence set under `docs/uat/evidence/2026-02-24-rerun-1/`
  - Reproduced the full runbook step set (`01-13`) with command/output/exit artifacts and JSON outputs.
- Added explicit post-login GHCR pull verification artifacts in the same evidence folder:
  - `00a-ghcr-pull-filesystem.*`
  - `00b-ghcr-pull-playwright.*`
  - `00c-ghcr-pull-desktop-commander.*`
- Refreshed `docs/uat/UAT_FINAL_REPORT.md`
  - Updated verdict remains `BLOCKED`
  - `env docker-login` now recorded as `PASS`
  - primary blocker updated to image `not found`
  - launch JSON stdout contamination marked resolved in rerun evidence
- Secret hygiene:
  - Redacted 1 secret-like value in rerun `codex.mcp.list.json`
  - Added redaction note file `11-codex-mcp-list.redaction.txt`

#### Verification evidence

- Full runbook smoke (rerun):
  - `CODEX_AUTO_LINK=false npm run build` → pass
  - `codex --help` / `codex mcp --help` / `codex mcp add --help` → pass
  - `codex login status` → pass
  - `node dist/cli/index.js env plan ...` → pass
  - `node dist/cli/index.js env docker-login ...` → pass (`Login Succeeded`, reused existing GHCR credentials)
  - `node dist/cli/index.js env up ...` → fail/block (`filesystem-mcp:latest` `not found`)
  - `node dist/cli/index.js env status ...` → pass (profiles not running/not healthy after failed startup)
  - `node dist/cli/index.js env codex-register ... --replace` → pass
  - `codex mcp list --json` → pass (artifact redacted)
  - `node dist/cli/index.js doctor --strict --json` → fail/block (3 MCP checks only)
  - `node dist/cli/index.js launch --strict --json` → fail/block (`mcp.up` / `mcp-filesystem`)
- Launch JSON output contract (rerun evidence):
  - `doctor.strict.json` and `launch.strict.json` both parseable JSON
  - `launch.strict.json` no longer requires payload extraction from a prefixed stdout line
- Direct GHCR pull verification (rerun evidence extras):
  - all 3 `docker pull` commands return `not found`

#### Risks / open questions

- UAT remains blocked until the correct/pullable image references (path/tag) for the default MCP profiles are confirmed and updated (if drifted).
- `env docker-login` is interactive by design but passed in the rerun by reusing existing cached credentials; future automation captures may still need a TTY depending on Docker credential state.
- Docker Compose `version` deprecation warnings remain noisy but non-blocking.

#### Next exact step

- Determine the current canonical image references/tags for `mcp-filesystem`, `mcp-playwright`, and `mcp-desktop-commander`; update compose profiles/docs if needed; then rerun Chunk 7 and target final UAT `PASS`.

### Chunk 7 Follow-up D — Canonical Image Investigation + Playwright Profile Patch

- Status: `PASS` (investigation complete; safe Playwright migration patched and verified). UAT remains `BLOCKED` by filesystem/desktop commander transport compatibility.
- Goal: Identify current canonical container images/tags for the default MCP profiles and patch compose/runbook where a drop-in migration is safe.

#### What changed

- Updated `src/env/service-manager.ts`
  - `mcp-playwright` image reference changed from legacy GHCR wrapper to canonical Docker Hub MCP image:
    - `ghcr.io/context-labs/playwright-mcp:latest` -> `mcp/playwright:latest`
- Updated `docker/mcp/docker-compose.playwright.yml`
  - Image changed to `mcp/playwright:latest`
  - Added `--host 0.0.0.0` to the container command so the HTTP/SSE server binds to the container interface (required for compose port publishing)
- Updated `docs/uat/CODEX_MACOS_UAT_RUNBOOK.md`
  - Added a dated upstream image migration note documenting current canonical images and the transport compatibility constraint
  - Updated Docker-login step guidance to distinguish private registry auth from public Docker Hub `mcp/*` images
  - Added `not found` as a first-class image drift/deprecation blocker indicator
  - Refreshed `Last updated` date

#### Investigation findings (source-backed)

- Legacy wrapper GHCR repos used by this repo are gone (registry `404`, not tag drift):
  - `context-labs/filesystem-mcp`
  - `context-labs/playwright-mcp`
  - `wonderwhy-er/desktop-commander`
  - Confirmed via authenticated GHCR registry API (`/v2/.../tags/list`) using local Docker credentials (token acquisition succeeded; repo lookup returned `404`)
- Current canonical images discovered and verified:
  - `mcp/playwright:latest` (Docker Hub MCP image; matches official Playwright MCP Docker CLI behavior and supports `--port` / `--host`)
  - `mcp/filesystem:latest` (Docker Hub MCP image; stdio-oriented, not HTTP/`--port` compatible)
  - `mcp/desktop-commander:latest` (Docker Hub image; stdio-oriented, does not accept `--port`)
- Additional source confirmation:
  - `microsoft/playwright-mcp` README documents Docker image usage and `--port`/`--host`
  - `modelcontextprotocol/servers` filesystem README documents `mcp/filesystem` Docker usage (stdio command form)
  - `wonderwhy-er/DesktopCommanderMCP` README documents `mcp/desktop-commander:latest` Docker usage (stdio command form)

#### Verification evidence

- Registry/image existence + capability checks
  - `docker pull mcp/playwright:latest` → pass
  - `docker run --rm mcp/playwright:latest cli.js --help` → pass; confirms `--port` and `--host` options
  - `docker pull mcp/filesystem:latest` → pass
  - `docker run --rm mcp/filesystem:latest --port 7040 /projects` → fail as expected (`--port` treated as path arg / stdio-oriented image)
  - `docker pull mcp/desktop-commander:latest` → pass
  - `docker run --rm mcp/desktop-commander:latest --port 7070` → fail as expected (`node: bad option: --port`)
- GHCR wrapper repo verification (post-login, authenticated GHCR API)
  - GHCR token acquisition succeeded for each legacy repo scope
  - `GET /v2/<repo>/tags/list` returned `404` for the legacy wrapper repos (repo no longer present)
- Playwright profile patch verification (rebuilt CLI)
  - `CODEX_AUTO_LINK=false npm run build` → pass
  - `node dist/cli/index.js env docker-login mcp-playwright` → pass (`No registry authentication required for profiles: mcp-playwright`)
  - `node dist/cli/index.js env up mcp-playwright` → pass
  - `node dist/cli/index.js env status mcp-playwright` → pass (`running: yes`, `healthy: yes`)
  - `docker compose -f docker/mcp/docker-compose.playwright.yml down` → pass (cleanup)

#### Risks / open questions

- `mcp-filesystem` and `mcp-desktop-commander` canonical Docker images are not compatible with the current launch-gate architecture because the repo expects HTTP MCP endpoints and these images are stdio-only.
- UAT remains blocked until one of the following is implemented:
  - replacement HTTP-capable wrapper images for filesystem + desktop commander, or
  - a repo-level redesign of default profile startup/registration to support stdio MCP registration (instead of `codex mcp add --url`)
- `docker/mcp/docker-compose.*.yml` files still emit Compose `version` deprecation warnings (non-blocking noise).

#### Next exact step

- Choose the unblock strategy for `mcp-filesystem` and `mcp-desktop-commander`:
  1. find/validate replacement HTTP wrapper images with `--port` support, or
  2. redesign default MCP profile registration/startup to use stdio transport for canonical Docker images;
  then rerun Chunk 7 UAT smoke and refresh the final report.
