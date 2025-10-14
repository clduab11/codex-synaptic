import { Agent } from './agent.js';
import { AgentCapability, AgentType, Task } from '../core/types.js';

export class CommunicationWorker extends Agent {
  constructor() {
    super(AgentType.COMMUNICATION_WORKER);
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'compose_broadcast',
        description: 'Compose communications for operators and stakeholders.',
        version: '1.0.0',
        parameters: {
          audience: 'string',
          highlights: 'string[]'
        }
      },
      {
        name: 'status_digest',
        description: 'Convert telemetry and memory updates into human-friendly digests.',
        version: '1.0.0',
        parameters: {
          metrics: 'any'
        }
      }
    ];
  }

  async executeTask(task: Task): Promise<any> {
    switch (task.type) {
      case 'comms_broadcast':
        return this.handleBroadcast(task);
      default:
        return {
          status: 'unknown_task',
          message: `CommunicationWorker received unsupported task type ${task.type}`,
          payload: task.payload
        };
    }
  }

  private handleBroadcast(task: Task): any {
    const audience = task.payload?.audience ?? 'Codex-Synaptic Operators';
    const highlights: string[] = Array.isArray(task.payload?.highlights)
      ? task.payload.highlights
      : ['Tree-of-Thought backlog automation deployed.', 'Research insights ready for next swarm run.'];

    return {
      summary: `Communication drafted for ${audience}.`,
      message: [
        `Hello ${audience},`,
        '',
        'Key updates:',
        ...highlights.map((item) => `- ${item}`),
        '',
        'Stay synced, Codex-Synaptic Automation'
      ].join('\n'),
      suggestedChannels: ['slack://codex-synaptic', 'email:operators@codex-synaptic'],
      timestamp: new Date().toISOString()
    };
  }
}
