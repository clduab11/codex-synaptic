import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { load as loadYaml, dump as dumpYaml } from 'js-yaml';
import { CodexContextBuilder, renderCodexContextBlock, composePromptWithContext } from './codex-context.js';
import {
  persistCodexContextBlock,
  persistCodexToolkit,
  writeCodexHandbook,
  persistCodexReplArtifacts
} from './codex-guidance.js';
import type { CodexSynapticSystem } from '../core/system.js';
import type {
  CodexContext,
  CodexContextAggregationMetadata,
  ContextLogEntry,
  CodexPromptEnvelope
} from '../types/codex-context.js';
import { Logger, LogLevel } from '../core/logger.js';

const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);

const REPL_COMMAND_STARTERS = [
  '!codex-synaptic help',
  '!codex-synaptic hive-mind spawn "Design a queen-coordinated swarm rehearsal" --queen-coordinator --agents 8 --mesh-topology mesh --consensus bft',
  '!codex-synaptic swarm status',
  '!codex-synaptic mesh configure --nodes 9 --topology ring',
  '!codex-synaptic system status',
  '!codex-synaptic tenant quotas inspect --tenant default',
  '!codex-synaptic observability dashboards list',
  '!codex-synaptic instructions doctor --codex',
  '!curl -s https://api.tavily.com/search -H "Authorization: Bearer $TAVILY_API_KEY" -H "Content-Type: application/json" -d \'{"query":"latest AI breakthroughs"}\''
];

type ReplPromptExtras = {
  webResearch?: boolean;
  tavilyEndpoint?: string;
};

export function buildDefaultReplPrompt(command: string, args: string[], extras?: ReplPromptExtras): string {
  const primaryInvocation = ['!codex-synaptic', command, ...args]
    .filter((segment) => Boolean(segment && segment.trim().length))
    .join(' ')
    .trim();

  const startingCommand = primaryInvocation.length ? primaryInvocation : '!codex-synaptic help';

  const lines: string[] = [
    'You are orchestrating Codex-Synaptic from within the OpenAI Codex CLI (`codex`). Assume full control of the platform from this REPL.',
    'Use shell escapes (prefix commands with `!`) to call the `codex-synaptic` CLI that is already on PATH, and chain Codex tools as needed.',
    'When invoking Codex tools, prefer the `codex` CLI primitives (e.g., `run`, `files`, `plan`) to coordinate actions.',
    'Capabilities you can call immediately:',
    '- Launch hive-mind swarms with queen coordinators, mesh tuning, and consensus guards.',
    '- Configure swarm optimizers and neural mesh topologies for PSO, ACO, flocking, or hybrid strategies.',
    '- Inspect health, observability dashboards, tenant quotas, and memory stores.',
    '- Apply instruction updates, GOAP manifests, and tooling migrations directly from the REPL.',
    'Respond with decisive CLI actions, narrating rationale briefly before executing.',
    'Before you finish, provide a concise wrap-up describing accomplishments achieved and the recommended next actions, then exit the REPL cleanly.'
  ];

  if (extras?.webResearch) {
    const endpointDescriptor = extras.tavilyEndpoint ? ` (MCP endpoint ${extras.tavilyEndpoint})` : '';
    lines.push('Augment your reasoning with live web intelligence via the Tavily researcher:');
    const tavilyCurlLine = `- Use \`!curl\` with \`$TAVILY_API_KEY\` to call the Tavily Search API${endpointDescriptor ? `, exposed at ${extras.tavilyEndpoint}` : ''}.`;
    lines.push(tavilyCurlLine);
    lines.push('- Or issue `!codex-synaptic bridge mcp-send --endpoint tavily --payload \'{"query":"<topic>"}\'` after connecting Tavily through the MCP bridge.');
  }

  lines.push(`If you need a starting point run: \`${startingCommand}\`.`);

  return lines.join('\n');
}

function appendWebResearchInstruction(prompt: string): string {
  const trimmed = prompt.trimEnd();
  if (!trimmed) {
    return prompt;
  }

  // Prevent duplicate guidance if Tavily instructions already exist.
  if (/tavily|web researcher|web research/i.test(trimmed)) {
    return prompt;
  }

  const advisory = 'Augment your exploration with Tavily web research by issuing `!codex-synaptic bridge mcp-send --endpoint tavily --payload \"{\\"query\\":\\"<topic>\\"}\"` or by calling `!curl -s https://api.tavily.com/search` with the `$TAVILY_API_KEY` secret when you need current information.';

  return `${trimmed}\n\n${advisory}`;
}
type CodexExecutable = {
  command: string;
  args: string[];
  displayName: string;
  mode: 'binary' | 'npx';
};

type VersionInfo = {
  raw: string;
  parts: [number, number, number];
};

type CodexExecutableResolution =
  | { executable: CodexExecutable }
  | { reason: 'not-found'; tried: string[] };

/**
 * Codex CLI Passthrough Handler
 * 
 * Similar to claude-flow, this module enables passing commands with --codex flag
 * through to the OpenAI Codex CLI with enriched context about Codex-Synaptic's
 * capabilities, agents, and current system state.
 */

