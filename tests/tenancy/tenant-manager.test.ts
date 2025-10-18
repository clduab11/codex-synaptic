import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexMemorySystem } from '../../src/memory/memory-system';
import { TenantManager } from '../../src/tenancy';
import { Logger } from '../../src/core/logger';

describe('TenantManager', () => {
  let tempDir: string;
  let memory: CodexMemorySystem;
  let manager: TenantManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'codex-tenant-manager-'));
    memory = new CodexMemorySystem(tempDir, { enableTenancy: true });
    manager = new TenantManager({
      memory,
      logger: Logger.getInstance('tenancy-test'),
      options: { enableTenancy: true }
    });
  });

  afterEach(async () => {
    await memory.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates and retrieves tenants', async () => {
    const tenant = await manager.createTenant({ name: 'Acme Corp', id: 'acme' });
    expect(tenant.id).toBe('acme');

    const fetched = await manager.getTenant('acme');
    expect(fetched?.name).toBe('Acme Corp');

    const listed = await manager.listTenants(10);
    expect(listed.some((t) => t.id === 'acme')).toBe(true);

    const context = await manager.resolveTenantById('acme');
    expect(context?.tenant.id).toBe('acme');
  });

  it('upserts policies and exposes quotas', async () => {
    await manager.createTenant({ name: 'Beta Industries', id: 'beta' });
    await manager.upsertPolicy({
      tenantId: 'beta',
      quota: {
        maxConcurrentTasks: 5,
        cpuLimitPercent: 60
      }
    });
    const quota = await manager.getQuota('beta');
    expect(quota?.maxConcurrentTasks).toBe(5);
    expect(quota?.cpuLimitPercent).toBe(60);
  });

  it('applies and restores default quotas when overrides are cleared', async () => {
    await manager.configureDefaultQuota({ maxConcurrentTasks: 4 });
    await manager.createTenant({ name: 'Gamma Labs', id: 'gamma' });

    const defaultQuota = await manager.getQuota('gamma');
    expect(defaultQuota?.maxConcurrentTasks).toBe(4);

    await manager.upsertPolicy({
      tenantId: 'gamma',
      quota: {
        maxConcurrentTasks: 9
      }
    });

    const overridden = await manager.getQuota('gamma');
    expect(overridden?.maxConcurrentTasks).toBe(9);

    await manager.upsertPolicy({
      tenantId: 'gamma',
      quota: null
    });

    const restored = await manager.getQuota('gamma');
    expect(restored?.maxConcurrentTasks).toBe(4);
  });
});
