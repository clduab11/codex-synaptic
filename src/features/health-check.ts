/**
 * Health check system for monitoring application status
 * Provides detailed health information for load balancers and monitoring
 */

import { log } from "../observability/logger.js";
import type { CodexSynapticSystem } from "../core/system.js";

/**
 * Health status levels
 */
export enum HealthStatus {
  HEALTHY = "healthy",
  DEGRADED = "degraded",
  UNHEALTHY = "unhealthy",
}

/**
 * Component health check result
 */
export interface HealthCheckResult {
  status: HealthStatus;
  message?: string;
  latency?: number;
  metadata?: Record<string, any>;
}

/**
 * Overall health report
 */
export interface HealthReport {
  status: HealthStatus;
  timestamp: string;
  uptime: number;
  version: string;
  components: Record<string, HealthCheckResult>;
  metrics?: {
    memoryUsage: NodeJS.MemoryUsage;
    cpuUsage: NodeJS.CpuUsage;
  };
}

/**
 * Health check function type
 */
export type HealthCheckFn = () => Promise<HealthCheckResult>;

/**
 * Health check manager
 */
export class HealthCheckManager {
  private checks: Map<string, HealthCheckFn> = new Map();
  private startTime: number = Date.now();

  /**
   * Register a health check
   */
  register(name: string, checkFn: HealthCheckFn): void {
    this.checks.set(name, checkFn);
    log.debug("Health check registered", { component: name });
  }

  /**
   * Unregister a health check
   */
  unregister(name: string): void {
    this.checks.delete(name);
    log.debug("Health check unregistered", { component: name });
  }

  /**
   * Run all health checks
   */
  async check(): Promise<HealthReport> {
    const components: Record<string, HealthCheckResult> = {};
    let overallStatus = HealthStatus.HEALTHY;

    // Run all checks in parallel
    const checkPromises = Array.from(this.checks.entries()).map(
      async ([name, checkFn]) => {
        const startTime = performance.now();
        try {
          const result = await Promise.race([
            checkFn(),
            this.timeout(5000, name),
          ]);
          result.latency = performance.now() - startTime;
          components[name] = result;

          // Update overall status
          if (result.status === HealthStatus.UNHEALTHY) {
            overallStatus = HealthStatus.UNHEALTHY;
          } else if (
            result.status === HealthStatus.DEGRADED &&
            overallStatus === HealthStatus.HEALTHY
          ) {
            overallStatus = HealthStatus.DEGRADED;
          }
        } catch (error: any) {
          components[name] = {
            status: HealthStatus.UNHEALTHY,
            message: error.message,
            latency: performance.now() - startTime,
          };
          overallStatus = HealthStatus.UNHEALTHY;
        }
      },
    );

    await Promise.allSettled(checkPromises);

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: (Date.now() - this.startTime) / 1000,
      version: process.env.npm_package_version || "unknown",
      components,
      metrics: {
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
      },
    };
  }

  /**
   * Get a simple liveness check (HTTP 200 if process is running)
   */
  async liveness(): Promise<boolean> {
    return true;
  }

  /**
   * Get a readiness check (HTTP 200 if ready to serve traffic)
   */
  async readiness(): Promise<boolean> {
    const report = await this.check();
    return report.status !== HealthStatus.UNHEALTHY;
  }

  /**
   * Timeout helper for health checks
   */
  private async timeout(
    ms: number,
    component: string,
  ): Promise<HealthCheckResult> {
    return new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`Health check timeout for ${component}`)),
        ms,
      );
    });
  }
}

/**
 * Global health check manager
 */
export const healthCheck = new HealthCheckManager();

/**
 * Initialize default health checks
 */