export interface CodexPassthroughOptions {
  command: string;
  args: string[];
  system?: CodexSynapticSystem;
  projectRoot: string;
  dryRun?: boolean;
  verbose?: boolean;
  promptOverride?: string;
  codexCliArgs?: string[];
  mode?: 'prompt' | 'passthrough';
  replArtifacts?: {
    prompt: string;
    promptPath?: string;
    handbookPath?: string;
  };
  timeoutMs?: number;
  enforceWrapUp?: boolean;
  webResearch?: CodexWebResearchOptions;
}

export interface CodexPassthroughResult {
  success: boolean;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  contextUsed?: string;
  executedPlan?: CodexSynapticPlanExecutionSummary;
  instructions?: string[];
}

export interface CodexWebResearchOptions {
  enabled: boolean;
  endpoint?: string;
}

export interface CodexSynapticPlanFile {
  path: string;
  content: string;
  encoding?: 'utf8' | 'base64';
  append?: boolean;
}

export interface CodexSynapticPlan {
  summary?: string;
  commands?: string[];
  files?: CodexSynapticPlanFile[];
}

export interface CodexSynapticPlanExecutionSummary {
  summary?: string;
  commands: Array<{ command: string; exitCode: number }>;
  files: Array<{ path: string; bytesWritten: number }>;
}

const DEFAULT_NPX_PACKAGE = '@openai/codex@latest';
const DEFAULT_TIMEOUT_MS = 1000 * 60 * (Number(process.env.CODEX_PASSTHROUGH_TIMEOUT_MINUTES ?? '120') || 120);

const SECTION_DIVIDER = chalk.gray('─'.repeat(80));

function toSemanticYaml(value: unknown): string {
  try {
    return dumpYaml(value ?? {}, {
      indent: 2,
      lineWidth: 110,
      noRefs: true,
      sortKeys: false
    }).trim();
  } catch {
    return String(value);
  }
}

function renderSection(title: string, bodyLines: string[]): void {
  const header = chalk.cyanBright.bold(`◼ ${title}`);
  console.log(header);
  console.log(SECTION_DIVIDER);
  for (const line of bodyLines) {
    console.log(line);
  }
  console.log(SECTION_DIVIDER);
  console.log('');
}

function indentMultiline(content: string, spaces = 2): string[] {
  const prefix = ' '.repeat(spaces);
  return content.split('\n').map((line) => `${prefix}${line}`);
}

type SectionPreview = {
  lines: string[];
  totalLines: number;
  truncated: boolean;
  omittedLines: number;
};

function createSectionPreview(
  content: string,
  options?: { head?: number; tail?: number; placeholder?: string }
): SectionPreview {
  const lines = content.split(/\r?\n/);
  const head = options?.head ?? 60;
  const tail = options?.tail ?? 20;
  const placeholder = options?.placeholder;

  if (lines.length <= head + tail + 1) {
    return {
      lines,
      totalLines: lines.length,
      truncated: false,
      omittedLines: 0
    };
  }

  const headLines = lines.slice(0, Math.max(0, head));
  const tailLines = tail > 0 ? lines.slice(-tail) : [];
  const omitted = Math.max(0, lines.length - headLines.length - tailLines.length);
  const marker = placeholder ?? `... (${omitted} lines omitted)`;

  return {
    lines: [...headLines, marker, ...tailLines],
    totalLines: lines.length,
    truncated: true,
    omittedLines: omitted
  };
}

function resolveCommandInPath(name: string): string | null {
  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, name);
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function findCodexBinaries(): string[] {
  const possibleNames = ['codex', 'openai-codex', 'codex-cli'];
  const results = new Set<string>();
  const pathDirs = new Set(
    (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  );

  const extraBin = getGlobalNpmBin();
  if (extraBin) {
    pathDirs.add(extraBin);
  }

  for (const dir of pathDirs) {
    for (const name of possibleNames) {
      const candidate = path.join(dir, name);
      if (!fs.existsSync(candidate)) {
        continue;
      }
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        results.add(candidate);
      } catch {
        continue;
      }
    }
  }

  return Array.from(results);
}

function getGlobalNpmBin(): string | null {
  try {
    const output = spawnSync('npm', ['bin', '-g'], {
      encoding: 'utf8'
    });
    if (output.status !== 0 || !output.stdout) {
      return null;
    }
    const binPath = output.stdout.trim();
    return binPath.length ? binPath : null;
  } catch {
    return null;
  }
}

function parseVersion(raw: string): VersionInfo | null {
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (parts.some((value) => Number.isNaN(value))) {
    return null;
  }
  return {
    raw,
    parts
  };
}

