import type { IncomingHttpHeaders } from 'node:http';
import { Logger } from '../core/logger.js';
import type { TenantContext } from './types.js';
import { TenantManager } from './tenant-manager.js';

export interface TenantResolutionOptions {
  /**
   * If true, an error is thrown when tenancy is enabled but no tenant id was provided.
   */
  requireTenantId?: boolean;
}

export class TenantResolver {
  private readonly logger: Logger;

  constructor(private readonly tenantManager: TenantManager, logger?: Logger) {
    this.logger = logger ?? Logger.getInstance('tenancy');
  }

  async fromHeaders(
    headers: IncomingHttpHeaders,
    options: TenantResolutionOptions = {}
  ): Promise<TenantContext | null> {
    if (!this.tenantManager.isTenancyEnabled()) {
      return null;
    }
    const raw = headers['x-codex-tenant'] ?? headers['x-tenant-id'];
    const tenantId = Array.isArray(raw) ? raw[0] : raw;

    if (!tenantId || tenantId.trim().length === 0) {
      if (options.requireTenantId) {
        throw new Error('Tenant id header is required when tenancy is enabled');
      }
      this.logger.debug('tenancy', 'No tenant header present; continuing without tenant context');
      return null;
    }

    return this.tenantManager.resolveTenantById(tenantId);
  }

  async fromCliOption(tenantId?: string): Promise<TenantContext | null> {
    if (!this.tenantManager.isTenancyEnabled()) {
      return null;
    }
    return this.tenantManager.resolveTenantById(tenantId);
  }
}
