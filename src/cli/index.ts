#!/usr/bin/env node

/**
 * Codex-Synaptic CLI - System orchestration, workflow execution, and telemetry surface
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { CliSession } from './session.js';
import { CodexSynapticSystem } from '../core/system.js';
import { Logger, LogLevel } from '../core/logger.js';
import { AgentType, AgentMetadata } from '../core/types.js';
import {
  getBackgroundStatus,
  startBackgroundSystem,
  stopBackgroundSystem
} from './daemon-manager.js';
import {
  CodexContextBuilder,
  composePromptWithContext,
  renderCodexContextBlock,
  type CodexContextBuildResult
} from './codex-context.js';
import type {
  CodexContext,
  CodexContextAggregationMetadata,
  CodexPromptEnvelope,
  ContextLogEntry
} from '../types/codex-context.js';
import { RetryManager } from '../core/errors.js';
import { HiveMindYamlFormatter } from '../utils/yaml-output.js';
import { InstructionParser } from '../instructions/index.js';
import { RoutingPolicyService, type RoutingRequest } from '../router/index.js';
import { readFileSync } from 'fs';
import { join, resolve, relative } from 'path';
import * as yaml from 'js-yaml';
import { ToolOptimizer, type ToolCandidate } from '../tools/optimizer/index.js';
import { type ToolUsageRecord, type ReasoningRunRecord } from '../memory/memory-system.js';
import type { ReasoningPlanOptions, ReasoningCompletionOptions, ReasoningCheckpointInput } from '../reasoning/planner.js';
import type { SystemConfiguration } from '../core/config.js';
import { serviceManager } from '../env/service-manager.js';

const program = new Command();
const session = CliSession.getInstance();
const rootLogger = Logger.getInstance();

function shouldAutoAttachCodexContext(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  const repoSignals = [
    'repo',
    'repository',
    'codebase',
    'source tree',
    'readme',
    'agents.md',
    'docs/',
    'documentation',
    'codex-synaptic'
  ];

  const intentSignals = [
    'scan',
    'analy',
    'inspect',
    'audit',
    'recurs',
    'self-improve',
    'improve',
    'refactor',
    'optimiz',
    'stabiliz'
  ];

  return repoSignals.some((signal) => lower.includes(signal))
    && intentSignals.some((signal) => lower.includes(signal));
}

function shouldRequireConsensus(prompt: string, consensusMode: string): boolean {
  const lower = prompt.toLowerCase();
  if (consensusMode === 'byzantine') {
    return true;
  }
  return /(consens|quorum|vote|majority|byzantine)/.test(lower);
}

interface ConsensusExecutionResult {
  performed: boolean;
  accepted?: boolean;
  proposalId?: string;
  votes?: number;
  timedOut?: boolean;
  error?: string;
}

function deriveConsensusDecision(outcome: any): boolean {
  if (!outcome?.artifacts) {
    return true;
  }
  const validation = outcome.artifacts.validation;
  if (validation && validation.passed === false) {
    return false;
  }
  const lintIssues = Array.isArray(outcome.artifacts.lintIssues)
    ? outcome.artifacts.lintIssues
    : [];
  const hasBlockingLint = lintIssues.some(
    (issue: { severity?: string }) => issue.severity === 'error' || issue.severity === 'fatal'
  );
  if (hasBlockingLint) {
    return false;
  }
  return true;
}

async function orchestrateConsensus(
  system: CodexSynapticSystem,
  originalPrompt: string,
  outcome: any
): Promise<ConsensusExecutionResult> {
  const consensusAgents = system
    .getAgentRegistry()
    .getAgentsByType(AgentType.CONSENSUS_COORDINATOR);

  if (!consensusAgents.length) {
    console.log(
      chalk.yellow('  ⚠️  No consensus coordinators available; skipping consensus vote.')
    );
    return { performed: false, error: 'no-consensus-agents' };
  }

  const proposer = consensusAgents[0].id;
  const decision = deriveConsensusDecision(outcome);
  const proposalId = await system.proposeConsensus(
    'hive_mind_review',
    {
      prompt: originalPrompt,
      summary: outcome?.summary ?? '',
      artifacts: outcome?.artifacts ?? {}
    },
    proposer
  );

  const consensusResultPromise = new Promise<ConsensusExecutionResult>((resolve) => {
    const timeout = setTimeout(() => {
      system.off('consensusReached', handler);
      resolve({
        performed: true,
        proposalId,
        accepted: false,
        votes: 0,
        timedOut: true,
        error: 'timeout'
      });
    }, 5000);

    const handler = (event: any) => {
      if (event?.proposal?.id !== proposalId) {
        return;
      }
      clearTimeout(timeout);
      system.off('consensusReached', handler);
      resolve({
        performed: true,
        proposalId,
        accepted: Boolean(event?.accepted),
        votes: Array.isArray(event?.votes) ? event.votes.length : 0,
        timedOut: false
      });
    };

    system.on('consensusReached', handler);
  });

  for (const agent of consensusAgents) {
    system.submitConsensusVote(proposalId, decision, agent.id);
  }

  const result = await consensusResultPromise;

  if (result.timedOut) {
    console.log(
      chalk.yellow(
        `  ⚠️  Byzantine consensus timed out for proposal ${proposalId}.`
      )
    );
  } else if (result.accepted) {
    console.log(
      chalk.green(
        `  ✓ Byzantine consensus approved for proposal ${proposalId} (${result.votes ?? 0} votes).`
      )
    );
  } else {
    console.log(
      chalk.red(
        `  ✗ Byzantine consensus rejected for proposal ${proposalId} (${result.votes ?? 0} votes).`
      )
    );
  }

  return result;
}

program
  .name('codex-synaptic')
  .description('Enhanced OpenAI Codex with distributed agent capabilities')
  .version('1.0.0');

function handleCommand<T extends any[]>(name: string, fn: (...args: T) => Promise<void>) {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (error) {
      const err = error as Error;
      console.error(chalk.red(`❌ ${name} failed: ${err.message}`));
      if (process.env.CODEX_DEBUG === '1' && err.stack) {
        console.error(chalk.gray(err.stack));
      }
      process.exitCode = 1;
    }
  };
}

async function useSystem(description: string, fn: (system: CodexSynapticSystem) => Promise<void>): Promise<void> {
  const alreadyRunning = !!session.getSystemUnsafe();
  if (!alreadyRunning) {
    console.log(chalk.blue(`🔧 Initializing Codex-Synaptic system (${description})...`));
  }
  const system = await session.ensureSystem();
  await fn(system);
}

function parseInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} must be a number`);
  }
  return parsed;
}

function parseJsonInput(value: string, label: string): any {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

/**
 * Parse file content supporting both YAML and JSON formats
 * YAML files are automatically converted to JSON for compatibility
 */
