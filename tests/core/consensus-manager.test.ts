import { describe, expect, it } from 'vitest';
import { AgentRegistry } from '../../src/agents/registry';
import { AgentStatus, AgentType } from '../../src/core/types';
import { ConsensusManager } from '../../src/consensus/manager';

function registerConsensusAgents(registry: AgentRegistry, count: number): void {
  for (let i = 0; i < count; i += 1) {
    const agentId = {
      id: `consensus-${i}`,
      type: AgentType.CONSENSUS_COORDINATOR,
      version: '1.0.0'
    };
    registry.registerAgent({
      id: agentId,
      capabilities: [],
      resources: { cpu: 1, memory: 128, storage: 10, bandwidth: 10 },
      networkInfo: { address: '127.0.0.1', port: 0, protocol: 'tcp', endpoints: [] },
      status: AgentStatus.IDLE,
      created: new Date(),
      lastUpdated: new Date()
    });
  }
}

function registerVotingAgents(registry: AgentRegistry): void {
  // Register 1 consensus coordinator
  const consensusId = {
    id: 'consensus-1',
    type: AgentType.CONSENSUS_COORDINATOR,
    version: '1.0.0'
  };
  registry.registerAgent({
    id: consensusId,
    capabilities: [],
    resources: { cpu: 1, memory: 128, storage: 10, bandwidth: 10 },
    networkInfo: { address: '127.0.0.1', port: 0, protocol: 'tcp', endpoints: [] },
    status: AgentStatus.IDLE,
    created: new Date(),
    lastUpdated: new Date()
  });

  // Register 1 review worker
  const reviewId = {
    id: 'review-1',
    type: AgentType.REVIEW_WORKER,
    version: '1.0.0'
  };
  registry.registerAgent({
    id: reviewId,
    capabilities: [],
    resources: { cpu: 1, memory: 128, storage: 10, bandwidth: 10 },
    networkInfo: { address: '127.0.0.1', port: 0, protocol: 'tcp', endpoints: [] },
    status: AgentStatus.IDLE,
    created: new Date(),
    lastUpdated: new Date()
  });

  // Register 1 planning worker
  const planningId = {
    id: 'planning-1',
    type: AgentType.PLANNING_WORKER,
    version: '1.0.0'
  };
  registry.registerAgent({
    id: planningId,
    capabilities: [],
    resources: { cpu: 1, memory: 128, storage: 10, bandwidth: 10 },
    networkInfo: { address: '127.0.0.1', port: 0, protocol: 'tcp', endpoints: [] },
    status: AgentStatus.IDLE,
    created: new Date(),
    lastUpdated: new Date()
  });
}

