# AGENTS.md - Codex-Synaptic Agent System Architecture

## Overview

The Codex-Synaptic system enhances OpenAI's Codex with advanced multi-agent capabilities, featuring MCP/A2A bridging, neural meshes, swarm coordination, topological constraints, and various consensus mechanisms. This document outlines the comprehensive agent architecture and deployment strategies.

## Core Agent Types

### 1. Worker Agents
Base execution units that perform specific computational tasks.

#### CodeWorker
- **Purpose**: Code generation, analysis, and refactoring
- **Capabilities**: Language-specific code generation, syntax analysis, optimization
- **Interface**: Codex API integration, custom code processing pipelines
- **Deployment**: Single instance or clustered for parallel processing

#### DataWorker  
- **Purpose**: Data processing, transformation, and analysis
- **Capabilities**: ETL operations, statistical analysis, ML preprocessing
- **Interface**: Database connectors, file system access, streaming data
- **Deployment**: Distributed across data sources

#### ValidationWorker
- **Purpose**: Code validation, testing, and quality assurance
- **Capabilities**: Static analysis, test generation, security scanning
- **Interface**: CI/CD integration, testing frameworks
- **Deployment**: Pipeline integration, on-demand validation

#### ResearchWorker
- **Purpose**: Repository reconnaissance and intelligence gathering for Tree-of-Thought planning
- **Capabilities**: Contextual research, insight synthesis, knowledge gap detection
- **Interface**: Documentation corpus, memory system, telemetry feeds
- **Deployment**: Paired with CodeWorkers to keep implementation grounded in latest findings

#### ArchitectWorker
- **Purpose**: Design resilient swarm architectures and rollout strategies
- **Capabilities**: Topology assessment, constraint modelling, phased rollout design
- **Interface**: Neural mesh topology, consensus records, swarm coordinator telemetry
- **Deployment**: Activated upfront for major platform upgrades and backlog governance loops

#### KnowledgeWorker
- **Purpose**: Distil swarm artefacts into documentation and broadcast updates
- **Capabilities**: Knowledge synthesis, documentation drafting, communication packaging
- **Interface**: Persistent memory, docs/, operator channels
- **Deployment**: Runs after ReAcT/ToT cycles to keep humans and agents aligned

#### AnalystWorker
- **Purpose**: Generate heatmaps, scorecards, and analytical briefs to prioritise work
- **Capabilities**: Metric synthesis, risk diagnostics, hotspot reporting
- **Interface**: Telemetry streams, workflow artefacts
- **Deployment**: Activated before planning to sharpen backlog focus

#### SecurityWorker
- **Purpose**: Safeguard the platform with static reviews and threat modelling
- **Capabilities**: Security diagnostics, mitigation planning, guardrail definition
- **Interface**: Code diffs, automation scripts, consensus history
- **Deployment**: Required for high-risk or external-facing changes

#### OpsWorker
- **Purpose**: Produce operational runbooks and snapshots for sustained reliability
- **Capabilities**: Incident playbooks, escalation matrices, ops telemetry curation
- **Interface**: Mesh health metrics, consensus alerts, CLI automation
- **Deployment**: Ensures human operators have actionable guidance during swarms

#### PerformanceWorker
- **Purpose**: Uncover performance hotspots and define optimisation benchmarks
- **Capabilities**: Profiling plans, benchmark design, hotspot recommendation
- **Interface**: Profilers, observability dashboards, automation traces
- **Deployment**: Run before scaling swarms or rolling out automation

#### IntegrationWorker
- **Purpose**: Map Codex-Synaptic workflows to external systems and services
- **Capabilities**: Interface contracts, compatibility matrices, integration stages
- **Interface**: MCP bridge endpoints, external API specs
- **Deployment**: Used when wiring Codex-Synaptic into CI/CD, observability, or partner stacks

#### SimulationWorker
- **Purpose**: Stress-test scenarios with what-if simulations prior to rollout
- **Capabilities**: Monte Carlo scenario modelling, risk envelope analysis
- **Interface**: Swarm coordinator, consensus manager, memory snapshots
- **Deployment**: Validates complex upgrades or automation changes before production

