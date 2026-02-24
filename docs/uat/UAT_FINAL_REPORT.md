# Codex for macOS UAT Final Report (Chunk 7 Rerun)

Date: 2026-02-24  
Repository: `codex-synaptic`  
Branch: `codex/uat-macos-readiness`  
Scope: Codex for macOS launch/doctor MCP readiness (UAT, not PRD)

## Final Verdict

Status: `BLOCKED`

Primary blocker (environment/image availability):

- GHCR authentication is now present on the UAT host (interactive login completed; `env docker-login` succeeds), but the default MCP image references currently used by the launch gate resolve to `not found`.
- This prevents `env up` and therefore blocks both `doctor --strict --json` and `launch --strict --json` from passing.

Code/output-contract status (previously blocking, now resolved):

- `launch --strict --json` stdout purity has been fixed.
- In the rerun evidence, `launch.strict.json` is valid JSON directly (no stdout prefix contamination / no post-processing required).

## Evidence Location

Primary rerun evidence (authoritative for this report):

- `/Users/chrisdukes/LocalProjects/codex-synaptic/docs/uat/evidence/2026-02-24-rerun-1/`
- Step matrix: `/Users/chrisdukes/LocalProjects/codex-synaptic/docs/uat/evidence/2026-02-24-rerun-1/_status.tsv`

Prior blocked run (preserved for traceability):

- `/Users/chrisdukes/LocalProjects/codex-synaptic/docs/uat/evidence/2026-02-24/`

## Smoke Run Results (Runbook Path, Rerun)

### Command matrix (steps 1-13)

| Step | Command                                                                                                   | Exit | Result |
| ---- | --------------------------------------------------------------------------------------------------------- | ---: | ------ |
| 01   | `CODEX_AUTO_LINK=false npm run build`                                                                     |    0 | PASS |
| 02   | `codex --help`                                                                                            |    0 | PASS |
| 03   | `codex mcp --help`                                                                                        |    0 | PASS |
| 04   | `codex mcp add --help`                                                                                    |    0 | PASS |
| 05   | `codex login status`                                                                                      |    0 | PASS (`Logged in using ChatGPT`) |
| 06   | `node dist/cli/index.js env plan mcp-filesystem mcp-playwright mcp-desktop-commander`                     |    0 | PASS |
| 07   | `node dist/cli/index.js env docker-login mcp-filesystem mcp-playwright mcp-desktop-commander`             |    0 | PASS (Docker reused existing GHCR credentials; `Login Succeeded`) |
| 08   | `node dist/cli/index.js env up mcp-filesystem mcp-playwright mcp-desktop-commander`                       |    1 | BLOCKED (default MCP image reference not found) |
| 09   | `node dist/cli/index.js env status mcp-filesystem mcp-playwright mcp-desktop-commander`                   |    0 | PASS (profiles reported not running/not healthy after step 08 failure) |
| 10   | `node dist/cli/index.js env codex-register mcp-filesystem mcp-playwright mcp-desktop-commander --replace` |    0 | PASS |
| 11   | `codex mcp list --json`                                                                                   |    0 | PASS (all 3 required MCP names present; artifact redacted) |
| 12   | `node dist/cli/index.js doctor --strict --json`                                                           |    1 | BLOCKED (3 default MCP profile checks failed as expected) |
| 13   | `node dist/cli/index.js launch --strict --json`                                                           |    1 | BLOCKED (`mcp.up` failed at `mcp-filesystem`) |

### Key observations

- `env plan` confirms the expected default launch gate profiles and `mcp-filesystem` read-only default mode.
- `env docker-login` now succeeds in the captured rerun (no non-TTY blocker in this run context).
- `env up` fails deterministically at `mcp-filesystem` with `failed to resolve reference ... : not found` for:
  - `ghcr.io/context-labs/filesystem-mcp:latest`
- `env codex-register --replace` succeeds and `codex mcp list --json` includes:
  - `filesystem-local`
  - `playwright-local`
  - `desktop-commander`
- `doctor --strict --json` remains valid JSON and reports:
  - `ok=false`
  - `summary: passed=4 failed=3 total=7`
  - failed checks are the 3 default MCP profiles only
