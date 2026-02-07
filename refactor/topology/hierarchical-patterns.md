# Hierarchical Swarm Patterns

## Command Hierarchy

- SwarmCoordinator → TeamLeaders → Workers.
- Clear delegation chains for complex multi-step tasks.
- Works well for GOAP workflows and Tree-of-Thought planning.

## Functional Hierarchy

- Organize agents by capability domains (Code, Data, Security, Ops).
- Domain-specific coordinators with cross-domain collaboration.
- Mirrors current agent taxonomy in `AGENTS.md`.

## Dynamic Hierarchy

- Agents elect leaders based on expertise and performance.
- Inspired by RAFT leader election in `src/consensus/`.
- Fault-tolerant leadership with automatic failover.

## Codex for macOS Integration

- Map hierarchy to macOS task management views.
- Enable delegation to hierarchical swarms for complex tasks.
- Provide UI visibility into hierarchy structure and decisions.
