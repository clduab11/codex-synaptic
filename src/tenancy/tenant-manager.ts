import { randomUUID } from 'node:crypto';
import { Logger } from '../core/logger.js';
import { CodexMemorySystem } from '../memory/memory-system.js';
import type { TenantContext, TenantPolicy, TenantRecord, TenantQuota } from './types.js';
import type { ResourceManager } from '../core/resources.js';

export interface TenantManagerOptions {
  enableTenancy: boolean;
  defaultQuota?: TenantQuota;
}

export interface TenantManagerDependencies {
  memory: CodexMemorySystem;
  logger?: Logger;
  options?: TenantManagerOptions;
  resourceManager?: ResourceManager;
}

/**
 * TenantManager centralises tenant discovery, policy lookup, and quota management.
 * Implementation is intentionally skeletal pending Week 3 multi-tenancy work.
 */
export class TenantManager {
  private readonly logger: Logger;
  private readonly enableTenancy: boolean;
  private readonly tenantNamespace = 'tenants';
  private readonly policyNamespace = 'tenant_policies';
  private defaultQuota?: TenantQuota;

  constructor(private readonly deps: TenantManagerDependencies) {
    this.logger = deps.logger ?? Logger.getInstance('tenancy');
    this.enableTenancy = deps.options?.enableTenancy ?? false;
    this.defaultQuota = deps.options?.defaultQuota ? { ...deps.options.defaultQuota } : undefined;
  }

  isTenancyEnabled(): boolean {
    return this.enableTenancy;
  }

  async resolveTenantById(tenantId?: string): Promise<TenantContext | null> {
    if (!this.enableTenancy) {
      return null;
    }
    if (!tenantId) {
      throw new Error('Tenant ID is required when tenancy is enabled');
    }
    const tenant = await this.getTenant(tenantId);
    if (!tenant) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }
    const policy = await this.getPolicy(tenantId);
    return {
      tenant,
      policy: policy ?? undefined
    };
  }

  async createTenant(input: { name: string; id?: string; metadata?: Record<string, any> }): Promise<TenantRecord> {
    if (!this.enableTenancy) {
      throw new Error('Tenancy is not enabled');
    }
    const existing = input.id ? await this.getTenant(input.id) : null;
    if (existing) {
      throw new Error(`Tenant "${input.id}" already exists`);
    }

    const now = new Date().toISOString();
    const record: TenantRecord = {
      id: input.id ?? randomUUID(),
      name: input.name,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata
    };
    await this.persistTenant(record);
    this.logger.info('tenancy', 'Tenant created', { tenantId: record.id });
    return record;
  }

  async upsertPolicy(policy: TenantPolicy): Promise<TenantPolicy> {
    if (!this.enableTenancy) {
      throw new Error('Tenancy is not enabled');
    }
    if (!(await this.getTenant(policy.tenantId))) {
      throw new Error(`Tenant "${policy.tenantId}" not found`);
    }
    const existing = await this.getPolicy(policy.tenantId);
    const merged: TenantPolicy = {
      tenantId: policy.tenantId,
      requireConsensus:
        policy.requireConsensus !== undefined ? policy.requireConsensus : existing?.requireConsensus,
      quota:
        policy.quota !== undefined
          ? (policy.quota === null ? null : { ...policy.quota })
          : existing?.quota,
      metadata: policy.metadata ?? existing?.metadata
    };
    await this.persistPolicy(merged);
    this.logger.info('tenancy', 'Tenant policy upserted', {
      tenantId: policy.tenantId,
      quota: merged.quota ?? this.defaultQuota ?? null
    });
    return merged;
  }

  async getQuota(tenantId: string): Promise<TenantQuota | null> {
    if (!this.enableTenancy) {
      return null;
    }
    const policy = await this.getPolicy(tenantId);
    if (policy?.quota) {
      return { ...policy.quota };
    }
    return this.defaultQuota ? { ...this.defaultQuota } : null;
  }

  async listTenants(limit = 100): Promise<TenantRecord[]> {
    if (!this.enableTenancy) {
      return [];
    }
    const rows = await this.deps.memory.list(this.tenantNamespace, limit);
    return rows.map((row) => row.data as TenantRecord);
  }

  async getTenant(tenantId: string): Promise<TenantRecord | null> {
    if (!this.enableTenancy) {
      return null;
    }
    const row = await this.deps.memory.getByKey(this.tenantNamespace, tenantId);
    return row?.data as TenantRecord | null;
  }

  async getPolicy(tenantId: string): Promise<TenantPolicy | null> {
    if (!this.enableTenancy) {
      return null;
    }
    const row = await this.deps.memory.getByKey(this.policyNamespace, tenantId);
    return row?.data as TenantPolicy | null;
  }

  private async persistTenant(record: TenantRecord): Promise<void> {
    await this.deps.memory.delete(this.tenantNamespace, record.id);
    await this.deps.memory.store(this.tenantNamespace, record.id, record);
    const quota = await this.getQuota(record.id);
    this.deps.resourceManager?.registerTenantQuota(record.id, quota ? { ...quota } : undefined);
  }

  private async persistPolicy(policy: TenantPolicy): Promise<void> {
    await this.deps.memory.delete(this.policyNamespace, policy.tenantId);
    await this.deps.memory.store(this.policyNamespace, policy.tenantId, policy);
    const effectiveQuota =
      policy.quota && policy.quota !== null ? { ...policy.quota } : this.defaultQuota ? { ...this.defaultQuota } : undefined;
    this.deps.resourceManager?.registerTenantQuota(policy.tenantId, effectiveQuota);
  }

  async configureDefaultQuota(quota?: TenantQuota): Promise<void> {
    this.defaultQuota = quota ? { ...quota } : undefined;
    if (!this.enableTenancy) {
      this.logger.info('tenancy', 'Default tenant quota updated while tenancy disabled', {
        quota: this.defaultQuota ?? null
      });
      return;
    }

    try {
      const tenants = await this.listTenants(Number.MAX_SAFE_INTEGER);
      await Promise.all(
        tenants.map(async (tenant) => {
          const policy = await this.getPolicy(tenant.id);
          const effective =
            policy?.quota && policy.quota !== null ? { ...policy.quota } : this.defaultQuota ? { ...this.defaultQuota } : undefined;
          this.deps.resourceManager?.registerTenantQuota(tenant.id, effective);
        })
      );
      this.logger.info('tenancy', 'Default tenant quota configured', {
        quota: this.defaultQuota ?? null,
        tenants: tenants.length
      });
    } catch (error) {
      this.logger.warn('tenancy', 'Failed to apply default tenant quota to existing tenants', undefined, error as Error);
    }
  }

  getDefaultQuota(): TenantQuota | undefined {
    return this.defaultQuota ? { ...this.defaultQuota } : undefined;
  }
}