#### MemoryWorker
- **Purpose**: Curate persistent knowledge and keep reasoning artefacts fresh
- **Capabilities**: Namespace audits, archival strategies, tagging and promotion
- **Interface**: Codex memory system, docs/, telemetry logs
- **Deployment**: Scheduled to keep `tot_runs` and related namespaces healthy

#### PlanningWorker
- **Purpose**: Draft strategic roadmaps and translate insights into executable phases
- **Capabilities**: Phase planning, success metrics, roadmap refinement
- **Interface**: Tree-of-Thought outputs, analyst briefs, architecture blueprints
- **Deployment**: Aligns stakeholders before deep swarm engagements

#### ReviewWorker
- **Purpose**: Summarise diffs and enforce quality gates prior to consensus
- **Capabilities**: Checklist generation, highlight extraction, approval preparation
- **Interface**: Code diffs, automation plans, compliance requirements
- **Deployment**: Supports automation worker and consensus coordinator hand-offs

#### CommunicationWorker
- **Purpose**: Broadcast relevant updates to human operators and partner teams
- **Capabilities**: Message composition, digest creation, channel targeting
- **Interface**: Docs, memory artefacts, observability dashboards
- **Deployment**: Ensures transparency throughout multi-phase upgrades

#### AutomationWorker
- **Purpose**: Design automation runbooks, guardrails, and rollout scripts
- **Capabilities**: Workflow scripting, safeguards, trigger definition
- **Interface**: CLI commands, task scheduler, consensus manager
- **Deployment**: Drives repeatable follow-up execution without sacrificing governance

#### ObservabilityWorker
- **Purpose**: Keep telemetry coverage aligned with evolving automation
- **Capabilities**: Dashboard curation, alert tuning, instrumentation planning
- **Interface**: observability backends, swarm metrics, consensus telemetry
- **Deployment**: Run before and after major releases

#### ComplianceWorker
- **Purpose**: Align swarm automation with policy and regulatory requirements
- **Capabilities**: Compliance gap analysis, policy drafting, retention auditing
- **Interface**: Memory retention policies, consensus audit logs, documentation
- **Deployment**: Mandatory for regulated workloads or enterprise rollouts

#### ReliabilityWorker
- **Purpose**: Protect uptime and resilience across mesh, swarm, and consensus layers
- **Capabilities**: Reliability reviews, chaos experiment design, improvement recommendations
- **Interface**: Health monitor, auto-scaler, telemetry
- **Deployment**: Scheduled to keep SLAs on track and expose resilience gaps


### 4. Platform Capabilities

- **Auto-scaling Manager** – monitors CPU/memory and triggers balanced worker scale-up/down, persisting events to `autoscaler_events`.
- **Self-Healing Mesh** – repairs topology gaps automatically and logs activity to `mesh_events`.
- **Vector Memory Service** – optional local/Qdrant/Redis vector store for knowledge retrieval; managed via `vector` config.
- **Cheat Code Catalog** – consult `docs/codex-synaptic-cheat-codes.md` for command combos.
- **Observability Toolkit** – see `docs/observability/README.md` for dashboard + metrics wiring.
- **Consensus Telemetry** – decisions are archived under `consensus_events` for audit trails.

### 2. Coordinator Agents
Higher-level agents that manage and orchestrate worker agents.

#### SwarmCoordinator
- **Purpose**: Multi-agent task distribution and synchronization
- **Capabilities**: Load balancing, task scheduling, resource optimization
- **Interface**: Agent registry, task queue management
- **Deployment**: Central coordination nodes

#### ConsensusCoordinator
- **Purpose**: Distributed decision making and agreement protocols
- **Capabilities**: Byzantine fault tolerance, RAFT consensus, voting mechanisms
- **Interface**: Peer-to-peer communication, state synchronization
- **Deployment**: Distributed consensus network

