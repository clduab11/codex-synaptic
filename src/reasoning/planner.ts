import { randomUUID } from 'crypto';
import { Logger } from '../core/logger.js';
import { CodexMemorySystem, ReasoningRunRecord, ReasoningCheckpoint } from '../memory/memory-system.js';
import { totEngine, TotConfig, TotPlanResult } from '../thought/tot-engine.js';

export type ReasoningPlanType = 'tot' | 'react' | 'custom';

export interface ReasoningPlanOptions {
  planType?: ReasoningPlanType;
  metadata?: Record<string, any>;
  requireConsensus?: boolean;
  totConfig?: Partial<TotConfig>;
}

export interface ReasoningPlanCreationResult {
  planId: string;
  planType: ReasoningPlanType;
  status: ReasoningRunRecord['status'];
  summary: string;
  createdAt: string;
  consensus?: {
    required: boolean;
    proposalId?: string;
  };
  totPlan?: TotPlanResult;
}

export interface ReasoningCheckpointInput {
  label: string;
  status: 'pending' | 'complete' | 'failed';
  summary?: string;
  metrics?: Record<string, number>;
}

export interface ReasoningCompletionOptions {
  status: 'completed' | 'failed' | 'aborted';
  summary?: string;
  durationMs?: number;
  metadata?: Record<string, any>;
}

interface ReasoningPlannerDependencies {
  memory: CodexMemorySystem;
  proposeConsensus?: (data: Record<string, any>) => Promise<string>;
  logger?: Logger;
}

export class ReasoningPlanner {
  private readonly logger: Logger;

  constructor(private readonly deps: ReasoningPlannerDependencies) {
    this.logger = deps.logger ?? Logger.getInstance('reasoning');
  }

  async createPlan(prompt: string, options: ReasoningPlanOptions = {}): Promise<ReasoningPlanCreationResult> {
    const planId = randomUUID();
    const allowedTypes: ReasoningPlanType[] = ['tot', 'react', 'custom'];
    const planTypeInput = options.planType ?? 'tot';
    const planType: ReasoningPlanType = allowedTypes.includes(planTypeInput as ReasoningPlanType)
      ? (planTypeInput as ReasoningPlanType)
      : 'tot';
    const createdAt = new Date().toISOString();

    let totPlan: TotPlanResult | undefined;
    let status: ReasoningRunRecord['status'] = options.requireConsensus ? 'awaiting_approval' : 'running';

    if (planType === 'tot' || planType === 'react') {
      const totOptions: TotConfig = {
        branches: options.totConfig?.branches,
        iterations: options.totConfig?.iterations,
        randomSeed: options.totConfig?.randomSeed
      };
      totPlan = totEngine.generatePlan(prompt, totOptions).tot;
    }

    const runRecord: ReasoningRunRecord = {
      id: planId,
      planId,
      planType,
      prompt,
      status,
      bestBranch: totPlan?.bestBranch?.label,
      confidence: totPlan?.bestBranch?.confidence,
      checkpoints: [],
      metadata: options.metadata,
      durationMs: 0,
      timestamp: createdAt
    };

    const consensus = await this.maybeProposeConsensus(runRecord, options.requireConsensus);
    if (consensus?.proposalId) {
      runRecord.validation = {
        consensusProposalId: consensus.proposalId,
        consensusAccepted: undefined
      };
    }

    await this.persistRun(runRecord);

    return {
      planId,
      planType,
      status,
      summary: totPlan?.summary ?? `Reasoning plan created (${planType})`,
      createdAt,
      consensus,
      totPlan
    };
  }

  async checkpoint(planId: string, input: ReasoningCheckpointInput): Promise<ReasoningRunRecord> {
    const latest = await this.getLatest(planId);
    if (!latest) {
      throw new Error(`Reasoning plan ${planId} not found`);
    }

    const checkpoint: ReasoningCheckpoint = {
      id: randomUUID(),
      label: input.label,
      status: input.status,
      summary: input.summary,
      timestamp: new Date().toISOString(),
      metrics: input.metrics
    };

    const record: ReasoningRunRecord = {
      ...latest,
      checkpoints: [...(latest.checkpoints ?? []), checkpoint],
      timestamp: new Date().toISOString()
    };

    await this.persistRun(record);
    return record;
  }

  async complete(planId: string, options: ReasoningCompletionOptions): Promise<ReasoningRunRecord> {
    const latest = await this.getLatest(planId);
    if (!latest) {
      throw new Error(`Reasoning plan ${planId} not found`);
    }

    const startedAt = latest.timestamp ? new Date(latest.timestamp).getTime() : Date.now();
    const durationMs = options.durationMs ?? Math.max(0, Date.now() - startedAt);

    const record: ReasoningRunRecord = {
      ...latest,
      status: options.status,
      metadata: {
        ...latest.metadata,
        completionSummary: options.summary,
        completionMetadata: options.metadata
      },
      durationMs,
      timestamp: new Date().toISOString()
    };

    await this.persistRun(record);
    return record;
  }

  async resume(planId: string): Promise<ReasoningRunRecord | null> {
    return this.getLatest(planId);
  }

  async list(limit = 10): Promise<ReasoningRunRecord[]> {
    return this.deps.memory.listReasoningRuns(limit);
  }

  async handleConsensusResult(payload: any): Promise<void> {
    const proposal = payload?.proposal;
    if (!proposal || proposal.type !== 'reasoning_plan') {
      return;
    }

    const planId = proposal.metadata?.planId ?? proposal.data?.planId;
    if (!planId) {
      return;
    }

    const latest = await this.getLatest(planId);
    if (!latest) {
      return;
    }

    const accepted = Boolean(payload?.accepted);
    const status: ReasoningRunRecord['status'] = accepted ? 'running' : 'aborted';
    const record: ReasoningRunRecord = {
      ...latest,
      status,
      validation: {
        ...(latest.validation ?? {}),
        consensusProposalId: proposal.id,
        consensusAccepted: accepted,
        finalizedAt: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    };

    await this.persistRun(record);
  }

  private async maybeProposeConsensus(
    record: ReasoningRunRecord,
    requireConsensus?: boolean
  ): Promise<{ required: boolean; proposalId?: string } | undefined> {
    if (!requireConsensus) {
      return { required: false };
    }
    if (!this.deps.proposeConsensus) {
      throw new Error('Consensus proposal function not configured for reasoning planner');
    }

    const proposalId = await this.deps.proposeConsensus({
      planId: record.planId,
      prompt: record.prompt,
      planType: record.planType,
      requestedAt: new Date().toISOString()
    });

    return {
      required: true,
      proposalId
    };
  }

  private async getLatest(planId: string): Promise<ReasoningRunRecord | null> {
    return this.deps.memory.getLatestReasoningRun(planId);
  }

  private async persistRun(record: ReasoningRunRecord): Promise<number> {
    this.logger.debug('reasoning', 'Persisting reasoning run', {
      planId: record.planId,
      status: record.status
    });
    return this.deps.memory.logReasoningRun(record);
  }
}
