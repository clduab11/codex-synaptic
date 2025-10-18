/**
 * Resource management and rate limiting for Codex-Synaptic
 */

import { EventEmitter } from 'events';
import { Logger } from './logger.js';
import type { TenantQuota } from '../tenancy/types.js';
import { GPUStatus } from './gpu.js';

export interface ResourceLimits {
  maxMemoryMB: number;
  maxCpuPercent: number;
  maxActiveAgents: number;
  maxConcurrentTasks: number;
  maxRequestsPerMinute: number;
  maxStorageMB?: number;
}

export type MemoryHealthState = 'normal' | 'elevated' | 'critical';

export interface MemoryStatus {
  state: MemoryHealthState;
  usageMB: number;
  limitMB: number;
  headroomMB: number;
  rssMB: number;
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  arrayBuffersMB: number;
  sampledAt: Date;
}

export interface ResourceUsage {
  memoryMB: number;
  cpuPercent: number;
  activeAgents: number;
  concurrentTasks: number;
  requestsPerMinute: number;
  storageMB?: number;
  gpu?: GPUStatus;
  rawMemory?: NodeJS.MemoryUsage;
  memoryStatus?: MemoryStatus;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export class ResourceManager extends EventEmitter {
  private logger = Logger.getInstance();
  private limits: ResourceLimits;
  private currentUsage: ResourceUsage;
  private rateLimiters: Map<string, RateLimiter> = new Map();
  private monitoringInterval?: NodeJS.Timeout;
  private gpuStatus: GPUStatus | undefined;
  private memoryState: MemoryHealthState = 'normal';
  private tenantTaskCounts: Map<string, number> = new Map();
  private tenantTaskLimits: Map<string, number> = new Map();
  private tenantQuotas: Map<string, TenantQuota> = new Map();

  constructor(limits: ResourceLimits) {
    super();
    this.limits = limits;
    this.currentUsage = {
      memoryMB: 0,
      cpuPercent: 0,
      activeAgents: 0,
      concurrentTasks: 0,
      requestsPerMinute: 0,
      storageMB: 0,
      memoryStatus: {
        state: 'normal',
        usageMB: 0,
        limitMB: limits.maxMemoryMB,
        headroomMB: limits.maxMemoryMB,
        rssMB: 0,
        heapUsedMB: 0,
        heapTotalMB: 0,
        externalMB: 0,
        arrayBuffersMB: 0,
        sampledAt: new Date(0)
      }
    };
  }

  initialize(): void {
    // Start resource monitoring
    this.startMonitoring();
    this.logger.info('resources', 'Resource manager initialized', { limits: this.limits });
  }

  shutdown(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    this.logger.info('resources', 'Resource manager shutdown');
  }

  private startMonitoring(): void {
    this.updateResourceUsage();
    this.checkResourceLimits();

    this.monitoringInterval = setInterval(() => {
      this.updateResourceUsage();
      this.checkResourceLimits();
    }, 10000); // Check every 10 seconds
  }

  private updateResourceUsage(): void {
    const memUsage = process.memoryUsage();
    const rssMB = memUsage.rss / 1024 / 1024;
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const externalMB = memUsage.external / 1024 / 1024;
    const arrayBuffersMB = memUsage.arrayBuffers / 1024 / 1024;
    const limitMB = this.limits.maxMemoryMB;

    const nextState = this.evaluateMemoryState(rssMB, limitMB);
    const stateChanged = nextState !== this.memoryState;
    this.memoryState = nextState;

    this.currentUsage.memoryMB = rssMB;
    this.currentUsage.rawMemory = { ...memUsage };
    this.currentUsage.memoryStatus = {
      state: nextState,
      usageMB: rssMB,
      limitMB,
      headroomMB: Math.max(0, limitMB - rssMB),
      rssMB,
      heapUsedMB,
      heapTotalMB,
      externalMB,
      arrayBuffersMB,
      sampledAt: new Date()
    };

    if (stateChanged) {
      const logPayload = {
        state: nextState,
        limitMB,
        rssMB: Number(rssMB.toFixed(2)),
        heapUsedMB: Number(heapUsedMB.toFixed(2)),
        headroomMB: Number(Math.max(0, limitMB - rssMB).toFixed(2))
      };
      if (nextState === 'critical') {
        this.logger.error('resources', 'Memory status entered CRITICAL threshold', logPayload);
      } else if (nextState === 'elevated') {
        this.logger.warn('resources', 'Memory status elevated', logPayload);
      } else {
        this.logger.info('resources', 'Memory usage back within normal range', logPayload);
      }
    }

    // Get CPU usage (simplified)
    const cpuUsage = process.cpuUsage();
    this.currentUsage.cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to %

    this.emit('resourceUpdate', this.getCurrentUsage());
  }

  private evaluateMemoryState(rssMB: number, limitMB: number): MemoryHealthState {
    const warnEnter = limitMB * 0.85;
    const warnExit = limitMB * 0.8;
    const criticalEnter = limitMB;
    const criticalExit = limitMB * 0.95;

    switch (this.memoryState) {
      case 'critical':
        if (rssMB < criticalExit) {
          return rssMB >= warnEnter ? 'elevated' : 'normal';
        }
        return 'critical';
      case 'elevated':
        if (rssMB >= criticalEnter) {
          return 'critical';
        }
        if (rssMB < warnExit) {
          return 'normal';
        }
        return 'elevated';
      case 'normal':
      default:
        if (rssMB >= criticalEnter) {
          return 'critical';
        }
        if (rssMB >= warnEnter) {
          return 'elevated';
        }
        return 'normal';
    }
  }

  private checkResourceLimits(): void {
    const warnings: string[] = [];
    const violations: string[] = [];

    const memoryStatus = this.currentUsage.memoryStatus;
    if (memoryStatus) {
      if (memoryStatus.state === 'critical') {
        violations.push(`Memory usage (${memoryStatus.usageMB.toFixed(1)}MB) exceeds limit (${memoryStatus.limitMB}MB)`);
      } else if (memoryStatus.state === 'elevated') {
        warnings.push(`Memory usage elevated: ${memoryStatus.usageMB.toFixed(1)}MB / ${memoryStatus.limitMB}MB`);
      }
    }

    // Agent count check
    if (this.currentUsage.activeAgents > this.limits.maxActiveAgents) {
      violations.push(`Active agents (${this.currentUsage.activeAgents}) exceeds limit (${this.limits.maxActiveAgents})`);
    }

    // Task count check
    if (this.currentUsage.concurrentTasks > this.limits.maxConcurrentTasks) {
      violations.push(`Concurrent tasks (${this.currentUsage.concurrentTasks}) exceeds limit (${this.limits.maxConcurrentTasks})`);
    }

    // Emit events
    if (warnings.length > 0) {
      this.emit('resourceWarning', warnings);
      this.logger.warn('resources', 'Resource warnings', { warnings });
    }

    if (violations.length > 0) {
      this.emit('resourceViolation', violations);
      this.logger.error('resources', 'Resource violations', { violations });
    }
  }

  updateAgentCount(count: number): void {
    this.currentUsage.activeAgents = count;
  }

  updateTaskCount(count: number): void {
    this.currentUsage.concurrentTasks = count;
  }

  registerTenantQuota(tenantId: string, quota?: TenantQuota): void {
    if (!tenantId) {
      return;
    }
    if (!quota) {
      this.tenantTaskLimits.delete(tenantId);
      this.tenantQuotas.delete(tenantId);
      return;
    }

    const sanitized: TenantQuota = {};

    if (quota.maxConcurrentTasks !== undefined && quota.maxConcurrentTasks !== null) {
      const limit = Math.max(0, Math.floor(quota.maxConcurrentTasks));
      sanitized.maxConcurrentTasks = limit;
      this.tenantTaskLimits.set(tenantId, limit);
    } else {
      this.tenantTaskLimits.delete(tenantId);
    }

    if (quota.cpuLimitPercent !== undefined) {
      sanitized.cpuLimitPercent = quota.cpuLimitPercent;
    }

    if (quota.memoryLimitMb !== undefined) {
      sanitized.memoryLimitMb = quota.memoryLimitMb;
    }

    this.tenantQuotas.set(tenantId, sanitized);
  }

  acquireTenantTaskSlot(tenantId: string | undefined): void {
    if (!tenantId) {
      return;
    }
    const limit = this.tenantTaskLimits.get(tenantId);
    if (limit !== undefined) {
      const current = this.tenantTaskCounts.get(tenantId) ?? 0;
      if (current >= limit) {
        throw new Error(`Tenant "${tenantId}" exceeded concurrent task quota (${limit})`);
      }
      this.tenantTaskCounts.set(tenantId, current + 1);
    }
  }

  releaseTenantTaskSlot(tenantId: string | undefined): void {
    if (!tenantId) {
      return;
    }
    const current = this.tenantTaskCounts.get(tenantId);
    if (current && current > 0) {
      this.tenantTaskCounts.set(tenantId, current - 1);
    } else {
      this.tenantTaskCounts.delete(tenantId);
    }
  }

  getTenantTaskLimit(tenantId: string | undefined): number | undefined {
    if (!tenantId) {
      return undefined;
    }
    return this.tenantTaskLimits.get(tenantId);
  }

  canAllocateAgent(): boolean {
    return this.currentUsage.activeAgents < this.limits.maxActiveAgents;
  }

  canAllocateTask(): boolean {
    const memoryStatus = this.currentUsage.memoryStatus;
    const memoryHealthy = memoryStatus ? memoryStatus.state !== 'critical' :
      this.currentUsage.memoryMB < this.limits.maxMemoryMB * 0.9;

    return this.currentUsage.concurrentTasks < this.limits.maxConcurrentTasks && memoryHealthy;
  }

  checkResourceAvailability(): { available: boolean; reasons: string[] } {
    const reasons: string[] = [];

    if (this.currentUsage.memoryStatus?.state === 'critical') {
      reasons.push('High memory usage');
    }

    if (this.currentUsage.activeAgents >= this.limits.maxActiveAgents) {
      reasons.push('Maximum agents reached');
    }

    if (this.currentUsage.concurrentTasks >= this.limits.maxConcurrentTasks) {
      reasons.push('Maximum concurrent tasks reached');
    }

    return {
      available: reasons.length === 0,
      reasons
    };
  }

  setGpuStatus(status: GPUStatus): void {
    this.gpuStatus = status;
    this.logger.info('resources', 'GPU status updated', {
      backends: status.availableBackends,
      selected: status.selectedBackend
    });
    this.emit('resourceUpdate', this.getCurrentUsage());
  }

  getRateLimiter(key: string, config?: RateLimitConfig): RateLimiter {
    let limiter = this.rateLimiters.get(key);
    if (!limiter) {
      const defaultConfig: RateLimitConfig = {
        windowMs: 60000, // 1 minute
        maxRequests: this.limits.maxRequestsPerMinute
      };
      limiter = new RateLimiter(config || defaultConfig);
      this.rateLimiters.set(key, limiter);
    }
    return limiter;
  }

  getCurrentUsage(): ResourceUsage {
    return {
      ...this.currentUsage,
      memoryStatus: this.currentUsage.memoryStatus ? { ...this.currentUsage.memoryStatus } : undefined,
      rawMemory: this.currentUsage.rawMemory ? { ...this.currentUsage.rawMemory } : undefined,
      gpu: this.gpuStatus ? { ...this.gpuStatus, devices: [...this.gpuStatus.devices], diagnostics: [...this.gpuStatus.diagnostics] } : undefined
    };
  }

  getLimits(): ResourceLimits {
    return { ...this.limits };
  }

  updateLimits(newLimits: Partial<ResourceLimits>): void {
    this.limits = { ...this.limits, ...newLimits };
    if (this.currentUsage.memoryStatus) {
      this.currentUsage.memoryStatus.limitMB = this.limits.maxMemoryMB;
      this.currentUsage.memoryStatus.headroomMB = Math.max(0, this.limits.maxMemoryMB - this.currentUsage.memoryMB);
    }
    this.logger.info('resources', 'Resource limits updated', { limits: this.limits });
    this.emit('limitsUpdated', this.limits);
  }
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  checkLimit(identifier: string): { allowed: boolean; remainingRequests: number; resetTime: Date } {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    
    // Get existing requests for this identifier
    let requestTimes = this.requests.get(identifier) || [];
    
    // Filter out requests outside the window
    requestTimes = requestTimes.filter(time => time > windowStart);
    
    // Check if limit exceeded
    const allowed = requestTimes.length < this.config.maxRequests;
    const remainingRequests = Math.max(0, this.config.maxRequests - requestTimes.length);
    const resetTime = new Date(now + this.config.windowMs);

    if (allowed) {
      // Add current request
      requestTimes.push(now);
      this.requests.set(identifier, requestTimes);
    }

    return { allowed, remainingRequests, resetTime };
  }

  reset(identifier?: string): void {
    if (identifier) {
      this.requests.delete(identifier);
    } else {
      this.requests.clear();
    }
  }

  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [identifier, requestTimes] of this.requests) {
      const validRequests = requestTimes.filter(time => time > windowStart);
      if (validRequests.length === 0) {
        this.requests.delete(identifier);
      } else {
        this.requests.set(identifier, validRequests);
      }
    }
  }
}

