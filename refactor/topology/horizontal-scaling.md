# Horizontal Scaling Strategies

## Agent Pool Scaling

- Autoscale based on task queue depth and resource utilization.
- Enhance `src/core/resources.ts` with predictive scaling signals.
- Support container orchestration for large fleets.

## Mesh Node Scaling

- Add/remove nodes without disrupting topology.
- Use consistent hashing for load distribution.
- Plan for multi-tenant isolation in node placement.

## Consensus Participant Scaling

- Dynamically adjust quorum based on cluster size.
- Maintain low-latency consensus for critical decisions.
- Support multiple consensus groups for high-throughput clusters.

## Performance Targets

- Scale beyond current default limits with consistent latency.
- Maintain consensus latency budgets under load.
- Preserve mesh availability with self-healing.