- `launch --strict --json` returns valid JSON on stdout (fixed output contract) and reports:
  - `ok=false`
  - `nextAction="stop"`
  - failing step `mcp.up`
  - failed profile `mcp-filesystem`

## Post-Login GHCR Pull Verification (Direct Docker Pulls)

Additional evidence captured in the rerun folder (not part of the 1-13 runbook steps) confirms the same blocker for all default MCP images:

- `docker pull ghcr.io/context-labs/filesystem-mcp:latest`
  - Artifact: `/Users/chrisdukes/LocalProjects/codex-synaptic/docs/uat/evidence/2026-02-24-rerun-1/00a-ghcr-pull-filesystem.out.txt`
  - Result: `not found`
- `docker pull ghcr.io/context-labs/playwright-mcp:latest`
  - Artifact: `/Users/chrisdukes/LocalProjects/codex-synaptic/docs/uat/evidence/2026-02-24-rerun-1/00b-ghcr-pull-playwright.out.txt`
  - Result: `not found`
- `docker pull ghcr.io/wonderwhy-er/desktop-commander:latest`
  - Artifact: `/Users/chrisdukes/LocalProjects/codex-synaptic/docs/uat/evidence/2026-02-24-rerun-1/00c-ghcr-pull-desktop-commander.out.txt`
  - Result: `not found`

Interpretation:

- The host is no longer failing with the earlier `denied` auth response.
- Current blocker is image reference availability/path/tag/access-masking as `not found`.

## Launch JSON Output Contract (Resolved)

Previous blocked run (`/docs/uat/evidence/2026-02-24/`) discovered stdout contamination in `launch --strict --json`.

Current rerun status:

- `/Users/chrisdukes/LocalProjects/codex-synaptic/docs/uat/evidence/2026-02-24-rerun-1/launch.strict.json` is directly parseable JSON.
- No helper extraction artifacts (`launch.strict.payload.json`, stdout prefix stripping) were required for the rerun.

## Blocker Classification

### Environment blockers (current)

- Default MCP image references used by launch-gate profiles are not pullable (`not found`) on this UAT host:
  - `ghcr.io/context-labs/filesystem-mcp:latest`
  - `ghcr.io/context-labs/playwright-mcp:latest`
  - `ghcr.io/wonderwhy-er/desktop-commander:latest`

### Code regressions (current)

- None blocking UAT in the rerun.
- `launch --json` stdout purity issue is fixed and re-verified.

## Secret Handling Note

- During rerun evidence review, `codex mcp list --json` again contained one secret-like value in a `bearer_token_env_var` field for an unrelated MCP entry.
- The value was redacted in place in:
  - `/Users/chrisdukes/LocalProjects/codex-synaptic/docs/uat/evidence/2026-02-24-rerun-1/codex.mcp.list.json`
- Redaction note:
  - `/Users/chrisdukes/LocalProjects/codex-synaptic/docs/uat/evidence/2026-02-24-rerun-1/11-codex-mcp-list.redaction.txt`
- No secret values are reproduced in this report.

## Residual Non-UAT Risk (Previously Triaged, Unchanged)

- Production `npm audit` still reports deferred high-severity findings in the `sqlite3` install toolchain path (`node-gyp`/`tar`/related transitive dependencies).
- This remains an install-time hardening concern, not the direct runtime blocker for Codex macOS launch/doctor UAT.

## Remediation Prerequisites To Unblock Final UAT PASS

1. Confirm the correct, currently available image references (repository path + tag) for the default MCP profiles:
   - `mcp-filesystem`
   - `mcp-playwright`
   - `mcp-desktop-commander`
2. Update profile image references (and runbook/docs if needed) if upstream paths/tags changed.
3. Re-verify direct pulls for all 3 images on the UAT host.
4. Re-run runbook steps 5-9 (or full steps 1-13) and refresh evidence/report.

## Recommended Next Action

- Treat UAT readiness as `BLOCKED` pending correction/restoration of the default MCP image references (or equivalent pullable tags). The launch JSON stdout contract issue is resolved and should no longer block reruns.
