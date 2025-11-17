/**
 * Feature flag system for runtime feature toggling
 * Enables instant kill-switch without redeployment
 */

import { log } from "../observability/logger.js";

/**
 * Feature flag configuration
 */
export interface FeatureFlag {
  key: string;
  enabled: boolean;
  description: string;
  rolloutPercentage?: number; // 0-100
  enabledFor?: string[]; // User IDs, agent IDs, etc.
  disabledFor?: string[]; // Explicitly disabled for certain users
  metadata?: Record<string, any>;
}

/**
 * Feature flag evaluation result
 */
export interface FlagEvaluation {
  enabled: boolean;
  reason: string;
  metadata?: Record<string, any>;
}

/**
 * Feature flags manager
 */
export class FeatureFlagsManager {
  private flags: Map<string, FeatureFlag> = new Map();
  private refreshInterval?: NodeJS.Timeout;

  constructor() {
    this.initializeDefaultFlags();
  }

  /**
   * Initialize default feature flags
   */
  private initializeDefaultFlags(): void {
    // System-level feature flags
    this.register({
      key: "neural_mesh_enabled",
      enabled: true,
      description: "Enable/disable neural mesh functionality",
    });

    this.register({
      key: "swarm_intelligence_enabled",
      enabled: true,
      description: "Enable/disable swarm intelligence algorithms",
    });

    this.register({
      key: "consensus_voting_enabled",
      enabled: true,
      description: "Enable/disable consensus voting mechanism",
    });

    this.register({
      key: "distributed_tracing_enabled",
      enabled: process.env.NODE_ENV === "production",
      description: "Enable/disable distributed tracing (OpenTelemetry)",
    });

    this.register({
      key: "metrics_collection_enabled",
      enabled: true,
      description: "Enable/disable metrics collection",
    });

    this.register({
      key: "rate_limiting_enabled",
      enabled: process.env.NODE_ENV === "production",
      description: "Enable/disable rate limiting",
    });

    // AI/LLM feature flags
    this.register({
      key: "openai_integration_enabled",
      enabled: true,
      description: "Enable/disable OpenAI API integration",
    });

    this.register({
      key: "anthropic_integration_enabled",
      enabled: true,
      description: "Enable/disable Anthropic Claude integration",
    });

    this.register({
      key: "perplexity_integration_enabled",
      enabled: false,
      description: "Enable/disable Perplexity API integration",
      rolloutPercentage: 10, // 10% rollout
    });

    // Experimental features
    this.register({
      key: "experimental_mcp_support",
      enabled: false,
      description:
        "Enable/disable experimental MCP (Model Context Protocol) support",
      rolloutPercentage: 0,
    });

    this.register({
      key: "experimental_streaming_enabled",
      enabled: false,
      description: "Enable/disable experimental streaming responses",
      rolloutPercentage: 25,
    });

    log.info("Feature flags initialized", { count: this.flags.size });
  }

  /**
   * Register a feature flag
   */
  register(flag: FeatureFlag): void {
    this.flags.set(flag.key, flag);
    log.debug("Feature flag registered", {
      key: flag.key,
      enabled: flag.enabled,
    });
  }

  /**
   * Update a feature flag
   */
  update(key: string, updates: Partial<FeatureFlag>): void {
    const flag = this.flags.get(key);
    if (!flag) {
      throw new Error(`Feature flag '${key}' not found`);
    }

    const updated = { ...flag, ...updates, key }; // Preserve key
    this.flags.set(key, updated);

    log.info("Feature flag updated", {
      key,
      enabled: updated.enabled,
      rollout: updated.rolloutPercentage,
    });
  }

  /**
   * Evaluate a feature flag for a given context
   */
  evaluate(
    key: string,
    context?: { userId?: string; agentId?: string },
  ): FlagEvaluation {
    const flag = this.flags.get(key);

    if (!flag) {
      log.warn("Feature flag not found, defaulting to disabled", { key });
      return {
        enabled: false,
        reason: "flag_not_found",
      };
    }

    // Check explicit disable list
    if (context) {
      const identifier = context.userId || context.agentId;
      if (identifier && flag.disabledFor?.includes(identifier)) {
        return {
          enabled: false,
          reason: "explicitly_disabled",
          metadata: flag.metadata,
        };
      }

      // Check explicit enable list
      if (identifier && flag.enabledFor?.includes(identifier)) {
        return {
          enabled: true,
          reason: "explicitly_enabled",
          metadata: flag.metadata,
        };
      }
    }

    // Check rollout percentage
    if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage < 100) {
      const identifier = context?.userId || context?.agentId || "default";
      const hash = this.hashString(identifier + key);
      const bucket = hash % 100;

      if (bucket >= flag.rolloutPercentage) {
        return {
          enabled: false,
          reason: "rollout_percentage",
          metadata: {
            ...flag.metadata,
            bucket,
            threshold: flag.rolloutPercentage,
          },
        };
      }
    }

