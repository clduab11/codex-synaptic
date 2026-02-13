/**
 * MCP (Model Control Protocol) Bridge for external model integration.
 */

import { EventEmitter } from 'events';
import { setTimeout as sleep } from 'timers/promises';
import { Logger } from '../core/logger.js';

interface BridgeEndpoint {
  name: string;
  url: string;
}

interface StructuredBridgeError {
  code: string;
  message: string;
  endpoint: string;
  attempt: number;
  attempts: number;
  retryable: boolean;
  status?: number;
  details?: Record<string, unknown>;
}

export interface MCPBridgeResponse {
  ok: boolean;
  endpoint: string;
  attempts: number;
  durationMs: number;
  status?: number;
  data?: unknown;
  error?: StructuredBridgeError;
}

function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function endpointEnvKey(endpoint: string): string {
  return endpoint
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();
}

function parseHeadersEnv(raw?: string): Record<string, string> {
  if (!raw || !raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    }
    return headers;
  } catch {
    return {};
  }
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return {
    signal: controller.signal,
    cancel: () => clearTimeout(timer)
  };
}

export class MCPBridge extends EventEmitter {
  private logger = Logger.getInstance();
  private isRunning = false;
  private connectedEndpoints: Map<string, BridgeEndpoint> = new Map();

  constructor() {
    super();
    this.logger.info('mcp-bridge', 'MCP bridge created');
  }

  async initialize(): Promise<void> {
    this.logger.info('mcp-bridge', 'Initializing MCP bridge...');
    this.isRunning = true;
    this.logger.info('mcp-bridge', 'MCP bridge initialized');
  }

  async shutdown(): Promise<void> {
    this.logger.info('mcp-bridge', 'Shutting down MCP bridge...');
    this.isRunning = false;
    this.connectedEndpoints.clear();
    this.logger.info('mcp-bridge', 'MCP bridge shutdown complete');
  }

  private resolveEndpoint(endpoint: string): BridgeEndpoint {
    const existing = this.connectedEndpoints.get(endpoint);
    if (existing) {
      return existing;
    }

    if (/^https?:\/\//i.test(endpoint)) {
      return { name: endpoint, url: endpoint };
    }

    const key = endpointEnvKey(endpoint);
    const envUrl = process.env[`CODEX_MCP_ENDPOINT_${key}_URL`];
    if (envUrl && /^https?:\/\//i.test(envUrl)) {
      return { name: endpoint, url: envUrl };
    }

    throw new Error(
      `Endpoint "${endpoint}" is not connected. Provide an HTTP URL endpoint or set CODEX_MCP_ENDPOINT_${key}_URL.`
    );
  }