function compareVersions(a: VersionInfo | null, b: VersionInfo | null): number {
  if (!a && !b) {
    return 0;
  }
  if (a && !b) {
    return 1;
  }
  if (!a && b) {
    return -1;
  }
  if (!a || !b) {
    return 0;
  }
  for (let i = 0; i < 3; i += 1) {
    const delta = a.parts[i] - b.parts[i];
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function getExecutableVersion(executable: CodexExecutable): VersionInfo | null {
  try {
    const result = spawnSync(executable.command, [...executable.args, '--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000
    });
    if (result.error) {
      return null;
    }
    if (result.status !== 0) {
      return null;
    }
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    return parseVersion(output);
  } catch {
    return null;
  }
}

function buildNpxExecutable(): CodexExecutableResolution {
  const npx = resolveCommandInPath('npx') ?? resolveCommandInPath('pnpx');
  if (!npx) {
    return { reason: 'not-found', tried: ['npx', 'pnpx'] };
  }

  const pkg = process.env.CODEX_PASSTHROUGH_NPX_PACKAGE || DEFAULT_NPX_PACKAGE;
  const args = ['--yes', pkg];
  return {
    executable: {
      command: npx,
      args,
      displayName: `${path.basename(npx)} ${pkg}`,
      mode: 'npx'
    }
  };
}

export function resolveCodexExecutable(): CodexExecutableResolution {
  const strategy = (process.env.CODEX_PASSTHROUGH_STRATEGY || '').toLowerCase();
  const tried: string[] = [];

  if (strategy === 'npx') {
    const viaNpx = buildNpxExecutable();
    return 'executable' in viaNpx ? viaNpx : { reason: 'not-found', tried: viaNpx.tried };
  }

  const binaries = findCodexBinaries();
  let best: { executable: CodexExecutable; version: VersionInfo | null } | null = null;

  for (const binaryPath of binaries) {
    tried.push(binaryPath);
    const executable: CodexExecutable = {
      command: binaryPath,
      args: [],
      displayName: path.basename(binaryPath),
      mode: 'binary'
    };
    const version = getExecutableVersion(executable);

    if (!best) {
      best = { executable, version };
      continue;
    }

    const comparison = compareVersions(version, best.version);
    if (comparison > 0) {
      best = { executable, version };
    }
  }

  const viaNpx = buildNpxExecutable();
  if ('executable' in viaNpx) {
    const npxDescriptor = `${viaNpx.executable.command} ${viaNpx.executable.args.join(' ')}`.trim();
    tried.push(npxDescriptor);
    const npxVersion = getExecutableVersion(viaNpx.executable);

    if (!best || compareVersions(npxVersion, best.version) > 0) {
      return viaNpx;
    }
  } else {
    tried.push(...viaNpx.tried);
  }

  if (best) {
    return { executable: best.executable };
  }

  if ('executable' in viaNpx) {
    return viaNpx;
  }

  const fallbackTried = tried.length ? tried : ['codex', 'openai-codex', 'codex-cli', 'npx'];
  return { reason: 'not-found', tried: [...new Set(fallbackTried)] };
}

/**
 * Build comprehensive Codex-Synaptic context for CLI passthrough
 */
export async function buildCodexSynapticContext(
  projectRoot: string,
  system?: CodexSynapticSystem
): Promise<{
  block: string;
  context: CodexContext;
  metadata: CodexContextAggregationMetadata;
  logs: ContextLogEntry[];
}> {
  const builder = new CodexContextBuilder(projectRoot, {
    useEnhancedInstructionParser: true
  });
  await builder.withAgentDirectives();
  await builder.withReadmeExcerpts();
  await builder.withDirectoryInventory();
  await builder.withDatabaseMetadata();
  const buildResult = await builder.build();

  const lines: string[] = [];
  lines.push('# CODEX-SYNAPTIC SNAPSHOT');
  lines.push('');
  lines.push(renderCodexContextBlock(buildResult.context));
  lines.push('');

  lines.push('## Live System');
  if (system && system.isReady()) {
    const agentStatus = system.getAgentRegistry().getStatus();
    const meshStatus = system.getNeuralMesh().getStatus();
    const consensusStatus = system.getConsensusManager().getStatus();
    lines.push(`- Agents active: ${agentStatus.active}/${agentStatus.total}`);
    lines.push(`- Mesh: ${meshStatus.nodes} nodes (${meshStatus.topology})`);
    lines.push(`- Consensus: ${consensusStatus.mechanism}, pending proposals: ${consensusStatus.pendingProposals}`);
  } else {
    lines.push('- Orchestrator not running (context only).');
  }

  return {
    block: lines.join('\n'),
    context: buildResult.context,
    metadata: buildResult.metadata,
    logs: buildResult.logs
  };
}

/**
 * Convert codex-synaptic command to natural language prompt
 */
function buildPromptFromCommand(command: string, args: string[]): string {
  // Remove flags from args for the prompt
  const cleanArgs = args.filter(arg => !arg.startsWith('--'));
  
  // Build a natural language prompt from the command
  const commandMap: Record<string, string> = {
    'agent': 'Manage agents in the Codex-Synaptic platform',
    'mesh': 'Configure and manage the neural mesh network',
    'swarm': 'Control swarm intelligence coordination',
    'system': 'System lifecycle and monitoring',
    'consensus': 'Distributed consensus and voting',
    'task': 'Task management and execution',
    'router': 'Routing engine and persona management',
    'tools': 'Tool optimization and telemetry',
    'reasoning': 'Tree-of-Thought planning and execution',
    'hive-mind': 'Hive-mind swarm orchestration',
    'instructions': 'AGENTS.md directive management',
    'tenant': 'Multi-tenancy and resource quotas',
    'interactive': 'Launch interactive dashboard',
    prompt: 'Execute codex-synaptic instruction'
  };

  const baseDescription = commandMap[command] || `Execute ${command} command`;
  
  // Combine into prompt
  if (cleanArgs.length > 0) {
    return `${baseDescription}: ${cleanArgs.join(' ')}`;
  }
  
  return baseDescription;
}

/**
 * Execute command with Codex CLI passthrough
 */
export async function executeCodexPassthrough(
  options: CodexPassthroughOptions
): Promise<CodexPassthroughResult> {
  const {
    command,
    args,
    system,
    projectRoot,
    dryRun,
    verbose,
    promptOverride,
    codexCliArgs = [],
    mode,
    replArtifacts,
    timeoutMs,
    enforceWrapUp,
    webResearch
  } = options;

  if (process.env.CODEX_PASSTHROUGH_MOCK === '1') {
    console.log(chalk.magenta('🧪 Mock Codex passthrough enabled (tests only)'));
    return {
      success: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
      contextUsed: '[mock-context]'
    };
  }

  const debugTokens = (process.env.DEBUG || '')
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const debugEnabled = debugTokens.includes('codex-synaptic:codex');
  const showVerbose = Boolean(verbose || dryRun || process.env.CODEX_CONTEXT_DEBUG === '1' || debugEnabled);

  const hasPromptOverride = Boolean(promptOverride && promptOverride.trim().length > 0);
  const defaultMode: 'prompt' | 'passthrough' = hasPromptOverride ? 'prompt' : 'passthrough';
  const effectiveMode: 'prompt' | 'passthrough' = mode ?? defaultMode;
  let effectiveReplArtifacts: CodexPassthroughOptions['replArtifacts'] = replArtifacts
    ? { ...replArtifacts }
    : undefined;
  const researchEnabled = webResearch?.enabled === true;
  const researchEndpoint = webResearch?.endpoint;
  if (researchEnabled && effectiveReplArtifacts?.prompt) {
    effectiveReplArtifacts.prompt = appendWebResearchInstruction(effectiveReplArtifacts.prompt);
  }
  const defaultReplPrompt = effectiveMode === 'passthrough'
    ? buildDefaultReplPrompt(command, args, {
        webResearch: researchEnabled,
        tavilyEndpoint: researchEnabled ? researchEndpoint : undefined
      })
    : '';

  const wrapUpDirective = enforceWrapUp ?? true;

  let basePrompt = effectiveMode === 'prompt' ? (promptOverride ?? buildPromptFromCommand(command, args)).trim() : '';
  if (researchEnabled && basePrompt) {
    basePrompt = appendWebResearchInstruction(basePrompt);
  }
  const promptHasWrap = basePrompt.toLowerCase().includes('summarize accomplishments');
  const prompt = wrapUpDirective && basePrompt && !promptHasWrap
    ? `${basePrompt}\n\nWhen you conclude, summarize accomplishments achieved and list the next recommended actions before exiting.`
    : basePrompt;

  if (effectiveMode === 'prompt' && !prompt) {
    console.error(chalk.red('❌ Codex passthrough requires a prompt when running in prompt mode.'));
    return {
      success: false,
      exitCode: 1,
      stderr: 'Prompt required for Codex passthrough'
    };
  }

  const requiresContext =
    effectiveMode === 'prompt' || effectiveMode === 'passthrough' || Boolean(dryRun);

  let contextBlock = '';
  let metadata: CodexContextAggregationMetadata = {
    agentGuideCount: 0,
    codexDirectoryCount: 0,
    databaseCount: 0
  };
  let logs: ContextLogEntry[] = [];
  let codexContext: CodexContext | undefined;
  let toolkitPath: string | null = null;
  let handbookPath: string | null = null;
  let contextFilePath: string | null = null;
  let basePromptForHooks: string | undefined;
  let enrichedPromptForHooks: string | undefined;
  let codexEnvelopeForHooks: CodexPromptEnvelope | undefined;

  if (requiresContext) {
    if (showVerbose) {
      console.log(chalk.cyan('📚 Building Codex-Synaptic context for passthrough...'));
    }

    let logger: Logger | null = null;
    let previousConsoleLevel: LogLevel | null = null;

    if (!showVerbose) {
      logger = Logger.getInstance();
      previousConsoleLevel = logger.getConsoleLevel();
      logger.setConsoleLevel(LogLevel.ERROR);
    }

    try {
      const result = await buildCodexSynapticContext(projectRoot, system);
      contextBlock = result.block;
      metadata = result.metadata;
      logs = result.logs;
      codexContext = result.context;

      toolkitPath = await persistCodexToolkit(projectRoot, result.context, result.metadata);
      handbookPath = await writeCodexHandbook(projectRoot, result.context, result.metadata);
      contextFilePath = await persistCodexContextBlock(projectRoot, contextBlock);

      basePromptForHooks = hasPromptOverride
        ? promptOverride?.trim()
        : buildPromptFromCommand(command, args).trim();
      let rawPromptForHooks = (basePromptForHooks && basePromptForHooks.length > 0)
        ? basePromptForHooks
        : '';
      if (!rawPromptForHooks && effectiveReplArtifacts?.prompt) {
        rawPromptForHooks = effectiveReplArtifacts.prompt;
      }
      if (!rawPromptForHooks && effectiveMode === 'passthrough') {
        rawPromptForHooks = defaultReplPrompt;
      }

      if (researchEnabled && rawPromptForHooks) {
        rawPromptForHooks = appendWebResearchInstruction(rawPromptForHooks);
      }

      if (effectiveMode === 'passthrough') {
        if (!effectiveReplArtifacts) {
          effectiveReplArtifacts = { prompt: rawPromptForHooks };
        } else if (!effectiveReplArtifacts.prompt) {
          effectiveReplArtifacts.prompt = rawPromptForHooks;
        }
      }

      if (rawPromptForHooks && codexContext) {
        const hasWrapInstruction = rawPromptForHooks.toLowerCase().includes('summarize accomplishments');
        const promptForHooks = wrapUpDirective && !hasWrapInstruction
          ? `${rawPromptForHooks}\n\nEnsure your final response summarizes accomplishments achieved and suggested next actions before exit.`
          : rawPromptForHooks;
        rawPromptForHooks = promptForHooks;
        enrichedPromptForHooks = composePromptWithContext(promptForHooks, codexContext);
        codexEnvelopeForHooks = {
          originalPrompt: promptForHooks,
          enrichedPrompt: enrichedPromptForHooks,
          contextBlock
        };
      }

      if (effectiveMode === 'passthrough' && effectiveReplArtifacts) {
        const replPersisted = await persistCodexReplArtifacts(projectRoot, result.context, result.metadata, {
          prompt: enrichedPromptForHooks ?? rawPromptForHooks ?? effectiveReplArtifacts.prompt,
          enrichedPrompt: enrichedPromptForHooks
        });
        effectiveReplArtifacts.prompt = enrichedPromptForHooks ?? rawPromptForHooks ?? effectiveReplArtifacts.prompt;
        effectiveReplArtifacts.promptPath = replPersisted.promptPath;
        effectiveReplArtifacts.handbookPath = replPersisted.handbookPath;
      }
    } finally {
      if (logger && previousConsoleLevel !== null) {
        logger.setConsoleLevel(previousConsoleLevel);
      }
    }

    if (system && codexContext && codexEnvelopeForHooks) {
      try {
        await system.primeCodexInterface(codexContext, codexEnvelopeForHooks);
        const preflight = (system as unknown as {
          runCodexPreflightHooks?: (prompt: string) => Promise<void> | void;
        }).runCodexPreflightHooks;
        if (typeof preflight === 'function') {
          await preflight.call(system, codexEnvelopeForHooks.enrichedPrompt);
        }
      } catch (error) {
        console.error(chalk.red(`❌ Codex preflight failed: ${(error as Error).message}`));
      }
    }

    if (showVerbose) {
      const summaryLines: string[] = [
        chalk.gray(
          `Context size: ${Buffer.byteLength(contextBlock, 'utf8')} bytes | Agent guides: ${metadata.agentGuideCount} | Directories: ${metadata.codexDirectoryCount} | Databases: ${metadata.databaseCount}`
        )
      ];
      if (toolkitPath) {
        summaryLines.push(chalk.gray(`Toolkit manifest ▸ ${toolkitPath}`));
      }
      if (handbookPath) {
        summaryLines.push(chalk.gray(`Handbook ▸ ${handbookPath}`));
      }
      if (contextFilePath) {
        summaryLines.push(chalk.gray(`Context snapshot ▸ ${contextFilePath}`));
      }
      if (replArtifacts?.promptPath) {
        summaryLines.push(chalk.gray(`REPL prompt ▸ ${replArtifacts.promptPath}`));
      }
      if (replArtifacts?.handbookPath) {
        summaryLines.push(chalk.gray(`REPL handbook ▸ ${replArtifacts.handbookPath}`));
      }
      renderSection('Context Assembly', summaryLines);

      if (logs.length) {
        const logLines: string[] = [];
        for (const entry of logs) {
          const icon = entry.level === 'error' ? chalk.red('❌') : entry.level === 'warn' ? chalk.yellow('⚠️') : chalk.green('•');
          logLines.push(`${icon} ${chalk.white(entry.message)}`);
          if (entry.details && typeof entry.details === 'object') {
            const yamlDetails = toSemanticYaml(entry.details);
            logLines.push(...indentMultiline(chalk.gray(yamlDetails)));
          }
        }
        renderSection('Context Builder Log', logLines);
      }
    }
  }

  if (dryRun) {
    console.log(chalk.yellow('\n⚙️  DRY RUN - Context that would be sent to Codex CLI:\n'));

    const contextPreview = createSectionPreview(contextBlock, {
      head: 80,
      tail: 20,
      placeholder: '... (context preview truncated)'
    });
    const contextLines = contextPreview.lines.map((line) => chalk.gray(line));
    const contextTitle = contextPreview.truncated ? 'Codex Context Preview' : 'Codex Context Snapshot';
    renderSection(contextTitle, contextLines);

    if (prompt) {
      const promptLines = prompt.split('\n').map((line) => chalk.white(line));
      renderSection('Prompt Preview', promptLines);
    }

    const artifactLines: string[] = [];
    artifactLines.push(
      chalk.gray(
        `Context lines: ${contextPreview.totalLines}${contextPreview.truncated ? ` ▸ showing ${contextPreview.lines.length}` : ''}`
      )
    );
    if (contextPreview.truncated && contextPreview.omittedLines > 0) {
      artifactLines.push(chalk.gray(`Preview omitted ${contextPreview.omittedLines} lines for readability.`));
    }
    if (toolkitPath) {
      artifactLines.push(chalk.gray(`Toolkit manifest ▸ ${toolkitPath}`));
    }
    if (handbookPath) {
      artifactLines.push(chalk.gray(`Handbook ▸ ${handbookPath}`));
    }
    if (contextFilePath) {
      artifactLines.push(chalk.gray(`Context snapshot ▸ ${contextFilePath}`));
    }
    if (replArtifacts?.promptPath) {
      artifactLines.push(chalk.gray(`REPL prompt ▸ ${replArtifacts.promptPath}`));
    }
    if (replArtifacts?.handbookPath) {
      artifactLines.push(chalk.gray(`REPL handbook ▸ ${replArtifacts.handbookPath}`));
    }
    if (artifactLines.length) {
      renderSection('Generated Artifacts', artifactLines);
    }
    return {
      success: true,
      exitCode: 0,
      contextUsed: contextBlock
    };
  }

  const resolution = resolveCodexExecutable();
  if ('reason' in resolution) {
    console.error(chalk.red('❌ Codex CLI not found!'));
    console.error('');
    console.error(chalk.yellow('The --codex flag requires the OpenAI Codex CLI to be available.'));
    console.error(chalk.gray('Tried binaries: codex, openai-codex, codex-cli'));
    console.error(chalk.gray(`Tried npx packages: ${DEFAULT_NPX_PACKAGE}`));
    console.error('');
    console.error(chalk.cyan('Installation options:'));
    console.error(chalk.gray('  npm install -g @openai/codex'));
    console.error(chalk.gray('  # or'));
    console.error(chalk.gray('  brew install codex'));
    console.error(chalk.gray(`  # or ensure npx can reach ${DEFAULT_NPX_PACKAGE}`));
    return {
      success: false,
      exitCode: 1,
      stderr: 'Codex CLI not found in PATH'
    };
  }

  const { executable } = resolution;
  const executableVersion = getExecutableVersion(executable);
  const executableDescriptor = executableVersion
    ? `${executable.displayName} ${executableVersion.raw}`
    : executable.displayName;

  const envTimeoutRaw = Number(process.env.CODEX_PASSTHROUGH_TIMEOUT_MS ?? '');
  const envTimeoutMs = Number.isFinite(envTimeoutRaw) && envTimeoutRaw > 0 ? envTimeoutRaw : undefined;
  const timeoutToUse = timeoutMs ?? envTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const estimatedMinutes = Number.isFinite(timeoutToUse) && timeoutToUse > 0 ? timeoutToUse / 60000 : null;

  let fullPrompt = '';
  if (effectiveMode === 'prompt') {
    fullPrompt = `${contextBlock}\n\n---\n\n## User Request\n\n${prompt}`;
  }

  const env: Record<string, string> = {};
  if (contextBlock) {
    env.CODEX_SYNAPTIC_CONTEXT = '1';
    env.CODEX_SYNAPTIC_CONTEXT_MODE = effectiveMode;
    env.CODEX_SYNAPTIC_CONTEXT_BLOB = contextBlock;
    if (contextFilePath) {
      env.CODEX_SYNAPTIC_CONTEXT_PATH = contextFilePath;
    }
    if (codexContext) {
      env.CODEX_SYNAPTIC_CONTEXT_HASH = codexContext.contextHash;
      env.CODEX_SYNAPTIC_CONTEXT_BYTES = String(codexContext.sizeBytes);
    }
  }
  if (toolkitPath) {
    env.CODEX_SYNAPTIC_TOOLKIT_PATH = toolkitPath;
  }
  if (handbookPath) {
    env.CODEX_SYNAPTIC_GUIDE_PATH = handbookPath;
  }
  if (effectiveReplArtifacts?.prompt) {
    env.CODEX_SYNAPTIC_BOOT_PROMPT = effectiveReplArtifacts.prompt;
  }
  if (effectiveReplArtifacts?.promptPath) {
    env.CODEX_SYNAPTIC_BOOT_PROMPT_PATH = effectiveReplArtifacts.promptPath;
  }
  if (effectiveReplArtifacts?.handbookPath) {
    env.CODEX_SYNAPTIC_REPL_GUIDE_PATH = effectiveReplArtifacts.handbookPath;
  }
  if (effectiveMode === 'passthrough') {
    env.CODEX_SYNAPTIC_REPL_COMMANDS = JSON.stringify(REPL_COMMAND_STARTERS);
    env.CODEX_SYNAPTIC_REPL_ROLE = 'orchestrator';
  }
  env.CODEX_SYNAPTIC_COMMAND = command;
  env.CODEX_SYNAPTIC_ARGS = JSON.stringify(args);
  if (codexCliArgs.length) {
    env.CODEX_SYNAPTIC_CLI_ARGS = JSON.stringify(codexCliArgs);
  }
  env.CODEX_SYNAPTIC_MODE = effectiveMode;
  env.CODEX_SYNAPTIC_TIMEOUT_MS = String(timeoutToUse);
  if (estimatedMinutes !== null) {
    env.CODEX_SYNAPTIC_TIMEOUT_MINUTES = estimatedMinutes.toFixed(3);
  }

  const guidanceLines: string[] = [];
  guidanceLines.push(`Detected official Codex CLI: ${executableDescriptor} (${executable.command})`);
  guidanceLines.push('1. Launch the official OpenAI Codex CLI (`codex`) if it is not already running.');
  if (contextFilePath) {
    guidanceLines.push(`2. Within Codex, review the generated context snapshot at ${contextFilePath}.`);
  } else {
    guidanceLines.push('2. No context snapshot file was generated; context is embedded in the payload below.');
  }
  if (effectiveMode === 'prompt') {
    guidanceLines.push('3. Execute the prompt shown below using your preferred Codex command (e.g., `run`, `plan`, or `workflow`).');
  } else {
    if (effectiveReplArtifacts?.promptPath) {
      guidanceLines.push(`3. Load the REPL boot prompt from ${effectiveReplArtifacts.promptPath} to seed the interactive session.`);
    } else {
      guidanceLines.push('3. Use the REPL instructions printed below to seed your interactive Codex session.');
    }
  }
  if (toolkitPath) {
    guidanceLines.push(`• Toolkit manifest ready at ${toolkitPath}.`);
  }
  if (handbookPath) {
    guidanceLines.push(`• Handbook available at ${handbookPath}.`);
  }
  if (codexCliArgs.length) {
    guidanceLines.push(`• Additional Codex CLI arguments requested: ${codexCliArgs.join(' ')}`);
  }
  if (estimatedMinutes !== null) {
    guidanceLines.push(`• Suggested timeout window: ${estimatedMinutes.toFixed(1)} minutes.`);
  }

  renderSection('Codex Session Instructions', guidanceLines.map((line) => chalk.white(line)));

  const envPreviewYaml = toSemanticYaml(env);
  renderSection('Environment Export Preview', indentMultiline(chalk.gray(envPreviewYaml)));

  if (effectiveMode === 'prompt' && prompt) {
    const promptLines = prompt.split('\n').map((line) => chalk.white(line));
    renderSection('Prompt Preview', promptLines);
  }

  if (effectiveMode === 'prompt' && fullPrompt) {
    const payloadLines = indentMultiline(fullPrompt).map((line) => chalk.gray(line));
    renderSection('Codex Exec Payload', payloadLines);
  } else if (effectiveReplArtifacts?.prompt) {
    const replLines = effectiveReplArtifacts.prompt.split('\n').map((line) => chalk.white(line));
    renderSection('REPL Boot Prompt', replLines);
  }

  const instructions = guidanceLines.slice();

  return {
    success: true,
    exitCode: 0,
    stdout: instructions.join('\n'),
    contextUsed: contextBlock,
    instructions
  };
}

/**
 * Check if Codex CLI is available
 */
export function isCodexCliAvailable(): boolean {
  return 'executable' in resolveCodexExecutable();
}

/**
 * Parse Codex CLI output to locate actionable plans and execute them locally.
 * Exported to enable testing.
 */
export async function processCodexResponse(output: string, projectRoot: string): Promise<CodexSynapticPlanExecutionSummary | undefined> {
  const plan = extractPlanFromOutput(output);
  if (!plan) {
    return undefined;
  }

  const autoExecute = process.env.CODEX_PASSTHROUGH_AUTO_EXECUTE === '1';

  const summary: CodexSynapticPlanExecutionSummary = {
    summary: plan.summary,
    commands: [],
    files: []
  };

  if (!autoExecute) {
    const planDir = path.join(projectRoot, '.codex-synaptic');
    const planPath = path.join(planDir, 'codex-plan-latest.yaml');
    try {
      await mkdirAsync(planDir, { recursive: true });
      await writeFileAsync(planPath, dumpYaml({ codex_synaptic_plan: plan }), 'utf8');
      console.log(chalk.blue('\n📝 Codex-synaptic plan captured for review (no automatic execution).'));
      console.log(chalk.gray(`   Review and run manually: ${planPath}`));
    } catch (error) {
      console.error(chalk.red(`❌ Failed to persist Codex plan: ${(error as Error).message}`));
    }

    if (plan.commands?.length) {
      plan.commands.forEach((command) => {
        summary.commands.push({ command, exitCode: -1 });
      });
    }
    if (plan.files?.length) {
      plan.files.forEach((instruction) => {
        summary.files.push({ path: instruction.path, bytesWritten: 0 });
      });
    }

    return summary;
  }

  if (plan.files?.length) {
    for (const instruction of plan.files) {
      const fileRecord = await applyFileInstruction(instruction, projectRoot);
      summary.files.push(fileRecord);
    }
  }

  if (plan.commands?.length) {
    for (const command of plan.commands) {
      if (!command.startsWith('codex-synaptic') && !command.startsWith('npx codex-synaptic')) {
        console.log(chalk.yellow(`⚠️  Ignoring command "${command}" because it does not start with codex-synaptic.`));
        summary.commands.push({ command, exitCode: -1 });
        continue;
      }
      if (command.includes('--codex')) {
        console.log(chalk.yellow(`⚠️  Skipping command "${command}" because --codex is not permitted within plans.`));
        summary.commands.push({ command, exitCode: -1 });
        continue;
      }

      const exitCode = await executeLocalCommand(command, projectRoot);
      summary.commands.push({ command, exitCode });
    }
  }

  if (summary.commands.length || summary.files.length) {
    console.log(chalk.green('\n✅ Codex-synaptic plan executed locally.'));
    if (summary.summary) {
      console.log(chalk.gray(`   Summary: ${summary.summary}`));
    }
    summary.commands.forEach((entry) => {
      const statusIcon = entry.exitCode === 0 ? '✓' : '✗';
      console.log(chalk.gray(`   [${statusIcon}] ${entry.command} (exit ${entry.exitCode})`));
    });
    summary.files.forEach((entry) => {
      console.log(chalk.gray(`   📝 ${entry.path} (${entry.bytesWritten} bytes)`));
    });
  }

  return summary;
}

function extractPlanFromOutput(output: string): CodexSynapticPlan | undefined {
  const fencedBlockRegex = /```(yaml|yml|json)([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;

  while ((match = fencedBlockRegex.exec(output))) {
    const [, language, content] = match;
    try {
      if (language === 'json') {
        const parsed = JSON.parse(content);
        const plan = normalizePlan(parsed);
        if (plan) {
          return plan;
        }
      } else {
        const parsed = loadYaml(content) as unknown;
        const plan = normalizePlan(parsed);
        if (plan) {
          return plan;
        }
      }
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Failed to parse plan block: ${(error as Error).message}`));
    }
  }

  return undefined;
}

