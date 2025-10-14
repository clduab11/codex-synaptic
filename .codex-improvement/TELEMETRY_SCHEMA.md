# Telemetry Schema v1.0

## Overview

The telemetry system provides comprehensive observability for the codex-synaptic distributed agent orchestration platform. It captures events, metrics, and traces across all system components to enable monitoring, debugging, and performance optimization with structured data collection and export capabilities.

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Components    │    │  Telemetry Bus  │    │   Exporters     │
│   (Agents,      │───►│   (Collection   │───►│  (Prometheus,   │
│    Mesh, Swarm, │    │    & Routing)   │    │   Jaeger, etc.) │
│    Consensus)   │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Event Schema

### Base Event Structure

All events conform to this base schema:

```yaml
event_id: string          # Unique event identifier (UUID)
timestamp: number         # Unix timestamp (milliseconds)
component: string         # Source component (agent, mesh, swarm, etc.)
event_type: string        # Specific event type
severity: enum            # TRACE, DEBUG, INFO, WARN, ERROR, FATAL
tags: object             # Key-value metadata tags
context: object          # Additional contextual data
```

### Agent Lifecycle Events

**Event Type:** `agent.lifecycle`

```yaml
event_type: "agent.lifecycle"
component: "agent"
data:
  agent_id: string        # Agent unique identifier
  agent_type: string      # Agent type (code_worker, consensus_coordinator, etc.)
  state_from: string      # Previous state
  state_to: string        # New state
  transition_reason: string # Reason for state change
  resource_usage:         # Current resource consumption
    cpu_percent: number
    memory_mb: number
    network_bytes: number
```

**States:** `initializing`, `running`, `idle`, `busy`, `error`, `shutting_down`, `offline`

**Description:** Agent state transitions and resource consumption tracking for performance monitoring and lifecycle management.

### Swarm Iteration Events

**Event Type:** `swarm.iteration`

```yaml
event_type: "swarm.iteration"
component: "swarm" 
data:
  swarm_id: string        # Swarm instance identifier
  algorithm: string       # Optimization algorithm (pso, aco, flocking)
  iteration: number       # Current iteration number
  convergence_score: number # Convergence metric (0.0-1.0)
  best_fitness: number    # Best fitness value found
  parameters: object      # Algorithm-specific parameters
```

**Description:** Swarm optimization progress and convergence metrics for algorithm performance analysis and tuning.

### Consensus Proposal Events

**Event Type:** `consensus.proposal`

```yaml
event_type: "consensus.proposal"
component: "consensus"
data:
  proposal_id: string     # Proposal unique identifier
  proposal_type: string   # Type of proposal
  votes_for: number       # Votes in favor
  votes_against: number   # Votes against
  quorum_reached: boolean # Whether quorum was achieved
  decision_time_ms: number # Time to reach decision
```

**Description:** Consensus decision tracking with voting results and timing metrics for governance analysis.

### Memory Bridge Sync Events

**Event Type:** `memory.bridge.sync`

```yaml
event_type: "memory.bridge.sync"
component: "memory_bridge"
data:
  namespace: string       # Memory namespace being synchronized
  sync_strategy: string   # Reconciliation strategy used
  conflicts_resolved: number # Number of conflicts resolved
  sync_duration_ms: number # Synchronization time
  status: string          # Success/failure status
```

**Description:** Memory bridge synchronization events and conflict resolution tracking for data consistency monitoring.

### Mesh Topology Change Events

**Event Type:** `mesh.topology.change`

```yaml
event_type: "mesh.topology.change"
component: "neural_mesh"
data:
  node_id: string         # Node identifier
  change_type: string     # Type of topology change
  connections_added: number # New connections established
  connections_removed: number # Connections terminated
  topology_health: number # Overall mesh health score
```

**Description:** Neural mesh topology updates and connectivity changes for network health monitoring.

### Security Policy Violation Events

**Event Type:** `security.policy.violation`