function parseFileContent(filePath: string): any {
  const content = readFileSync(filePath, 'utf8');
  const isYaml = filePath.endsWith('.yaml') || filePath.endsWith('.yml');
  
  if (isYaml) {
    try {
      // Parse YAML content
      const parsed = yaml.load(content);
      console.log(chalk.gray(`📄 Parsed YAML file: ${filePath}`));
      return parsed;
    } catch (error) {
      throw new Error(`Failed to parse YAML file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  } else {
    // Parse as JSON
    try {
      const parsed = JSON.parse(content);
      console.log(chalk.gray(`📄 Parsed JSON file: ${filePath}`));
      return parsed;
    } catch (error) {
      throw new Error(`Failed to parse JSON file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

function renderAgentTable(agents: AgentMetadata[]): void {
  if (!agents.length) {
    console.log(chalk.gray('No agents registered.'));
    return;
  }

  const rows = agents.map((agent) => ({
    id: agent.id.id,
    type: agent.id.type,
    status: agent.status,
    capabilities: agent.capabilities.map((cap) => cap.name).join(', '),
    lastUpdated: agent.lastUpdated.toISOString()
  }));

  console.table(rows);
}

function renderMeshStatus(status: any): void {
  console.log(chalk.blue('🕸️  Neural Mesh'));
  console.log(`  Running: ${status.isRunning ? chalk.green('yes') : chalk.red('no')}`);
  console.log(`  Nodes: ${status.nodeCount}`);
  console.log(`  Connections: ${status.connectionCount}`);
  console.log(`  Avg connections: ${status.averageConnections.toFixed(2)}`);
  console.log(`  Topology: ${status.topology}`);
  if (typeof status.maxRunDurationMs !== 'undefined') {
    const limitLabel = status.maxRunDurationMs > 0 ? `${Math.round(status.maxRunDurationMs / 60000)}m` : 'disabled';
    const remainingMinutes = status.runActive && typeof status.remainingTimeMs === 'number'
      ? Math.max(0, Math.ceil(status.remainingTimeMs / 60000))
      : null;
    const activityLabel = status.runActive ? chalk.green('active') : chalk.gray('inactive');
    const remainingLabel = remainingMinutes !== null ? `, ${remainingMinutes}m remaining` : '';
    console.log(`  Orchestration: ${activityLabel} (limit ${limitLabel}${remainingLabel})`);
  }
}

function renderInteractiveHints(): void {
  console.log(chalk.blueBright('💡 Interactive hints'));
  console.log('  - Use arrow keys and Enter to choose actions.');
  console.log('  - Start with "System status" to confirm mesh and agents are healthy.');
  console.log('  - "List agents" summarizes Code/Data/Validation workers from AGENTS.md.');
  console.log('  - "Submit workflow" accepts natural language tasks and streams results.');
  console.log('  - Full telemetry continues in logs/, press Ctrl+C to exit gracefully.');
}

function renderSwarmStatus(status: any): void {
  console.log(chalk.blue('🐝 Swarm Coordination'));
  console.log(`  Running: ${status.isRunning ? chalk.green('yes') : chalk.red('no')}`);
  console.log(`  Algorithm: ${status.algorithm}`);
  console.log(`  Particle count: ${status.particleCount}`);
  console.log(`  Optimizing: ${status.isOptimizing ? 'yes' : 'no'}`);
  if (typeof status.maxRunDurationMs !== 'undefined') {
    const limitLabel = status.maxRunDurationMs > 0 ? `${Math.round(status.maxRunDurationMs / 60000)}m` : 'disabled';
    const remainingMinutes = status.isOptimizing && typeof status.remainingTimeMs === 'number'
      ? Math.max(0, Math.ceil(status.remainingTimeMs / 60000))
      : null;
    const activityLabel = status.isOptimizing ? chalk.green('active') : chalk.gray('idle');
    const remainingLabel = remainingMinutes !== null ? `, ${remainingMinutes}m remaining` : '';
    console.log(`  Orchestration: ${activityLabel} (limit ${limitLabel}${remainingLabel})`);
  }
}

function renderConsensusStatus(system: CodexSynapticSystem): void {
  const manager = system.getConsensusManager();
  const status = manager.getStatus();
  console.log(chalk.blue('🗳️  Consensus Manager'));
  console.log(`  Running: ${status.isRunning ? chalk.green('yes') : chalk.red('no')}`);
  console.log(`  Active proposals: ${status.activeProposals}`);
  console.log(`  Votes tracked: ${status.totalVotes}`);

  const proposals = manager.getActiveProposals();
  if (proposals.length) {
    console.log(chalk.cyan('  Proposals:'));
    for (const proposal of proposals) {
      const votes = manager.getVotes(proposal.id);
      const yesVotes = votes.filter((vote) => vote.vote).length;
      const noVotes = votes.length - yesVotes;
      console.log(`    • ${proposal.id} [${proposal.type}] — ${yesVotes} yes / ${noVotes} no / ${proposal.requiredVotes} required`);
    }
  }
}

function renderTelemetry(): void {
  const snapshot = session.getTelemetry();
  console.log(chalk.blue('📊 Telemetry Snapshot'));
  console.log(`  Agents: ${snapshot.agents.total} total (${snapshot.agents.available} available)`);
  console.log(`  By Type: ${Object.entries(snapshot.agents.byType).map(([key, value]) => `${key}:${value}`).join(' | ') || 'none'}`);
  console.log(`  By Status: ${Object.entries(snapshot.agents.byStatus).map(([key, value]) => `${key}:${value}`).join(' | ') || 'none'}`);
  if (snapshot.resources) {
    const usage = snapshot.resources;
    let memory: string;
    if (usage.memoryStatus) {
      const stateLabel = usage.memoryStatus.state === 'critical'
        ? chalk.red('critical')
        : usage.memoryStatus.state === 'elevated'
          ? chalk.yellow('elevated')
          : chalk.green('normal');
      const limit = usage.memoryStatus.limitMB;
      memory = `${usage.memoryStatus.usageMB.toFixed(1)}MB / ${limit}MB (${stateLabel})`;
      const headroom = usage.memoryStatus.headroomMB;
      if (Number.isFinite(headroom)) {
        memory += `, headroom ${headroom.toFixed(1)}MB`;
      }
    } else {
      memory = Number.isFinite(usage.memoryMB) ? `${usage.memoryMB.toFixed(1)}MB` : 'n/a';
    }
    const cpu = Number.isFinite(usage.cpuPercent) ? usage.cpuPercent.toFixed(2) : 'n/a';
    console.log(`  Memory: ${memory} | CPU: ${cpu}% | Tasks: ${usage.concurrentTasks}`);
    if (usage.gpu) {
      const gpu = usage.gpu;
      const label = gpu.selectedBackend === 'cpu' ? 'CPU only' : `${gpu.selectedBackend.toUpperCase()} (${gpu.devices.map((d) => d.name).join(', ') || 'detected'})`;
      console.log(`  GPU: ${label}`);
    }
  }
  if (snapshot.mesh) {
    console.log(`  Mesh: ${snapshot.mesh.nodeCount} nodes / ${snapshot.mesh.connectionCount} connections`);
  }
  if (snapshot.swarm) {
    console.log(`  Swarm: algo=${snapshot.swarm.algorithm} optimizing=${snapshot.swarm.isOptimizing}`);
  }
  if (snapshot.consensus) {
    console.log(`  Last consensus: ${(snapshot.consensus.proposal?.id ?? 'n/a')} accepted=${snapshot.consensus.accepted}`);
  }
  if (snapshot.recentTasks.length) {
    console.log('  Recent tasks:');
    for (const task of snapshot.recentTasks.slice(0, 5)) {
      console.log(`    • ${task.id} (${task.status}) — ${task.summary}`);
    }
  }
}

function emitContextLogs(logs: ContextLogEntry[]): void {
  if (!logs.length) {
    return;
  }
  console.log(chalk.blue('🧾 Codex context aggregation log'));
  for (const entry of logs) {
    const detailText = entry.details ? formatDetailEntry(entry.details) : '';
    const suffix = detailText ? chalk.gray(` (${detailText})`) : '';
    if (entry.level === 'info') {
      console.log(chalk.gray(`  • ${entry.message}`) + suffix);
    } else if (entry.level === 'warn') {
      console.log(chalk.yellow(`  ⚠️ ${entry.message}`) + suffix);
    } else {
      console.log(chalk.red(`  ❗ ${entry.message}`) + suffix);
    }
  }
}

function emitContextSummary(context: CodexContext, metadata: CodexContextAggregationMetadata): void {
  console.log(chalk.blue('🧠 Codex context summary'));
  console.log(chalk.gray(`  • Context hash: ${context.contextHash}`));
  console.log(chalk.gray(`  • Context size: ${context.sizeBytes} bytes`));
  console.log(chalk.gray(`  • Agent directives: ${metadata.agentGuideCount} file(s)`));
  console.log(chalk.gray(`  • README excerpts: ${context.readmeExcerpts.length}`));
  console.log(chalk.gray(`  • .codex directories: ${metadata.codexDirectoryCount}`));
  console.log(chalk.gray(`  • Database artifacts: ${metadata.databaseCount}`));
  if (context.warnings.length) {
    for (const warning of context.warnings) {
      console.log(chalk.yellow(`  ⚠️ ${warning}`));
    }
  }
}

async function primeCodexWithRetry(
  system: CodexSynapticSystem,
  context: CodexContext,
  envelope: CodexPromptEnvelope
): Promise<void> {
  await RetryManager.executeWithRetry(async () => {
    await system.primeCodexInterface(context, envelope);
  }, 3, 500, 4000);
  console.log(chalk.green(`🔐 Codex CLI primed (hash ${context.contextHash.slice(0, 8)}…).`));
}

function formatDetailEntry(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ');
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function describeCachePath(absPath?: string): string {
  if (!absPath) {
    return 'all roots';
  }
  const relPath = relative(process.cwd(), absPath);
  if (!relPath || relPath === '') {
    return '.';
  }
  return relPath.startsWith('..') ? absPath : relPath;
}

function parseAgentType(value?: string): AgentType | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  const match = Object.values(AgentType).find((type) => type.toLowerCase() === normalized);
  if (!match) {
    throw new Error(`Unknown agent type "${value}"`);
  }
  return match;
}

function parseJsonOption<T = any>(value?: string): T | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new Error(`Failed to parse JSON option: ${(error as Error).message}`);
  }
}

function loadToolCandidates(filePath: string): ToolCandidate[] {
  const absolutePath = resolve(filePath);
  const content = readFileSync(absolutePath, 'utf8');
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse candidate file: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Tool candidates file must contain an array.');
  }
  return parsed.map((entry, index) => {
    if (!entry?.id) {
      throw new Error(`Tool candidate at index ${index} is missing an "id" field.`);
    }
    return {
      id: String(entry.id),
      description: entry.description ? String(entry.description) : undefined,
      agentType: parseAgentType(entry.agentType),
      capabilities: Array.isArray(entry.capabilities) ? entry.capabilities.map((cap: any) => String(cap)) : undefined,
      costEstimateMs: typeof entry.costEstimateMs === 'number' ? entry.costEstimateMs : undefined
    };
  });
}

function buildToolUsageRecord(options: any): ToolUsageRecord {
  let metadataPayload: Record<string, any> | undefined;
  if (options.metadata) {
    try {
      metadataPayload = JSON.parse(String(options.metadata));
    } catch (error) {
      throw new Error(`Failed to parse metadata JSON: ${(error as Error).message}`);
    }
  }

  return {
    toolId: String(options.id),
    agentType: parseAgentType(options.agentType),
    capability: options.capability ? String(options.capability) : undefined,
    promptHash: options.promptHash ? String(options.promptHash) : undefined,
    success: options.success ?? true,
    latencyMs: options.latency ? Number(options.latency) : undefined,
    confidence: options.confidence !== undefined ? Number(options.confidence) : undefined,
    contextTags: options.tags ? String(options.tags).split(',').map((tag: string) => tag.trim()).filter(Boolean) : undefined,
    metadata: metadataPayload,
    timestamp: options.timestamp ? new Date(options.timestamp).toISOString() : undefined
  };
}

// System commands
const systemCmd = program.command('system').description('System management commands');

systemCmd
  .command('start')
  .description('Start the Codex-Synaptic system (idempotent)')
  .action(handleCommand('system.start', async () => {
    if (session.getSystemUnsafe()) {
      console.log(chalk.yellow('⚠️  Codex-Synaptic system already running.'));
      renderTelemetry();
      return;
    }

    await useSystem('system start', async (system) => {
      console.log(chalk.green('✅ Codex-Synaptic system initialized.'));
      renderTelemetry();
      renderMeshStatus(system.getNeuralMesh().getStatus());
      renderSwarmStatus(system.getSwarmCoordinator().getStatus());
      renderConsensusStatus(system);
    });
  }));

systemCmd
  .command('status')
  .description('Show system status and telemetry')
  .action(handleCommand('system.status', async () => {
    const system = session.getSystemUnsafe();
    if (!system) {
      console.log(chalk.yellow('⚠️  System not started. Run `codex-synaptic system start` first.'));
      return;
    }

    const status = system.getStatus();
    console.log(chalk.blue('🧠 Codex-Synaptic System Status'));
    console.log(`  Initialized: ${status.initialized}`);
    console.log(`  Shutting down: ${status.shuttingDown}`);
    renderTelemetry();
  }));

systemCmd
  .command('stop')
  .description('Stop the Codex-Synaptic system and release resources')
  .action(handleCommand('system.stop', async () => {
    if (!session.getSystemUnsafe()) {
      console.log(chalk.gray('System already stopped.'));
      return;
    }

    await session.shutdown('manual-stop');
    console.log(chalk.green('✅ Codex-Synaptic system shutdown complete.'));
  }));

systemCmd
  .command('monitor')
  .description('Stream live telemetry until interrupted')
  .option('-i, --interval <ms>', 'Refresh interval in milliseconds', '2000')
  .action(handleCommand('system.monitor', async (options) => {
    await useSystem('system monitor', async () => {
      const intervalMs = parseInteger(options.interval, 'interval');
      console.log(chalk.blue('📡 Streaming telemetry (Ctrl+C to stop)...'));
      const render = () => {
        console.log('\n' + chalk.gray('─'.repeat(40)));
        renderTelemetry();
      };
      render();
      const timer = setInterval(render, intervalMs);
      const stop = () => clearInterval(timer);
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          process.removeListener('SIGINT', stop);
          process.removeListener('SIGTERM', stop);
          stop();
          resolve();
        };
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);
      });
    });
  }));

// Background daemon commands
const backgroundCmd = program.command('background').description('Manage the background Codex-Synaptic daemon');

backgroundCmd
  .command('status')
  .description('Show the status of the detached background system')
  .action(handleCommand('background.status', async () => {
    const status = getBackgroundStatus();
    if (!status.running) {
      console.log(chalk.gray('Background system is not running.'));
      return;
    }
    console.log(chalk.blue('🛰 Background system'));
    console.log(`  PID: ${status.pid}`);
    console.log(`  Started at: ${status.startedAt}`);
  }));

backgroundCmd
  .command('start')
  .description('Launch a detached background system instance')
  .action(handleCommand('background.start', async () => {
    const status = await startBackgroundSystem();
    if (!status.running) {
      console.log(chalk.red('Failed to start background system.'));
      return;
    }
    console.log(chalk.green(`✅ Background system running (pid ${status.pid})`));
    if (status.startedAt) {
      console.log(`  Started at: ${status.startedAt}`);
    }
  }));

backgroundCmd
  .command('stop')
  .description('Terminate the detached background system')
  .option('-t, --timeout <ms>', 'Timeout before force stopping', '10000')
  .action(handleCommand('background.stop', async (options) => {
    const timeout = parseInteger(options.timeout, 'timeout');
    const result = await stopBackgroundSystem(timeout);
    switch (result) {
      case 'stopped':
        console.log(chalk.green('✅ Background system stopped.'));
        break;
      case 'not_running':
        console.log(chalk.gray('Background system was not running.'));
        break;
      case 'timeout':
        console.log(chalk.yellow('⚠️  Background system did not stop before timeout.')); 
        break;
    }
  }));

// Instructions commands
const instructionsCmd = program.command('instructions').description('Instruction processing and cache management');