    return {
      enabled: flag.enabled,
      reason: flag.enabled ? "enabled" : "disabled",
      metadata: flag.metadata,
    };
  }

  /**
   * Check if a feature is enabled
   */
  isEnabled(
    key: string,
    context?: { userId?: string; agentId?: string },
  ): boolean {
    return this.evaluate(key, context).enabled;
  }

  /**
   * Get all feature flags
   */
  getAll(): FeatureFlag[] {
    return Array.from(this.flags.values());
  }

  /**
   * Get a specific feature flag
   */
  get(key: string): FeatureFlag | undefined {
    return this.flags.get(key);
  }

  /**
   * Enable a feature flag (kill-switch: ON)
   */
  enable(key: string): void {
    this.update(key, { enabled: true });
  }

  /**
   * Disable a feature flag (kill-switch: OFF)
   */
  disable(key: string): void {
    this.update(key, { enabled: false });
  }

  /**
   * Set rollout percentage for gradual rollout
   */
  setRolloutPercentage(key: string, percentage: number): void {
    if (percentage < 0 || percentage > 100) {
      throw new Error("Rollout percentage must be between 0 and 100");
    }
    this.update(key, { rolloutPercentage: percentage });
  }

  /**
   * Enable for specific identifiers
   */
  enableFor(key: string, identifiers: string[]): void {
    const flag = this.flags.get(key);
    if (!flag) {
      throw new Error(`Feature flag '${key}' not found`);
    }

    const enabledFor = new Set(flag.enabledFor || []);
    identifiers.forEach((id) => enabledFor.add(id));

    this.update(key, { enabledFor: Array.from(enabledFor) });
  }

  /**
   * Disable for specific identifiers
   */
  disableFor(key: string, identifiers: string[]): void {
    const flag = this.flags.get(key);
    if (!flag) {
      throw new Error(`Feature flag '${key}' not found`);
    }

    const disabledFor = new Set(flag.disabledFor || []);
    identifiers.forEach((id) => disabledFor.add(id));

    this.update(key, { disabledFor: Array.from(disabledFor) });
  }

  /**
   * Simple string hash function for consistent bucketing
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Export flags as JSON (for persistence or API)
   */
  export(): Record<string, FeatureFlag> {
    return Object.fromEntries(this.flags);
  }

  /**
   * Import flags from JSON
   */
  import(data: Record<string, FeatureFlag>): void {
    for (const [key, flag] of Object.entries(data)) {
      this.register(flag);
    }
    log.info("Feature flags imported", { count: Object.keys(data).length });
  }

  /**
   * Start auto-refresh from remote source (for dynamic updates)
   */
  startAutoRefresh(
    fetchFunction: () => Promise<Record<string, FeatureFlag>>,
    intervalMs: number = 60000,
  ): void {
    this.refreshInterval = setInterval(async () => {
      try {
        const flags = await fetchFunction();
        this.import(flags);
        log.debug("Feature flags refreshed from remote source");
      } catch (error: any) {
        log.error("Failed to refresh feature flags", { error: error.message });
      }
    }, intervalMs);

    log.info("Feature flags auto-refresh started", {
      interval: `${intervalMs}ms`,
    });
  }

  /**
   * Stop auto-refresh
   */
  stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
      log.info("Feature flags auto-refresh stopped");
    }
  }
}

/**
 * Global feature flags manager instance
 */
export const featureFlags = new FeatureFlagsManager();

/**
 * Decorator for feature-flagged methods
 */
export function FeatureGated(flagKey: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: any[]) {
      const context = {
        userId: (this as any).userId,
        agentId: (this as any).agentId || (this as any).id?.id,
      };

      if (!featureFlags.isEnabled(flagKey, context)) {
        log.warn("Feature disabled, skipping method", {
          flag: flagKey,
          method: propertyKey,
          class: target.constructor.name,
        });
        return undefined;
      }

      return originalMethod.apply(this, args);
    };

    return descriptor;
  };
}
