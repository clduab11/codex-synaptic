/**
 * Helper functions for building activation snapshots
 * Extracted to reduce complexity of buildActivationSnapshot function
 */

import { goapRegistry } from '../goap/registry.js';
import { Logger } from '../../core/logger.js';
import { AgentStatus } from '../../core/types.js';

const logger = Logger.getInstance();

export interface ComponentStatuses {
  registryStatus: any;
  schedulerStatus: any;
  meshStatus: any;
  swarmStatus: any;
  consensusStatus: any;
  resourceUsage?: any;
}

export interface GoapManifestData {
  manifests: Array<{ id: string; name?: string; version?: string }>;
  warnings: string[];
}

export interface HealthFacts {
  systemHealth: boolean;
  meshHealth: boolean;
  consensusHealth: boolean;
  swarmReadiness: boolean;
  goapCoverage: boolean;
  autoscalerBalance: boolean;
}

/**
 * Extract component statuses from system status
 */
export function extractComponentStatuses(systemStatus: any): ComponentStatuses {
  const components = systemStatus.components ?? {};
  return {
    registryStatus: components.agentRegistry ?? {},
    schedulerStatus: components.taskScheduler ?? {},
    meshStatus: components.neuralMesh ?? {},
    swarmStatus: components.swarmCoordinator ?? {},
    consensusStatus: components.consensusManager ?? {},
    resourceUsage: components.resources ?? undefined
  };
}

/**
 * Load GOAP manifests with error handling
 */
export async function loadGoapManifests(): Promise<GoapManifestData> {
  const warnings: string[] = [];
  let manifests: Array<{ id: string; name?: string; version?: string }> = [];

  try {
    const rawManifests = await goapRegistry.listManifests();
    manifests = rawManifests.map((manifest) => ({
      id: manifest.id,
      name: manifest.metadata?.name ?? manifest.id,
      version: manifest.metadata?.version
    }));
    if (!manifests.length) {
      warnings.push('No GOAP manifests detected in config/goap.');
    }
  } catch (error) {
    warnings.push('Unable to enumerate GOAP manifests.');
    logger.warn('strategy', 'Failed to list GOAP manifests', {
      reason: (error as Error).message
    });
  }

  return { manifests, warnings };
}

/**
 * Extract agent counts from registry status
 */
export function extractAgentCounts(registryStatus: any): {
  errorAgents: number;
  offlineAgents: number;
  availableAgents: number;
} {
  const errorAgents =
    registryStatus.statusCounts?.[AgentStatus.ERROR] ??
    registryStatus.statusCounts?.error ??
    0;
  const offlineAgents =
    registryStatus.statusCounts?.[AgentStatus.OFFLINE] ??
    registryStatus.statusCounts?.offline ??
    0;
  const availableAgents = registryStatus.availableAgents ?? 0;

  return { errorAgents, offlineAgents, availableAgents };
}

/**
 * Evaluate system health
 */
export function evaluateSystemHealth(
  registryStatus: any,
  schedulerStatus: any,
  errorAgents: number
): boolean {
  return (
    Boolean(registryStatus.isRunning) &&
    Boolean(schedulerStatus.isRunning) &&
    errorAgents === 0
  );
}

/**
 * Evaluate mesh stability
 */
export function evaluateMeshStability(
  meshStatus: any,
  agentTarget: number
): boolean {
  return (
    Boolean(meshStatus.isRunning) &&
    (meshStatus.nodeCount ?? 0) >= Math.max(3, Math.floor(agentTarget * 0.6)) &&
    (meshStatus.averageConnections ?? 0) >= 2
  );
}

/**
 * Evaluate consensus readiness
 */
export function evaluateConsensusReadiness(
  consensusStatus: any,
  expectedMechanism: string
): boolean {
  return (
    (consensusStatus.mechanism ?? '').toLowerCase() === expectedMechanism.toLowerCase() &&
    (consensusStatus.activeProposals ?? 0) === 0
  );
}

/**
 * Evaluate swarm readiness
 */
export function evaluateSwarmReadiness(
  swarmStatus: any,
  availableAgents: number
): boolean {
  return (
    Boolean(swarmStatus.isRunning ?? swarmStatus.isOptimizing) &&
    (swarmStatus.particleCount ?? 0) >= Math.max(1, availableAgents)
  );
}

/**
 * Evaluate autoscaler balance
 */
export function evaluateAutoscalerBalance(
  resourceUsage: any,
  agentTarget: number
): boolean {
  const cpuUtilization =
    resourceUsage && resourceUsage.cpuPercent && resourceUsage.cpuPercent > 0
      ? resourceUsage.cpuPercent
      : 0;
  const memoryHeadroom =
    resourceUsage?.memoryStatus?.headroomMB ?? resourceUsage?.memoryStatus?.headroom ?? 0;

  return (
    cpuUtilization >= 10 &&
    cpuUtilization <= 80 &&
    memoryHeadroom >= 256 &&
    (resourceUsage?.activeAgents ?? 0) >= Math.min(agentTarget, 3)
  );
}

/**
 * Build health facts object
 */
export function buildHealthFacts(
  systemHealthy: boolean,
  meshStable: boolean,
  consensusReady: boolean,
  swarmReady: boolean,
  goapPrepared: boolean,
  autoscalerBalanced: boolean
): Record<string, boolean> {
  return {
    systemHealth: systemHealthy,
    meshHealth: meshStable,
    consensusHealth: consensusReady,
    swarmReadiness: swarmReady,
    goapCoverage: goapPrepared,
    autoscalerBalance: autoscalerBalanced
  };
}

/**
 * Collect warnings based on health checks
 */
export function collectWarnings(
  systemHealthy: boolean,
  meshStable: boolean,
  consensusReady: boolean,
  swarmReady: boolean,
  goapPrepared: boolean,
  autoscalerBalanced: boolean,
  expectedConsensusMechanism: string,
  actualConsensusMechanism: string,
  goapWarnings: string[],
  manifestPath?: string
): string[] {
  const warnings: string[] = [];

  if (!systemHealthy) {
    warnings.push('System health check failed.');
  }
  if (!meshStable) {
    warnings.push('Neural mesh topology requires attention.');
  }
  if (!consensusReady) {
    warnings.push(
      `Consensus mechanism mismatch. Expected ${expectedConsensusMechanism.toUpperCase()}, received ${actualConsensusMechanism.toUpperCase()}.`
    );
  }
  if (!swarmReady) {
    warnings.push('Swarm coordinator is not actively optimizing.');
  }
  if (!goapPrepared) {
    warnings.push('GOAP manifest coverage unavailable.');
  }
  if (!autoscalerBalanced) {
    warnings.push('Autoscaler metrics outside desired envelope.');
  }
  warnings.push(...goapWarnings);
  if (manifestPath) {
    warnings.push(`Strategy manifest loaded from ${manifestPath}`);
  }

  return warnings;
}
