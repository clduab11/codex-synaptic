import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { Logger } from '../../core/logger.js';
import { AgentType } from '../../core/types.js';
import { CodexSynapticSystem } from '../../core/system.js';
import { FilesystemWriteTool, type FilesystemWriteParams } from '../../mcp/tools/filesystem-write.js';
import { resolveProjectsRoot } from '../../utils/projects-root.js';
import type {
  GoapAction,
  GoapExecutionOptions,
  GoapExecutionResult,
  GoapExecutionStepResult,
  GoapManifest
} from './types.js';

export class GoapExecutor {
  private readonly logger = Logger.getInstance('goap');
  private readonly filesystemTool = new FilesystemWriteTool();

  constructor(private readonly system: CodexSynapticSystem) {}

  async execute(manifest: GoapManifest, options: GoapExecutionOptions): Promise<GoapExecutionResult> {
    const goal = manifest.goals.find((entry) => entry.id === options.goalId);
    if (!goal) {
      throw new Error(`GOAP goal ${options.goalId} not found in manifest ${manifest.id}`);
    }

    const steps: GoapExecutionStepResult[] = [];
    const artifacts: string[] = [];
    const projectsRoot = resolveProjectsRoot();

    this.logger.info('goap', 'Executing GOAP workflow', {
      manifestId: manifest.id,
      goalId: goal.id,
      dryRun: Boolean(options.dryRun)
    });

    for (const action of goal.actions) {
      const actionDescription = action.description ?? action.type;
      this.logger.info('goap', `Running action: ${actionDescription}`, {
        manifestId: manifest.id,
        goalId: goal.id,
        type: action.type
      });

      try {
        if (options.dryRun) {
          steps.push({ action, status: 'skipped' });
          continue;
        }

        const output = await this.executeAction(action, options, projectsRoot);
        if (output?.artifact) {
          artifacts.push(output.artifact);
        }
        steps.push({ action, status: 'completed', output });
      } catch (error) {
        const failure: GoapExecutionStepResult = {
          action,
          status: 'failed',
          error: (error as Error).message
        };
        steps.push(failure);
        this.logger.error('goap', `GOAP action failed: ${actionDescription}`, undefined, error as Error);
        throw new Error(`GOAP action failed (${actionDescription}): ${(error as Error).message}`);
      }
    }

    const actionsCompleted = steps.filter((step) => step.status === 'completed').length;
    const actionsFailed = steps.filter((step) => step.status === 'failed').length;

    this.logger.info('goap', 'GOAP workflow completed', {
      manifestId: manifest.id,
      goalId: goal.id,
      actionsCompleted,
      actionsFailed
    });

    return {
      manifestId: manifest.id,
      goalId: goal.id,
      totalActions: goal.actions.length,
      actionsCompleted,
      actionsFailed,
      steps,
      artifacts
    };
  }

  private async executeAction(
    action: GoapAction,
    options: GoapExecutionOptions,
    projectsRoot: string
  ): Promise<any> {
    switch (action.type) {
      case 'log':
        this.emitLog(action.level ?? 'info', action.message);
        return { message: action.message };
      case 'ensure_directories':
        await this.ensureDirectories(action.paths, projectsRoot);
        return { directories: action.paths };
      case 'configure_mesh':
        await this.system.createNeuralMesh(action.topology, action.nodes);
        return { topology: action.topology, nodes: action.nodes };
      case 'deploy_agents':
        await this.deployAgents(action);
        return { agents: action.agents };
      case 'start_swarm':
        await this.system.startSwarm(action.algorithm, action.objectives ?? []);
        return { algorithm: action.algorithm, objectives: action.objectives ?? [] };
      case 'execute_tool':
        return this.executeTool(action);
      case 'task':
        return this.executeTask(action, options.prompt);
      case 'sleep':
        await new Promise((resolveSleep) => setTimeout(resolveSleep, action.durationMs));
        return { durationMs: action.durationMs };
      default:
        throw new Error(`Unsupported GOAP action type: ${(action as GoapAction).type}`);
    }
  }

  private emitLog(level: 'info' | 'warn' | 'error', message: string): void {
    const taggedMessage = chalk.blue(`[GOAP] ${message}`);
    switch (level) {
      case 'warn':
        console.warn(chalk.yellow(taggedMessage));
        break;
      case 'error':
        console.error(chalk.red(taggedMessage));
        break;
      case 'info':
      default:
        console.log(taggedMessage);
        break;
    }
  }

  private async ensureDirectories(paths: string[], projectsRoot: string): Promise<void> {
    for (const relativePath of paths) {
      const target = resolve(projectsRoot, relativePath);
      await fs.mkdir(target, { recursive: true });
    }
  }

  private async deployAgents(action: { agents: Array<{ type: AgentType | string; count: number }> }): Promise<void> {
    for (const agentRequest of action.agents) {
      const agentType = this.resolveAgentType(agentRequest.type);
      if (agentRequest.count > 0) {
        await this.system.deployAgent(agentType, agentRequest.count);
      }
    }
  }

  private resolveAgentType(input: AgentType | string): AgentType {
    if (typeof input !== 'string') {
      return input;
    }

    const normalized = input.toUpperCase();
    if ((AgentType as Record<string, AgentType>)[normalized]) {
      return (AgentType as Record<string, AgentType>)[normalized];
    }

    const byValue = Object.values(AgentType).find((value) => value === input || value === input.toLowerCase());
    if (byValue) {
      return byValue;
    }

    throw new Error(`Unknown agent type: ${input}`);
  }

  private async executeTool(action: { tool: string; params: Record<string, any> }): Promise<any> {
    if (action.tool !== 'filesystem_write_asset') {
      throw new Error(`Unsupported tool invocation: ${action.tool}`);
    }
  const params = action.params as FilesystemWriteParams;
  const result = await this.filesystemTool.execute(params);
    return { artifact: result.path, bytesWritten: result.bytesWritten };
  }

  private async executeTask(action: { prompt: string; requireConsensus?: boolean }, originalPrompt: string): Promise<any> {
    const prompt = action.prompt.replace(/{{\s*prompt\s*}}/gi, originalPrompt);
    if (action.requireConsensus) {
      this.logger.warn('goap', 'GOAP task requested consensus gating, which will be handled via system heuristics.', {
        promptSnippet: prompt.slice(0, 80)
      });
    }
    const outcome = await this.system.executeTask(prompt);
    return { outcome };
  }
}