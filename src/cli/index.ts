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
import { parseFileContent, parseJsonInput, loadFileThroughFeedforward } from './feedforward.js';
import { InstructionParser } from '../instructions/index.js';
import { RoutingPolicyService, type RoutingRequest } from '../router/index.js';
import { readFileSync } from 'fs';
import { join, resolve, relative } from 'path';
import { ToolOptimizer, type ToolCandidate } from '../tools/optimizer/index.js';
import { type ToolUsageRecord, type ReasoningRunRecord } from '../memory/memory-system.js';
import type { ReasoningPlanOptions, ReasoningCompletionOptions, ReasoningCheckpointInput } from '../reasoning/planner.js';
import { GoapExecutor } from '../reasoning/goap/executor.js';
import { goapRegistry } from '../reasoning/goap/registry.js';
import type { SystemConfiguration } from '../core/config.js';
import { serviceManager } from '../env/service-manager.js';
import type { TenantQuota } from '../tenancy/types.js';
import { executeCodexPassthrough, isCodexCliAvailable } from './codex-passthrough.js';

const program = new Command();
const session = CliSession.getInstance();
const rootLogger = Logger.getInstance();
const cliSilent = process.env.CODEX_CLI_SILENT === '1';
const cliAutoShutdown = process.env.CODEX_CLI_AUTO_SHUTDOWN === '1';

if (cliSilent) {
  rootLogger.setConsoleLevel(LogLevel.ERROR);
}

type BackgroundJob = {
  id: number;
  command: string;
  startedAt: number;
};

const backgroundJobs = new Map<number, BackgroundJob>();
let nextBackgroundJobId = 1;

program.configureHelp({
  sortSubcommands: false,
  sortOptions: false,
  styleTitle: (str: string) => chalk.cyanBright.bold(str),
  styleUsage: (str: string) => chalk.white(str),
  styleCommandText: (str: string) => chalk.cyan(str),
  styleCommandDescription: (str: string) => chalk.gray(str),
  styleSubcommandTerm: (str: string) => chalk.greenBright(str),
  styleSubcommandDescription: (str: string) => chalk.white(str),
  styleOptionTerm: (str: string) => chalk.yellow(str),
  styleOptionDescription: (str: string) => chalk.white(str),
  styleArgumentTerm: (str: string) => chalk.magenta(str),
  styleArgumentDescription: (str: string) => chalk.white(str)
});

program.addHelpText('beforeAll', ({ command }) => {
  if (command.parent) {
    return '';
  }
  return [
    chalk.cyanBright.bold('Codex-Synaptic CLI'),
    chalk.gray('Distributed agent orchestration for OpenAI Codex workflows.'),
    '',
    `${chalk.bold('Highlights')}:`,
    `  ${chalk.green('•')} Boot the orchestrator, neural mesh, and swarm managers`,
    `  ${chalk.green('•')} Pipe README.md and AGENTS.md into Codex with ${chalk.cyan('--codex')}`,
    `  ${chalk.green('•')} Track tenants, consensus, and tooling from one hub`,
    ''
  ].join('\n');
});

program.addHelpText('afterAll', ({ command }) => {
  if (command.parent) {
    return '';
  }
  return [
    '',
    `${chalk.bold('Next steps')}:`,
    `  ${chalk.cyan('codex-synaptic system start')} ${chalk.gray('Boot the orchestrator in this shell')}`,
    `  ${chalk.cyan('codex-synaptic --codex "Deploy agents"')} ${chalk.gray('Send docs and prompts to Codex')}`,
    `  ${chalk.cyan('codex-synaptic interactive')} ${chalk.gray('Explore guided menus and dashboards')}`
  ].join('\n');
});

type CommandHelpDecorOptions = {
  title: string;
  subtitle: string;
  context: string[];
  skills: string[];
  actions?: Array<{ command: string; description: string }>;
  docs?: Array<{ label: string; description: string }>;
  vibeTips?: string[];
};

function decorateCommandHelp(command: Command, options: CommandHelpDecorOptions): Command {
  command.addHelpText('beforeAll', () => {
    const lines: string[] = [
      chalk.cyanBright.bold(options.title),
      chalk.gray(options.subtitle),
      ''
    ];

    if (options.context.length) {
      lines.push(`${chalk.bold('Why it matters')}:`);
      for (const insight of options.context) {
        lines.push(`  ${chalk.green('•')} ${insight}`);
      }
      lines.push('');
    }

    if (options.skills.length) {
      lines.push(`${chalk.bold('Dev skill boost')}:`);
      for (const skill of options.skills) {
        lines.push(`  ${chalk.green('•')} ${skill}`);
      }
      lines.push('');
    }

    if (options.vibeTips?.length) {
      lines.push(`${chalk.bold('Vibe tips')}:`);
      for (const tip of options.vibeTips) {
        lines.push(`  ${chalk.green('•')} ${tip}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  });

  command.addHelpText('afterAll', () => {
    const lines: string[] = [];

    if (options.actions?.length) {
      lines.push(`${chalk.bold('Try next')}:`);
      for (const action of options.actions) {
        lines.push(`  ${chalk.cyan(action.command)} ${chalk.gray(action.description)}`);
      }
    }

    if (options.docs?.length) {
      if (lines.length) {
        lines.push('');
      }
      lines.push(`${chalk.bold('Docs to skim')}:`);
      for (const doc of options.docs) {
        lines.push(`  ${chalk.yellow(doc.label)} ${chalk.gray(doc.description)}`);
      }
    }

    return lines.join('\n');
  });

  return command;
}

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
  if (!alreadyRunning && !cliSilent) {
    console.log(chalk.blue(`🔧 Initializing Codex-Synaptic system (${description})...`));
  }
  const system = await session.ensureSystem();
  try {
    await fn(system);
  } finally {
    if (!alreadyRunning && cliAutoShutdown) {
      await session.shutdown('auto-shutdown');
    }
  }
}

function parseInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} must be a number`);
  }
  return parsed;
}

async function authorizeTenantAction(system: CodexSynapticSystem, action: 'read' | 'write', tokenOverride?: string): Promise<void> {
  const token = tokenOverride ?? process.env.CODEX_TENANT_ADMIN_TOKEN;
  if (!token) {
    throw new Error('Tenant operations require an authorization token. Use --token, set CODEX_TENANT_ADMIN_TOKEN, or run "codex-synaptic auth token" to mint one.');
  }
  const normalized = token.toLowerCase().startsWith('bearer ') ? token.slice(7).trim() : token.trim();
  await system.getAuthMiddleware().authenticateAndAuthorize(normalized, 'tenant', action);
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
  console.log(chalk.blueBright('💡 Interactive Command Hub'));
  console.log('  • Navigate through guided menus for system, agents, mesh, swarm, hive-mind, consensus, and tasks.');
  console.log('  • Each submenu provides context-aware operations tailored to that subsystem.');
  console.log('  • The "Run CLI command" option lets you execute any codex-synaptic subcommand without leaving this shell.');
  console.log('  • Dashboard view provides real-time snapshot of mesh, swarm, consensus, and resource metrics.');
  console.log('  • The system stays running when you exit interactive mode—choose explicit shutdown when needed.');
  console.log('  • Hive-mind quick spawn wizard auto-attaches Codex context (AGENTS.md, README, docs/) for repository-aware workflows.');
  console.log('');
}

async function ensureInteractiveSystem(): Promise<CodexSynapticSystem> {
  const existing = session.getSystemUnsafe();
  if (existing) {
    const status = existing.getStatus?.();
    if (!status?.shuttingDown) {
      return existing;
    }
  }
  return session.ensureSystem();
}

async function pause(message = 'Press Enter to return to the menu.'): Promise<void> {
  await inquirer.prompt<{ __continue: string }>([
    {
      type: 'input',
      name: '__continue',
      message
    }
  ]);
}

function tokenizeCliArgs(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '\\' && i + 1 < input.length) {
        current += input[i + 1];
        i += 1;
        continue;
      }
      if (char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === '\'') {
      inQuotes = true;
      quoteChar = char;
      if (current) {
        tokens.push(current);
        current = '';
      }
      if (quoteChar === '\'') {
        // Start new token for single quoted strings
        current = '';
      }
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens.filter((token) => token.length > 0);
}

function formatElapsedDuration(startedAt: number): string {
  const elapsedMs = Date.now() - startedAt;
  if (elapsedMs < 1000) {
    return `${elapsedMs}ms`; // fast feedback for very short runs
  }
  const totalSeconds = Math.floor(elapsedMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

function renderBackgroundJobs(): void {
  if (!backgroundJobs.size) {
    console.log(chalk.gray('No background CLI commands are running.'));
    return;
  }

  console.log(chalk.blue('🧵 Background CLI commands'));
  for (const job of backgroundJobs.values()) {
    console.log(`  #${job.id} ${job.command} ${chalk.gray(`(${formatElapsedDuration(job.startedAt)})`)}`);
  }
  console.log('');
}

async function dispatchCliCommand(raw: string): Promise<void> {
  const args = tokenizeCliArgs(raw.trim());
  if (!args.length) {
    console.log(chalk.gray('No command provided.'));
    return;
  }

  if (['interactive', 'i'].includes(args[0])) {
    console.log(chalk.yellow('Already running in interactive mode – choose another command.'));
    return;
  }

  const argv = ['node', 'codex-synaptic', ...args];

  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error: any) {
    if (
      error?.code === 'commander.helpDisplayed'
      || error?.code === 'commander.version'
    ) {
      return;
    }
    if (error?.code === 'commander.executeSubCommandAsync') {
      console.log(chalk.red('Sub-command execution failed.'));
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`❌ Command failed: ${message}`));
    if (process.env.CODEX_DEBUG === '1' && error instanceof Error && error.stack) {
      console.log(chalk.gray(error.stack));
    }
  }
}

async function renderSystemDashboard(system: CodexSynapticSystem): Promise<void> {
  console.log('');
  renderTelemetry();
  console.log('');
  renderMeshStatus(system.getNeuralMesh().getStatus());
  console.log('');
  renderSwarmStatus(system.getSwarmCoordinator().getStatus());
  console.log('');
  renderConsensusStatus(system);
  console.log('');
}

async function interactiveSystemMenu(): Promise<void> {
  let exit = false;
  let first = true;
  while (!exit) {
    const system = await ensureInteractiveSystem();
    if (first) {
      console.log(chalk.cyan('\n🛠  System control center'));
      console.log('Use these options to review health, stream telemetry, or stop the orchestrator.');
      first = false;
    }
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: 'System controls:',
        choices: [
          {
            name: `${chalk.green('Dashboard')} — mesh/swarm/consensus snapshot`,
            value: 'dashboard',
            short: 'Dashboard'
          },
          {
            name: `${chalk.green('Telemetry pulse')} — quick resource + task view`,
            value: 'telemetry',
            short: 'Telemetry'
          },
          {
            name: `${chalk.red('Shutdown')} — gracefully stop all services`,
            value: 'stop',
            short: 'Shutdown'
          },
          {
            name: 'Back to main menu',
            value: 'back',
            short: 'Back'
          }
        ]
      }
    ]);

    switch (action) {
      case 'dashboard':
        await renderSystemDashboard(system);
        await pause();
        break;
      case 'telemetry':
        renderTelemetry();
        console.log('');
        await pause();
        break;
      case 'stop': {
        const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'Shut down Codex-Synaptic now?',
            default: false
          }
        ]);
        if (confirm) {
          await session.shutdown('interactive-stop');
          console.log(chalk.green('✅ Codex-Synaptic system shutdown complete.'));
        }
        break;
      }
      case 'back':
      default:
        if (!first) {
          console.log('');
        }
        exit = true;
        break;
    }
  }
}

