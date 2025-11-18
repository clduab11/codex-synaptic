/**
 * Hive-mind orchestration service
 * Extracted to reduce complexity in CLI command handlers
 */

import chalk from 'chalk';
import type { CodexSynapticSystem } from '../core/system.js';
import { AgentType } from '../core/types.js';

export interface HiveMindConfig {
  agents: number;
  maxAgents: number;
  maxWorkers: number;
  algorithm: string;
  meshTopology: string;
  consensus: string;
  priority: number;
  timeout: number;
  autoScale: boolean;
  queenCoordinator: boolean;
  faultTolerance: boolean;
  mcp: boolean;
  debug: boolean;
  codex: {
    enabled: boolean;
    contextHash?: string;
    sizeBytes?: number;
    agentGuides?: number;
    directories?: number;
    databases?: number;
  };
}

/**
 * Worker types for agent deployment in priority order
 */
export const WORKER_TYPES: AgentType[] = [
  AgentType.RESEARCH_WORKER,
  AgentType.ARCHITECT_WORKER,
  AgentType.ANALYST_WORKER,
  AgentType.SECURITY_WORKER,
  AgentType.CODE_WORKER,
  AgentType.DATA_WORKER,
  AgentType.VALIDATION_WORKER,
  AgentType.PERFORMANCE_WORKER,
  AgentType.OPS_WORKER,
  AgentType.INTEGRATION_WORKER,
  AgentType.SIMULATION_WORKER,
  AgentType.KNOWLEDGE_WORKER,
  AgentType.COMMUNICATION_WORKER,
  AgentType.AUTOMATION_WORKER,
  AgentType.OBSERVABILITY_WORKER,
  AgentType.COMPLIANCE_WORKER,
  AgentType.MEMORY_WORKER,
  AgentType.RELIABILITY_WORKER,
  AgentType.PLANNING_WORKER,
  AgentType.REVIEW_WORKER
];

/**
 * Reinforcement order for additional workers
 */
export const REINFORCEMENT_ORDER: AgentType[] = [
  AgentType.RESEARCH_WORKER,
  AgentType.ARCHITECT_WORKER,
  AgentType.ANALYST_WORKER,
  AgentType.CODE_WORKER,
  AgentType.VALIDATION_WORKER,
  AgentType.KNOWLEDGE_WORKER,
  AgentType.SECURITY_WORKER,
  AgentType.DATA_WORKER,
  AgentType.PERFORMANCE_WORKER,
  AgentType.OPS_WORKER,
  AgentType.INTEGRATION_WORKER,
  AgentType.MEMORY_WORKER,
  AgentType.REVIEW_WORKER
];

/**
 * Setup neural mesh infrastructure
 */
export async function setupInfrastructure(
  system: CodexSynapticSystem,
  config: HiveMindConfig
): Promise<void> {
  console.log(chalk.cyan('📡 Phase 1: Infrastructure Setup'));

  await system.createNeuralMesh(config.meshTopology, config.agents);
  console.log(
    chalk.green(`  ✓ Neural mesh configured (${config.meshTopology}, ${config.agents} nodes)`)
  );

  if (config.queenCoordinator) {
    await system.deployAgent(AgentType.SWARM_COORDINATOR, 1);
    await system.deployAgent(AgentType.TOPOLOGY_COORDINATOR, 1);
    console.log(chalk.green('  ✓ Queen coordinator deployed'));
  }

  await system.deployAgent(AgentType.CONSENSUS_COORDINATOR, 1);
  console.log(chalk.green(`  ✓ Consensus coordinator deployed (${config.consensus})`));
}

/**
 * Calculate deployment plan for worker agents
 */
export function calculateDeploymentPlan(
  workerBudget: number
): Map<AgentType, number> {
  const deploymentPlan = new Map<AgentType, number>();

  // Deploy one of each type first (up to budget)
  for (let i = 0; i < WORKER_TYPES.length && i < workerBudget; i += 1) {
    deploymentPlan.set(WORKER_TYPES[i], 1);
  }

  // Distribute remaining workers following reinforcement order
  let remainingWorkers = workerBudget - Math.min(WORKER_TYPES.length, workerBudget);
  let reinforcementIndex = 0;

  while (remainingWorkers > 0) {
    const type = REINFORCEMENT_ORDER[reinforcementIndex % REINFORCEMENT_ORDER.length];
    deploymentPlan.set(type, (deploymentPlan.get(type) ?? 0) + 1);
    remainingWorkers -= 1;
    reinforcementIndex += 1;
  }

  return deploymentPlan;
}

/**
 * Deploy worker agents
 */
export async function deployWorkers(
  system: CodexSynapticSystem,
  config: HiveMindConfig
): Promise<void> {
  console.log(chalk.cyan('🤖 Phase 2: Agent Deployment'));

  const workerBudget = Math.min(config.maxWorkers, Math.max(config.agents - 3, 0));
  const deploymentPlan = calculateDeploymentPlan(workerBudget);

  for (const [workerType, count] of deploymentPlan.entries()) {
    if (count > 0) {
      await system.deployAgent(workerType, count);
      console.log(chalk.green(`  ✓ Deployed ${count} ${workerType} agents`));
    }
  }
}

/**
 * Configure MCP and A2A bridges
 */
export async function configureBridges(
  system: CodexSynapticSystem,
  config: HiveMindConfig
): Promise<void> {
  if (config.mcp) {
    console.log(chalk.cyan('🌉 Phase 3: Bridge Configuration'));
    await system.deployAgent(AgentType.MCP_BRIDGE, 1);
    await system.deployAgent(AgentType.A2A_BRIDGE, 1);
    console.log(chalk.green('  ✓ MCP and A2A bridges activated'));
  }
}

/**
 * Activate swarm coordination
 */
export async function activateSwarm(
  system: CodexSynapticSystem,
  config: HiveMindConfig
): Promise<void> {
  console.log(chalk.cyan('🐝 Phase 4: Swarm Activation'));

  const objectives = ['code_quality', 'execution_speed', 'resource_efficiency'];
  if (config.faultTolerance) {
    objectives.push('fault_tolerance');
  }

  await system.startSwarm(config.algorithm, objectives);
  console.log(
    chalk.green(
      `  ✓ Swarm activated (${config.algorithm}, objectives: ${objectives.join(', ')})`
    )
  );
}

/**
 * Execute all orchestration phases
 */
export async function executeOrchestrationPhases(
  system: CodexSynapticSystem,
  config: HiveMindConfig
): Promise<void> {
  await setupInfrastructure(system, config);
  await deployWorkers(system, config);
  await configureBridges(system, config);
  await activateSwarm(system, config);
}
