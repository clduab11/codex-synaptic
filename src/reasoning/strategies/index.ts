import { promises as fs } from 'node:fs';
import { resolve, join } from 'node:path';
import { load } from 'js-yaml';
import { CodexSynapticSystem } from '../../core/system.js';
import { Logger } from '../../core/logger.js';
import { goapRegistry } from '../goap/registry.js';
import { AgentStatus } from '../../core/types.js';
import {
  extractComponentStatuses,
  loadGoapManifests,
  extractAgentCounts,
  evaluateSystemHealth,
  evaluateMeshStability,
  evaluateConsensusReadiness,
  evaluateSwarmReadiness,
  evaluateAutoscalerBalance,
  buildHealthFacts,
  collectWarnings
} from './activation-helpers.js';

const STRATEGY_ROOT = resolve(process.cwd(), 'config', 'strategies');

export type SupportedStrategy =
  | 'behavior-tree'
  | 'fsm'
  | 'strips'
  | 'shop'
  | 'mdp'
  | 'q-learning';

export interface StrategyExecutionContext {
  system: CodexSynapticSystem;
  strategy: SupportedStrategy;
  prompt: string;
  manifestId?: string;
  agentTarget: number;
  consensusMechanism: string;
  timeoutMs: number;
  debug?: boolean;
}

export interface StrategyManifestSummary {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  sourcePath?: string;
}

export interface StrategyDiagnostic {
  level: 'info' | 'warn' | 'error';
  message: string;
  context?: Record<string, unknown>;
}

export interface StrategyStageResult {
  stage: string;
  taskId: string;
  status: 'passed' | 'warning' | 'failed';
  result: {
    summary: string;
    detail?: string;
    metrics?: Record<string, unknown>;
    observations?: string[];
  };
  success: boolean;
}

export interface StrategyExecutionResult {
  summary: string;
  stages: StrategyStageResult[];
  artifacts: Record<string, unknown>;
  diagnostics: StrategyDiagnostic[];
  manifest: StrategyManifestSummary;
  warnings?: string[];
}

interface BehaviorTreeNode {
  type: 'sequence' | 'selector' | 'task' | 'parallel';
  children?: string[];
  evaluation?: string;
  threshold?: number;
}

interface BehaviorTreeManifest {
  metadata: StrategyManifestSummary;
  tree: {
    root: string;
    nodes: Record<string, BehaviorTreeNode>;
  };
}

interface FsmStateDefinition {
  onEnter?: string[];
  transitions?: Array<{
    to: string;
    condition?: string;
    action?: string;
  }>;
}

interface FsmManifest {
  metadata: StrategyManifestSummary;
  fsm: {
    initial: string;
    terminal: string[];
    maxSteps?: number;
    states: Record<string, FsmStateDefinition>;
  };
}

interface StripsOperator {
  name: string;
  preconditions?: Record<string, boolean>;
  effects: Record<string, boolean>;
  summary?: string;
  cost?: number;
}

interface StripsManifest {
  metadata: StrategyManifestSummary;
  strips: {
    goal: Record<string, boolean>;
    initial?: Record<string, boolean>;
    operators: StripsOperator[];
    maxDepth?: number;
  };
}

interface ShopManifest {
  metadata: StrategyManifestSummary;
  shop: {
    tasks: string[];
    methods: Record<
      string,
      {
        subtasks: string[];
        guard?: string;
      }
    >;
    operators: Record<
      string,
      {
        preconditions?: Record<string, boolean>;
        effects?: Record<string, boolean>;
        summary?: string;
      }
    >;
    maxDepth?: number;
  };
}

interface MdpStateTransition {
  to: string;
  probability: number;
  reward?: number;
}

interface MdpActionDefinition {
  state: string;
  name: string;
  transitions: MdpStateTransition[];
}

interface MdpManifest {
  metadata: StrategyManifestSummary;
  mdp: {
    discount?: number;
    iterations?: number;
    states: Array<{ id: string; reward?: number }>;
    actions: MdpActionDefinition[];
  };
}

interface QLearningOutcome {
  next: string;
  reward?: number;
  probability?: number;
}

interface QLearningTransition {
  state: string;
  action: string;
  outcomes: QLearningOutcome[];
}

interface QLearningManifest {
  metadata: StrategyManifestSummary;
  qLearning: {
    episodes?: number;
    alpha?: number;
    gamma?: number;
    epsilon?: number;
    states: string[];
    transitions: QLearningTransition[];
  };
}

interface ActivationSnapshot {
  status: any;
  registryStatus: any;
  schedulerStatus: any;
  meshStatus: any;
  swarmStatus: any;
  consensusStatus: any;
  resourceUsage?: any;
  goapManifests: Array<{ id: string; name?: string; version?: string }>;
  goapWarnings: string[];
  facts: Record<string, boolean>;
  warnings: string[];
}

const SUPPORTED_STRATEGIES: SupportedStrategy[] = [
  'behavior-tree',
  'fsm',
  'strips',
  'shop',
  'mdp',
  'q-learning'
];

const logger = Logger.getInstance('strategy');

