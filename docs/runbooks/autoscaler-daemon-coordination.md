# Autoscaler-Daemon Coordination Runbook

This runbook documents the relationship between the autoscaler and background daemon, operational modes, and troubleshooting procedures for managing agent lifecycle during scaling operations.

## 1. Overview

The **autoscaler** dynamically adjusts the number of worker agents based on resource utilization metrics, while the **background daemon** maintains persistent system state and coordinates agent lifecycle operations. These two components work together to ensure efficient resource management without compromising system stability.

### Key Relationship

- The autoscaler **recommends** scaling actions based on metrics
- The daemon **executes** agent retirement during scale-down operations
- When the daemon is offline, scale-down operations cannot complete, leaving idle agents running

## 2. How Autoscaling Works

### Scale-Up Operations

**Trigger:** Resource utilization exceeds the scale-up threshold (default: >75% CPU/memory)

**Behavior:**
- Autoscaler identifies resource pressure
- New worker agents are deployed automatically
- Agents are registered with the agent registry
- Events are persisted to the `autoscaler_events` namespace

**Command:**
```bash
# View recent scale-up events
codex-synaptic memory query autoscaler_events --limit 10
```

### Scale-Down Operations

**Trigger:** Resource utilization falls below the scale-down threshold (default: <35%)

**Behavior:**
- Autoscaler identifies idle workers
- Retirement requests are sent to the daemon
- Daemon unregisters agents from the registry
- Resources are reclaimed
- Events are persisted to the `autoscaler_events` namespace

**Command:**
```bash
# View agent utilization metrics
codex-synaptic system status --verbose
```

### Cooldown Period

Both scale-up and scale-down operations respect a cooldown period (default: 45 seconds) to prevent thrashing and ensure stable scaling behavior.

## 3. Daemon Dependency

### Why Scale-Down Requires the Daemon

The background daemon (`src/cli/daemon-manager.ts`) maintains authoritative system state including:
- Active agent registry
- Resource allocation tracking
- Lifecycle event coordination

**When the daemon is offline:**
- Scale-up operations continue to work (agents can be deployed directly)
- Scale-down operations **fail silently** (retirement requests have no recipient)
- Idle agents accumulate in the registry
- Warning messages appear in logs: `Cannot retire agents: daemon offline`

### Checking Daemon Status

```bash
# Check if daemon is running
codex-synaptic background status

# View daemon logs
codex-synaptic background logs --tail 50
```

## 4. Operational Modes

### Production Mode (Recommended)

**Configuration:**
- Daemon: **Running** continuously
- Autoscaler: **Enabled** (`scaling.enabled: true`)

**Behavior:**
- Fully automated scaling in both directions
- Minimal operator intervention required
- Optimal resource utilization

**Commands:**
```bash
# Start daemon in production mode
codex-synaptic background start

# Verify autoscaler is enabled
grep "scaling.enabled" config/system.json
```

### Testing Mode (For Swarm/Performance Tests)

**Configuration:**
- Daemon: **Stopped** during tests
- Autoscaler: **Paused** (`scaling.enabled: false`)

**Behavior:**
- Manual control over agent count
- No interference from autoscaler during experiments
- Manual cleanup required after tests

**Procedure:**
```bash
# 1. Stop daemon
codex-synaptic background stop

# 2. Disable autoscaler (edit config/system.json)
# Set: "scaling": { "enabled": false }

# 3. Run your swarm test
codex-synaptic swarm spawn --prompt "performance test"

# 4. Manually clean up idle agents
codex-synaptic agents list --idle
codex-synaptic agents retire <agent-id>

# 5. Re-enable autoscaler and restart daemon
# Set: "scaling": { "enabled": true }
codex-synaptic background start
```

### Development Mode

**Configuration:**
- Daemon: **Optional** (depends on workflow)
- Autoscaler: **Disabled** (`scaling.enabled: false`)

**Behavior:**
- Full manual control
- Predictable agent count for debugging
- No automatic scaling interference

**Commands:**
```bash
# Deploy specific agent counts manually
codex-synaptic agents deploy code_worker --count 3
codex-synaptic agents deploy consensus_coordinator --count 2
```

## 5. Commands Reference

### Daemon Management

```bash
# Check daemon status
codex-synaptic background status

# Start daemon
codex-synaptic background start

# Stop daemon (graceful shutdown)
codex-synaptic background stop

# View daemon logs
codex-synaptic background logs --tail 100

# Restart daemon
codex-synaptic background restart
```

### Autoscaler Configuration

```bash
# Disable autoscaler (edit config/system.json)
# Set: "scaling": { "enabled": false }

# Enable autoscaler (edit config/system.json)
# Set: "scaling": { "enabled": true }

# View current autoscaler settings
codex-synaptic config show scaling
```

### Manual Agent Management

```bash
# List all agents
codex-synaptic agents list

# List idle agents
codex-synaptic agents list --idle

# Manually retire an agent
codex-synaptic agents retire <agent-id>

# Deploy agents manually
codex-synaptic agents deploy <agent-type> --count <n>
```

