
import { Agent } from './agent.js';
import { AgentCapability, AgentType, Task } from '../core/types.js';
import { totEngine } from '../thought/tot-engine.js';

export class DataWorker extends Agent {
  constructor() {
    super(AgentType.DATA_WORKER);
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'process_data',
        description: 'Processes a block of data and returns the result',
        version: '1.0.0',
        parameters: {
          data: 'any'
        }
      },
      {
        name: 'analyze_data',
        description: 'Analyzes a block of data and returns a summary',
        version: '1.0.0',
        parameters: {
          data: 'any'
        }
      },
      {
        name: 'summarize_data',
        description: 'Produces qualitative insight summaries and recommendations',
        version: '1.0.0',
        parameters: {
          data: 'any',
          objective: 'string'
        }
      },
      {
        name: 'react_plan',
        description: 'Synthesizes Reason-Act-Test plans with actionable steps and verification gates',
        version: '1.0.0',
        parameters: {
          prompt: 'string',
          analysis: 'any',
          objective: 'string'
        }
      }
    ];
  }

  async executeTask(task: Task): Promise<any> {
    const { payload } = task;

    switch (task.type) {
      case 'data_processing':
      case 'process_data': {
        const data = payload.data ?? null;
        return {
          type: task.type,
          normalized: this.normalizeData(data),
          notes: 'Data normalized for downstream tasks.'
        };
      }

      case 'data_analysis':
      case 'analyze_data': {
        const data = payload.data ?? [];
        const stats = this.calculateStatistics(data);
        return {
          type: task.type,
          statistics: stats,
          insights: this.generateInsights(stats)
        };
      }

      case 'data_summary':
      case 'summarize_data': {
        const data = payload.data ?? [];
        const objective: string = payload.objective || 'general overview';
        return {
          type: task.type,
          objective,
          summary: this.buildSummary(data, objective)
        };
      }

      case 'react_plan': {
        const prompt: string = String(payload.prompt ?? '');
        const analysis = payload.analysis ?? null;
        const objective: string = payload.objective || 'Derive ReAcT loop';
        const plan = this.buildReactPlan(prompt, analysis, objective);
        return {
          type: task.type,
          objective,
          plan,
          summary: plan.summary
        };
      }

      default:
        return {
          type: task.type,
          message: 'DataWorker received an unknown task type; returning payload for manual handling.',
          payload
        };
    }
  }

  private normalizeData(data: any): any {
    if (Array.isArray(data)) {
      return data.map((item) => (typeof item === 'string' ? item.trim() : item));
    }
    if (data && typeof data === 'object') {
      const normalized: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        normalized[key] = typeof value === 'string' ? value.trim() : value;
      }
      return normalized;
    }
    return data;
  }

  private calculateStatistics(data: any): Record<string, number> {
    const numeric = Array.isArray(data) ? data.filter((item) => typeof item === 'number') : [];
    if (numeric.length === 0) {
      return { count: Array.isArray(data) ? data.length : 0 };
    }

    const sum = numeric.reduce((acc, value) => acc + value, 0);
    const mean = sum / numeric.length;
    const variance = numeric.reduce((acc, value) => acc + Math.pow(value - mean, 2), 0) / numeric.length;

    return {
      count: numeric.length,
      min: Math.min(...numeric),
      max: Math.max(...numeric),
      mean,
      variance,
      stddev: Math.sqrt(variance)
    };
  }

  private generateInsights(stats: Record<string, number>): string[] {
    const insights: string[] = [];
    if (stats.max !== undefined && stats.min !== undefined && stats.max - stats.min > 0) {
      insights.push('Detected meaningful variance in numeric dataset.');
    }
    if (stats.stddev !== undefined && stats.stddev < 1) {
      insights.push('Dataset shows tight clustering; consider simplifying models.');
    }
    if (stats.count !== undefined && stats.count < 5) {
      insights.push('Limited data points available; augment dataset before high-stakes decisions.');
    }
    return insights;
  }

  private buildSummary(data: any, objective: string): string {
    if (Array.isArray(data)) {
      return `Prepared ${data.length} data points for ${objective}.`;
    }
    if (data && typeof data === 'object') {
      const keys = Object.keys(data);
      return `Processed structured payload with fields: ${keys.join(', ')} to support ${objective}.`;
    }
    return `Received scalar input for ${objective}; no transformation required.`;
  }

  private buildReactPlan(prompt: string, analysis: any, objective: string) {
    const plan = totEngine.generatePlan(prompt, { branches: 5, iterations: 500 });

    if (analysis?.insights && Array.isArray(analysis.insights) && analysis.insights.length) {
      plan.reasoning.unshift(...analysis.insights.map((insight: string) => `Insight: ${insight}`));
    } else if (analysis?.statistics) {
      plan.reasoning.unshift('Leverage computed statistics to prioritise remediation targets.');
    }

    plan.reasoning.unshift(`Objective: ${objective}`);
    plan.reasoning.push(`Prompt focus: ${prompt.slice(0, 240)}`);

    return plan;
  }
}
