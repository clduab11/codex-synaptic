import { Logger } from '../core/logger.js';
import { getStaticOpenAIModelCatalog } from './model-catalog.js';
import type { OpenAIModelCatalogEntry, OpenAIModelRoutingConfig, OpenAIModelRoutingKeywordOverride } from './types.js';

export interface OpenAIModelRoutingContext {
  prompt: string;
  stageId: string;
  stageLabel: string;
  taskType?: string;
  priority?: number;
  payload?: Record<string, unknown>;
  stageContext?: Array<Record<string, unknown>>;
}

export interface OpenAIModelSelection {
  model: string;
  reason: string;
  catalogEntry?: OpenAIModelCatalogEntry;
  usedFallback: boolean;
  fallbackChain: string[];
}

export interface OpenAIModelRouterOptions {
  catalog?: OpenAIModelCatalogEntry[];
  routing?: OpenAIModelRoutingConfig;
  baselineDefaultModel?: string;
  fallbackDefaults?: string[];
  listModels?: () => Promise<string[]>;
  cacheTtlMs?: number;
  logger?: Logger;
}

const DEFAULT_ROUTING: OpenAIModelRoutingConfig = {
  defaultModel: 'gpt-5.3-codex',
  highComplexityModel: 'gpt-5-pro',
  evaluationModel: 'gpt-5-codex',
  allowDynamicFallback: true,
  stageOverrides: [
    {
      stageId: 'openai-synthesis',
      model: 'gpt-5-codex',
      rationale: 'OpenAI synthesis should prioritize codex-tuned reasoning.'
    },
    {
      stageId: 'insight-summary',
      model: 'gpt-5-mini',
      rationale: 'Insight synthesis balances throughput and reasoning quality.'
    },
    {
      stageId: 'moderation',
      model: 'omni-moderation-latest',
      rationale: 'Safety checks always route to the latest Omni moderation model.'
    }
  ],
  keywordOverrides: [
    {
      pattern: '\\b(video|storyboard|b-roll|animation|motion)\\b',
      flags: 'i',
      model: 'sora-2',
      rationale: 'Video-centric prompt escalated to Sora 2.'
    },
    {
      pattern: '\\b(image|mockup|poster|render|illustration)\\b',
      flags: 'i',
      model: 'gpt-image-1-mini',
      rationale: 'Image generation request detected.'
    },
    {
      pattern: '\\b(live|voice|realtime|meeting|call)\\b',
      flags: 'i',
      model: 'gpt-4o-realtime-preview-2024-12-17',
      rationale: 'Realtime voice workload detected.'
    },
    {
      pattern: '\\b(transcribe|caption|audio note|whisper)\\b',
      flags: 'i',
      model: 'whisper-hd',
      rationale: 'Audio transcription workload detected.'
    },
    {
      pattern: '\\b(search|retrieve|knowledge base|catalog)\\b',
      flags: 'i',
      model: 'gpt-search-1',
      rationale: 'Search/retrieval workload detected.'
    },
    {
      pattern: '\\b(safety|moderation|policy|guardrail)\\b',
      flags: 'i',
      model: 'omni-moderation-latest',
      rationale: 'Moderation workload detected.'
    }
  ]
};

export class OpenAIModelRouter {
  private readonly logger: Logger;
  private readonly catalogMap = new Map<string, OpenAIModelCatalogEntry>();
  private readonly routing: OpenAIModelRoutingConfig;
  private readonly fallbackDefaults: string[];
  private readonly baselineDefault: string | undefined;
  private readonly listModelsFn?: () => Promise<string[]>;
  private readonly cacheTtlMs: number;

  private availableModels: Set<string> | null = null;
  private lastRefresh = 0;

