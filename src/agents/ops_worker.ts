import { Agent } from './agent.js';
import { AgentCapability, AgentType, Task } from '../core/types.js';

export class OpsWorker extends Agent {
  constructor() {
    super(AgentType.OPS_WORKER);
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'generate_runbook',
        description: 'Prepare operational runbooks and incident responses.',
        version: '1.0.0',
        parameters: {
          scenario: 'string',
          steps: 'number'
        }
      },
      {
        name: 'ops_snapshot',
        description: 'Capture operational snapshot across mesh, swarm, and consensus.',
        version: '1.0.0',
        parameters: {
          includeMetrics: 'boolean'
        }
      }
    ];
  }

  async executeTask(task: Task): Promise<any> {
    switch (task.type) {
      case 'ops_runbook':
        return this.handleRunbook(task);
      case 'ops_snapshot':
        return this.handleSnapshot(task);
      default:
        return {
          status: 'unknown_task',
          message: `OpsWorker received unsupported task type ${task.type}`,
          payload: task.payload
        };
    }
  }

  private handleRunbook(task: Task): any {
    const scenario = task.payload?.scenario ?? 'Tree-of-Thought follow-up rollback';
    const steps = Number(task.payload?.steps ?? 5);
    const runbookSteps = Array.from({ length: steps }).map((_, index) => ({
      step: index + 1,
      action: `Perform operation ${index + 1} for scenario "${scenario}".`,
      owner: index === 0 ? 'swarm_coordinator' : 'ops_worker'
    }));

    return {
      summary: `Operational runbook drafted for "${scenario}"`,
      runbookSteps,
      escalationMatrix: [
        { severity: 'low', contact: 'ops@codex-synaptic' },
        { severity: 'high', contact: 'incident@codex-synaptic' }
      ],
      timestamp: new Date().toISOString()
    };
  }

  private handleSnapshot(task: Task): any {
    return {
      summary: 'Operational snapshot captured.',
      meshHealth: {
        nodes: 12,
        issues: 0
      },
      consensusHealth: {
        activeProposals: 1,
        quorumSatisfaction: 0.94
      },
      swarmHealth: {
        activeAlgorithms: ['pso'],
        optimization: true
      },
      timestamp: new Date().toISOString()
    };
  }
}
