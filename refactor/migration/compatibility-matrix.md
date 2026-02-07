# Backward Compatibility Matrix

| Component | Old Path | New Path | Compatibility Strategy | Milestone |
| --- | --- | --- | --- | --- |
| CLI Commands | `src/cli/index.ts` | `packages/cli/` | Proxy old commands to new implementation | Migration Phase 3 |
| Agent Types | `src/agents/` | `packages/agent-lifecycle/` | Maintain agent registry compatibility | Migration Phase 2–3 |
| Swarm Algorithms | `src/swarm/` | `packages/swarm-coordination/` | API wrapper for old interfaces | Migration Phase 2 |
| Mesh Topology | `src/mesh/` | `packages/neural-mesh/` | Topology migration utility | Migration Phase 2–3 |
| Consensus | `src/consensus/` | `packages/consensus/` | Protocol version negotiation | Migration Phase 2 |
| Memory System | `src/memory/` | `packages/memory-knowledge/` | Database schema migration | Migration Phase 3 |
| Configuration | `config/system.json` | `packages/core/config/` | Config file converter | Migration Phase 3 |
