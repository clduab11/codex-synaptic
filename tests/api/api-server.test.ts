import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiServer } from '../../src/core/api-server';
import type { ToolCandidate } from '../../src/tools/optimizer';
import type { ReasoningRunRecord } from '../../src/memory/memory-system';
import type { TenantPolicy, TenantQuota, TenantRecord } from '../../src/tenancy/types';

interface TestCaptures {
  evaluateToolsTenant?: string;
  recordOutcomeTenant?: string;
  reasoningTenant?: string;
  authCalls: Array<{ resource: string; action: string }>;
}

const buildServer = (): { server: ApiServer; captures: TestCaptures } => {
  const plans = new Map<string, ReasoningRunRecord>();
  const tenants = new Map<string, TenantRecord>();
  const policies = new Map<string, TenantPolicy>();
  const defaultQuota: TenantQuota = { maxConcurrentTasks: 3 };
  const captures: TestCaptures = { authCalls: [] };

  const server = new ApiServer({
    evaluateTools: async (_prompt: string, candidates: ToolCandidate[], context) => {
      captures.evaluateToolsTenant = context?.tenant?.tenant.id;
      return candidates.map((candidate, index) => ({
        toolId: candidate.id,
        score: 0.9 - index * 0.1,
        confidence: 0.85,
        reasoning: ['Mock recommendation'],
        signals: ['code:0.5']
      }));
    },
    recordToolOutcome: async (_record, context) => {
      captures.recordOutcomeTenant = context?.tenant?.tenant.id;
      return 1;
    },
    createPlan: async (prompt, options, context) => {
      const planId = `plan-${plans.size + 1}`;
      const timestamp = new Date().toISOString();
      const record: ReasoningRunRecord = {
        id: planId,
        planId,
        planType: options?.planType ?? 'tot',
        prompt,
        status: options?.requireConsensus ? 'awaiting_approval' : 'running',
        checkpoints: [],
        metadata: options?.metadata,
        durationMs: 0,
        tenantId: context?.tenant?.tenant.id,
        timestamp
      };
      plans.set(planId, record);
      captures.reasoningTenant = context?.tenant?.tenant.id;
      return {
        planId,
        planType: record.planType,
        status: record.status,
        summary: `Plan for ${prompt}`,
        createdAt: timestamp,
        consensus: options?.requireConsensus
          ? { required: true, proposalId: 'proposal-test' }
          : { required: false }
      };
    },
    checkpointPlan: async (planId, input, context) => {
      const existing = plans.get(planId);
      if (!existing) {
        throw new Error('Plan not found');
      }
      const checkpoints = [...(existing.checkpoints ?? []), { ...input, id: `cp-${Date.now()}`, timestamp: new Date().toISOString() }];
      const updated: ReasoningRunRecord = { ...existing, checkpoints, tenantId: context?.tenant?.tenant.id ?? existing.tenantId };
      plans.set(planId, updated);
      return updated;
    },
    completePlan: async (planId, options, context) => {
      const existing = plans.get(planId);
      if (!existing) {
        throw new Error('Plan not found');
      }
      const updated: ReasoningRunRecord = {
        ...existing,
        status: options.status,
        metadata: { ...existing.metadata, completion: options.metadata },
        durationMs: options.durationMs ?? existing.durationMs,
        tenantId: context?.tenant?.tenant.id ?? existing.tenantId,
        timestamp: new Date().toISOString()
      };
      plans.set(planId, updated);
      return updated;
    },
    getPlan: async (planId) => plans.get(planId) ?? null,
    listPlans: async (limit) => Array.from(plans.values()).slice(0, limit),
    createTenant: async (input) => {
      const now = new Date().toISOString();
      const record: TenantRecord = {
        id: input.id ?? `tenant-${tenants.size + 1}`,
        name: input.name,
        status: 'active',
        createdAt: now,
        updatedAt: now,
        metadata: input.metadata
      };
      tenants.set(record.id, record);
      return record;
    },
    listTenants: async (limit = 50) => Array.from(tenants.values()).slice(0, limit),
    getTenant: async (tenantId) => tenants.get(tenantId) ?? null,
    getTenantPolicy: async (tenantId) => policies.get(tenantId) ?? null,
    getTenantQuota: async (tenantId) => {
      const policy = policies.get(tenantId);
      if (policy?.quota && policy.quota !== null) {
        return policy.quota;
      }
      return defaultQuota;
    },
    upsertTenantPolicy: async (policy) => {
      const existing = policies.get(policy.tenantId);
      const merged: TenantPolicy = {
        tenantId: policy.tenantId,
        requireConsensus: policy.requireConsensus ?? existing?.requireConsensus,
        quota: policy.quota !== undefined ? policy.quota : existing?.quota ?? null,
        metadata: policy.metadata ?? existing?.metadata
      };
      policies.set(policy.tenantId, merged);
      return merged;
    },
    getDefaultTenantQuota: () => defaultQuota,
    resolveTenant: async (headers) => {
      const raw = headers['x-codex-tenant'] ?? headers['x-tenant-id'];
      const id = Array.isArray(raw) ? raw[0] : raw;
      if (typeof id === 'string') {
        let record = tenants.get(id);
        if (!record) {
          const now = new Date(0).toISOString();
          record = {
            id,
            name: id,
            status: 'active',
            createdAt: now,
            updatedAt: now
          };
          tenants.set(id, record);
        }
        return { tenant: record };
      }
      return null;
    },
    authorizeRequest: async (headers, resource, action) => {
      const header = Array.isArray(headers.authorization) ? headers.authorization[0] : headers.authorization;
      if (!header) {
        throw new Error('Authentication required');
      }
      const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header.trim();
      if (token !== 'admin-token') {
        throw new Error('Invalid token');
      }
      captures.authCalls.push({ resource, action });
    }
  });

  return { server, captures };
};

