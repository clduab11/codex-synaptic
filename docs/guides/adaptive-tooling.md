# Adaptive Tooling & Validation Guide

Codex-Synaptic now ships a coordinated tooling surface that links the tool optimiser, the reasoning planner, and consensus validation. This guide explains how to activate the adaptive flows through the REST API and CLI, how consensus gating influences execution, and where to observe telemetry for the new endpoints.

## Tool Optimiser API

`POST /v1/tools/score`

```json
{
  "prompt": "Refactor the mesh router handler for better latency",
  "candidates": [
    { "id": "mesh-optimizer", "displayName": "Mesh Optimiser", "capabilities": ["mesh.tune"] },
    { "id": "observability-export", "displayName": "Telemetry Export", "capabilities": ["metrics.export"] }
  ]
}
```

Response entries include the recommended tool ordering, reasoning traces, historical usage signals, and confidence. Use `POST /v1/tools/outcome` after execution to record success/failure, latency, and contextual tags so future scoring benefits from feedback loops.

The optimiser is also accessible via the CLI:

```bash
codex-synaptic tools score "Patch production mesh routing" --candidates tmp/tools.json
codex-synaptic tools record --id mesh-optimizer --success --latency 820 --tags swarm,mesh
codex-synaptic tools history --tool mesh-optimizer --limit 5
```

## Reasoning Planner REST Endpoints

| Route | Description |
|-------|-------------|
| `POST /v1/reasoning/plans` | Generate a plan with optional Tree-of-Thought context and consensus gating. |
| `POST /v1/reasoning/plans/:id/checkpoints` | Append checkpoints as work progresses. |
| `POST /v1/reasoning/plans/:id/complete` | Finalise the plan with `completed`, `failed`, or `aborted` status. |
| `GET /v1/reasoning/plans/:id` | Retrieve the latest snapshot including checkpoints and metadata. |
| `GET /v1/reasoning/plans?limit=n` | List recent plans for dashboards or audit trails. |

Planner responses echo consensus metadata when gating is requested and embed ToT best-branch summaries whenever available.

## Reasoning CLI Workflow

```bash
# Create and inspect a gated plan
codex-synaptic reasoning plan "Deploy hotfix through mesh" --require-consensus --branches 3 --iterations 4
codex-synaptic reasoning resume <plan-id>

# Emit checkpoints from automation
codex-synaptic reasoning checkpoint <plan-id> --label analysis --status complete --summary "Risk review finished"

# Mark the run complete or failed
codex-synaptic reasoning complete <plan-id> --status completed --summary "Deployed cleanly" --duration 12500

# List recent activity
codex-synaptic reasoning history --limit 10
```

Plans that trigger a consensus proposal remain in an `awaiting_approval` state until the consensus coordinator emits a decision. Rejections automatically close the plan as `aborted` and block downstream workflow execution.

## Validation Gating Heuristics

The orchestration workflow now calls the reasoning planner before dispatching tasks. Prompts containing deployment or governance phrases (`deploy`, `production`, `hotfix`, `consensus`, `approval`, etc.) are gated behind the consensus subsystem:

1. A plan is created with `requireConsensus=true`.
2. A consensus proposal is registered and broadcast to voters.
3. Execution pauses until `consensusReached` resolves.
4. Approval records a `consensus-approved` checkpoint; rejection aborts the plan and prevents automation.

Custom prompts can still opt into gating by passing `--require-consensus` through the CLI or `requireConsensus: true` in the REST payload.

## Observability Touchpoints

- Tool optimiser and reasoning plan mutations persist to the SQLite-backed memory system for trend analysis.
- Export metrics snapshots with `npm run export:metrics -- --limit 200` (see runbook below).
- Consensus decisions fire through the existing `consensus_events` stream; paired checkpoints live alongside the plan record.

Use these signals to feed dashboards under `docs/observability/dashboard-template.yaml` and to monitor approval latency or rejection spikes.

## Handy References

- [CLI Cheat Codes](../codex-synaptic-cheat-codes.md)
- [Observability Toolkit](../observability/README.md)
- [Consensus Architecture](../architecture.md#consensus-mechanisms)

