/**
 * Telemetry rendering helpers
 * Extracted to reduce complexity in CLI rendering functions
 */

import chalk from 'chalk';

export interface TelemetrySnapshot {
  agents: {
    total: number;
    available: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
  };
  resources?: {
    memoryMB?: number;
    memoryStatus?: {
      state: string;
      usageMB: number;
      limitMB: number;
      headroomMB: number;
    };
    cpuPercent?: number;
    concurrentTasks: number;
    gpu?: {
      selectedBackend: string;
      devices: Array<{ name: string }>;
    };
  };
  mesh?: {
    nodeCount: number;
    connectionCount: number;
  };
  swarm?: {
    algorithm: string;
    isOptimizing: boolean;
  };
  consensus?: {
    proposal?: {
      id: string;
    };
    accepted: boolean;
  };
  recentTasks: Array<{
    id: string;
    status: string;
    summary: string;
  }>;
}

/**
 * Format agent statistics
 */
export function formatAgentStats(agents: TelemetrySnapshot['agents']): string[] {
  const lines: string[] = [];
  lines.push(`  Agents: ${agents.total} total (${agents.available} available)`);

  const byType = Object.entries(agents.byType)
    .map(([key, value]) => `${key}:${value}`)
    .join(' | ') || 'none';
  lines.push(`  By Type: ${byType}`);

  const byStatus = Object.entries(agents.byStatus)
    .map(([key, value]) => `${key}:${value}`)
    .join(' | ') || 'none';
  lines.push(`  By Status: ${byStatus}`);

  return lines;
}

/**
 * Format memory usage
 */
export function formatMemoryUsage(usage: TelemetrySnapshot['resources']): string {
  if (!usage) {
    return 'n/a';
  }

  if (usage.memoryStatus) {
    const stateLabel =
      usage.memoryStatus.state === 'critical'
        ? chalk.red('critical')
        : usage.memoryStatus.state === 'elevated'
          ? chalk.yellow('elevated')
          : chalk.green('normal');

    const limit = usage.memoryStatus.limitMB;
    let memory = `${usage.memoryStatus.usageMB.toFixed(1)}MB / ${limit}MB (${stateLabel})`;

    const headroom = usage.memoryStatus.headroomMB;
    if (Number.isFinite(headroom)) {
      memory += `, headroom ${headroom.toFixed(1)}MB`;
    }

    return memory;
  }

  return Number.isFinite(usage.memoryMB ?? NaN) ? `${(usage.memoryMB ?? 0).toFixed(1)}MB` : 'n/a';
}

/**
 * Format resource stats
 */
export function formatResourceStats(resources?: TelemetrySnapshot['resources']): string[] {
  const lines: string[] = [];

  if (!resources) {
    return lines;
  }

  const memory = formatMemoryUsage(resources);
  const cpu = Number.isFinite(resources.cpuPercent ?? NaN)
    ? (resources.cpuPercent ?? 0).toFixed(2)
    : 'n/a';

  lines.push(`  Memory: ${memory} | CPU: ${cpu}% | Tasks: ${resources.concurrentTasks}`);

  if (resources.gpu) {
    const gpu = resources.gpu;
    const label =
      gpu.selectedBackend === 'cpu'
        ? 'CPU only'
        : `${gpu.selectedBackend.toUpperCase()} (${gpu.devices.map((d) => d.name).join(', ') || 'detected'})`;
    lines.push(`  GPU: ${label}`);
  }

  return lines;
}

/**
 * Format mesh stats
 */
export function formatMeshStats(mesh?: TelemetrySnapshot['mesh']): string | null {
  if (!mesh) {
    return null;
  }
  return `  Mesh: ${mesh.nodeCount} nodes / ${mesh.connectionCount} connections`;
}

/**
 * Format swarm stats
 */
export function formatSwarmStats(swarm?: TelemetrySnapshot['swarm']): string | null {
  if (!swarm) {
    return null;
  }
  return `  Swarm: algo=${swarm.algorithm} optimizing=${swarm.isOptimizing}`;
}

/**
 * Format consensus stats
 */
export function formatConsensusStats(consensus?: TelemetrySnapshot['consensus']): string | null {
  if (!consensus) {
    return null;
  }
  return `  Last consensus: ${consensus.proposal?.id ?? 'n/a'} accepted=${consensus.accepted}`;
}

/**
 * Format recent tasks
 */
export function formatRecentTasks(tasks: TelemetrySnapshot['recentTasks']): string[] {
  const lines: string[] = [];

  if (tasks.length) {
    lines.push('  Recent tasks:');
    for (const task of tasks.slice(0, 5)) {
      lines.push(`    • ${task.id} (${task.status}) — ${task.summary}`);
    }
  }

  return lines;
}
