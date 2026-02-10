import type { OpenAIModelCatalogEntry } from './types.js';

// Consolidated catalog aligned with OpenAI multimodal API documentation (Feb 2026 refresh).
// Includes text/code, search, moderation, audio, image, video, and realtime models.
export const OFFICIAL_MODEL_CATALOG: OpenAIModelCatalogEntry[] = [
  {
    id: 'gpt-5.3-codex',
    label: 'GPT-5.3 Codex',
    tier: 'pro',
    modalities: ['text', 'code'],
    defaultUseCases: ['agentic coding orchestration', 'multi-step repository upgrades'],
    recommendedStages: ['openai-synthesis', 'validation', 'consensus'],
    capabilities: ['reasoning', 'code_generation', 'tool_use'],
    fallback: ['gpt-5-codex', 'gpt-5-pro', 'gpt-5']
  },
  {
    id: 'gpt-5-codex',
    label: 'GPT-5 Codex',
    tier: 'flagship',
    modalities: ['text', 'code'],
    defaultUseCases: ['agentic coding tasks', 'code review and refactoring'],
    recommendedStages: ['openai-synthesis', 'validation'],
    capabilities: ['reasoning', 'code_generation', 'tool_use'],
    fallback: ['gpt-5-mini', 'gpt-5']
  },
  {
    id: 'gpt-5-pro',
    label: 'GPT-5 Pro',
    tier: 'pro',
    modalities: ['text', 'code'],
    defaultUseCases: ['mission critical reviews', 'regulated workloads'],
    recommendedStages: ['validation', 'consensus'],
    capabilities: ['reasoning', 'chain_of_thought', 'code_generation'],
    cost: {
      inputPerMillion: 15,
      outputPerMillion: 120,
      unit: 'per_million_tokens',
      notes: 'OpenAI API pricing (Oct 2025).'
    },
    fallback: ['gpt-5', 'gpt-4.1']
  },
  {
    id: 'gpt-5',
    label: 'GPT-5',
    tier: 'flagship',
    modalities: ['text', 'code'],
    defaultUseCases: ['complex reasoning', 'critical code reviews'],
    recommendedStages: ['architecture-blueprint', 'validation'],
    capabilities: ['reasoning', 'long_context', 'code_generation'],
    cost: {
      inputPerMillion: 1.25,
      cachedInputPerMillion: 0.125,
      outputPerMillion: 10,
      unit: 'per_million_tokens',
      notes: 'OpenAI API pricing (Oct 2025).'
    },
    fallback: ['gpt-5-mini', 'gpt-4.1']
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 Mini',
    tier: 'mini',
    modalities: ['text', 'code'],
    defaultUseCases: ['balanced reasoning', 'executive summaries'],
    recommendedStages: ['openai-synthesis', 'insight-summary'],
    capabilities: ['reasoning', 'code_generation'],
    cost: {
      inputPerMillion: 0.25,
      cachedInputPerMillion: 0.025,
      outputPerMillion: 2,
      unit: 'per_million_tokens',
      notes: 'OpenAI API pricing (Oct 2025).'
    },
    fallback: ['gpt-5-nano', 'gpt-4o']
  },
  {
    id: 'gpt-5-nano',
    label: 'GPT-5 Nano',
    tier: 'mini',
    modalities: ['text', 'code'],
    defaultUseCases: ['high-volume telemetry', 'quick lint feedback'],
    recommendedStages: ['code-lint', 'baseline-analysis'],
    capabilities: ['fast_response', 'code_completion'],
    cost: {
      inputPerMillion: 0.05,
      cachedInputPerMillion: 0.005,
      outputPerMillion: 0.4,
      unit: 'per_million_tokens',
      notes: 'OpenAI API pricing (Oct 2025).'
    },
    fallback: ['gpt-4o-mini']
  },
  {
    id: 'gpt-4.1',
    label: 'GPT-4.1',
    tier: 'flagship',
    modalities: ['text', 'code', 'image', 'audio'],
    defaultUseCases: ['general multimodal reasoning', 'agentic workflows'],
    recommendedStages: ['architecture-blueprint', 'validation'],
    capabilities: ['vision', 'speech', 'code_generation'],
    fallback: ['gpt-4o']
  },
  {
    id: 'gpt-4.1-mini',
    label: 'GPT-4.1 Mini',
    tier: 'mini',
    modalities: ['text', 'code', 'image'],
    defaultUseCases: ['fast multimodal synthesis', 'assistant responses'],
    recommendedStages: ['insight-summary', 'baseline-analysis'],
    capabilities: ['vision', 'fast_response'],
    fallback: ['gpt-4o-mini']
  },
  {
    id: 'gpt-4o',
    label: 'GPT-4o',
    tier: 'flagship',
    modalities: ['text', 'code', 'image', 'audio'],
    defaultUseCases: ['multimodal reasoning', 'production copilots'],
    recommendedStages: ['openai-synthesis', 'architecture-blueprint'],
    capabilities: ['vision', 'speech', 'tool_use'],
    cost: {
      inputPerMillion: 5,
      outputPerMillion: 15,
      unit: 'per_million_tokens',
      notes: 'OpenAI API pricing (Oct 2025).'
    },
    fallback: ['gpt-4.1', 'gpt-5-mini']
  },
  {
    id: 'gpt-4o-mini',
    label: 'GPT-4o Mini',
    tier: 'mini',
    modalities: ['text', 'code', 'image', 'audio'],
    defaultUseCases: ['assistant runtime', 'broad multimodal coverage'],
    recommendedStages: ['baseline-analysis', 'summaries'],
    capabilities: ['vision', 'speech', 'fast_response'],
    fallback: ['gpt-4.1-mini']
  },
  {
    id: 'gpt-4o-realtime-preview-2024-12-17',
    label: 'GPT-4o Realtime Preview',
    tier: 'realtime',
    modalities: ['realtime', 'audio', 'text', 'image'],
    defaultUseCases: ['live collaboration', 'voice co-pilots'],
    capabilities: ['low_latency', 'voice'],
    fallback: ['gpt-realtime']
  },
  {
    id: 'gpt-realtime',
    label: 'GPT Realtime',
    tier: 'realtime',
    modalities: ['realtime', 'audio', 'text'],
    defaultUseCases: ['premium voice interactions'],
    capabilities: ['low_latency', 'voice'],
    fallback: ['gpt-realtime-mini']
  },
  {
    id: 'gpt-realtime-mini',
    label: 'GPT Realtime Mini',
    tier: 'realtime',
    modalities: ['realtime', 'audio', 'text'],
    defaultUseCases: ['developer previews', 'lightweight voice agents'],
    capabilities: ['low_latency'],
    fallback: ['gpt-4o-realtime-preview-2024-12-17']
  },
  {
    id: 'gpt-image-1',
    label: 'GPT Image 1',
    tier: 'image',
    modalities: ['image'],
    defaultUseCases: ['high fidelity renders', 'marketing collateral'],
    capabilities: ['image_generation'],
    fallback: ['gpt-image-1-mini']
  },
  {
    id: 'gpt-image-1-mini',
    label: 'GPT Image 1 Mini',
    tier: 'image',
    modalities: ['image'],
    defaultUseCases: ['concept art', 'wireframes', 'documentation visuals'],
    capabilities: ['image_generation'],
    fallback: ['gpt-image-1']
  },
  {
    id: 'sora-2',
    label: 'Sora 2',
    tier: 'video',
    modalities: ['video'],
    defaultUseCases: ['storyboards', 'product walkthroughs'],
    capabilities: ['video_generation'],
    fallback: ['sora-2-pro']
  },
  {
    id: 'sora-2-pro',
    label: 'Sora 2 Pro',
    tier: 'video',
    modalities: ['video'],
    defaultUseCases: ['high fidelity video', 'enterprise creative'],
    capabilities: ['video_generation'],
    fallback: ['sora-2']
  },
  {
    id: 'whisper-hd',
    label: 'Whisper HD',
    tier: 'audio',
    modalities: ['audio'],
    defaultUseCases: ['enterprise transcription', 'multilingual captioning'],
    capabilities: ['speech_to_text'],
    fallback: ['whisper-1']
  },
  {
    id: 'whisper-1',
    label: 'Whisper v1',
    tier: 'audio',
    modalities: ['audio'],
    defaultUseCases: ['general speech to text'],
    capabilities: ['speech_to_text'],
    fallback: ['whisper-hd']
  },
  {
    id: 'gpt-voice-1',
    label: 'GPT Voice 1',
    tier: 'audio',
    modalities: ['audio'],
    defaultUseCases: ['conversational speech synthesis'],
    capabilities: ['text_to_speech'],
    fallback: ['gpt-voice-1-mini']
  },
  {
    id: 'gpt-voice-1-mini',
    label: 'GPT Voice 1 Mini',
    tier: 'audio',
    modalities: ['audio'],
    defaultUseCases: ['lightweight TTS', 'preview experiences'],
    capabilities: ['text_to_speech'],
    fallback: ['gpt-voice-1']
  },
  {
    id: 'omni-moderation-latest',
    label: 'Omni Moderation',
    tier: 'experimental',
    modalities: ['text', 'image', 'audio', 'video'],
    defaultUseCases: ['safety', 'content moderation'],
    capabilities: ['moderation'],
    fallback: ['text-moderation-latest']
  },
  {
    id: 'text-moderation-latest',
    label: 'Text Moderation Latest',
    tier: 'experimental',
    modalities: ['text'],
    defaultUseCases: ['text content moderation'],
    capabilities: ['moderation'],
    fallback: ['omni-moderation-latest']
  },
  {
    id: 'gpt-search-1',
    label: 'GPT Search 1',
    tier: 'experimental',
    modalities: ['text'],
    defaultUseCases: ['structured retrieval', 'enterprise search'],
    capabilities: ['search', 'retrieval_augmented'],
    fallback: ['gpt-4o']
  },
  {
    id: 'text-embedding-3-large',
    label: 'Text Embedding 3 Large',
    tier: 'experimental',
    modalities: ['text'],
    defaultUseCases: ['semantic search', 'RAG'],
    capabilities: ['embeddings'],
    fallback: ['text-embedding-3-small']
  },
  {
    id: 'text-embedding-3-small',
    label: 'Text Embedding 3 Small',
    tier: 'experimental',
    modalities: ['text'],
    defaultUseCases: ['semantic search', 'RAG'],
    capabilities: ['embeddings'],
    fallback: ['text-embedding-3-large']
  }
];

