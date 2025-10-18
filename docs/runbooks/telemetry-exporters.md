# Telemetry Exporter Runbook

This runbook covers the supported workflows for collecting Codex-Synaptic telemetry snapshots and publishing them to dashboards or long-term storage.

## 1. Prerequisites

- Codex-Synaptic system running with memory persistence enabled (`~/.codex-synaptic/memory.db`).
- Local Node.js toolchain (the exporter uses `ts-node`).
- Write access to the target output directory (default `./metrics`).

## 2. Export Latest Metrics Snapshot

```bash
npm run export:metrics -- --limit 200 --output metrics/latest.json
```

- `--limit` controls the number of recent tool invocations to include.
- `--output` (optional) writes the snapshot to disk; omit to print to stdout.
- The script automatically augments output with consensus decision timestamps when available.

## 3. Automating Scheduled Exports

Add a cron entry for periodic snapshots:

```
*/15 * * * * cd /path/to/codex-synaptic && npm run export:metrics -- --limit 500 --output metrics/cron-$(date +\%s).json
```

Ensure the `metrics/` directory exists and rotate files daily. The exporter returns a non-zero exit code if the memory store is unreachable; wire this into monitoring.

## 4. Feeding the Observability Dashboard

1. Confirm the dashboard template exists: `codex-synaptic observability template`.
2. Point your dashboard importer at the generated JSON snapshots.
3. Track key fields:
   - `toolId`, `agentType`, success rate metrics.
   - `latencyMs`, `confidence`, `tags`.
   - `consensus.proposalId` and `consensus.accepted` when validation gating is enabled.

## 5. Troubleshooting

| Symptom | Resolution |
|---------|------------|
| `SQLITE_BUSY` or lock errors | Pause automated exporters while a long-running workflow is writing telemetry, then retry. |
| Empty export file | Verify that the tool optimiser has recorded at least one outcome (`codex-synaptic tools record ...`). |
| Missing consensus data | Ensure workflows used `requireConsensus` and the consensus coordinator is online. |

Escalate persistent issues to the ReliabilityWorker swarms with the latest exporter logs attached.

