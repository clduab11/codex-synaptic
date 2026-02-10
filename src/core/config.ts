/**
 * Configuration management for Codex-Synaptic system
 */

import { readFile, writeFile, existsSync, mkdirSync } from 'fs';
import { promisify } from 'util';
import { join } from 'path';
import { Logger } from './logger.js';
import type { TenantQuota } from '../tenancy/types.js';
import { OPENAI_BACKENDS, type OpenAIConfiguration } from '../openai/types.js';

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

/**
 * Interface mode types for dual-interface architecture
 */
export type InterfaceMode = 'cli' | 'tui' | 'gui';

/**
 * Progressive disclosure tier for UI complexity
 */
export type InterfaceTier = 'beginner' | 'intermediate' | 'advanced';

/**
 * TUI-specific configuration
 */
export interface TuiConfig {
  /** Color theme for TUI */
  theme: 'dark' | 'light' | 'high-contrast';
  /** Refresh interval for telemetry updates in milliseconds */
  refreshInterval: number;
  /** Progressive disclosure tier */
  tier: InterfaceTier;
  /** Enable keyboard shortcut hints */
  showShortcuts: boolean;
  /** Enable animations */
  animations: boolean;
}

/**
 * GUI-specific configuration
 */
export interface GuiConfig {
  /** Window width in pixels */
  windowWidth: number;
  /** Window height in pixels */
  windowHeight: number;
  /** Port for daemon communication */
  port: number;
  /** Color theme for GUI */
  theme: 'dark' | 'light' | 'system';
  /** Progressive disclosure tier */
  tier: InterfaceTier;
  /** Auto-launch GUI when daemon starts (if mode is gui) */
  autoLaunch: boolean;
  /** Enable system tray integration */
  systemTray: boolean;
}

/**
 * Interface configuration for dual-interface architecture
 */
export interface InterfaceConfig {
  /** Current interface mode */
  mode: InterfaceMode;
  /** Enabled interface modes */
  enabledModes: InterfaceMode[];
  /** TUI-specific settings */
  tui: TuiConfig;
  /** GUI-specific settings */
  gui: GuiConfig;
}

export interface SystemConfiguration {
  system: {
    logLevel: string;
    maxAgents: number;
    heartbeatInterval: number;
    taskTimeout: number;
    selfHealing?: {
      enabled: boolean;
      redeployOnFailure: boolean;
      cooldownMs: number;
    };
  };
  networking: {
    defaultPort: number;
    protocols: string[];
    security: {
      encryption: boolean;
      authRequired: boolean;
    };
  };
  api?: {
    enabled: boolean;
    host: string;
    port: number;
    cors?: {
      enabled: boolean;
      origins: string[];
    };
  };
  mesh: {
    maxConnections: number;
    updateInterval: number;
    topology: 'ring' | 'mesh' | 'star' | 'tree' | 'hybrid';
    supportedTopologies?: Array<'ring' | 'mesh' | 'star' | 'tree' | 'hybrid'>;
    selfHealing?: {
      enabled: boolean;
      intervalMs: number;
    };
    maxRunDurationMs: number;
  };
  swarm: {
    defaultAlgorithm: 'pso' | 'aco' | 'flocking';
    maxIterations: number;
    convergenceThreshold: number;
    maxRunDurationMs: number;
  };
  consensus: {
    mechanism: 'raft' | 'bft' | 'pow' | 'pos' | 'hybrid';
    timeout: number;
    minVotes: number;
    faultTolerance?: number;
    stakeThreshold?: number;
    stakeTable?: Record<string, number>;
    quorumFactor?: number;
    fallbackMechanism?: 'raft' | 'bft' | 'pow' | 'pos';
  };
  scaling?: {
    enabled: boolean;
    minAgents: number;
    maxAgents: number;
    scaleUpThreshold: number;
    scaleDownThreshold: number;
    cooldownMs: number;
  };
  environment?: {
    autoStartProfiles: string[];
  };
  tenancy?: {
    enabled: boolean;
    defaultTenantId?: string;
    defaultQuota?: TenantQuota;
  };
  vector?: {
    enabled: boolean;
    engine: 'local' | 'qdrant' | 'redis';
    dimensions: number;
    collection: string;
    qdrant?: {
      url: string;
      apiKey?: string;
    };
    redis?: {
      host: string;
      port: number;
      prefix?: string;
    };
  };
  bridges: {
    mcp: {
      enabled: boolean;
      endpoints: string[];
    };
    a2a: {
      enabled: boolean;
      discoveryInterval: number;
    };
  };
  gpu?: {
    probeCacheTtlMs: number;
    disableProbeCache: boolean;
  };
  openai?: OpenAIConfiguration;
  /** Interface configuration for dual-interface architecture */
  interface?: InterfaceConfig;
}