describe('ApiServer', () => {
  let server: ApiServer;
  let port: number;
  let captures: TestCaptures;

  beforeEach(async () => {
    ({ server, captures } = buildServer());
    await server.start({ host: '127.0.0.1', port: 0, cors: { enabled: false, origins: [] } });
    const address = server.getAddress();
    if (!address) {
      throw new Error('Server address unavailable');
    }
    const match = address.match(/:(\d+)$/);
    if (!match) {
      throw new Error(`Unable to parse server port from address ${address}`);
    }
    port = Number(match[1]);
  });

  afterEach(async () => {
    await server.stop();
  });

  it('scores tool candidates via POST /v1/tools/score', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/tools/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Implement authentication module',
        candidates: [{ id: 'code-generator' }]
      })
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(Array.isArray(payload.scores)).toBe(true);
    expect(payload.scores[0].toolId).toBe('code-generator');
    expect(captures.evaluateToolsTenant).toBeUndefined();
  });

  it('validates incoming payloads', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/tools/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.error).toBeDefined();
  });

  it('creates and manages reasoning plans', async () => {
    const createResponse = await fetch(`http://127.0.0.1:${port}/v1/reasoning/plans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Deploy change to production', requireConsensus: true })
    });
    expect(createResponse.status).toBe(201);
    const creation = await createResponse.json();
    expect(creation.planId).toBeDefined();

    const cpResponse = await fetch(`http://127.0.0.1:${port}/v1/reasoning/plans/${creation.planId}/checkpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'analysis', status: 'complete' })
    });
    expect(cpResponse.status).toBe(200);

    const completeResponse = await fetch(`http://127.0.0.1:${port}/v1/reasoning/plans/${creation.planId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed', summary: 'Done' })
    });
    expect(completeResponse.status).toBe(200);

    const getResponse = await fetch(`http://127.0.0.1:${port}/v1/reasoning/plans/${creation.planId}`);
    expect(getResponse.status).toBe(200);
    const plan = await getResponse.json();
    expect(plan.status).toBe('completed');
    expect(Array.isArray(plan.checkpoints)).toBe(true);

    const listResponse = await fetch(`http://127.0.0.1:${port}/v1/reasoning/plans?limit=1`);
    expect(listResponse.status).toBe(200);
    const listPayload = await listResponse.json();
    expect(listPayload.count).toBeGreaterThan(0);
    expect(captures.reasoningTenant).toBeUndefined();
  });

  it('propagates tenant context from headers', async () => {
    const tenantId = 'tenant-alpha';
    const response = await fetch(`http://127.0.0.1:${port}/v1/tools/score`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Codex-Tenant': tenantId
      },
      body: JSON.stringify({
        prompt: 'Generate observability dashboard',
        candidates: [{ id: 'obs-worker' }]
      })
    });
    expect(response.status).toBe(200);
    expect(captures.evaluateToolsTenant).toBe(tenantId);
  });

  it('creates and lists tenants via REST', async () => {
    const createResponse = await fetch(`http://127.0.0.1:${port}/v1/tenants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-token' },
      body: JSON.stringify({ name: 'Acme Corp', id: 'acme' })
    });
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json();
    expect(created.id).toBe('acme');
    expect(created.name).toBe('Acme Corp');

    const listResponse = await fetch(`http://127.0.0.1:${port}/v1/tenants?limit=5`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json();
    expect(list.count).toBeGreaterThan(0);
    expect(list.items.some((tenant: TenantRecord) => tenant.id === 'acme')).toBe(true);
    expect(captures.authCalls.some(({ resource, action }) => resource === 'tenant' && action === 'write')).toBe(true);
  });

  it('manages tenant quotas via REST', async () => {
    await fetch(`http://127.0.0.1:${port}/v1/tenants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-token' },
      body: JSON.stringify({ name: 'Quota Tenant', id: 'quota-tenant' })
    });

    const initial = await fetch(`http://127.0.0.1:${port}/v1/tenants/quota-tenant/quota`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    expect(initial.status).toBe(200);
    const initialPayload = await initial.json();
    expect(initialPayload.quota.maxConcurrentTasks).toBe(3);
    expect(initialPayload.source).toBe('default');

    const update = await fetch(`http://127.0.0.1:${port}/v1/tenants/quota-tenant/quota`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-token' },
      body: JSON.stringify({ quota: { maxConcurrentTasks: 7 } })
    });
    expect(update.status).toBe(200);
    const updatePayload = await update.json();
    expect(updatePayload.policy.quota?.maxConcurrentTasks).toBe(7);

    const updated = await fetch(`http://127.0.0.1:${port}/v1/tenants/quota-tenant/quota`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    const updatedPayload = await updated.json();
    expect(updatedPayload.quota.maxConcurrentTasks).toBe(7);
    expect(updatedPayload.source).toBe('policy');

    await fetch(`http://127.0.0.1:${port}/v1/tenants/quota-tenant/quota`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-token' },
      body: JSON.stringify({ quota: null })
    });

    const cleared = await fetch(`http://127.0.0.1:${port}/v1/tenants/quota-tenant/quota`, {
      headers: { Authorization: 'Bearer admin-token' }
    });
    const clearedPayload = await cleared.json();
    expect(clearedPayload.quota.maxConcurrentTasks).toBe(3);
    expect(clearedPayload.source).toBe('default');
  });

  it('rejects tenant operations without token', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/v1/tenants`);
    expect([401, 403]).toContain(response.status);
  });
});