```yaml
event_type: "security.policy.violation"
component: "security"
data:
  agent_id: string        # Agent that violated policy
  policy_type: string     # Type of policy violated
  violation_details: string # Specific violation description
  severity: string        # Violation severity level
  action_taken: string    # Enforcement action applied
```

**Description:** Security policy violations and enforcement actions for threat detection and response.

### Task Execution Events

**Event Type:** `task.execution`

```yaml
event_type: "task.execution"
component: "task_scheduler"
data:
  task_id: string         # Task unique identifier
  agent_id: string        # Executing agent identifier
  task_type: string       # Type of task
  duration_ms: number     # Execution duration
  success: boolean        # Execution success status
  error_type: string      # Error type if failed
  resource_usage: object  # Resource consumption during execution
```

**Description:** Task execution tracking with performance and error details for system optimization.

## Metrics Schema

### Gauge Metrics

Distribution of current state measurements.

#### System Health
- **`agent.active`**: Number of currently active agents
- **`mesh.node.count`**: Total nodes in neural mesh
- **`memory.bridge.sync_lag_ms`**: Current synchronization lag between TS and Python stores
- **`consensus.active_proposals`**: Number of consensus proposals awaiting decision

### Counter Metrics

Cumulative counts of events over time.

#### Task Performance
- **`task.completed`**: Total completed tasks with success/failure breakdown
  - Labels: `agent_type`, `task_type`, `success`
- **`task.failed`**: Failed task count by agent and error type
  - Labels: `agent_type`, `error_type`

#### Security
- **`security.violations`**: Security policy violations by type and severity
  - Labels: `policy_type`, `severity`

#### Memory Operations
- **`memory.bridge.operations`**: Memory bridge operations with success/failure tracking
  - Labels: `operation_type`, `namespace`, `success`
- **`tool.usage.total`**: Count of tool invocations captured by the optimiser telemetry
  - Labels: `tool_id`, `agent_type`, `success`
- **`reasoning.runs.total`**: Count of reasoning plans executed
  - Labels: `plan_type`, `status`
- **`reasoning.checkpoints.total`**: Number of checkpoints persisted per reasoning plan
  - Labels: `plan_id`, `status`

### Histogram Metrics

Distribution of measured values over time.

#### Performance
- **`consensus.decision_time_ms`**: Time to reach consensus decisions
  - Buckets: [10, 50, 100, 500, 1000, 5000, 10000]
- **`swarm.convergence_iterations`**: Iterations required for convergence
  - Buckets: [10, 25, 50, 100, 250, 500, 1000]
- **`task.execution_time_ms`**: Task execution duration
  - Buckets: [100, 500, 1000, 5000, 10000, 30000, 60000]
- **`memory.bridge.query_latency_ms`**: Memory bridge query response time distribution
  - Buckets: [1, 5, 10, 25, 50, 100, 250, 500]
- **`tool.latency_ms`**: Execution latency for tool calls captured in telemetry
  - Buckets: [10, 25, 50, 100, 250, 500, 1000, 5000]
- **`reasoning.plan_duration_ms`**: Duration from plan creation to completion (or failure)
  - Buckets: [100, 250, 500, 1000, 5000, 15000, 60000]

### Gauge Metrics (Derived)
- **`tool.usage.success_ratio`**: Success ratio for a tool windowed over recent runs (0.0-1.0)
  - Labels: `tool_id`, `agent_type`

## Implementation Guidelines

### Event Emission

```typescript
// TypeScript example
import { TelemetryBus } from '../telemetry/bus.js';

const telemetry = TelemetryBus.getInstance();

telemetry.emitEvent('agent.lifecycle', {
  agent_id: this.id,
  agent_type: this.type,
  state_from: 'idle',
  state_to: 'running',
  transition_reason: 'task_assigned',
  resource_usage: {
    cpu_percent: 15.5,
    memory_mb: 128,
    network_bytes: 1024
  }
});
```

### Metric Recording

