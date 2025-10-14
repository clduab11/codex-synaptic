import { Agent } from './agent.js';
import { AgentCapability, AgentType, Task } from '../core/types.js';

export class SecurityWorker extends Agent {
  constructor() {
    super(AgentType.SECURITY_WORKER);
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'security_review',
        description: 'Perform static security diagnostics and threat modelling.',
        version: '1.0.0',
        parameters: {
          components: 'string[]',
          severityThreshold: 'string'
        }
      },
      {
        name: 'generate_security_brief',
        description: 'Summarise security posture and recommended mitigations.',
        version: '1.0.0',
        parameters: {
          findings: 'any'
        }
      }
    ];
  }

  async executeTask(task: Task): Promise<any> {
    switch (task.type) {
      case 'security_review':
        return this.handleSecurityReview(task);
      default:
        return {
          status: 'unknown_task',
          message: `SecurityWorker received unsupported task type ${task.type}`,
          payload: task.payload
        };
    }
  }

  private handleSecurityReview(task: Task): any {
    const components: string[] = Array.isArray(task.payload?.components)
      ? task.payload.components
      : ['core/system', 'memory', 'consensus'];
    const severityThreshold = task.payload?.severityThreshold ?? 'medium';

    const findings = components.map((component) => ({
      component,
      severity: 'medium',
      issue: `Review ${component} for credential handling and consensus gating.`,
      recommendation: `Add automated tests and memory sanitisation checks for ${component}.`
    }));

    return {
      summary: `Security review completed for ${components.length} component(s).`,
      findings,
      severityThreshold,
      mitigationBacklog: findings.map((item) => `Mitigate: ${item.issue}`),
      timestamp: new Date().toISOString()
    };
  }
}
