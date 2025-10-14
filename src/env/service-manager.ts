import { execSync } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { Logger } from '../core/logger.js';

export interface ServiceProfile {
  description: string;
  composeFile: string;
  services?: string[];
  healthcheck?: {
    url: string;
    timeoutMs?: number;
    intervalMs?: number;
  };
}

export interface ServiceStatus {
  name: string;
  running: boolean;
  raw: string;
}

const PROFILES: Record<string, ServiceProfile> = {
  observability: {
    description: 'Prometheus/Grafana stack with exporters',
    composeFile: 'docker/observability/docker-compose.observability.yml',
    services: ['prometheus', 'grafana', 'loki', 'promtail', 'node_exporter', 'cadvisor'],
    healthcheck: {
      url: 'http://localhost:9090/-/ready',
      timeoutMs: 60_000,
      intervalMs: 3_000
    }
  },
  qdrant: {
    description: 'Qdrant vector database',
    composeFile: 'docker/vector/docker-compose.qdrant.yml',
    services: ['qdrant'],
    healthcheck: {
      url: 'http://localhost:6333/healthz',
      timeoutMs: 30_000,
      intervalMs: 2_000
    }
  },
  redis: {
    description: 'Redis (Redis Stack) instance',
    composeFile: 'docker/vector/docker-compose.redis.yml',
    services: ['redis'],
    healthcheck: {
      url: 'http://localhost:8001',
      timeoutMs: 20_000,
      intervalMs: 2_000
    }
  },
  'mcp-github': {
    description: 'GitHub MCP server',
    composeFile: 'docker/mcp/docker-compose.github.yml',
    services: ['mcp-github']
  },
  'mcp-context7': {
    description: 'Context7 browser MCP server',
    composeFile: 'docker/mcp/docker-compose.context7.yml',
    services: ['mcp-context7']
  },
  'mcp-playwright': {
    description: 'Playwright automation MCP server',
    composeFile: 'docker/mcp/docker-compose.playwright.yml',
    services: ['mcp-playwright']
  },
  'mcp-filesystem': {
    description: 'Local filesystem MCP server',
    composeFile: 'docker/mcp/docker-compose.filesystem.yml',
    services: ['mcp-filesystem']
  },
  'mcp-tavily': {
    description: 'Tavily search MCP server',
    composeFile: 'docker/mcp/docker-compose.tavily.yml',
    services: ['mcp-tavily']
  },
  'mcp-firecrawl': {
    description: 'Firecrawl MCP server',
    composeFile: 'docker/mcp/docker-compose.firecrawl.yml',
    services: ['mcp-firecrawl']
  }
};

function composeCommand(profile: ServiceProfile, command: string, services?: string[]): string {
  const serviceArgs = services && services.length ? ` ${services.join(' ')}` : '';
  return `docker compose -f ${profile.composeFile} ${command}${serviceArgs}`;
}

class ServiceManager {
  private static instance: ServiceManager;
  private readonly logger = Logger.getInstance();

  static getInstance(): ServiceManager {
    if (!ServiceManager.instance) {
      ServiceManager.instance = new ServiceManager();
    }
    return ServiceManager.instance;
  }

  listProfiles(): Array<{ name: string; profile: ServiceProfile }> {
    return Object.entries(PROFILES).map(([name, profile]) => ({ name, profile }));
  }

  getProfile(name: string): ServiceProfile {
    const profile = PROFILES[name];
    if (!profile) {
      throw new Error(`Unknown service profile "${name}"`);
    }
    return profile;
  }

  async ensureService(name: string, options?: { waitForHealth?: boolean }): Promise<void> {
    const profile = this.getProfile(name);
    const cmd = composeCommand(profile, 'up -d', profile.services);
    this.logger.info('env', `Starting service ${name}`, { command: cmd });
    execSync(cmd, { stdio: 'inherit' });

    if (options?.waitForHealth !== false && profile.healthcheck) {
      await this.waitForHealth(profile.healthcheck);
    }
  }

  stopService(name: string): void {
    const profile = this.getProfile(name);
    const cmd = composeCommand(profile, 'down', profile.services);
    this.logger.info('env', `Stopping service ${name}`, { command: cmd });
    execSync(cmd, { stdio: 'inherit' });
  }

  status(name: string): ServiceStatus {
    const profile = this.getProfile(name);
    const cmd = composeCommand(profile, 'ps');
    try {
      const output = execSync(cmd, { stdio: 'pipe' }).toString();
      const running = /Up/.test(output);
      return { name, running, raw: output };
    } catch (error) {
      return { name, running: false, raw: (error as Error).message };
    }
  }

  plan(names?: string[]): Array<{ name: string; profile: ServiceProfile }> {
    if (!names || !names.length) {
      return this.listProfiles();
    }
    return names.map((name) => ({ name, profile: this.getProfile(name) }));
  }

  private async waitForHealth(healthcheck: Required<ServiceProfile>['healthcheck']): Promise<void> {
    const timeout = healthcheck.timeoutMs ?? 60_000;
    const interval = healthcheck.intervalMs ?? 2_000;
    const start = Date.now();

    while (Date.now() - start < timeout) {
      try {
        const response = await fetch(healthcheck.url, { method: 'GET' });
        if (response.ok) {
          return;
        }
      } catch (error) {
        this.logger.debug('env', 'Healthcheck probe failed', { url: healthcheck.url, error: (error as Error).message });
      }
      await sleep(interval);
    }
    throw new Error(`Service healthcheck timed out (${healthcheck.url})`);
  }
}

export const serviceManager = ServiceManager.getInstance();
