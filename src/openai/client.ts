import OpenAI from 'openai';
import { Logger } from '../core/logger.js';
import { mergeModelInventory, getStaticOpenAIModelCatalog } from './model-catalog.js';
import type { OpenAICredentialSet, OpenAIModelCatalogEntry } from './types.js';
import type { OpenAIUsageMonitor } from './usage-monitor.js';

export interface OpenAIClientOptions extends OpenAICredentialSet {
  defaultModel?: string;
  defaultImageModel?: string;
  defaultVideoModel?: string;
  defaultSpeechModel?: string;
  defaultTranscriptionModel?: string;
  defaultModerationModel?: string;
  defaultSearchModel?: string;
  requestTimeoutMs?: number;
  userAgentExtension?: string;
  logger?: Logger;
  usageMonitor?: OpenAIUsageMonitor;
}

export type OpenAIResponseRequest = Record<string, unknown> & {
  model?: string;
};

export class OpenAIResponsesClient {
  private readonly client: OpenAI | null;
  private readonly logger: Logger;
  private readonly defaultModel?: string;
  private readonly defaultImageModel?: string;
  private readonly defaultVideoModel?: string;
  private readonly defaultSpeechModel?: string;
  private readonly defaultTranscriptionModel?: string;
  private readonly defaultModerationModel?: string;
  private readonly defaultSearchModel?: string;
  private readonly requestTimeoutMs?: number;
  private readonly usageMonitor?: OpenAIUsageMonitor;

  constructor(options: OpenAIClientOptions) {
    this.logger = options.logger ?? Logger.getInstance('openai');
    this.defaultModel = options.defaultModel;
  this.defaultImageModel = options.defaultImageModel ?? 'gpt-image-1';
  this.defaultVideoModel = options.defaultVideoModel ?? 'sora-2';
  this.defaultSpeechModel = options.defaultSpeechModel ?? 'gpt-voice-1';
  this.defaultTranscriptionModel = options.defaultTranscriptionModel ?? 'whisper-hd';
  this.defaultModerationModel = options.defaultModerationModel ?? 'omni-moderation-latest';
  this.defaultSearchModel = options.defaultSearchModel ?? 'gpt-search-1';
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.usageMonitor = options.usageMonitor;

    if (!options.apiKey) {
      this.logger.warn('openai', 'OpenAI API key not provided. Responses client is disabled.');
      this.client = null;
      return;
    }

    const defaultHeaders = options.userAgentExtension
      ? { 'User-Agent': options.userAgentExtension }
      : undefined;

    this.client = new OpenAI({
      apiKey: options.apiKey,
      organization: options.organizationId,
      project: options.projectId,
      defaultHeaders
    });

    this.logger.info('openai', 'OpenAI responses client initialized', {
      hasUserAgentExtension: Boolean(options.userAgentExtension),
      hasOrganization: Boolean(options.organizationId),
      hasProject: Boolean(options.projectId)
    });
  }

  isReady(): boolean {
    return this.client !== null;
  }

  getDefaultModel(): string | undefined {
    return this.defaultModel;
  }

