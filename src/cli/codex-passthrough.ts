import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import chalk from 'chalk';
import { CodexContextBuilder, renderCodexContextBlock } from './codex-context.js';
import type { CodexSynapticSystem } from '../core/system.js';

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
}

export interface CodexPassthroughResult {
  success: boolean;
  exitCode: number;
  stdout?: string;
  stderr?: string;
  contextUsed?: string;
}

/**
 * Build comprehensive Codex-Synaptic context for CLI passthrough
 */
async function buildCodexSynapticContext(
  projectRoot: string,
  system?: CodexSynapticSystem
): Promise<string> {
  const contextParts: string[] = [];

  // Section 1: Platform Overview
  contextParts.push('# CODEX-SYNAPTIC PLATFORM CONTEXT');
  contextParts.push('');
  contextParts.push('## Platform Capabilities');
  contextParts.push('');
  contextParts.push('Codex-Synaptic is a distributed AI agent orchestration platform with:');
  contextParts.push('- **Neural Mesh Networking**: Self-organizing agent networks with dynamic topology');
  contextParts.push('- **Swarm Intelligence**: PSO, ACO, and flocking algorithms for collective problem-solving');
  contextParts.push('- **Consensus Mechanisms**: Raft, Byzantine, PoW, PoS for distributed decision-making');
  contextParts.push('- **25+ Specialized Agent Types**: Code, Data, Validation, Security, Performance, etc.');
  contextParts.push('- **Tree-of-Thought Reasoning**: Multi-branch exploration with Monte Carlo simulation');
  contextParts.push('- **Persistent Memory**: SQLite-backed knowledge retention across sessions');
  contextParts.push('- **Multi-Tenancy**: Resource quotas and namespace isolation');
  contextParts.push('');

  // Section 2: README.md Overview
  const readmePath = path.join(projectRoot, 'README.md');
  if (fs.existsSync(readmePath)) {
    contextParts.push('## Platform Documentation (README.md)');
    contextParts.push('');
    const readme = fs.readFileSync(readmePath, 'utf8');
    // Extract key sections (first 15000 chars to stay within limits)
    const readmeExcerpt = readme.slice(0, 15000);
    contextParts.push(readmeExcerpt);
    if (readme.length > 15000) {
      contextParts.push('');
      contextParts.push('_[README truncated for context limits - see full file for complete documentation]_');
    }
    contextParts.push('');
  }

  // Section 3: AGENTS.md - Complete Agent Architecture
  const agentsPath = path.join(projectRoot, 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    contextParts.push('## Agent System Architecture (AGENTS.md)');
    contextParts.push('');
    const agentsDoc = fs.readFileSync(agentsPath, 'utf8');
    // Include full AGENTS.md (critical for understanding agent capabilities)
    contextParts.push(agentsDoc);
    contextParts.push('');
  }

  // Section 4: Current System State (if system is running)
  if (system && system.isReady()) {
    contextParts.push('## Current System State');
    contextParts.push('');
    
    const agentRegistry = system.getAgentRegistry();
    const agentStatus = agentRegistry.getStatus();
    contextParts.push(`**Agents**: ${agentStatus.active}/${agentStatus.total} active`);
    
    const agents = agentRegistry.getAllAgents();
    if (agents.length > 0) {
      contextParts.push('');
      contextParts.push('**Active Agent Types**:');
      const agentTypes = new Map<string, number>();
      agents.forEach(agent => {
        const type = (agent as any).agentType || 'unknown';
        agentTypes.set(type, (agentTypes.get(type) || 0) + 1);
      });
      agentTypes.forEach((count, type) => {
        contextParts.push(`  - ${type}: ${count} instance(s)`);
      });
    }
    
    const meshStatus = system.getNeuralMesh().getStatus();
    contextParts.push('');
    contextParts.push(`**Neural Mesh**: ${meshStatus.nodes} nodes, ${meshStatus.links} links, ${meshStatus.topology} topology`);
    
    const swarmStatus = system.getSwarmCoordinator().getStatus();
    contextParts.push(`**Swarm**: ${swarmStatus.active ? `Active (${swarmStatus.algorithm})` : 'Idle'}`);
    
    const consensusStatus = system.getConsensusManager().getStatus();
    contextParts.push(`**Consensus**: ${consensusStatus.pendingProposals} pending proposals, ${consensusStatus.mechanism} mechanism`);
    contextParts.push('');
  } else {
    contextParts.push('## System State');
    contextParts.push('');
    contextParts.push('⚠️ **System not currently running** - Use `codex-synaptic background start` to launch orchestrator');
    contextParts.push('');
  }

  // Section 5: Standard Codex Context (AGENTS.md directives, .codex* artifacts)
  try {
    const builder = new CodexContextBuilder(projectRoot, { useEnhancedInstructionParser: true });
    await builder.withAgentDirectives();
    await builder.withReadmeExcerpts();
    await builder.withDirectoryInventory();
    await builder.withDatabaseMetadata();
    const result = await builder.build();
    
    contextParts.push('## Codex-Synaptic Artifacts & Directives');
    contextParts.push('');
    contextParts.push(renderCodexContextBlock(result.context));
    contextParts.push('');
  } catch {
    contextParts.push('_[Unable to load Codex artifacts - proceeding with platform docs only]_');
    contextParts.push('');
  }

  // Section 6: Available CLI Commands
  contextParts.push('## Available CLI Commands');
  contextParts.push('');
  contextParts.push('The following commands are available in the Codex-Synaptic CLI:');
  contextParts.push('');
  contextParts.push('**System Management**: `system start|stop|status|monitor`, `background start|stop|status`');
  contextParts.push('**Agents**: `agent deploy|list|status|terminate`, `agent logs <id>`');
  contextParts.push('**Neural Mesh**: `mesh create|configure|status|topology|visualize`');
  contextParts.push('**Swarm**: `swarm start|stop|status|configure`, `swarm metrics`');
  contextParts.push('**Hive-Mind**: `hive-mind spawn|analyze|plan|execute|follow-up|status|terminate`');
  contextParts.push('**Consensus**: `consensus propose|vote|list|status|history`, `consensus mode|stake|telemetry`');
  contextParts.push('**Tasks**: `task submit|status|recent|clear`');
  contextParts.push('**Routing**: `router evaluate|rules|history`');
  contextParts.push('**Tools**: `tools score|record|history`');
  contextParts.push('**Reasoning**: `reasoning plan|checkpoint|complete|resume|history`');
  contextParts.push('**Instructions**: `instructions sync|validate|cache`');
  contextParts.push('**Tenancy**: `tenant list|create|show|update|delete|quota`');
  contextParts.push('**Interactive**: `interactive` - Launch dashboard-driven command hub');
  contextParts.push('');

  // Section 7: Usage Guidance
  contextParts.push('## How to Use This Context');
  contextParts.push('');
  contextParts.push('You have access to the complete Codex-Synaptic platform. You can:');
  contextParts.push('');
  contextParts.push('1. **Deploy Agents**: Use `codex-synaptic agent deploy <type> <count>` to spawn workers');
  contextParts.push('2. **Configure Mesh**: Set up neural mesh with `codex-synaptic mesh create --nodes N --topology <type>`');
  contextParts.push('3. **Start Swarms**: Enable collective intelligence with `codex-synaptic swarm start --algorithm <pso|aco|flocking>`');
  contextParts.push('4. **Execute Hive-Mind**: Run complex workflows with `codex-synaptic hive-mind spawn "task description"`');
  contextParts.push('5. **Propose Consensus**: Gate critical decisions with `codex-synaptic consensus propose <type> "description"`');
  contextParts.push('6. **Tree-of-Thought**: Plan with `codex-synaptic reasoning plan "objective" --strategy tot`');
  contextParts.push('');
  contextParts.push('All 25+ agent types are available (see AGENTS.md above for full capabilities).');
  contextParts.push('The platform supports autonomous multi-agent workflows, self-healing networks, and Byzantine fault tolerance.');
  contextParts.push('');

  return contextParts.join('\n');
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
    'interactive': 'Launch interactive dashboard'
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
  const { command, args, system, projectRoot, dryRun, verbose } = options;

  // Build comprehensive context
  console.log(chalk.cyan('📚 Building Codex-Synaptic context for passthrough...'));
  const context = await buildCodexSynapticContext(projectRoot, system);

  if (verbose) {
    console.log(chalk.gray(`Context size: ${Buffer.byteLength(context, 'utf8')} bytes`));
    console.log(chalk.gray(`Sections: Platform docs, README.md, AGENTS.md, system state, CLI commands`));
  }

  if (dryRun) {
    console.log(chalk.yellow('\n⚙️  DRY RUN - Context that would be sent to Codex CLI:\n'));
    console.log(chalk.gray('─'.repeat(80)));
    console.log(context);
    console.log(chalk.gray('─'.repeat(80)));
    console.log('');
    console.log(chalk.cyan(`Command that would be executed: codex ${command} ${args.join(' ')}`));
    return {
      success: true,
      exitCode: 0,
      contextUsed: context
    };
  }

  // Check if codex CLI is installed
  const codexCli = findCodexCli();
  if (!codexCli) {
    console.error(chalk.red('❌ Codex CLI not found!'));
    console.error(chalk.yellow('Please install the OpenAI Codex CLI:'));
    console.error(chalk.gray('  npm install -g @openai/codex-cli'));
    console.error(chalk.gray('  # or'));
    console.error(chalk.gray('  brew install openai/tap/codex-cli'));
    return {
      success: false,
      exitCode: 1,
      stderr: 'Codex CLI not found in PATH'
    };
  }

  console.log(chalk.cyan(`🚀 Passing through to Codex CLI: ${codexCli}`));
  console.log(chalk.gray(`   Command: ${command} ${args.join(' ')}`));
  console.log('');

  // Convert command to natural language prompt
  const prompt = buildPromptFromCommand(command, args);

  console.log(chalk.cyan(`🚀 Passing through to Codex CLI: ${codexCli}`));
  console.log(chalk.gray(`   Prompt: ${prompt}\n`));

  // Build full prompt with context prepended
  const fullPrompt = `${context}\n\n---\n\n## User Request\n\n${prompt}`;

  try {
    // Execute codex CLI in exec mode with full context + prompt
    // Codex CLI takes the prompt as a positional argument
    const codexArgs = [
      'exec',
      fullPrompt
    ];

    return await new Promise<CodexPassthroughResult>((resolve) => {
      const proc = spawn(codexCli, codexArgs, {
        stdio: 'inherit',
        cwd: projectRoot,
        env: {
          ...process.env,
          CODEX_SYNAPTIC_CONTEXT: '1'
        }
      });

      proc.on('exit', (code) => {
        resolve({
          success: code === 0,
          exitCode: code || 0
        });
      });

      proc.on('error', (error) => {
        console.error(chalk.red(`Error executing Codex CLI: ${error.message}`));
        resolve({
          success: false,
          exitCode: 1,
          stderr: error.message
        });
      });
    });
  } catch (error) {
    throw error;
  }
}

/**
 * Find Codex CLI executable in PATH
 */
function findCodexCli(): string | null {
  const possibleNames = ['codex', 'openai-codex', 'codex-cli'];
  const pathDirs = (process.env.PATH || '').split(path.delimiter);

  for (const name of possibleNames) {
    for (const dir of pathDirs) {
      const fullPath = path.join(dir, name);
      if (fs.existsSync(fullPath)) {
        try {
          fs.accessSync(fullPath, fs.constants.X_OK);
          return fullPath;
        } catch {}
      }
    }
  }

  return null;
}

/**
 * Check if Codex CLI is available
 */
export function isCodexCliAvailable(): boolean {
  return findCodexCli() !== null;
}

/**
 * Get Codex CLI version
 */
export async function getCodexCliVersion(): Promise<string | null> {
  const cli = findCodexCli();
  if (!cli) return null;

  return new Promise((resolve) => {
    const proc = spawn(cli, ['--version'], {
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