async function interactiveAgentsMenu(): Promise<void> {
  let exit = false;
  let first = true;
  while (!exit) {
    const system = await ensureInteractiveSystem();
    const agents = system.getAgentRegistry().getAllAgents();
    if (first) {
      console.log(chalk.cyan('\n🤖 Agent operations hub'));
      console.log('Inspect current workers, deploy new specialists, or drill into a single agent.');
      first = false;
    }

    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: 'Agent operations:',
        choices: [
          {
            name: `${chalk.green('List roster')} — summary table of all registered agents`,
            value: 'list',
            short: 'List roster'
          },
          {
            name: `${chalk.green('Deploy agents')} — add more workers or coordinators`,
            value: 'deploy',
            short: 'Deploy'
          },
          {
            name: `${chalk.green('Inspect agent')} — detailed view for one agent`,
            value: 'inspect',
            short: 'Inspect'
          },
          {
            name: 'Back to main menu',
            value: 'back',
            short: 'Back'
          }
        ]
      }
    ]);

    switch (action) {
      case 'list':
        renderAgentTable(agents);
        console.log('');
        await pause();
        break;
      case 'deploy': {
        const { type } = await inquirer.prompt<{ type: AgentType }>([
          {
            type: 'list',
            name: 'type',
            message: 'Choose agent type to deploy:',
            choices: Object.values(AgentType)
          }
        ]);
        const { replicas } = await inquirer.prompt<{ replicas: string }>([
          {
            type: 'input',
            name: 'replicas',
            message: 'How many replicas?',
            default: '1',
            validate: (value) => {
              try {
                parseInteger(value, 'replicas');
                return true;
              } catch (error: any) {
                return error.message;
              }
            }
          }
        ]);
        await system.deployAgent(type, parseInteger(replicas, 'replicas'));
        console.log(chalk.green(`✅ Deployed ${replicas} ${type} agent(s).`));
        await pause();
        break;
      }
      case 'inspect': {
        if (!agents.length) {
          console.log(chalk.gray('No agents registered.'));
          await pause();
          break;
        }
        const { agentId } = await inquirer.prompt<{ agentId: string }>([
          {
            type: 'list',
            name: 'agentId',
            message: 'Select agent:',
            choices: agents.map((agent) => ({
              name: `${agent.id.id} (${agent.id.type})`,
              value: agent.id.id
            }))
          }
        ]);
        const agent = system.getAgentRegistry().getAgentByStringId(agentId);
        if (!agent) {
          console.log(chalk.red('Agent not found.'));
          break;
        }
        console.log(chalk.blue(`👤 Agent ${agent.id.id}`));
        console.log(`  Type: ${agent.id.type}`);
        console.log(`  Status: ${agent.status}`);
        console.log(`  Capabilities: ${agent.capabilities.map((cap) => cap.name).join(', ') || 'none'}`);
        console.log(`  Resources: CPU ${agent.resources.cpu} | RAM ${agent.resources.memory}MB`);
        console.log(`  Last Updated: ${agent.lastUpdated.toISOString()}`);
        console.log('');
        await pause();
        break;
      }
      case 'back':
      default:
        if (!first) {
          console.log('');
        }
        exit = true;
        break;
    }
  }
}

async function interactiveMeshMenu(): Promise<void> {
  let exit = false;
  while (!exit) {
    const system = await ensureInteractiveSystem();
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: 'Neural mesh controls:',
        choices: [
          { name: 'Show mesh status', value: 'status' },
          { name: 'Configure topology', value: 'configure' },
          { name: 'Return to main menu', value: 'back' }
        ]
      }
    ]);

    switch (action) {
      case 'status':
        renderMeshStatus(system.getNeuralMesh().getStatus());
        console.log('');
        break;
      case 'configure': {
        const { topology } = await inquirer.prompt<{ topology: string }>([
          {
            type: 'list',
            name: 'topology',
            message: 'Topology:',
            choices: ['mesh', 'ring', 'star', 'tree', 'hybrid']
          }
        ]);
        const { nodes } = await inquirer.prompt<{ nodes: string }>([
          {
            type: 'input',
            name: 'nodes',
            message: 'Desired node count:',
            default: '5',
            validate: (value) => {
              try {
                parseInteger(value, 'nodes');
                return true;
              } catch (error: any) {
                return error.message;
              }
            }
          }
        ]);
        await system.createNeuralMesh(topology, parseInteger(nodes, 'nodes'));
        console.log(chalk.green(`✅ Mesh configured (${topology}, ${nodes} nodes).`));
        renderMeshStatus(system.getNeuralMesh().getStatus());
        console.log('');
        break;
      }
      case 'back':
      default:
        exit = true;
        break;
    }
  }
}

async function interactiveSwarmMenu(): Promise<void> {
  let exit = false;
  while (!exit) {
    const system = await ensureInteractiveSystem();
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: 'Swarm coordination:',
        choices: [
          { name: 'Start swarm', value: 'start' },
          { name: 'Stop swarm', value: 'stop' },
          { name: 'Show swarm status', value: 'status' },
          { name: 'Return to main menu', value: 'back' }
        ]
      }
    ]);

    switch (action) {
      case 'start': {
        const { algorithm } = await inquirer.prompt<{ algorithm: string }>([
          {
            type: 'list',
            name: 'algorithm',
            message: 'Algorithm:',
            choices: ['pso', 'aco', 'flocking', 'hybrid']
          }
        ]);
        const { objectives } = await inquirer.prompt<{ objectives: string }>([
          {
            type: 'input',
            name: 'objectives',
            message: 'Objectives (comma-separated, optional):',
            default: ''
          }
        ]);
        const objectiveList = objectives
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        await system.startSwarm(algorithm, objectiveList);
        console.log(chalk.green('✅ Swarm coordination started.'));
        renderSwarmStatus(system.getSwarmCoordinator().getStatus());
        console.log('');
        break;
      }
      case 'stop':
        system.getSwarmCoordinator().stopSwarm();
        console.log(chalk.green('✅ Swarm coordination stopped.'));
        console.log('');
        break;
      case 'status':
        renderSwarmStatus(system.getSwarmCoordinator().getStatus());
        console.log('');
        break;
      case 'back':
      default:
        exit = true;
        break;
    }
  }
}