export function getSupportedStrategies(): SupportedStrategy[] {
  return [...SUPPORTED_STRATEGIES];
}

export async function executeStrategy(
  context: StrategyExecutionContext
): Promise<StrategyExecutionResult> {
  const manifestWrapper = await loadStrategyManifest(context.strategy, context.manifestId);
  const snapshot = await buildActivationSnapshot(context, manifestWrapper.metadata.sourcePath);

  const evaluationCache = new Map<string, StrategyStageResult>();
  const evaluate = (id: string): StrategyStageResult => {
    if (evaluationCache.has(id)) {
      return evaluationCache.get(id)!;
    }
    const evaluator = STRATEGY_EVALUATORS[id];
    if (!evaluator) {
      throw new Error(`Strategy evaluation "${id}" is not defined.`);
    }
    const result = evaluator(snapshot, context);
    evaluationCache.set(id, result);
    snapshot.facts[id] = result.success;
    return result;
  };

  switch (context.strategy) {
    case 'behavior-tree':
      return executeBehaviorTreeStrategy(
        manifestWrapper.definition as BehaviorTreeManifest,
        snapshot,
        evaluate,
        context
      );
    case 'fsm':
      return executeFsmStrategy(
        manifestWrapper.definition as FsmManifest,
        snapshot,
        evaluate,
        context
      );
    case 'strips':
      return executeStripsStrategy(
        manifestWrapper.definition as StripsManifest,
        snapshot,
        evaluate,
        context
      );
    case 'shop':
      return executeShopStrategy(
        manifestWrapper.definition as ShopManifest,
        snapshot,
        evaluate,
        context
      );
    case 'mdp':
      return executeMdpStrategy(
        manifestWrapper.definition as MdpManifest,
        snapshot,
        evaluate,
        context
      );
    case 'q-learning':
      return executeQLearningStrategy(
        manifestWrapper.definition as QLearningManifest,
        snapshot,
        evaluate,
        context
      );
    default:
      throw new Error(`Unsupported strategy "${context.strategy}".`);
  }
}

async function loadStrategyManifest(
  strategy: SupportedStrategy,
  manifestId?: string
): Promise<{ metadata: StrategyManifestSummary; definition: any }> {
  const dir = resolve(STRATEGY_ROOT, strategy);
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((file) =>
      file.endsWith('.yml') || file.endsWith('.yaml')
    );
  } catch (error) {
    throw new Error(
      `Strategy directory "${dir}" is missing. Create manifests for the ${strategy} strategy.`
    );
  }

  if (!files.length) {
    throw new Error(
      `No manifests found for strategy "${strategy}". Add a YAML manifest under ${dir}.`
    );
  }

  const normalizedId = manifestId?.toLowerCase();
  for (const file of files) {
    const path = join(dir, file);
    try {
      const raw = await fs.readFile(path, 'utf8');
      const parsed = load(raw) as any;
      const metadata = normalizeMetadata(parsed?.metadata, path);
      if (
        !normalizedId ||
        metadata.id.toLowerCase() === normalizedId ||
        file.replace(/\.(yml|yaml)$/i, '').toLowerCase() === normalizedId
      ) {
        return {
          metadata,
          definition: {
            ...parsed,
            metadata
          }
        };
      }
    } catch (error) {
      logger.warn('strategy', 'Failed to load strategy manifest', { path, reason: (error as Error).message });
    }
  }

  throw new Error(
    `Strategy manifest "${manifestId}" not found for strategy "${strategy}". Ensure the manifest id or filename matches.`
  );
}

function normalizeMetadata(
  metadata: Partial<StrategyManifestSummary> | undefined,
  sourcePath: string
): StrategyManifestSummary {
  const normalized: StrategyManifestSummary = {
    id: metadata?.id ?? sourcePath.split(/[\\/]/).pop()?.replace(/\.(yml|yaml)$/i, '') ?? 'default',
    name: metadata?.name,
    description: metadata?.description,
    version: metadata?.version,
    sourcePath
  };
  return normalized;
}

async function buildActivationSnapshot(
  context: StrategyExecutionContext,
  manifestPath?: string
): Promise<ActivationSnapshot> {
  const status = context.system.getStatus();
  
  // Extract component statuses
  const {
    registryStatus,
    schedulerStatus,
    meshStatus,
    swarmStatus,
    consensusStatus,
    resourceUsage
  } = extractComponentStatuses(status);

  // Load GOAP manifests
  const { manifests: goapManifests, warnings: goapWarnings } = await loadGoapManifests();

  // Extract agent counts
  const { errorAgents, availableAgents } = extractAgentCounts(registryStatus);

  // Evaluate health checks
  const systemHealthy = evaluateSystemHealth(registryStatus, schedulerStatus, errorAgents);
  const meshStable = evaluateMeshStability(meshStatus, context.agentTarget);
  const consensusReady = evaluateConsensusReadiness(consensusStatus, context.consensusMechanism);
  const swarmReady = evaluateSwarmReadiness(swarmStatus, availableAgents);
  const goapPrepared = goapManifests.length > 0;
  const autoscalerBalanced = evaluateAutoscalerBalance(resourceUsage, context.agentTarget);

  // Build facts and warnings
  const facts = buildHealthFacts(
    systemHealthy,
    meshStable,
    consensusReady,
    swarmReady,
    goapPrepared,
    autoscalerBalanced
  );

  const warnings = collectWarnings(
    systemHealthy,
    meshStable,
    consensusReady,
    swarmReady,
    goapPrepared,
    autoscalerBalanced,
    context.consensusMechanism,
    String(consensusStatus.mechanism ?? 'unknown'),
    goapWarnings,
    manifestPath
  );

  return {
    status,
    registryStatus,
    schedulerStatus,
    meshStatus,
    swarmStatus,
    consensusStatus,
    resourceUsage,
    goapManifests,
    goapWarnings,
    facts,
    warnings
  };
}