/**
 * Auto-scaling manager for dynamic resource allocation
 */
export class AutoScaler extends EventEmitter {
  private logger = Logger.getInstance();
  private resourceManager: ResourceManager;
  private scalingConfig: {
    scaleUpThreshold: number;    // CPU/Memory threshold to scale up
    scaleDownThreshold: number;  // CPU/Memory threshold to scale down
    minAgents: number;
    maxAgents: number;
    cooldownMs: number;
  };
  private lastScaleAction: number = 0;

  constructor(resourceManager: ResourceManager) {
    super();
    this.resourceManager = resourceManager;
    this.scalingConfig = {
      scaleUpThreshold: 0.8,    // 80%
      scaleDownThreshold: 0.3,  // 30%
      minAgents: 2,
      maxAgents: 20,
      cooldownMs: 30000        // 30 seconds
    };

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.resourceManager.on('resourceUpdate', (usage: ResourceUsage) => {
      this.evaluateScaling(usage);
    });
  }

  private evaluateScaling(usage: ResourceUsage): void {
    const now = Date.now();
    if (now - this.lastScaleAction < this.scalingConfig.cooldownMs) {
      return; // Still in cooldown period
    }

    const limits = this.resourceManager.getLimits();
    const memoryUtilization = usage.memoryMB / limits.maxMemoryMB;
    const cpuUtilization = usage.cpuPercent / limits.maxCpuPercent;
    const maxUtilization = Math.max(memoryUtilization, cpuUtilization);

    // Scale up decision
    if (maxUtilization > this.scalingConfig.scaleUpThreshold &&
        usage.activeAgents < this.scalingConfig.maxAgents) {
      
      const recommendedAgents = Math.min(
        usage.activeAgents + Math.ceil(usage.activeAgents * 0.5), // 50% increase
        this.scalingConfig.maxAgents
      );

      this.emit('scaleUp', {
        currentAgents: usage.activeAgents,
        recommendedAgents,
        reason: 'High resource utilization',
        utilization: maxUtilization
      });

      this.lastScaleAction = now;
      this.logger.info('autoscaler', 'Scale up recommended', {
        currentAgents: usage.activeAgents,
        recommendedAgents,
        utilization: maxUtilization
      });
    }
    
    // Scale down decision
    else if (maxUtilization < this.scalingConfig.scaleDownThreshold &&
             usage.activeAgents > this.scalingConfig.minAgents) {
      
      const recommendedAgents = Math.max(
        usage.activeAgents - Math.ceil(usage.activeAgents * 0.3), // 30% decrease
        this.scalingConfig.minAgents
      );

      this.emit('scaleDown', {
        currentAgents: usage.activeAgents,
        recommendedAgents,
        reason: 'Low resource utilization',
        utilization: maxUtilization
      });

      this.lastScaleAction = now;
      this.logger.info('autoscaler', 'Scale down recommended', {
        currentAgents: usage.activeAgents,
        recommendedAgents,
        utilization: maxUtilization
      });
    }
  }

