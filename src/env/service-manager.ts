import { execSync } from 'child_process';
import { createConnection } from 'net';
import { setTimeout as sleep } from 'timers/promises';
import { Logger } from '../core/logger.js';

export type FilesystemAccessMode = 'read-only' | 'controlled-write';

export interface ServiceProfile {
  description: string;
  composeFile: string;
  services?: string[];
  port?: number;
  dockerImages?: string[];
  dockerRegistries?: string[];
  requiredEnv?: string[];
  codexName?: string;
  healthcheck?: {
    url: string;
    timeoutMs?: number;
    intervalMs?: number;
  };
}

export interface ServiceStatus {
  name: string;
  running: boolean;
  healthy: boolean | null;
  raw: string;
  diagnostics: string[];
  checkedAt: string;
}

export interface EnsureServiceOptions {
  waitForHealth?: boolean;
  filesystemMode?: FilesystemAccessMode;
  allowFilesystemWrite?: boolean;
}

const PROFILES: Record<string, ServiceProfile> = {
  observability: {
    description: 'Prometheus/Grafana stack with exporters',
    composeFile: 'docker/observability/docker-compose.observability.yml',
    services: ['prometheus', 'grafana', 'loki', 'promtail', 'node_exporter', 'cadvisor'],
    port: 9090,
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
    port: 6333,
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
    port: 6379,
    healthcheck: {
      url: 'http://localhost:8001',
      timeoutMs: 20_000,
      intervalMs: 2_000
    }
  },
  'mcp-github': {
    description: 'GitHub MCP server',
    composeFile: 'docker/mcp/docker-compose.github.yml',
    services: ['mcp-github'],
    port: 7010,
    dockerImages: ['ghcr.io/context-labs/github-mcp:latest'],
    requiredEnv: ['GITHUB_TOKEN'],
    codexName: 'github'
  },
  'mcp-context7': {
    description: 'Context7 browser MCP server',
    composeFile: 'docker/mcp/docker-compose.context7.yml',
    services: ['mcp-context7'],
    port: 7020,
    dockerImages: ['ghcr.io/context-labs/context7-mcp:latest'],
    requiredEnv: ['CONTEXT7_API_KEY'],
    codexName: 'context7'
  },
  'mcp-playwright': {
    description: 'Playwright automation MCP server',
    composeFile: 'docker/mcp/docker-compose.playwright.yml',
    services: ['mcp-playwright'],
    port: 7030,
    dockerImages: ['ghcr.io/context-labs/playwright-mcp:latest'],
    codexName: 'playwright-local'
  },
  'mcp-filesystem': {
    description: 'Local filesystem MCP server (read-only by default)',
    composeFile: 'docker/mcp/docker-compose.filesystem.yml',
    services: ['mcp-filesystem'],
    port: 7040,
    dockerImages: ['ghcr.io/context-labs/filesystem-mcp:latest'],
    codexName: 'filesystem-local'
  },
  'mcp-desktop-commander': {
    description: 'Desktop Commander MCP server for desktop/tooling automation',
    composeFile: 'docker/mcp/docker-compose.desktop-commander.yml',
    services: ['mcp-desktop-commander'],
    port: 7070,
    dockerImages: ['ghcr.io/wonderwhy-er/desktop-commander:latest'],
    codexName: 'desktop-commander'
  },
  'mcp-tavily': {
    description: 'Tavily search MCP server',
    composeFile: 'docker/mcp/docker-compose.tavily.yml',
    services: ['mcp-tavily'],
    port: 7050,
    dockerImages: ['ghcr.io/context-labs/tavily-mcp:latest'],
    requiredEnv: ['TAVILY_API_KEY'],
    codexName: 'tavily'
  },
  'mcp-firecrawl': {
    description: 'Firecrawl MCP server',
    composeFile: 'docker/mcp/docker-compose.firecrawl.yml',
    services: ['mcp-firecrawl'],
    port: 7060,
    dockerImages: ['ghcr.io/firecrawl/firecrawl-mcp:latest'],
    requiredEnv: ['FIRECRAWL_API_KEY'],
    codexName: 'firecrawl'
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

  private resolveFilesystemMode(options?: EnsureServiceOptions): FilesystemAccessMode {
    const envMode = process.env.CODEX_MCP_FILESYSTEM_MODE;
    const requested = options?.filesystemMode || (envMode as FilesystemAccessMode | undefined) || 'read-only';
    if (requested !== 'read-only' && requested !== 'controlled-write') {
      throw new Error('Filesystem mode must be read-only or controlled-write.');
    }
    return requested;
  }

  private resolveExecEnv(name: string, options?: EnsureServiceOptions): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };

    if (name === 'mcp-filesystem') {
      const mode = this.resolveFilesystemMode(options);
      const allowWrite = options?.allowFilesystemWrite === true || process.env.CODEX_MCP_FILESYSTEM_ALLOW_WRITE === '1';
      if (mode === 'controlled-write' && !allowWrite) {
        throw new Error(
          'controlled-write filesystem mode requires explicit approval. ' +
          'Pass --allow-filesystem-write or set CODEX_MCP_FILESYSTEM_ALLOW_WRITE=1.'
        );
      }
      env.MCP_FILESYSTEM_MOUNT_MODE = mode === 'controlled-write' ? 'rw' : 'ro';
    }

    return env;
  }

  async ensureService(name: string, options?: EnsureServiceOptions): Promise<void> {
    const profile = this.getProfile(name);
    const cmd = composeCommand(profile, 'up -d', profile.services);
    const env = this.resolveExecEnv(name, options);

    this.logger.info('env', `Starting service ${name}`, { command: cmd });
    try {
      execSync(cmd, { stdio: 'pipe', env, encoding: 'utf8' });
    } catch (error) {
      throw this.wrapComposeStartError(name, profile, cmd, error);
    }

    if (options?.waitForHealth !== false) {
      await this.waitForServiceHealth(name, profile);
    }
  }

  stopService(name: string): void {
    const profile = this.getProfile(name);
    const cmd = composeCommand(profile, 'down', profile.services);
    this.logger.info('env', `Stopping service ${name}`, { command: cmd });
    execSync(cmd, { stdio: 'inherit' });
  }

  async status(name: string): Promise<ServiceStatus> {
    const profile = this.getProfile(name);
    const cmd = composeCommand(profile, 'ps');
    const diagnostics: string[] = [];

    for (const required of profile.requiredEnv ?? []) {
      if (!process.env[required]) {
        diagnostics.push(`Missing required env var: ${required}`);
      }
    }

    try {
      const output = execSync(cmd, { stdio: 'pipe' }).toString();
      const running = /\bUp\b/.test(output);

      if (!running) {
        return {
          name,
          running,
          healthy: false,
          raw: output,
          diagnostics,
          checkedAt: new Date().toISOString()
        };
      }

      const healthy = await this.probeService(profile);
      if (!healthy) {
        diagnostics.push('Service process is running but health probe failed.');
      }

      return {
        name,
        running,
        healthy,
        raw: output,
        diagnostics,
        checkedAt: new Date().toISOString()
      };
    } catch (error) {
      diagnostics.push(`docker compose status failed: ${(error as Error).message}`);
      return {
        name,
        running: false,
        healthy: false,
        raw: (error as Error).message,
        diagnostics,
        checkedAt: new Date().toISOString()
      };
    }
  }

  plan(names?: string[]): Array<{ name: string; profile: ServiceProfile }> {
    if (!names || !names.length) {
      return this.listProfiles();
    }
    return names.map((name) => ({ name, profile: this.getProfile(name) }));
  }

  codexRegistration(name: string): { codexName: string; url: string } | null {
    const profile = this.getProfile(name);
    if (!profile.codexName || !profile.port) {
      return null;
    }

    return {
      codexName: profile.codexName,
      url: `http://localhost:${profile.port}`
    };
  }

  dockerImagesForProfiles(names: string[]): string[] {
    const images = new Set<string>();

    for (const name of names) {
      const profile = this.getProfile(name);
      for (const image of profile.dockerImages ?? []) {
        const normalized = image.trim();
        if (normalized) {
          images.add(normalized);
        }
      }
    }

    return Array.from(images);
  }

  registriesForProfiles(names: string[]): string[] {
    const registries = new Set<string>();

    for (const name of names) {
      const profile = this.getProfile(name);

      for (const registry of profile.dockerRegistries ?? []) {
        const normalized = registry.trim();
        if (normalized) {
          registries.add(normalized);
        }
      }

      for (const image of profile.dockerImages ?? []) {
        const registry = this.registryForImage(image);
        if (registry) {
          registries.add(registry);
        }
      }
    }

    return Array.from(registries);
  }

  dockerLogin(registry: string): void {
    const normalized = registry.trim();
    if (!normalized) {
      throw new Error('Docker registry is required for docker login.');
    }
    const cmd = `docker login ${normalized}`;
    this.logger.info('env', 'Authenticating Docker registry', { registry: normalized });
    execSync(cmd, { stdio: 'inherit' });
  }

  private registryForImage(image: string): string | null {
    const normalized = image.trim();
    if (!normalized) {
      return null;
    }

    const firstSegment = normalized.split('/')[0] ?? '';
    if (!firstSegment) {
      return null;
    }

    // Registry host is explicit only when the first segment contains host-like syntax.
    if (
      firstSegment.includes('.')
      || firstSegment.includes(':')
      || firstSegment === 'localhost'
    ) {
      return firstSegment;
    }

    return null;
  }

  private wrapComposeStartError(name: string, profile: ServiceProfile, cmd: string, error: unknown): Error {
    const execError = error as {
      status?: number | null;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };

    const stdout = this.toText(execError.stdout);
    const stderr = this.toText(execError.stderr);
    const combined = [stderr, stdout]
      .filter(Boolean)
      .join('\n')
      .trim();
    const output = combined || (execError.message?.trim() ?? 'Unknown docker compose error');
    const exitStatus = typeof execError.status === 'number' ? execError.status : null;
    const images = profile.dockerImages?.join(', ') || 'unknown image';

    let diagnosis = `Docker compose startup failed for ${name}`;
    let remediation = 'Verify Docker is running, then retry.';

    if (/pull access denied|requested access to the resource is denied|insufficient_scope|unauthorized|authentication required|error from registry:\s*denied/i.test(output)) {
      diagnosis = `Docker image pull/auth denied for ${name} (${images})`;
      remediation = `Run \`codex-synaptic env docker-login ${name}\` and retry \`codex-synaptic env up ${name}\`.`;
    } else if (/Cannot connect to the Docker daemon|Is the docker daemon running/i.test(output)) {
      diagnosis = `Docker daemon unavailable while starting ${name}`;
      remediation = 'Start Docker Desktop (or the Docker daemon) and retry.';
    } else if (/command not found|ENOENT/i.test(output)) {
      diagnosis = `Docker CLI unavailable while starting ${name}`;
      remediation = 'Install Docker with the Compose plugin and ensure `docker compose` works.';
    }

    const truncatedOutput = output.length > 500 ? `${output.slice(0, 500)}…` : output;
    const exitLabel = exitStatus === null ? 'unknown' : String(exitStatus);

    return new Error(
      `${diagnosis} (exit=${exitLabel}, compose=${cmd}). ${remediation} Raw docker output: ${truncatedOutput}`
    );
  }

  private toText(value: unknown): string {
    if (typeof value === 'string') {
      return value.trim();
    }

    if (Buffer.isBuffer(value)) {
      return value.toString('utf8').trim();
    }

    return '';
  }

  private async probeService(profile: ServiceProfile): Promise<boolean | null> {
    if (profile.healthcheck?.url) {
      return this.probeHttp(profile.healthcheck.url, 2000);
    }

    if (profile.port) {
      return this.probeTcp('127.0.0.1', profile.port, 1500);
    }

    return null;
  }

  private async waitForServiceHealth(name: string, profile: ServiceProfile): Promise<void> {
    const timeoutMs = profile.healthcheck?.timeoutMs ?? 30_000;
    const intervalMs = profile.healthcheck?.intervalMs ?? 2000;
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const healthy = await this.probeService(profile);
      if (healthy === null || healthy === true) {
        return;
      }

      this.logger.debug('env', 'Health probe pending', {
        profile: name,
        elapsedMs: Date.now() - start
      });
      await sleep(intervalMs);
    }

    throw new Error(`Service healthcheck timed out for ${name}`);
  }

  private async probeHttp(url: string, timeoutMs: number): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    try {
      const response = await fetch(url, { method: 'GET', signal: controller.signal });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private async probeTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const socket = createConnection({ host, port });
      let settled = false;

      const finish = (result: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        resolve(result);
      };

      const timer = setTimeout(() => finish(false), timeoutMs);
      if (typeof timer.unref === 'function') {
        timer.unref();
      }

      socket.once('connect', () => {
        clearTimeout(timer);
        finish(true);
      });

      socket.once('error', () => {
        clearTimeout(timer);
        finish(false);
      });
    });
  }
}

export const serviceManager = ServiceManager.getInstance();