instructionsCmd
  .command('sync')
  .description('Synchronize and cache AGENTS.md instructions from repository')
  .option('-r, --root <path>', 'Repository root path', process.cwd())
  .option('--no-cache', 'Skip cache and force fresh scan')
  .option('-v, --verbose', 'Show detailed processing information')
  .action(handleCommand('instructions.sync', async (options) => {
    const parser = new InstructionParser();
    try {
      console.log(chalk.cyan('🔄 Synchronizing instruction files...'));
      
      const startTime = Date.now();
      const context = await parser.parseInstructions(options.root, options.cache);
      const duration = Date.now() - startTime;
      
      if (options.verbose) {
        console.log(chalk.gray(`Processed ${context.metadata.length} instruction files`));
        console.log(chalk.gray(`Precedence chain: ${context.precedenceChain.join(' → ')}`));
        console.log(chalk.gray(`Context hash: ${context.contextHash}`));
        console.log(chalk.gray(`Total size: ${context.aggregatedSize} bytes`));
        console.log(chalk.gray(`Processing time: ${duration}ms`));
      }
      
      console.log(chalk.green(`✅ Instructions synchronized successfully`));
      console.log(`📁 Files processed: ${context.metadata.length}`);
      console.log(`🔗 Context hash: ${context.contextHash.slice(0, 12)}...`);
      
    } catch (error) {
      console.error(chalk.red(`❌ Failed to sync instructions: ${error}`));
      process.exitCode = 1;
    } finally {
      await parser.close();
    }
  }));

instructionsCmd
  .command('validate')
  .argument('[file]', 'Specific AGENTS.md file to validate (optional)')
  .description('Validate AGENTS.md file syntax and structure')
  .option('-r, --root <path>', 'Repository root path', process.cwd())
  .action(handleCommand('instructions.validate', async (file, options) => {
    const parser = new InstructionParser();
    try {
      if (file) {
        // Validate specific file
        console.log(chalk.cyan(`🔍 Validating ${file}...`));
        const result = await parser.validateInstructionSyntax(file);
        
        if (result.isValid) {
          console.log(chalk.green(`✅ ${file} is valid`));
        } else {
          console.log(chalk.red(`❌ ${file} has validation errors:`));
          result.errors.forEach(error => console.log(chalk.red(`  • ${error}`)));
          process.exitCode = 1;
        }
      } else {
        // Validate all files in repository
        console.log(chalk.cyan('🔍 Validating all instruction files...'));
        const context = await parser.parseInstructions(options.root, false);
        
        const invalidFiles = context.metadata.filter(m => !m.isValid);
        if (invalidFiles.length === 0) {
          console.log(chalk.green(`✅ All ${context.metadata.length} instruction files are valid`));
        } else {
          console.log(chalk.red(`❌ Found ${invalidFiles.length} invalid files:`));
          invalidFiles.forEach(file => {
            console.log(chalk.red(`  • ${file.path}:`));
            file.validationErrors?.forEach(error => console.log(chalk.red(`    - ${error}`)));
          });
          process.exitCode = 1;
        }
      }
    } catch (error) {
      console.error(chalk.red(`❌ Validation failed: ${error}`));
      process.exitCode = 1;
    } finally {
      await parser.close();
    }
  }));

instructionsCmd
  .command('cache')
  .description('Manage instruction cache')
  .option('--clear [path]', 'Clear cache for specific path or all if no path given')
  .option('--status', 'Show cache status')
  .option('-r, --root <path>', 'Target root path for cache operations')
  .action(handleCommand('instructions.cache', async (options) => {
    const parser = new InstructionParser();
    try {
      const rootOverride = options.root ? resolve(options.root) : undefined;

      if (options.clear !== undefined) {
        const pathToClear = typeof options.clear === 'string'
          ? resolve(options.clear)
          : rootOverride;
        await parser.clearCache(pathToClear);
        const descriptor = describeCachePath(pathToClear);
        console.log(chalk.green(`✅ Cache cleared (${descriptor}).`));
      } else if (options.status) {
        const status = await parser.getCacheStatus(rootOverride);
        if (status.totalEntries === 0) {
          const scopeLabel = describeCachePath(rootOverride);
          console.log(chalk.gray(`Cache is empty${scopeLabel !== 'all roots' ? ` for ${scopeLabel}` : ''}.`));
        } else {
          console.log(chalk.cyan('📊 Instruction cache status'));
          if (rootOverride) {
            console.log(chalk.gray(`  Scope: ${describeCachePath(rootOverride)}`));
          }
          console.log(chalk.gray(`  Entries: ${status.totalEntries}`));
          console.log(chalk.gray(`  Roots: ${status.rootCount}`));
          console.log(chalk.gray(`  Total size: ${formatBytes(status.totalSizeBytes)}`));

          status.entries.forEach((entry, index) => {
            const rootLabel = describeCachePath(entry.rootPath);
            const hashPreview = entry.contextHash ? `${entry.contextHash.slice(0, 12)}…` : 'n/a';
            const expiryLabel = entry.ttlSeconds > 0 ? entry.expiresAt.toISOString() : 'never';
            const stateLabel = entry.ttlSeconds > 0
              ? (entry.isExpired ? chalk.yellow('expired') : chalk.green('active'))
              : chalk.blue('persistent');

            console.log(chalk.cyan(`\n  ${index + 1}. ${rootLabel}`));
            console.log(chalk.gray(`     Hash: ${hashPreview}`));
            console.log(chalk.gray(`     Size: ${formatBytes(entry.sizeBytes)}`));
            console.log(chalk.gray(`     Created: ${entry.createdAt.toISOString()}`));
            console.log(
              `${chalk.gray('     Expires:')} ${chalk.gray(expiryLabel)} ${chalk.gray('(')}${stateLabel}${chalk.gray(')')}`
            );
          });
        }
      } else {
        console.log(chalk.yellow('⚠️  Please specify --clear or --status'));
      }
    } catch (error) {
      console.error(chalk.red(`❌ Cache operation failed: ${error}`));
      process.exitCode = 1;
    } finally {
      await parser.close();
    }
  }));

// Tools commands
const toolsCmd = program.command('tools').description('Tool optimisation utilities');

toolsCmd
  .command('score')
  .description('Evaluate tool candidates for the supplied prompt')
  .argument('<prompt>', 'Prompt to evaluate')
  .requiredOption('-c, --candidates <file>', 'Path to JSON file containing tool candidate definitions')
  .option('-l, --history <count>', 'History limit for telemetry lookback', '200')
  .action(handleCommand('tools.score', async (prompt: string, options) => {
    const candidates = loadToolCandidates(options.candidates);
    const historyLimit = Number.parseInt(options.history ?? '200', 10);

    await useSystem('tools score', async (system) => {
      const optimizer = new ToolOptimizer(system.getMemorySystem(), { historyLimit });
      const scores = await optimizer.evaluateTools(prompt, candidates);

      if (!scores.length) {
        console.log(chalk.gray('No tool candidates available for scoring.'));
        return;
      }

      console.log(chalk.blue('🎯 Tool Scoring Results'));
      scores.forEach((score, index) => {
        console.log(chalk.cyan(`\n${index + 1}. ${score.toolId}`));
        console.log(chalk.gray(`   Score: ${(score.score * 100).toFixed(1)}%`));
        console.log(chalk.gray(`   Confidence: ${(score.confidence * 100).toFixed(1)}%`));
        if (score.usage) {
          console.log(
            chalk.gray(
              `   Usage: ${score.usage.success}/${score.usage.total} success, avg latency ${score.usage.averageLatencyMs.toFixed(1)}ms`
            )
          );
          if (score.usage.lastInvokedAt) {
            console.log(chalk.gray(`   Last invoked: ${score.usage.lastInvokedAt}`));
          }
        }
        console.log(chalk.gray(`   Signals: ${score.signals.join(', ')}`));
        score.reasoning.forEach((reason) => console.log(chalk.gray(`     • ${reason}`)));
      });
    });
  }));

toolsCmd
  .command('record')
  .description('Record the outcome of a tool invocation for telemetry/training purposes')
  .requiredOption('--id <toolId>', 'Tool identifier')
  .option('--agent-type <agentType>', 'Agent type responsible for the invocation')
  .option('--capability <name>', 'Capability or action invoked')
  .option('--prompt-hash <hash>', 'Prompt hash or fingerprint')
  .option('--success', 'Mark invocation as successful')
  .option('--failure', 'Mark invocation as failed')
  .option('--latency <ms>', 'Execution latency in milliseconds')
  .option('--confidence <value>', 'Confidence score emitted by the agent')
  .option('--tags <tag,tag>', 'Comma separated contextual tags')
  .option('--metadata <json>', 'Additional metadata payload as JSON')
  .option('--timestamp <iso>', 'Override timestamp')
  .action(handleCommand('tools.record', async (options) => {
    const successFlag = options.failure ? false : options.success ?? true;
    const record = buildToolUsageRecord({ ...options, success: successFlag });

    await useSystem('tools record', async (system) => {
      const optimizer = new ToolOptimizer(system.getMemorySystem());
      await optimizer.recordToolOutcome(record);
      console.log(chalk.green(`✅ Tool invocation recorded for "${record.toolId}".`));
    });
  }));

toolsCmd
  .command('history')
  .description('Inspect recent tool usage telemetry')
  .option('-t, --tool <toolId>', 'Filter by tool identifier')
  .option('-a, --agent-type <agentType>', 'Filter by agent type')
  .option('-l, --limit <count>', 'Number of records to display', '10')
  .action(handleCommand('tools.history', async (options) => {
    const limit = Number.parseInt(options.limit ?? '10', 10);
    const agentType = parseAgentType(options.agentType);

    await useSystem('tools history', async (system) => {
      const records = await system.getMemorySystem().listToolUsage(limit, {
        toolId: options.tool ? String(options.tool) : undefined,
        agentType
      });

      if (!records.length) {
        console.log(chalk.gray('No tool usage records found.'));
        return;
      }

      console.log(chalk.blue('🕑 Recent Tool Usage'));
      records.forEach((record, index) => {
        console.log(chalk.cyan(`\n${index + 1}. ${record.toolId}`));
        if (record.agentType) {
          console.log(chalk.gray(`   Agent: ${record.agentType}`));
        }
        console.log(chalk.gray(`   Success: ${record.success ? 'yes' : 'no'}`));
        if (record.latencyMs !== undefined) {
          console.log(chalk.gray(`   Latency: ${record.latencyMs}ms`));
        }
        if (record.timestamp) {
          console.log(chalk.gray(`   Timestamp: ${record.timestamp}`));
        }
        if (record.contextTags?.length) {
          console.log(chalk.gray(`   Tags: ${record.contextTags.join(', ')}`));
        }
        const metrics: string[] = [];
        if (record.latencyMs !== undefined) {
          metrics.push(`${record.latencyMs}ms latency`);
        }
        if (record.confidence !== undefined) {
          metrics.push(`confidence ${(record.confidence * 100).toFixed(1)}%`);
        }
        if (metrics.length) {
          console.log(chalk.gray(`   Metrics: ${metrics.join(', ')}`));
        }
      });
    });
  }));

// Reasoning planner commands
const reasoningCmd = program.command('reasoning').description('Reasoning planner and checkpoint management');