export function getStaticOpenAIModelCatalog(): OpenAIModelCatalogEntry[] {
  return OFFICIAL_MODEL_CATALOG.map((entry) => ({ ...entry }));
}

export function mergeModelInventory(
  inventory: string[] | undefined,
  baseCatalog: OpenAIModelCatalogEntry[] = getStaticOpenAIModelCatalog()
): OpenAIModelCatalogEntry[] {
  const catalogMap = new Map(baseCatalog.map((entry) => [entry.id, entry] as const));
  if (Array.isArray(inventory)) {
    for (const modelId of inventory) {
      if (!modelId || typeof modelId !== 'string') {
        continue;
      }
      if (!catalogMap.has(modelId)) {
        catalogMap.set(modelId, {
          id: modelId,
          label: modelId,
          tier: 'experimental',
          modalities: inferModalitiesFromIdentifier(modelId),
          defaultUseCases: ['unspecified'],
          capabilities: inferCapabilitiesFromIdentifier(modelId)
        });
      }
    }
  }
  return Array.from(catalogMap.values());
}

function inferModalitiesFromIdentifier(modelId: string): OpenAIModelCatalogEntry['modalities'] {
  if (/image/i.test(modelId)) {
    return ['image'];
  }
  if (/video|sora/i.test(modelId)) {
    return ['video'];
  }
  if (/audio|voice|whisper/i.test(modelId)) {
    return ['audio'];
  }
  if (/realtime/i.test(modelId)) {
    return ['realtime', 'audio', 'text'];
  }
  if (/embedding/i.test(modelId)) {
    return ['text'];
  }
  return ['text', 'code'];
}

function inferCapabilitiesFromIdentifier(modelId: string): string[] | undefined {
  if (/embedding/i.test(modelId)) {
    return ['embeddings'];
  }
  if (/moderation/i.test(modelId)) {
    return ['moderation'];
  }
  if (/search/i.test(modelId)) {
    return ['search'];
  }
  if (/video|sora/i.test(modelId)) {
    return ['video_generation'];
  }
  if (/image/i.test(modelId)) {
    return ['image_generation'];
  }
  if (/voice|audio/i.test(modelId)) {
    return ['text_to_speech'];
  }
  if (/whisper/i.test(modelId)) {
    return ['speech_to_text'];
  }
  return undefined;
}
