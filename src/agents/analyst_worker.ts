import { Agent } from './agent.js';
import { AgentCapability, AgentType, Task } from '../core/types.js';

export class AnalystWorker extends Agent {
  constructor() {
    super(AgentType.ANALYST_WORKER);
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'generate_analysis_brief',
        description: 'Produce analytical briefs and scorecards for repository health.',
        version: '1.0.0',
        parameters: {
          prompt: 'string',
          metrics: 'string[]'
        }
      },
      {
        name: 'diagnose_risks',
        description: 'Identify hotspots, technical debt, and regression vectors.',
        version: '1.0.0',
        parameters: {
          findings: 'any'
        }
      }
    ];
  }

  async executeTask(task: Task): Promise<any> {
    switch (task.type) {
      case 'analysis_brief':
        return this.handleAnalysisBrief(task);
      default:
        return {
          status: 'unknown_task',
          message: `AnalystWorker received unsupported task type ${task.type}`,
          payload: task.payload
        };
    }
  }

  private handleAnalysisBrief(task: Task): any {
    const prompt = String(task.payload?.prompt ?? '');
    const metrics: string[] = Array.isArray(task.payload?.metrics) ? task.payload.metrics : [];
    return {
      summary: `Analysis brief generated for ${prompt.slice(0, 120)}`,
      metricsReviewed: metrics,
      heatmap: [
        { area: 'consensus-latency', score: 0.76 },
        { area: 'mesh-coverage', score: 0.89 },
        { area: 'memory-freshness', score: 0.81 }
      ],
      recommendations: [
        'Prioritise backlog items with high risk-to-effort ratio.',
        'Feed top hotspots into Tree-of-Thought planning for deeper remediation.'
      ],
      timestamp: new Date().toISOString()
    };
  }
}
