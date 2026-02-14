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
  type BackgroundStatus,
  getBackgroundStatus,
  getBackgroundRuntimeSnapshot,
  queryBackgroundRuntimeSnapshot,
  restartBackgroundSystem,
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
import { CliGateError, ErrorCode, RetryManager } from '../core/errors.js';
import { DaemonConflictError } from '../core/errors.js';
import { HiveMindYamlFormatter } from '../utils/yaml-output.js';
import { parseFileContent, parseJsonInput, loadFileThroughFeedforward } from './feedforward.js';
import { InstructionParser } from '../instructions/index.js';
import { RoutingPolicyService, type RoutingRequest } from '../router/index.js';
import { readFileSync, existsSync } from 'fs';
import { join, resolve, relative } from 'path';
import { spawnSync, execFile } from 'child_process';
import { promisify } from 'util';
import { ToolOptimizer, type ToolCandidate } from '../tools/optimizer/index.js';
import { type ToolUsageRecord, type ReasoningRunRecord } from '../memory/memory-system.js';
import type { ReasoningPlanOptions, ReasoningCompletionOptions, ReasoningCheckpointInput } from '../reasoning/planner.js';
import { goapRegistry } from '../reasoning/goap/registry.js';
import { GoapExecutor } from '../reasoning/goap/executor.js';
import type { InterfaceMode, InterfaceTier, SystemConfiguration } from '../core/config.js';
import { serviceManager } from '../env/service-manager.js';
import {
  executeStrategy,
  getSupportedStrategies,
  type StrategyExecutionResult,
  type SupportedStrategy
} from '../reasoning/strategies/index.js';
import { executeCodexPassthrough, isCodexCliAvailable } from './codex-passthrough.js';
import {
  ensureSystemBootstrapEnv,
  normalizeConsensusMechanism,
  parseLogLevelOption
} from './utils/runtime-helpers.js';
import {
  formatAgentStats,
  formatResourceStats,
  formatMeshStats,
  formatSwarmStats,
  formatConsensusStats,
  formatRecentTasks,
  type TelemetrySnapshot
} from './telemetry-renderer.js';
import { startTui, type TuiRuntimeSnapshot } from '../tui/index.js';
import { executeOrchestrationPhases } from './hive-mind-orchestrator.js';
import {
  validateQuotaOptions,
  buildPolicyInput,
  type QuotaOptions
} from './tenant-quota-helpers.js';
import {
  DEFAULT_MCP_PROFILES,
  parseProfileList,
  runDoctor
} from './doctor.js';
import { collectLaunchRemediations, runLaunch } from './launch.js';
  executeGoapWorkflow,
  executeTaskWithConsensus,
  collectExecutionResults,
  renderExecutionSummary,
  setupWorkflowEventHandlers
} from './hive-mind-helpers.js';
import {
  checkCliBuildArtifact,
  checkCliExecution,
  checkCodexAuth,
  renderHealthCheckResults,
  type HealthCheck
} from './doctor-helpers.js';

/**
 * Loads environment variables from a file into process.env.
 * 
 * @param filePath - Path to the environment file to load
 * @returns true if any variables were loaded, false otherwise
 * 
 * @remarks
 * - Skips variables that are already defined in process.env
 * - Handles quoted values and escape sequences (\n, \r, \t)
 * - Ignores comments (lines starting with #) and empty lines
 * - Returns false if file doesn't exist or can't be read
 */
function loadEnvFile(filePath: string): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    let applied = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      if (!key) {
        continue;
      }

      let value = line.slice(separatorIndex + 1).trim();
      if (!value) {
        value = '';
      }

      const startsWithQuote = value.startsWith('"') || value.startsWith("'");
      const endsWithQuote = value.endsWith('"') || value.endsWith("'");
      if (startsWithQuote && endsWithQuote && value.length >= 2) {
        value = value.slice(1, -1);
      }

      value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');

      if (process.env[key] === undefined) {
        process.env[key] = value;
        applied = true;
      }
    }

    return applied;
  } catch {
    return false;
  }
}

/**
 * Bootstraps CLI environment by loading environment files from standard locations.
 * 
 * @returns Array of successfully loaded environment file sources
 * 
 * @remarks
 * Attempts to load environment variables from the following files in order:
 * - .env in current directory
 * - .env.local in current directory
 * - ~/.codex-synaptic/.env
 * - .env in package root directory
 * Only loads variables that aren't already set in process.env
 */
function bootstrapCliEnv(): string[] {
  const sources: string[] = [];
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, '.env'),
    resolve(cwd, '.env.local'),
    resolve(cwd, 'src/cli/.env')
  ];

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    if (loadEnvFile(candidate)) {
      sources.push(candidate);
    }
  }

  return sources;
}

const loadedEnvSources = bootstrapCliEnv();

/**
 * Resolves whether CLI should auto-shutdown after command execution by 
 * interpreting the CODEX_CLI_AUTO_SHUTDOWN environment variable.
 * 
 * @returns true if auto-shutdown is enabled, false otherwise
 * 
 * @remarks
 * - Returns true if CODEX_CLI_AUTO_SHUTDOWN is not set or is empty (default behavior)
 * - Returns false if CODEX_CLI_AUTO_SHUTDOWN is '0', 'false', or 'no' (case-insensitive)
 * - Returns true for any other value
 */
function resolveCliAutoShutdown(): boolean {
  const raw = process.env.CODEX_CLI_AUTO_SHUTDOWN;
  // Default to auto-shutdown if the variable is not set or is an empty string.
  if (raw == null || raw.trim() === '') {
    return true;
  }

  const normalized = raw.trim().toLowerCase();
  const disablingValues = ['0', 'false', 'no'];
  return !disablingValues.includes(normalized);
}

const program = new Command();
const session = CliSession.getInstance();
const rootLogger = Logger.getInstance();
const cliSilent = process.env.CODEX_CLI_SILENT === '1';
const cliAutoShutdown = resolveCliAutoShutdown();
const advancedStrategyOptions = getSupportedStrategies();
const advancedStrategySet = new Set(advancedStrategyOptions);
const strategyOptionDescription = `Coordination strategy (${['classic', 'goap', ...advancedStrategyOptions].join('|')})`;
let envBootstrapLogged = false;

if (cliSilent) {
  rootLogger.setConsoleLevel(LogLevel.ERROR);
}

if (!cliSilent && loadedEnvSources.length) {
  console.log(
    chalk.gray(
      `⚙️  Environment variables loaded from ${loadedEnvSources
        .map((source) => relative(process.cwd(), source) || source)
        .join(', ')}`
    )
  );
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

/**
 * Decorates a Commander command with rich help text including context, skills, and documentation links.
 * 
 * @param command - The Commander command to decorate
 * @param options - Configuration for help text sections
 * @returns The decorated command with enhanced help output
 * 
 * @remarks
 * Adds formatted sections before the command's standard help text:
 * - Title and subtitle
 * - "Why it matters" context section
 * - "Dev skill boost" section
 * - Quick actions with example commands
 * - Documentation references
 * - Optional vibe tips for user engagement
 */
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

/**
 * Determines if Codex context should be automatically attached based on prompt content.
 * 
 * @param prompt - User prompt to analyze
 * @returns true if the prompt suggests repository-wide operations that benefit from context
 * 
 * @remarks
 * Returns true when the prompt contains both:
 * - Repository signals (repo, codebase, readme, docs, etc.)
 * - Intent signals (scan, analyze, inspect, refactor, optimize, etc.)
 * This heuristic helps attach AGENTS.md, README, and documentation automatically
 */
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

const CONSENSUS_ALWAYS_REQUIRED = new Set(['bft', 'pow', 'pos', 'hybrid']);

/**
 * Determines if consensus is required for a given prompt based on consensus mode and content.
 * 
 * @param prompt - User prompt to analyze
 * @param consensusMode - Current consensus mechanism (bft, raft, pow, pos, hybrid)
 * @returns true if consensus should be invoked
 * 
 * @remarks
 * Consensus is always required for BFT, PoW, PoS, and hybrid modes.
 * For RAFT mode, consensus is required only if the prompt contains
 * consensus-related keywords (consensus, quorum, vote, majority, byzantine)
 */
function shouldRequireConsensus(prompt: string, consensusMode: string): boolean {
  const normalized = normalizeConsensusMechanism(consensusMode);
  if (CONSENSUS_ALWAYS_REQUIRED.has(normalized)) {
    return true;
  }
  const lower = prompt.toLowerCase();
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

/**
 * Derives whether to accept or reject a proposal based on task outcome artifacts.
 * 
 * @param outcome - Task execution outcome with optional validation and lint results
 * @returns true if the outcome should be accepted, false if it should be rejected
 * 
 * @remarks
 * Rejection occurs if:
 * - Validation failed (validation.passed === false)
 * - Lint issues include error or fatal severity
 * Otherwise, defaults to acceptance
 */
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

/**
 * Orchestrates consensus voting process for a task outcome.
 * 
 * @param system - The Codex-Synaptic system instance
 * @param originalPrompt - Original user prompt that triggered the task
 * @param outcome - Task execution outcome to vote on
 * @param consensusMode - Consensus mechanism to use
 * @returns Result of consensus execution including vote counts and acceptance status
 * 
 * @remarks
 * Creates a proposal, submits it to consensus agents for voting,
 * and waits for quorum or timeout. Returns detailed voting results.
 */
async function orchestrateConsensus(
  system: CodexSynapticSystem,
  originalPrompt: string,
  outcome: any,
  consensusMode: string
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
  }, Math.max(system.getConsensusManager().getTimeout(), 5000));

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
        `  ⚠️  ${consensusMode.toUpperCase()} consensus timed out for proposal ${proposalId}.`
      )
    );
  } else if (result.accepted) {
    console.log(
      chalk.green(
        `  ✓ ${consensusMode.toUpperCase()} consensus approved for proposal ${proposalId} (${result.votes ?? 0} votes).`
      )
    );
  } else {
    console.log(
      chalk.red(
        `  ✗ ${consensusMode.toUpperCase()} consensus rejected for proposal ${proposalId} (${result.votes ?? 0} votes).`
      )
    );
  }

  return result;
}