async function interactiveHiveMindMenu(): Promise<void> {
  let exit = false;
  while (!exit) {
    const system = await ensureInteractiveSystem();
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: 'Hive-mind orchestration:',
        choices: [
          { name: 'Quick spawn with defaults', value: 'quick' },
          { name: 'Run advanced spawn command', value: 'advanced' },
          { name: 'Show hive-mind status', value: 'status' },
          { name: 'Return to main menu', value: 'back' }
        ]
      }
    ]);

    switch (action) {
      case 'quick': {
        const { prompt } = await inquirer.prompt<{ prompt: string }>([
          {
            type: 'input',
            name: 'prompt',
            message: 'Describe the hive-mind objective:',
            validate: (value) => value.trim() ? true : 'Prompt cannot be empty.'
          }
        ]);
        const { topology, algorithm } = await inquirer.prompt<{ topology: string; algorithm: string }>([
          {
            type: 'list',
            name: 'topology',
            message: 'Mesh topology:',
            choices: ['mesh', 'ring', 'star', 'tree'],
            default: 'mesh'
          },
          {
            type: 'list',
            name: 'algorithm',
            message: 'Swarm algorithm:',
            choices: ['pso', 'aco', 'flocking', 'hybrid'],
            default: 'pso'
          }
        ]);
        const { agentCount } = await inquirer.prompt<{ agentCount: string }>([
          {
            type: 'input',
            name: 'agentCount',
            message: 'Target agents:',
            default: '6',
            validate: (value) => {
              try {
                parseInteger(value, 'agents');
                return true;
              } catch (error: any) {
                return error.message;
              }
            }
          }
        ]);
        const { attachCodex } = await inquirer.prompt<{ attachCodex: boolean }>([
          {
            type: 'confirm',
            name: 'attachCodex',
            message: 'Attach Codex context from AGENTS.md/README?',
            default: shouldAutoAttachCodexContext(prompt)
          }
        ]);

        let workingPrompt = prompt;
        if (attachCodex) {
          const builder = new CodexContextBuilder(process.cwd());
          await builder.withAgentDirectives();
          await builder.withReadmeExcerpts();
          await builder.withDirectoryInventory();
          await builder.withDatabaseMetadata();
          const buildResult = await builder.build();
          emitContextLogs(buildResult.logs);
          emitContextSummary(buildResult.context, buildResult.metadata);
          workingPrompt = composePromptWithContext(prompt, buildResult.context);
          console.log(chalk.cyan('📚 Codex context attached to prompt.'));
        }

        const agentsTarget = parseInteger(agentCount, 'agents');
        await system.createNeuralMesh(topology, agentsTarget);
        await system.deployAgent(AgentType.SWARM_COORDINATOR, 1);
        await system.deployAgent(AgentType.CONSENSUS_COORDINATOR, 1);
        await system.deployAgent(AgentType.CODE_WORKER, Math.max(1, Math.floor(agentsTarget / 3)));
        await system.deployAgent(AgentType.DATA_WORKER, 1);
        await system.deployAgent(AgentType.VALIDATION_WORKER, 1);

        await system.startSwarm(algorithm, ['hive_mind_objective']);
        console.log(chalk.blue('🧠 Hive-mind swarm engaged. Executing task...'));
        const outcome = await system.executeTask(workingPrompt);
        console.log(chalk.green('✅ Hive-mind execution complete.'));
        console.log(chalk.gray(JSON.stringify(outcome.summary ?? outcome, null, 2)));
        system.getSwarmCoordinator().stopSwarm();
        console.log('');
        break;
      }
      case 'advanced': {
        console.log(chalk.blue('Tip: enter a command such as'));
        console.log(chalk.gray('  hive-mind spawn "Design multi-cloud rollout" --codex --algorithm hybrid --agents 8'));
        const { command } = await inquirer.prompt<{ command: string }>([
          {
            type: 'input',
            name: 'command',
            message: 'Enter hive-mind CLI command (without the codex-synaptic prefix):'
          }
        ]);
        if (command.trim()) {
          await dispatchCliCommand(command);
        }
        break;
      }
      case 'status': {
        const swarmStatus = system.getSwarmCoordinator().getStatus();
        renderSwarmStatus(swarmStatus);
        console.log('');
        break;
      }
      case 'back':
      default:
        exit = true;
        break;
    }
  }
}

async function interactiveConsensusMenu(): Promise<void> {
  let exit = false;
  while (!exit) {
    const system = await ensureInteractiveSystem();
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: 'Consensus management:',
        choices: [
          { name: 'Show consensus status', value: 'status' },
          { name: 'Propose decision', value: 'propose' },
          { name: 'Vote on proposal', value: 'vote' },
          { name: 'View consensus telemetry', value: 'telemetry' },
          { name: 'Return to main menu', value: 'back' }
        ]
      }
    ]);

    switch (action) {
      case 'status':
        renderConsensusStatus(system);
        console.log('');
        break;
      case 'propose': {
        const { type, payload } = await inquirer.prompt<{ type: string; payload: string }>([
          {
            type: 'input',
            name: 'type',
            message: 'Proposal type (e.g., system_upgrade):',
            validate: (value) => value.trim() ? true : 'Type is required.'
          },
          {
            type: 'editor',
            name: 'payload',
            message: 'Proposal payload JSON:',
            default: '{\n  "description": "Describe the proposal"\n}'
          }
        ]);
        const proposerAgents = system.getAgentRegistry().getAgentsByType(AgentType.CONSENSUS_COORDINATOR);
        const proposerId = proposerAgents[0]?.id;
        const data = parseJsonInput(payload, 'payload');
        const proposalId = await system.proposeConsensus(type, data, proposerId);
        console.log(chalk.green(`✅ Proposal ${proposalId} submitted.`));
        break;
      }
      case 'vote': {
        const proposals = system.getConsensusManager().getActiveProposals();
        if (!proposals.length) {
          console.log(chalk.gray('No active proposals.'));
          break;
        }
        const { proposalId } = await inquirer.prompt<{ proposalId: string }>([
          {
            type: 'list',
            name: 'proposalId',
            message: 'Select proposal:',
            choices: proposals.map((proposal) => ({
              name: `${proposal.id} (${proposal.type})`,
              value: proposal.id
            }))
          }
        ]);
        const { vote } = await inquirer.prompt<{ vote: string }>([
          {
            type: 'list',
            name: 'vote',
            message: 'Vote:',
            choices: [
              { name: 'Approve', value: 'yes' },
              { name: 'Reject', value: 'no' }
            ]
          }
        ]);
        const voter = system.getAgentRegistry().getAgentsByType(AgentType.CONSENSUS_COORDINATOR)[0]?.id;
        system.submitConsensusVote(proposalId, vote === 'yes', voter);
        console.log(chalk.green('✅ Vote submitted.'));
        break;
      }
      case 'telemetry': {
        const entries = await system.getMemorySystem().list('consensus_events', 5);
        if (!entries.length) {
          console.log(chalk.gray('No consensus telemetry recorded yet.'));
          break;
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
        console.log('');
        break;
      }
      case 'back':
      default:
        exit = true;
        break;
    }
  }
}

async function interactiveTasksMenu(): Promise<void> {
  let exit = false;
  while (!exit) {
    const system = await ensureInteractiveSystem();
    const { action } = await inquirer.prompt<{ action: string }>([
      {
        type: 'list',
        name: 'action',
        message: 'Task & router workflows:',
        choices: [
          { name: 'Execute task prompt', value: 'execute' },
          { name: 'Show recent session tasks', value: 'recent' },
          { name: 'Evaluate routing for prompt', value: 'route' },
          { name: 'Return to main menu', value: 'back' }
        ]
      }
    ]);

    switch (action) {
      case 'execute': {
        const { prompt } = await inquirer.prompt<{ prompt: string }>([
          {
            type: 'input',
            name: 'prompt',
            message: 'Task prompt:',
            validate: (value) => value.trim() ? true : 'Prompt cannot be empty.'
          }
        ]);
        const { silent } = await inquirer.prompt<{ silent: boolean }>([
          {
            type: 'confirm',
            name: 'silent',
            message: 'Suppress verbose JSON output?',
            default: false
          }
        ]);
        console.log(chalk.blue('🚀 Dispatching task...'));
        const outcome = await system.executeTask(prompt);
        console.log(chalk.green('✅ Task complete.'));
        if (!silent) {
          console.log(JSON.stringify(outcome, null, 2));
        } else {
          console.log(chalk.gray(outcome.summary ?? 'Task executed.'));
        }
        console.log('');
        break;
      }
      case 'recent': {
        const snapshot = session.getTelemetry();
        if (!snapshot.recentTasks.length) {
          console.log(chalk.gray('No tasks executed yet in this session.'));
          break;
        }
        console.log(chalk.blue('🗂 Recent tasks'));
        for (const item of snapshot.recentTasks) {
          console.log(`  • ${item.id} [${item.status}] — ${item.summary}`);
        }
        console.log('');
        break;
      }
      case 'route': {
        const { prompt } = await inquirer.prompt<{ prompt: string }>([
          {
            type: 'input',
            name: 'prompt',
            message: 'Prompt to evaluate for routing:',
            validate: (value) => value.trim() ? true : 'Prompt cannot be empty.'
          }
        ]);
        const router = new RoutingPolicyService(undefined, {
          toolOptimizer: system.getToolOptimizer()
        });
        console.log(chalk.cyan('🔄 Evaluating routing...'));
        const evaluation = await router.evaluateRouting({ prompt } as RoutingRequest);
        console.log(chalk.green(`✅ Recommended agent: ${evaluation.agentType}`));
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
        console.log('');
        break;
      }
      case 'back':
      default:
        exit = true;
        break;
    }
  }
}

