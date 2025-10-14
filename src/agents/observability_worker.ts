import { Agent } from './agent.js';
import { AgentCapability, AgentType, Task } from '../core/types.js';

export class ObservabilityWorker extends Agent {
  constructor() {
    super(AgentType.OBSERVABILITY_WORKER);
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'observability_snapshot',
        description: 'Generate observability snapshots and dashboard recommendations.',
        version: '1.0.0',
        parameters: {
          focus: 'string[]'
        }
      },
      {
        name: 'telemetry_plan',
        description: 'Plan telemetry instrumentation for new automation.',
        version: '1.0.0',
        parameters: {
          components: 'string[]'
        }
      }
    ];
  }

  async executeTask(task: Task): Promise<any> {
    switch (task.type) {
      case 'observability_snapshot':
        return this.handleSnapshot(task);
      default:
        return {
          status: 'unknown_task',
          message: `ObservabilityWorker received unsupported task type ${task.type}`,
          payload: task.payload
        };
    }
  }

  private handleSnapshot(task: Task): any {
    const focus: string[] = Array.isArray(task.payload?.focus) ? task.payload.focus : ['mesh', 'consensus'];

    return {
      summary: `Observability snapshot generated for ${focus.join(', ')}.`,
      dashboards: [
        { name: 'Swarm Execution', url: 'dash://swarm-execution' },
        { name: 'Consensus Pipeline', url: 'dash://consensus' }
      ],
      alerts: [
        'Threshold: consensus latency > 600ms (warning)',
        'Threshold: automation follow-up backlog > 5 (critical)'
      ],
      instrumentationPlan: [
        'Add memory backlog metrics to telemetry stream.',
        'Enable distributed tracing for follow-up workflows.'
      ],
      timestamp: new Date().toISOString()
    };
  }
}
