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
});
