import { Agent } from './agent.js';
import { AgentCapability, AgentType, Task } from '../core/types.js';

export class KnowledgeWorker extends Agent {
  constructor() {
    super(AgentType.KNOWLEDGE_WORKER);
  }

  getCapabilities(): AgentCapability[] {
    return [
      {
        name: 'synthesize_knowledge',
        description: 'Generate documentation updates and knowledge base entries',
        version: '1.0.0',
        parameters: {
          insights: 'any',
          plan: 'any'
        }
      },
      {
        name: 'draft_documentation',
        description: 'Produce human-readable documentation and release notes',
        version: '1.0.0',
        parameters: {
          summary: 'string',
          highlights: 'string[]'
        }
      },
      {
        name: 'broadcast_updates',
        description: 'Prepare communication bundles for operators and agents',
        version: '1.0.0',
        parameters: {
          channels: 'string[]',
          payload: 'any'
        }
      }
    ];
  }

  async executeTask(task: Task): Promise<any> {
    switch (task.type) {
      case 'knowledge_distillation':
        return this.handleKnowledgeDistillation(task);
      default:
        return {
          status: 'unknown_task',
          message: `KnowledgeWorker received unsupported task type ${task.type}`,
          payload: task.payload
        };
    }
  }

  private async handleKnowledgeDistillation(task: Task): Promise<any> {
    const plan = task.payload?.totPlan ?? null;
    const research = task.payload?.research ?? null;
    const architecture = task.payload?.architecture ?? null;

    const knowledgeUpdates: string[] = [];
    if (Array.isArray(plan?.knowledgeUpdates)) {
      knowledgeUpdates.push(...plan.knowledgeUpdates);
    }
    if (research?.insights) {
      knowledgeUpdates.push(...research.insights.slice(0, 3));
    }
    if (architecture?.recommendations) {
      knowledgeUpdates.push(...architecture.recommendations.slice(0, 2));
    }

    const documentationDraft = [
      '# Codex-Synaptic Improvement Update',
      '',
      `- **Tree-of-Thought focus**: ${plan?.bestBranch?.label ?? 'N/A'}`,
      `- **Monte Carlo samples**: ${plan?.monteCarlo?.totalSamples ?? 'N/A'}`,
      '',
      '## Highlights',
      ...knowledgeUpdates.map((item) => `- ${item}`)
    ].join('\n');

    return {
      summary: 'Knowledge updates synthesised from latest swarm artefacts.',
      documentationDraft,
      broadcastChannels: ['docs/CHANGELOG.md', 'AGENTS.md', 'memory:tot_runs'],
      suggestedCommits: [
        'docs: update improvement log with latest ToT outputs',
        'memory: persist research findings for follow-up swarms'
      ],
      knowledgeUpdates,
      timestamp: new Date().toISOString()
    };
  }
}
