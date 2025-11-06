import { describe, expect, it } from 'vitest';
import { analyzePromptForAgents } from '../../src/core/hive-mind';
import { AgentType } from '../../src/core/types';

describe('Hive-mind agent composition', () => {
  it('always includes voting agents for consensus quorum', () => {
    const prompt = 'performance optimization test';
    const composition = analyzePromptForAgents(prompt);
    
    // Check that voting agents are always included
    const hasConsensusCoordinator = composition.some(a => a.type === AgentType.CONSENSUS_COORDINATOR);
    const hasReviewWorker = composition.some(a => a.type === AgentType.REVIEW_WORKER);
    const hasPlanningWorker = composition.some(a => a.type === AgentType.PLANNING_WORKER);
    
    expect(hasConsensusCoordinator).toBe(true);
    expect(hasReviewWorker).toBe(true);
    expect(hasPlanningWorker).toBe(true);
  });

  it('includes voting agents even with minimal prompts', () => {
    const prompt = 'test';
    const composition = analyzePromptForAgents(prompt);
    
    // Even with minimal prompt, fallback should include voting agents
    const hasConsensusCoordinator = composition.some(a => a.type === AgentType.CONSENSUS_COORDINATOR);
    const hasReviewWorker = composition.some(a => a.type === AgentType.REVIEW_WORKER);
    const hasPlanningWorker = composition.some(a => a.type === AgentType.PLANNING_WORKER);
    
    expect(hasConsensusCoordinator).toBe(true);
    expect(hasReviewWorker).toBe(true);
    expect(hasPlanningWorker).toBe(true);
  });

  it('deploys exactly 1 of each voting agent type', () => {
    const prompt = 'code generation and data processing';
    const composition = analyzePromptForAgents(prompt);
    
    const consensusCount = composition.find(a => a.type === AgentType.CONSENSUS_COORDINATOR)?.count || 0;
    const reviewCount = composition.find(a => a.type === AgentType.REVIEW_WORKER)?.count || 0;
    const planningCount = composition.find(a => a.type === AgentType.PLANNING_WORKER)?.count || 0;
    
    expect(consensusCount).toBe(1);
    expect(reviewCount).toBe(1);
    expect(planningCount).toBe(1);
  });

  it('includes code workers for code-related prompts', () => {
    const prompt = 'develop a new feature with unit tests';
    const composition = analyzePromptForAgents(prompt);
    
    const hasCodeWorker = composition.some(a => a.type === AgentType.CODE_WORKER);
    expect(hasCodeWorker).toBe(true);
  });

  it('includes data workers for data-related prompts', () => {
    const prompt = 'analyze and process the dataset';
    const composition = analyzePromptForAgents(prompt);
    
    const hasDataWorker = composition.some(a => a.type === AgentType.DATA_WORKER);
    expect(hasDataWorker).toBe(true);
  });

  it('includes validation workers for test-related prompts', () => {
    const prompt = 'validate the implementation and check quality';
    const composition = analyzePromptForAgents(prompt);
    
    const hasValidationWorker = composition.some(a => a.type === AgentType.VALIDATION_WORKER);
    expect(hasValidationWorker).toBe(true);
  });

  it('always includes swarm and topology coordinators', () => {
    const prompt = 'any task';
    const composition = analyzePromptForAgents(prompt);
    
    const hasSwarmCoordinator = composition.some(a => a.type === AgentType.SWARM_COORDINATOR);
    const hasTopologyCoordinator = composition.some(a => a.type === AgentType.TOPOLOGY_COORDINATOR);
    
    expect(hasSwarmCoordinator).toBe(true);
    expect(hasTopologyCoordinator).toBe(true);
  });
});
