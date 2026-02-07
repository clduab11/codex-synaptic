# Research Spike: Codex for macOS Integration Surface

## Native macOS Requirements

- Target macOS 14+ and Apple Silicon (M1+).
- Align with sandboxing and background service constraints.

## Agent Management Surface

- Identify how Codex for macOS spawns and manages parallel agents.
- Map enhancer APIs to Codex task lifecycle events (create, delegate, complete).

## Long-Running Task Coordination

- Establish keepalive signals for swarms and consensus workflows.
- Provide cancellation hooks to honor macOS UX controls.

## Extension Points

- Settings toggle to enable enhancer layer.
- Task-level delegation to swarms (opt-in).
- Telemetry hooks for performance and quality metrics.

## IPC Mechanisms

- XPC for native app-to-service messaging.
- Local WebSocket/REST for cross-language adapters.
- gRPC for high-throughput swarm coordination.

## Resource Management

- Coordinate memory/CPU budgets with Codex for macOS.
- Expose quotas and rate limits per swarm.

## Integration Patterns to Explore

- Sidecar process model (enhancer as background service).
- Plugin/extension architecture within Codex for macOS.
- REST/WebSocket API bridge for cross-device use.
- Shared memory/message queue for high-frequency messaging.
