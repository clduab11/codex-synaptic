/**
 * Telemetry formatting utilities for CLI display
 * Extracted from src/cli/index.ts to reduce complexity (RF-1.1)
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
      state: 'normal' | 'elevated' | 'critical';
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
    proposal?: { id: string };
    accepted: boolean;
  };
  recentTasks: Array<{
    id: string;
    status: string;
    summary: string;
  }>;
}

export function formatAgentsTelemetry(agents: TelemetrySnapshot['agents']): string[] {
  return [
    `  Agents: ${agents.total} total (${agents.available} available)`,
    `  By Type: ${Object.entries(agents.byType).map(([key, value]) => `${key}:${value}`).join(' | ') || 'none'}`,
    `  By Status: ${Object.entries(agents.byStatus).map(([key, value]) => `${key}:${value}`).join(' | ') || 'none'}`
  ];
}

export function formatMemoryTelemetry(memoryMB?: number, memoryStatus?: TelemetrySnapshot['resources']['memoryStatus']): string {
  if (memoryStatus) {
    const stateLabel = memoryStatus.state === 'critical'
      ? chalk.red('critical')
      : memoryStatus.state === 'elevated'
        ? chalk.yellow('elevated')
        : chalk.green('normal');
    const limit = memoryStatus.limitMB;
    let memory = `${memoryStatus.usageMB.toFixed(1)}MB / ${limit}MB (${stateLabel})`;
    const headroom = memoryStatus.headroomMB;
    if (Number.isFinite(headroom)) {
      memory += `, headroom ${headroom.toFixed(1)}MB`;
    }
    return memory;
  } else {
    return Number.isFinite(memoryMB) ? `${memoryMB.toFixed(1)}MB` : 'n/a';
  }
}

export function formatCPUTelemetry(cpuPercent?: number): string {
  return Number.isFinite(cpuPercent) ? cpuPercent.toFixed(2) : 'n/a';
}

export function formatGPUTelemetry(gpu?: TelemetrySnapshot['resources']['gpu']): string | null {
  if (!gpu) {
    return null;
  }
  const label = gpu.selectedBackend === 'cpu'
    ? 'CPU only'
    : `${gpu.selectedBackend.toUpperCase()} (${gpu.devices.map((d) => d.name).join(', ') || 'detected'})`;
  return `  GPU: ${label}`;
}

export function formatResourcesTelemetry(resources: TelemetrySnapshot['resources']): string[] {
  if (!resources) {
    return [];
  }

  const lines: string[] = [];
  const memory = formatMemoryTelemetry(resources.memoryMB, resources.memoryStatus);
  const cpu = formatCPUTelemetry(resources.cpuPercent);
  lines.push(`  Memory: ${memory} | CPU: ${cpu}% | Tasks: ${resources.concurrentTasks}`);

  const gpuLine = formatGPUTelemetry(resources.gpu);
  if (gpuLine) {
    lines.push(gpuLine);
  }

  return lines;
}

export function formatMeshTelemetry(mesh?: TelemetrySnapshot['mesh']): string | null {
  if (!mesh) {
    return null;
  }
  return `  Mesh: ${mesh.nodeCount} nodes / ${mesh.connectionCount} connections`;
}

export function formatSwarmTelemetry(swarm?: TelemetrySnapshot['swarm']): string | null {
  if (!swarm) {
    return null;
  }
  return `  Swarm: algo=${swarm.algorithm} optimizing=${swarm.isOptimizing}`;
}

export function formatConsensusTelemetry(consensus?: TelemetrySnapshot['consensus']): string | null {
  if (!consensus) {
    return null;
  }
  return `  Last consensus: ${(consensus.proposal?.id ?? 'n/a')} accepted=${consensus.accepted}`;
}

export function formatRecentTasksTelemetry(tasks: TelemetrySnapshot['recentTasks']): string[] {
  if (!tasks.length) {
    return [];
  }

  const lines: string[] = ['  Recent tasks:'];
  for (const task of tasks.slice(0, 5)) {
    lines.push(`    • ${task.id} (${task.status}) — ${task.summary}`);
  }
  return lines;
}

/**
 * Comprehensive telemetry rendering with extracted formatters
 * @param snapshot - Telemetry snapshot from session
 */
export function renderTelemetrySnapshot(snapshot: TelemetrySnapshot): void {
  console.log(chalk.blue('📊 Telemetry Snapshot'));

  // Agents
  formatAgentsTelemetry(snapshot.agents).forEach(line => console.log(line));

  // Resources
  formatResourcesTelemetry(snapshot.resources).forEach(line => console.log(line));

  // Mesh
  const meshLine = formatMeshTelemetry(snapshot.mesh);
  if (meshLine) {
    console.log(meshLine);
  }

  // Swarm
  const swarmLine = formatSwarmTelemetry(snapshot.swarm);
  if (swarmLine) {
    console.log(swarmLine);
  }

  // Consensus
  const consensusLine = formatConsensusTelemetry(snapshot.consensus);
  if (consensusLine) {
    console.log(consensusLine);
  }

  // Recent tasks
  formatRecentTasksTelemetry(snapshot.recentTasks).forEach(line => console.log(line));
}
