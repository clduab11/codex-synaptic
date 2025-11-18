/**
 * Tenant quota management helpers
 * Extracted to reduce complexity in CLI tenant commands
 */

import type { TenantQuota } from '../tenancy/types.js';

export interface QuotaOptions {
  clear?: boolean;
  maxConcurrent?: string;
  cpu?: string;
  memory?: string;
}

export interface QuotaValidationResult {
  hasQuotaFlags: boolean;
  error?: string;
}

export interface ParsedQuota {
  maxConcurrentTasks?: number;
  cpuLimitPercent?: number;
  memoryLimitMb?: number;
}

/**
 * Check if quota flags are provided
 */
export function hasQuotaFlags(options: QuotaOptions): boolean {
  return Boolean(
    options.clear ||
    options.maxConcurrent !== undefined ||
    options.cpu !== undefined ||
    options.memory !== undefined
  );
}

/**
 * Validate quota options
 */
export function validateQuotaOptions(options: QuotaOptions): QuotaValidationResult {
  const flags = hasQuotaFlags(options);

  if (!flags) {
    return {
      hasQuotaFlags: false,
      error: 'Provide at least one quota flag (--max-concurrent/--cpu/--memory) or use --clear.'
    };
  }

  if (
    options.clear &&
    (options.maxConcurrent !== undefined ||
      options.cpu !== undefined ||
      options.memory !== undefined)
  ) {
    return {
      hasQuotaFlags: true,
      error: 'Cannot combine --clear with quota values.'
    };
  }

  return { hasQuotaFlags: true };
}

/**
 * Parse and validate maxConcurrent quota value
 */
export function parseMaxConcurrent(value: string): number {
  const maxConcurrent = Number.parseInt(value, 10);
  if (Number.isNaN(maxConcurrent)) {
    throw new Error('maxConcurrent must be an integer');
  }
  if (maxConcurrent < 0) {
    throw new Error('maxConcurrent must be a non-negative integer');
  }
  return maxConcurrent;
}

/**
 * Parse and validate CPU quota value
 */
export function parseCpu(value: string): number {
  const cpu = Number.parseFloat(value);
  if (!Number.isFinite(cpu) || cpu <= 0 || cpu > 100) {
    throw new Error('cpu must be a number between 0 and 100');
  }
  return cpu;
}

/**
 * Parse and validate memory quota value
 */
export function parseMemory(value: string): number {
  const memory = Number.parseFloat(value);
  if (!Number.isFinite(memory) || memory <= 0) {
    throw new Error('memory must be a number greater than 0');
  }
  return memory;
}

/**
 * Build quota object from options
 */
export function buildQuotaFromOptions(options: QuotaOptions): TenantQuota {
  const quota: TenantQuota = {};

  if (options.maxConcurrent !== undefined) {
    quota.maxConcurrentTasks = parseMaxConcurrent(options.maxConcurrent);
  }

  if (options.cpu !== undefined) {
    quota.cpuLimitPercent = parseCpu(options.cpu);
  }

  if (options.memory !== undefined) {
    quota.memoryLimitMb = parseMemory(options.memory);
  }

  if (Object.keys(quota).length === 0) {
    throw new Error('No quota fields provided. Use --clear to remove overrides.');
  }

  return quota;
}

/**
 * Build policy input for tenant quota
 */
export function buildPolicyInput(
  tenantId: string,
  options: QuotaOptions
): { tenantId: string; quota?: TenantQuota | null } {
  const policyInput: { tenantId: string; quota?: TenantQuota | null } = { tenantId };

  if (options.clear) {
    policyInput.quota = null;
  } else {
    policyInput.quota = buildQuotaFromOptions(options);
  }

  return policyInput;
}
