# Codex for macOS — official documentation & 7-day changelog review

Date: 2026-02-08 (UTC)

## Sources reviewed (official)

- Codex app documentation (developers.openai.com): https://developers.openai.com/codex/app/
- Codex changelog (developers.openai.com): https://developers.openai.com/codex/changelog/
- Codex cloud documentation (developers.openai.com): https://developers.openai.com/codex/cloud/
- Introducing the Codex app blog post (openai.com): https://openai.com/index/introducing-the-codex-app/

## Official documentation highlights (Codex app + cloud)

### Codex app (macOS)

- Desktop experience for running multiple Codex threads in parallel.
- Built‑in worktree support, automations, and Git functionality.
- Available on macOS (Apple Silicon), with sign‑in via ChatGPT account or OpenAI API key.
- Local execution mode: choose a project folder and run work locally on your machine.
- Example workflows emphasize rapid repo understanding, bug fixes, and feature work.

### Codex cloud

- Cloud mode runs Codex tasks in OpenAI’s cloud environment.
- Web experience connects to GitHub and creates pull requests.
- Included in Plus/Pro/Business/Edu/Enterprise plans.

## Changelog entries in the last 7 days (2026‑02‑01 → 2026‑02‑08)

From the Codex changelog page, the macOS app entries within the past 7 days:

### 2026‑02‑05 — Codex app v260205

**New features**
- Support for GPT‑5.3‑Codex.
- Mid‑turn steering: users can submit a message while Codex is working to redirect behavior.
- Attach or drop any file type.

**Bug fixes**
- Fix flickering of the app.

### 2026‑02‑04 — Codex app v260204

**New features**
- Added Zed and Textmate as options to open files/folders.
- Added PDF preview in the review panel.

**Bug fixes**
- Performance improvements.

### 2026‑02‑02 — Introducing the Codex app

- Official launch announcement for the macOS app.
- Highlights: project sidebar, thread list, review pane, multitasking across projects, worktree support, Git tooling, skills, automations, and voice dictation.

## Parity review vs. Codex‑Synaptic repository behavior

### App vs. repo: key parity dimensions

1. **Parallel tasking / multi‑threading**
   - The macOS app is explicitly positioned as a multi‑thread command center. Our repo already supports multi‑agent, multi‑task execution through swarm coordination and CLI tooling.
2. **Local execution semantics**
   - App “Local” mode runs on a developer’s machine with full shell capabilities. The repo’s CLI command runner uses `bash -lc`, which supports pipelines (`|`), redirection (`>`), and regex tools like `grep -E` or `rg`.
3. **Git/worktree integration**
   - App includes built‑in Git tooling and worktree support; this aligns with the repo’s CLI positioning and existing workflow descriptions.
4. **Automation & skills**
   - App references skills and automations. The repository includes automation and skill subsystems, but should be audited for parity with app behaviors (e.g., file drop/attach and mid‑turn steering).

### Environment capability match (example: `find | grep > regex`)

- The app’s “Local” mode implies shell semantics where pipelines and redirections work as expected.
- The repo’s CLI uses `bash -lc`, which already enables pipelines and redirection. This suggests parity for the requested command pattern.
- Actionable parity checks should explicitly validate:
  - Pipeline support (`find . -type f | grep -E 'pattern'`)
  - Redirection (`... > output.txt`)
  - Regex support (`grep -E`, `rg`, or `perl -ne`)
  - Shell selection parity (macOS default `zsh` vs `bash`) and path resolution.

### Repo evidence (local execution)

- The CLI’s local command executor launches `bash` with `-lc`, inheriting the current environment, which is consistent with pipeline and redirection semantics expected by the macOS app’s Local mode (see `src/cli/codex-passthrough.ts`, `executeLocalCommand`).

## ReAct‑style framework for parity & environment matching

**Step‑back inference (high‑level summary)**

- The macOS app emphasizes **local execution, parallel tasks, and Git/worktree workflows**, and the latest changelog adds **mid‑turn steering** and **attachments**.
- Codex‑Synaptic already models **multi‑agent coordination** and **CLI execution**, but must ensure **shell‑level parity** with macOS local behavior, plus **UI‑driven features** (attachments, mid‑turn steering) mapped into the orchestration layer.

**ReAct framework (Reason → Act → Observe → Update)**

1. **Reason:** Identify parity gaps by mapping each app capability to repo subsystems (swarm, CLI, automations, skills, Git/worktree handling, file attachments, mid-turn steering).
2. **Act:** Add instrumentation and tests in the CLI and swarm layers to validate shell semantics, environment detection, and execution safety.
3. **Observe:** Collect telemetry/log outputs for real shell runs, plus regression tests for pipelines/redirects.
4. **Update:** Tighten environment adapters, add macOS‑specific profiles, and align docs/UX accordingly.

## Step‑by‑step technical implementation plan

1. **Source‑of‑truth mapping**
   - Create a parity checklist that maps macOS app features to repo modules (swarm orchestration, CLI command runner, automation/skills, Git tooling).
2. **Environment parity harness**
   - Add a shell‑compatibility test suite to run representative commands (pipes, redirects, regex). Use `bash -lc` today; add a macOS `zsh` profile option and compare outputs.
3. **Swarm execution profile**
   - Introduce a “macOS local” swarm profile that:
     - Uses local filesystem paths and process execution constraints.
     - Enforces pipeline and redirection support.
     - Validates tool availability (`grep`, `rg`, `sed`, `awk`).
4. **Mid‑turn steering support**
   - Extend swarm task controllers to accept mid‑turn interruption/updates; ensure command cancellation and re‑plan are first‑class.
5. **Attachment parity**
   - Support file drag‑drop or attachment ingestion in CLI workflows, mapping to existing file system tools.
6. **Worktree/Git alignment**
   - Validate worktree switching and Git command execution, and surface state in CLI/telemetry logs.
7. **Documentation refresh**
   - Add a parity matrix and environment compatibility notes (pipes/redirection/regex) to docs for users migrating between macOS app and Codex‑Synaptic.
8. **Validation & regression**
   - Run automated tests for shell semantics and swarm task resumption after mid‑turn steering.
9. **Release readiness**
   - Add changelog entries and ensure parity items are visible in operator docs for the next release.