const STRATEGY_EVALUATORS: Record<
  string,
  (snapshot: ActivationSnapshot, context: StrategyExecutionContext) => StrategyStageResult
> = {
  systemHealth: evaluateSystemHealth,
  meshHealth: evaluateMeshHealth,
  consensusHealth: evaluateConsensusHealth,
  swarmReadiness: evaluateSwarmReadiness,
  goapCoverage: evaluateGoapCoverage,
  autoscalerBalance: evaluateAutoscalerBalance
};

function evaluateSystemHealth(
  snapshot: ActivationSnapshot,
  _context: StrategyExecutionContext
): StrategyStageResult {
  const registry = snapshot.registryStatus ?? {};
  const scheduler = snapshot.schedulerStatus ?? {};
  const errorAgents =
    registry.statusCounts?.[AgentStatus.ERROR] ?? registry.statusCounts?.error ?? 0;
  const offlineAgents =
    registry.statusCounts?.[AgentStatus.OFFLINE] ?? registry.statusCounts?.offline ?? 0;
  const idleAgents = registry.statusCounts?.[AgentStatus.IDLE] ?? registry.statusCounts?.idle ?? 0;
  const summary = snapshot.facts.systemHealth
    ? 'Agent registry and task scheduler are healthy.'
    : 'Detected anomalies in agent registry or task scheduler.';
  const observations: string[] = [];
  if (errorAgents > 0) {
    observations.push(`${errorAgents} agent(s) reporting errors`);
  }
  if (offlineAgents > 0) {
    observations.push(`${offlineAgents} agent(s) offline`);
  }
  if (!scheduler.isRunning) {
    observations.push('Task scheduler is not running');
  }
  const result = createStageResult(
    'System Health',
    'activation/system-health',
    snapshot.facts.systemHealth,
    summary,
    {
      detail: `errors=${errorAgents}, offline=${offlineAgents}, schedulerRunning=${Boolean(
        scheduler.isRunning
      )}`,
      metrics: {
        totalAgents: registry.totalAgents ?? 0,
        availableAgents: registry.availableAgents ?? 0,
        idleAgents,
        pendingTasks: scheduler.pendingTasks ?? 0,
        runningTasks: scheduler.runningTasks ?? 0
      },
      observations
    }
  );
  return result;
}

function evaluateMeshHealth(
  snapshot: ActivationSnapshot,
  context: StrategyExecutionContext
): StrategyStageResult {
  const mesh = snapshot.meshStatus ?? {};
  const nodeCount = mesh.nodeCount ?? 0;
  const avgConnections = mesh.averageConnections ?? 0;
  const summary = snapshot.facts.meshHealth
    ? 'Neural mesh topology meets resilience thresholds.'
    : 'Neural mesh topology below desired thresholds.';
  const observations: string[] = [];
  if (!mesh.isRunning) {
    observations.push('Neural mesh runtime is idle');
  }
  if (avgConnections < 2) {
    observations.push('Average mesh connectivity below 2.0');
  }
  if (nodeCount < Math.max(3, Math.floor(context.agentTarget * 0.6))) {
    observations.push('Mesh node count below recommended capacity');
  }
  return createStageResult('Mesh Health', 'activation/mesh-health', snapshot.facts.meshHealth, summary, {
    detail: `nodes=${nodeCount}, avgConnections=${avgConnections.toFixed?.(2) ?? avgConnections}`,
    metrics: {
      nodeCount,
      connectionCount: mesh.connectionCount ?? 0,
      averageConnections: avgConnections,
      supportedTopologies: mesh.supportedTopologies ?? []
    },
    observations
  });
}

