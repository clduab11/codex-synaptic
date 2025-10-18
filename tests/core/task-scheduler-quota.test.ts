import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { TaskScheduler } from '../../src/core/scheduler';
import { AgentRegistry } from '../../src/agents/registry';
import { ResourceManager } from '../../src/core/resources';
import { Agent } from '../../src/agents/agent';
import { AgentType, AgentStatus, TaskStatus } from '../../src/core/types';

class DummyAgent extends Agent {
  constructor() {
    super(AgentType.CODE_WORKER);
  }

  getCapabilities() {
    return [
      {
        name: 'code-generation',
        version: '1.0.0',
        description: 'Dummy capability',
        parameters: {}
      }
    ];
  }

  async executeTask() {
    return { ok: true };
  }
}

describe('TaskScheduler tenant quotas', () => {
  let registry: AgentRegistry;
  let resourceManager: ResourceManager;
  let scheduler: TaskScheduler;
  let agent: DummyAgent;

  beforeEach(async () => {
    registry = new AgentRegistry();
    await registry.initialize();
    resourceManager = new ResourceManager({
      maxMemoryMB: 4096,
      maxCpuPercent: 90,
      maxActiveAgents: 10,
      maxConcurrentTasks: 10,
      maxRequestsPerMinute: 1000
    });
    resourceManager.initialize();
    scheduler = new TaskScheduler(registry, resourceManager);
    await scheduler.initialize();

    agent = new DummyAgent();
    registry.register(agent);
    agent.setStatus(AgentStatus.IDLE);
    registry.updateAgentStatus(agent.getId(), AgentStatus.IDLE);
  });

  afterEach(async () => {
    await scheduler.shutdown();
    await registry.shutdown();
    resourceManager.shutdown();
  });

  it('limits concurrent tasks per tenant based on quota', async () => {
    const tenantId = 'tenant-alpha';
    resourceManager.registerTenantQuota(tenantId, { maxConcurrentTasks: 1 });

    const task1 = scheduler.submitTask({
      type: 'code',
      requiredCapabilities: ['code-generation'],
      payload: {},
      tenantId
    });
    const task2 = scheduler.submitTask({
      type: 'code',
      requiredCapabilities: ['code-generation'],
      payload: {},
      tenantId
    });

    await (scheduler as any).processTasks();
    expect((scheduler as any).runningTasks.size).toBe(1);
    expect((scheduler as any).pendingTasks.has(task2.id)).toBe(true);

    scheduler.completeTask(task1.id, { ok: true });
    registry.updateAgentStatus(agent.getId(), AgentStatus.IDLE);
    expect((scheduler as any).runningTasks.size).toBe(0);

    await (scheduler as any).processTasks();

    const nextTask = (scheduler as any).runningTasks.get(task2.id);
    expect(nextTask?.status).toBe(TaskStatus.RUNNING);
  });
});