async function interactiveCommandRunner(): Promise<void> {
  console.log(chalk.gray('Tip: append "&" to run a command in the background.'));
  const { command } = await inquirer.prompt<{ command: string }>([
    {
      type: 'input',
      name: 'command',
      message: 'CLI command (omit the codex-synaptic prefix):'
    }
  ]);

  const raw = command.trim();
  if (!raw) {
    return;
  }

  const runInBackground = raw.endsWith('&');
  const normalized = runInBackground ? raw.slice(0, -1).trim() : raw;
  if (!normalized) {
    console.log(chalk.gray('Command discarded. Nothing to run.'));
    return;
  }

  if (!runInBackground) {
    await dispatchCliCommand(normalized);
    return;
  }

  const jobId = nextBackgroundJobId++;
  const startedAt = Date.now();
  backgroundJobs.set(jobId, { id: jobId, command: normalized, startedAt });
  console.log(chalk.gray(`Started background command #${jobId}: ${normalized}`));

  const runPromise = dispatchCliCommand(normalized);

  void runPromise
    .then(() => {
      backgroundJobs.delete(jobId);
      console.log(chalk.green(`\n✅ Background command #${jobId} complete: ${normalized}`));
    })
    .catch((error) => {
      backgroundJobs.delete(jobId);
      const message = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`\n❌ Background command #${jobId} failed: ${message}`));
    });
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
const systemCmd = decorateCommandHelp(
  program
    .command('system')
    .description('Boot, monitor, and gracefully stop the orchestrator core'),
  {
    title: 'System Control Lounge',
    subtitle: 'Power up or wind down the whole Codex-Synaptic stack like a studio session.',
    context: [
      'Service orchestrators start schedulers, servers, and workers together—watching this flow is DevOps gold.',
      'Status output teaches you how health checks narrate readiness the same way real production stacks do.'
    ],
    skills: [
      'Practice lifecycle commands you also meet in Docker, PM2, and systemd.',
      'Read telemetry signals to diagnose boot hiccups before they escalate in production.'
    ],
    vibeTips: [
      'Treat the orchestrator like your band leader—lock it in before other sections start playing.'
    ],
    actions: [
      { command: 'codex-synaptic system start', description: 'Kick off the orchestrator and stream the live telemetry loop.' },
      { command: 'codex-synaptic system monitor', description: 'Keep the console vibing while metrics pulse every few seconds.' }
    ],
    docs: [
      { label: 'docs/guides/quick-start.md', description: 'Step-by-step walkthrough for lighting up the full platform.' }
    ]
  }
);

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

const openaiCmd = decorateCommandHelp(
  program
    .command('openai')
    .description('Inspect OpenAI integration status and usage telemetry'),
  {
    title: 'OpenAI Telemetry Lab',
    subtitle: 'See exactly how many tokens you are burning and how fast responses flow.',
    context: [
      'Token analytics help you stay within OpenAI rate plans and spot runaway prompts early.',
      'Throughput snapshots mimic production dashboards for API-backed LLM services.'
    ],
    skills: [
      'Translate raw usage events into actionable throughput insights.',
      'Correlate spike patterns with prompts, tools, and orchestration workflows.'
    ],
    vibeTips: [
      'Pair this with your budget spreadsheet so finance stays chill when experiments scale.'
    ],
    actions: [
      { command: 'codex-synaptic openai usage', description: 'Review token totals, throughput, and the latest usage events.' }
    ],
    docs: [
      { label: 'docs/integration/OPENAI_PLATFORM_2025_INTEGRATION.md', description: 'Deep dive into OpenAI integration strategy and telemetry hooks.' }
    ]
  }
);

openaiCmd
  .command('usage')
  .description('Show token usage totals and throughput for recent OpenAI responses')
  .option('-w, --window <minutes>', 'Sliding window in minutes used for throughput stats', '5')
  .option('-l, --limit <count>', 'Number of recent usage events to display', '10')
  .option('--json', 'Output JSON summary instead of formatted text')
  .action(handleCommand('openai.usage', async (options) => {
    await useSystem('openai usage', async (system) => {
      const windowMinutes = Number.parseFloat(String(options.window ?? '5'));
      if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
        throw new Error('window must be a positive number');
      }

      const limit = parseInteger(options.limit ?? '10', 'limit');
      if (limit <= 0) {
        throw new Error('limit must be a positive integer');
      }
      const windowMs = Math.max(1000, Math.round(windowMinutes * 60000));
      const summary = system.getOpenAIUsageSummary(windowMs);
      const events = system.getRecentOpenAIUsage(limit);

      if (options.json) {
        const payload = {
          configured: Boolean(system.getOpenAIResolvedConfiguration()?.config?.enabled),
          clientReady: Boolean(system.getOpenAIResponsesClient()?.isReady()),
          windowMinutes,
          summary,
          events
        };
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      const configured = system.getOpenAIResolvedConfiguration()?.config?.enabled;
      const ready = system.getOpenAIResponsesClient()?.isReady();

      console.log(chalk.blue('🧮 OpenAI Usage Overview'));
      console.log(`  Integration configured: ${configured ? chalk.green('yes') : chalk.red('no')}`);
      console.log(`  Client ready: ${ready ? chalk.green('yes') : chalk.red('no')}`);
      if (!system.hasOpenAIUsage()) {
        console.log(chalk.gray('  No usage events recorded yet. Run Codex workflows that invoke OpenAI responses.'));
        return;
      }

      const totals = summary.totals;
      console.log(chalk.cyan('\nTotals'));
      console.log(`  Requests: ${totals.requests}`);
      console.log(`  Input tokens: ${totals.inputTokens.toLocaleString()}`);
      console.log(`  Output tokens: ${totals.outputTokens.toLocaleString()}`);
      console.log(`  Total tokens: ${totals.totalTokens.toLocaleString()}`);

      const throughput = summary.throughput;
      const windowLabel = `${(throughput.windowMs / 60000).toFixed(2)} min window`;
      console.log(chalk.cyan(`\nThroughput (${windowLabel})`));
      console.log(`  Tokens/min: ${throughput.tokensPerMinute.toFixed(2)}`);
      console.log(`  Tokens/sec: ${throughput.tokensPerSecond.toFixed(2)}`);
      console.log(`  Requests/min: ${throughput.requestsPerMinute.toFixed(2)}`);
      console.log(`  Window requests: ${throughput.requests}`);

      if (events.length) {
        console.log(chalk.cyan('\nRecent usage events'));
        events
          .slice()
          .reverse()
          .forEach((event, index) => {
            const label = `${event.timestamp.toISOString()} — ${event.model ?? 'unknown model'}`;
            const detail = `in ${event.inputTokens.toLocaleString()} | out ${event.outputTokens.toLocaleString()} | total ${event.totalTokens.toLocaleString()}`;
            const prefix = chalk.gray(`${index + 1}.`);
            console.log(`  ${prefix} ${chalk.white(label)}`);
            console.log(chalk.gray(`     ${detail}`));
          });
      }

      if (summary.mostRecent) {
        console.log(chalk.gray(`\nLast event ID: ${summary.mostRecent.id}`));
      }
    });
  }));

// Background daemon commands
const backgroundCmd = decorateCommandHelp(
  program
    .command('background')
    .description('Control the detached daemon that keeps Codex-Synaptic running'),
  {
    title: 'Background Beats',
    subtitle: 'Run Codex-Synaptic as a low-key background service while you jam elsewhere.',
    context: [
      'Background daemons are how CLIs stay responsive while servers hum behind the scenes.',
      'Learning to manage detached processes translates directly to screen, tmux, and cloud supervisors.'
    ],
    skills: [
      'Master process lifecycle flows: start, status, graceful stop.',
      'See how timeout safeguards mirror the health probes used in container orchestration.'
    ],
    vibeTips: [
      'Think of the daemon as a chill lo-fi loop—you can ride the groove without blasting the main speakers.'
    ],
    actions: [
      { command: 'codex-synaptic background start', description: 'Launch the detached orchestrator and free your shell.' },
      { command: 'codex-synaptic background status', description: 'Check that the groove is still looping in the background.' }
    ],
    docs: [
      { label: 'docs/architecture/multi-tenancy.md', description: 'Peek at how background services support multi-tenant workloads.' }
    ]
  }
);

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
const instructionsCmd = decorateCommandHelp(
  program
    .command('instructions')
    .description('Parse AGENTS.md trees and steward the instruction cache'),
  {
    title: 'Instruction Cartography',
    subtitle: 'Map every AGENTS.md so Codex always knows the vibe and the rules.',
    context: [
      'Instruction parsers keep large language models aligned with repo-specific playbooks.',
      'Caching speeds up workflows just like CDN layers accelerate web apps.'
    ],
    skills: [
      'Work with precedence chains to learn how configuration overrides stack.',
      'Preview how YAML and Markdown metadata become structured runtime inputs.'
    ],
    vibeTips: [
      'Imagine you are a tour guide—every AGENTS.md is a postcard from a different neighborhood.'
    ],
    actions: [
      { command: 'codex-synaptic instructions sync', description: 'Refresh the cache and see precedence chains in action.' },
      { command: 'codex-synaptic instructions sync --dry-run', description: 'Preview the metadata story without changing cache state.' }
    ],
    docs: [
      { label: 'docs/instructions/README.md', description: 'Deep dive into instruction discovery and precedence.' }
    ]
  }
);