function evaluateConsensusHealth(
  snapshot: ActivationSnapshot,
  context: StrategyExecutionContext
): StrategyStageResult {
  const consensus = snapshot.consensusStatus ?? {};
  const mechanism = String(consensus.mechanism ?? 'unknown').toUpperCase();
  const summary = snapshot.facts.consensusHealth
    ? `Consensus manager aligned with ${context.consensusMechanism.toUpperCase()} expectations.`
    : `Consensus manager running ${mechanism}, expected ${context.consensusMechanism.toUpperCase()}.`;
  const observations: string[] = [];
  if ((consensus.activeProposals ?? 0) > 0) {
    observations.push(`${consensus.activeProposals} proposal(s) pending.`);
  }
  if (!snapshot.facts.consensusHealth) {
    observations.push('Consensus configuration drift detected.');
  }
  return createStageResult(
    'Consensus Readiness',
    'activation/consensus-health',
    snapshot.facts.consensusHealth,
    summary,
    {
      detail: `mechanism=${mechanism}, activeProposals=${consensus.activeProposals ?? 0}`,
      metrics: {
        mechanism,
        activeProposals: consensus.activeProposals ?? 0,
        totalVotes: consensus.totalVotes ?? 0
      },
      observations
    }
  );
}

function evaluateSwarmReadiness(
  snapshot: ActivationSnapshot,
  _context: StrategyExecutionContext
): StrategyStageResult {
  const swarm = snapshot.swarmStatus ?? {};
  const summary = snapshot.facts.swarmReadiness
    ? 'Swarm coordinator is actively optimizing.'
    : 'Swarm coordinator idle or particle set incomplete.';
  const observations: string[] = [];
  if (!swarm.isRunning && !swarm.isOptimizing) {
    observations.push('Swarm optimization loop not running.');
  }
  if ((swarm.particleCount ?? 0) < 1) {
    observations.push('No swarm particles registered.');
  }
  return createStageResult(
    'Swarm Readiness',
    'activation/swarm-readiness',
    snapshot.facts.swarmReadiness,
    summary,
    {
      detail: `particles=${swarm.particleCount ?? 0}, algorithm=${swarm.algorithm ?? 'unknown'}`,
      metrics: {
        particleCount: swarm.particleCount ?? 0,
        algorithm: swarm.algorithm ?? 'unknown',
        isOptimizing: Boolean(swarm.isOptimizing),
        maxRunDurationMs: swarm.maxRunDurationMs ?? null
      },
      observations
    }
  );
}

function evaluateGoapCoverage(
  snapshot: ActivationSnapshot,
  _context: StrategyExecutionContext
): StrategyStageResult {
  const summary = snapshot.facts.goapCoverage
    ? `GOAP registry online with ${snapshot.goapManifests.length} manifest(s).`
    : 'GOAP registry empty—behavioral coverage unavailable.';
  const observations = [...snapshot.goapWarnings];
  return createStageResult('GOAP Coverage', 'activation/goap-coverage', snapshot.facts.goapCoverage, summary, {
    detail: `${snapshot.goapManifests.length} manifest(s) detected.`,
    metrics: {
      manifestCount: snapshot.goapManifests.length,
      manifests: snapshot.goapManifests
    },
    observations
  });
}

function evaluateAutoscalerBalance(
  snapshot: ActivationSnapshot,
  _context: StrategyExecutionContext
): StrategyStageResult {
  const usage = snapshot.resourceUsage ?? {};
  const summary = snapshot.facts.autoscalerBalance
    ? 'Autoscaler metrics within target envelope.'
    : 'Autoscaler observing utilization outside recommended range.';
  const observations: string[] = [];
  if (!snapshot.facts.autoscalerBalance) {
    observations.push(
      `cpu=${usage.cpuPercent ?? 'n/a'}%, headroomMB=${usage.memoryStatus?.headroomMB ?? 'n/a'}`
    );
  }
  return createStageResult(
    'Autoscaler Balance',
    'activation/autoscaler-balance',
    snapshot.facts.autoscalerBalance,
    summary,
    {
      detail: `cpu=${usage.cpuPercent ?? 0}%, memoryMB=${usage.memoryMB ?? 0}, headroomMB=${
        usage.memoryStatus?.headroomMB ?? 0
      }`,
      metrics: {
        cpuPercent: usage.cpuPercent ?? 0,
        memoryMB: usage.memoryMB ?? 0,
        requestsPerMinute: usage.requestsPerMinute ?? 0,
        activeAgents: usage.activeAgents ?? 0
      },
      observations
    }
  );
}