reasoningCmd
  .command('plan')
  .argument('<prompt>', 'Reasoning prompt to analyze')
  .option('--type <type>', 'Plan type (tot|react|custom)', 'tot')
  .option('--require-consensus', 'Require consensus approval before execution')
  .option('--metadata <json>', 'Attach metadata JSON payload')
  .option('--branches <count>', 'Tree-of-Thought branch count')
  .option('--iterations <count>', 'Monte Carlo iteration count')
  .option('--seed <number>', 'Random seed for deterministic plans')
  .action(handleCommand('reasoning.plan', async (prompt: string, options) => {
    await useSystem('reasoning plan', async (system) => {
      const planOptions: ReasoningPlanOptions = {
        planType: (options.type ?? 'tot').toLowerCase() as ReasoningPlanOptions['planType'],
        requireConsensus: Boolean(options.requireConsensus),
        metadata: parseJsonOption(options.metadata),
        totConfig: {
          branches: options.branches ? parseInteger(options.branches, 'branches') : undefined,
          iterations: options.iterations ? parseInteger(options.iterations, 'iterations') : undefined,
          randomSeed: options.seed ? parseInteger(options.seed, 'seed') : undefined
        }
      };

      const result = await system.createReasoningPlan(prompt, planOptions);
      console.log(chalk.green('✅ Reasoning plan created'));
      console.log(chalk.gray(`   Plan ID: ${result.planId}`));
      console.log(chalk.gray(`   Plan Type: ${result.planType}`));
      console.log(chalk.gray(`   Status: ${result.status}`));
      if (result.consensus?.required) {
        console.log(chalk.gray(`   Consensus proposal: ${result.consensus.proposalId ?? 'pending'}`));
      }
      if (result.totPlan) {
        console.log(chalk.gray(`   Summary: ${result.totPlan.summary}`));
        console.log(chalk.gray(`   Best branch: ${result.totPlan.bestBranch.label} (score ${(result.totPlan.bestBranch.score * 100).toFixed(1)}%)`));
      }
    });
  }));

reasoningCmd
  .command('checkpoint')
  .argument('<planId>', 'Existing reasoning plan identifier')
  .requiredOption('--label <label>', 'Checkpoint label')
  .option('--status <status>', 'Checkpoint status (pending|complete|failed)', 'complete')
  .option('--summary <text>', 'Checkpoint summary text')
  .option('--metrics <json>', 'Metrics JSON payload')
  .action(handleCommand('reasoning.checkpoint', async (planId: string, options) => {
    const status = (options.status ?? 'complete').toLowerCase();
    if (!['pending', 'complete', 'failed'].includes(status)) {
      throw new Error('Checkpoint status must be pending, complete, or failed');
    }

    const checkpoint: ReasoningCheckpointInput = {
      label: options.label,
      status: status as ReasoningCheckpointInput['status'],
      summary: options.summary,
      metrics: parseJsonOption<Record<string, number>>(options.metrics)
    };

    await useSystem('reasoning checkpoint', async (system) => {
      const record = await system.checkpointReasoningPlan(planId, checkpoint);
      console.log(chalk.green(`✅ Checkpoint recorded for plan ${planId}`));
      console.log(chalk.gray(`   Total checkpoints: ${record.checkpoints?.length ?? 0}`));
      console.log(chalk.gray(`   Current status: ${record.status}`));
    });
  }));

reasoningCmd
  .command('complete')
  .argument('<planId>', 'Reasoning plan identifier')
  .option('--status <status>', 'Completion status (completed|failed|aborted)', 'completed')
  .option('--summary <text>', 'Completion summary')
  .option('--duration <ms>', 'Execution duration in milliseconds')
  .option('--metadata <json>', 'Additional metadata JSON payload')
  .action(handleCommand('reasoning.complete', async (planId: string, options) => {
    const status = (options.status ?? 'completed').toLowerCase();
    if (!['completed', 'failed', 'aborted'].includes(status)) {
      throw new Error('Completion status must be completed, failed, or aborted');
    }

    const completion: ReasoningCompletionOptions = {
      status: status as ReasoningCompletionOptions['status'],
      summary: options.summary,
      durationMs: options.duration ? parseInteger(options.duration, 'duration') : undefined,
      metadata: parseJsonOption(options.metadata)
    };

    await useSystem('reasoning complete', async (system) => {
      const record = await system.completeReasoningPlan(planId, completion);
      console.log(chalk.green(`✅ Plan ${planId} marked as ${record.status}`));
      if (record.durationMs !== undefined) {
        console.log(chalk.gray(`   Recorded duration: ${record.durationMs}ms`));
      }
    });
  }));

reasoningCmd
  .command('resume')
  .argument('<planId>', 'Reasoning plan identifier')
  .action(handleCommand('reasoning.resume', async (planId: string) => {
    await useSystem('reasoning resume', async (system) => {
      const record = await system.resumeReasoningPlan(planId);
      if (!record) {
        console.log(chalk.yellow(`⚠️  Plan ${planId} not found.`));
        return;
      }
      printReasoningRecord(record);
    });
  }));

reasoningCmd
  .command('history')
  .description('Show recent reasoning plans')
  .option('-l, --limit <count>', 'Number of plans to display', '5')
  .action(handleCommand('reasoning.history', async (options) => {
    const limit = parseInteger(options.limit ?? '5', 'limit');
    await useSystem('reasoning history', async (system) => {
      const records = await system.listReasoningPlans(limit);
      if (!records.length) {
        console.log(chalk.gray('No reasoning plans recorded yet.'));
        return;
      }
      records.forEach((record, index) => {
        console.log(chalk.cyan(`\n${index + 1}. ${record.planId}`));
        printReasoningRecord(record);
      });
    });
  }));

function printReasoningRecord(record: ReasoningRunRecord): void {
  console.log(chalk.gray(`   Type: ${record.planType}`));
  console.log(chalk.gray(`   Status: ${record.status}`));
  if (record.confidence !== undefined) {
    console.log(chalk.gray(`   Confidence: ${(record.confidence * 100).toFixed(1)}%`));
  }
  if (record.bestBranch) {
    console.log(chalk.gray(`   Best branch: ${record.bestBranch}`));
  }
  if (record.validation?.consensusProposalId) {
    const acceptedLabel = record.validation.consensusAccepted === undefined
      ? 'pending'
      : record.validation.consensusAccepted
        ? 'accepted'
        : 'rejected';
    console.log(
      chalk.gray(
        `   Consensus: ${record.validation.consensusProposalId} (${acceptedLabel})`
      )
    );
  }
  if (record.durationMs !== undefined) {
    console.log(chalk.gray(`   Duration: ${record.durationMs}ms`));
  }
  console.log(chalk.gray(`   Updated: ${record.timestamp ?? 'n/a'}`));
  if (record.checkpoints?.length) {
    console.log(chalk.gray(`   Checkpoints (${record.checkpoints.length}):`));
    record.checkpoints.slice(-3).forEach((cp) => {
      console.log(chalk.gray(`     • ${cp.label} [${cp.status}] @ ${cp.timestamp}`));
    });
  }
}

const cheatCodeLibrary: Record<string, { description: string; prompt: string; useCodex?: boolean }> = {
  'hive-plan': {
    description: 'Spawn a Tree-of-Thought hive-mind run focused on repository improvement',
    prompt:
      'codex-synaptic hive-mind spawn --codex "Run a ToT-guided ReAcT loop to inspect health, refactor, and document the repository"',
    useCodex: true
  },
  'swarm-profiler': {
    description: 'Start swarm optimization for performance telemetry and heuristics',
    prompt: 'codex-synaptic swarm start --algorithm pso --objective latency --objective throughput'
  },
  'consensus-audit': {
    description: 'List recent consensus decisions and highlight rejected proposals',
    prompt: 'codex-synaptic consensus telemetry --limit 5'
  },
  'observability-bootstrap': {
    description: 'Generate observability dashboard template and export latest metrics snapshot',
    prompt: 'codex-synaptic observability template && npm run export:metrics -- --limit 100'
  }
};

// Router commands
const routerCmd = program.command('router').description('Routing policy management and evaluation');

routerCmd
  .command('evaluate')
  .argument('<prompt>', 'Prompt to evaluate for routing')
  .description('Evaluate routing for a given prompt')
  .option('-c, --context <file>', 'Context file to include (YAML or JSON)')
  .option('-e, --exclude <agents>', 'Comma-separated list of agents to exclude')
  .option('-p, --prefer <agents>', 'Comma-separated list of preferred agents')
  .option('--tools <file>', 'Tool candidate JSON file for optimizer recommendations')
  .option('--tool-prompt <prompt>', 'Override prompt used for tool scoring')
  .option('-v, --verbose', 'Show detailed evaluation information')
  .action(handleCommand('router.evaluate', async (prompt, options) => {
    await useSystem('router evaluate', async (system) => {
      const router = new RoutingPolicyService(undefined, {
        toolOptimizer: system.getToolOptimizer()
      });

      try {
        console.log(chalk.cyan('🔄 Evaluating routing for prompt...'));

        const toolCandidates = options.tools ? loadToolCandidates(options.tools) : undefined;
        const request = {
          prompt,
          toolPrompt: options.toolPrompt ? String(options.toolPrompt) : undefined,
          toolCandidates,
          context: options.context
            ? {
                fileContext: JSON.stringify(parseFileContent(options.context))
              }
            : undefined,
          constraints: {
            excludeAgents: options.exclude ? options.exclude.split(',').map((s: string) => s.trim()) : undefined,
            preferredAgents: options.prefer ? options.prefer.split(',').map((s: string) => s.trim()) : undefined
          }
        } as RoutingRequest;

        const evaluation = await router.evaluateRouting(request);

        console.log(chalk.green(`✅ Routing evaluation completed`));
        console.log(`🎯 Recommended agent: ${chalk.bold(evaluation.agentType)}`);
        console.log(`📊 Confidence: ${(evaluation.confidence * 100).toFixed(1)}%`);
        console.log(`💭 Reasoning: ${evaluation.reasoning}`);

        if (evaluation.toolRecommendations?.length) {
          console.log(chalk.gray('\n🛠 Tool Recommendations:'));
          evaluation.toolRecommendations.slice(0, 5).forEach((score, index) => {
            console.log(
              chalk.gray(
                `  ${index + 1}. ${score.toolId} – score ${(score.score * 100).toFixed(1)}%, confidence ${(score.confidence * 100).toFixed(1)}%`
              )
            );
          });
        }

        if (options.verbose) {
          console.log(`\n📋 Evaluation Details:`);
          console.log(`  • Evaluation ID: ${evaluation.metadata.evaluationId.slice(0, 12)}...`);
          console.log(`  • Processing time: ${evaluation.metadata.processingTimeMs}ms`);
          console.log(`  • Rules applied: ${evaluation.metadata.rulesApplied.length}`);

          if (evaluation.alternatives.length > 0) {
            console.log(`\n🔄 Alternatives:`);
            evaluation.alternatives.forEach((alt, i) => {
              console.log(`  ${i + 1}. ${alt.agentType} (${(alt.confidence * 100).toFixed(1)}%) - ${alt.reasoning}`);
            });
          }
        }
      } catch (error) {
        console.error(chalk.red(`❌ Routing evaluation failed: ${error}`));
        process.exitCode = 1;
      }
    });
  }));

