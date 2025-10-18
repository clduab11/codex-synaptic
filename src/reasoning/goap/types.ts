import type { AgentType } from '../../core/types.js';

export interface GoapManifestMetadata {
  name: string;
  description?: string;
  version?: string;
  tags?: string[];
}

export interface GoapManifestTriggers {
  phrases?: string[];
  patterns?: string[];
}

export interface GoapManifest {
  id: string;
  version: number;
  metadata: GoapManifestMetadata;
  triggers?: GoapManifestTriggers;
  defaultGoal?: string;
  goals: GoapGoal[];
}

export interface GoapGoal {
  id: string;
  description?: string;
  actions: GoapAction[];
}

export type GoapAction =
  | GoapLogAction
  | GoapEnsureDirectoriesAction
  | GoapConfigureMeshAction
  | GoapDeployAgentsAction
  | GoapStartSwarmAction
  | GoapExecuteToolAction
  | GoapTaskAction
  | GoapSleepAction;

export interface GoapBaseAction {
  id?: string;
  description?: string;
}

export interface GoapLogAction extends GoapBaseAction {
  type: 'log';
  level?: 'info' | 'warn' | 'error';
  message: string;
}

export interface GoapEnsureDirectoriesAction extends GoapBaseAction {
  type: 'ensure_directories';
  paths: string[];
}

export interface GoapConfigureMeshAction extends GoapBaseAction {
  type: 'configure_mesh';
  topology: string;
  nodes: number;
}

export interface GoapDeployAgentsAction extends GoapBaseAction {
  type: 'deploy_agents';
  agents: Array<{ type: AgentType | string; count: number }>;
}

export interface GoapStartSwarmAction extends GoapBaseAction {
  type: 'start_swarm';
  algorithm: string;
  objectives?: string[];
}

export interface GoapExecuteToolAction extends GoapBaseAction {
  type: 'execute_tool';
  tool: string;
  params: Record<string, any>;
}

export interface GoapTaskAction extends GoapBaseAction {
  type: 'task';
  prompt: string;
  requireConsensus?: boolean;
}

export interface GoapSleepAction extends GoapBaseAction {
  type: 'sleep';
  durationMs: number;
}

export interface GoapExecutionOptions {
  goalId: string;
  prompt: string;
  dryRun?: boolean;
}

export interface GoapExecutionStepResult {
  action: GoapAction;
  status: 'completed' | 'skipped' | 'failed';
  output?: any;
  error?: string;
}

export interface GoapExecutionResult {
  manifestId: string;
  goalId: string;
  totalActions: number;
  actionsCompleted: number;
  actionsFailed: number;
  steps: GoapExecutionStepResult[];
  artifacts: string[];
}