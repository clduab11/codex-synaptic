# Codex usage (macOS app, threads, automations, VS Code)

## Launch-first workflow

1. Open repository in Codex for macOS or Codex VS Code extension.
2. Run `codex-synaptic launch --strict --json`.
3. Apply safe fixes from `fixes[]`.
4. Re-run launch until `ok=true`.
5. Execute bounded workflow and publish a report artifact.

## Daily automation template

**Name:** Daily Launch Gate + Brief Report

```bash
codex-synaptic launch --strict --json > .codex-synaptic/reports/daily-launch.json
npm run build > .codex-synaptic/reports/daily-build.log 2>&1
npm run test > .codex-synaptic/reports/daily-test.log 2>&1
```

Output artifact: `.codex-synaptic/reports/daily-launch.json` + logs, committed or attached to thread.

## Nightly automation template

**Name:** Nightly Docs Drift / Friction Scan

```bash
codex-synaptic launch --strict --json > .codex-synaptic/reports/nightly-launch.json
git diff -- README.md AGENTS.md docs/ > .codex-synaptic/reports/nightly-docs-drift.diff || true
```

Output artifact: diff-ready drift report for next working day triage.

## Weekly automation template

**Name:** Weekly Release Preflight

```bash
codex-synaptic launch --strict --json > .codex-synaptic/reports/weekly-launch.json
npm run build > .codex-synaptic/reports/weekly-build.log 2>&1
npm run test > .codex-synaptic/reports/weekly-test.log 2>&1
```

Output artifact: preflight bundle for release thread/PR checklist.

## Worktree behavior

- Run automations in dedicated worktrees.
- Keep artifacts in project-local `.codex-synaptic/reports/`.
- Keep daemon runtime/state outside worktrees (`~/.codex-synaptic` by default).
