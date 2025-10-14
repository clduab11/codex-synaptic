import { describe, expect, it } from 'vitest';
import { CodexSynapticSystem } from '../../src/core/system';
import { AgentRegistry } from '../../src/agents/registry';
import { ConsensusManager } from '../../src/consensus/manager';
import {
  AgentId,
  AgentMetadata,
  AgentStatus,
  AgentType
} from '../../src/core/types';
import { totEngine } from '../../src/thought/tot-engine';

describe('CodexSynapticSystem ReAcT workflow enrichment', () => {
  it('adds ReAcT planning and engineering stages for repository self-improvement prompts', () => {
    const system = new CodexSynapticSystem();
    const prompt =
      'Launch a ReAcT methodology loop to self-improve the repository, scan README.md and AGENTS.md, then plan/apply/test improvements until stable.';

    const stages = (system as any).buildWorkflow(prompt);
    const stageIds = stages.map((stage: any) => stage.id);

    expect(stageIds).toContain('research-scan');
    expect(stageIds).toContain('data-analysis');
    expect(stageIds).toContain('react-plan');
    expect(stageIds).toContain('architecture-blueprint');
    expect(stageIds).toContain('code-generation');
    expect(stageIds).toContain('validation');
    expect(stageIds).toContain('knowledge-distillation');

    const researchStageIndex = stageIds.indexOf('research-scan');
    const planStageIndex = stageIds.indexOf('react-plan');
    const architectureStageIndex = stageIds.indexOf('architecture-blueprint');
    const codeStageIndex = stageIds.indexOf('code-generation');
    const knowledgeStageIndex = stageIds.indexOf('knowledge-distillation');

    expect(researchStageIndex).toBeLessThan(stageIds.indexOf('data-analysis'));
    expect(planStageIndex).toBeGreaterThan(stageIds.indexOf('data-analysis'));
    expect(architectureStageIndex).toBeGreaterThan(planStageIndex);
    expect(codeStageIndex).toBeGreaterThan(planStageIndex);
    expect(knowledgeStageIndex).toBeGreaterThan(codeStageIndex);
  });
});

describe('Tree-of-Thought planner', () => {
  it('produces five branches with deterministic Monte Carlo stats when seeded', () => {
    const plan = totEngine.generatePlan(
      'Execute a repository-wide upgrade with consensus safeguards and documentation refresh.',
      { branches: 5, iterations: 50, randomSeed: 42 }
    );

    expect(plan.tot.branches).toHaveLength(5);
    const branchMeans = Object.values(plan.tot.monteCarlo.branchMeans);
    expect(branchMeans.every((value) => value >= 0.8 && value <= 0.995)).toBe(true);
    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.tests).toContain('Execute full lint + typecheck suite post-plan application.');
    expect(plan.tot.summary).toContain('Tree-of-Thought planner evaluated');
  });
});

describe('ConsensusManager voting quorum', () => {
  const createMetadata = (id: string, type: AgentType): AgentMetadata => {
    const agentId: AgentId = { id, type, version: '1.0.0' };
    return {
      id: agentId,
      capabilities: [],
      resources: { cpu: 1, memory: 128, storage: 1, bandwidth: 1 },
      networkInfo: { address: '127.0.0.1', port: 0, protocol: 'tcp', endpoints: [] },
      status: AgentStatus.IDLE,
      created: new Date(),
      lastUpdated: new Date()
    };
  };

  it('bases quorum on consensus coordinators rather than total agents', () => {
    const registry = new AgentRegistry();
    registry.registerAgent(createMetadata('code-1', AgentType.CODE_WORKER));
    registry.registerAgent(createMetadata('data-1', AgentType.DATA_WORKER));
    registry.registerAgent(createMetadata('validation-1', AgentType.VALIDATION_WORKER));
    registry.registerAgent(createMetadata('topology-1', AgentType.TOPOLOGY_COORDINATOR));

    const consensusAgentA = createMetadata('consensus-1', AgentType.CONSENSUS_COORDINATOR);
    const consensusAgentB = createMetadata('consensus-2', AgentType.CONSENSUS_COORDINATOR);
    registry.registerAgent(consensusAgentA);
    registry.registerAgent(consensusAgentB);

    const manager = new ConsensusManager(registry, {
      mechanism: 'raft',
      timeout: 5000,
      minVotes: 2
    });
    const proposalId = manager.proposeConsensus('unit-test', {}, consensusAgentA.id);
    const status = manager.getProposalStatus(proposalId);

    expect(status.status).toBe('active');
    expect(status.requiredVotes).toBe(2);
  });
});
