# Codex for macOS UAT Runbook (Launch/Doctor MCP Readiness)

Last updated: 2026-02-24  
Audience: UAT operators validating Codex for macOS + `codex-synaptic` launch readiness.  
Scope: UAT readiness only (not PRD release readiness).

## Purpose

Provide a deterministic, testable procedure for validating the Codex for macOS startup path in this repository, with `launch` and `doctor` as hard readiness gates for default MCP profiles:

- `mcp-filesystem`
- `mcp-playwright`
- `mcp-desktop-commander`

This runbook is aligned with:

- `AGENTS.md` (Startup Gate semantics)
- `README.md` (operator command deck + MCP workflow)
- `docs/guides/codex-macos-workflows.md`
- `docs/mcp/README.md`

## UAT Pass Criteria (Top-Level)

UAT launch readiness is considered `PASS` only when all of the following are true:

1. `node dist/cli/index.js doctor --strict --json` exits `0` and returns JSON with:
   - `"ok": true`
   - `"summary.failed": 0`
   - passing checks for default MCP profiles (`mcp.mcp-filesystem`, `mcp.mcp-playwright`, `mcp.mcp-desktop-commander`)
2. `node dist/cli/index.js launch --strict --json` exits `0` and returns JSON with:
   - `"ok": true`
   - `"nextAction": "continue"`
   - all launch steps `ok=true` including `mcp.up`, `mcp.codex_register`, and `doctor.strict`
3. Default `mcp-filesystem` behavior remains read-only unless explicitly opted into controlled write.

## UAT Environment Prerequisites

Do not start the run until these are confirmed:

- macOS host with Docker Desktop installed and running
- Node.js/npm installed (repo uses Node 20+)
- Codex CLI installed and on `PATH` (`codex --help`)
- Codex CLI authenticated (`codex login status`)
- Network access to pull MCP images
- Docker registry credentials for any private registries still referenced by the active MCP profile images

Notes:

- CLI local `.env` autoload is enabled by default. Set `CODEX_CLI_ENV_AUTOLOAD=0` to disable auto-loading for UAT runs.
- For non-JSON commands, the CLI may emit an env bootstrap banner to `stderr` (not `stdout`). Treat local env source details as sensitive operational context.
- Set `CODEX_CLI_ENV_BANNER_VERBOSE=1` only when debugging env source paths; avoid using it in shared logs/screenshots.
- Do not capture or paste secrets from `codex login`, Docker login prompts, or local `.env` files.

### Upstream Image Migration Note (2026-02-24)

Verified against upstream project documentation and live registry pulls:

