import { CodexMemorySystem, ToolUsageRecord } from '../../memory/memory-system.js';
import { AgentType } from '../../core/types.js';

export interface ToolCandidate {
  id: string;
  description?: string;
  agentType?: AgentType;
  capabilities?: string[];
  costEstimateMs?: number;
}

export interface ToolScore {
  toolId: string;
  score: number;
  confidence: number;
  reasoning: string[];
  signals: string[];
  usage?: {
    total: number;
    success: number;
    successRatio: number;
    averageLatencyMs: number;
    lastInvokedAt?: string;
  };
}

export interface ToolOptimizerOptions {
  historyLimit?: number;
  minimumConfidence?: number;
}

interface UsageAggregate {
  total: number;
  success: number;
  latencySum: number;
  lastInvokedAt?: string;
}

type IntentCategory = 'code' | 'data' | 'validation' | 'infrastructure' | 'documentation' | 'analytics';

const CATEGORY_KEYWORDS: Record<IntentCategory, RegExp> = {
  code: /(code|implement|function|class|module|refactor|fix|patch|build|generate)/i,
  data: /(data|etl|transform|analy|dataset|stat|metric|report|pipeline)/i,
  validation: /(test|validate|verify|qa|lint|assert|compliance|security|scan|consensus)/i,
  infrastructure: /(deploy|infrastructure|docker|env|ops|runbook|scale|autoscale|monitor|infra)/i,
  documentation: /(doc|document|readme|guide|knowledge|summary|changelog|broadcast)/i,
  analytics: /(analytics|dashboard|metric|prometheus|telemetry|observability|grafana|insight)/i
};

const CATEGORY_AGENT_PRIORITIES: Partial<Record<IntentCategory, AgentType[]>> = {
  code: [AgentType.CODE_WORKER, AgentType.AUTOMATION_WORKER, AgentType.RESEARCH_WORKER],
  data: [AgentType.DATA_WORKER, AgentType.ANALYST_WORKER, AgentType.RESEARCH_WORKER],
  validation: [AgentType.VALIDATION_WORKER, AgentType.SECURITY_WORKER, AgentType.COMPLIANCE_WORKER],
  infrastructure: [AgentType.OPS_WORKER, AgentType.AUTOMATION_WORKER, AgentType.RELIABILITY_WORKER],
  documentation: [AgentType.KNOWLEDGE_WORKER, AgentType.COMMUNICATION_WORKER, AgentType.MEMORY_WORKER],
  analytics: [AgentType.OBSERVABILITY_WORKER, AgentType.ANALYST_WORKER, AgentType.PERFORMANCE_WORKER]
};

export class ToolOptimizer {
  private readonly historyLimit: number;
  private readonly minimumConfidence: number;

  constructor(private readonly memory: CodexMemorySystem, options: ToolOptimizerOptions = {}) {
    this.historyLimit = options.historyLimit ?? 200;
    this.minimumConfidence = options.minimumConfidence ?? 0.25;
  }

  async evaluateTools(
    prompt: string,
    candidates: ToolCandidate[],
    options: { tenantId?: string } = {}
  ): Promise<ToolScore[]> {
    if (!candidates.length) {
      return [];
    }

    const history = await this.memory.listToolUsage(this.historyLimit, {
      tenantId: options.tenantId
    });
    const aggregates = this.buildUsageAggregates(history);
    const categories = this.deriveIntentCategories(prompt);

    const scores = candidates.map((candidate) => {
      const usage = aggregates.get(candidate.id);
      const baseScore = this.computeBaseScore(candidate, usage);
      const intentBoost = this.computeIntentBoost(candidate, categories);
      const latencyAdjustment = this.computeLatencyAdjustment(candidate, usage);

      const rawScore = Math.min(1, Math.max(0, baseScore + intentBoost + latencyAdjustment));
      const reasoning = this.buildReasoning(candidate, categories, usage, rawScore);
      const confidence = Math.max(this.minimumConfidence, rawScore);

      return {
        toolId: candidate.id,
        score: rawScore,
        confidence,
        reasoning,
        signals: categories.map((entry) => `${entry.category}:${entry.weight.toFixed(2)}`),
        usage: usage
          ? {
              total: usage.total,
              success: usage.success,
              successRatio: usage.total > 0 ? usage.success / usage.total : 0,
              averageLatencyMs: usage.total > 0 ? usage.latencySum / usage.total : 0,
              lastInvokedAt: usage.lastInvokedAt
            }
          : {
              total: 0,
              success: 0,
              successRatio: 0,
              averageLatencyMs: candidate.costEstimateMs ?? 0
            }
      };
    });

    return scores.sort((a, b) => b.score - a.score);
  }