## 6. Troubleshooting

### Symptom: Scale-down warnings in logs

**Cause:** Daemon is offline, retirement requests cannot be processed

**Log message:**
```
WARN [autoscaler] Cannot retire idle agents: daemon offline
```

**Resolution:**
```bash
# Option 1: Start the daemon
codex-synaptic background start

# Option 2: Manually retire idle agents
codex-synaptic agents list --idle
codex-synaptic agents retire <agent-id>
```

### Symptom: Idle agents accumulating

**Cause:** Autoscaler can't retire agents without daemon coordination

**Diagnosis:**
```bash
# Check for idle agents
codex-synaptic agents list --idle

# Check daemon status
codex-synaptic background status

# Review autoscaler events
codex-synaptic memory query autoscaler_events --limit 20
```

**Resolution:**
```bash
# Restart daemon to enable automatic cleanup
codex-synaptic background start

# Trigger manual scale-down (if needed)
codex-synaptic system scale-down --force
```

### Symptom: Autoscaler not scaling up

**Cause:** Autoscaler may be disabled or at max agent limit

**Diagnosis:**
```bash
# Check autoscaler configuration
codex-synaptic config show scaling

# Check current agent count vs limits
codex-synaptic agents list --count
```

**Resolution:**
```bash
# Verify scaling is enabled in config/system.json
# Check: "scaling": { "enabled": true, "maxAgents": 40 }

# Manually deploy agents if at limit
codex-synaptic agents deploy <agent-type> --count <n>
```

### Symptom: Daemon fails to start

**Cause:** Port conflict, permission issues, or corrupted state

**Diagnosis:**
```bash
# Check daemon logs
codex-synaptic background logs

# Check for port conflicts
lsof -i :4242  # Default API port
```

**Resolution:**
```bash
# Kill conflicting processes
kill <pid>

# Clear daemon state and restart
rm -rf ~/.codex-synaptic/daemon.pid
codex-synaptic background start
```

## 7. Best Practices

### For Hive-Mind Performance Tests

1. **Before test:**
   - Stop daemon: `codex-synaptic background stop`
   - Disable autoscaler: Set `scaling.enabled: false` in config
   - Note initial agent count: `codex-synaptic agents list --count`

2. **During test:**
   - Monitor resource usage: `codex-synaptic system status --watch`
   - Let agents complete work without interference

3. **After test:**
   - List idle agents: `codex-synaptic agents list --idle`
   - Manually retire: `codex-synaptic agents retire <agent-id>`
   - Re-enable autoscaler: Set `scaling.enabled: true` in config
   - Restart daemon: `codex-synaptic background start`

### For Production Deployments

- **Keep daemon running 24/7** for optimal automation
- **Enable autoscaler** for hands-off resource management
- **Monitor autoscaler events** in the `autoscaler_events` namespace
- **Set appropriate thresholds** based on workload patterns:
  - Default scale-up: 75% utilization
  - Default scale-down: 35% utilization
  - Adjust in `config/system.json` if needed

### For Development Workflows

- **Disable autoscaler** to maintain predictable agent counts
- **Use daemon selectively** based on whether you need lifecycle coordination
- **Manually deploy/retire agents** for precise control during debugging

## 8. Monitoring & Observability

### Key Metrics to Monitor

```bash
# Agent count by type
codex-synaptic agents list --by-type

# Resource utilization
codex-synaptic system status --verbose

# Autoscaler activity
codex-synaptic memory query autoscaler_events --since "1 hour ago"

# Daemon health
codex-synaptic background status
```

### Event Namespaces

- **`autoscaler_events`** – Scale-up/down events and decisions
- **`agent_lifecycle`** – Agent deployment and retirement events
- **`mesh_events`** – Mesh topology changes
- **`consensus_events`** – Consensus decisions (may trigger scaling)

### Alerting Recommendations

Consider setting up alerts for:
- Daemon offline for >5 minutes in production
- Autoscaler repeatedly hitting max agent limit
- Idle agent count exceeding threshold (e.g., >10 for >30 minutes)
- Scale-down failures accumulating (daemon offline)

## 9. Configuration Reference

### Autoscaler Settings (`config/system.json`)

```json
{
  "scaling": {
    "enabled": true,              // Enable/disable autoscaler
    "minAgents": 4,               // Minimum agent count
    "maxAgents": 40,              // Maximum agent count
    "scaleUpThreshold": 0.75,     // Scale up at 75% utilization
    "scaleDownThreshold": 0.35,   // Scale down at 35% utilization
    "cooldownMs": 45000           // 45-second cooldown between actions
  }
}
```

### Related Documentation

- **Consensus Coordination:** `docs/runbooks/validation-gating.md`
- **Telemetry & Metrics:** `docs/observability/README.md`
- **Cheat Codes:** `docs/codex-synaptic-cheat-codes.md`
- **Agent Architecture:** `AGENTS.md`

---

**Last Updated:** 2025-11-05  
**Maintainer:** Codex-Synaptic Platform Team
