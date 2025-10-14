# Codex-Synaptic Observability Quickstart

This playbook shows how to take the bundled dashboard template, wire it into your metrics stack, and light up the most important Codex-Synaptic signals (autoscaler events, mesh healing, Tree-of-Thought telemetry, and consensus history).

## 1. Import the Dashboard Template

1. Copy `docs/observability/dashboard-template.yaml` into your Grafana provisioning directory (or import it manually through Grafana’s UI).
2. Point the provider path to the location used by your Grafana instance. In many setups this is `/etc/grafana/provisioning/dashboards`.
3. Trigger Grafana to reload dashboards (`systemctl restart grafana-server` or use the UI reload).

The template contains four starter panels:

| Panel | Metric Hint | Description |
|-------|-------------|-------------|
| Swarm Execution Latency | `codex_synaptic_swarm_execution_seconds` | Tree-of-Thought stage timing |
| Consensus Vote Spread | `codex_synaptic_consensus_votes_total` | Breakdown of yes/no votes per proposal |
| Tree-of-Thought Backlog | `codex_synaptic_tot_followups_pending` | Pending follow-up tasks |
| Agent Health | `codex_synaptic_agent_status` | Online/idle/error counts per agent type |

Feel free to extend the template with more panels—see the metrics below.

## 2. Expose Telemetry Metrics

Codex-Synaptic persists rich telemetry into its memory namespaces. To surface these in Prometheus:

1. Add a lightweight exporter (custom script, OpenTelemetry collector, or Prometheus textfile) that reads the latest entries and emits counters/gauges.
2. Suggested mappings:

| Namespace | Field | Suggested Metric |
|-----------|-------|------------------|
| `autoscaler_events` | `appliedIncrement`, `appliedReduction` | `codex_synaptic_autoscaler_scale_events_total{direction="up/down"}` |
| `mesh_events` | `topology`, `nodeCount` | `codex_synaptic_mesh_self_healing_total{topology="mesh"}` |
| `tot_runs` | `bestBranch.label`, `monteCarlo.totalSamples` | `codex_synaptic_tot_runs_total{branch="Mesh Architecture Branch"}` |
| `consensus_events` | `mechanism`, `accepted` | `codex_synaptic_consensus_events_total{mechanism="bft",accepted="true"}` |

Below is a small Node snippet you can adapt for a textfile exporter:

```ts
import { CodexMemorySystem } from '../../src/memory/memory-system';
const memory = new CodexMemorySystem();

async function emitMetrics() {
  const autoscaler = await memory.list('autoscaler_events', 50);
  const mesh = await memory.list('mesh_events', 50);
  const stream = [];

  const scalerUp = autoscaler.filter(e => e.data?.appliedIncrement > 0).length;
  const scalerDown = autoscaler.filter(e => e.data?.appliedReduction > 0).length;
  stream.push(`codex_synaptic_autoscaler_scale_events_total{direction="up"} ${scalerUp}`);
  stream.push(`codex_synaptic_autoscaler_scale_events_total{direction="down"} ${scalerDown}`);

  const healCount = mesh.length;
  stream.push(`codex_synaptic_mesh_self_healing_total ${healCount}`);

  // write to /var/lib/node_exporter/textfile_collector/codex.prom
  require('fs').writeFileSync('/tmp/codex.prom', stream.join('\n'));
}

emitMetrics();
```

Schedule this exporter (cron/systemd) so metrics stay fresh.

## 3. Alert Ideas

| Scenario | Alert Expression | Action |
|----------|------------------|--------|
| Repeated scale cycles | `increase(codex_synaptic_autoscaler_scale_events_total[5m]) > 5` | Investigate workload or resource limits |
| Mesh healing spikes | `increase(codex_synaptic_mesh_self_healing_total[15m]) > 0` | Check for flaky agents or network partitions |
| Stale follow-ups | `codex_synaptic_tot_followups_pending > 0` for > 10m | Kick off a manual follow-up |
| Consensus failures | `increase(codex_synaptic_consensus_events_total{accepted="false"}[15m]) > 0` | Inspect telemetry (CLI or Grafana panel) |

## 4. Handy CLI Checks

- `codex-synaptic consensus telemetry --limit 5` → Peek at recent decisions.
- `codex-synaptic memory list autoscaler_events --limit 5` → Read scale actions.
- `codex-synaptic memory list mesh_events --limit 5` → See self-healing activity.

Use these commands alongside the dashboard to validate signals while you wire up exporters.

---
**Bonus:** The `docs/codex-synaptic-cheat-codes.md` zine includes command combos you can copy directly into the terminal for quick automation runs—perfect for generating telemetry while you verify your dashboards.

### Automation Command

Run the exporter on demand (or via cron/systemd):

```bash
npm run export:metrics -- --output /var/lib/node_exporter/textfile_collector/codex.prom --limit 200
```

Adjust the path/limit as needed for your environment.

### Docker Quickstart

```bash
# Start the entire observability stack (Prometheus, Grafana, Loki, exporters)
codex-synaptic env up observability

# Check status
codex-synaptic env status observability

# Stop when you are done
codex-synaptic env down observability
```

### Auto-start Behavior
- By default `environment.autoStartProfiles` includes `observability`, so `codex-synaptic system start` brings the stack online automatically.
- Remove the entry or set it to an empty array in `config/system.json` if you prefer manual control.