routerCmd
  .command('rules')
  .description('Manage routing rules')
  .option('-l, --list', 'List all routing rules')
  .option('-a, --add <file>', 'Add rule from YAML or JSON file')
  .option('-d, --delete <id>', 'Delete rule by ID')
  .option('-e, --enable <id>', 'Enable rule by ID')
  .option('-x, --disable <id>', 'Disable rule by ID')
  .option('-v, --verbose', 'Show detailed rule information')
  .action(handleCommand('router.rules', async (options) => {
    const router = new RoutingPolicyService();
    try {
      if (options.list) {
        const rules = router.getAllRules();
        console.log(chalk.cyan(`📋 Routing Rules (${rules.length} total):`));
        
        if (rules.length === 0) {
          console.log(chalk.gray('  No rules configured'));
          return;
        }
        
        rules.forEach(rule => {
          const status = rule.metadata.enabled ? chalk.green('✓') : chalk.red('✗');
          console.log(`  ${status} ${chalk.bold(rule.name)} (${rule.id})`);
          console.log(`    Precedence: ${rule.precedence}, Confidence: ${(rule.confidence * 100).toFixed(1)}%`);
          console.log(`    Target: ${rule.target}, Description: ${rule.description}`);
          
          if (options.verbose) {
            console.log(`    Keywords: ${rule.conditions.keywords?.join(', ') || 'none'}`);
            console.log(`    Patterns: ${rule.conditions.patterns?.join(', ') || 'none'}`);
            console.log(`    Created: ${rule.metadata.created.toISOString()}`);
          }
          console.log('');
        });
      } else if (options.add) {
        const ruleData = parseFileContent(options.add);
        const rule = await router.addRule(ruleData);
        console.log(chalk.green(`✅ Rule added: ${rule.name} (${rule.id})`));
      } else if (options.delete) {
        const deleted = await router.deleteRule(options.delete);
        if (deleted) {
          console.log(chalk.green(`✅ Rule deleted: ${options.delete}`));
        } else {
          console.log(chalk.yellow(`⚠️  Rule not found: ${options.delete}`));
        }
      } else if (options.enable) {
        const rule = await router.updateRule(options.enable, { 
          metadata: { enabled: true } as any 
        });
        if (rule) {
          console.log(chalk.green(`✅ Rule enabled: ${rule.name}`));
        } else {
          console.log(chalk.yellow(`⚠️  Rule not found: ${options.enable}`));
        }
      } else if (options.disable) {
        const rule = await router.updateRule(options.disable, { 
          metadata: { enabled: false } as any 
        });
        if (rule) {
          console.log(chalk.yellow(`⚠️  Rule disabled: ${rule.name}`));
        } else {
          console.log(chalk.yellow(`⚠️  Rule not found: ${options.disable}`));
        }
      } else {
        console.log(chalk.yellow('⚠️  Please specify an action: --list, --add, --delete, --enable, or --disable'));
      }
    } catch (error) {
      console.error(chalk.red(`❌ Router operation failed: ${error}`));
      process.exitCode = 1;
    }
  }));

routerCmd
  .command('history')
  .description('Show routing evaluation history')
  .option('-l, --limit <count>', 'Number of entries to show', '10')
  .option('-v, --verbose', 'Show detailed evaluation information')
  .action(handleCommand('router.history', async (options) => {
    const router = new RoutingPolicyService();
    try {
      const limit = parseInt(options.limit);
      const history = router.getEvaluationHistory(limit);
      
      console.log(chalk.cyan(`📊 Routing History (last ${history.length} evaluations):`));
      
      if (history.length === 0) {
        console.log(chalk.gray('  No evaluation history found'));
        return;
      }
      
      history.forEach((evaluation, i) => {
        const timestamp = evaluation.metadata.timestamp.toLocaleString();
        console.log(`\n${i + 1}. ${chalk.bold(evaluation.agentType)} (${timestamp})`);
        console.log(`   Confidence: ${(evaluation.confidence * 100).toFixed(1)}%`);
        console.log(`   Reasoning: ${evaluation.reasoning}`);
        
        if (options.verbose) {
          console.log(`   Evaluation ID: ${evaluation.metadata.evaluationId.slice(0, 12)}...`);
          console.log(`   Processing time: ${evaluation.metadata.processingTimeMs}ms`);
          console.log(`   Rules applied: ${evaluation.metadata.rulesApplied.join(', ') || 'none'}`);
          if (evaluation.alternatives.length > 0) {
            console.log(`   Alternatives: ${evaluation.alternatives.map(a => a.agentType).join(', ')}`);
          }
        }
      });
    } catch (error) {
      console.error(chalk.red(`❌ Failed to retrieve history: ${error}`));
      process.exitCode = 1;
    }
  }));

// Agent commands
const agentCmd = program.command('agent').description('Agent management commands');

agentCmd
  .command('list')
  .description('List all registered agents')
  .action(handleCommand('agent.list', async () => {
    await useSystem('agent list', async (system) => {
      const agents = system.getAgentRegistry().getAllAgents();
      renderAgentTable(agents);
    });
  }));

agentCmd
  .command('deploy')
  .description('Deploy new agents of a given type')
  .option('-t, --type <type>', 'Agent type')
  .option('-r, --replicas <count>', 'Number of replicas', '1')
  .action(handleCommand('agent.deploy', async (options) => {
    await useSystem('agent deploy', async (system) => {
      let agentType = options.type as AgentType;
      if (!agentType || !Object.values(AgentType).includes(agentType)) {
        const answer = await inquirer.prompt([
          {
            type: 'list',
            name: 'type',
            message: 'Select agent type:',
            choices: Object.values(AgentType)
          }
        ]);
        agentType = answer.type;
      }

      const replicas = parseInteger(options.replicas, 'replicas');
      await system.deployAgent(agentType, replicas);
      console.log(chalk.green(`✅ Deployed ${replicas} ${agentType} agent(s).`));
    });
  }));

agentCmd
  .command('status <agentId>')
  .description('Show status for a specific agent id')
  .action(handleCommand('agent.status', async (agentId: string) => {
    await useSystem('agent status', async (system) => {
      const agent = system.getAgentRegistry().getAgentByStringId(agentId);
      if (!agent) {
        console.log(chalk.red(`Agent ${agentId} not found.`));
        return;
      }

      console.log(chalk.blue(`👤 Agent ${agentId}`));
      console.log(`  Type: ${agent.id.type}`);
      console.log(`  Status: ${agent.status}`);
      console.log(`  Capabilities: ${agent.capabilities.map((cap) => cap.name).join(', ')}`);
      console.log(`  Resources: CPU ${agent.resources.cpu} | RAM ${agent.resources.memory}MB`);
      console.log(`  Last Updated: ${agent.lastUpdated.toISOString()}`);
    });
  }));

// Mesh commands
const meshCmd = program.command('mesh').description('Neural mesh management');

meshCmd
  .command('configure')
  .description('Configure the neural mesh topology')
  .option('-n, --nodes <count>', 'Desired node count', '5')
  .option('-t, --topology <type>', 'Topology type', 'mesh')
  .option('-c, --connections <count>', 'Max connections per node', '5')
  .action(handleCommand('mesh.configure', async (options) => {
    await useSystem('mesh configure', async (system) => {
      await system.createNeuralMesh(options.topology, parseInteger(options.nodes, 'nodes'));
      if (options.connections) {
        system.getNeuralMesh().configure({ maxConnections: parseInteger(options.connections, 'connections') });
      }
      console.log(chalk.green('✅ Neural mesh configuration applied.'));
      renderMeshStatus(system.getNeuralMesh().getStatus());
    });
  }));

meshCmd
  .command('status')
  .description('Show neural mesh status')
  .action(handleCommand('mesh.status', async () => {
    await useSystem('mesh status', async (system) => {
      renderMeshStatus(system.getNeuralMesh().getStatus());
    });
  }));

// Swarm commands
const swarmCmd = program.command('swarm').description('Swarm coordination commands');

swarmCmd
  .command('start')
  .description('Start swarm coordination with a specific algorithm')
  .option('-a, --algorithm <type>', 'Algorithm type', 'pso')
  .option('-o, --objective <value...>', 'Optimization objectives (repeatable)')
  .action(handleCommand('swarm.start', async (options) => {
    await useSystem('swarm start', async (system) => {
      const objectives = Array.isArray(options.objective) ? options.objective : (options.objective ? [options.objective] : []);
      await system.startSwarm(options.algorithm, objectives);
      console.log(chalk.green('✅ Swarm coordination started.'));
      renderSwarmStatus(system.getSwarmCoordinator().getStatus());
    });
  }));

swarmCmd
  .command('stop')
  .description('Stop swarm coordination')
  .action(handleCommand('swarm.stop', async () => {
    await useSystem('swarm stop', async (system) => {
      system.getSwarmCoordinator().stopSwarm();
      console.log(chalk.green('✅ Swarm coordination stopped.'));
    });
  }));

swarmCmd
  .command('status')
  .description('Show swarm status')
  .action(handleCommand('swarm.status', async () => {
    await useSystem('swarm status', async (system) => {
      renderSwarmStatus(system.getSwarmCoordinator().getStatus());
    });
  }));

// Bridge commands
const bridgeCmd = program.command('bridge').description('Bridge management');

bridgeCmd
  .command('mcp-send')
  .description('Send a message over the MCP bridge')
  .requiredOption('-e, --endpoint <endpoint>', 'Registered MCP endpoint')
  .requiredOption('-p, --payload <json>', 'JSON payload to send')
  .action(handleCommand('bridge.mcp.send', async (options) => {
    await useSystem('mcp send', async (system) => {
      const payload = parseJsonInput(options.payload, 'payload');
      const response = await system.sendMcpMessage(options.endpoint, payload);
      console.log(chalk.green('✅ MCP message delivered. Response:'));
      console.log(JSON.stringify(response, null, 2));
    });
  }));

bridgeCmd
  .command('a2a-send <targetId>')
  .description('Dispatch an A2A message to a target agent')
  .requiredOption('-m, --message <json>', 'Message payload JSON')
  .option('-f, --from <agentId>', 'Optional sending agent id')
  .action(handleCommand('bridge.a2a.send', async (targetId: string, options) => {
    await useSystem('a2a send', async (system) => {
      const payload = parseJsonInput(options.message, 'message');
      const sender = options.from ? system.getAgentRegistry().getAgentByStringId(options.from)?.id : undefined;
      await system.sendA2AMessage(targetId, payload, sender);
      console.log(chalk.green(`✅ A2A message sent to ${targetId}.`));
    });
  }));

// Consensus commands
const consensusCmd = program.command('consensus').description('Consensus management commands');

consensusCmd
  .command('propose')
  .description('Create a consensus proposal')
  .argument('<type>', 'Proposal type')
  .argument('<data>', 'Proposal data JSON')
  .option('-p, --proposer <agentId>', 'Override proposer agent id')
  .action(handleCommand('consensus.propose', async (type: string, data: string, options) => {
    await useSystem('consensus propose', async (system) => {
      const payload = parseJsonInput(data, 'data');
      const proposer = options.proposer
        ? system.getAgentRegistry().getAgentByStringId(options.proposer)?.id
        : undefined;
      const proposalId = await system.proposeConsensus(type, payload, proposer);
      console.log(chalk.green(`✅ Consensus proposal created: ${proposalId}`));
    });
  }));

consensusCmd
  .command('vote')
  .description('Submit a vote for a proposal')
  .argument('<proposalId>', 'Proposal ID')
  .argument('<vote>', 'Vote (yes/no)')
  .option('-v, --voter <agentId>', 'Override voter agent id')
  .action(handleCommand('consensus.vote', async (proposalId: string, vote: string, options) => {
    await useSystem('consensus vote', async (system) => {
      const normalized = vote.toLowerCase();
      if (!['yes', 'no'].includes(normalized)) {
        throw new Error('Vote must be "yes" or "no"');
      }
      const voter = options.voter
        ? system.getAgentRegistry().getAgentByStringId(options.voter)?.id
        : undefined;
      system.submitConsensusVote(proposalId, normalized === 'yes', voter);
      console.log(chalk.green('✅ Vote submitted.'));
    });
  }));

consensusCmd
  .command('status')
  .description('Show consensus manager status')
  .action(handleCommand('consensus.status', async () => {
    await useSystem('consensus status', async (system) => {
      renderConsensusStatus(system);
    });
  }));

consensusCmd
  .command('telemetry')
  .description('Show recent consensus telemetry from memory')
  .option('--limit <count>', 'Number of entries to display', '5')
  .action(handleCommand('consensus.telemetry', async (options) => {
    const limit = parseInteger(options.limit ?? '5', 'limit');
    await useSystem('consensus telemetry', async (system) => {
      const entries = await system.getMemorySystem().list('consensus_events', limit);
      if (!entries.length) {
        console.log(chalk.gray('No consensus telemetry recorded yet.'));
        return;
      }
      console.log(chalk.blue('🗳️ Consensus Telemetry'));
      entries.forEach((entry, idx) => {
        const data = entry.data ?? {};
        console.log(chalk.cyan(`\n${idx + 1}. ${entry.key}`));
        console.log(chalk.gray(`   Finalized: ${data.finalizedAt ?? entry.timestamp}`));
        console.log(chalk.gray(`   Mechanism: ${data.mechanism ?? 'unknown'}`));
        console.log(chalk.gray(`   Accepted: ${data.accepted ? 'yes' : 'no'}`));
        if (data.requiredVotes) {
          console.log(chalk.gray(`   Required votes: ${data.requiredVotes}`));
        }
      });
    });
  }));