```typescript
// TypeScript example
import { Metrics } from '../telemetry/metrics.js';

// Increment counter
Metrics.counter('task.completed.total').increment({
  agent_type: 'code_worker',
  task_type: 'code_generation',
  success: 'true'
});

// Record histogram value
Metrics.histogram('task.execution_time_ms').record(1250, {
  task_type: 'code_generation'
});

// Set gauge value
Metrics.gauge('agent.active').set(12);
```

### Performance Considerations

- **Sampling**: Use sampling for high-frequency events to reduce overhead
- **Batching**: Batch metric updates to reduce I/O operations
- **Async Emission**: Use asynchronous event emission to avoid blocking operations
- **Buffer Management**: Configure appropriate buffer sizes for event queues

### Data Retention

```yaml
retention:
  events:
    high_frequency: 7_days    # Agent lifecycle, task execution
    medium_frequency: 30_days # Swarm iterations, mesh changes
    low_frequency: 90_days    # Consensus decisions, security events
  metrics:
    raw_data: 15_days
    aggregated_5m: 30_days
    aggregated_1h: 365_days
    aggregated_1d: 1825_days  # 5 years
```

### Export Configuration

#### Prometheus Export
```yaml
prometheus:
  endpoint: "/metrics"
  port: 9090
  scrape_interval: 15s
  metric_prefix: "codex_synaptic_"
```

#### Jaeger Tracing
```yaml
jaeger:
  agent_host: "localhost"
  agent_port: 6832
  service_name: "codex-synaptic"
  sampling_rate: 0.1
```

#### Custom Exporters
```yaml
custom_exporters:
  - name: "elasticsearch"
    type: "events"
    config:
      endpoint: "https://elasticsearch.example.com"
      index_pattern: "codex-synaptic-{date}"
  - name: "influxdb"
    type: "metrics"
    config:
      endpoint: "https://influxdb.example.com"
      database: "codex_metrics"
```

## Monitoring Dashboards

### System Overview Dashboard
- Agent status and distribution
- System resource utilization
- Task execution rates and success ratios
- Network topology health

### Performance Dashboard
- Swarm convergence trends
- Consensus decision latency
- Memory bridge performance
- Task execution time distributions

### Security Dashboard
- Policy violation trends
- Threat detection alerts
- Security metric anomalies
- Incident response status

### Operational Dashboard
- System uptime and availability
- Error rates and patterns
- Resource capacity planning
- Deployment and rollback tracking

## Alerting Rules

### Critical Alerts (Immediate Response)
- System down or unreachable
- Security breach detected
- Data corruption events
- Resource exhaustion (>95% utilization)

### Warning Alerts (15-minute response)
- High error rates (>5%)
- Performance degradation (>2x baseline)
- Consensus delays (>10s average)
- Memory bridge sync failures

### Info Alerts (Daily digest)
- Capacity planning thresholds
- Performance trends
- Security audit results
- System health reports
  vote: boolean          # true = approve, false = reject
  reasoning: string       # Vote justification
  vote_weight: number     # Vote influence (default: 1.0)
```

**Event Type:** `consensus.decision`

```yaml
event_type: "consensus.decision"
component: "consensus"
data:
  proposal_id: string     # Decided proposal
  decision: enum          # APPROVED, REJECTED, TIMEOUT
  votes_for: number       # Approval votes
  votes_against: number   # Rejection votes
  vote_threshold: number  # Required threshold
  decision_time_ms: number # Time to reach decision
```

### Neural Mesh Events

**Event Type:** `mesh.topology_change`

```yaml
event_type: "mesh.topology_change"
component: "mesh"
data:
  change_type: enum       # NODE_ADDED, NODE_REMOVED, CONNECTION_ADDED, CONNECTION_REMOVED
  node_id: string         # Affected node (agent)
  target_node_id: string  # Second node (for connections)
  node_count: number      # Total nodes after change
  connection_count: number # Total connections after change
  topology_hash: string   # Hash of current topology
