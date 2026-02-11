# Autoscaler-Daemon Coordination Runbook

This runbook documents how autoscaling and the background daemon interact, plus supported operational commands for Codex-Synaptic.

## 1. Overview

The autoscaler evaluates resource pressure and proposes up/down adjustments. The background daemon executes persistent lifecycle coordination.

### Key relationship

- Autoscaler computes scaling decisions from utilization signals.
- Daemon-backed coordination is required for reliable background scale-down execution.
- If the daemon is offline, scale-down intent is recorded but cleanup may be delayed.

## 2. Autoscaling behavior

### Scale-up

Trigger: utilization above threshold.

Behavior:

- New worker replicas are deployed.
- Events are persisted to the `autoscaler_events` memory namespace.

Command:

```bash
codex-synaptic memory list autoscaler_events --limit 10
```

### Scale-down

Trigger: utilization below threshold.

Behavior:

- Autoscaler attempts to retire idle capacity.
- When daemon coordination is unavailable, retirement is deferred and warnings/events are emitted.

Command:

```bash
codex-synaptic system status
```

### Cooldown

Scale-up and scale-down both respect cooldown windows to avoid thrashing.

## 3. Daemon dependency

### Why scale-down depends on daemon coordination

The background daemon (`src/cli/daemon-manager.ts`) holds persistent process coordination state used by detached/background workflows.

When daemon is offline:

- Foreground operations still run.
- Scale-down cleanup can be delayed.
- `autoscaler_events` will include deferred/diagnostic records.

### Check daemon state

```bash
# Check daemon state
codex-synaptic background status

# Inspect daemon logs (project-local)
tail -n 50 logs/daemon.log
```

## 4. Operational modes

### Production mode (recommended)

Configuration:

- Daemon: running continuously.
- Autoscaler: enabled (`scaling.enabled: true`).

Commands:

```bash
codex-synaptic background start
grep -E '"scaling"|"enabled"' config/system.json
```

### Testing mode (swarm/perf tests)

Configuration:

- Daemon: stopped during isolated tests.
- Autoscaler: paused (`scaling.enabled: false`).

Procedure:

```bash
# 1) Stop daemon
codex-synaptic background stop

# 2) Disable autoscaler in config/system.json
#    set: "scaling": { "enabled": false }

# 3) Run test workload
codex-synaptic hive-mind spawn "performance test" --codex --dry-run

# 4) Inspect agent registry state
codex-synaptic agent list

# 5) Re-enable autoscaler and restart daemon
#    set: "scaling": { "enabled": true }
codex-synaptic background start
```

### Development mode

Configuration:

- Daemon: optional.
- Autoscaler: usually disabled for predictable debugging.

Commands:

```bash
codex-synaptic agent deploy --type code_worker --replicas 3
codex-synaptic agent deploy --type consensus_coordinator --replicas 2
```

## 5. Command reference (supported)

### Daemon management

```bash
codex-synaptic background status
codex-synaptic background start
codex-synaptic background stop

# restart sequence
codex-synaptic background stop
codex-synaptic background start
```

### Autoscaler configuration checks

```bash
rg '"scaling"|"enabled"|"minAgents"|"maxAgents"|"scaleUpThreshold"|"scaleDownThreshold"|"cooldownMs"' config/system.json
```

### Agent management

```bash
codex-synaptic agent list
codex-synaptic agent status <agent-id>
codex-synaptic agent deploy --type <agent-type> --replicas <n>
```

## 6. Troubleshooting

### Symptom: scale-down warnings

Cause: daemon offline or unable to process retirement coordination.

Resolution:

```bash
codex-synaptic background status
codex-synaptic background start
codex-synaptic memory list autoscaler_events --limit 20
```

### Symptom: idle capacity persists

Cause: deferred cleanup while daemon was unavailable.

Diagnosis:

```bash
codex-synaptic agent list
codex-synaptic background status
codex-synaptic memory list autoscaler_events --limit 20
```

Resolution:

```bash
codex-synaptic background start
# allow cooldown window, then re-check
codex-synaptic system status
codex-synaptic agent list
```

### Symptom: autoscaler not scaling up

Cause: scaling disabled or configured limits reached.

Diagnosis:

```bash
rg '"scaling"|"enabled"|"maxAgents"|"minAgents"' config/system.json
codex-synaptic agent list
```

Resolution:

```bash
# verify scaling.enabled=true in config/system.json
# optionally add temporary capacity manually:
codex-synaptic agent deploy --type <agent-type> --replicas <n>
```

### Symptom: daemon fails to start

Cause: stale daemon state or environment/runtime issue.

Diagnosis:

```bash
codex-synaptic background status
tail -n 100 logs/daemon.log
```

Resolution:

```bash
rm -f ~/.codex-synaptic/daemon.json
codex-synaptic background start
```

## 7. Best practices

### Hive-mind/performance testing

1. Before test:
   - `codex-synaptic background stop`
   - disable autoscaler in `config/system.json`
   - `codex-synaptic agent list`
2. During test:
   - run workload in an isolated thread/worktree
   - periodically `codex-synaptic system status`
3. After test:
   - `codex-synaptic agent list`
   - re-enable autoscaler
   - `codex-synaptic background start`

### Production

- Keep daemon running.
- Keep autoscaler enabled.
- Monitor `autoscaler_events` for repeated deferred cleanups.

## 8. Monitoring & observability

### Useful checks

```bash
# registry snapshot
codex-synaptic agent list

# system + telemetry snapshot
codex-synaptic system status

# autoscaler event history
codex-synaptic memory list autoscaler_events --limit 20

# daemon health
codex-synaptic background status
```

### Event namespaces

- `autoscaler_events`: scale decisions and coordination outcomes
- `agent_lifecycle`: worker deploy/unregister signals
- `mesh_events`: topology changes
- `consensus_events`: consensus outcomes

## 9. Configuration reference

### Autoscaler settings (`config/system.json`)

```json
{
  "scaling": {
    "enabled": true,
    "minAgents": 4,
    "maxAgents": 40,
    "scaleUpThreshold": 0.75,
    "scaleDownThreshold": 0.35,
    "cooldownMs": 45000
  }
}
```

### Related docs

- `docs/runbooks/validation-gating.md`
- `docs/observability/README.md`
- `docs/codex-synaptic-cheat-codes.md`
- `AGENTS.md`

---

Last updated: 2026-02-11  
Maintainer: Codex-Synaptic Platform Team