- `mcp-playwright` canonical image is now the Docker Hub MCP image `mcp/playwright:latest` (also mirrored from official Playwright MCP Docker guidance).
- `mcp-filesystem` canonical image is `mcp/filesystem:latest`, but it is a stdio-oriented MCP server image (not a drop-in HTTP/`--port` replacement for this repo's current `env up` + `codex mcp add --url` flow).
- `mcp-desktop-commander` canonical image is `mcp/desktop-commander:latest`, but it is also stdio-oriented and does not accept `--port`.
- Legacy GHCR wrapper images previously used by this repo (for example `ghcr.io/context-labs/*-mcp` and `ghcr.io/wonderwhy-er/desktop-commander`) now return registry `404` (not found), even with authenticated GHCR access.

Implication for UAT:

- Updating image references alone only cleanly unblocks `mcp-playwright`.
- `mcp-filesystem` and `mcp-desktop-commander` require either:
  - replacement HTTP-capable wrapper images, or
  - a profile/registration redesign to use stdio MCP registration instead of HTTP URL registration.

## Recommended Evidence Capture (Optional but Strongly Recommended)

Create a dated folder and store JSON outputs for handoff:

```bash
mkdir -p docs/uat/evidence/2026-02-23
```

Suggested evidence artifacts:

- `doctor.strict.json`
- `launch.strict.json`
- `codex.mcp.list.json`
- `env.status.txt`

## UAT Procedure (Exact Commands)

Run all commands from the repo root:

```bash
cd /absolute/path/to/codex-synaptic
```

### 1) Build the CLI artifacts

```bash
npm install
npm run build
```

Pass criteria:

- `npm install` completes without fatal errors
- `npm run build` exits `0`
- `dist/cli/index.js` exists

### 2) Verify Codex CLI + MCP command surface

```bash
codex --help
codex mcp --help
codex mcp add --help
codex login status
```

Pass criteria:

- All commands exit `0`
- `codex login status` indicates logged-in state (not "not logged in")

### 3) Inspect default MCP profiles and registration targets

```bash
node dist/cli/index.js env plan mcp-filesystem mcp-playwright mcp-desktop-commander
```

Pass criteria:

- Output includes all 3 profile names
- Output shows expected Codex MCP names:
  - `filesystem-local`
  - `playwright-local`
  - `desktop-commander`
- `mcp-filesystem` notes read-only default mode

### 4) Authenticate Docker registry access for MCP images

```bash
node dist/cli/index.js env docker-login mcp-filesystem mcp-playwright mcp-desktop-commander
```

Pass criteria:

- Command exits `0`
- Docker login succeeds for required private registries (if any are required by the active profile images)
- Public Docker Hub `mcp/*` images generally do not require `docker login`

Common failure indicators (blockers):

- `error from registry: denied`
- `pull access denied`
- `unauthorized`
- `failed to resolve reference ... : not found` (image/repository/tag drift or deprecation)

### 5) Start default MCP profiles (read-only filesystem mode by default)

```bash
node dist/cli/index.js env up mcp-filesystem mcp-playwright mcp-desktop-commander
```

Pass criteria:

- Command exits `0`
- No healthcheck timeout errors
- Filesystem profile starts without controlled-write flags (default safe mode)

### 6) Verify MCP runtime health

```bash
node dist/cli/index.js env status mcp-filesystem mcp-playwright mcp-desktop-commander
```

Pass criteria for each profile:

- `running: yes`
- `healthy: yes` (or probe-equivalent success)
- no blocking diagnostics

If collecting evidence:

```bash
node dist/cli/index.js env status mcp-filesystem mcp-playwright mcp-desktop-commander | tee docs/uat/evidence/2026-02-23/env.status.txt
```

### 7) Register MCP HTTP endpoints with Codex

```bash
node dist/cli/index.js env codex-register mcp-filesystem mcp-playwright mcp-desktop-commander --replace
codex mcp list --json
```

Pass criteria:

- Registration command exits `0`
- `codex mcp list --json` exits `0`
- JSON includes all names:
  - `filesystem-local`
  - `playwright-local`
  - `desktop-commander`

If collecting evidence:

```bash
codex mcp list --json > docs/uat/evidence/2026-02-23/codex.mcp.list.json
```

### 8) Run strict doctor gate (authoritative diagnostic pass)

```bash
node dist/cli/index.js doctor --strict --json
```

Pass criteria:

- Exit code `0`
- JSON contains:
  - `"ok": true`
  - `"summary": { "failed": 0, ... }`
- Checks include and pass:
  - `repo.cli_build_artifact`
  - `repo.cli_exec`
  - `codex.auth`
  - `codex.mcp_list`
  - `mcp.mcp-filesystem`
  - `mcp.mcp-playwright`
  - `mcp.mcp-desktop-commander`

If collecting evidence:

```bash
node dist/cli/index.js doctor --strict --json > docs/uat/evidence/2026-02-23/doctor.strict.json
```

### 9) Run strict launch gate (hard startup gate)

```bash
node dist/cli/index.js launch --strict --json
```

Pass criteria:

- Exit code `0`
- JSON contains:
  - `"ok": true`
  - `"nextAction": "continue"`
- `steps` contains all required launch gate steps with `"ok": true`:
  - `repo.preflight`
  - `codex.auth`
  - `runtime.daemon`
  - `mcp.up`
  - `mcp.codex_register`
  - `doctor.strict`
- `doctor.ok` is `true`

If collecting evidence:

```bash
node dist/cli/index.js launch --strict --json > docs/uat/evidence/2026-02-23/launch.strict.json
```

## Deterministic Fail/Block Conditions

Mark UAT launch readiness `FAIL` (or `BLOCKED`) if any of the following occur:

- `launch --strict --json` exits non-zero
- `launch` JSON returns `"ok": false` or `"nextAction": "stop"`
- `doctor --strict --json` exits non-zero
- `doctor` JSON returns `"ok": false` or any failed default MCP check
- Any default MCP profile is not running/healthy/registered
- Docker registry auth/pull denial prevents `mcp.up` (for example GHCR denial)
- Codex auth not available (`codex login status` not logged in)

## Failure Triage (Fast Path)

Use the failure message/remediation emitted by `launch`/`doctor`. Common paths:

### A. Docker image pull/auth denied (GHCR)

Symptom examples:

- `error from registry: denied`
- `pull access denied`

Remediation:

```bash
node dist/cli/index.js env docker-login mcp-filesystem mcp-playwright mcp-desktop-commander
node dist/cli/index.js env up mcp-filesystem mcp-playwright mcp-desktop-commander
```

Then retry:

```bash
node dist/cli/index.js doctor --strict --json
node dist/cli/index.js launch --strict --json
```

### B. MCP registration drift

Symptom:

- `doctor` shows `registered=false` for one or more MCP checks

Remediation:

```bash
node dist/cli/index.js env codex-register mcp-filesystem mcp-playwright mcp-desktop-commander --replace
codex mcp list --json
```

### C. Service running but unhealthy / health timeout

Symptom:

- `healthy=false`
- `Service healthcheck timed out ...`

Remediation:

```bash
node dist/cli/index.js env status mcp-filesystem mcp-playwright mcp-desktop-commander
node dist/cli/index.js env up mcp-filesystem mcp-playwright mcp-desktop-commander
```

If persistent, capture `env status` output and treat as UAT blocker.

### D. Codex auth missing

Symptom:

- `codex.auth` fails in `doctor`/`launch`

Remediation:

```bash
codex login
codex login status
```

## UAT Acceptance Checklist (Operator Sign-Off)

Use this checklist during the run and archive it with evidence:

- [ ] Running on macOS UAT host with Docker Desktop active
- [ ] `npm install` completed successfully
- [ ] `npm run build` completed successfully
- [ ] `codex login status` confirms logged-in state
- [ ] `env plan` confirms default MCP profiles and expected Codex registration names
- [ ] `env docker-login` completed successfully (registry access verified)
- [ ] `env up` started `mcp-filesystem`, `mcp-playwright`, `mcp-desktop-commander`
- [ ] `env status` shows `running: yes` and `healthy: yes` for all default MCP profiles
- [ ] `env codex-register ... --replace` completed successfully
- [ ] `codex mcp list --json` includes `filesystem-local`, `playwright-local`, `desktop-commander`
- [ ] `doctor --strict --json` exits `0` with `"ok": true`
- [ ] `launch --strict --json` exits `0` with `"ok": true` and `"nextAction": "continue"`
- [ ] No secrets captured in shared evidence/logs/screenshots

## Out of Scope for This UAT Runbook

This runbook validates launch/doctor MCP readiness only. It does not certify:

- CI/CD release pipeline completeness
- package publication scope hardening
- dependency vulnerability remediation
- full beta/PRD readiness criteria from `docs/beta-readiness-checklist.md`
