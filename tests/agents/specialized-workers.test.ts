import { describe, expect, it } from 'vitest';
import { ResearchWorker } from '../../src/agents/research_worker';
import { ArchitectWorker } from '../../src/agents/architect_worker';
import { KnowledgeWorker } from '../../src/agents/knowledge_worker';
import { AnalystWorker } from '../../src/agents/analyst_worker';
import { SecurityWorker } from '../../src/agents/security_worker';
import { OpsWorker } from '../../src/agents/ops_worker';
import { PerformanceWorker } from '../../src/agents/performance_worker';
import { IntegrationWorker } from '../../src/agents/integration_worker';
import { SimulationWorker } from '../../src/agents/simulation_worker';
import { MemoryWorker } from '../../src/agents/memory_worker';
import { PlanningWorker } from '../../src/agents/planning_worker';
import { ReviewWorker } from '../../src/agents/review_worker';
import { CommunicationWorker } from '../../src/agents/communication_worker';
import { AutomationWorker } from '../../src/agents/automation_worker';
import { ObservabilityWorker } from '../../src/agents/observability_worker';
import { ComplianceWorker } from '../../src/agents/compliance_worker';
import { ReliabilityWorker } from '../../src/agents/reliability_worker';
import { TaskStatus, AgentType } from '../../src/core/types';
import { totEngine } from '../../src/thought/tot-engine';

const baseTask = {
  id: 'task-1',
  priority: 10,
  requiredCapabilities: [],
  payload: {},
  created: new Date(),
  status: TaskStatus.PENDING
} as const;

describe('Specialised workers', () => {
  it('enum exposes 25 unique agent types', () => {
    const unique = new Set(Object.values(AgentType));
    expect(unique.size).toBe(25);
  });

  it('new worker types expose capabilities', () => {
    const workers = [
      new AnalystWorker(),
      new SecurityWorker(),
      new OpsWorker(),
      new PerformanceWorker(),
      new IntegrationWorker(),
      new SimulationWorker(),
      new MemoryWorker(),
      new PlanningWorker(),
      new ReviewWorker(),
      new CommunicationWorker(),
      new AutomationWorker(),
      new ObservabilityWorker(),
      new ComplianceWorker(),
      new ReliabilityWorker()
    ];

    workers.forEach((worker) => {
      expect(worker.getCapabilities().length).toBeGreaterThan(0);
    });
  });

  it('research worker surfaces insights and recommended sources', async () => {
    const worker = new ResearchWorker();
    const result = await worker.executeTask({
      ...baseTask,
      type: 'research_scan',
      payload: { prompt: 'Investigate mesh resilience upgrades and consensus telemetry.' }
    });

    expect(result.summary).toContain('Research dossier');
    expect(Array.isArray(result.insights)).toBe(true);
    expect(result.recommendedSources).toContain('README.md');
  });

  it('architect worker returns blueprint with components and metrics', async () => {
    const worker = new ArchitectWorker();
    const result = await worker.executeTask({
      ...baseTask,
      type: 'architecture_plan',
      payload: { prompt: 'Design staged rollout for Tree-of-Thought backlog automation.' }
    });

    expect(result.components).toBeDefined();
    expect(result.metrics?.resilienceScore).toBeGreaterThan(0.5);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('knowledge worker produces documentation draft from ToT plan', async () => {
    const plan = totEngine.generatePlan(
      'Improve codex-synaptic through autonomous follow-up execution.',
      { branches: 5, iterations: 25, randomSeed: 7 }
    );
    const worker = new KnowledgeWorker();
    const result = await worker.executeTask({
      ...baseTask,
      type: 'knowledge_distillation',
      payload: { totPlan: plan.tot }
    });

    expect(result.summary).toContain('Knowledge updates');
    expect(result.documentationDraft).toContain('# Codex-Synaptic Improvement Update');
    expect(Array.isArray(result.knowledgeUpdates)).toBe(true);
  });
});