consensusCmd
  .command('stake')
  .description('Stake table management')
  .option('--set <agentId=stake...>', 'Set stake values, e.g., agent-1=2,agent-2=1')
  .option('--clear', 'Clear the stake table')
  .action(handleCommand('consensus.stake', async (options) => {
    await useSystem('consensus stake', async (system) => {
      const configManager = system.getConfigManager();
      const current = configManager.getConsensusConfig();
      const stakeTable = { ...(current.stakeTable ?? {}) };

      if (options.clear) {
        const nextConfig = { ...current, stakeTable: {} } satisfies SystemConfiguration['consensus'];
        configManager.update({ consensus: nextConfig });
        system.getConsensusManager().updateConfig(nextConfig);
        console.log(chalk.green('✅ Stake table cleared.'));
        return;
      }

      if (options.set) {
        const entries = String(options.set).split(',').map((pair: string) => pair.trim()).filter(Boolean);
        for (const entry of entries) {
          const [agentId, stakeStr] = entry.split('=').map((segment) => segment.trim());
          const stake = Number(stakeStr);
          if (!agentId || Number.isNaN(stake)) {
            throw new Error(`Invalid stake entry "${entry}". Expected format agentId=stake.`);
          }
          stakeTable[agentId] = stake;
        }
        const nextConfig = { ...current, stakeTable } satisfies SystemConfiguration['consensus'];
        configManager.update({ consensus: nextConfig });
        system.getConsensusManager().updateConfig(nextConfig);
        console.log(chalk.green('✅ Stake table updated.'));
      }

      console.log(chalk.blue('Current stake table:'));
      const table = Object.entries(configManager.getConsensusConfig().stakeTable ?? {});
      if (!table.length) {
        console.log(chalk.gray('  (empty)'));
      } else {
        table.forEach(([agentId, stake]) => {
          console.log(chalk.white(`  ${agentId}: ${stake}`));
        });
      }
    });
  }));

consensusCmd
  .command('mode')
  .description('Inspect or change consensus mechanism settings')
  .option('--set <mechanism>', 'Switch mechanism (raft|bft|pow|pos|hybrid)')
  .option('--timeout <ms>', 'Override consensus timeout in ms')
  .option('--quorum <factor>', 'Override quorum factor (0-1)')
  .option('--fault-tolerance <f>', 'Set BFT fault tolerance (integer)')
  .option('--stake-threshold <value>', 'Set PoS stake threshold (0-1)')
  .action(handleCommand('consensus.mode', async (options) => {
    await useSystem('consensus mode', async (system) => {
      const configManager = system.getConfigManager();
      const current = configManager.getConsensusConfig();
      const consensusUpdates: Partial<SystemConfiguration['consensus']> = {};
      if (options.set) {
        consensusUpdates.mechanism = options.set as SystemConfiguration['consensus']['mechanism'];
      }
      if (options.timeout) {
        consensusUpdates.timeout = parseInteger(options.timeout, 'timeout');
      }
      if (options.quorum) {
        consensusUpdates.quorumFactor = Number(options.quorum);
      }
      if (options['fault-tolerance']) {
        consensusUpdates.faultTolerance = parseInteger(options['fault-tolerance'], 'fault tolerance');
      }
      if (options['stake-threshold']) {
        consensusUpdates.stakeThreshold = Number(options['stake-threshold']);
      }

      if (Object.keys(consensusUpdates).length) {
        const nextConfig = { ...current, ...consensusUpdates } satisfies SystemConfiguration['consensus'];
        configManager.update({ consensus: nextConfig });
        system.getConsensusManager().updateConfig(nextConfig);
        console.log(chalk.green('✅ Consensus configuration updated.'));
      }

      const refreshed = configManager.getConsensusConfig();
      console.log(chalk.blue('Current consensus config:'));
      console.log(JSON.stringify(refreshed, null, 2));
    });
  }));

// Task commands
const taskCmd = program.command('task').description('Workflow and task management');

taskCmd
  .command('submit')
  .description('Submit a natural-language workflow prompt for execution')
  .argument('<prompt...>', 'Prompt describing the workflow')
  .option('-s, --silent', 'Skip final artifact dump')
  .action(handleCommand('task.submit', async (promptParts: string[], options) => {
    const prompt = promptParts.join(' ').trim();
    if (!prompt) {
      throw new Error('Prompt cannot be empty');
    }

    await useSystem('task submit', async (system) => {
      console.log(chalk.blue('🧩 Executing workflow...'));
      const onStageStarted = (event: any) => {
        console.log(chalk.gray(`  ▶ Stage ${event.label} (${event.taskType}) started.`));
      };
      const onStageCompleted = (event: any) => {
        console.log(chalk.cyan(`  ✔ Stage ${event.label} (${event.taskId}) completed.`));
        if (event.result?.summary) {
          console.log(chalk.gray(`    Summary: ${event.result.summary}`));
        }
      };
      const onStageFailed = (event: any) => {
        console.log(chalk.red(`  ✖ Stage ${event.label} failed: ${event.error}`));
      };
      system.on('workflowStageStarted', onStageStarted);
      system.on('workflowStageCompleted', onStageCompleted);
      system.on('workflowStageFailed', onStageFailed);
      try {
        const outcome = await system.executeTask(prompt);
        console.log(chalk.green('✅ Workflow complete.'));
        if (!options.silent) {
          console.log(JSON.stringify(outcome, null, 2));
        }
      } finally {
        system.off('workflowStageStarted', onStageStarted);
        system.off('workflowStageCompleted', onStageCompleted);
        system.off('workflowStageFailed', onStageFailed);
      }
    });
  }));

taskCmd
  .command('recent')
  .description('Show recent task outcomes from this session')
  .action(handleCommand('task.recent', async () => {
    const snapshot = session.getTelemetry();
    if (!snapshot.recentTasks.length) {
      console.log(chalk.gray('No tasks executed yet in this session.'));
      return;
    }
    console.log(chalk.blue('🗂 Recent tasks')); 
    for (const item of snapshot.recentTasks) {
      console.log(`  • ${item.id} [${item.status}] — ${item.summary}`);
    }
  }));

// Hive-mind commands (leveraging existing workflow orchestration)
const hiveMindCmd = program.command('hive-mind').description('Hive-mind coordination and spawning');