  updateConfig(config: Partial<typeof this.scalingConfig>): void {
    this.scalingConfig = { ...this.scalingConfig, ...config };
    this.logger.info('autoscaler', 'Scaling configuration updated', this.scalingConfig);
  }

  getConfig(): typeof this.scalingConfig {
    return { ...this.scalingConfig };
  }
}

/**
 * Memory pool for efficient resource allocation
 */
export class MemoryPool {
  private pools: Map<string, any[]> = new Map();
  private maxPoolSize: number = 100;

  constructor(maxPoolSize: number = 100) {
    this.maxPoolSize = maxPoolSize;
  }

  acquire<T>(poolName: string, factory: () => T): T {
    let pool = this.pools.get(poolName);
    if (!pool) {
      pool = [];
      this.pools.set(poolName, pool);
    }

    if (pool.length > 0) {
      return pool.pop() as T;
    }

    return factory();
  }

  release<T>(poolName: string, item: T): void {
    let pool = this.pools.get(poolName);
    if (!pool) {
      pool = [];
      this.pools.set(poolName, pool);
    }

    if (pool.length < this.maxPoolSize) {
      pool.push(item);
    }
  }

  clear(poolName?: string): void {
    if (poolName) {
      this.pools.delete(poolName);
    } else {
      this.pools.clear();
    }
  }

  getStats(): { [poolName: string]: number } {
    const stats: { [poolName: string]: number } = {};
    for (const [name, pool] of this.pools) {
      stats[name] = pool.length;
    }
    return stats;
  }
}