function executeBehaviorTreeStrategy(
  manifest: BehaviorTreeManifest,
  snapshot: ActivationSnapshot,
  evaluate: (evaluationId: string) => StrategyStageResult,
  context: StrategyExecutionContext
): StrategyExecutionResult {
  if (!manifest?.tree?.root || !manifest.tree.nodes) {
    throw new Error('Behavior tree manifest missing root or nodes definition.');
  }

  const nodes = manifest.tree.nodes;
  const visitedStages: StrategyStageResult[] = [];
  const stageIndex = new Set<string>();
  const pathTrace: string[] = [];

  const recordStage = (stage: StrategyStageResult) => {
    if (!stageIndex.has(stage.taskId)) {
      stageIndex.add(stage.taskId);
      visitedStages.push(stage);
    }
  };

  const evaluateNode = (nodeId: string): boolean => {
    const node = nodes[nodeId];
    if (!node) {
      throw new Error(`Behavior tree node "${nodeId}" not defined.`);
    }
    pathTrace.push(nodeId);
    switch (node.type) {
      case 'sequence': {
        const children = node.children ?? [];
        for (const child of children) {
          if (!evaluateNode(child)) {
            return false;
          }
        }
        return true;
      }
      case 'selector': {
        const children = node.children ?? [];
        for (const child of children) {
          if (evaluateNode(child)) {
            return true;
          }
        }
        return false;
      }
      case 'parallel': {
        const children = node.children ?? [];
        const threshold = node.threshold ?? children.length;
        let successes = 0;
        for (const child of children) {
          if (evaluateNode(child)) {
            successes += 1;
          }
        }
        return successes >= threshold;
      }
      case 'task': {
        if (!node.evaluation) {
          throw new Error(`Behavior tree task node "${nodeId}" missing evaluation reference.`);
        }
        const stage = evaluate(node.evaluation);
        recordStage(stage);
        return stage.success;
      }
      default:
        throw new Error(`Unsupported behavior tree node type "${node.type}".`);
    }
  };

  const success = evaluateNode(manifest.tree.root);

  const failedStages = visitedStages.filter((stage) => !stage.success);
  const summary = success
    ? `Behavior tree activation audit passed (${visitedStages.length} checks).`
    : `Behavior tree detected ${failedStages.length} failing check(s).`;

  const diagnostics: StrategyDiagnostic[] = failedStages.map((stage) => ({
    level: stage.status === 'failed' ? 'error' : 'warn',
    message: `${stage.stage} :: ${stage.result.summary}`,
    context: {
      taskId: stage.taskId,
      detail: stage.result.detail
    }
  }));

  return {
    summary,
    stages: visitedStages,
    artifacts: {
      strategyReport: {
        type: context.strategy,
        manifest: manifest.metadata,
        pathTrace,
        facts: snapshot.facts
      }
    },
    diagnostics,
    manifest: manifest.metadata,
    warnings: snapshot.warnings
  };
}

function executeFsmStrategy(
  manifest: FsmManifest,
  snapshot: ActivationSnapshot,
  evaluate: (evaluationId: string) => StrategyStageResult,
  context: StrategyExecutionContext
): StrategyExecutionResult {
  const fsm = manifest.fsm;
  if (!fsm?.initial || !fsm.states) {
    throw new Error('FSM manifest missing initial state or states definition.');
  }

  const states = fsm.states;
  let currentState = fsm.initial;
  let steps = 0;
  const maxSteps = fsm.maxSteps ?? 16;
  const visitedStages: StrategyStageResult[] = [];
  const diagnostics: StrategyDiagnostic[] = [];
  const path: string[] = [];

  const recordStage = (stage: StrategyStageResult) => {
    visitedStages.push(stage);
  };

  while (steps < maxSteps) {
    const stateDef = states[currentState];
    if (!stateDef) {
      diagnostics.push({
        level: 'error',
        message: `FSM state "${currentState}" not defined.`,
        context: { step: steps }
      });
      break;
    }
    path.push(currentState);

    for (const evaluationId of stateDef.onEnter ?? []) {
      const stage = evaluate(evaluationId);
      recordStage(stage);
    }

    if (fsm.terminal?.includes(currentState)) {
      break;
    }

    const transitions = stateDef.transitions ?? [];
    let transitioned = false;
    for (const transition of transitions) {
      const condition = transition.condition ?? 'true';
      if (evaluateCondition(condition, snapshot.facts)) {
        const stage = createStageResult(
          'FSM Transition',
          `fsm/${currentState}->${transition.to}`,
          true,
          `Transitioned from ${currentState} to ${transition.to}.`,
          {
            observations: transition.action ? [`action: ${transition.action}`] : undefined
          }
        );
        recordStage(stage);
        currentState = transition.to;
        transitioned = true;
        break;
      }
    }

    if (!transitioned) {
      diagnostics.push({
        level: 'warn',
        message: `No transition satisfied from state "${currentState}".`,
        context: { step: steps, facts: snapshot.facts }
      });
      break;
    }

    steps += 1;
  }

  const success = fsm.terminal?.includes(currentState) ?? false;
  const summary = success
    ? `FSM reached terminal state "${currentState}" in ${steps + 1} step(s).`
    : `FSM halted in state "${currentState}" without satisfying terminal conditions.`;

  if (!success) {
    diagnostics.push({
      level: 'error',
      message: 'FSM did not reach a terminal state.',
      context: { path }
    });
  }

  return {
    summary,
    stages: visitedStages,
    artifacts: {
      strategyReport: {
        type: context.strategy,
        manifest: manifest.metadata,
        path,
        facts: snapshot.facts
      }
    },
    diagnostics,
    manifest: manifest.metadata,
    warnings: snapshot.warnings
  };
}

