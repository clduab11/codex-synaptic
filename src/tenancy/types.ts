export interface TenantMetadata {
  [key: string]: any;
}

export interface TenantRecord {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'decommissioned';
  createdAt: string;
  updatedAt: string;
  metadata?: TenantMetadata;
}

export interface TenantPolicy {
  tenantId: string;
  requireConsensus?: boolean;
  quota?: TenantQuota | null;
  metadata?: TenantMetadata;
}

export interface TenantQuota {
  maxConcurrentTasks?: number;
  cpuLimitPercent?: number;
  memoryLimitMb?: number;
}

export interface TenantContext {
  tenant: TenantRecord;
  policy?: TenantPolicy;
}