#### TopologyCoordinator
- **Purpose**: Network structure management and optimization
- **Capabilities**: Dynamic topology adjustment, path optimization, load distribution
- **Interface**: Network graph management, routing protocols
- **Deployment**: Edge and core network positions

### 3. Bridge Agents
Specialized agents for inter-system communication and protocol translation.

#### MCPBridge (Model Control Protocol)
- **Purpose**: Seamless integration between different AI models and systems
- **Capabilities**: Protocol translation, model orchestration, API abstraction
- **Interface**: Multi-model API support, standardized communication protocols
- **Deployment**: Gateway and proxy configurations

#### A2ABridge (Agent-to-Agent)
- **Purpose**: Direct agent communication and collaboration
- **Capabilities**: Secure messaging, capability discovery, task delegation
- **Interface**: Encrypted communication channels, identity verification
- **Deployment**: Mesh network topology

## Neural Mesh Architecture

### Mesh Topology
The neural mesh creates an interconnected network of agents that can:
- Share computational resources dynamically
- Distribute cognitive load across multiple nodes  
- Enable emergent collective intelligence
- Provide fault tolerance through redundancy

### Mesh Components

#### NeuralNode
- Base unit of the neural mesh
- Encapsulates agent logic and state
- Provides standardized interfaces for mesh communication
- Supports hot-swapping and live updates

#### MeshRouter
- Routes information and tasks through the mesh
- Optimizes paths based on node capabilities and load
- Maintains mesh topology and health monitoring
- Handles node discovery and registration

#### SynapticConnection
- Direct communication links between nodes
- Supports different connection types (synchronous, asynchronous, streaming)
- Provides quality of service guarantees
- Enables bandwidth and latency optimization

## Swarm Coordination Mechanisms

### Coordination Patterns

#### Hierarchical Coordination
- Tree-like command structure
- Clear authority and delegation chains
- Suitable for structured, predictable tasks
- Centralized decision making with distributed execution

#### Emergent Coordination
- Self-organizing agent behaviors
- Decentralized decision making
- Adaptive to changing conditions
- Suitable for dynamic, unpredictable environments

#### Hybrid Coordination
- Combines hierarchical and emergent patterns
- Flexible authority structures
- Context-aware coordination switching
- Optimizes for both efficiency and adaptability

### Swarm Algorithms

#### Particle Swarm Optimization (PSO)
- Optimizes agent positions and behaviors
- Balances exploration and exploitation
- Suitable for continuous optimization problems

#### Ant Colony Optimization (ACO)
- Path-finding and resource allocation
- Pheromone-based communication
- Suitable for discrete optimization problems

#### Flocking Algorithms
- Collective movement and coordination
- Separation, alignment, and cohesion rules
- Suitable for spatial coordination tasks

## Consensus Mechanisms

### Byzantine Fault Tolerant (BFT) Consensus
- Handles malicious or faulty agents
- Guarantees safety and liveness properties
- Suitable for critical decision-making processes
- Requires 3f+1 agents to tolerate f failures

### RAFT Consensus
- Leader-based consensus for log replication
- Simpler than BFT, assumes non-malicious failures
- Suitable for state machine replication
- Provides strong consistency guarantees

### Proof of Work (PoW)
- Computational puzzle-based consensus
- Suitable for open, permissionless networks
- Energy-intensive but highly secure
- Used for critical system updates

### Proof of Stake (PoS)
- Stake-based voting mechanism
- More energy-efficient than PoW
- Suitable for resource allocation decisions
- Aligns incentives with system health

## Topological Constraints

### Network Constraints
- **Bandwidth limits**: Maximum data throughput between agents
- **Latency requirements**: Real-time communication needs
- **Connectivity constraints**: Physical or logical network limitations
- **Security boundaries**: Trust zones and access controls

### Computational Constraints
- **Resource limits**: CPU, memory, and storage constraints
- **Processing priorities**: Critical vs. background tasks
- **Capability matching**: Ensuring agents can perform assigned tasks
- **Load balancing**: Preventing resource bottlenecks

