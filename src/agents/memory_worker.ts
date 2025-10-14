import { Agent } from './agent.js';
import { AgentCapability, AgentType, Task } from '../core/types.js';

export class MemoryWorker extends Agent {
  constructor() {
    super(AgentType.MEMORY_WORKER);
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'curate_memory',
        description: 'Curate and index Codex memory entries for reuse.',
        version: '1.0.0',
        parameters: {
          namespace: 'string',
          filter: 'any'
        }
      },
      {
        name: 'memory_audit',
        description: 'Audit memory freshness and recommend archival actions.',
        version: '1.0.0',
        parameters: {
          namespaces: 'string[]'
        }
      }
    ];
  }

  async executeTask(task: Task): Promise<any> {
    switch (task.type) {
      case 'memory_curation':
        return this.handleMemoryCuration(task);
      default:
        return {
          status: 'unknown_task',
          message: `MemoryWorker received unsupported task type ${task.type}`,
          payload: task.payload
        };
    }
  }

  private handleMemoryCuration(task: Task): any {
    const namespace = task.payload?.namespace ?? 'tot_runs';
    const filter = task.payload?.filter ?? {};
    return {
      summary: `Memory curation plan prepared for namespace "${namespace}".`,
      filter,
      actions: [
        'Promote recent Tree-of-Thought backlog lessons to docs/CHANGELOG.md.',
        'Archive stale insights older than 30 days.',
        'Tag follow-up entries requiring consensus review.'
      ],
      timestamp: new Date().toISOString()
    };
  }
}