instructionsCmd
  .command('sync')
  .description('Synchronize and cache AGENTS.md instructions from repository')
  .option('-r, --root <path>', 'Repository root path', process.cwd())
  .option('--no-cache', 'Skip cache and force fresh scan')
  .option('-v, --verbose', 'Show detailed processing information')
  .option('--json', 'Output synchronization summary as JSON')
  .action(handleCommand('instructions.sync', async (options) => {
    const parser = new InstructionParser();
    try {
      if (!options.json) {
        console.log(chalk.cyan('🔄 Synchronizing instruction files...'));
      }

      const startTime = Date.now();
      const context = await parser.parseInstructions(options.root, options.cache);
      const duration = Date.now() - startTime;

      if (options.json) {
        const payload = {
          root: options.root,
          metadataCount: context.metadata.length,
          precedenceChain: context.precedenceChain,
          contextHash: context.contextHash,
          aggregatedSize: context.aggregatedSize,
          cacheUsed: options.cache !== false,
          durationMs: duration
        };
        console.log(JSON.stringify(payload, null, 2));
      } else {
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
      }
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

// Authentication commands
const authCmd = decorateCommandHelp(
  program
    .command('auth')
    .description('Issue, rotate, and inspect authentication tokens'),
  {
    title: 'Auth Groove',
    subtitle: 'Mint tokens with swagger while respecting security best practices.',
    context: [
      'APIs everywhere expect bearer tokens—practise the pattern here and carry it to any stack.',
      'Rotation workflow mirrors the zero-trust mindset modern teams adopt.'
    ],
    skills: [
      'Understand how CLI tools wrap crypto-safe token generation.',
      'Learn to audit active tokens the same way you would on real infrastructure.'
    ],
    vibeTips: [
      'Security can feel heavy, so add a playlist and treat it like mastering your own backstage passes.'
    ],
    actions: [
      { command: 'codex-synaptic auth token', description: 'Create a fresh tenant admin token for sandbox experiments.' },
      { command: 'codex-synaptic auth rotate', description: 'Rotate credentials and feel the instant access refresh.' }
    ],
    docs: [
      { label: 'docs/architecture/multi-tenancy.md', description: 'See how tokens gate tenant actions across the mesh.' }
    ]
  }
);

authCmd
  .command('token')
  .description('Authenticate with username/password and print a bearer token')
  .requiredOption('--username <username>', 'Account username')
  .requiredOption('--password <password>', 'Account password')
  .action(handleCommand('auth.token', async (options) => {
    await useSystem('auth token', async (system) => {
      const manager = system.getAuthenticationManager();
      const { user, token } = await manager.authenticate(options.username, options.password);
      console.log(chalk.green('✅ Authentication successful'));
      console.log(chalk.gray(`   User: ${user.username}`));
      console.log(chalk.gray('   Token (store securely):'));
      console.log(token);
    });
  }));

// Tenant commands
const tenantCmd = decorateCommandHelp(
  program
    .command('tenant')
    .description('Provision tenants, quotas, and policy guardrails'),
  {
    title: 'Tenant Playground',
    subtitle: 'Slice up resources so every crew gets fair compute and vibes.',
    context: [
      'Multi-tenancy is how SaaS apps keep customers isolated yet efficient.',
      'Quotas resemble API rate limits and Kubernetes resource budgets you use in production.'
    ],
    skills: [
      'Balance access control with usability—core platform engineering muscle.',
      'Design guardrails that prevent noisy neighbors from overwhelming the system.'
    ],
    vibeTips: [
      'Imagine throwing a festival—each stage needs space, power, and a soundcheck schedule.'
    ],
    actions: [
      { command: 'codex-synaptic tenant create acme', description: 'Create a tenant and instantly see default quota scaffolding.' },
      { command: 'codex-synaptic tenant quota acme --set maxConcurrentTasks=5', description: 'Tune resource limits the way ops teams tweak autoscalers.' }
    ],
    docs: [
      { label: 'docs/architecture/multi-tenancy.md', description: 'Architecture notes on isolation, quotas, and tenant orchestration.' }
    ]
  }
);

tenantCmd
  .command('list')
  .option('--limit <count>', 'Number of tenants to display', '20')
  .option('--token <token>', 'API token with tenant.read permission')
  .action(handleCommand('tenant.list', async (options) => {
    const limit = parseInteger(options.limit ?? '20', 'limit');
    await useSystem('tenant list', async (system) => {
      if (!system.isMultiTenancyEnabled()) {
        console.log(chalk.yellow('Multi-tenancy is disabled. Set CODEX_TENANCY_ENABLED=1 to enable tenant commands.'));
        return;
      }
      await authorizeTenantAction(system, 'read', options.token);
      const manager = system.getTenantManager();
      const tenants = await manager.listTenants(limit);
      if (!tenants.length) {
        console.log(chalk.gray('No tenants configured.'));
        return;
      }
      console.log(chalk.blue('🏢 Registered Tenants'));
      tenants.forEach((tenant, index) => {
        console.log(chalk.cyan(`\n${index + 1}. ${tenant.id}`));
        console.log(chalk.gray(`   Name: ${tenant.name}`));
        console.log(chalk.gray(`   Status: ${tenant.status}`));
        console.log(chalk.gray(`   Created: ${tenant.createdAt}`));
        if (tenant.metadata) {
          console.log(chalk.gray(`   Metadata: ${JSON.stringify(tenant.metadata)}`));
        }
      });
    });
  }));

tenantCmd
  .command('create')
  .requiredOption('--name <name>', 'Tenant display name')
  .option('--id <tenantId>', 'Explicit tenant identifier (defaults to generated UUID)')
  .option('--metadata <json>', 'Optional metadata JSON payload')
  .option('--token <token>', 'API token with tenant.write permission')
  .action(handleCommand('tenant.create', async (options) => {
    const metadata = parseJsonOption(options.metadata);
    await useSystem('tenant create', async (system) => {
      if (!system.isMultiTenancyEnabled()) {
        console.log(chalk.yellow('Multi-tenancy is disabled. Set CODEX_TENANCY_ENABLED=1 to enable tenant commands.'));
        return;
      }
      await authorizeTenantAction(system, 'write', options.token);
      const manager = system.getTenantManager();
      const record = await manager.createTenant({
        name: options.name,
        id: options.id,
        metadata
      });
      console.log(chalk.green(`✅ Tenant "${record.id}" created`));
      if (record.metadata) {
        console.log(chalk.gray(`   Metadata: ${JSON.stringify(record.metadata)}`));
      }
    });
  }));

tenantCmd
  .command('show')
  .argument('<tenantId>', 'Tenant identifier to inspect')
  .option('--token <token>', 'API token with tenant.read permission')
  .action(handleCommand('tenant.show', async (tenantId: string, options) => {
    await useSystem('tenant show', async (system) => {
      if (!system.isMultiTenancyEnabled()) {
        console.log(chalk.yellow('Multi-tenancy is disabled. Set CODEX_TENANCY_ENABLED=1 to enable tenant commands.'));
        return;
      }
      await authorizeTenantAction(system, 'read', options?.token);
      const manager = system.getTenantManager();
      const tenant = await manager.getTenant(tenantId);
      if (!tenant) {
        console.log(chalk.yellow(`Tenant "${tenantId}" not found.`));
        return;
      }
      console.log(chalk.blue(`Tenant ${tenant.id}`));
      console.log(chalk.gray(`   Name: ${tenant.name}`));
      console.log(chalk.gray(`   Status: ${tenant.status}`));
      console.log(chalk.gray(`   Created: ${tenant.createdAt}`));
      console.log(chalk.gray(`   Updated: ${tenant.updatedAt}`));
      if (tenant.metadata) {
        console.log(chalk.gray(`   Metadata: ${JSON.stringify(tenant.metadata)}`));
      }
      const policy = await manager.getPolicy(tenantId);
      if (policy) {
        console.log(chalk.gray(`   Policy: ${JSON.stringify(policy)}`));
      } else {
        console.log(chalk.gray('   Policy: <none>'));
      }
      const effectiveQuota = await manager.getQuota(tenantId);
      if (effectiveQuota) {
        console.log(chalk.gray(`   Effective quota: ${JSON.stringify(effectiveQuota)}`));
      } else {
        console.log(chalk.gray('   Effective quota: <none>'));
      }
      const defaultQuota = manager.getDefaultQuota();
      if (defaultQuota) {
        console.log(chalk.gray(`   Default quota: ${JSON.stringify(defaultQuota)}`));
      }
    });
  }));

tenantCmd
  .command('quota')
  .argument('<tenantId>', 'Tenant identifier to update')
  .option('--max-concurrent <count>', 'Maximum concurrent tasks for the tenant')
  .option('--cpu <percent>', 'Optional CPU utilisation limit percentage (0-100)')
  .option('--memory <mb>', 'Optional memory limit in megabytes (>0)')
  .option('--clear', 'Remove tenant-specific quota overrides and fall back to defaults')
  .option('--token <token>', 'API token with tenant.write permission')
  .action(handleCommand('tenant.quota', async (tenantId: string, options) => {
    await useSystem('tenant quota', async (system) => {
      if (!system.isMultiTenancyEnabled()) {
        console.log(chalk.yellow('Multi-tenancy is disabled. Set CODEX_TENANCY_ENABLED=1 to enable tenant commands.'));
        return;
      }
      await authorizeTenantAction(system, 'write', options?.token);
      const manager = system.getTenantManager();
      const tenant = await manager.getTenant(tenantId);
      if (!tenant) {
        console.log(chalk.yellow(`Tenant "${tenantId}" not found.`));
        return;
      }

      const hasQuotaFlags =
        options.clear ||
        options.maxConcurrent !== undefined ||
        options.cpu !== undefined ||
        options.memory !== undefined;

      if (!hasQuotaFlags) {
        console.log(chalk.yellow('Provide at least one quota flag (--max-concurrent/--cpu/--memory) or use --clear.'));
        return;
      }

      if (options.clear && (options.maxConcurrent !== undefined || options.cpu !== undefined || options.memory !== undefined)) {
        throw new Error('Cannot combine --clear with quota values.');
      }

      const policyInput: { tenantId: string; quota?: TenantQuota | null } = { tenantId };

      if (options.clear) {
        policyInput.quota = null;
      } else {
        const quota: TenantQuota = {};
        if (options.maxConcurrent !== undefined) {
          const maxConcurrent = parseInteger(options.maxConcurrent, 'maxConcurrent');
          if (maxConcurrent < 0) {
            throw new Error('maxConcurrent must be a non-negative integer');
          }
          quota.maxConcurrentTasks = maxConcurrent;
        }
        if (options.cpu !== undefined) {
          const cpu = Number.parseFloat(options.cpu);
          if (!Number.isFinite(cpu) || cpu <= 0 || cpu > 100) {
            throw new Error('cpu must be a number between 0 and 100');
          }
          quota.cpuLimitPercent = cpu;
        }
        if (options.memory !== undefined) {
          const memory = Number.parseFloat(options.memory);
          if (!Number.isFinite(memory) || memory <= 0) {
            throw new Error('memory must be a number greater than 0');
          }
          quota.memoryLimitMb = memory;
        }
        if (!Object.keys(quota).length) {
          console.log(chalk.yellow('No quota fields provided. Use --clear to remove overrides.'));
          return;
        }
        policyInput.quota = quota;
      }

      const updatedPolicy = await manager.upsertPolicy(policyInput);
      const effectiveQuota = await manager.getQuota(tenantId);
      const defaultQuota = manager.getDefaultQuota();

      console.log(chalk.green(`✅ Tenant "${tenantId}" quota updated`));
      const policyQuota = updatedPolicy.quota === null ? '<default>' : JSON.stringify(updatedPolicy.quota);
      console.log(chalk.gray(`   Policy quota: ${policyQuota}`));
      console.log(
        chalk.gray(
          `   Effective quota: ${effectiveQuota ? JSON.stringify(effectiveQuota) : '<none>'}`
        )
      );
      if (defaultQuota) {
        console.log(chalk.gray(`   Default quota: ${JSON.stringify(defaultQuota)}`));
      }
    });
  }));

// Tools commands
const toolsCmd = decorateCommandHelp(
  program
    .command('tools')
    .description('Score tools, review usage, and tune optimizer hints'),
  {
    title: 'Tool Shed Sessions',
    subtitle: 'Curate which utilities agents should vibe with and why.',
    context: [
      'Keeping track of tool success mirrors managing feature flags and A/B tests.',
      'Scoring candidates teaches prompt engineers to rely on telemetry, not hunches.'
    ],
    skills: [
      'Interpret precision/recall style metrics to choose the best automation helpers.',
      'Log feedback loops so the optimizer can learn like a seasoned mentor.'
    ],
    vibeTips: [
      'Treat every tool like a pedal in a guitar rig—only keep the pedals that enhance the set.'
    ],
    actions: [
      { command: 'codex-synaptic tools score', description: 'Evaluate tool candidates with ranking telemetry output.' },
      { command: 'codex-synaptic tools history', description: 'Review the tool performances to decide who stays on the roster.' }
    ],
    docs: [
      { label: 'docs/tools/optimizer.md', description: 'Understand the scoring heuristics and how to extend them.' }
    ]
  }
);

toolsCmd
  .command('score')
  .description('Evaluate tool candidates for the supplied prompt')
  .argument('<prompt>', 'Prompt to evaluate')
  .requiredOption('-c, --candidates <file>', 'Path to JSON file containing tool candidate definitions')
  .option('-l, --history <count>', 'History limit for telemetry lookback', '200')
  .option('--json', 'Output tool scoring results as JSON')
  .action(handleCommand('tools.score', async (prompt: string, options) => {
    const candidates = loadToolCandidates(options.candidates);
    const historyLimit = Number.parseInt(options.history ?? '200', 10);

    await useSystem('tools score', async (system) => {
      const optimizer = new ToolOptimizer(system.getMemorySystem(), { historyLimit });
      const scores = await optimizer.evaluateTools(prompt, candidates);

      if (!scores.length) {
        if (options.json) {
          console.log(JSON.stringify({ prompt, scores: [], generatedAt: new Date().toISOString() }, null, 2));
        } else {
          console.log(chalk.gray('No tool candidates available for scoring.'));
        }
        return;
      }

      if (options.json) {
        const payload = {
          prompt,
          generatedAt: new Date().toISOString(),
          scores
        };
        console.log(JSON.stringify(payload, null, 2));
      } else {
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
      }
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
const reasoningCmd = decorateCommandHelp(
  program
    .command('reasoning')
    .description('Design reasoning plans and manage checkpoint archives'),
  {
    title: 'Reasoning Lab',
    subtitle: 'Sketch tree-of-thought plans and checkpoint them like a story arc.',
    context: [
      'Structured reasoning plans tame hallucinations just like architecture reviews corral scope creep.',
      'Checkpointing echoes incident retros—documenting turning points keeps teams aligned.'
    ],
    skills: [
      'Compare ToT and ReAct planning styles so you can match cognition patterns to unique prompts.',
      'Balance consensus gates with autonomy the way senior leads juggle PR approvals.'
    ],
    vibeTips: [
      'Treat every branch like a synth track—solo the best one but keep the stems archived.'
    ],
    actions: [
      { command: 'codex-synaptic reasoning plan "Stabilize the repo"', description: 'Spin up a quick ToT scaffold and inspect the best branch rationale.' },
      { command: 'codex-synaptic reasoning history', description: 'Review recent plans and see how checkpoints tell the narrative.' }
    ],
    docs: [
      { label: 'docs/tree-of-thought.md', description: 'Deep dive into the ToT patterns this CLI surfaces.' }
    ]
  }
);

reasoningCmd
  .command('plan')
  .argument('<prompt>', 'Reasoning prompt to analyze')
  .option('--type <type>', 'Plan type (tot|react|custom)', 'tot')
  .option('--require-consensus', 'Require consensus approval before execution')
  .option('--metadata <json>', 'Attach metadata JSON payload')
  .option('--branches <count>', 'Tree-of-Thought branch count')
  .option('--iterations <count>', 'Monte Carlo iteration count')
  .option('--seed <number>', 'Random seed for deterministic plans')
  .option('--json', 'Output reasoning plan metadata as JSON')
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
      if (options.json) {
        console.log(JSON.stringify({ prompt, plan: result }, null, 2));
      } else {
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
const routerCmd = decorateCommandHelp(
  program
    .command('router')
    .description('Inspect routing policies and run evaluation simulators'),
  {
    title: 'Routing Control Room',
    subtitle: 'Shape how prompts pick their perfect agent wingman.',
    context: [
      'Routing policies echo API gateways deciding which microservice wakes up for a request.',
      'Simulation loops mirror canary rollouts—validate rules before live traffic arrives.'
    ],
    skills: [
      'Translate natural language cues into rule engines that stay explainable.',
      'Blend tool scoring with agent preferences like orchestrating an air-traffic deck.'
    ],
    vibeTips: [
      'Think of agents as DJs and routing policies as the set list you curate for the night.'
    ],
    actions: [
      { command: 'codex-synaptic router evaluate "Refactor the mesh service"', description: 'Preview which agent type the rules crown as lead.' },
      { command: 'codex-synaptic router rules --list', description: 'Audit rule precedence and see who is really running the show.' }
    ],
    docs: [
      { label: 'docs/architecture.md', description: 'Review how routing fits into the broader Codex-Synaptic topology.' }
    ]
  }
);

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
  .option('--json', 'Output routing evaluation as JSON')
  .action(handleCommand('router.evaluate', async (prompt, options) => {
    await useSystem('router evaluate', async (system) => {
      const router = new RoutingPolicyService(undefined, {
        toolOptimizer: system.getToolOptimizer()
      });

      try {
        if (!options.json) {
          console.log(chalk.cyan('🔄 Evaluating routing for prompt...'));
        }

        const toolCandidates = options.tools ? loadToolCandidates(options.tools) : undefined;
        const contextFeedforward = options.context ? loadFileThroughFeedforward(options.context) : undefined;

        const request = {
          prompt,
          toolPrompt: options.toolPrompt ? String(options.toolPrompt) : undefined,
          toolCandidates,
          context: contextFeedforward
            ? {
                fileContext: contextFeedforward.toJson()
              }
            : undefined,
          constraints: {
            excludeAgents: options.exclude ? options.exclude.split(',').map((s: string) => s.trim()) : undefined,
            preferredAgents: options.prefer ? options.prefer.split(',').map((s: string) => s.trim()) : undefined
          }
        } as RoutingRequest;

        const evaluation = await router.evaluateRouting(request);

        if (options.json) {
          const payload = {
            prompt,
            evaluation
          };
          console.log(JSON.stringify(payload, null, 2));
          return;
        }

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
const agentCmd = decorateCommandHelp(
  program
    .command('agent')
    .description('List, inspect, and operate on registered agents'),
  {
    title: 'Agent Green Room',
    subtitle: 'Manage the talent roster powering Codex-Synaptic sessions.',
    context: [
      'Agent registries behave like service catalogs—knowing who is available unlocks quick routing decisions.',
      'Replica management echoes Kubernetes deployments where you dial the scale knob per workload.'
    ],
    skills: [
      'Read capability manifests so you can pair prompts with the right specialties.',
      'Inspect runtime stats to practice proactive incident response.'
    ],
    vibeTips: [
      'Treat status like backstage access—only green-light the performers that keep the crowd hyped.'
    ],
    actions: [
      { command: 'codex-synaptic agent list', description: 'See the current cast and their capabilities at a glance.' },
      { command: 'codex-synaptic agent deploy --type planner --replicas 2', description: 'Scale a specialty when the storyline demands more hands.' }
    ],
    docs: [
      { label: 'docs/architecture/multi-tenancy.md', description: 'Understand how agents plug into the broader orchestration surface.' }
    ]
  }
);

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
const meshCmd = decorateCommandHelp(
  program
    .command('mesh')
    .description('Steer neural mesh topology and runtime windows'),
  {
    title: 'Mesh Control Tower',
    subtitle: 'Shape connectivity so agents riff off each other without feedback whine.',
    context: [
      'Topology tweaks mirror distributed systems tuning—small graph changes can unlock huge resilience gains.',
      'Connection caps feel like circuit breakers, protecting clusters from overload spirals.'
    ],
    skills: [
      'Experiment with node counts to understand scaling curves before production traffic hits.',
      'Read mesh status like a network map, spotting hot spots before they melt servers.'
    ],
    vibeTips: [
      'Imagine each node as a synth module—rewire the patch bay until the groove feels tight.'
    ],
    actions: [
      { command: 'codex-synaptic mesh configure --nodes 7 --topology ring', description: 'Prototype resilience profiles with alternate graph layouts.' },
      { command: 'codex-synaptic mesh status', description: 'Glance at connectivity health after the adjustments land.' }
    ],
    docs: [
      { label: 'docs/architecture.md', description: 'See how the neural mesh underpins the wider orchestration mesh.' }
    ]
  }
);

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
const swarmCmd = decorateCommandHelp(
  program
    .command('swarm')
    .description('Coordinate swarm optimizers and runtime limits'),
  {
    title: 'Swarm Playground',
    subtitle: 'Tune optimisation algorithms until the fitness curve sings.',
    context: [
      'Swarm strategies mirror real ML hyperparameter sweeps—small knobs change convergence speed.',
      'Runtime guards behave like autoscaling policies, keeping compute budget aligned with demand.'
    ],
    skills: [
      'Compare PSO, ACO, and hybrid flows so you can pick the right optimiser per mission.',
      'Read status telemetry to decide when to stop or escalate experiments.'
    ],
    vibeTips: [
      'Picture a flock of drones—you choreograph the formation so they never collide mid-air.'
    ],
    actions: [
      { command: 'codex-synaptic swarm start --algorithm pso --objective latency', description: 'Launch an experiment and observe how objectives shift the run.' },
      { command: 'codex-synaptic swarm status', description: 'Check convergence stats without popping open a profiler.' }
    ],
    docs: [
      { label: 'docs/guides/adaptive-tooling.md', description: 'Learn how swarm tuning feeds into adaptive tooling decisions.' }
    ]
  }
);

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
const bridgeCmd = decorateCommandHelp(
  program
    .command('bridge')
    .description('Manage MCP and A2A bridge connections'),
  {
    title: 'Bridge Ops Bay',
    subtitle: 'Wire Codex-Synaptic into external agents without dropping packets.',
    context: [
      'Bridging flows resemble message buses—payload contracts matter as much as bandwidth.',
      'Testing connections upfront saves the late-night scramble when integrations misbehave.'
    ],
    skills: [
      'Design payload schemas that play nice with remote runtimes.',
      'Trace message flow end-to-end to sharpen your distributed debugging instincts.'
    ],
    vibeTips: [
      'Imagine you are splicing two mixtapes—levels need to match before the crossfade.'
    ],
    actions: [
      { command: 'codex-synaptic bridge mcp-send --endpoint docs --payload "{\\"ping\\":true}"', description: 'Dry-run MCP connectivity and inspect the reply contract.' },
      { command: 'codex-synaptic bridge a2a-send agent-1 --message "{\\"op\\":\\"ping\\"}"', description: 'Send a friendly ping across the agent-to-agent bus.' }
    ],
    docs: [
      { label: 'docs/mcp/README.md', description: 'Connector architecture, auth models, and troubleshooting tips.' }
    ]
  }
);

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
const consensusCmd = decorateCommandHelp(
  program
    .command('consensus')
    .description('Drive consensus configuration and vote flows'),
  {
    title: 'Consensus Forum',
    subtitle: 'Tune decision engines so every proposal gets a fair hearing.',
    context: [
      'Consensus settings mirror distributed databases—timeouts and quorum math decide stability.',
      'Stake and voting flows teach the same lessons as DAO governance and Raft clusters.'
    ],
    skills: [
      'Analyse telemetry to spot Byzantine failures before they trigger incidents.',
      'Experiment with mechanisms to map requirements to Raft, BFT, or proof-of-stake models.'
    ],
    vibeTips: [
      'Think of it as band democracy—set the rules so solos land on beat without chaos.'
    ],
    actions: [
      { command: 'codex-synaptic consensus mode --set bft --timeout 8000', description: 'Reconfigure the decision engine and feel the latency shift.' },
      { command: 'codex-synaptic consensus telemetry --limit 5', description: 'Review recent proposals and learn from their vote breakdown.' }
    ],
    docs: [
      { label: 'docs/architecture/multi-tenancy.md', description: 'Understand how consensus supports guardrails across tenants.' }
    ]
  }
);

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
const taskCmd = decorateCommandHelp(
  program
    .command('task')
    .description('Kick off workflows and inspect task lifecycle'),
  {
    title: 'Task Dispatch Desk',
    subtitle: 'Launch workflows and watch the stage cues roll in.',
    context: [
      'Workflow prompts behave like runbooks—clear intent yields predictable automation.',
      'Recent task views feel like incident timelines, helping you narrate outcomes with receipts.'
    ],
    skills: [
      'Author prompts that pair nicely with Codex context blocks.',
      'Interpret stage events to debug long-running flows without cracking open logs.'
    ],
    vibeTips: [
      'Cue tasks like tracks in a DJ set—set the energy, then let the automation groove.'
    ],
    actions: [
      { command: 'codex-synaptic task submit "Audit the instructions cache"', description: 'Kick off a workflow and stream its stage-by-stage story.' },
      { command: 'codex-synaptic task recent', description: 'Grab a quick highlight reel of what just shipped.' }
    ],
    docs: [
      { label: 'docs/guides/quick-start.md', description: 'Follow the end-to-end workflow primer for Codex-Synaptic.' }
    ]
  }
);

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
const hiveMindCmd = decorateCommandHelp(
  program
    .command('hive-mind')
    .description('Launch hive-mind workflows and Codex passthroughs'),
  {
    title: 'Hive Control Stage',
    subtitle: 'Summon squads of agents and channel Codex context on demand.',
    context: [
      'Hive-mind orchestration blends task graphs with swarm tuning—perfect rehearsal for complex delivery pipelines.',
      'Codex passthrough options show how docs-as-context sharpens LLM reasoning.'
    ],
    skills: [
      'Balance agent counts, mesh topology, and consensus gates without drowning in flags.',
      'Dry-run prompts to preview the Codex context story before committing compute.'
    ],
    vibeTips: [
      'Approach it like stage management—lights, sound, and dancers all need their cues.'
    ],
    actions: [
      { command: 'codex-synaptic hive-mind spawn "Stabilize the mesh adapter" --codex', description: 'Launch a Codex-boosted workflow with the vibe-rich defaults.' },
      { command: 'codex-synaptic hive-mind spawn "Dry run" --dry-run --yaml', description: 'Preview the context payload without firing agents.' }
    ],
    docs: [
      { label: 'docs/cli/codex-passthrough.md', description: 'Understand Codex passthrough flags and interactive guardrails.' }
    ]
  }
);

hiveMindCmd
  .command('spawn')
  .description('Spawn a coordinated hive-mind workflow from a prompt')
  .argument('<prompt...>', 'Natural language description of the task/goal')
  .option('--strategy <type>', 'Coordination strategy (classic|goap)', 'classic')
  .option('--goap-profile <id>', 'GOAP manifest identifier to execute when using the goap strategy')
  .option('--goap-goal <id>', 'Override GOAP goal identifier for the selected manifest')
  .option('--goap-dry-run', 'Preview GOAP actions without mutating the filesystem')
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

    const originalPrompt = prompt;
    const strategy = (options.strategy ?? 'classic').toLowerCase();

    if (strategy === 'goap') {
      await useSystem('hive-mind goap', async (system) => {
        let manifest = options.goapProfile
          ? await goapRegistry.getManifest(options.goapProfile)
          : await goapRegistry.matchManifest(originalPrompt);

        if (!manifest && options.goapProfile) {
          throw new Error(`GOAP manifest "${options.goapProfile}" was not found in config/goap.`);
        }

        if (!manifest) {
          throw new Error(
            'No GOAP manifest matched the prompt. Provide --goap-profile to select a manifest explicitly.'
          );
        }

        const goalId = options.goapGoal ?? manifest.defaultGoal ?? manifest.goals[0]?.id;
        if (!goalId) {
          throw new Error(`GOAP manifest ${manifest.id} does not define a usable goal.`);
        }

        console.log(
          chalk.blue(
            `🧭 Executing GOAP profile ${manifest.metadata?.name ?? manifest.id} (goal: ${goalId})`
          )
        );

        const executor = new GoapExecutor(system);
        const result = await executor.execute(manifest, {
          goalId,
          prompt: originalPrompt,
          dryRun: Boolean(options.goapDryRun)
        });

        console.log(
          chalk.green(
            `✅ GOAP workflow complete — ${result.actionsCompleted}/${result.totalActions} actions executed.`
          )
        );

        if (result.artifacts.length) {
          console.log(chalk.cyan('📦 Generated artifacts:'));
          for (const artifact of result.artifacts) {
            console.log(chalk.gray(`  • ${artifact}`));
          }
        }
      });
      return;
    }

    if (strategy !== 'classic') {
      throw new Error(`Unsupported hive-mind strategy: ${strategy}`);
    }

    const autoAttachCodex = shouldAutoAttachCodexContext(prompt);
    const codexRequested = options.codex || autoAttachCodex;

    if (options.dryRun && !codexRequested) {
      throw new Error('--dry-run can only be used together with --codex');
    }

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

const observabilityCmd = decorateCommandHelp(
  program
    .command('observability')
    .description('Export metrics, dashboards, and tracing templates'),
  {
    title: 'Telemetry Lounge',
    subtitle: 'Spin up dashboards and capture metrics before the trail goes cold.',
    context: [
      'Dashboards are backstage monitors—build them early to avoid late-night blind hunts.',
      'Metrics exports double as compliance receipts and fine-tuning datasets alike.'
    ],
    skills: [
      'Pick the golden signals that actually reflect user experience.',
      'Automate observability scaffolding so teams never start from blank graphs.'
    ],
    vibeTips: [
      'Treat charts like album art—make the narrative obvious even at a glance.'
    ],
    actions: [
      { command: 'codex-synaptic observability template', description: 'Generate a Grafana-ready baseline in seconds.' }
    ],
    docs: [
      { label: 'docs/observability/README.md', description: 'Deep dive on metrics, dashboards, and tracing flows.' }
    ]
  }
);

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

const envCmd = decorateCommandHelp(
  program
    .command('env')
    .description('Control local services, GPU detection, and env scaffolding'),
  {
    title: 'Environment Ops Bar',
    subtitle: 'Spin up local stacks and stay ahead of service drift.',
    context: [
      'Service profiles behave like docker-compose presets—perfect rehearsal for staging rollouts.',
      'Health-check waits train you to respect readiness gates before unleashing traffic.'
    ],
    skills: [
      'Coordinate multiple docker-compose surfaces without losing track of logs.',
      'Read status reports to troubleshoot infra hiccups before they block the team.'
    ],
    vibeTips: [
      'Approach profiles like pedalboard presets—switch the stack to fit the jam.'
    ],
    actions: [
      { command: 'codex-synaptic env up dev-core', description: 'Boot the default profile and confirm health checks pass.' },
      { command: 'codex-synaptic env plan', description: 'Preview compose files so you know what each preset activates.' }
    ],
    docs: [
      { label: 'docs/architecture.md', description: 'See how local services mirror the production topology.' }
    ]
  }
);

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

const memoryCmd = decorateCommandHelp(
  program
    .command('memory')
    .description('Inspect memory stores, TTLs, and usage snapshots'),
  {
    title: 'Memory Archive',
    subtitle: 'Browse what the platform remembers and when it expires.',
    context: [
      'Vector and document stores fuel retrieval workflows—stay aware of what data you are shipping.',
      'TTL hygiene mirrors cache management in production systems and prevents stale context.'
    ],
    skills: [
      'Audit namespaces to verify sensitive data is scoped correctly.',
      'Sample entries to design better prompts and follow-up workflows.'
    ],
    vibeTips: [
      'Treat the archive like a crate-digging session—pull the right samples for your next mix.'
    ],
    actions: [
      { command: 'codex-synaptic memory status', description: 'Glance at namespace counts and confirm TTL coverage.' },
      { command: 'codex-synaptic memory list tot_runs --limit 3', description: 'Review Tree-of-Thought history before planning the sequel.' }
    ],
    docs: [
      { label: 'docs/observability/README.md', description: 'Telemetry storage notes overlap with memory maintenance tips.' }
    ]
  }
);

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

const cheatsCmd = decorateCommandHelp(
  program
    .command('cheats')
    .description('Run curated cheat-code playbooks for rapid ops'),
  {
    title: 'Cheat Code Cabinet',
    subtitle: 'Trigger pre-baked playbooks when you need quick wins.',
    context: [
      'Cheat codes package institutional knowledge—share them to shrink onboarding time.',
      'Syncing the compendium resembles sharing runbooks or terraform modules in real teams.'
    ],
    skills: [
      'Curate reusable prompts that capture best practices and guardrails.',
      'Publish knowledge artifacts to memory to keep the squad in sync.'
    ],
    vibeTips: [
      'Treat cheats like easter eggs—name them for quick recall and a dash of fun.'
    ],
    actions: [
      { command: 'codex-synaptic cheats list', description: 'Discover the current catalog of rapid-fire boosts.' },
      { command: 'codex-synaptic cheats sync', description: 'Push the cheat compendium into shared memory for teammates.' }
    ],
    docs: [
      { label: 'docs/codex-synaptic-cheat-codes.md', description: 'Source material for every cheat code in the library.' }
    ]
  }
);

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
const interactiveCmd = decorateCommandHelp(
  program
    .command('interactive')
    .alias('i')
    .description('Start interactive mode'),
  {
    title: 'Interactive Lounge',
    subtitle: 'Tap through dashboards and menus without memorising flags.',
    context: [
      'Interactive shells mirror internal tooling consoles—perfect for demos and onboarding.',
      'Menu flows showcase how to expose automation safely to non-CLI teammates.'
    ],
    skills: [
      'Navigate system insights quickly to triage incidents or live-share status.',
      'Experiment with commands in a guided flow before scripting them.'
    ],
    vibeTips: [
      'Use it like a control surface—flip between modules and keep the music rolling.'
    ],
    actions: [
      { command: 'codex-synaptic interactive', description: 'Launch the console UI and explore each menu at your pace.' }
    ],
    docs: [
      { label: 'docs/cli/interactive-mode-enhancements.md', description: 'Feature tour and roadmap for the interactive cockpit.' }
    ]
  }
);

interactiveCmd
  .action(handleCommand('interactive', async () => {
    const previousConsoleLevel = rootLogger.getConsoleLevel();
    rootLogger.setConsoleLevel(LogLevel.WARN);
    try {
      await useSystem('interactive', async (system) => {
        console.log(chalk.green('🎛️  Welcome to Codex-Synaptic Interactive Mode!'));
        renderInteractiveHints();
        await renderSystemDashboard(system);
        let exit = false;
        while (!exit) {
          const { action } = await inquirer.prompt<{ action: string }>([
            {
              type: 'list',
              name: 'action',
              message: 'Main menu:',
              choices: (() => {
                const items: Array<{ name: string; value: string }> = [
                  { name: 'System dashboard & controls', value: 'system' },
                  { name: 'Agent operations', value: 'agents' },
                  { name: 'Neural mesh controls', value: 'mesh' },
                  { name: 'Swarm intelligence', value: 'swarm' },
                  { name: 'Hive-mind orchestration', value: 'hive' },
                  { name: 'Consensus management', value: 'consensus' },
                  { name: 'Task & router workflows', value: 'tasks' },
                  { name: 'Telemetry snapshot', value: 'telemetry' },
                  { name: 'Run CLI command', value: 'command' }
                ];

                if (backgroundJobs.size) {
                  items.push({
                    name: `View background commands (${backgroundJobs.size})`,
                    value: 'background'
                  });
                }

                items.push({ name: 'Exit (keep system running)', value: 'exit' });
                items.push({ name: 'Exit & shutdown system', value: 'shutdown' });

                return items;
              })()
            }
          ]);

          switch (action) {
            case 'system':
              await interactiveSystemMenu();
              break;
            case 'agents':
              await interactiveAgentsMenu();
              break;
            case 'mesh':
              await interactiveMeshMenu();
              break;
            case 'swarm':
              await interactiveSwarmMenu();
              break;
            case 'hive':
              await interactiveHiveMindMenu();
              break;
            case 'consensus':
              await interactiveConsensusMenu();
              break;
            case 'tasks':
              await interactiveTasksMenu();
              break;
            case 'telemetry':
              renderTelemetry();
              console.log('');
              break;
            case 'command':
              await interactiveCommandRunner();
              break;
            case 'background':
              renderBackgroundJobs();
              break;
            case 'shutdown':
              await session.shutdown('interactive-exit');
              exit = true;
              break;
            case 'exit':
            default:
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

// Codex CLI Passthrough Handler
// Intercept commands with --codex flag and pass through to Codex CLI
// Similar to claude-flow's --claude flag
(async () => {
  const args = process.argv.slice(2);
  
  // Check if --codex flag is present (but not in hive-mind spawn or cheat which have their own --codex handling)
  const hasCodexFlag = args.includes('--codex');
  const isHiveMindSpawn = args[0] === 'hive-mind' && args[1] === 'spawn';
  const isCheatCommand = args[0] === 'cheat';
  
  if (hasCodexFlag && !isHiveMindSpawn && !isCheatCommand) {
    // This is a passthrough request
    console.log(chalk.cyan('🔀 Codex CLI Passthrough Mode Activated'));
    console.log(chalk.gray('   Enriching command with Codex-Synaptic platform context...'));
    console.log('');
    
    // Remove --codex flag from args
    const passthroughArgs = args.filter(arg => arg !== '--codex');
    const isDryRun = passthroughArgs.includes('--dry-run');
    const isVerbose = passthroughArgs.includes('--verbose') || passthroughArgs.includes('-v');
    
    // Extract command (first non-flag argument)
    const command = passthroughArgs.find(arg => !arg.startsWith('-')) || 'help';
    const commandArgs = passthroughArgs.filter(arg => arg !== command);
    
    // Check if Codex CLI is available
    if (!isCodexCliAvailable() && !isDryRun) {
      console.error(chalk.red('❌ Codex CLI not found!'));
      console.error('');
      console.error(chalk.yellow('The --codex flag requires the OpenAI Codex CLI to be installed.'));
      console.error('');
      console.error(chalk.cyan('Installation options:'));
      console.error(chalk.gray('  npm install -g @openai/codex-cli'));
      console.error(chalk.gray('  # or'));
      console.error(chalk.gray('  brew install openai/tap/codex-cli'));
      console.error('');
      console.error(chalk.gray('Alternatively, remove the --codex flag to run the command locally.'));
      process.exit(1);
    }
    
    try {
      // Get current system state if running
      const system = session.getSystemUnsafe();
      
      const result = await executeCodexPassthrough({
        command,
        args: commandArgs,
        system: system || undefined,
        projectRoot: process.cwd(),
        dryRun: isDryRun,
        verbose: isVerbose
      });
      
      process.exit(result.exitCode);
    } catch (error: any) {
      console.error(chalk.red('Passthrough error:'), error.message);
      process.exit(1);
    }
  }
  
  // Normal command processing
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
})();