  async ping(): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    try {
      await this.client.models.list();
      return true;
    } catch (error) {
      this.logger.warn('openai', 'OpenAI models listing failed during ping', undefined, error as Error);
      return false;
    }
  }

  async listAvailableModels(): Promise<string[]> {
    if (!this.client) {
      return [];
    }

    try {
      const response = await this.client.models.list();
      const items = Array.isArray(response.data) ? response.data : [];
      return items
        .map((entry: { id?: string }) => entry?.id)
        .filter((value: string | undefined): value is string => typeof value === 'string' && Boolean(value.trim()));
    } catch (error) {
      this.logger.warn('openai', 'Failed to enumerate OpenAI models', undefined, error as Error);
      return [];
    }
  }

  async getModelCatalogSnapshot(): Promise<{ fetchedAt: Date; models: OpenAIModelCatalogEntry[] }> {
    const inventory = await this.listAvailableModels();
    const models = mergeModelInventory(inventory, getStaticOpenAIModelCatalog());
    return { fetchedAt: new Date(), models };
  }

  async generateImage(request: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Configure the API key before invoking image generation.');
    }

    const payload = {
      model: request.model ?? this.defaultImageModel,
      ...request
    };
    this.logger.debug('openai', 'Dispatching OpenAI images.generate call', {
      model: payload.model
    });
  return this.client.images.generate(payload as never);
  }

  async generateVideo(request: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Configure the API key before invoking video generation.');
    }

    const payload = {
      model: request.model ?? this.defaultVideoModel,
      modalities: ['video'],
      ...request
    };
    this.logger.debug('openai', 'Dispatching OpenAI responses.create call for video generation', {
      model: payload.model
    });
  return this.client.responses.create(payload as never);
  }

  async generateSpeech(request: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Configure the API key before invoking speech generation.');
    }

    const payload = {
      model: request.model ?? this.defaultSpeechModel,
      ...request
    };
    this.logger.debug('openai', 'Dispatching OpenAI audio.speech.create call', {
      model: payload.model
    });
  return this.client.audio.speech.create(payload as never);
  }

  async transcribeAudio(request: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Configure the API key before invoking transcription.');
    }

    const payload = {
      model: request.model ?? this.defaultTranscriptionModel,
      ...request
    };
    this.logger.debug('openai', 'Dispatching OpenAI audio.transcriptions.create call', {
      model: payload.model
    });
  return this.client.audio.transcriptions.create(payload as never);
  }

  async moderateContent(request: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Configure the API key before invoking moderation.');
    }

    const payload = {
      model: request.model ?? this.defaultModerationModel,
      ...request
    };
    this.logger.debug('openai', 'Dispatching OpenAI moderations.create call', {
      model: payload.model
    });
  return this.client.moderations.create(payload as never);
  }

  async executeSearch(request: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Configure the API key before invoking search.');
    }

    const payload = {
      model: request.model ?? this.defaultSearchModel,
      metadata: { intent: 'search', ...(request.metadata as Record<string, unknown> | undefined) },
      ...request
    };
    this.logger.debug('openai', 'Dispatching OpenAI responses.create call for search workflow', {
      model: payload.model
    });
  return this.client.responses.create(payload as never);
  }

  async createRealtimeSession(request: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized. Configure the API key before creating realtime sessions.');
    }

    const payload = {
      model: request.model ?? this.defaultModel ?? 'gpt-4o-realtime-preview-2024-12-17',
      ...request
    };
    this.logger.debug('openai', 'Dispatching OpenAI realtime.sessions.create call', {
      model: payload.model
    });
    const realtime = (this.client as unknown as { realtime?: { sessions?: { create?: (params: Record<string, unknown>) => Promise<unknown> } } }).realtime;
    if (!realtime?.sessions?.create) {
      throw new Error('OpenAI realtime sessions API is unavailable in the current SDK version.');
    }
    return realtime.sessions.create(payload as Record<string, unknown>);
  }

  async createResponse<T = unknown>(request: OpenAIResponseRequest): Promise<T> {
    if (!this.client) {
      throw new Error('OpenAI responses client is not initialized. Ensure the API key is configured.');
    }

    const payload = { ...request };
    if (!payload.model) {
      if (!this.defaultModel) {
        throw new Error('No default OpenAI model configured for responses client.');
      }
      payload.model = this.defaultModel;
    }

    try {
      this.logger.debug('openai', 'Dispatching OpenAI responses.create call', {
        model: payload.model,
        hasStream: typeof payload.stream === 'boolean' ? payload.stream : false
      });

      const controller = this.requestTimeoutMs ? new AbortController() : undefined;
      let timeout: NodeJS.Timeout | undefined;
      if (controller && this.requestTimeoutMs) {
        timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        if (typeof timeout.unref === 'function') {
          timeout.unref();
        }
      }

      const response = await this.client.responses.create(payload, {
        signal: controller?.signal
      });

      if (timeout) {
        clearTimeout(timeout);
      }

      const usage = (response as { usage?: Record<string, unknown> }).usage ?? {};
      const rawInputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
      const rawOutputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
      const rawTotalTokens = Number(usage.total_tokens ?? rawInputTokens + rawOutputTokens);

      if (this.usageMonitor) {
        const inputTokens = Number.isFinite(rawInputTokens) ? rawInputTokens : 0;
        const outputTokens = Number.isFinite(rawOutputTokens) ? rawOutputTokens : 0;
        const totalTokens = Number.isFinite(rawTotalTokens) ? rawTotalTokens : Math.max(0, inputTokens + outputTokens);
        const createdAtSeconds = (response as { created?: number }).created;
        const timestamp = typeof createdAtSeconds === 'number' ? new Date(createdAtSeconds * 1000) : new Date();

        this.usageMonitor.recordUsage({
          id: (response as { id?: string }).id,
          timestamp,
          model: payload.model,
          inputTokens,
          outputTokens,
          totalTokens,
          metadata: typeof payload.metadata === 'object' ? (payload.metadata as Record<string, unknown>) : undefined
        });
      }

      return response as unknown as T;
    } catch (error) {
      this.logger.error('openai', 'OpenAI responses.create invocation failed', undefined, error as Error);
      throw error;
    }
  }
}