function executeStripsStrategy(
  manifest: StripsManifest,
  snapshot: ActivationSnapshot,
  evaluate: (evaluationId: string) => StrategyStageResult,
  context: StrategyExecutionContext
): StrategyExecutionResult {
  const strips = manifest.strips;
  if (!strips?.goal || !Array.isArray(strips.operators)) {
    throw new Error('STRIPS manifest missing goal or operators definition.');
  }

  const initialState = {
    ...strips.initial,
    ...snapshot.facts
  };

  const goalState = strips.goal;
  const operators = strips.operators;
  const maxDepth = strips.maxDepth ?? Math.max(operators.length * 2, 6);

  const stageResults: StrategyStageResult[] = [];
  for (const evaluationId of Object.keys(snapshot.facts)) {
    const stage = evaluate(evaluationId);
    stageResults.push(stage);
  }

  const visitedStates = new Set<string>();
  const serializeState = (state: Record<string, boolean>) =>
    Object.keys({ ...state, ...goalState })
      .sort()
      .map((key) => `${key}:${state[key] ? '1' : '0'}`)
      .join('|');

  const queue: Array<{ state: Record<string, boolean>; plan: StripsOperator[] }> = [
    { state: initialState, plan: [] }
  ];
  let solution: StripsOperator[] | undefined;

  while (queue.length) {
    const current = queue.shift()!;
    const signature = serializeState(current.state);
    if (visitedStates.has(signature) || current.plan.length > maxDepth) {
      continue;
    }
    visitedStates.add(signature);

    if (isGoalSatisfied(current.state, goalState)) {
      solution = current.plan;
      break;
    }

    for (const operator of operators) {
      if (arePreconditionsSatisfied(current.state, operator.preconditions ?? {})) {
        const nextState = applyOperatorEffects(current.state, operator.effects ?? {});
        queue.push({
          state: nextState,
          plan: [...current.plan, operator]
        });
      }
    }
  }

  const diagnostics: StrategyDiagnostic[] = [];
  let summary: string;
  if (solution) {
    summary = `STRIPS plan derived with ${solution.length} step(s) to satisfy goals.`;
  } else {
    summary = 'Unable to derive STRIPS plan within depth constraints.';
    diagnostics.push({
      level: 'error',
      message: 'STRIPS planner exhausted search without reaching goal state.',
      context: { exploredStates: visitedStates.size }
    });
  }

  const planObservations = solution
    ? solution.map((op, index) => `${index + 1}. ${op.name}`)
    : ['Plan unavailable'];

  stageResults.push(
    createStageResult(
      'STRIPS Plan',
      'activation/strips-plan',
      Boolean(solution),
      summary,
      {
        observations: planObservations,
        metrics: {
          depthSearched: visitedStates.size,
          planLength: solution?.length ?? 0
        }
      }
    )
  );

  return {
    summary,
    stages: stageResults,
    artifacts: {
      strategyReport: {
        type: context.strategy,
        manifest: manifest.metadata,
        plan: solution?.map((op) => ({
          name: op.name,
          summary: op.summary,
          effects: op.effects
        })),
        facts: snapshot.facts
      }
    },
    diagnostics,
    manifest: manifest.metadata,
    warnings: snapshot.warnings
  };
}

function executeShopStrategy(
  manifest: ShopManifest,
  snapshot: ActivationSnapshot,
  evaluate: (evaluationId: string) => StrategyStageResult,
  context: StrategyExecutionContext
): StrategyExecutionResult {
  const shop = manifest.shop;
  if (!shop?.tasks?.length) {
    throw new Error('SHOP manifest missing root tasks.');
  }

  const stages: StrategyStageResult[] = [];
  for (const evaluationId of Object.keys(snapshot.facts)) {
    stages.push(evaluate(evaluationId));
  }

  const plan: string[] = [];
  const diagnostics: StrategyDiagnostic[] = [];
  const maxDepth = shop.maxDepth ?? 16;

  const applyTask = (
    task: string,
    state: Record<string, boolean>,
    depth: number
  ): { state: Record<string, boolean>; success: boolean } => {
    if (depth > maxDepth) {
      diagnostics.push({
        level: 'error',
        message: `SHOP plan exceeded depth limit while expanding "${task}".`,
        context: { depth }
      });
      return { state, success: false };
    }

    const method = shop.methods?.[task];
    if (method) {
      if (method.guard && !evaluateCondition(method.guard, snapshot.facts)) {
        return { state, success: false };
      }
      let currentState = state;
      for (const subTask of method.subtasks) {
        const result = applyTask(subTask, currentState, depth + 1);
        if (!result.success) {
          return { state, success: false };
        }
        currentState = result.state;
      }
      return { state: currentState, success: true };
    }

    const operator = shop.operators?.[task];
    if (!operator) {
      diagnostics.push({
        level: 'warn',
        message: `SHOP operator "${task}" not found.`,
        context: { task }
      });
      return { state, success: false };
    }

    if (!arePreconditionsSatisfied(state, operator.preconditions ?? {})) {
      diagnostics.push({
        level: 'warn',
        message: `Preconditions not met for operator "${task}".`,
        context: { task }
      });
      return { state, success: false };
    }

    const nextState = applyOperatorEffects(state, operator.effects ?? {});
    plan.push(task);
    return { state: nextState, success: true };
  };

  let currentState: Record<string, boolean> = { ...snapshot.facts };
  let overallSuccess = true;

  for (const task of shop.tasks) {
    const result = applyTask(task, currentState, 0);
    currentState = result.state;
    overallSuccess = overallSuccess && result.success;
  }

  const summary = overallSuccess
    ? `SHOP planner produced ${plan.length} operational step(s).`
    : 'SHOP planner unable to satisfy all tasks.';

  stages.push(
    createStageResult('SHOP Plan', 'activation/shop-plan', overallSuccess, summary, {
      observations: plan.length ? plan.map((step, index) => `${index + 1}. ${step}`) : ['Plan unavailable']
    })
  );

  return {
    summary,
    stages,
    artifacts: {
      strategyReport: {
        type: context.strategy,
        manifest: manifest.metadata,
        plan,
        facts: snapshot.facts
      }
    },
    diagnostics,
    manifest: manifest.metadata,
    warnings: snapshot.warnings
  };
}

