# Language-Agnostic Interface Design

## Protocol Selection

- **gRPC + Protocol Buffers**: Swarm, Mesh, Consensus (performance-critical, streaming).
- **REST/JSON**: Agent lifecycle, Memory, Management APIs (simplicity and compatibility).
- **OpenTelemetry**: Observability and tracing across all contexts.

## Versioning Strategy

- Semantic versioning per bounded context API.
- Backward-compatible additions by default.
- Explicit deprecation windows communicated in migration docs.

## Authn/Authz

- OAuth2/JWT for external clients.
- mTLS for inter-service communication.
- Tenant-aware request headers for multi-tenancy.

## Example: Swarm Coordination gRPC API

```protobuf
service SwarmCoordination {
  rpc StartSwarm(StartSwarmRequest) returns (SwarmStatus);
  rpc StopSwarm(StopSwarmRequest) returns (SwarmStatus);
  rpc GetSwarmMetrics(SwarmId) returns (SwarmMetrics);
  rpc UpdateSwarmAlgorithm(UpdateAlgorithmRequest) returns (SwarmStatus);
}

message StartSwarmRequest {
  string algorithm = 1;
  repeated string agent_types = 2;
  string goal = 3;
  map<string, string> parameters = 4;
}
```

## Client Library Targets

- TypeScript (current default)
- Python (data/ML workflows)
- Rust (performance-sensitive extensions)
- Swift (Codex for macOS adapter)
