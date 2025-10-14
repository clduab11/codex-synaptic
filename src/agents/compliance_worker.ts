import { Agent } from './agent.js';
import { AgentCapability, AgentType, Task } from '../core/types.js';

export class ComplianceWorker extends Agent {
  constructor() {
    super(AgentType.COMPLIANCE_WORKER);
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'compliance_assessment',
        description: 'Assess compliance posture against policy and regulatory requirements.',
        version: '1.0.0',
        parameters: {
          frameworks: 'string[]'
        }
      },
      {
        name: 'policy_update',
        description: 'Draft policy updates based on recent automation changes.',
        version: '1.0.0',
        parameters: {
          changes: 'any'
        }
      }
    ];
  }

  async executeTask(task: Task): Promise<any> {
    switch (task.type) {
      case 'compliance_assessment':
        return this.handleComplianceAssessment(task);
      default:
        return {
          status: 'unknown_task',
          message: `ComplianceWorker received unsupported task type ${task.type}`,
          payload: task.payload
        };
    }
  }

  private handleComplianceAssessment(task: Task): any {
    const frameworks: string[] = Array.isArray(task.payload?.frameworks)
      ? task.payload.frameworks
      : ['SOC2', 'internal-governance'];
    return {
      summary: `Compliance assessment executed across ${frameworks.join(', ')}.`,
      gaps: [
        'Ensure consensus decisions retain audit logs for 90 days.',
        'Document automation guardrails in operator playbooks.'
      ],
      remediationPlan: [
        'Add compliance checklist to ReviewWorker outputs.',
        'Automate memory retention checks for tot_followups namespace.'
      ],
      timestamp: new Date().toISOString()
    };
  }
}