function executeMdpStrategy(
  manifest: MdpManifest,
  snapshot: ActivationSnapshot,
  _evaluate: (evaluationId: string) => StrategyStageResult,
  context: StrategyExecutionContext
): StrategyExecutionResult {
  const mdp = manifest.mdp;
  if (!mdp?.states?.length || !mdp.actions?.length) {
    throw new Error('MDP manifest missing states or actions.');
  }

  const discount = mdp.discount ?? 0.9;
  const iterations = mdp.iterations ?? 25;
  const stateRewards = new Map<string, number>(
    mdp.states.map((state) => [state.id, state.reward ?? 0])
  );
  const actionsByState = new Map<string, MdpActionDefinition[]>();

  for (const action of mdp.actions) {
    const list = actionsByState.get(action.state) ?? [];
    list.push(action);
    actionsByState.set(action.state, list);
  }

  const values = new Map<string, number>();
  for (const state of mdp.states) {
    values.set(state.id, 0);
  }

  for (let i = 0; i < iterations; i++) {
    const nextValues = new Map<string, number>();
    for (const state of mdp.states) {
      const actions = actionsByState.get(state.id) ?? [];
      if (!actions.length) {
        nextValues.set(state.id, stateRewards.get(state.id) ?? 0);
        continue;
      }
      let bestValue = -Infinity;
      for (const action of actions) {
        let actionValue = 0;
        for (const transition of action.transitions) {
          const probability = transition.probability ?? 0;
          const reward = transition.reward ?? 0;
          const futureValue = values.get(transition.to) ?? 0;
          actionValue += probability * (reward + discount * futureValue);
        }
        if (actionValue > bestValue) {
          bestValue = actionValue;
        }
      }
      nextValues.set(state.id, (stateRewards.get(state.id) ?? 0) + bestValue);
    }
    for (const [key, value] of nextValues.entries()) {
      values.set(key, value);
    }
  }

  const policy: Record<string, string> = {};
  for (const state of mdp.states) {
    const actions = actionsByState.get(state.id) ?? [];
    if (!actions.length) {
      continue;
    }
    let bestAction = actions[0];
    let bestValue = -Infinity;
    for (const action of actions) {
      let actionValue = 0;
      for (const transition of action.transitions) {
        const probability = transition.probability ?? 0;
        const reward = transition.reward ?? 0;
        const futureValue = values.get(transition.to) ?? 0;
        actionValue += probability * (reward + discount * futureValue);
      }
      if (actionValue > bestValue) {
        bestValue = actionValue;
        bestAction = action;
      }
    }
    policy[state.id] = bestAction.name;
  }

  const stages: StrategyStageResult[] = [
    createStageResult('MDP Policy', 'activation/mdp-policy', true, 'Computed policy via value iteration.', {
      metrics: {
        values: Object.fromEntries(values.entries()),
        policy
      }
    })
  ];

  return {
    summary: 'Markov Decision Process policy computed successfully.',
    stages,
    artifacts: {
      strategyReport: {
        type: context.strategy,
        manifest: manifest.metadata,
        values: Object.fromEntries(values.entries()),
        policy,
        facts: snapshot.facts
      }
    },
    diagnostics: [],
    manifest: manifest.metadata,
    warnings: snapshot.warnings
  };
}

