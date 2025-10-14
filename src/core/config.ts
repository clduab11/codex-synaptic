/**
 * Configuration management for Codex-Synaptic system
 */

import { readFile, writeFile, existsSync, mkdirSync } from 'fs';
import { promisify } from 'util';
import { join } from 'path';
import { Logger } from './logger.js';

const readFileAsync = promisify(readFile);
const writeFileAsync = promisify(writeFile);

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
}

export class ConfigurationManager {
  private logger = Logger.getInstance();
  private config: SystemConfiguration;
  private configDir = join(process.cwd(), 'config');
  private configFile = join(this.configDir, 'system.json');

  constructor() {
    this.config = this.getDefaultConfiguration();
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
      }
    };
  }

  async load(): Promise<void> {
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
      this.logger.error('config', 'Failed to load configuration', undefined, error as Error);
      throw error;
    }
  }

  async save(): Promise<void> {
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

    if (this.config.environment) {
      if (!Array.isArray(this.config.environment.autoStartProfiles)) {
        errors.push('environment.autoStartProfiles must be an array');
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
}