### Organizational Constraints
- **Authority hierarchies**: Permission and delegation structures
- **Information flow**: Data access and sharing policies
- **Compliance requirements**: Regulatory and policy constraints
- **Quality of service**: Performance and reliability guarantees

## Deployment Architecture

### CLI Deployment System
The command-line interface provides comprehensive deployment and management capabilities:

```bash
# Deploy a simple worker agent
codex-synaptic deploy worker --type code --replicas 3

# Create a neural mesh with specific topology
codex-synaptic mesh create --nodes 10 --topology ring --consensus raft

# Start swarm coordination with PSO optimization
codex-synaptic swarm start --algorithm pso --agents worker:5,coordinator:2

# Configure MCP bridging between systems
codex-synaptic bridge mcp --source codex-api --target local-model --protocol grpc
```

### Configuration Management

#### Agent Manifests
YAML/JSON configurations defining agent specifications:
- Resource requirements and limits
- Capability declarations
- Network and security policies
- Deployment and scaling rules

#### Topology Definitions
Network topology specifications:
- Node connectivity patterns
- Communication protocols
- Routing and load balancing rules
- Fault tolerance configurations

#### Consensus Configurations
Consensus mechanism parameters:
- Algorithm selection and tuning
- Voting thresholds and timeouts
- Leader election procedures
- State synchronization policies

## Security Architecture

### Identity and Authentication
- Public key cryptography for agent identity
- Certificate-based authentication
- Role-based access control (RBAC)
- Capability-based security model

### Communication Security
- End-to-end encryption for all agent communications
- Perfect forward secrecy
- Message authentication and integrity
- Protection against replay attacks

### System Integrity
- Code signing for agent deployments
- Secure boot and attestation
- Runtime integrity monitoring
- Anomaly detection and response

## Monitoring and Observability

### Metrics Collection
- Performance metrics (latency, throughput, resource utilization)
- Business metrics (task completion, success rates)
- System health (node availability, network connectivity)
- Security metrics (authentication events, anomalies)

### Distributed Tracing
- End-to-end request tracing across agents
- Performance bottleneck identification
- Error propagation analysis
- System dependency mapping

### Alerting and Response
- Automated anomaly detection
- Escalation procedures
- Self-healing capabilities
- Human operator integration

## Future Extensions

### Planned Enhancements
- Quantum-resistant cryptography
- Advanced ML model integration
- Cross-cloud deployment support
- Edge computing optimization
- Integration with blockchain networks
- Advanced visualization and debugging tools

### Research Directions
- Emergent intelligence from agent interactions
- Adaptive consensus mechanisms
- Self-modifying agent architectures
- Advanced swarm intelligence algorithms
- Integration with neuromorphic computing

## Agent Development Playbook

This section provides operational guidance for working with agents inside Codex-Synaptic, including how to reason about the orchestration runtime and extend the system safely. Use it alongside the CLI help output and the module-level documentation in `src/`.

### Runtime Overview

The `CodexSynapticSystem` (see `src/core/system.ts`) coordinates several subsystems:

- **Agent Registry (`src/agents/registry.ts`)** – Tracks lifecycle, status, capabilities, and resource usage for every agent instance.
- **Task Scheduler (`src/core/scheduler.ts`)** – Assigns queued work to available agents based on capabilities and priority.
- **Neural Mesh (`src/mesh`)** – Maintains graph-based connectivity, enforces topology constraints, and exposes metrics for telemetry.
- **Swarm Coordinator (`src/swarm`)** – Runs PSO/ACO/flocking optimisers for collaborative problem solving and hive-mind scenarios.
- **Consensus Manager (`src/consensus`)** – Manages proposals, votes, and quorum checks for distributed decisions.
- **Bridges (`src/bridging`, `src/mcp`)** – Provide controlled ingress/egress for MCP and A2A messaging.
- **Memory System (`src/memory/memory-system.ts`)** – SQLite-backed persistent storage for agent interactions and artefacts under `~/.codex-synaptic/memory.db`.
- **Telemetry & Health (`src/core/health.ts`, `src/core/resources.ts`)** – Surfaced via CLI commands and used to gate scaling/auto-healing decisions.