function executeQLearningStrategy(
  manifest: QLearningManifest,
  snapshot: ActivationSnapshot,
  _evaluate: (evaluationId: string) => StrategyStageResult,
  context: StrategyExecutionContext
): StrategyExecutionResult {
  const qConfig = manifest.qLearning;
  if (!qConfig?.states?.length || !qConfig.transitions?.length) {
    throw new Error('Q-learning manifest missing states or transitions definition.');
  }

  const episodes = qConfig.episodes ?? 40;
  const alpha = qConfig.alpha ?? 0.5;
  const gamma = qConfig.gamma ?? 0.85;
  const epsilon = qConfig.epsilon ?? 0.1;

  const transitionsByState = new Map<string, QLearningTransition[]>();
  for (const transition of qConfig.transitions) {
    const list = transitionsByState.get(transition.state) ?? [];
    list.push(transition);
    transitionsByState.set(transition.state, list);
  }

  const qTable = new Map<string, number>();
  const randomState = () => qConfig.states[Math.floor(Math.random() * qConfig.states.length)];

  const pickAction = (state: string) => {
    const transitions = transitionsByState.get(state) ?? [];
    if (!transitions.length) {
      return undefined;
    }
    if (Math.random() < epsilon) {
      return transitions[Math.floor(Math.random() * transitions.length)];
    }
    let bestTransition = transitions[0];
    let bestValue = -Infinity;
    for (const transition of transitions) {
      const key = `${state}::${transition.action}`;
      const value = qTable.get(key) ?? 0;
      if (value > bestValue) {
        bestValue = value;
        bestTransition = transition;
      }
    }
    return bestTransition;
  };

  for (let episode = 0; episode < episodes; episode++) {
    let state = randomState();
    for (let step = 0; step < qConfig.transitions.length; step++) {
      const action = pickAction(state);
      if (!action) {
        break;
      }
      const outcome = sampleOutcome(action.outcomes);
      const qKey = `${state}::${action.action}`;
      const currentValue = qTable.get(qKey) ?? 0;
      const nextBest = Math.max(
        0,
        ...((transitionsByState.get(outcome.next) ?? []).map((t) => qTable.get(`${outcome.next}::${t.action}`) ?? 0))
      );
      const reward = outcome.reward ?? 0;
      const updatedValue = currentValue + alpha * (reward + gamma * nextBest - currentValue);
      qTable.set(qKey, updatedValue);
      state = outcome.next;
    }
  }

  const policy: Record<string, string> = {};
  for (const state of qConfig.states) {
    const transitions = transitionsByState.get(state) ?? [];
    if (!transitions.length) {
      continue;
    }
    let bestAction = transitions[0];
    let bestValue = -Infinity;
    for (const transition of transitions) {
      const value = qTable.get(`${state}::${transition.action}`) ?? 0;
      if (value > bestValue) {
        bestValue = value;
        bestAction = transition;
      }
    }
    policy[state] = bestAction.action;
  }

  const stages: StrategyStageResult[] = [
    createStageResult('Q-Learning Policy', 'activation/q-learning-policy', true, 'Derived policy via Q-learning.', {
      metrics: {
        policy,
        learnedValues: Object.fromEntries(qTable.entries())
      }
    })
  ];

  return {
    summary: 'Q-learning episodes completed successfully.',
    stages,
    artifacts: {
      strategyReport: {
        type: context.strategy,
        manifest: manifest.metadata,
        policy,
        qValues: Object.fromEntries(qTable.entries()),
        facts: snapshot.facts
      }
    },
    diagnostics: [],
    manifest: manifest.metadata,
    warnings: snapshot.warnings
  };
}

function evaluateCondition(condition: string, facts: Record<string, boolean>): boolean {
  const sanitized = condition.replace(/[a-zA-Z_][a-zA-Z0-9_-]*/g, (token) => {
    if (token === 'true' || token === 'false') {
      return token;
    }
    const value = facts[token] ?? false;
    return value ? 'true' : 'false';
  });
  try {
    // eslint-disable-next-line no-new-func
    return Boolean(new Function(`return (${sanitized});`)());
  } catch {
    return false;
  }
}

function arePreconditionsSatisfied(
  state: Record<string, boolean>,
  preconditions: Record<string, boolean>
): boolean {
  return Object.entries(preconditions).every(([key, value]) => state[key] === value);
}

function isGoalSatisfied(state: Record<string, boolean>, goal: Record<string, boolean>): boolean {
  return Object.entries(goal).every(([key, value]) => state[key] === value);
}

function applyOperatorEffects(
  state: Record<string, boolean>,
  effects: Record<string, boolean>
): Record<string, boolean> {
  const nextState = { ...state };
  for (const [key, value] of Object.entries(effects)) {
    nextState[key] = value;
  }
  return nextState;
}

function sampleOutcome(outcomes: QLearningOutcome[]): QLearningOutcome {
  if (!outcomes.length) {
    return { next: outcomes[0]?.next ?? '', reward: 0, probability: 1 };
  }
  const totalProbability = outcomes.reduce(
    (sum, outcome) => sum + (outcome.probability ?? 0),
    0
  );
  const normalized = totalProbability > 0 ? outcomes : outcomes.map((outcome) => ({ ...outcome, probability: 1 / outcomes.length }));
  const roll = Math.random();
  let accumulator = 0;
  for (const outcome of normalized) {
    accumulator += outcome.probability ?? 0;
    if (roll <= accumulator) {
      return outcome;
    }
  }
  return normalized[normalized.length - 1];
}

function createStageResult(
  stage: string,
  taskId: string,
  success: boolean,
  summary: string,
  options: {
    detail?: string;
    metrics?: Record<string, unknown>;
    observations?: string[];
    statusOverride?: 'passed' | 'warning' | 'failed';
  } = {}
): StrategyStageResult {
  return {
    stage,
    taskId,
    status: options.statusOverride ?? (success ? 'passed' : 'failed'),
    result: {
      summary,
      detail: options.detail,
      metrics: options.metrics,
      observations: options.observations
    },
    success
  };
}
