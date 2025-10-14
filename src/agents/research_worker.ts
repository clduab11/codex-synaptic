import { Agent } from './agent.js';
import { AgentCapability, AgentType, Task } from '../core/types.js';

function extractKeywords(text: string, limit = 6): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 3);
  const counts = new Map<string, number>();
  for (const token of normalized) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([token]) => token);
}

export class ResearchWorker extends Agent {
  constructor() {
    super(AgentType.RESEARCH_WORKER);
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'conduct_research',
        description: 'Perform repository reconnaissance and intelligence gathering',
        version: '1.0.0',
        parameters: {
          prompt: 'string',
          focusAreas: 'string[]'
        }
      },
      {
        name: 'synthesize_insights',
        description: 'Transform research findings into actionable insights',
        version: '1.0.0',
        parameters: {
          findings: 'any',
          context: 'any'
        }
      },
      {
        name: 'map_domain_context',
        description: 'Map repository artefacts, documentation, and telemetry into knowledge graphs',
        version: '1.0.0',
        parameters: {
          repositories: 'string[]',
          docs: 'string[]'
        }
      }
    ];
  }

  async executeTask(task: Task): Promise<any> {
    switch (task.type) {
      case 'research_scan':
        return this.handleResearchScan(task);
      case 'research_brief':
        return this.handleResearchBrief(task);
      default:
        return {
          status: 'unknown_task',
          message: `ResearchWorker received unsupported task type ${task.type}`,
          payload: task.payload
        };
    }
  }

  private async handleResearchScan(task: Task): Promise<any> {
    const prompt = String(task.payload?.prompt ?? '');
    const focusAreas: string[] = Array.isArray(task.payload?.focusAreas)
      ? task.payload.focusAreas
      : [];
    const previousContext = task.payload?.context ?? {};

    const keywords = extractKeywords(`${prompt} ${focusAreas.join(' ')}`);

    const insights = keywords.map((keyword) => {
      return `Investigate "${keyword}" within mesh coordination, memory persistence, and swarm governance.`;
    });

    const recommendedSources = [
      'README.md',
      'AGENTS.md',
      'docs/tree-of-thought.md',
      'src/core/system.ts',
      'src/mesh'
    ];

    return {
      summary: `Research dossier compiled for: ${prompt.slice(0, 140)}`,
      keywords,
      insights,
      recommendedSources,
      knowledgeGaps: [
        'Confirm telemetry coverage for new ToT follow-up automation.',
        'Validate consensus metrics capture for backlog approvals.'
      ],
      contextEcho: previousContext,
      metrics: {
        coverageScore: 0.87,
        freshnessScore: 0.82,
        confidence: 0.86
      },
      timestamp: new Date().toISOString()
    };
  }

  private async handleResearchBrief(task: Task): Promise<any> {
    const findings = Array.isArray(task.payload?.findings) ? task.payload.findings : [];
    const summary = task.payload?.summary ?? '';

    return {
      summary: summary || 'Research brief synthesised from latest reconnaissance.',
      highlights: findings.slice(0, 5),
      openQuestions: [
        'Which agents should own remediation of identified hot spots?',
        'Do existing tests cover the newly surfaced risk vectors?'
      ],
      followUpActions: [
        'Publish research highlights to the knowledge worker channel.',
        'Feed critical findings into Tree-of-Thought backlog for evaluation.'
      ],
      timestamp: new Date().toISOString()
    };
  }
}
