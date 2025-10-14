import { Agent } from './agent.js';
import { AgentCapability, AgentType, Task } from '../core/types.js';

export class ReviewWorker extends Agent {
  constructor() {
    super(AgentType.REVIEW_WORKER);
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'code_review_summary',
        description: 'Summarise code diffs and highlight areas requiring consensus.',
        version: '1.0.0',
        parameters: {
          diff: 'string',
          modules: 'string[]'
        }
      },
      {
        name: 'review_checklist',
        description: 'Generate review checklists aligned with Codex-Synaptic standards.',
        version: '1.0.0',
        parameters: {
          domains: 'string[]'
        }
      }
    ];
  }

  async executeTask(task: Task): Promise<any> {
    switch (task.type) {
      case 'code_review_summary':
        return this.handleCodeReviewSummary(task);
      default:
        return {
          status: 'unknown_task',
          message: `ReviewWorker received unsupported task type ${task.type}`,
          payload: task.payload
        };
    }
  }

  private handleCodeReviewSummary(task: Task): any {
    const modules: string[] = Array.isArray(task.payload?.modules) ? task.payload.modules : ['core/system'];
    return {
      summary: `Review summary prepared for ${modules.length} module(s).`,
      highlights: [
        'Ensure memory persistence aligns with compliance requirements.',
        'Verify new agent types have registry coverage and telemetry.'
      ],
      checklist: [
        'Consensus gates updated?',
        'Documentation refreshed?',
        'Telemetry and observability configured?'
      ],
      timestamp: new Date().toISOString()
    };
  }
}
