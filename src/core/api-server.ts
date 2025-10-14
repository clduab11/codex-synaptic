import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { Logger } from './logger.js';
import { ToolCandidate, ToolScore } from '../tools/optimizer/index.js';
import { ToolUsageRecord } from '../memory/memory-system.js';

export interface ApiServerOptions {
  host: string;
  port: number;
  cors?: {
    enabled: boolean;
    origins: string[];
  };
}

export interface ApiServerDependencies {
  evaluateTools: (prompt: string, candidates: ToolCandidate[]) => Promise<ToolScore[]>;
  recordToolOutcome?: (record: ToolUsageRecord) => Promise<number>;
}

interface ParsedRequest<T = any> {
  body: T;
  url: URL;
}

export class ApiServer {
  private readonly logger: Logger;
  private server = createServer(this.handleRequest.bind(this));
  private options: ApiServerOptions | undefined;

  constructor(private readonly deps: ApiServerDependencies, logger?: Logger) {
    this.logger = logger ?? Logger.getInstance('api');
  }

  async start(options: ApiServerOptions): Promise<void> {
    if (this.options) {
      throw new Error('API server already started');
    }
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.server.off('listening', onListening);
        reject(error);
      };

      const onListening = () => {
        this.server.off('error', onError);
        const address = this.server.address();
        const port = typeof address === 'object' && address ? address.port : options.port;
        this.options = { ...options, port };
        this.logger.info('api', 'API server listening', { address });
        resolve();
      };

      this.server.once('error', onError);
      this.server.once('listening', onListening);
      this.server.listen(options.port, options.host);
    });
  }

  async stop(): Promise<void> {
    if (!this.options) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    this.options = undefined;
  }

  getAddress(): string | null {
    const address = this.server.address();
    if (!address) return null;
    if (typeof address === 'string') return address;
    return `${address.address}:${address.port}`;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.options) {
      this.sendJson(res, 503, { error: 'API server not ready' });
      return;
    }

    try {
      if (req.method === 'OPTIONS') {
        this.handleCors(res);
        res.writeHead(204);
        res.end();
        return;
      }

      const parsed = await this.parseRequest(req);
      const pathname = parsed.url.pathname;

      switch (req.method) {
        case 'GET':
          if (pathname === '/healthz') {
            this.sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
            return;
          }
          break;
        case 'POST':
          if (pathname === '/v1/tools/score') {
            await this.handleToolScore(parsed.body, res);
            return;
          }
          if (pathname === '/v1/tools/outcome') {
            await this.handleToolOutcome(parsed.body, res);
            return;
          }
          break;
        default:
          break;
      }

      this.sendJson(res, 404, { error: 'Not Found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('api', 'Unhandled API error', { message });
      this.sendJson(res, 500, { error: 'Internal Server Error', message });
    }
  }

  private async handleToolScore(payload: any, res: ServerResponse): Promise<void> {
    const validationErrors: string[] = [];
    if (!payload || typeof payload.prompt !== 'string' || payload.prompt.trim().length === 0) {
      validationErrors.push('prompt must be a non-empty string');
    }
    if (!Array.isArray(payload?.candidates) || payload.candidates.length === 0) {
      validationErrors.push('candidates must be a non-empty array');
    }
    if (validationErrors.length) {
      this.sendJson(res, 400, { error: 'Invalid request', details: validationErrors });
      return;
    }

    const candidates: ToolCandidate[] = payload.candidates.map((candidate: any, index: number) => {
      if (!candidate || typeof candidate.id !== 'string') {
        throw new Error(`Candidate at index ${index} is missing an id`);
      }
      return {
        id: candidate.id,
        description: candidate.description,
        agentType: candidate.agentType,
        capabilities: Array.isArray(candidate.capabilities) ? candidate.capabilities : undefined,
        costEstimateMs: typeof candidate.costEstimateMs === 'number' ? candidate.costEstimateMs : undefined
      };
    });

    const scores = await this.deps.evaluateTools(payload.prompt, candidates);
    this.sendJson(res, 200, {
      prompt: payload.prompt,
      generatedAt: new Date().toISOString(),
      scores
    });
  }

  private async handleToolOutcome(payload: any, res: ServerResponse): Promise<void> {
    if (!this.deps.recordToolOutcome) {
      this.sendJson(res, 501, { error: 'Tool outcome recording not enabled' });
      return;
    }

    if (!payload || typeof payload.toolId !== 'string') {
      this.sendJson(res, 400, { error: 'toolId is required' });
      return;
    }

    const record: ToolUsageRecord = {
      toolId: payload.toolId,
      agentType: payload.agentType,
      capability: payload.capability,
      promptHash: payload.promptHash,
      success: payload.success !== false,
      latencyMs: typeof payload.latencyMs === 'number' ? payload.latencyMs : undefined,
      confidence: typeof payload.confidence === 'number' ? payload.confidence : undefined,
      contextTags: Array.isArray(payload.contextTags) ? payload.contextTags.map(String) : undefined,
      metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : undefined,
      timestamp: payload.timestamp
    };

    await this.deps.recordToolOutcome(record);
    this.sendJson(res, 202, { status: 'accepted' });
  }

  private async parseRequest<T = any>(req: IncomingMessage): Promise<ParsedRequest<T>> {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? '127.0.0.1'}`);
    if (req.method === 'GET' || req.method === 'HEAD') {
      return { body: undefined as unknown as T, url };
    }

    const raw = await new Promise<string>((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
        if (data.length > 5 * 1024 * 1024) {
          reject(new Error('Payload too large'));
          req.destroy();
        }
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

    if (!raw) {
      return { body: {} as T, url };
    }

    try {
      const body = JSON.parse(raw);
      return { body, url };
    } catch (error) {
      throw new Error(`Invalid JSON payload: ${(error as Error).message}`);
    }
  }

  private handleCors(res: ServerResponse): void {
    if (!this.options?.cors?.enabled) {
      return;
    }
    const origins = this.options.cors.origins ?? ['*'];
    const originHeader = origins.includes('*') ? '*' : origins.join(',');
    res.setHeader('Access-Control-Allow-Origin', originHeader);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  }

  private sendJson(res: ServerResponse, statusCode: number, payload: any): void {
    this.handleCors(res);
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
  }
}