```

### Task Execution Events

**Event Type:** `task.assigned`

```yaml
event_type: "task.assigned"
component: "scheduler"
data:
  task_id: string         # Task unique identifier
  agent_id: string        # Assigned agent
  task_type: string       # Type of task
  priority: number        # Task priority (1-10)
  estimated_duration_ms: number
  dependencies: array     # Dependent task IDs
```

**Event Type:** `task.completed`

```yaml
event_type: "task.completed"
component: "scheduler"
data:
  task_id: string         # Completed task
  agent_id: string        # Executing agent
  duration_ms: number     # Actual execution time
  result_size_bytes: number
  success: boolean        # Task success status
  error_message: string   # Error details (if failed)
```

### Bridge Communication Events

**Event Type:** `bridge.message`

```yaml
event_type: "bridge.message"
component: "bridge"
data:
  bridge_type: enum       # MCP, A2A
  direction: enum         # INBOUND, OUTBOUND
  message_id: string      # Message identifier
  source: string          # Message source
  destination: string     # Message destination
  message_type: string    # Protocol-specific message type
  payload_size_bytes: number
  processing_time_ms: number
```

### Security Events

**Event Type:** `security.violation`

```yaml
event_type: "security.violation"
component: "security"
data:
  violation_type: enum    # UNAUTHORIZED_ACCESS, RESOURCE_LIMIT, INVALID_INPUT
  source_agent: string    # Violating agent (if applicable)
  resource: string        # Affected resource
  attempted_action: string # What was attempted
  policy_violated: string # Which policy was violated
  blocked: boolean        # Whether action was blocked
  severity: enum          # LOW, MEDIUM, HIGH, CRITICAL
```

## Metrics Schema

### Gauge Metrics

Instantaneous measurements at a point in time.

#### System Health
- `agent.active`: Number of active agents
- `mesh.node.count`: Total neural mesh nodes
- `mesh.connection.count`: Total mesh connections
- `swarm.particles.active`: Active optimization particles
- `consensus.proposals.pending`: Pending consensus proposals

#### Resource Usage
- `system.memory.used_mb`: System memory usage
- `system.cpu.usage_percent`: CPU utilization
- `system.disk.free_gb`: Available disk space
- `network.connections.active`: Active network connections

### Counter Metrics

Monotonically increasing values.

#### Task Execution
- `task.assigned.total`: Total tasks assigned
- `task.completed.total`: Total tasks completed  
- `task.failed.total`: Total failed tasks
- `task.cancelled.total`: Total cancelled tasks

#### Security
- `security.violations.total`: Total security violations
- `security.authentications.total`: Total authentication attempts
- `security.authorizations.denied.total`: Denied authorization requests

#### Bridge Operations
- `bridge.messages.sent.total`: Total messages sent
- `bridge.messages.received.total`: Total messages received
- `bridge.connections.established.total`: Total connections established
- `bridge.errors.total`: Total bridge errors

### Histogram Metrics

Distribution of measured values over time.

#### Performance
- `consensus.decision_time_ms`: Time to reach consensus decisions
- `swarm.convergence_iterations`: Iterations required for convergence
- `task.execution_time_ms`: Task execution duration
- `mesh.message_latency_ms`: Inter-node message latency

#### Resource Efficiency
- `agent.memory_usage_mb`: Agent memory consumption distribution
- `agent.cpu_time_ms`: Agent CPU time usage
- `bridge.payload_size_bytes`: Message payload size distribution

## Collection Configuration

### Sampling Strategies

#### High-Frequency Events
- **Agent Lifecycle**: 100% sampling
- **Security Events**: 100% sampling
- **Consensus Decisions**: 100% sampling

#### Medium-Frequency Events  
- **Task Execution**: 100% sampling for errors, 10% for success
- **Mesh Topology Changes**: 100% sampling

#### High-Volume Events
- **Swarm Iterations**: 1% sampling (every 100th iteration)
- **Bridge Messages**: 0.1% sampling (every 1000th message)

### Retention Policies

```yaml
retention:
  events:
    high_priority: 90d      # Security, errors, consensus
    medium_priority: 30d    # Task execution, topology changes
    low_priority: 7d        # Debug traces, routine operations
  metrics:
    raw_data: 7d           # Full resolution metrics
    aggregated_hourly: 30d  # Hourly aggregations
    aggregated_daily: 365d  # Daily aggregations