hiveMindCmd
  .command('spawn')
  .description('Spawn a coordinated hive-mind workflow from a prompt')
  .argument('<prompt...>', 'Natural language description of the task/goal')
  .option('--codex', 'Augment the prompt with Codex context from AGENTS.md, README, and local artifacts')
  .option('--agents <count>', 'Number of agents to target', '5')
  .option('--max-agents <count>', 'Maximum number of agents allowed', '10')
  .option('--max-workers <count>', 'Maximum worker agents', '7')
  .option('--algorithm <type>', 'Swarm algorithm (pso|aco|flocking|hybrid)', 'pso')
  .option('--mesh-topology <type>', 'Mesh topology (mesh|ring|star|hierarchical)', 'mesh')
  .option('--consensus <type>', 'Consensus mechanism (raft|byzantine)', 'byzantine')
  .option('--priority <level>', 'Task priority (1-10)', '7')
  .option('--timeout <seconds>', 'Timeout in seconds', '600')
  .option('--auto-scale', 'Enable auto-scaling based on workload')
  .option('--queen-coordinator', 'Deploy dedicated queen coordinator')
  .option('--fault-tolerance', 'Enable fault-tolerant operation')
  .option('--mcp', 'Enable MCP bridge connections')
  .option('--debug', 'Enable debug logging')
  .option('--dry-run', 'Preview Codex context without executing the hive-mind spawn')
  .option('--yaml', 'Output results in YAML format (default: JSON)')
  .action(handleCommand('hive-mind.spawn', async (promptParts: string[], options) => {
    let prompt = promptParts.join(' ').trim();
    if (!prompt) {
      throw new Error('Prompt cannot be empty');
    }

    const autoAttachCodex = shouldAutoAttachCodexContext(prompt);
    const codexRequested = options.codex || autoAttachCodex;

    if (options.dryRun && !codexRequested) {
      throw new Error('--dry-run can only be used together with --codex');
    }

    const originalPrompt = prompt;
    let codexContext: CodexContext | undefined;
    let codexMetadata: CodexContextAggregationMetadata | undefined;
    let codexEnvelope: CodexPromptEnvelope | undefined;

    if (autoAttachCodex) {
      console.log(
        chalk.cyan('📚 Auto-attaching Codex context based on workflow prompt signals.')
      );
    }

    if (codexRequested) {
      const builder = new CodexContextBuilder(process.cwd());
      await builder.withAgentDirectives();
      await builder.withReadmeExcerpts();
      await builder.withDirectoryInventory();
      await builder.withDatabaseMetadata();
      const buildResult: CodexContextBuildResult = await builder.build();

      codexContext = buildResult.context;
      codexMetadata = buildResult.metadata;

      emitContextLogs(buildResult.logs);
      emitContextSummary(buildResult.context, buildResult.metadata);

      const contextBlock = renderCodexContextBlock(buildResult.context);
      const enrichedPrompt = composePromptWithContext(originalPrompt, buildResult.context);

      codexEnvelope = {
        originalPrompt,
        enrichedPrompt,
        contextBlock
      };

      if (options.dryRun) {
        console.log(chalk.yellow('⚙️  Dry-run: Codex context ready. Skipping hive-mind orchestration.'));
        console.log('');
        console.log(chalk.gray(contextBlock));
        return;
      }

      prompt = enrichedPrompt;
      console.log(chalk.cyan('📚 Codex context attached to hive-mind prompt.'));
    }

    const config = {
      agents: parseInteger(options.agents, 'agents'),
      maxAgents: options.maxAgents ? parseInteger(options.maxAgents, 'maxAgents') : 10,
      maxWorkers: options.maxWorkers ? parseInteger(options.maxWorkers, 'maxWorkers') : 7,
      algorithm: options.algorithm,
      meshTopology: options.meshTopology || 'mesh',
      consensus: options.consensus,
      priority: options.priority ? parseInteger(options.priority, 'priority') : 7,
      timeout: options.timeout ? parseInteger(options.timeout, 'timeout') * 1000 : 600000,
      autoScale: !!options.autoScale,
      queenCoordinator: !!options.queenCoordinator,
      faultTolerance: !!options.faultTolerance,
      mcp: !!options.mcp,
      debug: !!options.debug,
      codex: codexContext
        ? {
            enabled: true,
            contextHash: codexContext.contextHash,
            sizeBytes: codexContext.sizeBytes,
            agentGuides: codexMetadata?.agentGuideCount ?? 0,
            directories: codexMetadata?.codexDirectoryCount ?? 0,
            databases: codexMetadata?.databaseCount ?? 0
          }
        : { enabled: false }
    };

    await useSystem('hive-mind spawn', async (system) => {
      console.log(chalk.blue('🧠 Initializing hive-mind orchestration...'));
      console.log(chalk.gray(`Configuration: ${JSON.stringify(config, null, 2)}`));

      if (codexContext && codexEnvelope) {
        await primeCodexWithRetry(system, codexContext, codexEnvelope);
      }

      // Phase 1: Infrastructure Setup
      console.log(chalk.cyan('📡 Phase 1: Infrastructure Setup'));
      
      // Configure neural mesh topology
      await system.createNeuralMesh(config.meshTopology, config.agents);
      console.log(chalk.green(`  ✓ Neural mesh configured (${config.meshTopology}, ${config.agents} nodes)`));

      // Deploy coordinators first
      if (config.queenCoordinator) {
        await system.deployAgent(AgentType.SWARM_COORDINATOR, 1);
        await system.deployAgent(AgentType.TOPOLOGY_COORDINATOR, 1);
        console.log(chalk.green('  ✓ Queen coordinator deployed'));
      }

      // Deploy consensus coordinators
      await system.deployAgent(AgentType.CONSENSUS_COORDINATOR, 1);
      console.log(chalk.green(`  ✓ Consensus coordinator deployed (${config.consensus})`));

      // Phase 2: Agent Deployment
      console.log(chalk.cyan('🤖 Phase 2: Agent Deployment'));
      
      // Calculate optimal worker distribution with specialised roles
      const workerTypes: AgentType[] = [
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

      const workerBudget = Math.min(config.maxWorkers, Math.max(config.agents - 3, 0));
      const deploymentPlan = new Map<AgentType, number>();

      for (let i = 0; i < workerTypes.length && i < workerBudget; i += 1) {
        deploymentPlan.set(workerTypes[i], (deploymentPlan.get(workerTypes[i]) ?? 0) + 1);
      }

      let remainingWorkers = workerBudget - Math.min(workerTypes.length, workerBudget);
      const reinforcementOrder: AgentType[] = [
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

      let reinforcementIndex = 0;
      while (remainingWorkers > 0) {
        const type = reinforcementOrder[reinforcementIndex % reinforcementOrder.length];
        deploymentPlan.set(type, (deploymentPlan.get(type) ?? 0) + 1);
        remainingWorkers -= 1;
        reinforcementIndex += 1;
      }

      for (const [workerType, count] of deploymentPlan.entries()) {
        if (count > 0) {
          await system.deployAgent(workerType, count);
          console.log(chalk.green(`  ✓ Deployed ${count} ${workerType} agents`));
        }
      }

      // Phase 3: Bridge Configuration
      if (config.mcp) {
        console.log(chalk.cyan('🌉 Phase 3: Bridge Configuration'));
        await system.deployAgent(AgentType.MCP_BRIDGE, 1);
        await system.deployAgent(AgentType.A2A_BRIDGE, 1);
        console.log(chalk.green('  ✓ MCP and A2A bridges activated'));
      }

      // Phase 4: Swarm Activation
      console.log(chalk.cyan('🐝 Phase 4: Swarm Activation'));
      
      const objectives = ['code_quality', 'execution_speed', 'resource_efficiency'];
      if (config.faultTolerance) {
        objectives.push('fault_tolerance');
      }
      
      await system.startSwarm(config.algorithm, objectives);
      console.log(chalk.green(`  ✓ Swarm activated (${config.algorithm}, objectives: ${objectives.join(', ')})`));

      // Phase 5: Task Execution
      console.log(chalk.cyan('⚡ Phase 5: Task Execution'));
      console.log(chalk.blue(`Executing: "${prompt}"`));

      const startTime = Date.now();
      let consensusResult: ConsensusExecutionResult = { performed: false };

      const onStageStarted = (event: any) => {
        console.log(chalk.gray(`    ▶ ${event.label} started (${event.taskType})`));
      };
      const onStageCompleted = (event: any) => {
        const elapsed = Date.now() - startTime;
        console.log(chalk.green(`    ✓ ${event.label} completed (+${elapsed}ms)`));
      };
      const onStageFailed = (event: any) => {
        console.log(chalk.red(`    ✗ ${event.label} failed: ${event.error}`));
      };

      system.on('workflowStageStarted', onStageStarted);
      system.on('workflowStageCompleted', onStageCompleted);
      system.on('workflowStageFailed', onStageFailed);

      try {
        const outcome: any = await Promise.race([
          system.executeTask(prompt),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Hive-mind execution timeout')), config.timeout))
        ]);

        const consensusNeeded = shouldRequireConsensus(originalPrompt, config.consensus);
        if (consensusNeeded) {
          consensusResult = await orchestrateConsensus(system, originalPrompt, outcome);
        }

        const totalTime = Date.now() - startTime;
        console.log(chalk.green(`\n🎉 Hive-mind execution completed in ${totalTime}ms`));
        
        // Collect system status information
        const swarmStatus = system.getSwarmCoordinator().getStatus();
        const meshStatus = system.getNeuralMesh().getStatus();
        const agentRegistry = system.getAgentRegistry().getStatus();
        
        // Prepare comprehensive result data
        const reactPlanArtifact = (outcome as any).artifacts?.reactPlan ?? null;
        const totPlan = reactPlanArtifact?.tot ?? null;

        const resultData = {
          executionId: `exec-${Date.now()}`,
          status: 'completed',
          duration: totalTime,
          originalPrompt,
          summary: (outcome as any).summary,
          artifacts: (outcome as any).artifacts || {},
          stages: (outcome as any).stages || [],
          agentCount: agentRegistry.totalAgents,
          taskCount: (outcome as any).stages?.length || 0,
          meshStatus: {
            nodeCount: meshStatus.nodeCount,
            connectionCount: meshStatus.connectionCount
          },
          consensusStatus: {
            performed: consensusResult.performed,
            proposalId: consensusResult.proposalId,
            accepted: consensusResult.accepted,
            votes: consensusResult.votes,
            timedOut: consensusResult.timedOut,
            error: consensusResult.error
          },
          swarmStatus: {
            algorithm: swarmStatus.algorithm,
            isOptimizing: swarmStatus.isOptimizing
          },
          totPlan,
          codexContext: codexContext ? {
            enabled: true,
            contextHash: codexContext.contextHash,
            sizeBytes: codexContext.sizeBytes
          } : { enabled: false }
        };

        // Output results based on format preference
        if (options.yaml) {
          console.log(chalk.blue('\n📋 Results (YAML format):'));
          const yamlOutput = HiveMindYamlFormatter.formatExecutionResult(resultData);
          console.log(yamlOutput);
        } else {
          // Display comprehensive results in human-readable format
          console.log(chalk.blue('\n📊 Execution Summary'));
          console.log(chalk.white('Summary:'), (outcome as any).summary);
          
          if ((outcome as any).artifacts?.code) {
            console.log(chalk.blue('\n💻 Generated Code Artifacts:'));
            console.log(chalk.gray((outcome as any).artifacts.code.substring(0, 500) + '...'));
          }
          
          if (reactPlanArtifact?.tot) {
            const plan = reactPlanArtifact.tot;
            const bestMean = plan.monteCarlo.branchMeans?.[plan.bestBranch.id] ?? plan.bestBranch.score;
            const bestPercent = typeof bestMean === 'number' ? (bestMean * 100).toFixed(1) : 'n/a';
            console.log(chalk.blue('\n🌳 Tree-of-Thought Summary:'));
            console.log(chalk.white(`  Best Branch: ${plan.bestBranch.label} (${bestPercent}% confidence)`));
            console.log(chalk.white(`  Monte Carlo Samples: ${plan.monteCarlo.totalSamples}`));
            console.log(chalk.gray('  Priority Backlog:'));
            plan.priorityBacklog.slice(0, 5).forEach((item: string, idx: number) => {
              console.log(chalk.gray(`    ${idx + 1}. ${item}`));
            });
            console.log(chalk.gray('  Verification Suite:'));
            plan.verificationSuite.slice(0, 5).forEach((item: string, idx: number) => {
              console.log(chalk.gray(`    ${idx + 1}. ${item}`));
            });
            if (Array.isArray(plan.knowledgeUpdates) && plan.knowledgeUpdates.length) {
              console.log(chalk.gray('  Knowledge Updates:'));
              plan.knowledgeUpdates.slice(0, 5).forEach((item: string, idx: number) => {
                console.log(chalk.gray(`    ${idx + 1}. ${item}`));
              });
            }
          }

          if ((outcome as any).stages && Array.isArray((outcome as any).stages)) {
            console.log(chalk.blue('\n🔄 Stage Results:'));
            (outcome as any).stages.forEach((stage: any, idx: number) => {
              console.log(chalk.cyan(`  ${idx + 1}. ${stage.stage} (${stage.taskId})`));
              if (stage.result?.summary) {
                console.log(chalk.gray(`     ${stage.result.summary}`));
              }
            });
          }

          // System metrics
          console.log(chalk.blue('\n📈 System Metrics:'));
          console.log(chalk.white(`  Agents: ${agentRegistry.totalAgents} active`));
          console.log(chalk.white(`  Mesh: ${meshStatus.nodeCount} nodes, ${meshStatus.connectionCount} connections`));
          console.log(chalk.white(`  Swarm: ${swarmStatus.algorithm}, optimizing=${swarmStatus.isOptimizing}`));
          console.log(chalk.white(`  Execution time: ${totalTime}ms`));
        }

        if (!config.debug && !options.yaml) {
          console.log(chalk.blue('\n💾 Results saved to session telemetry'));
        } else if (config.debug && !options.yaml) {
          console.log(chalk.blue('\n🔍 Full Debug Output:'));
          console.log(JSON.stringify(outcome, null, 2));
        }

      } finally {
        system.off('workflowStageStarted', onStageStarted);
        system.off('workflowStageCompleted', onStageCompleted);
        system.off('workflowStageFailed', onStageFailed);
      }
    });
  }));

hiveMindCmd
  .command('history')
  .description('Show recent Tree-of-Thought runs from Codex memory')
  .option('--limit <count>', 'Number of entries to display', '5')
  .action(handleCommand('hive-mind.history', async (options) => {
    const limit = parseInteger(options.limit ?? '5', 'limit');
    await useSystem('hive-mind history', async (system) => {
      const entries = await system.getMemorySystem().list('tot_runs', limit);
      if (!entries.length) {
        console.log(chalk.gray('No Tree-of-Thought runs have been archived yet.'));
        return;
      }

      console.log(chalk.blue('🌳 Recent Tree-of-Thought Runs'));
      entries.forEach((entry, idx) => {
        const payload = entry.data ?? {};
        const storedAt = payload.storedAt ?? entry.timestamp;
        console.log(chalk.cyan(`\n${idx + 1}. ${payload.summary ?? entry.key}`));
        console.log(chalk.gray(`   Memory ID: ${entry.id}`));
        console.log(chalk.gray(`   Stored: ${storedAt}`));
        if (payload.bestBranch) {
          const confidence = typeof payload.bestBranch.confidence === 'number'
            ? `${(payload.bestBranch.confidence * 100).toFixed(1)}%`
            : 'n/a';
          console.log(chalk.gray(`   Best Branch: ${payload.bestBranch.label} (${confidence})`));
        }
        if (Array.isArray(payload.backlog) && payload.backlog.length) {
          console.log(chalk.gray(`   Backlog: ${payload.backlog.slice(0, 2).join(' | ')}`));
        }
      });
    });
  }));

const observabilityCmd = program.command('observability').description('Observability helpers and templates');

observabilityCmd
  .command('template')
  .description('Print the observability dashboard template path and ensure it exists')
  .option('--output <path>', 'Custom path to write the template', 'docs/observability/dashboard-template.yaml')
  .action(handleCommand('observability.template', async (options) => {
    const templatePath = join(process.cwd(), options.output);
    console.log(chalk.blue('📊 Observability dashboard template'));
    console.log(chalk.gray(`  Path: ${templatePath}`));
    console.log(chalk.gray('  Use this as a starting point for your telemetry dashboards.'));
  }));

const envCmd = program.command('env').description('Environment and service management');

envCmd
  .command('list')
  .description('List available service profiles')
  .action(() => {
    console.log(chalk.blue('Available service profiles'));
    serviceManager.listProfiles().forEach(({ name, profile }) => {
      console.log(chalk.cyan(`  ${name}`));
      console.log(chalk.gray(`    ${profile.description}`));
      console.log(chalk.gray(`    compose: ${profile.composeFile}`));
    });
  });

envCmd
  .command('status')
  .description('Show status for a service profile')
  .argument('[name]', 'Service profile name')
  .action((name?: string) => {
    const targets = name ? [name] : serviceManager.listProfiles().map(({ name }) => name);
    targets.forEach((target) => {
      const status = serviceManager.status(target);
      console.log(chalk.cyan(`
${status.name}`));
      console.log(chalk.gray(`  running: ${status.running ? 'yes' : 'no'}`));
      console.log(chalk.gray(status.raw.trim()));
    });
  });

envCmd
  .command('up')
  .description('Start one or more service profiles')
  .argument('<names...>', 'Service profile names')
  .option('--no-wait', 'Do not wait for health checks')
  .action(async (names: string[], options) => {
    for (const name of names) {
      await serviceManager.ensureService(name, { waitForHealth: options.wait !== false });
      console.log(chalk.green(`✅ ${name} started`));
    }
  });

envCmd
  .command('down')
  .description('Stop one or more service profiles')
  .argument('<names...>', 'Service profile names')
  .action((names: string[]) => {
    for (const name of names) {
      serviceManager.stopService(name);
      console.log(chalk.green(`🛑 ${name} stopped`));
    }
  });

envCmd
  .command('plan')
  .description('Inspect compose files and services for profiles')
  .argument('[names...]', 'Service profile names')
  .action((names?: string[]) => {
    const plan = serviceManager.plan(names && names.length ? names : undefined);
    plan.forEach(({ name, profile }) => {
      console.log(chalk.cyan(`
${name}`));
      console.log(chalk.gray(`  description: ${profile.description}`));
      console.log(chalk.gray(`  compose: ${profile.composeFile}`));
      if (profile.services && profile.services.length) {
        console.log(chalk.gray(`  services: ${profile.services.join(', ')}`));
      }
    });
  });

const memoryCmd = program.command('memory').description('Codex memory utilities');

memoryCmd
  .command('status')
  .description('Show memory namespaces and entry counts')
  .action(handleCommand('memory.status', async () => {
    await useSystem('memory status', async (system) => {
      const memory = system.getMemorySystem();
      const stats = await memory.stats();
      console.log(chalk.blue('🧠 Codex Memory Status'));
      console.log(chalk.gray(`  Path: ${memory.getDatabasePath()}`));
      if (!Object.keys(stats).length) {
        console.log(chalk.gray('  No entries recorded yet.'));
        return;
      }
      Object.entries(stats).forEach(([namespace, count]) => {
        console.log(chalk.white(`  ${namespace}: ${count} entr${count === 1 ? 'y' : 'ies'}`));
      });
    });
  }));

memoryCmd
  .command('list')
  .description('List stored memory entries for a namespace')
  .argument('<namespace>', 'Memory namespace (e.g. tot_runs)')
  .option('--limit <count>', 'Number of entries to display', '5')
  .action(handleCommand('memory.list', async (namespace: string, options) => {
    const limit = parseInteger(options.limit ?? '5', 'limit');
    await useSystem('memory list', async (system) => {
      const entries = await system.getMemorySystem().list(namespace, limit);
      if (!entries.length) {
        console.log(chalk.gray(`No entries found for namespace "${namespace}".`));
        return;
      }
      console.log(chalk.blue(`🧠 Memory Entries — ${namespace}`));
      entries.forEach((entry, idx) => {
        console.log(chalk.cyan(`\n${idx + 1}. ${entry.key}`));
        console.log(chalk.gray(`   Memory ID: ${entry.id}`));
        console.log(chalk.gray(`   Recorded: ${entry.timestamp}`));
        if (entry.data) {
          const rendered = JSON.stringify(entry.data);
          console.log(chalk.gray(`   Data: ${rendered.substring(0, 240)}${rendered.length > 240 ? '…' : ''}`));
        }
      });
    });
  }));

const cheatsCmd = program.command('cheats').description('Codex-Synaptic cheat code combos');

cheatsCmd
  .command('list')
  .description('List available cheat codes')
  .action(() => {
    console.log(chalk.blue('🎮 Available Cheat Codes'));
    Object.entries(cheatCodeLibrary).forEach(([code, definition]) => {
      console.log(chalk.cyan(`  ${code}`));
      console.log(chalk.gray(`    ${definition.description}`));
    });
  });

cheatsCmd
  .command('run')
  .description('Execute a cheat code workflow')
  .argument('<code>', 'Cheat code identifier')
  .option('--codex', 'Force Codex context even if cheat defaults to off')
  .action(handleCommand('cheats.run', async (code: string, options) => {
    const definition = cheatCodeLibrary[code];
    if (!definition) {
      throw new Error(`Unknown cheat code "${code}". Use "codex-synaptic cheats list" to discover options.`);
    }

    await useSystem('cheats run', async (system) => {
      const prompt = definition.prompt;
      const enforceCodex = options.codex || definition.useCodex;
      const enrichedPrompt = enforceCodex
        ? `${prompt} Include insights from README.md, AGENTS.md, docs/, and recent telemetry.`
        : prompt;
      const outcome = await system.executeTask(enrichedPrompt);
      console.log(chalk.green('✅ Cheat executed.'));
      if (outcome?.summary) {
        console.log(chalk.gray(outcome.summary));
      }
    });
  }));

cheatsCmd
  .command('sync')
  .description('Store the cheat-code compendium into Codex memory for reuse')
  .action(handleCommand('cheats.sync', async () => {
    const cheatDocPath = join(process.cwd(), 'docs', 'codex-synaptic-cheat-codes.md');
    const content = readFileSync(cheatDocPath, 'utf8');
    await useSystem('cheats sync', async (system) => {
      await system.getMemorySystem().store('knowledge_assets', 'codex_cheat_codes', {
        content,
        storedAt: new Date().toISOString()
      });
      console.log(chalk.green('✅ Cheat-code compendium synced to memory (namespace: knowledge_assets).'));
    });
  }));

cheatsCmd
  .command('publish')
  .description('Publish a cheat snippet to Codex memory for team sharing')
  .argument('<code>', 'Cheat code identifier')
  .argument('<prompt...>', 'Prompt or instructions to store')
  .action(handleCommand('cheats.publish', async (code: string, promptParts: string[]) => {
    const prompt = promptParts.join(' ').trim();
    if (!prompt) {
      throw new Error('Prompt cannot be empty');
    }
    await useSystem('cheats publish', async (system) => {
      await system.getMemorySystem().store('cheat_codes', code, {
        prompt,
        storedAt: new Date().toISOString()
      });
      console.log(chalk.green(`✅ Cheat "${code}" stored in namespace cheat_codes.`));
    });
  }));

hiveMindCmd
  .command('follow-up')
  .description('Dispatch a follow-up workflow using a stored Tree-of-Thought backlog item')
  .argument('<entryId>', 'Memory entry id from hive-mind history')
  .option('--index <number>', 'Backlog item index (1-based)', '1')
  .action(handleCommand('hive-mind.follow-up', async (entryId: string, options) => {
    const id = parseInteger(entryId, 'entryId');
    const backlogIndex = Math.max(parseInteger(options.index ?? '1', 'index') - 1, 0);

    await useSystem('hive-mind follow-up', async (system) => {
      const memoryEntry = await system.getMemorySystem().get('tot_runs', id);
      if (!memoryEntry) {
        console.log(chalk.red(`Memory entry ${id} not found in namespace "tot_runs".`));
        return;
      }

      const payload = memoryEntry.data ?? {};
      const backlog = Array.isArray(payload.backlog) ? payload.backlog : [];
      if (!backlog.length || backlogIndex >= backlog.length) {
        console.log(chalk.red(`Backlog index ${backlogIndex + 1} is not available for entry ${id}.`));
        return;
      }

      const backlogItem = backlog[backlogIndex];
      const prompt = `Follow-up backlog task from Tree-of-Thought run "${payload.summary ?? memoryEntry.key}": ${backlogItem}`;

      console.log(chalk.blue('🚀 Dispatching follow-up workflow...'));
      const outcome = await system.executeTask(prompt);
      console.log(chalk.green('✅ Follow-up workflow complete.'));
      console.log(chalk.gray(outcome.summary));
    });
  }));

hiveMindCmd
  .command('status')
  .description('Show status of active hive-mind swarms')
  .option('--yaml', 'Output status in YAML format')
  .action(handleCommand('hive-mind.status', async (options) => {
    await useSystem('hive-mind status', async (system) => {
      const systemStatus = {
        ready: system.isReady(),
        uptime: Date.now() - (system as any).startTime?.getTime() || 0,
        agents: system.getAgentRegistry().getStatus(),
        mesh: system.getNeuralMesh().getStatus(),
        swarm: system.getSwarmCoordinator().getStatus(),
        consensus: system.getConsensusManager().getStatus()
      };

      if (options.yaml) {
        const yamlOutput = HiveMindYamlFormatter.formatSystemStatus(systemStatus);
        console.log(yamlOutput);
      } else {
        renderSwarmStatus(systemStatus.swarm);
      }
    });
  }));

hiveMindCmd
  .command('terminate')
  .description('Terminate swarm coordination and reset mesh links')
  .action(handleCommand('hive-mind.terminate', async () => {
    await useSystem('hive-mind terminate', async (system) => {
      system.getSwarmCoordinator().stopSwarm();
      console.log(chalk.green('✅ Hive-mind swarms halted. Resources remain available.'));
    });
  }));

// Interactive mode
program
  .command('interactive')
  .alias('i')
  .description('Start interactive mode')
  .action(handleCommand('interactive', async () => {
    const previousConsoleLevel = rootLogger.getConsoleLevel();
    rootLogger.setConsoleLevel(LogLevel.WARN);
    try {
      await useSystem('interactive', async (system) => {
        console.log(chalk.green('🎛️  Welcome to Codex-Synaptic Interactive Mode!'));
        renderInteractiveHints();
        let exit = false;
        while (!exit) {
          const { action } = await inquirer.prompt([
            {
              type: 'list',
              name: 'action',
              message: 'Select an action:',
              choices: [
                'System status',
                'List agents',
                'Submit workflow',
                'Show telemetry',
                'Exit'
              ]
            }
          ]);

          switch (action) {
            case 'System status':
              renderTelemetry();
              break;
            case 'List agents':
              renderAgentTable(system.getAgentRegistry().getAllAgents());
              break;
            case 'Submit workflow': {
              const { prompt } = await inquirer.prompt([
                {
                  type: 'input',
                  name: 'prompt',
                  message: 'Workflow prompt:'
                }
              ]);
              if (prompt) {
                const outcome = await system.executeTask(prompt);
                console.log(chalk.green('✅ Workflow complete.'));
                console.log(outcome.summary);
              }
              break;
            }
            case 'Show telemetry':
              renderTelemetry();
              break;
            case 'Exit':
              exit = true;
              break;
          }
        }
      });
    } finally {
      rootLogger.setConsoleLevel(previousConsoleLevel);
    }
  }));

// Global error handling
program.configureOutput({
  writeErr: (str) => process.stderr.write(chalk.red(str))
});

program.exitOverride();

try {
  program.parse();
} catch (err: any) {
  if (err.code === 'commander.helpDisplayed') {
    process.exit(0);
  } else if (err.code === 'commander.version') {
    process.exit(0);
  } else {
    console.error(chalk.red('CLI Error:'), err.message);
    process.exit(1);
  }
}