function normalizePlan(value: unknown): CodexSynapticPlan | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const container = value as Record<string, any>;
  const rawPlan =
    'codex_synaptic_plan' in container ? (container.codex_synaptic_plan as Record<string, any>) : container;
  if (!rawPlan || typeof rawPlan !== 'object') {
    return undefined;
  }

  const normalized: CodexSynapticPlan = {};
  if (typeof rawPlan.summary === 'string') {
    normalized.summary = rawPlan.summary.trim();
  }

  if (Array.isArray(rawPlan.commands)) {
    normalized.commands = rawPlan.commands
      .filter((entry: unknown) => typeof entry === 'string' && entry.trim().length > 0)
      .map((entry: string) => entry.trim());
  }

  if (Array.isArray(rawPlan.files)) {
    normalized.files = rawPlan.files
      .map((entry: unknown) => normalizeFileInstruction(entry))
      .filter((entry): entry is CodexSynapticPlanFile => Boolean(entry));
  }

  if (!normalized.commands && !normalized.files) {
    return undefined;
  }

  return normalized;
}

function normalizeFileInstruction(value: unknown): CodexSynapticPlanFile | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, any>;
  if (typeof record.path !== 'string' || !record.path.trim()) {
    return undefined;
  }
  if (typeof record.content !== 'string') {
    return undefined;
  }

  return {
    path: record.path.trim(),
    content: record.content,
    encoding: record.encoding === 'base64' ? 'base64' : 'utf8',
    append: Boolean(record.append)
  };
}