```

## Export Formats

### Prometheus Format

```yaml
# HELP agent_active Number of active agents
# TYPE agent_active gauge
agent_active{instance="codex-synaptic-1"} 12

# HELP task_execution_time_ms Task execution duration
# TYPE task_execution_time_ms histogram
task_execution_time_ms_bucket{le="100"} 45
task_execution_time_ms_bucket{le="500"} 78
task_execution_time_ms_bucket{le="+Inf"} 89
task_execution_time_ms_sum 12450
task_execution_time_ms_count 89
```

### OpenTelemetry Format

```yaml
resource:
  attributes:
    service.name: "codex-synaptic"
    service.version: "1.0.0"
    deployment.environment: "production"

instrumentationScope:
  name: "codex-synaptic-telemetry"
  version: "1.0.0"

spans:
  - traceId: "abc123"
    spanId: "def456" 
    name: "consensus.decision"
    kind: SPAN_KIND_INTERNAL
    startTimeUnixNano: 1640995200000000000
    endTimeUnixNano: 1640995200500000000
    attributes:
      proposal.id: "proposal-123"
      votes.for: 5
      votes.against: 1
```

### JSON Event Format

```yaml
{
  "event_id": "evt_abc123",
  "timestamp": 1640995200000,
  "component": "swarm",
  "event_type": "swarm.iteration",
  "severity": "INFO",
  "tags": {
    "environment": "production",
    "version": "1.0.0"
  },
  "data": {
    "swarm_id": "swarm_001",
    "algorithm": "pso",
    "iteration": 42,
    "convergence_score": 0.85,
    "best_fitness": 1.23
  }
}
```

## Implementation Guidelines

### Event Emission

```typescript
// TypeScript example
import { TelemetryBus } from '../telemetry/bus.js';

const telemetry = TelemetryBus.getInstance();

telemetry.emitEvent('agent.lifecycle', {
  agent_id: this.id,
  agent_type: this.type,
  state_from: 'idle',
  state_to: 'running',
  transition_reason: 'task_assigned'
});
```

### Metric Recording

```typescript
// TypeScript example
import { Metrics } from '../telemetry/metrics.js';

// Increment counter
Metrics.counter('task.completed.total').increment({
  agent_type: 'code_worker',
  success: 'true'
});

// Record histogram value
Metrics.histogram('task.execution_time_ms').record(1250, {
  task_type: 'code_generation'
});

// Set gauge value
Metrics.gauge('agent.active').set(12);
```

### Error Handling

- **Non-blocking**: Telemetry failures must not impact system operation
- **Circuit Breaker**: Disable telemetry if export consistently fails
- **Local Buffering**: Queue events during export outages
- **Graceful Degradation**: Reduce sampling under resource pressure

## Performance Considerations

### Resource Overhead
- **CPU Impact**: <2% additional CPU usage
- **Memory Usage**: <50MB buffer for high-frequency events
- **Network Bandwidth**: <1Mbps for typical workloads
- **Storage Growth**: ~100MB/day for standard operation

### Optimization Strategies
- **Batch Processing**: Group events for efficient export
- **Compression**: Use compression for network transport
- **Filtering**: Client-side filtering before export
- **Async Processing**: Non-blocking event emission
- **Connection Pooling**: Reuse connections to export targets

## Security and Privacy

### Data Protection
- **Sensitive Data**: Exclude secrets and PII from events
- **Access Control**: Restrict telemetry data access
- **Encryption**: Encrypt data in transit and at rest
- **Audit Trail**: Log access to telemetry data

### Compliance
- **Data Retention**: Honor retention policy requirements
- **Right to Deletion**: Support data deletion requests
- **Data Minimization**: Collect only necessary information
- **Consent Management**: Respect privacy preferences
