# Integration Patterns for Codex for macOS

## Pattern 1: Sidecar Service

- codex-synaptic runs as a background service.
- Codex for macOS communicates via gRPC or WebSocket.
- Benefits: isolation, independent scaling, minimal UX disruption.

## Pattern 2: Plugin/Extension

- codex-synaptic embedded as a macOS extension.
- Direct hooks into the Codex for macOS UI and task pipeline.
- Benefits: low-latency UX, unified settings surface.

## Pattern 3: API Bridge

- Codex for macOS calls enhancer endpoints via REST/JSON.
- Works with remote or local codex-synaptic deployments.
- Benefits: cross-device support, easy observability.

## Pattern 4: IPC Bridge (XPC)

- Native macOS XPC between Codex for macOS and enhancer service.
- Benefits: native sandboxing, resource arbitration.

## Recommendation

- Default to **sidecar service + gRPC** for performance-critical contexts.
- Use **REST/JSON** for management and compatibility endpoints.
- Support **IPC (XPC)** as an optional macOS-optimized path.