export class ConfigurationManager {
  private logger = Logger.getInstance();
  private config: SystemConfiguration;
  private configDir = join(process.cwd(), 'config');
  private configFile = join(this.configDir, 'system.json');

  constructor() {
    this.config = this.getDefaultConfiguration();
  }

  private shouldBypassDisk(): boolean {
    return process.env.CODEX_CONFIG_SKIP_DISK_IO === '1';
  }

  private isTimeoutError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const timeoutCodes = new Set(['ETIMEDOUT', 'ETIME']);
    const err = error as NodeJS.ErrnoException;
    return Boolean(err.code && timeoutCodes.has(err.code));
  }

  private getDefaultConfiguration(): SystemConfiguration {
    return {
      system: {
        logLevel: 'info',
        maxAgents: 100,
        heartbeatInterval: 30000,
        taskTimeout: 300000,
        selfHealing: {
          enabled: true,
          redeployOnFailure: true,
          cooldownMs: 15000
        }
      },
      networking: {
        defaultPort: 8080,
        protocols: ['ws', 'tcp', 'grpc'],
        security: {
          encryption: true,
          authRequired: true
        }
      },
      api: {
        enabled: true,
        host: '0.0.0.0',
        port: 4242,
        cors: {
          enabled: true,
          origins: ['*']
        }
      },
      mesh: {
        maxConnections: 10,
        updateInterval: 5000,
        topology: 'mesh',
        supportedTopologies: ['mesh', 'ring', 'star', 'tree', 'hybrid'],
        selfHealing: {
          enabled: true,
          intervalMs: 15000
        },
        maxRunDurationMs: 3600000
      },
      swarm: {
        defaultAlgorithm: 'pso',
        maxIterations: 1000,
        convergenceThreshold: 0.01,
        maxRunDurationMs: 3600000
      },
      consensus: {
        mechanism: 'raft',
        timeout: 10000,
        minVotes: 3,
        quorumFactor: 0.5,
        stakeThreshold: 0.67,
        fallbackMechanism: 'raft'
      },
      scaling: {
        enabled: true,
        minAgents: 4,
        maxAgents: 40,
        scaleUpThreshold: 0.75,
        scaleDownThreshold: 0.35,
        cooldownMs: 45000
      },
      environment: {
        autoStartProfiles: ['observability']
      },
      tenancy: {
        enabled: false,
        defaultQuota: {
          maxConcurrentTasks: 10
        }
      },
      bridges: {
        mcp: {
          enabled: true,
          endpoints: ['http://localhost:8081']
        },
        a2a: {
          enabled: true,
          discoveryInterval: 60000
        }
      },
      vector: {
        enabled: false,
        engine: 'local',
        dimensions: 32,
        collection: 'codex-synaptic',
        qdrant: {
          url: 'http://localhost:6333'
        },
        redis: {
          host: '127.0.0.1',
          port: 6379,
          prefix: 'codex:vector'
        }
      },
      gpu: {
        probeCacheTtlMs: 300000,
        disableProbeCache: false
      },
      openai: {
        enabled: false,
        defaultBackend: 'native',
        credentials: {
          apiKeyEnv: 'OPENAI_API_KEY',
          organizationIdEnv: 'OPENAI_ORG_ID',
          projectIdEnv: 'OPENAI_PROJECT_ID'
        },
        responses: {
          enabled: true,
          defaultModel: 'gpt-5.3-codex',
          requestTimeoutMs: 60000
        },
        agents: {
          enabled: false,
          defaultModel: 'gpt-5-codex',
          maxHandoffDepth: 3,
          enableGuardrails: true
        },
        telemetry: {
          enabled: false,
          sampleRate: 1
        },
        modelCatalog: [
          {
            id: 'gpt-5.3-codex',
            label: 'GPT-5.3 Codex',
            tier: 'pro',
            modalities: ['text', 'code'],
            defaultUseCases: ['agentic coding orchestration', 'internal release hardening'],
            fallback: ['gpt-5-codex', 'gpt-5-pro', 'gpt-5']
          },
          {
            id: 'gpt-5-codex',
            label: 'GPT-5 Codex',
            tier: 'flagship',
            modalities: ['text', 'code'],
            defaultUseCases: ['agentic coding tasks', 'multi-step repository upgrades'],
            fallback: ['gpt-5-mini', 'gpt-5']
          },
          {
            id: 'gpt-oss-20b',
            label: 'GPT-OSS 20B',
            tier: 'oss',
            modalities: ['text', 'code'],
            defaultUseCases: ['analysis', 'summaries', 'code synthesis'],
            fallback: ['gpt-oss-120b', 'gpt-5-nano']
          },
          {
            id: 'gpt-oss-120b',
            label: 'GPT-OSS 120B',
            tier: 'oss',
            modalities: ['text', 'code'],
            defaultUseCases: ['architecture', 'deep reasoning'],
            fallback: ['gpt-5-nano', 'gpt-4o-mini']
          },
          {
            id: 'gpt-5-mini',
            label: 'GPT-5 Mini',
            tier: 'mini',
            modalities: ['text', 'code'],
            defaultUseCases: ['executive summaries', 'validation'],
            fallback: ['gpt-5-nano', 'gpt-4o-mini']
          },
          {
            id: 'gpt-5-nano',
            label: 'GPT-5 Nano',
            tier: 'mini',
            modalities: ['text', 'code'],
            defaultUseCases: ['high volume telemetry', 'baseline analysis'],
            fallback: ['gpt-4o-mini']
          },
          {
            id: 'gpt-5',
            label: 'GPT-5',
            tier: 'flagship',
            modalities: ['text', 'code'],
            defaultUseCases: ['complex reasoning', 'critical reviews'],
            fallback: ['gpt-5-mini']
          },
          {
            id: 'gpt-5-pro',
            label: 'GPT-5 Pro',
            tier: 'pro',
            modalities: ['text', 'code'],
            defaultUseCases: ['regulated workloads', 'consensus gating'],
            fallback: ['gpt-5', 'gpt-5-mini']
          },
          {
            id: 'gpt-4o-mini',
            label: 'GPT-4.0 Mini',
            tier: 'flagship',
            modalities: ['text', 'code'],
            defaultUseCases: ['general purpose fallback'],
            fallback: ['gpt-5-nano']
          },
          {
            id: 'gpt-image-1-mini',
            label: 'GPT Image 1 Mini',
            tier: 'image',
            modalities: ['image'],
            defaultUseCases: ['concept art', 'documentation visuals'],
            fallback: ['gpt-image-1']
          },
          {
            id: 'gpt-image-1',
            label: 'GPT Image 1',
            tier: 'image',
            modalities: ['image'],
            defaultUseCases: ['high fidelity renders'],
            fallback: ['gpt-5-mini']
          },
          {
            id: 'gpt-realtime-mini',
            label: 'GPT Realtime Mini',
            tier: 'realtime',
            modalities: ['realtime', 'audio', 'text'],
            defaultUseCases: ['live collaboration', 'voice co-pilots'],
            fallback: ['gpt-realtime']
          },
          {
            id: 'gpt-realtime',
            label: 'GPT Realtime',
            tier: 'realtime',
            modalities: ['realtime', 'audio', 'text'],
            defaultUseCases: ['premium live interactions'],
            fallback: ['gpt-5-mini']
          },
          {
            id: 'sora-2',
            label: 'Sora 2',
            tier: 'video',
            modalities: ['video'],
            defaultUseCases: ['storyboards', 'launch promos'],
            fallback: ['sora-2-pro']
          },
          {
            id: 'sora-2-pro',
            label: 'Sora 2 Pro',
            tier: 'video',
            modalities: ['video'],
            defaultUseCases: ['high fidelity creative'],
            fallback: ['sora-2']
          }
        ],
        modelRouting: {
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
            }
          ],
          keywordOverrides: [
            {
              pattern: '\\b(video|storyboard|b-roll|animation|motion)\\b',
              flags: 'i',
              model: 'sora-2',
              rationale: 'Video generation requests route to Sora.'
            },
            {
              pattern: '\\b(image|mockup|poster|render|illustration)\\b',
              flags: 'i',
              model: 'gpt-image-1-mini',
              rationale: 'Image deliverable requested.'
            },
            {
              pattern: '\\b(live|voice|transcription|real-time|meeting)\\b',
              flags: 'i',
              model: 'gpt-realtime-mini',
              rationale: 'Realtime/voice workload detected.'
            }
          ]
        }
      },
      interface: {
        mode: 'cli',
        enabledModes: ['cli', 'tui', 'gui'],
        tui: {
          theme: 'dark',
          refreshInterval: 1000,
          tier: 'intermediate',
          showShortcuts: true,
          animations: true
        },
        gui: {
          windowWidth: 1200,
          windowHeight: 800,
          port: 4242,
          theme: 'system',
          tier: 'intermediate',
          autoLaunch: false,
          systemTray: true
        }
      }
    };
  }

  async load(): Promise<void> {
    const skipDisk = this.shouldBypassDisk();

    if (skipDisk) {
      this.logger.warn('config', 'Skipping configuration disk access due to CODEX_CONFIG_SKIP_DISK_IO');
      this.validateConfiguration();
      return;
    }

    try {
      // Ensure config directory exists
      if (!existsSync(this.configDir)) {
        mkdirSync(this.configDir, { recursive: true });
      }

      if (existsSync(this.configFile)) {
        this.logger.info('config', 'Loading configuration from file', { file: this.configFile });
        const configData = await readFileAsync(this.configFile, 'utf8');
        const loadedConfig = JSON.parse(configData);
        
        // Merge with defaults
        this.config = this.mergeConfiguration(this.config, loadedConfig);
        
        this.logger.info('config', 'Configuration loaded successfully');
      } else {
        this.logger.info('config', 'No configuration file found, using defaults');
        await this.save();
      }
      
      // Validate configuration
      this.validateConfiguration();
      
    } catch (error) {
      if (this.isTimeoutError(error)) {
        this.logger.warn('config', 'Configuration load timed out, falling back to defaults', undefined, error as Error);
        this.config = this.getDefaultConfiguration();
        this.validateConfiguration();
        return;
      }

      this.logger.error('config', 'Failed to load configuration', undefined, error as Error);
      throw error;
    }
  }

  async save(): Promise<void> {
    if (this.shouldBypassDisk()) {
      this.logger.warn('config', 'Skipping configuration save due to CODEX_CONFIG_SKIP_DISK_IO');
      return;
    }

    try {
      const configData = JSON.stringify(this.config, null, 2);
      await writeFileAsync(this.configFile, configData, 'utf8');
      this.logger.info('config', 'Configuration saved successfully', { file: this.configFile });
    } catch (error) {
      this.logger.error('config', 'Failed to save configuration', undefined, error as Error);
      throw error;
    }
  }

  private mergeConfiguration(defaultConfig: any, loadedConfig: any): SystemConfiguration {
    const merged = { ...defaultConfig };
    
    for (const key in loadedConfig) {
      if (typeof loadedConfig[key] === 'object' && !Array.isArray(loadedConfig[key])) {
        merged[key] = this.mergeConfiguration(defaultConfig[key] || {}, loadedConfig[key]);
      } else {
        merged[key] = loadedConfig[key];
      }
    }
    
    return merged;
  }

  private validateConfiguration(): void {
    const errors: string[] = [];

    // System validation
    if (this.config.system.maxAgents <= 0) {
      errors.push('system.maxAgents must be greater than 0');
    }
    if (this.config.system.heartbeatInterval < 1000) {
      errors.push('system.heartbeatInterval must be at least 1000ms');
    }
    if (this.config.system.selfHealing?.cooldownMs !== undefined && this.config.system.selfHealing.cooldownMs < 5000) {
      errors.push('system.selfHealing.cooldownMs must be >= 5000ms');
    }

    if (this.config.mesh.maxRunDurationMs < 0) {
      errors.push('mesh.maxRunDurationMs must be >= 0');
    }
    if (this.config.mesh.selfHealing?.intervalMs !== undefined && this.config.mesh.selfHealing.intervalMs < 5000) {
      errors.push('mesh.selfHealing.intervalMs must be >= 5000ms');
    }

    if (this.config.swarm.maxRunDurationMs < 0) {
      errors.push('swarm.maxRunDurationMs must be >= 0');
    }

    // Networking validation
    if (this.config.networking.defaultPort < 1 || this.config.networking.defaultPort > 65535) {
      errors.push('networking.defaultPort must be between 1 and 65535');
    }

    if (this.config.api?.enabled) {
      if (this.config.api.port < 1 || this.config.api.port > 65535) {
        errors.push('api.port must be between 1 and 65535');
      }
      if (!this.config.api.host) {
        errors.push('api.host must be provided when api.enabled is true');
      }
      if (this.config.api.cors?.enabled && this.config.api.cors.origins && !Array.isArray(this.config.api.cors.origins)) {
        errors.push('api.cors.origins must be an array when CORS is enabled');
      }
    }

    // Consensus validation
    if (this.config.consensus.timeout < 1000) {
      errors.push('consensus.timeout must be at least 1000ms');
    }
    if (this.config.consensus.minVotes < 1) {
      errors.push('consensus.minVotes must be at least 1');
    }
    if (this.config.consensus.stakeThreshold !== undefined && (this.config.consensus.stakeThreshold <= 0 || this.config.consensus.stakeThreshold > 1)) {
      errors.push('consensus.stakeThreshold must be between 0 and 1');
    }

    if (this.config.scaling) {
      const scaling = this.config.scaling;
      if (scaling.minAgents < 1) {
        errors.push('scaling.minAgents must be at least 1');
      }
      if (scaling.maxAgents < scaling.minAgents) {
        errors.push('scaling.maxAgents must be greater than or equal to scaling.minAgents');
      }
      if (scaling.cooldownMs < 5000) {
        errors.push('scaling.cooldownMs must be >= 5000ms');
      }
      if (scaling.scaleUpThreshold <= scaling.scaleDownThreshold) {
        errors.push('scaling.scaleUpThreshold must be greater than scaling.scaleDownThreshold');
      }
    }

    if (this.config.gpu) {
      if (this.config.gpu.probeCacheTtlMs < 0) {
        errors.push('gpu.probeCacheTtlMs must be >= 0');
      }
    }

    if (this.config.vector) {
      if (!['local', 'qdrant', 'redis'].includes(this.config.vector.engine)) {
        errors.push('vector.engine must be local, qdrant, or redis');
      }
      if (this.config.vector.dimensions <= 0) {
        errors.push('vector.dimensions must be greater than 0');
      }
      if (!this.config.vector.collection) {
        errors.push('vector.collection must be provided');
      }
    }

    if (this.config.openai) {
      const openai = this.config.openai;
      if (!OPENAI_BACKENDS.includes(openai.defaultBackend)) {
        errors.push('openai.defaultBackend must be one of ' + OPENAI_BACKENDS.join(', '));
      }
      if (openai.telemetry?.sampleRate !== undefined) {
        if (openai.telemetry.sampleRate < 0 || openai.telemetry.sampleRate > 1) {
          errors.push('openai.telemetry.sampleRate must be between 0 and 1');
        }
      }
      if (openai.agents?.maxHandoffDepth !== undefined && openai.agents.maxHandoffDepth < 0) {
        errors.push('openai.agents.maxHandoffDepth must be >= 0');
      }
      if (openai.responses?.requestTimeoutMs !== undefined && openai.responses.requestTimeoutMs < 0) {
        errors.push('openai.responses.requestTimeoutMs must be >= 0');
      }
    }

    if (this.config.environment) {
      if (!Array.isArray(this.config.environment.autoStartProfiles)) {
        errors.push('environment.autoStartProfiles must be an array');
      }
    }

    if (this.config.tenancy?.defaultQuota) {
      const quota = this.config.tenancy.defaultQuota;
      if (quota.maxConcurrentTasks !== undefined && quota.maxConcurrentTasks < 0) {
        errors.push('tenancy.defaultQuota.maxConcurrentTasks must be >= 0');
      }
      if (quota.cpuLimitPercent !== undefined && (quota.cpuLimitPercent <= 0 || quota.cpuLimitPercent > 100)) {
        errors.push('tenancy.defaultQuota.cpuLimitPercent must be between 0 and 100');
      }
      if (quota.memoryLimitMb !== undefined && quota.memoryLimitMb <= 0) {
        errors.push('tenancy.defaultQuota.memoryLimitMb must be greater than 0');
      }
    }

    // Interface configuration validation
    if (this.config.interface) {
      const iface = this.config.interface;
      const validModes: InterfaceMode[] = ['cli', 'tui', 'gui'];
      const validTiers: InterfaceTier[] = ['beginner', 'intermediate', 'advanced'];
      
      if (!validModes.includes(iface.mode)) {
        errors.push('interface.mode must be one of: cli, tui, gui');
      }
      if (!Array.isArray(iface.enabledModes) || iface.enabledModes.some(m => !validModes.includes(m))) {
        errors.push('interface.enabledModes must be an array of valid modes (cli, tui, gui)');
      }
      if (iface.tui) {
        if (!['dark', 'light', 'high-contrast'].includes(iface.tui.theme)) {
          errors.push('interface.tui.theme must be one of: dark, light, high-contrast');
        }
        if (iface.tui.refreshInterval < 100) {
          errors.push('interface.tui.refreshInterval must be at least 100ms');
        }
        if (!validTiers.includes(iface.tui.tier)) {
          errors.push('interface.tui.tier must be one of: beginner, intermediate, advanced');
        }
      }
      if (iface.gui) {
        if (iface.gui.windowWidth < 400) {
          errors.push('interface.gui.windowWidth must be at least 400');
        }
        if (iface.gui.windowHeight < 300) {
          errors.push('interface.gui.windowHeight must be at least 300');
        }
        if (iface.gui.port < 1 || iface.gui.port > 65535) {
          errors.push('interface.gui.port must be between 1 and 65535');
        }
        if (!['dark', 'light', 'system'].includes(iface.gui.theme)) {
          errors.push('interface.gui.theme must be one of: dark, light, system');
        }
        if (!validTiers.includes(iface.gui.tier)) {
          errors.push('interface.gui.tier must be one of: beginner, intermediate, advanced');
        }
      }
    }

    if (errors.length > 0) {
      const error = new Error(`Configuration validation failed: ${errors.join(', ')}`);
      this.logger.error('config', 'Configuration validation failed', { errors });
      throw error;
    }

    this.logger.info('config', 'Configuration validation passed');
  }

  get(): SystemConfiguration {
    return { ...this.config };
  }

  update(updates: Partial<SystemConfiguration>): void {
    this.config = this.mergeConfiguration(this.config, updates);
    this.validateConfiguration();
    this.logger.info('config', 'Configuration updated', { updates });
  }

  getSystemConfig() {
    return this.config.system;
  }

  getNetworkingConfig() {
    return this.config.networking;
  }

  getApiConfig() {
    return this.config.api;
  }

  getMeshConfig() {
    return this.config.mesh;
  }

  getSwarmConfig() {
    return this.config.swarm;
  }

  getConsensusConfig() {
    return this.config.consensus;
  }
  getVectorConfig() {
    return this.config.vector;
  }


  getBridgesConfig() {
    return this.config.bridges;
  }

  getScalingConfig() {
    return this.config.scaling;
  }

  getTenancyConfig() {
    return this.config.tenancy;
  }

  getOpenAIConfig() {
    return this.config.openai;
  }

  getInterfaceConfig() {
    return this.config.interface;
  }
}