  async recordToolOutcome(record: ToolUsageRecord, options: { tenantId?: string } = {}): Promise<number> {
    const tenantId = options.tenantId ?? record.tenantId;
    return this.memory.logToolUsage(
      { ...record, tenantId },
      { tenantId }
    );
  }

  private buildUsageAggregates(history: ToolUsageRecord[]): Map<string, UsageAggregate> {
    const aggregates = new Map<string, UsageAggregate>();
    for (const record of history) {
      if (!record?.toolId) continue;
      const entry = aggregates.get(record.toolId) ?? { total: 0, success: 0, latencySum: 0 };
      entry.total += 1;
      if (record.success) {
        entry.success += 1;
      }
      entry.latencySum += record.latencyMs ?? 0;
      if (record.timestamp) {
        const current = entry.lastInvokedAt ? new Date(entry.lastInvokedAt).getTime() : 0;
        const candidate = new Date(record.timestamp).getTime();
        if (candidate > current) {
          entry.lastInvokedAt = record.timestamp;
        }
      }
      aggregates.set(record.toolId, entry);
    }
    return aggregates;
  }

  private deriveIntentCategories(prompt: string): Array<{ category: IntentCategory; weight: number }> {
    const intents: Array<{ category: IntentCategory; weight: number }> = [];
    const lowerPrompt = prompt.toLowerCase();

    for (const category of Object.keys(CATEGORY_KEYWORDS) as IntentCategory[]) {
      const matches = lowerPrompt.match(CATEGORY_KEYWORDS[category]);
      if (matches?.length) {
        const weight = Math.min(1, 0.35 + matches.length * 0.1);
        intents.push({ category, weight });
      }
    }

    if (!intents.length) {
      intents.push({ category: 'code', weight: 0.25 });
    }

    return intents.sort((a, b) => b.weight - a.weight);
  }

  private computeBaseScore(candidate: ToolCandidate, usage?: UsageAggregate): number {
    if (!usage) {
      return 0.35;
    }
    const successRatio = usage.total > 0 ? usage.success / usage.total : 0;
    return 0.3 + successRatio * 0.5;
  }

  private computeIntentBoost(candidate: ToolCandidate, categories: Array<{ category: IntentCategory; weight: number }>): number {
    if (!candidate.agentType) {
      return 0;
    }
    let boost = 0;
    for (const entry of categories) {
      const preferredAgents = CATEGORY_AGENT_PRIORITIES[entry.category];
      if (preferredAgents?.includes(candidate.agentType)) {
        const position = preferredAgents.indexOf(candidate.agentType);
        const decay = Math.max(0, 0.25 - position * 0.08);
        boost += entry.weight * decay;
      }
    }
    return boost;
  }

  private computeLatencyAdjustment(candidate: ToolCandidate, usage?: UsageAggregate): number {
    const baseline = candidate.costEstimateMs ?? 0;
    const averageLatency = usage && usage.total > 0 ? usage.latencySum / usage.total : baseline;
    if (!averageLatency) {
      return 0;
    }

    if (averageLatency <= 100) {
      return 0.05;
    }
    if (averageLatency >= 2000) {
      return -0.15;
    }
    return -(averageLatency - 100) / 10000;
  }

  private buildReasoning(
    candidate: ToolCandidate,
    categories: Array<{ category: IntentCategory; weight: number }>,
    usage: UsageAggregate | undefined,
    rawScore: number
  ): string[] {
    const reasons: string[] = [];
    if (candidate.agentType) {
      const matches = categories
        .filter((intent) => CATEGORY_AGENT_PRIORITIES[intent.category]?.includes(candidate.agentType!))
        .map((intent) => `${intent.category} (${intent.weight.toFixed(2)})`);
      if (matches.length) {
        reasons.push(`Agent ${candidate.agentType} aligns with intents: ${matches.join(', ')}`);
      }
    }

    if (usage) {
      const successRatio = usage.total > 0 ? usage.success / usage.total : 0;
      reasons.push(
        `Historical success ${usage.success}/${usage.total} (${(successRatio * 100).toFixed(1)}%), avg latency ${(usage.latencySum / (usage.total || 1)).toFixed(1)}ms`
      );
      if (usage.lastInvokedAt) {
        reasons.push(`Last invoked at ${usage.lastInvokedAt}`);
      }
    } else {
      reasons.push('No historical telemetry found; relying on prompt intent heuristics.');
    }

    reasons.push(`Computed confidence ${(rawScore * 100).toFixed(1)}%`);
    return reasons;
  }
}