async function applyFileInstruction(
  instruction: CodexSynapticPlanFile,
  projectRoot: string
): Promise<{ path: string; bytesWritten: number }> {
  const absolutePath = path.resolve(projectRoot, instruction.path);
  if (!absolutePath.startsWith(projectRoot)) {
    throw new Error(`Refusing to write outside repository root: ${instruction.path}`);
  }

  await mkdirAsync(path.dirname(absolutePath), { recursive: true });
  const payload =
    instruction.encoding === 'base64' ? Buffer.from(instruction.content, 'base64') : instruction.content;

  if (instruction.append) {
    await fs.promises.appendFile(absolutePath, payload);
  } else {
    await writeFileAsync(absolutePath, payload);
  }

  const stats = await fs.promises.stat(absolutePath);
  return {
    path: path.relative(projectRoot, absolutePath),
    bytesWritten: stats.size
  };
}

async function executeLocalCommand(command: string, projectRoot: string): Promise<number> {
  console.log(chalk.cyan(`\n🛠️  Executing: ${command}`));
  return await new Promise<number>((resolve) => {
    const child = spawn('bash', ['-lc', command], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        CODEX_FROM_PASSTHROUGH: '1'
      }
    });

    child.on('exit', (code) => {
      resolve(code ?? 0);
    });

    child.on('error', (error) => {
      console.error(chalk.red(`   Command failed to launch: ${error.message}`));
      resolve(1);
    });
  });
}

/**
 * Get Codex CLI version
 */
export async function getCodexCliVersion(): Promise<string | null> {
  const resolution = resolveCodexExecutable();
  if (!('executable' in resolution)) {
    return null;
  }

  const cli = resolution.executable;

  return new Promise((resolve) => {
    const proc = spawn(cli.command, [...cli.args, '--version'], {
      stdio: 'pipe'
    });

    let output = '';
    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });

    proc.on('exit', () => {
      const version = output.trim();
      resolve(version || null);
    });

    proc.on('error', () => {
      resolve(null);
    });
  });
}