export function initializeHealthChecks(system?: CodexSynapticSystem): void {
  // System health check
  healthCheck.register("system", async () => {
    const memUsage = process.memoryUsage();
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    if (heapUsedPercent > 90) {
      return {
        status: HealthStatus.UNHEALTHY,
        message: "Memory usage critical",
        metadata: { heapUsedPercent: heapUsedPercent.toFixed(2) },
      };
    } else if (heapUsedPercent > 80) {
      return {
        status: HealthStatus.DEGRADED,
        message: "Memory usage high",
        metadata: { heapUsedPercent: heapUsedPercent.toFixed(2) },
      };
    }

    return {
      status: HealthStatus.HEALTHY,
      metadata: { heapUsedPercent: heapUsedPercent.toFixed(2) },
    };
  });

  // Agent registry health check
  if (system) {
    healthCheck.register("agent_registry", async () => {
      try {
        const agents = system.getAgentRegistry().getAllAgents();
        const activeAgents = agents.filter(
          (a: any) => a.status === "active",
        ).length;

        return {
          status: HealthStatus.HEALTHY,
          metadata: {
            totalAgents: agents.length,
            activeAgents,
          },
        };
      } catch (error: any) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: error.message,
        };
      }
    });

    // Neural mesh health check
    healthCheck.register("neural_mesh", async () => {
      try {
        const mesh = system.getNeuralMesh();
        const status = mesh.getStatus();

        if (!status.isRunning) {
          return {
            status: HealthStatus.DEGRADED,
            message: "Neural mesh not running",
            metadata: status,
          };
        }

        return {
          status: HealthStatus.HEALTHY,
          metadata: {
            nodeCount: status.nodeCount,
            connectionCount: status.connectionCount,
          },
        };
      } catch (error: any) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: error.message,
        };
      }
    });

    // Swarm coordination health check
    healthCheck.register("swarm_coordination", async () => {
      try {
        const swarm = system.getSwarmCoordinator();
        const status = swarm.getStatus();

        if (!status.isRunning) {
          return {
            status: HealthStatus.DEGRADED,
            message: "Swarm coordination not running",
            metadata: status,
          };
        }

        return {
          status: HealthStatus.HEALTHY,
          metadata: {
            algorithm: status.algorithm,
            particleCount: status.particleCount,
          },
        };
      } catch (error: any) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: error.message,
        };
      }
    });

    // Consensus manager health check
    healthCheck.register("consensus_manager", async () => {
      try {
        const consensus = system.getConsensusManager();
        const status = consensus.getStatus();

        if (!status.isRunning) {
          return {
            status: HealthStatus.DEGRADED,
            message: "Consensus manager not running",
            metadata: status,
          };
        }

        return {
          status: HealthStatus.HEALTHY,
          metadata: {
            activeProposals: status.activeProposals,
            totalVotes: status.totalVotes,
          },
        };
      } catch (error: any) {
        return {
          status: HealthStatus.UNHEALTHY,
          message: error.message,
        };
      }
    });
  }

  log.info("Health checks initialized");
}

/**
 * Create health check HTTP endpoints
 */
export function createHealthEndpoints() {
  return {
    /**
     * GET /health - Detailed health check
     */
    health: async (req: any, res: any) => {
      try {
        const report = await healthCheck.check();
        const statusCode =
          report.status === HealthStatus.HEALTHY
            ? 200
            : report.status === HealthStatus.DEGRADED
              ? 200
              : 503;

        res.status(statusCode).json(report);
      } catch (error: any) {
        log.error("Health check failed", { error: error.message });
        res.status(503).json({
          status: HealthStatus.UNHEALTHY,
          message: error.message,
        });
      }
    },

    /**
     * GET /health/live - Liveness probe (K8s)
     */
    liveness: async (req: any, res: any) => {
      const isAlive = await healthCheck.liveness();
      res.status(isAlive ? 200 : 503).json({ alive: isAlive });
    },

    /**
     * GET /health/ready - Readiness probe (K8s)
     */
    readiness: async (req: any, res: any) => {
      const isReady = await healthCheck.readiness();
      res.status(isReady ? 200 : 503).json({ ready: isReady });
    },
  };
}
