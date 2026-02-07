# Research Spike: claude-flow Analysis

**Repository**: https://github.com/ruvnet/claude-flow

## Architecture Patterns

- Flow graph orchestration with explicit nodes, edges, and execution policies.
- Modular adapters for model providers and tool integrations.
- Emphasis on composable workflows over monolithic pipelines.

## MCP Protocol Integration

- claude-flow emphasizes native MCP compatibility to integrate toolchains.
- Compare with `src/bridging/` and `src/mcp/` to align adapter naming and capability exposure.

## Distributed Swarm Intelligence

- Focus on flow-based coordination rather than PSO/ACO/flocking.
- Opportunity: expose swarm algorithms as flow nodes, enabling hybrid orchestration.

## RAG Integration

- Pipeline-driven retrieval steps (query → fetch → rank → synthesize).
- Potential alignment with `src/memory/memory-system.ts` for pluggable retrieval stages.

## Enterprise Features

- Emphasis on multi-tenant isolation, policy gating, and observability.
- Aligns with codex-synaptic tenancy and telemetry subsystems.

## Reusable Patterns to Consider

1. **Flow definitions as contracts**: store flow specs in shared schemas for cross-context use.
2. **Policy gates as nodes**: treat consensus checks as pluggable gates.
3. **Tool routing layers**: unify tool selection logic across MCP and CLI.
4. **Execution telemetry hooks**: standardize span naming for flow steps.
5. **Adapter registry**: map providers and tools without hard-coding.

## Integration Opportunities

- Model a Codex for macOS task as a flow that calls swarm algorithms as steps.
- Allow macOS UI to select or visualize flows with consensus gating.
- Reuse claude-flow patterns for workflow templating in `shared/contracts`.
