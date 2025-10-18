export type OpenAIBackend = 'native' | 'openai-responses' | 'openai-agents-sdk';

export interface OpenAICredentialsConfig {
  apiKeyEnv?: string;
  organizationIdEnv?: string;
  projectIdEnv?: string;
}

export interface OpenAIResponsesConfiguration {
  enabled: boolean;
  defaultModel?: string;
  defaultImageModel?: string;
  defaultVideoModel?: string;
  defaultSpeechModel?: string;
  defaultTranscriptionModel?: string;
  defaultModerationModel?: string;
  defaultSearchModel?: string;
  requestTimeoutMs?: number;
  userAgentExtension?: string;
}

export type OpenAIModelTier =
  | 'oss'
  | 'mini'
  | 'flagship'
  | 'pro'
  | 'image'
  | 'video'
  | 'audio'
  | 'realtime'
  | 'experimental';

export type OpenAIModelModality = 'text' | 'code' | 'image' | 'video' | 'audio' | 'realtime';

export interface OpenAIModelCostBreakdown {
  inputPerMillion?: number;
  cachedInputPerMillion?: number;
  outputPerMillion?: number;
  fixedPerCall?: number;
  unit?: 'per_million_tokens' | 'per_video_minute' | 'per_image' | 'per_call';
  notes?: string;
}

export interface OpenAIModelCatalogEntry {
  id: string;
  label: string;
  tier: OpenAIModelTier;
  modalities: OpenAIModelModality[];
  defaultUseCases: string[];
  recommendedStages?: string[];
  capabilities?: string[];
  cost?: OpenAIModelCostBreakdown;
  fallback?: string | string[];
  preferred?: boolean;
}

export interface OpenAIModelRoutingStageOverride {
  stageId: string;
  model: string;
  rationale?: string;
}

export interface OpenAIModelRoutingKeywordOverride {
  pattern: string;
  flags?: string;
  model: string;
  rationale?: string;
}

export interface OpenAIModelRoutingConfig {
  defaultModel?: string;
  stageOverrides?: OpenAIModelRoutingStageOverride[];
  keywordOverrides?: OpenAIModelRoutingKeywordOverride[];
  highComplexityModel?: string;
  evaluationModel?: string;
  allowDynamicFallback?: boolean;
}

export interface OpenAIAgentsConfiguration {
  enabled: boolean;
  defaultModel?: string;
  maxHandoffDepth?: number;
  enableGuardrails?: boolean;
}

export interface OpenAITelemetryConfiguration {
  enabled: boolean;
  sampleRate?: number;
}

export interface OpenAIConfiguration {
  enabled: boolean;
  defaultBackend: OpenAIBackend;
  credentials?: OpenAICredentialsConfig;
  responses?: OpenAIResponsesConfiguration;
  agents?: OpenAIAgentsConfiguration;
  telemetry?: OpenAITelemetryConfiguration;
  modelCatalog?: OpenAIModelCatalogEntry[];
  modelRouting?: OpenAIModelRoutingConfig;
}

export interface OpenAICredentialSet {
  apiKey?: string;
  organizationId?: string;
  projectId?: string;
}

export interface OpenAIResolvedConfiguration {
  config: OpenAIConfiguration;
  credentials: OpenAICredentialSet;
}

export const OPENAI_BACKENDS = ['native', 'openai-responses', 'openai-agents-sdk'] as const;

const DEFAULT_CREDENTIAL_ENV: Required<OpenAICredentialsConfig> = {
  apiKeyEnv: 'OPENAI_API_KEY',
  organizationIdEnv: 'OPENAI_ORG_ID',
  projectIdEnv: 'OPENAI_PROJECT_ID'
};

export function resolveOpenAICredentials(config?: OpenAIConfiguration): OpenAICredentialSet {
  const credentialConfig: Required<OpenAICredentialsConfig> = {
    ...DEFAULT_CREDENTIAL_ENV,
    ...(config?.credentials ?? {})
  };

  return {
    apiKey: credentialConfig.apiKeyEnv ? process.env[credentialConfig.apiKeyEnv] : undefined,
    organizationId: credentialConfig.organizationIdEnv ? process.env[credentialConfig.organizationIdEnv] : undefined,
    projectId: credentialConfig.projectIdEnv ? process.env[credentialConfig.projectIdEnv] : undefined
  };
}

export function resolveOpenAIConfiguration(config?: OpenAIConfiguration): OpenAIResolvedConfiguration | null {
  if (!config) {
    return null;
  }

  const credentials = resolveOpenAICredentials(config);
  return {
    config,
    credentials
  };
}

export function isOpenAIIntegrationReady(config?: OpenAIConfiguration, credentials?: OpenAICredentialSet): boolean {
  if (!config?.enabled) {
    return false;
  }
  const resolved = credentials ?? resolveOpenAICredentials(config);
  return typeof resolved.apiKey === 'string' && resolved.apiKey.trim().length > 0;
}
