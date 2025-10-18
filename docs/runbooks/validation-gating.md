# Validation Gating Runbook

This runbook documents how to operate and recover the consensus-based validation gates used by the reasoning planner and workflow orchestrator.

## 1. When Gating Activates

- Prompts containing deployment or governance keywords (`deploy`, `production`, `hotfix`, `approval`, `consensus`, etc.) automatically set `requireConsensus=true`.
- Operators can force gating using the CLI (`--require-consensus`) or REST API payloads.
- The reasoning planner emits a consensus proposal with metadata `{ planId, prompt, riskSignals }`.

## 2. Monitoring Active Proposals

```bash
codex-synaptic consensus queue --limit 10
codex-synaptic reasoning history --limit 10
```

- Plans stay in `awaiting_approval` until the `consensusReached` event fires.
- Approval automatically records a `consensus-approved` checkpoint; rejection marks the plan `aborted` and halts the workflow.

## 3. Approving or Rejecting Plans

```bash
codex-synaptic consensus vote <proposal-id> --vote approve --notes "Risk accepted"
codex-synaptic consensus vote <proposal-id> --vote reject --notes "Rollback required"
```

- Rejections should include remediation notes; the reasoning plan captures them in metadata for audit trails.
- Record follow-up tasks with `codex-synaptic planner create` if remediation work is required.

## 4. Handling Timeouts

If a decision is not reached within 15 seconds, the orchestrator treats the plan as rejected:

1. The workflow aborts before execution.
2. An `aborted` completion record is stored with `metadata.decision.timedOut = true`.
3. Operators should re-run `reasoning plan` once quorum is restored or manual approval is secured.

Use `codex-synaptic system health` to confirm the consensus coordinator is connected when repeated timeouts occur.

## 5. Recovering from Inconsistent State

| Issue | Recovery Steps |
|-------|----------------|
| Workflow halted but plan marked `running` | Resume the plan via `codex-synaptic reasoning resume <plan-id>` to inspect checkpoints, then manually `complete` the plan with `--status aborted`. |
| Proposal approved but automation stalled | Verify the consensus webhook or event bus delivered the `consensusReached` event. You can manually record a `consensus-approved` checkpoint to unblock automation. |
| Duplicate proposals | Deduplicate in the consensus queue and keep the plan with the most recent timestamp. Update the other plan with `reasoning complete ... --status aborted` to maintain clean audit logs. |

## 6. Audit & Reporting

- Export plan history for audits: `codex-synaptic reasoning history --limit 50 > audits/gating-history.txt`.
- Pair the output with consensus event logs located in `consensus_events/`.
- Include telemetry snapshots (see the Telemetry Exporter Runbook) when submitting post-incident reviews.