describe('ConsensusManager configuration', () => {
  it('calculates BFT quorum with fault tolerance', () => {
    const registry = new AgentRegistry();
    registerConsensusAgents(registry, 5);
    const manager = new ConsensusManager(registry, {
      mechanism: 'bft',
      timeout: 5000,
      minVotes: 3,
      faultTolerance: 1
    });

    const proposalId = manager.proposeConsensus('test', {}, registry.getAgentsByType(AgentType.CONSENSUS_COORDINATOR)[0].id);
    const proposal = manager.getProposal(proposalId);
    expect(proposal?.requiredVotes).toBe(4); // 3f + 1
    expect(proposal?.mechanism).toBe('bft');
  });

  it('records stake requirements for PoS mode', () => {
    const registry = new AgentRegistry();
    registerConsensusAgents(registry, 3);
    const stakeTable = {
      'consensus-0': 2,
      'consensus-1': 1,
      'consensus-2': 1
    };

    const manager = new ConsensusManager(registry, {
      mechanism: 'pos',
      timeout: 5000,
      minVotes: 2,
      stakeThreshold: 0.75,
      stakeTable
    });

    const proposalId = manager.proposeConsensus('pos-test', {}, registry.getAgentsByType(AgentType.CONSENSUS_COORDINATOR)[0].id);
    const proposal = manager.getProposal(proposalId);
    expect(proposal?.mechanism).toBe('pos');
    expect(proposal?.requiredStake).toBeCloseTo(4 * 0.75);
  });

  it('includes review and planning workers as voting agents', () => {
    const registry = new AgentRegistry();
    registerVotingAgents(registry);

    const manager = new ConsensusManager(registry, {
      mechanism: 'raft',
      timeout: 5000,
      minVotes: 2,
      quorumFactor: 0.4
    });

    const consensusAgent = registry.getAgentsByType(AgentType.CONSENSUS_COORDINATOR)[0];
    const proposalId = manager.proposeConsensus('voting-test', {}, consensusAgent.id);
    const proposal = manager.getProposal(proposalId);

    // Should calculate based on 3 voting agents in this test (1 consensus + 1 review + 1 planning)
    // Note: bootstrap deploys 4 voting agents total (2 consensus + 1 review + 1 planning)
    // With quorumFactor 0.4, we need ceil(3 * 0.4) = 2 votes minimum
    expect(proposal?.requiredVotes).toBe(2);
    expect(proposal?.mechanism).toBe('raft');
  });

  it('downgrades infeasible quorum requirements to available voting population', () => {
    const registry = new AgentRegistry();
    registerConsensusAgents(registry, 1);

    const manager = new ConsensusManager(registry, {
      mechanism: 'raft',
      timeout: 5000,
      minVotes: 3
    });

    const proposalId = manager.proposeConsensus('raft-test', {}, registry.getAgentsByType(AgentType.CONSENSUS_COORDINATOR)[0].id);
    const proposal = manager.getProposal(proposalId);
    const metadata = proposal?.metadata as Record<string, unknown> | undefined;

    expect(proposal?.requiredVotes).toBe(1);
    expect(metadata?.quorumDowngraded).toBe(true);
    expect(metadata?.votingPopulation).toBe(1);
  });

  it('finalizes when all eligible consensus voters have voted', () => {
    const registry = new AgentRegistry();
    registerConsensusAgents(registry, 2);

    // Add non-consensus agents to ensure completion is based on voting pool, not total registry count.
    registry.registerAgent({
      id: { id: 'code-1', type: AgentType.CODE_WORKER, version: '1.0.0' },
      capabilities: [],
      resources: { cpu: 1, memory: 128, storage: 10, bandwidth: 10 },
      networkInfo: { address: '127.0.0.1', port: 0, protocol: 'tcp', endpoints: [] },
      status: AgentStatus.IDLE,
      created: new Date(),
      lastUpdated: new Date()
    });
    registry.registerAgent({
      id: { id: 'validation-1', type: AgentType.VALIDATION_WORKER, version: '1.0.0' },
      capabilities: [],
      resources: { cpu: 1, memory: 128, storage: 10, bandwidth: 10 },
      networkInfo: { address: '127.0.0.1', port: 0, protocol: 'tcp', endpoints: [] },
      status: AgentStatus.IDLE,
      created: new Date(),
      lastUpdated: new Date()
    });

    const manager = new ConsensusManager(registry, {
      mechanism: 'raft',
      timeout: 5000,
      minVotes: 2
    });

    const consensusAgents = registry.getAgentsByType(AgentType.CONSENSUS_COORDINATOR);
    const proposalId = manager.proposeConsensus('vote-test', {}, consensusAgents[0].id);
    let eventAccepted: boolean | undefined;
    manager.once('consensusReached', (event: { accepted: boolean }) => {
      eventAccepted = event.accepted;
    });

    manager.submitVote(proposalId, consensusAgents[0].id, true, 'sig-1');
    manager.submitVote(proposalId, consensusAgents[1].id, false, 'sig-2');

    expect(eventAccepted).toBe(false);
    expect(manager.getProposal(proposalId)).toBeUndefined();
  });
});
