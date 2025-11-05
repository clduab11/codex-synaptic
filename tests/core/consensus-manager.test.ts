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
    
    // Should calculate based on 3 voting agents (consensus + review + planning)
    // With quorumFactor 0.4, we need ceil(3 * 0.4) = 2 votes minimum
    expect(proposal?.requiredVotes).toBe(2);
    expect(proposal?.mechanism).toBe('raft');
  });
});

