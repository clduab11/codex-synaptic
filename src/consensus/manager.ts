/**
 * Consensus Manager for distributed decision making
 */

import { EventEmitter } from 'events';
import { Logger } from '../core/logger.js';
import { AgentRegistry } from '../agents/registry.js';
import { ConsensusProposal, ConsensusVote, AgentId, AgentType } from '../core/types.js';

export interface ConsensusModeConfig {
  mechanism: 'raft' | 'bft' | 'pow' | 'pos' | 'hybrid';
  timeout: number;
  minVotes: number;
  faultTolerance?: number;
  stakeThreshold?: number;
  stakeTable?: Record<string, number>;
  quorumFactor?: number;
  fallbackMechanism?: 'raft' | 'bft' | 'pow' | 'pos';
}

// Simple UUID generator for testing
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export class ConsensusManager extends EventEmitter {
  private logger = Logger.getInstance();
  private isRunning = false;
  private activeProposals: Map<string, ConsensusProposal> = new Map();
  private votes: Map<string, ConsensusVote[]> = new Map();
  private consensusTimeout = 30000; // 30 seconds
  private config: ConsensusModeConfig;

  constructor(private agentRegistry: AgentRegistry, config?: ConsensusModeConfig) {
    super();
    this.logger.info('consensus', 'Consensus manager created');
    this.config = {
      mechanism: config?.mechanism ?? 'raft',
      timeout: config?.timeout ?? this.consensusTimeout,
      minVotes: config?.minVotes ?? 1,
      faultTolerance: config?.faultTolerance,
      stakeThreshold: config?.stakeThreshold,
      stakeTable: config?.stakeTable ?? {},
      quorumFactor: config?.quorumFactor ?? 0.5,
      fallbackMechanism: config?.fallbackMechanism ?? 'raft'
    };
    this.consensusTimeout = this.config.timeout;
  }

  async initialize(): Promise<void> {
    this.logger.info('consensus', 'Initializing consensus manager...');
    this.isRunning = true;
    this.logger.info('consensus', 'Consensus manager initialized', { mechanism: this.config.mechanism });
  }

  async shutdown(): Promise<void> {
    this.logger.info('consensus', 'Shutting down consensus manager...');
    this.isRunning = false;
    this.activeProposals.clear();
    this.votes.clear();
    this.logger.info('consensus', 'Consensus manager shutdown complete');
  }

  proposeConsensus(type: string, data: any, proposer: AgentId): string {
    const consensusAgents = this.agentRegistry.getAgentsByType(AgentType.CONSENSUS_COORDINATOR);
    const calculation = this.calculateRequirements(consensusAgents);

    const proposal: ConsensusProposal = {
      id: generateUUID(),
      type,
      proposer,
      data,
      timestamp: new Date(),
      requiredVotes: calculation.requiredVotes,
      mechanism: calculation.mechanism,
      stakeThreshold: calculation.stakeThreshold,
      requiredStake: calculation.requiredStake,
      quorumFactor: calculation.quorumFactor,
      metadata: calculation.metadata
    };

    this.activeProposals.set(proposal.id, proposal);
    this.votes.set(proposal.id, []);

    this.logger.info('consensus', 'Consensus proposal created', {
      proposalId: proposal.id,
      type,
      proposer: proposer.id,
      requiredVotes: proposal.requiredVotes,
      mechanism: proposal.mechanism
    });

    // Set timeout for consensus
    setTimeout(() => {
      this.checkConsensusTimeout(proposal.id);
    }, this.consensusTimeout);

    this.emit('proposalCreated', proposal);
    return proposal.id;
  }

  submitVote(proposalId: string, voter: AgentId, vote: boolean, signature: string): void {
    const proposal = this.activeProposals.get(proposalId);
    if (!proposal) {
      this.logger.warn('consensus', 'Vote submitted for unknown proposal', { proposalId });
      return;
    }

    const existingVotes = this.votes.get(proposalId) || [];
    
    // Check if agent already voted
    if (existingVotes.some(v => v.voter.id === voter.id)) {
      this.logger.warn('consensus', 'Duplicate vote attempt', { proposalId, voter: voter.id });
      return;
    }

    const consensusVote: ConsensusVote = {
      proposalId,
      voter,
      vote,
      signature,
      timestamp: new Date()
    };

    existingVotes.push(consensusVote);
    this.votes.set(proposalId, existingVotes);

    this.logger.info('consensus', 'Vote submitted', {
      proposalId,
      voter: voter.id,
      vote,
      totalVotes: existingVotes.length,
      requiredVotes: proposal.requiredVotes
    });

    this.emit('voteSubmitted', consensusVote);
    this.checkConsensus(proposalId);
  }

  private checkConsensus(proposalId: string): void {
    const proposal = this.activeProposals.get(proposalId);
    const votes = this.votes.get(proposalId);

    if (!proposal || !votes) return;

    const yesVotes = votes.filter(v => v.vote).length;
    const noVotes = votes.filter(v => !v.vote).length;

    // Check if we have enough votes for consensus
    if (yesVotes >= proposal.requiredVotes) {
      this.finalizeConsensus(proposalId, true);
    } else if (noVotes >= proposal.requiredVotes) {
      this.finalizeConsensus(proposalId, false);
    } else if (votes.length >= this.agentRegistry.getAgentCount()) {
      // All agents voted but no consensus reached
      this.finalizeConsensus(proposalId, false);
    }
  }

  private finalizeConsensus(proposalId: string, accepted: boolean): void {
    const proposal = this.activeProposals.get(proposalId);
    const votes = this.votes.get(proposalId);

    if (!proposal || !votes) return;

    this.logger.info('consensus', 'Consensus finalized', {
      proposalId,
      accepted,
      yesVotes: votes.filter(v => v.vote).length,
      noVotes: votes.filter(v => !v.vote).length,
      totalVotes: votes.length
    });

    // Clean up
    this.activeProposals.delete(proposalId);
    this.votes.delete(proposalId);

    this.emit('consensusReached', {
      proposal,
      votes,
      accepted,
      timestamp: new Date()
    });

    this.emit('consensusTelemetry', {
      proposal,
      accepted,
      votes,
      requiredVotes: proposal.requiredVotes,
      mechanism: proposal.mechanism ?? this.config.mechanism,
      requiredStake: proposal.requiredStake,
      stakeThreshold: proposal.stakeThreshold,
      finalizedAt: new Date()
    });
  }

  private checkConsensusTimeout(proposalId: string): void {
    if (this.activeProposals.has(proposalId)) {
      this.logger.warn('consensus', 'Consensus timeout reached', { proposalId });
      this.finalizeConsensus(proposalId, false);
    }
  }

  getActiveProposals(): ConsensusProposal[] {
    return Array.from(this.activeProposals.values());
  }

  getProposal(proposalId: string): ConsensusProposal | undefined {
    return this.activeProposals.get(proposalId);
  }

  getVotes(proposalId: string): ConsensusVote[] {
    return this.votes.get(proposalId) || [];
  }

  getProposalStatus(proposalId: string): any {
    const proposal = this.activeProposals.get(proposalId);
    if (!proposal) {
      return {
        status: 'not_found'
      };
    }

    const votes = this.votes.get(proposalId) || [];
    const yesVotes = votes.filter(v => v.vote).length;
    const noVotes = votes.filter(v => !v.vote).length;

    return {
      status: 'active',
      proposal,
      votes,
      yesVotes,
      noVotes,
      requiredVotes: proposal.requiredVotes
    };
  }

  getStatus(): any {
    return {
      isRunning: this.isRunning,
      activeProposals: this.activeProposals.size,
      totalVotes: Array.from(this.votes.values()).reduce((sum, votes) => sum + votes.length, 0),
      mechanism: this.config.mechanism
    };
  }

  updateConfig(config: Partial<ConsensusModeConfig>): void {
    this.config = {
      ...this.config,
      ...config
    };
    if (config.timeout) {
      this.consensusTimeout = config.timeout;
    }
    this.logger.info('consensus', 'Consensus configuration updated', this.config);
  }

  private calculateRequirements(consensusAgents: any[]): {
    requiredVotes: number;
    requiredStake?: number;
    stakeThreshold?: number;
    mechanism: string;
    quorumFactor?: number;
    metadata?: Record<string, any>;
  } {
    const votingPopulation = consensusAgents.length || this.agentRegistry.getAgentCount();
    const mechanism = this.config.mechanism;
    const quorumFactor = this.config.quorumFactor ?? 0.5;
    let requiredVotes = Math.max(this.config.minVotes, Math.ceil(votingPopulation * quorumFactor));
    let requiredStake: number | undefined;
    const metadata: Record<string, any> = {};

    if (mechanism === 'bft') {
      const faultTolerance = this.config.faultTolerance ?? Math.floor(Math.max(votingPopulation - 1, 0) / 3);
      requiredVotes = Math.max(requiredVotes, (3 * faultTolerance) + 1);
      metadata.faultTolerance = faultTolerance;
    } else if (mechanism === 'pos') {
      const stakeTable = this.config.stakeTable ?? {};
      const consensusStakes = consensusAgents.length
        ? consensusAgents.map(agent => stakeTable[agent.id.id] ?? 1)
        : Object.values(stakeTable);
      const totalStake = consensusStakes.reduce((sum, value) => sum + value, 0) || votingPopulation;
      const threshold = this.config.stakeThreshold ?? 0.67;
      requiredStake = totalStake * threshold;
      metadata.totalStake = totalStake;
      requiredVotes = Math.max(requiredVotes, this.config.minVotes);
    } else if (mechanism === 'hybrid') {
      const faultTolerance = this.config.faultTolerance ?? Math.floor(Math.max(votingPopulation - 1, 0) / 3);
      requiredVotes = Math.max(requiredVotes, (3 * faultTolerance) + 1);
      metadata.faultTolerance = faultTolerance;
      const stakeTable = this.config.stakeTable ?? {};
      const consensusStakes = consensusAgents.length
        ? consensusAgents.map(agent => stakeTable[agent.id.id] ?? 1)
        : Object.values(stakeTable);
      const totalStake = consensusStakes.reduce((sum, value) => sum + value, 0) || votingPopulation;
      const threshold = this.config.stakeThreshold ?? 0.67;
      requiredStake = totalStake * threshold;
      metadata.totalStake = totalStake;
    }

    return {
      requiredVotes,
      requiredStake,
      stakeThreshold: this.config.stakeThreshold,
      mechanism,
      quorumFactor,
      metadata
    };
  }
}