/**
 * Renders strategy execution summary to the console.
 * 
 * @param result - Strategy execution result with status and outcome details
 * 
 * @remarks
 * Displays:
 * - Strategy name (if available)
 * - Execution status (success/failure)
 * - Actions taken (if available)
 * - Final answer or error message
 * - Full outcome JSON (if requested and not silent)
 */
function renderStrategyExecutionSummary(
  result: StrategyExecutionResult,
  verbose: boolean
): void {
  const manifestName = result.manifest.name ?? result.manifest.id;
  const manifestVersion = result.manifest.version ? ` v${result.manifest.version}` : '';
  const manifestLabel = `${manifestName}${manifestVersion}`;

  console.log(chalk.blue('\n📊 Strategy Summary'));
  console.log(chalk.white('Summary:'), result.summary);
  console.log(chalk.gray(`Manifest: ${manifestLabel}`));
  if (result.manifest.sourcePath) {
    console.log(
      chalk.gray(`Source: ${relative(process.cwd(), result.manifest.sourcePath)}`)
    );
  }

  if (Array.isArray(result.warnings) && result.warnings.length) {
    console.log(chalk.yellow('\n⚠️  Warnings:'));
    for (const warning of result.warnings) {
      console.log(chalk.yellow(`  • ${warning}`));
    }
  }

  if (result.stages.length) {
    console.log(chalk.blue('\n🔄 Stage Results:'));
    result.stages.forEach((stage, index) => {
      const symbol = stage.status === 'passed'
        ? chalk.green('✓')
        : stage.status === 'warning'
          ? chalk.yellow('!')
          : chalk.red('✗');
      console.log(chalk.cyan(`  ${index + 1}. ${stage.stage} (${stage.taskId})`));
      console.log(chalk.gray(`     ${symbol} ${stage.result.summary}`));
      if (verbose && stage.result.observations?.length) {
        stage.result.observations.slice(0, 5).forEach((observation) => {
          console.log(chalk.gray(`       • ${observation}`));
        });
      }
      if (verbose && stage.result.detail) {
        console.log(chalk.gray(`       detail: ${stage.result.detail}`));
      }
    });
  }

  const artifactKeys = Object.keys(result.artifacts ?? {});
  if (artifactKeys.length) {
    console.log(chalk.blue('\n📦 Artifacts:'));
    artifactKeys.forEach((key) => {
      console.log(chalk.gray(`  • ${key}`));
    });
  }

  if (result.diagnostics.length) {
    console.log(chalk.blue('\n🩺 Diagnostics:'));
    result.diagnostics.forEach((diagnostic) => {
      const levelColor = diagnostic.level === 'error'
        ? chalk.red
        : diagnostic.level === 'warn'
          ? chalk.yellow
          : chalk.gray;
      console.log(levelColor(`  • [${diagnostic.level}] ${diagnostic.message}`));
      if (verbose && diagnostic.context) {
        console.log(chalk.gray(`       context: ${JSON.stringify(diagnostic.context)}`));
      }
    });
  }
}

program
  .name('codex-synaptic')
  .description('Enhanced OpenAI Codex with distributed agent capabilities')
  .version('1.0.0');

/**
 * Wraps a command handler function with error handling and logging.
 * 
 * @param name - Name of the command for error messages
 * @param fn - Async command handler function
 * @returns Wrapped function with error handling
 * 
 * @remarks
 * Catches errors, logs them with the command name, and sets process.exitCode to 1.
 * Stack traces are shown only when CODEX_DEBUG=1 is set.
 */
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

/**
 * Bootstraps environment variables required for CLI operation and logs the results.
 * 
 * @remarks
 * - Calls ensureSystemBootstrapEnv() to set missing required variables
 * - Logs bootstrapped variables, notes, and warnings (unless silent or already logged)
 * - Sets envBootstrapLogged flag to prevent duplicate logging
 */
function bootstrapEnvForCli(): void {
  const summary = ensureSystemBootstrapEnv();
  if (envBootstrapLogged || cliSilent) {
    envBootstrapLogged = true;
    return;
  }

  if (summary.autoSet.length) {
    console.log(
      chalk.gray(
        `🔐 Bootstrapped environment: ${summary.autoSet.join(', ')} (applied for current session)`
      )
    );
  }

  for (const note of summary.notes) {
    console.log(chalk.gray(`   • ${note}`));
  }

  for (const warning of summary.warnings) {
    console.log(chalk.yellow(`⚠️  ${warning}`));
  }

  envBootstrapLogged = true;
}

/**
 * Configures log streaming from the orchestrator to the console.
 * 
 * @param enabled - Whether to enable log streaming
 * @param level - Log level to stream (DEBUG, INFO, WARN, ERROR)
 * @returns Cleanup function to restore previous log level
 * 
 * @remarks
 * Sets the console log level for the root logger and provides
 * a cleanup function to restore the original level when done.
 */
function configureLogStreaming(enabled: boolean, level: LogLevel): () => void {
  if (!enabled) {
    return () => {};
  }

  const previousLevel = rootLogger.getConsoleLevel();
  rootLogger.setConsoleLevel(level);

  if (!cliSilent) {
    const levelLabel = LogLevel[level] ?? 'INFO';
    console.log(chalk.gray(`📡 Streaming orchestrator logs at ${levelLabel.toLowerCase()} level`));
  }

  return () => {
    rootLogger.setConsoleLevel(previousLevel);
  };
}

/**
 * Options for controlling system lifecycle in useSystem helper.
 */
type UseSystemOptions = {
  /** Whether to automatically shutdown the system after execution. Defaults to cliAutoShutdown setting. */
  autoShutdown?: boolean;
};

/**
 * Ensures a Codex-Synaptic system is initialized, executes a callback, and optionally shuts down.
 * 
 * @param description - Human-readable description of the operation for logging
 * @param fn - Async callback that receives the initialized system instance
 * @param options - Optional configuration for system lifecycle behavior
 * 
 * @remarks
 * - If system is already running, it will be reused and not shut down
 * - Auto-shutdown behavior can be overridden via options.autoShutdown
 * - System initialization is bootstrapped through bootstrapEnvForCli()
 */
async function useSystem(
  description: string,
  fn: (system: CodexSynapticSystem) => Promise<void>,
  options: UseSystemOptions = {}
): Promise<void> {
  bootstrapEnvForCli();
  const alreadyRunning = !!session.getSystemUnsafe();
  if (!alreadyRunning && process.env.CODEX_ALLOW_LOCAL_WITH_DAEMON !== '1') {
    const background = getBackgroundStatus();
    if (background.running) {
      throw new DaemonConflictError(
        `Background daemon already running (pid ${background.pid}). ` +
        'To avoid split-brain state, use `codex-synaptic background attach` for daemon-backed monitoring, ' +
        '`codex-synaptic background stop` before local commands, or set CODEX_ALLOW_LOCAL_WITH_DAEMON=1 to override.',
        {
          daemonPid: background.pid,
          alreadyRunning,
          allowLocalWithDaemon: process.env.CODEX_ALLOW_LOCAL_WITH_DAEMON
        }
      );
    }
  }
  const autoShutdown = options.autoShutdown ?? cliAutoShutdown;
  if (!alreadyRunning && !cliSilent) {
    console.log(chalk.blue(`🔧 Initializing Codex-Synaptic system (${description})...`));
  }
  const system = await session.ensureSystem();
  try {
    await fn(system);
  } finally {
    if (!alreadyRunning && autoShutdown) {
      await session.shutdown('auto-shutdown');
    }
  }
}

/**
 * Parses a string value as an integer, throwing an error if invalid.
 * 
 * @param value - String value to parse
 * @param label - Label for error messages
 * @returns Parsed integer value
 * @throws Error if value is not a valid number
 */
function parseInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} must be a number`);
  }
  return parsed;
}

/**
 * Authorizes a tenant operation using an admin token.
 * 
 * @param system - The Codex-Synaptic system instance
 * @param action - Type of action to authorize ('read' or 'write')
 * @param tokenOverride - Optional token to use instead of env variable
 * @throws Error if no token is available or authorization fails
 * 
 * @remarks
 * Retrieves token from tokenOverride parameter or CODEX_TENANT_ADMIN_TOKEN env var.
 * Strips "Bearer " prefix if present before authenticating.
 */
async function authorizeTenantAction(system: CodexSynapticSystem, action: 'read' | 'write', tokenOverride?: string): Promise<void> {
  const token = tokenOverride ?? process.env.CODEX_TENANT_ADMIN_TOKEN;
  if (!token) {
    throw new Error('Tenant operations require an authorization token. Use --token, set CODEX_TENANT_ADMIN_TOKEN, or run "codex-synaptic auth token" to mint one.');
  }
  const normalized = token.toLowerCase().startsWith('bearer ') ? token.slice(7).trim() : token.trim();
  await system.getAuthMiddleware().authenticateAndAuthorize(normalized, 'tenant', action);
}


/**
 * Renders a table of registered agents to the console.
 * 
 * @param agents - Array of agent metadata to display
 * 
 * @remarks
 * Displays agent ID, type, status, capabilities, and last updated timestamp.
 * Shows "No agents registered" message if the array is empty.
 */
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

/**
 * Renders the neural mesh status to the console.
 * 
 * @param status - Neural mesh status object with node counts, topology, and timing info
 * 
 * @remarks
 * Displays:
 * - Running state (yes/no)
 * - Node and connection counts
 * - Average connections per node
 * - Topology type
 * - Orchestration activity and time limits (if available)
 */
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

/**
 * Renders the status of the background daemon system to the console.
 * 
 * @param status - Background system status information including PID, start time, and interface details
 * 
 * @remarks
 * Displays a gray "not running" message if the daemon is stopped,
 * otherwise shows detailed daemon information including:
 * - Running status (green yes)
 * - Process ID (PID)
 * - Start timestamp
 * - Interface mode (if available)
 * - Interface tier (if available)
 */
function renderBackgroundDaemonStatus(status: BackgroundStatus): void {
  if (!status.running) {
    console.log(chalk.gray('🛰 Background system: not running.'));
    return;
  }

  console.log(chalk.blue('🛰 Background system'));
  console.log(`  Running: ${chalk.green('yes')}`);
  console.log(`  PID: ${status.pid}`);
  if (status.startedAt) {
    console.log(`  Started at: ${status.startedAt}`);
  }
  if (status.interfaceMode) {
    console.log(`  Interface mode: ${status.interfaceMode}`);
  }
  if (status.tier) {
    console.log(`  Interface tier: ${status.tier}`);
  }
}

/**
 * Displays interactive mode usage hints to the console.
 * 
 * @remarks
 * Shows tips about:
 * - Available guided menus (system, agents, mesh, swarm, etc.)
 * - Running CLI commands from within interactive mode
 * - Dashboard and real-time metrics
 * - System lifecycle (stays running after exit)
 * - Hive-mind context attachment features
 */
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

/**
 * Ensures a system instance is available for interactive mode, reusing existing if possible.
 * 
 * @returns Active CodexSynapticSystem instance
 * 
 * @remarks
 * Reuses existing system if it's running and not shutting down.
 * Creates a new system via session.ensureSystem() if needed.
 */
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

/**
 * Pauses execution and waits for user to press Enter.
 * 
 * @param message - Prompt message to display (defaults to "Press Enter to return to the menu.")
 * 
 * @remarks
 * Uses inquirer to create a simple input prompt that continues when Enter is pressed.
 * Commonly used in interactive menus to prevent automatic menu transitions.
 */
async function pause(message = 'Press Enter to return to the menu.'): Promise<void> {
  await inquirer.prompt<{ __continue: string }>([
    {
      type: 'input',
      name: '__continue',
      message
    }
  ]);
}

/**
 * Tokenizes a CLI input string into an array of arguments, handling quotes and escapes.
 * 
 * @param input - Raw command line input string
 * @returns Array of parsed argument tokens
 * 
 * @remarks
 * - Handles both single and double quotes
 * - Supports backslash escaping within quotes
 * - Splits on whitespace outside quotes
 * - Filters out empty tokens
 */
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

/**
 * Formats elapsed time duration into a human-readable string.
 * 
 * @param startedAt - Start timestamp in milliseconds (from Date.now())
 * @returns Formatted duration string (e.g., "45ms", "3m 20s", "2h 15m")
 * 
 * @remarks
 * - Shows milliseconds for durations under 1 second
 * - Shows seconds for durations under 1 minute
 * - Shows minutes and seconds for durations under 1 hour
 * - Shows hours and minutes for longer durations
 */
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

/**
 * Renders the list of background CLI jobs to the console.
 * 
 * @remarks
 * Displays job ID, command, and elapsed time for each running background job.
 * Shows "No background CLI commands are running" if none are active.
 */
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

/**
 * Dispatches a CLI command from interactive mode using the Commander program.
 * 
 * @param raw - Raw command string to parse and execute
 * 
 * @remarks
 * - Tokenizes input respecting quotes and escapes
 * - Prevents running "interactive" command from within interactive mode
 * - Executes command through Commander's parseAsync
 * - Handles help and version display gracefully
 * - Shows error messages with stack traces when CODEX_DEBUG=1
 */
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

/**
 * Renders a comprehensive dashboard of system status including telemetry, mesh, swarm, and consensus.
 * 
 * @param system - The Codex-Synaptic system instance
 * 
 * @remarks
 * Displays:
 * - Telemetry snapshot (agents, resources, tasks)
 * - Neural mesh status
 * - Swarm coordinator status
 * - Consensus status
 */
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

/**
 * Interactive system control menu for managing orchestrator lifecycle and viewing status.
 * 
 * @remarks
 * Provides options for:
 * - Viewing comprehensive dashboard
 * - Checking telemetry pulse
 * - Shutting down the system
 * Menu loops until user returns to main menu or shuts down.
 */
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

/**
 * Interactive agents management menu for deploying, listing, and managing agent lifecycle.
 * 
 * @remarks
 * Provides options for:
 * - Listing registered agents
 * - Deploying new agent instances
 * - Stopping specific agents
 * - Viewing agent telemetry
 * Menu loops until user returns to main menu.
 */
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

/**
 * Interactive neural mesh configuration and monitoring menu.
 * 
 * @remarks
 * Provides options for:
 * - Viewing mesh status
 * - Configuring topology and node counts
 * - Starting/stopping orchestration runs
 * - Viewing mesh telemetry
 * Menu loops until user returns to main menu.
 */
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

/**
 * Interactive swarm coordination menu for managing collaborative optimization.
 * 
 * @remarks
 * Provides options for:
 * - Viewing swarm status
 * - Starting swarm runs with various algorithms (PSO, ACO, flocking)
 * - Stopping active swarms
 * - Viewing swarm telemetry
 * Menu loops until user returns to main menu.
 */
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

/**
 * Interactive hive-mind orchestration menu for spawning multi-agent workflows.
 * 
 * @remarks
 * Provides options for:
 * - Quick spawn with automatic Codex context attachment
 * - Custom spawn with manual agent configuration
 * - Viewing recent hive-mind runs
 * Automatically attaches repository context (AGENTS.md, README, docs/) for repository-aware tasks.
 * Menu loops until user returns to main menu.
 */
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

/**
 * Interactive consensus management menu for proposing and voting on decisions.
 * 
 * @remarks
 * Provides options for:
 * - Viewing consensus status
 * - Creating new proposals
 * - Voting on active proposals
 * - Viewing consensus telemetry
 * Menu loops until user returns to main menu.
 */
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

/**
 * Interactive tasks and routing menu for executing prompts and evaluating routing decisions.
 * 
 * @remarks
 * Provides options for:
 * - Executing task prompts
 * - Viewing recent session tasks
 * - Evaluating routing for prompts
 * Menu loops until user returns to main menu.
 */
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

/**
 * Interactive command runner that allows executing CLI commands from within interactive mode.
 * 
 * @remarks
 * Provides a prompt for entering CLI commands that are then dispatched through the Commander program.
 * Useful for running specific commands without exiting interactive mode.
 * Loops until user enters 'back' to return to main menu.
 */
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

/**
 * Renders swarm coordinator status to the console.
 * 
 * @param status - Swarm status object with run state, algorithm, and participant info
 * 
 * @remarks
 * Displays:
 * - Running state (yes/no)
 * - Active algorithm
 * - Number of participating agents
 * - Iteration count
 */
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

/**
 * Renders consensus status to the console.
 * 
 * @param system - The Codex-Synaptic system instance
 * 
 * @remarks
 * Displays:
 * - Current consensus mechanism
 * - Active proposals count
 * - Recent decisions count
 */
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

/**
 * Renders telemetry snapshot to the console with customizable title.
 * 
 * @param snapshot - The telemetry snapshot to render
 * @param title - Optional title for the snapshot display
 * 
 * @remarks
 * Displays:
 * - Agent statistics (status, types, resource usage)
 * - Resource metrics (CPU, memory, GPU)
 * - Mesh, swarm, and consensus statistics
 * - Recent task summaries
 */
function renderTelemetrySnapshot(snapshot: TelemetrySnapshot, title = '📊 Telemetry Snapshot'): void {
  console.log(chalk.blue(title));

  formatAgentStats(snapshot.agents).forEach((line) => console.log(line));
  formatResourceStats(snapshot.resources).forEach((line) => console.log(line));
  const meshStats = formatMeshStats(snapshot.mesh);
  if (meshStats) {
    console.log(meshStats);
  }
  const swarmStats = formatSwarmStats(snapshot.swarm);
  if (swarmStats) {
    console.log(swarmStats);
  }
  const consensusStats = formatConsensusStats(snapshot.consensus);
  if (consensusStats) {
    console.log(consensusStats);
  }
  formatRecentTasks(snapshot.recentTasks).forEach((line) => console.log(line));
}

/**
 * Renders telemetry snapshot to the console including agents, resources, and recent tasks.
 * 
 * @remarks
 * Retrieves the latest telemetry from the global session and displays:
 * - Agent statistics (status, types, resource usage)
 * - Resource metrics (CPU, memory, GPU)
 * - Recent task summaries
 * Shows "No telemetry available" if no snapshot exists.
 */
function renderTelemetry(): void {
  const snapshot = session.getTelemetry() as TelemetrySnapshot;
  renderTelemetrySnapshot(snapshot);
}

function renderDaemonSnapshot(snapshot: {
  pid: number;
  startedAt: string;
  updatedAt: string;
  cwd: string;
  interfaceMode: InterfaceMode;
  tier: InterfaceTier;
  status: { initialized: boolean; shuttingDown: boolean; daemon: boolean };
  telemetry: TelemetrySnapshot;
}): void {
  console.log(chalk.blue('🛰 Daemon Runtime Snapshot'));
  console.log(`  PID: ${snapshot.pid}`);
  console.log(`  Started at: ${snapshot.startedAt}`);
  console.log(`  Updated at: ${snapshot.updatedAt}`);
  console.log(`  Working directory: ${snapshot.cwd}`);
  console.log(`  Interface: ${snapshot.interfaceMode}/${snapshot.tier}`);
  console.log(`  Initialized: ${snapshot.status.initialized ? chalk.green('yes') : chalk.red('no')}`);
  console.log(`  Shutting down: ${snapshot.status.shuttingDown ? chalk.yellow('yes') : chalk.green('no')}`);
  renderTelemetrySnapshot(snapshot.telemetry, '📊 Daemon Telemetry');
}

/**
 * Emits context aggregation logs to the console.
 * 
 * @param logs - Array of context log entries with timestamps, levels, and messages
 * 
 * @remarks
 * Formats each log entry with appropriate color based on level:
 * - DEBUG: gray
 * - INFO: blue
 * - WARN: yellow
 * - ERROR: red
 */
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

/**
 * Emits a summary of aggregated Codex context including artifacts and byte counts.
 * 
 * @param context - Aggregated Codex context with inventory, directives, and metadata
 * @param metadata - Aggregation metadata with artifact counts and byte sizes
 * 
 * @remarks
 * Displays summary of:
 * - Root directory
 * - Artifacts included (README, AGENTS.md, directives, etc.)
 * - Total context size in bytes
 */
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

/**
 * Attempts to prime Codex with context, retrying on failure.
 * 
 * @param prompt - User prompt to prime with
 * @param attempts - Number of retry attempts (default: 2)
 * @returns Priming result or null if all attempts fail
 * 
 * @remarks
 * Retries priming operation with exponential backoff (2s delay between attempts).
 * Logs errors and continues retrying until max attempts reached.
 */
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

/**
 * Formats a details object into a readable string representation.
 * 
 * @param details - Object with string keys and unknown values
 * @returns JSON-formatted string with 2-space indentation
 */
function formatDetailEntry(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ');
}

/**
 * Formats byte count into human-readable string with appropriate units.
 * 
 * @param bytes - Number of bytes to format
 * @returns Formatted string with units (B, KB, MB, GB)
 * 
 * @remarks
 * Uses base-1024 calculation and shows 2 decimal places for KB and above.
 */
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

/**
 * Describes a cache file path for display purposes.
 * 
 * @param absPath - Absolute path to cache file
 * @returns Descriptive string or 'none' if path is not provided
 * 
 * @remarks
 * If path starts with HOME/.codex-synaptic/, shows relative to that directory.
 * Otherwise shows the full path or basename if short enough.
 */
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

/**
 * Parses a string value into an AgentType enum value.
 * 
 * @param value - String representation of agent type
 * @returns AgentType enum value or undefined if invalid
 * 
 * @remarks
 * Converts lowercase snake_case to UPPER_SNAKE_CASE for enum lookup.
 * Returns undefined if the value doesn't match a valid AgentType.
 */
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

/**
 * Parses a JSON option string into a typed object.
 * 
 * @param value - JSON string to parse
 * @returns Parsed object of type T or undefined if parsing fails
 * 
 * @remarks
 * Throws an error if JSON is invalid.
 * Returns undefined if value is not provided.
 */
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

/**
 * Loads tool candidate definitions from a JSON file.
 * 
 * @param filePath - Path to JSON file containing tool candidates
 * @returns Array of tool candidates
 * @throws Error if file doesn't exist, can't be read, or contains invalid JSON
 * 
 * @remarks
 * Expected JSON format is an array of ToolCandidate objects.
 */
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

/**
 * Builds a tool usage record from CLI options.
 * 
 * @param options - CLI options object with toolName, toolDescription, and toolInput
 * @returns ToolUsageRecord with timestamp and metadata
 * 
 * @remarks
 * Parses toolInput as JSON if provided, otherwise sets input to null.
 */
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

// ============================================================================
// Hive-mind helper functions
// ============================================================================

/**
 * Builds Codex context from the current working directory.
 * 
 * @returns Object containing codexContext, codexMetadata, and codexEnvelope
 * 
 * @remarks
 * Aggregates agent directives, README excerpts, directory inventory, and database metadata.
 * Emits context logs and summary to console.
 */
async function buildCodexContextForHiveMind(originalPrompt: string): Promise<{
  codexContext: CodexContext;
  codexMetadata: CodexContextAggregationMetadata;
  codexEnvelope: CodexPromptEnvelope;
}> {
  const builder = new CodexContextBuilder(process.cwd());
  await builder.withAgentDirectives();
  await builder.withReadmeExcerpts();
  await builder.withDirectoryInventory();
  await builder.withDatabaseMetadata();
  const buildResult: CodexContextBuildResult = await builder.build();

  const codexContext = buildResult.context;
  const codexMetadata = buildResult.metadata;

  emitContextLogs(buildResult.logs);
  emitContextSummary(buildResult.context, buildResult.metadata);

  const contextBlock = renderCodexContextBlock(buildResult.context);
  const enrichedPrompt = composePromptWithContext(originalPrompt, buildResult.context);

  const codexEnvelope: CodexPromptEnvelope = {
    originalPrompt,
    enrichedPrompt,
    contextBlock
  };

  return { codexContext, codexMetadata, codexEnvelope };
}

/**
 * Executes GOAP strategy workflow.
 * 
 * @param system - Codex-Synaptic system instance
 * @param originalPrompt - User's original prompt
 * @param options - CLI options including goapProfile, goapGoal, goapDryRun
 * 
 * @remarks
 * Loads or matches GOAP manifest, executes the goal, and displays results.
 */
async function executeGoapStrategy(
  system: CodexSynapticSystem,
  originalPrompt: string,
  options: any
): Promise<void> {
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
}

/**
 * Displays hive-mind execution results in human-readable format.
 * 
 * @param outcome - Task execution outcome
 * @param config - Hive-mind configuration
 * @param totalTime - Total execution time in milliseconds
 * @param system - Codex-Synaptic system instance
 * @param consensusResult - Consensus execution result
 * @param codexContext - Optional Codex context
 * 
 * @remarks
 * Formats and displays execution summary, code artifacts, Tree-of-Thought results,
 * stage results, system metrics, and debug output based on configuration.
 */
function displayHiveMindResults(
  outcome: any,
  config: any,
  totalTime: number,
  system: CodexSynapticSystem,
  _consensusResult: ConsensusExecutionResult,
  _codexContext?: CodexContext
): void {
  const swarmStatus = system.getSwarmCoordinator().getStatus();
  const meshStatus = system.getNeuralMesh().getStatus();
  const agentRegistry = system.getAgentRegistry().getStatus();
  
  const reactPlanArtifact = outcome.artifacts?.reactPlan ?? null;
  const _totPlan = reactPlanArtifact?.tot ?? null;
  console.log(chalk.blue('\n📊 Execution Summary'));
  console.log(chalk.white('Summary:'), outcome.summary);
  
  if (outcome.artifacts?.code) {
    console.log(chalk.blue('\n💻 Generated Code Artifacts:'));
    console.log(chalk.gray(outcome.artifacts.code.substring(0, 500) + '...'));
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

  if (outcome.stages && Array.isArray(outcome.stages)) {
    console.log(chalk.blue('\n🔄 Stage Results:'));
    outcome.stages.forEach((stage: any, idx: number) => {
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

/**
 * Prepares comprehensive result data for YAML output.
 * 
 * @param outcome - Task execution outcome
 * @param config - Hive-mind configuration
 * @param totalTime - Total execution time in milliseconds
 * @param originalPrompt - Original user prompt
 * @param system - Codex-Synaptic system instance
 * @param consensusResult - Consensus execution result
 * @param codexContext - Optional Codex context
 * @returns Result data object for YAML formatting
 * 
 * @remarks
 * Aggregates execution metadata, system status, consensus status, and Tree-of-Thought results.
 */
function prepareResultData(
  outcome: any,
  config: any,
  totalTime: number,
  originalPrompt: string,
  system: CodexSynapticSystem,
  consensusResult: ConsensusExecutionResult,
  codexContext?: CodexContext
): any {
  const swarmStatus = system.getSwarmCoordinator().getStatus();
  const meshStatus = system.getNeuralMesh().getStatus();
  const agentRegistry = system.getAgentRegistry().getStatus();
  
  const reactPlanArtifact = outcome.artifacts?.reactPlan ?? null;
  const totPlan = reactPlanArtifact?.tot ?? null;

  return {
    executionId: `exec-${Date.now()}`,
    status: 'completed',
    duration: totalTime,
    originalPrompt,
    summary: outcome.summary,
    artifacts: outcome.artifacts || {},
    stages: outcome.stages || [],
    agentCount: agentRegistry.totalAgents,
    taskCount: outcome.stages?.length || 0,
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
}

/**
 * Executes classic hive-mind orchestration workflow.
 * 
 * @param system - Codex-Synaptic system instance
 * @param prompt - Enriched prompt (potentially with Codex context)
 * @param originalPrompt - Original user prompt
 * @param config - Hive-mind configuration
 * @param options - CLI options including yaml, debug flags
 * @param codexContext - Optional Codex context
 * @param codexEnvelope - Optional Codex prompt envelope
 * 
 * @remarks
 * Executes orchestration phases, task execution with timeout, consensus (if needed),
 * and displays results in requested format (YAML or human-readable).
 */
async function executeClassicOrchestration(
  system: CodexSynapticSystem,
  prompt: string,
  originalPrompt: string,
  config: any,
  options: any,
  codexContext?: CodexContext,
  codexEnvelope?: CodexPromptEnvelope
): Promise<void> {
  console.log(chalk.blue('🧠 Initializing hive-mind orchestration...'));
  console.log(chalk.gray(`Configuration: ${JSON.stringify(config, null, 2)}`));

  if (codexContext && codexEnvelope) {
    await primeCodexWithRetry(system, codexContext, codexEnvelope);
  }

  // Execute orchestration phases using helper service
  await executeOrchestrationPhases(system, config);

  // Phase 5: Task Execution
  console.log(chalk.cyan('⚡ Phase 5: Task Execution'));
  console.log(chalk.blue(`Executing: "${prompt}"`));

  const startTime = Date.now();
  let consensusResult: ConsensusExecutionResult = { performed: false };

  const cleanupEventHandlers = setupWorkflowEventHandlers(system, startTime);

  try {
    const outcome: any = await Promise.race([
      system.executeTask(prompt),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Hive-mind execution timeout')), config.timeout))
    ]);

    const consensusNeeded = shouldRequireConsensus(originalPrompt, config.consensus);
    if (consensusNeeded) {
      consensusResult = await orchestrateConsensus(
        system,
        originalPrompt,
        outcome,
        config.consensus
      );
    }

    const totalTime = Date.now() - startTime;
    console.log(chalk.green(`\n🎉 Hive-mind execution completed in ${totalTime}ms`));

    // Output results based on format preference
    if (options.yaml) {
      const resultData = prepareResultData(
        outcome,
        config,
        totalTime,
        originalPrompt,
        system,
        consensusResult,
        codexContext
      );
      console.log(chalk.blue('\n📋 Results (YAML format):'));
      const yamlOutput = HiveMindYamlFormatter.formatExecutionResult(resultData);
      console.log(yamlOutput);
    } else {
      displayHiveMindResults(outcome, config, totalTime, system, consensusResult, codexContext);
    }

    if (!config.debug && !options.yaml) {
      console.log(chalk.blue('\n💾 Results saved to session telemetry'));
    } else if (config.debug && !options.yaml) {
      console.log(chalk.blue('\n🔍 Full Debug Output:'));
      console.log(JSON.stringify(outcome, null, 2));
    }
  } finally {
    cleanupEventHandlers.cleanup();
  }
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
  .option('--daemon', 'Start the detached daemon instead of in-process system session')
  .action(handleCommand('system.start', async (options) => {
    if (options.daemon) {
      const status = await startBackgroundSystem();
      console.log(chalk.green(`✅ Background system running (pid ${status.pid})`));
      if (status.startedAt) {
        console.log(`  Started at: ${status.startedAt}`);
      }
      return;
    }

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
    const backgroundStatus = getBackgroundStatus();
    if (!system) {
      if (backgroundStatus.running) {
        console.log(chalk.yellow('⚠️  Foreground session not started in this shell.'));
        console.log(chalk.green('✅ Background daemon is running.'));
        renderBackgroundDaemonStatus(backgroundStatus);
        console.log(chalk.gray('Use `codex-synaptic system start` to start a foreground session or `codex-synaptic background stop` to stop the daemon.'));
        return;
      }
      console.log(chalk.yellow('⚠️  System not started. Run `codex-synaptic system start` first.'));
      return;
    }

    const status = system.getStatus();
    console.log(chalk.blue('🧠 Codex-Synaptic System Status'));
    console.log(`  Initialized: ${status.initialized}`);
    console.log(`  Shutting down: ${status.shuttingDown}`);
    renderTelemetry();
    console.log('');
    renderBackgroundDaemonStatus(backgroundStatus);
  }));

systemCmd
  .command('stop')
  .description('Stop the Codex-Synaptic system and release resources')
  .action(handleCommand('system.stop', async () => {
    if (session.getSystemUnsafe()) {
      await session.shutdown('manual-stop');
      console.log(chalk.green('✅ Codex-Synaptic system shutdown complete.'));
      return;
    }

    const background = getBackgroundStatus();
    if (background.running) {
      const result = await stopBackgroundSystem();
      if (result === 'stopped') {
        console.log(chalk.green('✅ Background system stopped.'));
      } else if (result === 'timeout') {
        console.log(chalk.yellow('⚠️  Background system stop timed out and required force termination.'));
      } else {
        console.log(chalk.gray('Background system was not running.'));
      }
      return;
    }

    console.log(chalk.gray('System already stopped.'));
  }));

systemCmd
  .command('monitor')
  .description('Stream live telemetry until interrupted')
  .option('-i, --interval <ms>', 'Refresh interval in milliseconds', '2000')
  .action(handleCommand('system.monitor', async (options) => {
    const intervalMs = parseInteger(options.interval, 'interval');
    console.log(chalk.blue('📡 Streaming telemetry (Ctrl+C to stop)...'));

    const localSystem = session.getSystemUnsafe();
    const background = getBackgroundStatus();

    if (!localSystem && background.running) {
      const render = async () => {
        console.log('\n' + chalk.gray('─'.repeat(40)));
        const snapshot = await queryBackgroundRuntimeSnapshot();
        if (!snapshot) {
          console.log(chalk.yellow('Daemon snapshot unavailable.'));
          return;
        }
        renderDaemonSnapshot({
          ...snapshot,
          telemetry: snapshot.telemetry as TelemetrySnapshot
        });
      };

      await render();
      const timer = setInterval(() => {
        void render();
      }, intervalMs);

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
      return;
    }

    await useSystem('system monitor', async () => {
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
      const readinessIssues = system.getOpenAIReadinessIssues();

      if (options.json) {
        const payload = {
          configured: Boolean(system.getOpenAIResolvedConfiguration()?.config?.enabled),
          clientReady: Boolean(system.getOpenAIResponsesClient()?.isReady()),
          diagnostics: readinessIssues,
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
      if (readinessIssues.length) {
        console.log(chalk.yellow('\nReadiness diagnostics'));
        readinessIssues.forEach((issue) => {
          const statusSuffix = typeof issue.statusCode === 'number' ? ` (HTTP ${issue.statusCode})` : '';
          console.log(chalk.yellow(`  • [${issue.code}] ${issue.message}${statusSuffix}`));
          issue.recommendedActions.forEach((action) => {
            console.log(chalk.gray(`     - ${action}`));
          });
        });
      }
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
    renderBackgroundDaemonStatus(status);
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
  .command('attach')
  .description('Attach to daemon-backed telemetry without creating a second orchestrator')
  .option('-w, --watch', 'Continuously stream daemon status until interrupted')
  .option('-i, --interval <ms>', 'Refresh interval in milliseconds when using --watch', '2000')
  .action(handleCommand('background.attach', async (options) => {
    const status = getBackgroundStatus();
    if (!status.running) {
      console.log(chalk.yellow('⚠️  Background system is not running. Start it with `codex-synaptic background start`.'));
      return;
    }

    const render = async () => {
      const snapshot = await queryBackgroundRuntimeSnapshot();
      if (!snapshot) {
        console.log(chalk.yellow('Daemon snapshot unavailable.'));
        return;
      }
      renderDaemonSnapshot({
        ...snapshot,
        telemetry: snapshot.telemetry as TelemetrySnapshot
      });
    };

    if (!options.watch) {
      await render();
      return;
    }

    const intervalMs = parseInteger(options.interval, 'interval');
    console.log(chalk.blue('📡 Attached to background daemon telemetry (Ctrl+C to stop)...'));
    await render();
    const timer = setInterval(() => {
      console.log('\n' + chalk.gray('─'.repeat(40)));
      void render();
    }, intervalMs);

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
        console.log(chalk.yellow('⚠️  Background system did not stop before timeout and was force terminated.'));
        break;
    }
  }));

backgroundCmd
  .command('restart')
  .description('Restart the detached background system')
  .option('-t, --timeout <ms>', 'Timeout before force stopping', '10000')
  .action(handleCommand('background.restart', async (options) => {
    const timeout = parseInteger(options.timeout, 'timeout');
    const status = await restartBackgroundSystem(timeout);
    console.log(chalk.green(`✅ Background system running (pid ${status.pid})`));
    if (status.startedAt) {
      console.log(`  Started at: ${status.startedAt}`);
    }
  }));

backgroundCmd
  .command('logs')
  .description('Show daemon log output')
  .option('--tail <lines>', 'Number of log lines to display', '50')
  .action(handleCommand('background.logs', async (options) => {
    const tailLines = parseInteger(options.tail, 'tail');
    const status = getBackgroundStatus();
    const runtime = getBackgroundRuntimeSnapshot();

    const logPath = status.logFile
      ?? (status.cwd ? join(status.cwd, 'logs', 'daemon.log') : join(process.cwd(), 'logs', 'daemon.log'));

    if (!existsSync(logPath)) {
      console.log(chalk.yellow(`⚠️  Log file not found: ${logPath}`));
      if (!status.running) {
        console.log(chalk.gray('Background daemon is not running.'));
      }
      return;
    }

    const content = readFileSync(logPath, 'utf8');
    const lines = content.split(/\\r?\\n/).filter((line) => line.length > 0);
    const selected = lines.slice(-Math.max(1, tailLines));

    console.log(chalk.blue(`📜 Daemon logs (${selected.length}/${lines.length})`));
    console.log(chalk.gray(`  File: ${logPath}`));
    if (runtime?.updatedAt) {
      console.log(chalk.gray(`  Last daemon update: ${runtime.updatedAt}`));
    }
    selected.forEach((line) => console.log(line));
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

      // Validate quota options
      const validation = validateQuotaOptions(options as QuotaOptions);
      if (!validation.hasQuotaFlags) {
        console.log(chalk.yellow(validation.error));
        return;
      }
      if (validation.error) {
        throw new Error(validation.error);
      }

      // Build policy input
      const policyInput = buildPolicyInput(tenantId, options as QuotaOptions);

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

/**
 * Prints a reasoning run record to the console with formatted sections.
 * 
 * @param record - Reasoning run record with metadata, iterations, and outcome
 * 
 * @remarks
 * Displays:
 * - Strategy type and status
 * - Execution timing and iteration count
 * - Initial prompt
 * - Iteration details with thoughts and actions
 * - Final answer or error
 * - Full outcome JSON
 */
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
      if (!response?.ok) {
        const details = response?.error ? JSON.stringify(response.error) : 'unknown MCP bridge failure';
        throw new Error(`MCP bridge request failed: ${details}`);
      }
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
  .option(
    '--strategy <type>',
    strategyOptionDescription,
    'classic'
  )
  .option('--strategy-profile <id>', 'Strategy manifest identifier for non-classic modes')
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
  .option('--stream-logs', 'Stream orchestrator logs while the hive-mind runs')
  .option('--log-level <level>', 'Override streaming log level (debug|info|warn|error)', 'info')
  .option('--dry-run', 'Preview Codex context without executing the hive-mind spawn')
  .option('--yaml', 'Output results in YAML format (default: JSON)')
  .action(handleCommand('hive-mind.spawn', async (promptParts: string[], options) => {
    let prompt = promptParts.join(' ').trim();
    if (!prompt) {
      throw new Error('Prompt cannot be empty');
    }

    const originalPrompt = prompt;
    const strategy = (options.strategy ?? 'classic').toLowerCase();
    const normalizedConsensus = normalizeConsensusMechanism(options.consensus);
    const streamLogs = Boolean(options.streamLogs);
    const effectiveLogLevel = parseLogLevelOption(
      options.logLevel,
      options.debug ? LogLevel.DEBUG : LogLevel.INFO
    );
    const agentTarget = parseInteger(options.agents, 'agents');
    const maxAgents = options.maxAgents ? parseInteger(options.maxAgents, 'maxAgents') : 10;
    const timeoutMs = options.timeout ? parseInteger(options.timeout, 'timeout') * 1000 : 600000;
    const isAdvancedStrategy = advancedStrategySet.has(strategy as SupportedStrategy);

    if (strategy === 'goap') {
      await useSystem('hive-mind goap', async (system) => {
        await executeGoapStrategy(system, originalPrompt, options);
      });
      return;
    }

    if (strategy !== 'classic' && !isAdvancedStrategy) {
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
      const result = await buildCodexContextForHiveMind(originalPrompt);
      codexContext = result.codexContext;
      codexMetadata = result.codexMetadata;
      codexEnvelope = result.codexEnvelope;

      if (options.dryRun) {
        console.log(chalk.yellow('⚙️  Dry-run: Codex context ready. Skipping hive-mind orchestration.'));
        console.log('');
        console.log(chalk.gray(codexEnvelope.contextBlock));
        return;
      }

      prompt = codexEnvelope.enrichedPrompt;
      console.log(chalk.cyan('📚 Codex context attached to hive-mind prompt.'));
    }

    if (isAdvancedStrategy) {
      await useSystem(`hive-mind strategy:${strategy}`, async (system) => {
        const restoreLogging = configureLogStreaming(streamLogs, effectiveLogLevel);
        try {
          if (codexContext && codexEnvelope) {
            await primeCodexWithRetry(system, codexContext, codexEnvelope);
          }

          if (!cliSilent) {
            const manifestDescriptor = options.strategyProfile
              ? `manifest ${options.strategyProfile}`
              : 'default manifest';
            console.log(
              chalk.blue(`🧭 Executing advanced strategy ${strategy} (${manifestDescriptor})`)
            );
          }

          const strategyResult = await executeStrategy({
            system,
            strategy: strategy as SupportedStrategy,
            prompt,
            manifestId: options.strategyProfile,
            agentTarget,
            consensusMechanism: normalizedConsensus,
            timeoutMs,
            debug: Boolean(options.debug)
          });

          if (options.yaml) {
            console.log(HiveMindYamlFormatter.formatStrategyExecution(strategyResult));
          } else {
            renderStrategyExecutionSummary(strategyResult, Boolean(options.debug));
          }
        } finally {
          restoreLogging();
        }
      });

      return;
    }

    const maxWorkers = options.maxWorkers ? parseInteger(options.maxWorkers, 'maxWorkers') : 7;
    const priority = options.priority ? parseInteger(options.priority, 'priority') : 7;

    const config = {
      agents: agentTarget,
      maxAgents,
      maxWorkers,
      algorithm: options.algorithm,
      meshTopology: options.meshTopology || 'mesh',
      consensus: normalizedConsensus,
      priority,
      timeout: timeoutMs,
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
      const restoreLogging = configureLogStreaming(streamLogs, effectiveLogLevel);
      try {
        await executeClassicOrchestration(
          system,
          prompt,
          originalPrompt,
          config,
          options,
          codexContext,
          codexEnvelope
        );
      } finally {
        restoreLogging();
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
      if (profile.port) {
        console.log(chalk.gray(`    port: ${profile.port}`));
      }
      if (profile.requiredEnv?.length) {
        console.log(chalk.gray(`    required env: ${profile.requiredEnv.join(', ')}`));
      }
    });
  });

envCmd
  .command('status')
  .description('Show status for a service profile')
  .argument('[names...]', 'Service profile name(s)')
  .action(async (names?: string[]) => {
    const targets = names && names.length ? names : serviceManager.listProfiles().map(({ name }) => name);
    for (const target of targets) {
      const status = await serviceManager.status(target);
      console.log(chalk.cyan(`\n${status.name}`));
      console.log(chalk.gray(`  running: ${status.running ? 'yes' : 'no'}`));
      console.log(chalk.gray(`  healthy: ${status.healthy === null ? 'n/a' : (status.healthy ? 'yes' : 'no')}`));
      console.log(chalk.gray(`  checkedAt: ${status.checkedAt}`));
      if (status.diagnostics.length) {
        status.diagnostics.forEach((diagnostic) => {
          console.log(chalk.yellow(`  diag: ${diagnostic}`));
        });
      }
      console.log(chalk.gray(status.raw.trim()));
    }
  });

envCmd
  .command('up')
  .description('Start one or more service profiles')
  .argument('<names...>', 'Service profile names')
  .option('--no-wait', 'Do not wait for health checks')
  .option('--filesystem-mode <mode>', 'Filesystem profile mode: read-only or controlled-write', 'read-only')
  .option('--allow-filesystem-write', 'Allow controlled-write filesystem profile mode')
  .action(handleCommand('env.up', async (names: string[], options) => {
    for (const name of names) {
      await serviceManager.ensureService(name, {
        waitForHealth: options.wait !== false,
        filesystemMode: options.filesystemMode,
        allowFilesystemWrite: options.allowFilesystemWrite === true
      });
      console.log(chalk.green(`✅ ${name} started`));
    }
  }));

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
      if (profile.port) {
        console.log(chalk.gray(`  port: ${profile.port}`));
      }
      if (profile.codexName) {
        console.log(chalk.gray(`  codex mcp name: ${profile.codexName}`));
      }
      if (profile.requiredEnv?.length) {
        console.log(chalk.gray(`  required env: ${profile.requiredEnv.join(', ')}`));
      }
      if (name === 'mcp-filesystem') {
        console.log(chalk.gray('  filesystem mode: read-only (default) or controlled-write with explicit approval'));
      }
    });
  });

const execFileAsync = promisify(execFile);

/**
 * Execute codex CLI command with timeout and error handling
 */
async function execCodexCommand(args: string[], timeoutMs = 10000): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('codex', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: timeoutMs
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const err = error as { code?: string | number; killed?: boolean; signal?: string; stdout?: string; stderr?: string };
    if (err.code === 'ENOENT') {
      throw new Error('codex command not found. Ensure Codex CLI is installed and in PATH.');
    }
    if (err.killed && err.signal === 'SIGTERM') {
      throw new Error(`codex command timed out after ${timeoutMs}ms`);
    }
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      exitCode: typeof err.code === 'number' ? err.code : 1
    };
  }
}

envCmd
  .command('docker-login')
  .description('Authenticate Docker registries required by one or more service profiles')
  .argument('[names...]', 'Service profile names (defaults to launch gate profiles)')
  .option('--dry-run', 'Print docker login commands without executing them')
  .action(handleCommand('env.docker-login', async (names: string[] = [], options) => {
    const targets = names.length ? names : [...DEFAULT_MCP_PROFILES];
    const registries = serviceManager.registriesForProfiles(targets);

    if (!registries.length) {
      console.log(chalk.gray(`No registry authentication required for profiles: ${targets.join(', ')}`));
      return;
    }

    if (options.dryRun) {
      console.log(chalk.blue('Docker registry login commands (dry-run):'));
      registries.forEach((registry) => {
        console.log(chalk.gray(`  docker login ${registry}`));
      });
      return;
    }

    for (const registry of registries) {
      serviceManager.dockerLogin(registry);
      console.log(chalk.green(`✅ Docker auth completed for ${registry}`));
    }
  }));

envCmd
  .command('codex-register')
  .description('Register MCP HTTP profiles in Codex CLI MCP config')
  .argument('<names...>', 'Service profile names to register')
  .option('--replace', 'Replace existing MCP registration if it already exists')
  .action(handleCommand('env.codex-register', async (names: string[], options) => {
    for (const name of names) {
      const registration = serviceManager.codexRegistration(name);
      if (!registration) {
        throw new Error(`Profile ${name} does not expose codex registration metadata.`);
      }

      if (options.replace) {
        const remove = await execCodexCommand(['mcp', 'remove', registration.codexName]);
        if (remove.exitCode === 0) {
          console.log(chalk.gray(`Removed existing Codex MCP entry: ${registration.codexName}`));
        }
      }

      const add = await execCodexCommand(['mcp', 'add', registration.codexName, '--url', registration.url]);

      if (add.exitCode !== 0) {
        const stderr = add.stderr?.trim();
        if (stderr?.includes('already exists')) {
          console.log(chalk.yellow(`⚠️  Codex MCP entry already exists: ${registration.codexName}`));
          continue;
        }
        throw new Error(`codex mcp add failed for ${registration.codexName}: ${stderr || add.stdout || 'unknown error'}`);
      }

      console.log(chalk.green(`✅ Registered Codex MCP server ${registration.codexName} -> ${registration.url}`));
    }
  }));

const launchCmd = decorateCommandHelp(
  program
    .command('launch')
    .description('Start detached runtime and hard-gate readiness before repository work'),
  {
    title: 'Launch Gate',
    subtitle: 'Boot daemon + MCP dependencies and fail-fast if the repo is not work-ready.',
    context: [
      'Launch is the single-command bootstrap for Codex for macOS first prompts.',
      'In strict mode, launch stops on the first failing gate and exits non-zero.'
    ],
    skills: [
      'Guarantee daemon, MCP profile, and doctor readiness before edits start.',
      'Emit machine-readable launch reports for automation and handoffs.'
    ],
    actions: [
      { command: 'codex-synaptic launch --json', description: 'Run the full bootstrap gate and emit structured output.' },
      { command: 'codex-synaptic launch --no-strict --json', description: 'Collect gate results without immediate fail-fast exit.' }
    ],
    docs: [
      { label: 'docs/guides/codex-macos-workflows.md', description: 'Single-command first-launch flow for Codex for macOS.' }
    ]
  }
);

launchCmd
  .option('--json', 'Output launch report as JSON')
  .option('--strict', 'Exit with an error when any launch gate fails', true)
  .option('--no-strict', 'Report failing gates without exiting non-zero')
  .option('--skip-codex-auth', 'Skip codex login status check')
  .option(
    '--mcp-profiles <profiles>',
    'Comma-separated MCP service profiles to verify',
    DEFAULT_MCP_PROFILES.join(',')
  )
  .action(handleCommand('launch', async (options) => {
    const strict = options.strict !== false;
    const profileNames = parseProfileList(options.mcpProfiles, [...DEFAULT_MCP_PROFILES]);
    const report = await runLaunch({
      cwd: process.cwd(),
      strict,
      skipCodexAuth: Boolean(options.skipCodexAuth),
      mcpProfiles: profileNames
    });

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(chalk.blue('🚀 Codex-Synaptic Launch'));
      console.log(chalk.gray(`  Status: ${report.ok ? 'ready' : 'blocked'}`));
      console.log(chalk.gray(`  Next action: ${report.nextAction}`));

      report.steps.forEach((step) => {
        const marker = step.ok ? chalk.green('✓') : chalk.red('✗');
        console.log(`${marker} ${step.id}: ${step.details}`);
        if (!step.ok && step.remediation) {
          console.log(chalk.yellow(`  remediation: ${step.remediation}`));
        }
      });

      if (report.doctor.summary.total > 0) {
        console.log(chalk.gray(`  Doctor summary: passed=${report.doctor.summary.passed} failed=${report.doctor.summary.failed}`));
      } else {
        console.log(chalk.gray('  Doctor summary: skipped (launch exited before strict doctor run).'));
      }

      if (report.ok) {
        console.log(chalk.green('✅ Launch gate passed. Safe to begin repository work.'));
      } else {
        console.log(chalk.red('🛑 Launch gate failed. Stop repository work until remediations pass.'));
        const remediation = collectLaunchRemediations(report);
        if (remediation.length) {
          console.log(chalk.yellow('  Suggested commands:'));
          remediation.forEach((command) => {
            console.log(chalk.yellow(`    - ${command}`));
          });
        }
      }
    }

    if (strict && !report.ok) {
      throw new CliGateError(
        ErrorCode.LAUNCH_GATE_FAILURE,
        'Launch failed one or more readiness gates.',
        { strict, report }
      );
    }
  }));

const doctorCmd = decorateCommandHelp(
  program
    .command('doctor')
    .description('Run bootstrap and integration diagnostics for Codex + MCP + repo CLI readiness'),
  {
    title: 'Doctor Console',
    subtitle: 'Validate auth, MCP services, Codex registrations, and local CLI readiness in one pass.',
    context: [
      'Doctor catches setup drift before you launch long-running Codex or swarm sessions.',
      'Use this after pulling changes or rotating local MCP/server credentials.'
    ],
    skills: [
      'Correlate MCP service health with Codex registration state.',
      'Generate concrete remediation commands when readiness checks fail.'
    ],
    vibeTips: [
      'Run doctor before broad orchestration changes and keep the output in your release notes.'
    ],
    actions: [
      { command: 'codex-synaptic doctor', description: 'Run default readiness checks.' },
      { command: 'codex-synaptic doctor --strict', description: 'Exit non-zero if any readiness check fails.' }
    ],
    docs: [
      { label: 'docs/guides/codex-macos-workflows.md', description: 'macOS setup flow aligned with this doctor output.' }
    ]
  }
);

doctorCmd
  .option('--json', 'Output doctor report as JSON')
  .option('--strict', 'Exit with an error when any check fails')
  .option('--skip-codex-auth', 'Skip codex login status check')
  .option(
    '--mcp-profiles <profiles>',
    'Comma-separated MCP service profiles to verify',
    DEFAULT_MCP_PROFILES.join(',')
  )
  .action(handleCommand('doctor', async (options) => {
    const profileNames = String(options.mcpProfiles)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const checks: HealthCheck[] = [];

    // Check CLI build artifact
    const buildCheck = checkCliBuildArtifact();
    checks.push(buildCheck);

    // Check CLI execution if build exists
    if (buildCheck.ok) {
      const distCliPath = join(process.cwd(), 'dist', 'cli', 'index.js');
      const execCheck = checkCliExecution(distCliPath);
      if (execCheck) {
        checks.push(execCheck);
      }
    }

    // Check Codex authentication
    if (!options.skipCodexAuth) {
      checks.push(checkCodexAuth());
    }

    // Check Codex MCP list
    let codexMcpNames = new Set<string>();
    const codexMcpList = spawnSync('codex', ['mcp', 'list', '--json'], {
      cwd: process.cwd(),
      mcpProfiles: profileNames,
      skipCodexAuth: Boolean(options.skipCodexAuth)
    });
    if (codexMcpList.status === 0) {
      try {
        const parsed = JSON.parse(codexMcpList.stdout || '[]') as Array<{ name?: string }>;
        codexMcpNames = new Set(parsed.map((entry) => String(entry.name)).filter(Boolean));
        checks.push({
          id: 'codex.mcp_list',
          ok: true,
          details: `Loaded ${codexMcpNames.size} Codex MCP registration(s).`
        });
      } catch (error) {
        checks.push({
          id: 'codex.mcp_list',
          ok: false,
          details: `Failed to parse codex mcp list output: ${(error as Error).message}`,
          remediation: 'Run `codex mcp list --json` and inspect output.'
        });
      }
    } else {
      checks.push({
        id: 'codex.mcp_list',
        ok: false,
        details: codexMcpList.stderr?.trim() || 'codex mcp list failed',
        remediation: 'Verify Codex CLI install and MCP support (`codex mcp --help`).'
      });
    }

    // Check MCP profiles using service manager
    for (const profileName of profileNames) {
      const status = await serviceManager.status(profileName);
      const registration = serviceManager.codexRegistration(profileName);
      const registered = registration ? codexMcpNames.has(registration.codexName) : true;
      const healthy = status.healthy !== false;
      const ok = status.running && healthy && registered;

      let details = `running=${status.running} healthy=${status.healthy === null ? 'n/a' : status.healthy} registered=${registered}`;
      if (status.diagnostics.length) {
        details += ` diagnostics=${status.diagnostics.join(' | ')}`;
      }

      const remediationParts: string[] = [];
      if (!status.running || !healthy) {
        remediationParts.push(`codex-synaptic env up ${profileName}`);
      }
      if (registration && !registered) {
        remediationParts.push(`codex-synaptic env codex-register ${profileName}`);
      }

      checks.push({
        id: `mcp.${profileName}`,
        ok,
        details,
        remediation: remediationParts.length ? remediationParts.join(' && ') : undefined,
        metadata: {
          codexName: registration?.codexName,
          url: registration?.url
        }
      });
    }

    renderHealthCheckResults(checks, { json: options.json, strict: options.strict });
  }));

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

// TUI mode
const tuiCmd = decorateCommandHelp(
  program
    .command('tui')
    .description('Launch the live terminal dashboard (Ink-based TUI)'),
  {
    title: 'TUI Monitor Deck',
    subtitle: 'Run a live terminal dashboard backed by local or daemon telemetry.',
    context: [
      'TUI mode gives you a persistent operational pane with low-latency status updates.',
      'If a detached daemon is running, attach mode avoids creating a second orchestrator instance.'
    ],
    skills: [
      'Track agent/scheduler health in one view while you run swarm and bridge workflows.',
      'Use refresh/quit key bindings to keep diagnostics fast during incident response.'
    ],
    vibeTips: [
      'Use daemon attach mode for long-lived monitoring while other shells run task commands.'
    ],
    actions: [
      { command: 'codex-synaptic tui --attach-daemon', description: 'Attach to background daemon telemetry.' },
      { command: 'codex-synaptic tui', description: 'Start a local runtime dashboard in this shell.' }
    ],
    docs: [
      { label: 'docs/guides/codex-macos-workflows.md', description: 'Operational workflow for Local/Worktree/Cloud and MCP setup.' }
    ]
  }
);

tuiCmd
  .option('--attach-daemon', 'Attach to detached daemon state instead of starting a local runtime')
  .option('--local', 'Force local in-process runtime dashboard')
  .option('-i, --interval <ms>', 'Refresh interval in milliseconds', '1000')
  .option('--tier <tier>', 'UI tier hint (beginner|intermediate|advanced)', 'intermediate')
  .action(handleCommand('tui', async (options) => {
    const intervalMs = parseInteger(options.interval, 'interval');
    const tier = String(options.tier ?? 'intermediate') as InterfaceTier;
    if (!['beginner', 'intermediate', 'advanced'].includes(tier)) {
      throw new Error('tier must be one of beginner|intermediate|advanced');
    }

    const background = getBackgroundStatus();
    const attachDaemon = Boolean(options.attachDaemon) || (!options.local && background.running && !session.getSystemUnsafe());

    if (attachDaemon) {
      if (!background.running) {
        throw new Error('Background daemon is not running. Start it with `codex-synaptic background start`.');
      }

      await startTui({
        initialTier: tier,
        provider: {
          sourceLabel: 'daemon',
          refreshIntervalMs: intervalMs,
          fetchSnapshot: async () => {
            const snapshot = await queryBackgroundRuntimeSnapshot();
            if (!snapshot) {
              throw new Error('Daemon snapshot unavailable.');
            }
            return {
              source: 'daemon',
              ...snapshot
            } as TuiRuntimeSnapshot;
          }
        }
      });
      return;
    }

    if (background.running && process.env.CODEX_ALLOW_LOCAL_WITH_DAEMON !== '1') {
      throw new Error(
        'Background daemon is already running. Use `codex-synaptic tui --attach-daemon` ' +
        'or stop the daemon first to avoid split-brain orchestration.'
      );
    }

    bootstrapEnvForCli();
    const hadSystem = Boolean(session.getSystemUnsafe());
    const system = hadSystem ? session.getSystemUnsafe()! : await session.ensureSystem();

    await startTui({
      initialTier: tier,
      provider: {
        sourceLabel: 'local',
        refreshIntervalMs: intervalMs,
        fetchSnapshot: async () => {
          const status = system.getStatus();
          const registryStatus = system.getAgentRegistry().getStatus();
          return {
            source: 'local',
            pid: process.pid,
            startedAt: undefined,
            updatedAt: new Date().toISOString(),
            cwd: process.cwd(),
            interfaceMode: 'tui',
            tier,
            status: {
              initialized: Boolean(status?.initialized),
              shuttingDown: Boolean(status?.shuttingDown),
              daemon: false
            },
            telemetry: {
              agents: {
                total: registryStatus.totalAgents,
                available: registryStatus.availableAgents,
                byType: { ...registryStatus.typeCounts },
                byStatus: { ...registryStatus.statusCounts }
              },
              resources: system.getResourceManager().getCurrentUsage(),
              mesh: system.getNeuralMesh().getStatus(),
              swarm: system.getSwarmCoordinator().getStatus(),
              consensus: system.getConsensusManager().getStatus(),
              recentTasks: session.getTelemetry().recentTasks
            }
          } as TuiRuntimeSnapshot;
        }
      }
    });

    if (!hadSystem && cliAutoShutdown) {
      await session.shutdown('tui-auto-shutdown');
    }
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
      }, { autoShutdown: false });
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
