import { createServer, type IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { Logger } from './logger.js';
import { ToolCandidate, ToolScore } from '../tools/optimizer/index.js';
import { ToolUsageRecord, ReasoningRunRecord } from '../memory/memory-system.js';
import {
  ReasoningPlanOptions,
  ReasoningPlanCreationResult,
  ReasoningCheckpointInput,
  ReasoningCompletionOptions
} from '../reasoning/planner.js';
import type { TenantContext, TenantPolicy, TenantQuota, TenantRecord } from '../tenancy/types.js';

export interface ApiServerOptions {
  host: string;
  port: number;
  cors?: {
    enabled: boolean;
    origins: string[];
  };
}

export interface ApiInvocationContext {
  tenant?: TenantContext | null;
}

export interface ApiServerDependencies {
  evaluateTools: (prompt: string, candidates: ToolCandidate[], context?: ApiInvocationContext) => Promise<ToolScore[]>;
  recordToolOutcome?: (record: ToolUsageRecord, context?: ApiInvocationContext) => Promise<number>;
  createPlan?: (prompt: string, options: ReasoningPlanOptions | undefined, context?: ApiInvocationContext) => Promise<ReasoningPlanCreationResult>;
  checkpointPlan?: (planId: string, input: ReasoningCheckpointInput, context?: ApiInvocationContext) => Promise<ReasoningRunRecord>;
  completePlan?: (planId: string, options: ReasoningCompletionOptions, context?: ApiInvocationContext) => Promise<ReasoningRunRecord>;
  getPlan?: (planId: string, context?: ApiInvocationContext) => Promise<ReasoningRunRecord | null>;
  listPlans?: (limit: number, context?: ApiInvocationContext) => Promise<ReasoningRunRecord[]>;
  resolveTenant?: (headers: IncomingHttpHeaders) => Promise<TenantContext | null>;
  listTenants?: (limit?: number) => Promise<TenantRecord[]>;
  createTenant?: (input: { name: string; id?: string; metadata?: Record<string, any> }) => Promise<TenantRecord>;
  getTenant?: (tenantId: string) => Promise<TenantRecord | null>;
  getTenantPolicy?: (tenantId: string) => Promise<TenantPolicy | null>;
  getTenantQuota?: (tenantId: string) => Promise<TenantQuota | null>;
  upsertTenantPolicy?: (policy: TenantPolicy) => Promise<TenantPolicy>;
  getDefaultTenantQuota?: () => TenantQuota | undefined;
  authorizeRequest?: (headers: IncomingHttpHeaders, resource: string, action: string) => Promise<void>;
}

interface ParsedRequest<T = any> {
  body: T;
  url: URL;
  context: ApiInvocationContext;
  headers: IncomingHttpHeaders;
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
      const pathname = parsed.url.pathname ?? '';

      if (req.method === 'GET' && pathname === '/healthz') {
        this.sendJson(res, 200, { status: 'ok', timestamp: new Date().toISOString() });
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/tools/score') {
        await this.handleToolScore(parsed.body, parsed.context, res);
        return;
      }

      if (req.method === 'POST' && pathname === '/v1/tools/outcome') {
        await this.handleToolOutcome(parsed.body, parsed.context, res);
        return;
      }

      if (pathname === '/v1/tenants') {
        await this.handleTenantRoute(req.method ?? 'GET', parsed, res);
        return;
      }

      const tenantQuotaMatch = pathname.match(/^\/v1\/tenants\/([^/]+)\/quota$/);
      if (tenantQuotaMatch) {
        await this.handleTenantQuotaRoute(req.method ?? 'GET', tenantQuotaMatch[1], parsed, res);
        return;
      }

      if (pathname.startsWith('/v1/reasoning/plans')) {
        await this.handleReasoningRoute(req.method ?? 'GET', pathname, parsed, parsed.context, res);
        return;
      }

      this.sendJson(res, 404, { error: 'Not Found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('api', 'Unhandled API error', { message });
      this.sendJson(res, 500, { error: 'Internal Server Error', message });
    }
  }

  private async handleToolScore(payload: any, context: ApiInvocationContext, res: ServerResponse): Promise<void> {
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

    const scores = await this.deps.evaluateTools(payload.prompt, candidates, context);
    this.sendJson(res, 200, {
      prompt: payload.prompt,
      generatedAt: new Date().toISOString(),
      scores
    });
  }

  private async handleToolOutcome(payload: any, context: ApiInvocationContext, res: ServerResponse): Promise<void> {
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

    await this.deps.recordToolOutcome(record, context);
    this.sendJson(res, 202, { status: 'accepted' });
  }

  private async handleTenantRoute(method: string, parsed: ParsedRequest<any>, res: ServerResponse): Promise<void> {
    const action = method === 'POST' ? 'write' : 'read';
    if (this.deps.authorizeRequest) {
      try {
        await this.deps.authorizeRequest(parsed.headers, 'tenant', action);
      } catch (error) {
        const status = this.classifyAuthError(error);
        this.sendJson(res, status, { error: status === 401 ? 'Unauthorized' : 'Forbidden', message: (error as Error).message });
        return;
      }
    }

    if (method === 'GET') {
      await this.handleListTenants(parsed.url, res);
      return;
    }

    if (method === 'POST') {
      await this.handleCreateTenant(parsed.body, res);
      return;
    }

    this.sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  private async handleTenantQuotaRoute(
    method: string,
    tenantId: string,
    parsed: ParsedRequest<any>,
    res: ServerResponse
  ): Promise<void> {
    const action = method === 'GET' ? 'read' : 'write';
    if (this.deps.authorizeRequest) {
      try {
        await this.deps.authorizeRequest(parsed.headers, 'tenant', action);
      } catch (error) {
        const status = this.classifyAuthError(error);
        this.sendJson(res, status, {
          error: status === 401 ? 'Unauthorized' : 'Forbidden',
          message: (error as Error).message
        });
        return;
      }
    }

    if (!this.deps.getTenant) {
      this.sendJson(res, 501, { error: 'Tenant lookup not enabled' });
      return;
    }

    const tenant = await this.deps.getTenant(tenantId);
    if (!tenant) {
      this.sendJson(res, 404, { error: 'Not Found', message: `Tenant "${tenantId}" not found` });
      return;
    }

    if (method === 'GET') {
      if (!this.deps.getTenantQuota) {
        this.sendJson(res, 501, { error: 'Tenant quotas not enabled' });
        return;
      }
      const policy = this.deps.getTenantPolicy ? await this.deps.getTenantPolicy(tenantId) : null;
      const effectiveQuota = await this.deps.getTenantQuota(tenantId);
      const defaultQuota = this.deps.getDefaultTenantQuota ? this.deps.getDefaultTenantQuota() ?? null : null;
      const policyQuota = policy?.quota ?? null;
      const source =
        policyQuota && policyQuota !== null ? 'policy' : defaultQuota ? 'default' : 'none';
      this.sendJson(res, 200, {
        tenantId,
        quota: effectiveQuota ?? null,
        policyQuota,
        defaultQuota,
        source
      });
      return;
    }

    if (!['POST', 'PUT', 'PATCH'].includes(method)) {
      this.sendJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }

    if (!this.deps.upsertTenantPolicy) {
      this.sendJson(res, 501, { error: 'Tenant policy updates not enabled' });
      return;
    }

    const payload = parsed.body;
    if (!payload || typeof payload !== 'object') {
      this.sendJson(res, 400, { error: 'Invalid request', message: 'Request body must be an object' });
      return;
    }

    const policyUpdate: TenantPolicy = { tenantId };
    let hasUpdate = false;

    if (Object.prototype.hasOwnProperty.call(payload, 'requireConsensus')) {
      if (payload.requireConsensus !== null && typeof payload.requireConsensus !== 'boolean') {
        this.sendJson(res, 400, { error: 'Invalid request', message: 'requireConsensus must be a boolean' });
        return;
      }
      if (typeof payload.requireConsensus === 'boolean') {
        policyUpdate.requireConsensus = payload.requireConsensus;
        hasUpdate = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'metadata')) {
      if (!payload.metadata || typeof payload.metadata !== 'object' || Array.isArray(payload.metadata)) {
        this.sendJson(res, 400, { error: 'Invalid request', message: 'metadata must be an object' });
        return;
      }
      policyUpdate.metadata = { ...payload.metadata };
      hasUpdate = true;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'quota')) {
      hasUpdate = true;
      if (payload.quota === null) {
        policyUpdate.quota = null;
      } else if (payload.quota && typeof payload.quota === 'object') {
        const quotaCandidate: TenantQuota = {};
        if (Object.prototype.hasOwnProperty.call(payload.quota, 'maxConcurrentTasks')) {
          const value = Number(payload.quota.maxConcurrentTasks);
          if (!Number.isFinite(value) || value < 0) {
            this.sendJson(res, 400, {
              error: 'Invalid request',
              message: 'quota.maxConcurrentTasks must be a non-negative number'
            });
            return;
          }
          quotaCandidate.maxConcurrentTasks = Math.floor(value);
        }
        if (Object.prototype.hasOwnProperty.call(payload.quota, 'cpuLimitPercent')) {
          const value = Number(payload.quota.cpuLimitPercent);
          if (!Number.isFinite(value) || value <= 0 || value > 100) {
            this.sendJson(res, 400, {
              error: 'Invalid request',
              message: 'quota.cpuLimitPercent must be between 0 and 100'
            });
            return;
          }
          quotaCandidate.cpuLimitPercent = value;
        }
        if (Object.prototype.hasOwnProperty.call(payload.quota, 'memoryLimitMb')) {
          const value = Number(payload.quota.memoryLimitMb);
          if (!Number.isFinite(value) || value <= 0) {
            this.sendJson(res, 400, {
              error: 'Invalid request',
              message: 'quota.memoryLimitMb must be greater than 0'
            });
            return;
          }
          quotaCandidate.memoryLimitMb = value;
        }
        policyUpdate.quota = quotaCandidate;
      } else {
        this.sendJson(res, 400, { error: 'Invalid request', message: 'quota must be an object or null' });
        return;
      }
    }

    if (!hasUpdate) {
      this.sendJson(res, 400, { error: 'Invalid request', message: 'No updates provided' });
      return;
    }

    const updatedPolicy = await this.deps.upsertTenantPolicy(policyUpdate);
    const effectiveQuota = this.deps.getTenantQuota ? await this.deps.getTenantQuota(tenantId) : null;

    this.sendJson(res, 200, {
      tenantId,
      policy: updatedPolicy,
      effectiveQuota
    });
  }

  private classifyAuthError(error: unknown): number {
    const message = (error as Error)?.message?.toLowerCase?.() ?? '';
    if (message.includes('authentication') || message.includes('token')) {
      return 401;
    }
    return 403;
  }

  private async handleListTenants(url: URL, res: ServerResponse): Promise<void> {
    if (!this.deps.listTenants) {
      this.sendJson(res, 501, { error: 'Tenant API not enabled' });
      return;
    }
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : 50;
    const tenants = await this.deps.listTenants(limit > 0 ? limit : 50);
    this.sendJson(res, 200, { items: tenants, count: tenants.length });
  }

  private async handleCreateTenant(payload: any, res: ServerResponse): Promise<void> {
    if (!this.deps.createTenant) {
      this.sendJson(res, 501, { error: 'Tenant creation not enabled' });
      return;
    }
    if (!payload || typeof payload.name !== 'string' || payload.name.trim().length === 0) {
      this.sendJson(res, 400, { error: 'name is required' });
      return;
    }
    const record = await this.deps.createTenant({
      name: payload.name,
      id: typeof payload.id === 'string' ? payload.id : undefined,
      metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : undefined
    });
    this.sendJson(res, 201, record);
  }

  private async handleReasoningRoute(
    method: string,
    pathname: string,
    parsed: ParsedRequest<any>,
    context: ApiInvocationContext,
    res: ServerResponse
  ): Promise<void> {
    if (!this.deps.createPlan) {
      this.sendJson(res, 501, { error: 'Reasoning planner API not enabled' });
      return;
    }

    if (method === 'POST' && pathname === '/v1/reasoning/plans') {
      await this.handleCreatePlan(parsed.body, context, res);
      return;
    }

    const planIdMatch = pathname.match(/^\/v1\/reasoning\/plans\/([^/]+)(?:\/(checkpoints|complete))?$/);
    if (!planIdMatch) {
      if (method === 'GET' && pathname === '/v1/reasoning/plans') {
        await this.handleListPlans(parsed.url, context, res);
        return;
      }
      this.sendJson(res, 404, { error: 'Not Found' });
      return;
    }

    const [, planId, subroute] = planIdMatch;

    if (method === 'GET' && !subroute) {
      await this.handleGetPlan(planId, context, res);
      return;
    }

    if (method === 'POST' && subroute === 'checkpoints') {
      await this.handleCheckpointPlan(planId, parsed.body, context, res);
      return;
    }

    if (method === 'POST' && subroute === 'complete') {
      await this.handleCompletePlan(planId, parsed.body, context, res);
      return;
    }

    this.sendJson(res, 404, { error: 'Not Found' });
  }

  private async handleCreatePlan(payload: any, context: ApiInvocationContext, res: ServerResponse): Promise<void> {
    if (!payload || typeof payload.prompt !== 'string' || payload.prompt.trim().length === 0) {
      this.sendJson(res, 400, { error: 'prompt must be provided' });
      return;
    }

    const options: ReasoningPlanOptions = {
      planType: typeof payload.planType === 'string' ? payload.planType : undefined,
      metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : undefined,
      requireConsensus: Boolean(payload.requireConsensus),
      totConfig: payload.totConfig && typeof payload.totConfig === 'object' ? payload.totConfig : undefined
    };

    const result = await this.deps.createPlan!(payload.prompt, options, context);
    this.sendJson(res, 201, result);
  }

  private async handleCheckpointPlan(planId: string, payload: any, context: ApiInvocationContext, res: ServerResponse): Promise<void> {
    if (!this.deps.checkpointPlan) {
      this.sendJson(res, 501, { error: 'Reasoning checkpoints not enabled' });
      return;
    }
    if (!payload || typeof payload.label !== 'string') {
      this.sendJson(res, 400, { error: 'label is required' });
      return;
    }

    const input: ReasoningCheckpointInput = {
      label: payload.label,
      status: ['pending', 'complete', 'failed'].includes(payload.status) ? payload.status : 'complete',
      summary: payload.summary,
      metrics: payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : undefined
    };

    const record = await this.deps.checkpointPlan(planId, input, context);
    this.sendJson(res, 200, record);
  }

  private async handleCompletePlan(planId: string, payload: any, context: ApiInvocationContext, res: ServerResponse): Promise<void> {
    if (!this.deps.completePlan) {
      this.sendJson(res, 501, { error: 'Reasoning completion not enabled' });
      return;
    }

    const status = ['completed', 'failed', 'aborted'].includes(payload?.status) ? payload.status : 'completed';
    const completion: ReasoningCompletionOptions = {
      status,
      summary: payload?.summary,
      durationMs: typeof payload?.durationMs === 'number' ? payload.durationMs : undefined,
      metadata: payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : undefined
    };

    const record = await this.deps.completePlan(planId, completion, context);
    this.sendJson(res, 200, record);
  }

  private async handleGetPlan(planId: string, context: ApiInvocationContext, res: ServerResponse): Promise<void> {
    if (!this.deps.getPlan) {
      this.sendJson(res, 501, { error: 'Reasoning plan retrieval not enabled' });
      return;
    }
    const record = await this.deps.getPlan(planId, context);
    if (!record) {
      this.sendJson(res, 404, { error: 'Plan not found' });
      return;
    }
    this.sendJson(res, 200, record);
  }

  private async handleListPlans(url: URL, context: ApiInvocationContext, res: ServerResponse): Promise<void> {
    if (!this.deps.listPlans) {
      this.sendJson(res, 501, { error: 'Reasoning plan listing not enabled' });
      return;
    }
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : 10;
    const records = await this.deps.listPlans(limit > 0 ? limit : 10, context);
    this.sendJson(res, 200, { items: records, count: records.length });
  }

  private async parseRequest<T = any>(req: IncomingMessage): Promise<ParsedRequest<T>> {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? '127.0.0.1'}`);
    const context = await this.resolveTenantContext(req.headers);
    if (req.method === 'GET' || req.method === 'HEAD') {
      return { body: undefined as unknown as T, url, context, headers: req.headers };
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
      return { body: {} as T, url, context, headers: req.headers };
    }

    try {
      const body = JSON.parse(raw);
      return { body, url, context, headers: req.headers };
    } catch (error) {
      throw new Error(`Invalid JSON payload: ${(error as Error).message}`);
    }
  }

  private async resolveTenantContext(headers: IncomingHttpHeaders): Promise<ApiInvocationContext> {
    if (!this.deps.resolveTenant) {
      return { tenant: null };
    }
    try {
      const tenant = await this.deps.resolveTenant(headers);
      return { tenant };
    } catch (error) {
      this.logger.warn('api', 'Tenant resolution failed', { message: (error as Error).message });
      return { tenant: null };
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