  connectEndpoint(endpoint: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const resolved = this.resolveEndpoint(endpoint);
        this.connectedEndpoints.set(endpoint, resolved);
        this.logger.info('mcp-bridge', 'Endpoint connected', {
          endpoint,
          url: resolved.url
        });
        resolve();
      } catch (error) {
        reject(error as Error);
      }
    });
  }

  getStatus(): any {
    return {
      isRunning: this.isRunning,
      connectedEndpoints: Array.from(this.connectedEndpoints.entries()).map(([name, value]) => ({
        name,
        url: value.url
      })),
      retryAttempts: parseIntEnv('CODEX_MCP_BRIDGE_RETRY_ATTEMPTS', 2),
      timeoutMs: parseIntEnv('CODEX_MCP_BRIDGE_TIMEOUT_MS', 8000)
    };
  }

  private resolveHeaders(endpoint: string): Record<string, string> {
    const endpointKey = endpointEnvKey(endpoint);
    const globalHeaders = parseHeadersEnv(process.env.CODEX_MCP_BRIDGE_HEADERS_JSON);
    const endpointHeaders = parseHeadersEnv(process.env[`CODEX_MCP_${endpointKey}_HEADERS_JSON`]);

    const authEnv = process.env.CODEX_MCP_BRIDGE_AUTH_TOKEN_ENV || 'CODEX_MCP_BRIDGE_BEARER_TOKEN';
    const globalToken = process.env[authEnv];
    const endpointToken = process.env[`CODEX_MCP_${endpointKey}_BEARER_TOKEN`];

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...globalHeaders,
      ...endpointHeaders
    };

    const token = endpointToken || globalToken;
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }

    return headers;
  }

  async sendMessage(endpoint: string, message: unknown): Promise<MCPBridgeResponse> {
    const startedAt = Date.now();
    const resolved = this.resolveEndpoint(endpoint);

    const timeoutMs = parseIntEnv('CODEX_MCP_BRIDGE_TIMEOUT_MS', 8000);
    const retryAttempts = parseIntEnv('CODEX_MCP_BRIDGE_RETRY_ATTEMPTS', 2);
    const retryDelayMs = parseIntEnv('CODEX_MCP_BRIDGE_RETRY_DELAY_MS', 300);
    const attempts = Math.max(1, retryAttempts + 1);

    this.logger.info('mcp-bridge', 'Sending MCP bridge message', {
      endpoint,
      url: resolved.url,
      attempts,
      timeoutMs
    });

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const { signal, cancel } = withTimeoutSignal(timeoutMs);
      try {
        const response = await fetch(resolved.url, {
          method: 'POST',
          headers: this.resolveHeaders(endpoint),
          body: JSON.stringify(message ?? {}),
          signal
        });
        cancel();

        const text = await response.text();
        let payload: unknown = text;
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch {
            // keep raw text
          }
        }

        if (response.ok) {
          const durationMs = Date.now() - startedAt;
          const result: MCPBridgeResponse = {
            ok: true,
            endpoint,
            attempts: attempt,
            durationMs,
            status: response.status,
            data: payload
          };
          this.logger.info('mcp-bridge', 'MCP bridge message delivered', {
            endpoint,
            attempts: attempt,
            status: response.status,
            durationMs
          });
          return result;
        }

        const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
        const error: StructuredBridgeError = {
          code: 'upstream_error',
          message: `Upstream responded with HTTP ${response.status}`,
          endpoint,
          attempt,
          attempts,
          retryable,
          status: response.status,
          details: {
            payload
          }
        };

        if (retryable && attempt < attempts) {
          this.logger.warn('mcp-bridge', 'Retrying MCP bridge request after upstream error', {
            endpoint,
            attempt,
            status: response.status,
            retryDelayMs
          });
          await sleep(retryDelayMs * attempt);
          continue;
        }

        return {
          ok: false,
          endpoint,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
          status: response.status,
          error
        };
      } catch (error) {
        cancel();

        const isAbort = (error as Error).name === 'AbortError';
        const retryable = true;
        const bridgeError: StructuredBridgeError = {
          code: isAbort ? 'timeout' : 'network_error',
          message: isAbort ? `Timed out after ${timeoutMs}ms` : (error as Error).message,
          endpoint,
          attempt,
          attempts,
          retryable,
          details: {
            timeoutMs,
            url: resolved.url
          }
        };

        if (attempt < attempts) {
          this.logger.warn('mcp-bridge', 'Retrying MCP bridge request after transport failure', {
            endpoint,
            attempt,
            retryDelayMs,
            reason: bridgeError.message
          });
          await sleep(retryDelayMs * attempt);
          continue;
        }

        return {
          ok: false,
          endpoint,
          attempts: attempt,
          durationMs: Date.now() - startedAt,
          error: bridgeError
        };
      }
    }

    return {
      ok: false,
      endpoint,
      attempts: 0,
      durationMs: Date.now() - startedAt,
      error: {
        code: 'unknown',
        message: 'Unexpected bridge execution state',
        endpoint,
        attempt: 0,
        attempts,
        retryable: false
      }
    };
  }
}