### Built-in Agent Roles

| Agent Type | Purpose | Key Implementation |
|------------|---------|--------------------| 
| `code_worker` | Code generation, refactoring, and implementation tasks | `src/agents/code_worker.ts` |
| `data_worker` | Data preparation, analysis, and transformation | `src/agents/data_worker.ts` |
| `validation_worker` | Verification, linting, and quality gates | `src/agents/validation_worker.ts` |
| `swarm_coordinator` | Supervises swarm objectives and metrics | `src/agents/swarm_coordinator.ts` |
| `consensus_coordinator` | Runs vote aggregation and conflict resolution | `src/agents/consensus_coordinator.ts` |
| `topology_coordinator` | Adjusts mesh connectivity and constraints | `src/agents/topology_coordinator.ts` |
| `mcp_bridge` / `a2a_bridge` | Translate external requests into internal tasks | `src/agents/mcp_bridge_agent.ts`, `src/agents/a2a_bridge_agent.ts` |

### Execution Flow

1. **System start** – `codex-synaptic system start` boots the orchestrator, loads configuration, and initialises telemetry, GPU probes, and memory storage.
2. **Agent bootstrap** – Default agents are registered; additional replicas can be deployed via `codex-synaptic agent deploy`.
3. **Mesh configuration** – Mesh defaults can be tuned (`codex-synaptic mesh configure --nodes 8 --topology mesh`) before dispatching complex tasks.
4. **Swarm activation** – `codex-synaptic swarm start --algorithm pso` enables collaborative optimisation loops used by hive-mind workflows.
5. **Task dispatch** – Tasks submitted through the CLI or API enter the scheduler queue, receive capability-matched agents, and stream status events.
6. **Consensus checks** – Critical decisions (e.g., promotion of artefacts) can be gated behind proposals/votes via `codex-synaptic consensus ...` commands.
7. **Telemetry + persistence** – Health snapshots, resource metrics, and memory entries are persisted so the background daemon and CLI can resume seamlessly.

### Agent Development Guidelines

- **Keep responsibilities focused.** New agent types should expose clear capabilities and register them through the agent registry utilities.
- **Instrument long running tasks.** Emit progress and heartbeat events so the scheduler keeps accurate status and the telemetry surface stays fresh.
- **Respect resource limits.** Read limits from `ResourceManager` and avoid allocating beyond configured CPU/memory bounds.
- **Integrate with memory.** Use `CodexMemorySystem` to store durable artefacts or contextual knowledge shared across runs.
- **Participate in consensus when required.** Agents that introduce risky changes should submit proposals or votes with enough context for auditability.

### CLI Workflow Tips

- Run `codex-synaptic system monitor` in a dedicated terminal when developing new agent logic.
- Use the `background` commands to keep long-running coordination alive between sessions.
- Combine `mesh` and `swarm` commands to stress-test new strategies before exposing them to production tasks.
- Query `codex-synaptic task recent` to audit how prompts flow through the system and to inspect generated artefacts.

### Extending the Platform

1. Scaffold a new agent under `src/agents/` and register it with the agent registry.
2. Add capabilities and resource requirements so the scheduler can route work correctly.
3. Update CLI help (if you expose new coordination primitives) in `src/cli/index.ts`.
4. Document the new workflow in `docs/` or the README so operators understand how to invoke it.
5. Add corresponding Vitest coverage under `tests/` to lock in behaviour.

Following these conventions keeps the Codex-Synaptic ecosystem consistent and makes it easier for the CLI, telemetry, and automation hooks to reason about every agent in the mesh.

## Conclusion

The Codex-Synaptic agent system provides a comprehensive framework for enhancing OpenAI's Codex with advanced distributed computing capabilities. Through careful orchestration of various agent types, consensus mechanisms, and coordination patterns, the system can tackle complex computational challenges that require distributed intelligence, fault tolerance, and scalable coordination.