  constructor(options: OpenAIModelRouterOptions = {}) {
    this.logger = options.logger ?? Logger.getInstance('openai');

    const catalog = options.catalog?.length ? options.catalog : getStaticOpenAIModelCatalog();
    catalog.forEach((entry) => {
      if (entry?.id) {
        this.catalogMap.set(entry.id, entry);
      }
    });

    this.routing = {
      ...DEFAULT_ROUTING,
      ...(options.routing ?? {})
    };

    this.baselineDefault = options.baselineDefaultModel ?? this.routing.defaultModel ?? catalog[0]?.id;
    this.fallbackDefaults = options.fallbackDefaults?.length
      ? options.fallbackDefaults
      : ['gpt-5-codex', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano'];

    this.listModelsFn = options.listModels;
    this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60 * 1000; // 10 minutes
  }

  async selectModel(context: OpenAIModelRoutingContext): Promise<OpenAIModelSelection> {
    await this.ensureModelInventory();

    const overrideSelection = this.applyStageOverride(context);
    if (overrideSelection) {
      return overrideSelection;
    }

    const keywordSelection = this.applyKeywordOverrides(context);
    if (keywordSelection) {
      return keywordSelection;
    }

    const complexitySelection = this.applyComplexityHeuristics(context);
    if (complexitySelection) {
      return complexitySelection;
    }

    return this.selectDefault();
  }

  private async ensureModelInventory(): Promise<void> {
    if (!this.listModelsFn) {
      return;
    }
    const now = Date.now();
    if (this.availableModels && now - this.lastRefresh < this.cacheTtlMs) {
      return;
    }

    try {
      const models = await this.listModelsFn();
      if (Array.isArray(models) && models.length) {
        this.availableModels = new Set(models);
        this.lastRefresh = now;
        this.logger.debug('openai', 'Model inventory refreshed', {
          count: models.length
        });
      }
    } catch (error) {
      this.logger.warn('openai', 'Failed to refresh OpenAI model inventory', undefined, error as Error);
      // tolerate failures – we fall back to optimistic selection
    }
  }

  private applyStageOverride(context: OpenAIModelRoutingContext): OpenAIModelSelection | null {
    const overrides = this.routing.stageOverrides ?? [];
    const match = overrides.find((entry) => entry.stageId === context.stageId);
    if (!match) {
      return null;
    }
    return this.resolveSelection(match.model, `Stage override: ${match.rationale ?? match.stageId}`);
  }

  private applyKeywordOverrides(context: OpenAIModelRoutingContext): OpenAIModelSelection | null {
    const overrides = this.routing.keywordOverrides ?? [];
    if (!overrides.length) {
      return null;
    }

    const haystack = `${context.prompt}\n${context.stageLabel}`;
    for (const override of overrides) {
      if (this.keywordMatches(haystack, override)) {
        return this.resolveSelection(
          override.model,
          `Keyword heuristic matched pattern "${override.pattern}"${override.rationale ? ` – ${override.rationale}` : ''}`
        );
      }
    }
    return null;
  }

  private keywordMatches(text: string, override: OpenAIModelRoutingKeywordOverride): boolean {
    try {
      const regex = new RegExp(override.pattern, override.flags ?? 'i');
      return regex.test(text);
    } catch (error) {
      this.logger.warn('openai', 'Invalid keyword override regex encountered', {
        pattern: override.pattern,
        reason: (error as Error).message
      });
      return false;
    }
  }

  private applyComplexityHeuristics(context: OpenAIModelRoutingContext): OpenAIModelSelection | null {
    const isCodeTask = context.taskType?.includes('code') ?? false;
    const promptLength = context.prompt.length;
    const complexKeywords = /(compliance|regression|production|migration|security review|incident)/i;
    const highComplexity = promptLength > 1200 || complexKeywords.test(context.prompt);

    if (isCodeTask && context.stageId === 'validation') {
      const evaluationModel = this.routing.evaluationModel ?? 'gpt-5-mini';
      return this.resolveSelection(evaluationModel, 'Validation stage routed to evaluation model for guardrail coverage');
    }

    if (highComplexity) {
      const heavyModel = this.routing.highComplexityModel ?? 'gpt-5-pro';
      return this.resolveSelection(heavyModel, 'High complexity heuristic triggered');
    }

    if (isCodeTask) {
      return this.resolveSelection('gpt-5-codex', 'Code-oriented stage prefers Codex-tuned reasoning');
    }

    return null;
  }

  private selectDefault(): OpenAIModelSelection {
    const baseline = this.routing.defaultModel ?? this.baselineDefault;
    const reason = baseline
      ? 'Default routing preference'
      : 'Fallback to catalog baseline';
    return this.resolveSelection(baseline ?? 'gpt-5-codex', reason);
  }

  private resolveSelection(modelId: string, reason: string): OpenAIModelSelection {
    const catalogEntry = this.catalogMap.get(modelId);
    const candidateChain = this.buildCandidateChain(modelId, catalogEntry);

    for (const candidate of candidateChain) {
      if (this.isModelAvailable(candidate)) {
        const entry = this.catalogMap.get(candidate);
        const usedFallback = candidate !== modelId;
        return {
          model: candidate,
          reason: usedFallback ? `${reason} → fell back to ${candidate}` : reason,
          catalogEntry: entry,
          usedFallback,
          fallbackChain: candidateChain
        };
      }
    }

    const finalModel = this.baselineDefault ?? 'gpt-5-codex';
    return {
      model: finalModel,
      reason: `${reason} → exhausted fallbacks, using baseline ${finalModel}`,
      catalogEntry: this.catalogMap.get(finalModel),
      usedFallback: true,
      fallbackChain: candidateChain.concat(finalModel)
    };
  }

  private buildCandidateChain(initial: string, entry?: OpenAIModelCatalogEntry | undefined): string[] {
    const chain: string[] = [];
    const push = (value: string | undefined) => {
      if (!value) return;
      if (!chain.includes(value)) {
        chain.push(value);
      }
    };

    push(initial);

    const entryFallback = entry?.fallback;
    if (Array.isArray(entryFallback)) {
      entryFallback.forEach(push);
    } else if (typeof entryFallback === 'string') {
      push(entryFallback);
    }

    push(this.routing.defaultModel);
    this.fallbackDefaults.forEach(push);

    return chain.filter(Boolean);
  }

  private isModelAvailable(modelId: string): boolean {
    if (!this.availableModels || !this.availableModels.size) {
      return true;
    }
    if (this.availableModels.has(modelId)) {
      return true;
    }

    if (this.routing.allowDynamicFallback === false) {
      return false;
    }

    // Some APIs return models prefixed with provider namespace (e.g., openai/).
    for (const candidate of this.availableModels) {
      if (candidate.endsWith(modelId) || modelId.endsWith(candidate)) {
        return true;
      }
    }

    return false;
  }
}
