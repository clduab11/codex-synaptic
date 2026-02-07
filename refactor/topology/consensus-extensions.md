# Consensus Layer Extensions

## RAFT Enhancements

### Multi-RAFT
- Partition consensus domains for scalability.
- Separate clusters for deployment, configuration, and task allocation.
- Reduce bottlenecks in large deployments.

### RAFT + BFT Hybrid
- Use RAFT for routine operations.
- Switch to BFT for critical decisions needing byzantine guarantees.
- Define trust boundaries per context.

### Weighted Voting
- Weight votes by expertise, performance history, or stake.
- Prevent low-quality agents from blocking consensus.

## Alternative Mechanisms

### Paxos Variants
- Evaluate Multi-Paxos and Fast Paxos for specific workflows.
- Compare latency and operational complexity against RAFT.

### Gossip-Based Consensus
- Eventual consistency for non-critical decisions.
- Reduce coordination overhead at scale.

### Proof-of-Useful-Work
- Agents earn voting rights by completing verified tasks.
- Enables immutable audit trails for compliance and debugging.

## Implementation Priority

1. Multi-RAFT
2. Weighted voting
3. RAFT + BFT hybrid
