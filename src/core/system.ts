/**
 * Main Codex-Synaptic System orchestrator
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { Logger, LogLevel } from './logger.js';
import { HealthMonitor } from './health.js';
import { AuthenticationManager, AuthMiddleware } from './auth.js';
import { GlobalErrorHandler, CircuitBreaker, SystemError, CodexSynapticError, ErrorCode } from './errors.js';
import { ResourceManager, AutoScaler, ResourceLimits } from './resources.js';
import { StorageManager } from './storage.js';
import { GPUManager, GPUStatus } from './gpu.js';
import { AgentRegistry } from '../agents/registry.js';
import { TaskScheduler } from './scheduler.js';
import { NeuralMesh } from '../mesh/neural-mesh.js';
import { SwarmCoordinator } from '../swarm/coordinator.js';
import { ConsensusManager, type ConsensusModeConfig } from '../consensus/manager.js';
import { MCPBridge } from '../bridging/mcp-bridge.js';
import { A2ABridge } from '../bridging/a2a-bridge.js';
import { ConfigurationManager, SystemConfiguration } from './config.js';
import { AgentType, AgentId, AgentStatus, Task, SwarmConfiguration } from './types.js';
import { CodeWorker } from '../agents/code_worker.js';
import { DataWorker } from '../agents/data_worker.js';
import { ValidationWorker } from '../agents/validation_worker.js';
import { ResearchWorker } from '../agents/research_worker.js';
import { ArchitectWorker } from '../agents/architect_worker.js';
import { KnowledgeWorker } from '../agents/knowledge_worker.js';
import { AnalystWorker } from '../agents/analyst_worker.js';
import { SecurityWorker } from '../agents/security_worker.js';
import { OpsWorker } from '../agents/ops_worker.js';
import { PerformanceWorker } from '../agents/performance_worker.js';
import { IntegrationWorker } from '../agents/integration_worker.js';
import { SimulationWorker } from '../agents/simulation_worker.js';
import { MemoryWorker } from '../agents/memory_worker.js';
import { PlanningWorker } from '../agents/planning_worker.js';
import { ReviewWorker } from '../agents/review_worker.js';
import { CommunicationWorker } from '../agents/communication_worker.js';
import { AutomationWorker } from '../agents/automation_worker.js';
import { ObservabilityWorker } from '../agents/observability_worker.js';
import { ComplianceWorker } from '../agents/compliance_worker.js';
import { ReliabilityWorker } from '../agents/reliability_worker.js';
import { SwarmCoordinator as SwarmCoordinatorAgent } from '../agents/swarm_coordinator.js';
import { TopologyCoordinator } from '../agents/topology_coordinator.js';
import { ConsensusCoordinator } from '../agents/consensus_coordinator.js';
import { MCPBridgeAgent } from '../agents/mcp_bridge_agent.js';
import { A2ABridgeAgent } from '../agents/a2a_bridge_agent.js';
import { Agent } from '../agents/agent.js';
import type { CodexContext, CodexPromptEnvelope, FileTreeNode } from '../types/codex-context.js';
import { CodexMemorySystem, type ReasoningRunRecord, type ToolUsageRecord } from '../memory/memory-system.js';
import type { TotPlanResult } from '../thought/tot-engine.js';
import { ToolOptimizer, type ToolCandidate, type ToolScore } from '../tools/optimizer/index.js';
import {
  LocalVectorClient,
  QdrantVectorClient,
  buildVectorRecordFromText,
  type VectorClient
} from '../vector/vector-client.js';
import { ApiServer } from './api-server.js';
import {
  ReasoningPlanner,
  type ReasoningPlanOptions,
  type ReasoningPlanCreationResult,
  type ReasoningCheckpointInput,
  type ReasoningCompletionOptions
} from '../reasoning/planner.js';
import { TenantManager } from '../tenancy/tenant-manager.js';
import { TenantResolver } from '../tenancy/tenant-resolver.js';
import {
  OpenAIResponsesClient,
  OpenAIModelRouter,
  resolveOpenAIConfiguration,
  isOpenAIIntegrationReady,
  type OpenAIResolvedConfiguration,
  type OpenAIResponseRequest,
  type OpenAIModelCatalogEntry
} from '../openai/index.js';
import { OpenAIUsageMonitor, type OpenAIUsageSummary, type OpenAIUsageEvent } from '../openai/usage-monitor.js';
import {
  analyzePromptRequirements,
  extractWorkflowArtifacts,
  buildWorkflowSummary,
  extractFinalAnswer
} from './workflow-helpers.js';

interface WorkflowStage {
  id: string;
  label: string;
  taskType: string;
  requiredCapabilities: string[];
  priority: number;
  payloadBuilder: (context: WorkflowContext) => Record<string, any>;
}

function cloneCodexContext(context: CodexContext): CodexContext {
  return {
    agentDirectives: context.agentDirectives,
    readmeExcerpts: [...context.readmeExcerpts],
    directoryInventory: {
      roots: context.directoryInventory.roots.map(cloneFileTreeNode),
      totalEntries: context.directoryInventory.totalEntries
    },
    databaseMetadata: context.databaseMetadata.map((db) => ({ ...db })),
    timestamp: new Date(context.timestamp.getTime()),
    contextHash: context.contextHash,
    sizeBytes: context.sizeBytes,
    warnings: [...context.warnings]
  };
}

function cloneCodexEnvelope(envelope: CodexPromptEnvelope): CodexPromptEnvelope {
  return {
    originalPrompt: envelope.originalPrompt,
    enrichedPrompt: envelope.enrichedPrompt,
    contextBlock: envelope.contextBlock
  };
}

function cloneFileTreeNode(node: FileTreeNode): FileTreeNode {
  return {
    name: node.name,
    path: node.path,
    type: node.type,
    sizeBytes: node.sizeBytes,
    children: node.children ? node.children.map(cloneFileTreeNode) : undefined
  };
}

interface WorkflowContext {
  prompt: string;
  stageResults: Record<string, any>;
}

interface TaskPromiseTracker {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout?: NodeJS.Timeout;
}

export class CodexSynapticSystem extends EventEmitter {
  private logger = Logger.getInstance();
  private healthMonitor: HealthMonitor;
  private authManager: AuthenticationManager;
  private authMiddleware: AuthMiddleware;
  private globalErrorHandler: GlobalErrorHandler;
  private circuitBreaker: CircuitBreaker;
  private resourceManager: ResourceManager;
  private autoScaler: AutoScaler;
  private storageManager: StorageManager;
  private gpuManager: GPUManager;
  private agentRegistry: AgentRegistry;
  private taskScheduler: TaskScheduler;
  private neuralMesh: NeuralMesh;
  private swarmCoordinator: SwarmCoordinator;
  private consensusManager: ConsensusManager;
  private mcpBridge: MCPBridge;
  private a2aBridge: A2ABridge;
  private configManager: ConfigurationManager;
  private memorySystem!: CodexMemorySystem;
  private vectorClient?: VectorClient;
  private toolOptimizer!: ToolOptimizer;
  private apiServer?: ApiServer;
  private reasoningPlanner!: ReasoningPlanner;
  private tenantManager!: TenantManager;
  private tenantResolver!: TenantResolver;
  private tenancyEnabled = false;
  private config?: SystemConfiguration;
  private scalingConfig?: SystemConfiguration['scaling'];
  private openaiResolved?: OpenAIResolvedConfiguration | null;
  private openaiResponsesClient?: OpenAIResponsesClient;
  private openaiModelRouter?: OpenAIModelRouter;
  private openaiModelCatalog?: { fetchedAt: Date; models: OpenAIModelCatalogEntry[] };
  private openaiUsageMonitor = new OpenAIUsageMonitor();
  private isInitialized = false;
  private isShuttingDown = false;
  private taskPromises: Map<string, TaskPromiseTracker> = new Map();
  private codexSession?: {
    context: CodexContext;
    envelope: CodexPromptEnvelope;
    primedAt: Date;
  };
  private selfHealingCooldowns: Map<string, number> = new Map();
  private readonly onTaskAssigned = (agentId: AgentId, task: Task): void => {
    this.handleTaskAssignment(agentId, task).catch((error) => {
      this.logger.error('system', 'Agent task execution failed', {
        agentId: agentId.id,
        taskId: task.id
      }, error as Error);
    });
  };
  private readonly onTaskCompletedListener = (task: Task): void => {
    this.logger.info('system', 'Task completed', { taskId: task.id });
    this.resolveTaskPromise(task.id, task.result);
    if (task.assignedTo) {
      this.agentRegistry.updateAgentStatus(task.assignedTo, AgentStatus.IDLE);
      this.agentRegistry.reportHeartbeat(task.assignedTo);
    }
    this.emit('taskCompleted', task);
  };
  private readonly onTaskFailedListener = (task: Task): void => {
    this.logger.warn('system', 'Task failed', { taskId: task.id, error: task.error });
    this.rejectTaskPromise(task.id, task.error || 'Task failed');
    if (task.assignedTo) {
      this.agentRegistry.updateAgentStatus(task.assignedTo, AgentStatus.ERROR);
    }
    this.emit('taskFailed', task);
  };

  constructor() {
    super();
    this.logger.info('system', 'Codex-Synaptic System created');
    
    // Initialize core infrastructure
    this.configManager = new ConfigurationManager();
    this.authManager = new AuthenticationManager();
    this.authMiddleware = new AuthMiddleware(this.authManager);
    this.globalErrorHandler = GlobalErrorHandler.getInstance();
    this.circuitBreaker = new CircuitBreaker();
    
    // Initialize resource management
    const resourceLimits: ResourceLimits = {
      maxMemoryMB: 2048,
      maxCpuPercent: 80,
      maxActiveAgents: 50,
      maxConcurrentTasks: 100,
      maxRequestsPerMinute: 1000
    };
    this.resourceManager = new ResourceManager(resourceLimits);
    this.autoScaler = new AutoScaler(this.resourceManager);
    this.storageManager = new StorageManager();
    this.gpuManager = new GPUManager();
    
    // Initialize components
    this.agentRegistry = new AgentRegistry();
    this.taskScheduler = new TaskScheduler(this.agentRegistry, this.resourceManager);
    this.neuralMesh = new NeuralMesh(this.agentRegistry);
    this.swarmCoordinator = new SwarmCoordinator(this.agentRegistry);
    this.consensusManager = new ConsensusManager(this.agentRegistry);
    this.mcpBridge = new MCPBridge();
    this.a2aBridge = new A2ABridge(this.agentRegistry);
    this.healthMonitor = new HealthMonitor(this);
    const envTenancy = this.isTenancyEnvEnabled();
    this.initializeTenancyResources(envTenancy);
    
    this.setupEventHandlers();

    this.autoScaler.on('scaleUp', (payload) => this.handleScaleUp(payload));
    this.autoScaler.on('scaleDown', (payload) => this.handleScaleDown(payload));
    this.agentRegistry.on('agentStatusChanged', (agentId: AgentId, status: AgentStatus, oldStatus?: AgentStatus) => {
      this.handleAgentStatusChange(agentId, status, oldStatus);
    });
    this.agentRegistry.on('agentUnregistered', (agentId: AgentId) => {
      this.handleAgentUnregistered(agentId);
    });
    this.neuralMesh.on('selfHealingApplied', (event) => {
      this.memorySystem.store('mesh_events', `self-healing-${Date.now()}`, {
        ...event,
        storedAt: new Date().toISOString()
      }).catch(() => {});
    });
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('system', 'System already initialized');
      return;
    }

    this.logger.info('system', 'Initializing Codex-Synaptic System...');

    try {
      // Initialize error handling first
      this.globalErrorHandler.initialize();
      
      // Load configuration
      await this.configManager.load();
      this.config = this.configManager.get();
      this.applyLoggerSettings();
      const desiredTenancy = this.resolveTenancySetting();
      await this.refreshTenancyResources(desiredTenancy);
      await this.applyConfiguredTenancyDefaults();
      this.scalingConfig = this.config?.scaling;
      if (this.scalingConfig?.enabled) {
        this.autoScaler.updateConfig({
          minAgents: this.scalingConfig.minAgents,
          maxAgents: this.scalingConfig.maxAgents,
          scaleUpThreshold: this.scalingConfig.scaleUpThreshold,
          scaleDownThreshold: this.scalingConfig.scaleDownThreshold,
          cooldownMs: this.scalingConfig.cooldownMs
        });
      }

      const meshRunDuration = this.config?.mesh?.maxRunDurationMs ?? 60 * 60 * 1000;
      const swarmRunDuration = this.config?.swarm?.maxRunDurationMs ?? 60 * 60 * 1000;
      this.neuralMesh.setMaxRunDuration(meshRunDuration);
      this.swarmCoordinator.setMaxRunDuration(swarmRunDuration);

      if (this.config?.gpu) {
        this.gpuManager.setProbeCacheOptions({
          disableCache: this.config.gpu.disableProbeCache,
          probeCacheTtlMs: this.config.gpu.probeCacheTtlMs
        });
      }

      // Initialize authentication system
      this.authManager.startPeriodicCleanup();
      
      // Initialize resource management
      this.resourceManager.initialize();

      // Initialize GPU detection
      await this.gpuManager.initialize();
      this.resourceManager.setGpuStatus(this.gpuManager.getStatus());

  await this.initializeOpenAIIntegration();

      // Initialize storage
      await this.storageManager.initialize();

      // Initialize components in dependency order with circuit breaker
      await this.circuitBreaker.execute(async () => {
        await this.agentRegistry.initialize();
        await this.taskScheduler.initialize();
        await this.neuralMesh.initialize();
        await this.swarmCoordinator.initialize();
        await this.consensusManager.initialize();
        await this.mcpBridge.initialize();
        await this.a2aBridge.initialize();
      });

      if (this.config?.mesh) {
        this.neuralMesh.configure({
          supportedTopologies: this.config.mesh.supportedTopologies,
          selfHealing: this.config.mesh.selfHealing
        });
      }

      if (this.config?.consensus) {
        this.consensusManager.updateConfig(this.config.consensus as ConsensusModeConfig);
      }

      this.isInitialized = true;

      // Start health monitoring
      this.healthMonitor.startPeriodicHealthChecks();
      
      await this.connectConfiguredBridges();
      await this.bootstrapDefaultAgents();
      await this.startApiServerIfEnabled();
      this.emit('initialized');
      
      this.logger.info('system', 'Codex-Synaptic System initialized successfully');
      
    } catch (error) {
      this.isInitialized = false;
      this.logger.error('system', 'Failed to initialize system', undefined, error as Error);
      throw new SystemError('System initialization failed', { error: (error as Error).message });
    } finally {
      if (!this.isInitialized) {
        this.authManager.stopPeriodicCleanup();
      }
    }
  }

  private async initializeOpenAIIntegration(): Promise<void> {
    this.openaiResponsesClient = undefined;
    this.openaiModelRouter = undefined;
    this.openaiModelCatalog = undefined;
    this.openaiResolved = resolveOpenAIConfiguration(this.config?.openai);

    if (!this.openaiResolved?.config?.enabled) {
      this.logger.info('openai', 'OpenAI integration disabled via configuration');
      return;
    }

    if (!isOpenAIIntegrationReady(this.openaiResolved.config, this.openaiResolved.credentials)) {
      this.logger.warn('openai', 'OpenAI integration enabled but credentials are missing', {
        credentialEnv: this.openaiResolved.config.credentials
      });
      return;
    }

    if (this.openaiResolved.config.responses?.enabled !== false) {
      this.openaiResponsesClient = new OpenAIResponsesClient({
        apiKey: this.openaiResolved.credentials.apiKey,
        organizationId: this.openaiResolved.credentials.organizationId,
        projectId: this.openaiResolved.credentials.projectId,
        defaultModel: this.openaiResolved.config.responses?.defaultModel,
        defaultImageModel: this.openaiResolved.config.responses?.defaultImageModel,
        defaultVideoModel: this.openaiResolved.config.responses?.defaultVideoModel,
        defaultSpeechModel: this.openaiResolved.config.responses?.defaultSpeechModel,
        defaultTranscriptionModel: this.openaiResolved.config.responses?.defaultTranscriptionModel,
        defaultModerationModel: this.openaiResolved.config.responses?.defaultModerationModel,
        defaultSearchModel: this.openaiResolved.config.responses?.defaultSearchModel,
        requestTimeoutMs: this.openaiResolved.config.responses?.requestTimeoutMs,
        userAgentExtension: this.openaiResolved.config.responses?.userAgentExtension,
        logger: this.logger,
        usageMonitor: this.openaiUsageMonitor
      });

      if (!this.openaiResponsesClient?.isReady()) {
        this.logger.warn('openai', 'OpenAI responses client unavailable during initialization; continuing without API-backed responses.', {
          reason: this.openaiResponsesClient?.getUnavailableReason?.() ?? 'unknown'
        });
        this.openaiResponsesClient = undefined;
      } else {
        try {
          const snapshot = await this.openaiResponsesClient.getModelCatalogSnapshot();
          this.openaiModelCatalog = snapshot;
          if (this.openaiResponsesClient?.isReady()) {
            this.logger.info('openai', 'Fetched OpenAI model catalog from API', {
              modelCount: snapshot.models.length,
              fetchedAt: snapshot.fetchedAt.toISOString()
            });
          } else {
            this.logger.info('openai', 'OpenAI responses client became unavailable during startup validation; using static model catalog only.');
            this.openaiResponsesClient = undefined;
          }
        } catch (error) {
          this.logger.warn('openai', 'Failed to retrieve OpenAI model catalog from API', undefined, error as Error);
        }
      }
    }

    const routerCatalog = this.openaiResolved.config.modelCatalog ?? this.openaiModelCatalog?.models;
    const routerConfig = this.openaiResolved.config.modelRouting;
    const listModels = this.openaiResponsesClient?.isReady()
      ? () => this.openaiResponsesClient!.listAvailableModels()
      : undefined;

    this.openaiModelRouter = new OpenAIModelRouter({
      catalog: routerCatalog,
      routing: routerConfig,
      baselineDefaultModel: this.openaiResolved.config.responses?.defaultModel,
      listModels,
      logger: this.logger
    });

    this.logger.info('openai', 'OpenAI model router initialized', {
      catalogSize: routerCatalog?.length ?? 'default',
      hasDynamicInventory: Boolean(listModels)
    });
  }

  getOpenAIResponsesClient(): OpenAIResponsesClient | undefined {
    return this.openaiResponsesClient;
  }

  getOpenAIModelCatalogSnapshot(): { fetchedAt: Date; models: OpenAIModelCatalogEntry[] } | undefined {
    return this.openaiModelCatalog;
  }

  async refreshOpenAIModelCatalog(): Promise<{ fetchedAt: Date; models: OpenAIModelCatalogEntry[] } | undefined> {
    if (!this.openaiResponsesClient?.isReady()) {
      this.logger.warn('openai', 'Cannot refresh OpenAI model catalog because the client is not ready');
      return undefined;
    }

    try {
      const snapshot = await this.openaiResponsesClient.getModelCatalogSnapshot();
      this.openaiModelCatalog = snapshot;
      this.logger.info('openai', 'Refreshed OpenAI model catalog', {
        modelCount: snapshot.models.length,
        fetchedAt: snapshot.fetchedAt.toISOString()
      });
      return snapshot;
    } catch (error) {
      this.logger.warn('openai', 'Failed to refresh OpenAI model catalog', undefined, error as Error);
      return undefined;
    }
  }

  async generateOpenAIImage(request: Record<string, unknown>): Promise<unknown> {
    if (!this.openaiResponsesClient?.isReady()) {
      throw new SystemError('OpenAI image generation requested but integration is not ready.', {
        integration: 'openai',
        capability: 'image'
      });
    }
    return this.openaiResponsesClient.generateImage(request);
  }

  async generateOpenAIVideo(request: Record<string, unknown>): Promise<unknown> {
    if (!this.openaiResponsesClient?.isReady()) {
      throw new SystemError('OpenAI video generation requested but integration is not ready.', {
        integration: 'openai',
        capability: 'video'
      });
    }
    return this.openaiResponsesClient.generateVideo(request);
  }

  async generateOpenAISpeech(request: Record<string, unknown>): Promise<unknown> {
    if (!this.openaiResponsesClient?.isReady()) {
      throw new SystemError('OpenAI speech synthesis requested but integration is not ready.', {
        integration: 'openai',
        capability: 'speech'
      });
    }
    return this.openaiResponsesClient.generateSpeech(request);
  }

  async transcribeOpenAIAudio(request: Record<string, unknown>): Promise<unknown> {
    if (!this.openaiResponsesClient?.isReady()) {
      throw new SystemError('OpenAI transcription requested but integration is not ready.', {
        integration: 'openai',
        capability: 'transcription'
      });
    }
    return this.openaiResponsesClient.transcribeAudio(request);
  }

  async moderateWithOpenAI(request: Record<string, unknown>): Promise<unknown> {
    if (!this.openaiResponsesClient?.isReady()) {
      throw new SystemError('OpenAI moderation requested but integration is not ready.', {
        integration: 'openai',
        capability: 'moderation'
      });
    }
    return this.openaiResponsesClient.moderateContent(request);
  }

  async executeOpenAISearch(request: Record<string, unknown>): Promise<unknown> {
    if (!this.openaiResponsesClient?.isReady()) {
      throw new SystemError('OpenAI search requested but integration is not ready.', {
        integration: 'openai',
        capability: 'search'
      });
    }
    return this.openaiResponsesClient.executeSearch(request);
  }

  async createOpenAIRealtimeSession(request: Record<string, unknown>): Promise<unknown> {
    if (!this.openaiResponsesClient?.isReady()) {
      throw new SystemError('OpenAI realtime session requested but integration is not ready.', {
        integration: 'openai',
        capability: 'realtime'
      });
    }
    return this.openaiResponsesClient.createRealtimeSession(request);
  }

  getOpenAIResolvedConfiguration(): OpenAIResolvedConfiguration | null | undefined {
    return this.openaiResolved;
  }

  getOpenAIUsageSummary(windowMs?: number): OpenAIUsageSummary {
    return this.openaiUsageMonitor.getSummary(windowMs);
  }

  getRecentOpenAIUsage(limit?: number): OpenAIUsageEvent[] {
    return this.openaiUsageMonitor.getEvents(limit);
  }

  hasOpenAIUsage(): boolean {
    return this.openaiUsageMonitor.hasData();
  }

  private shouldAppendOpenAISynthesisStage(): boolean {
    if (!this.openaiResponsesClient?.isReady()) {
      return false;
    }
    const openaiConfig = this.openaiResolved?.config;
    if (!openaiConfig?.enabled) {
      return false;
    }
    if (openaiConfig.responses?.enabled === false) {
      return false;
    }
    return openaiConfig.defaultBackend === 'openai-responses';
  }

  private shouldExecuteStageWithOpenAI(stage: WorkflowStage): boolean {
    if (!this.openaiResponsesClient?.isReady()) {
      return false;
    }
    if (stage.taskType !== 'openai_responses') {
      return false;
    }
    if (stage.id !== 'openai-synthesis') {
      return false;
    }
    const openaiConfig = this.openaiResolved?.config;
    if (!openaiConfig?.enabled) {
      return false;
    }
    if (openaiConfig.responses?.enabled === false) {
      return false;
    }
    return true;
  }

  private buildOpenAISynthesisPayload(context: WorkflowContext): Record<string, any> {
    return {
      prompt: context.prompt,
      stageContext: this.buildOpenAIStageContextSnapshot(context),
      artifacts: {
        research: context.stageResults['research-scan']?.result ?? null,
        analysis: context.stageResults['data-analysis']?.result ?? null,
        reactPlan: context.stageResults['react-plan']?.result ?? null,
        architecture: context.stageResults['architecture-blueprint']?.result ?? null,
        code: context.stageResults['code-generation']?.result ?? null,
        validation: context.stageResults['validation']?.result ?? null,
        knowledge: context.stageResults['knowledge-distillation']?.result ?? null,
        insight: context.stageResults['insight-summary']?.result ?? null
      }
    };
  }

  private buildOpenAIStageContextSnapshot(context: WorkflowContext): Array<Record<string, any>> {
    return Object.entries(context.stageResults).map(([id, entry]) => {
      const result = entry?.result ?? {};
      const snapshot: Record<string, any> = { id };

      if (typeof result.summary === 'string') {
        snapshot.summary = result.summary;
      }

      if (typeof result.status !== 'undefined') {
        snapshot.status = result.status;
      }

      if (typeof result.generatedCode === 'string') {
        snapshot.generatedCodePreview = result.generatedCode.slice(0, 4000);
      }

      if (Array.isArray(result.issues)) {
        snapshot.issues = result.issues.slice(0, 10);
      }

      if (Array.isArray(result.keyFindings)) {
        snapshot.keyFindings = result.keyFindings.slice(0, 10);
      }

      if (result?.passed !== undefined) {
        snapshot.validationPassed = result.passed;
      }

      return snapshot;
    });
  }

  private buildOpenAIStageInstructions(stage: WorkflowStage): string {
    if (stage.id === 'openai-synthesis') {
      return [
        'You are the OpenAI synthesis module for the Codex-Synaptic workflow.',
        'Use the provided JSON context to craft a production-ready response.',
        'Return a JSON object with the following keys:',
        "summary (string) - concise overview of the workflow outcome.",
        "finalAnswer (string) - direct answer to the original prompt.",
        "keyPoints (array of strings) - most important insights.",
        "nextActions (array of strings) - recommended follow-up steps (may be empty)."
      ].join(' ');
    }

    return `You are assisting the Codex-Synaptic workflow stage "${stage.label}". ` +
      'Analyze the JSON payload and respond with a JSON object containing summary (string) and keyPoints (array of strings).';
  }

  private async executeStageWithOpenAIResponses(
    stage: WorkflowStage,
    payload: Record<string, any>,
    context: WorkflowContext,
    options?: { tenantId?: string }
  ): Promise<any> {
    if (!this.openaiResponsesClient) {
      throw new Error('OpenAI responses client is not initialized.');
    }

    const instructions = this.buildOpenAIStageInstructions(stage);
    const stageContext = this.buildOpenAIStageContextSnapshot(context);
    const inputEnvelope = {
      prompt: context.prompt,
      stage: {
        id: stage.id,
        label: stage.label
      },
      payload,
      stageContext
    };

    let modelSelection: { model: string; reason: string; usedFallback: boolean; fallbackChain: string[] } | null = null;
    if (this.openaiModelRouter) {
      try {
        const selection = await this.openaiModelRouter.selectModel({
          prompt: context.prompt,
          stageId: stage.id,
          stageLabel: stage.label,
          taskType: stage.taskType,
          priority: stage.priority,
          payload,
          stageContext
        });
        modelSelection = {
          model: selection.model,
          reason: selection.reason,
          usedFallback: selection.usedFallback,
          fallbackChain: selection.fallbackChain
        };
        this.logger.info('openai', 'Model router selected OpenAI model', {
          stageId: stage.id,
          stageLabel: stage.label,
          model: selection.model,
          reason: selection.reason,
          usedFallback: selection.usedFallback,
          fallbackChain: selection.fallbackChain
        });
      } catch (error) {
        this.logger.warn('openai', 'OpenAI model router failed to select model; falling back to client defaults', {
          stageId: stage.id,
          reason: (error as Error).message
        });
      }
    }

    const request: OpenAIResponseRequest = {
      instructions,
      input: this.safeStringifyForOpenAI(inputEnvelope),
      model: modelSelection?.model,
      response_format: { type: 'json_object' },
      metadata: {
        workflowStage: stage.id,
        ...(modelSelection
          ? {
              selectedModel: modelSelection.model,
              modelRoutingReason: modelSelection.reason,
              modelUsedFallback: modelSelection.usedFallback,
              modelFallbackChain: modelSelection.fallbackChain
            }
          : {})
      }
    };

    this.logger.info('openai', 'Executing workflow stage via OpenAI Responses', {
      stageId: stage.id,
      label: stage.label
    });

    const response = await this.openaiResponsesClient.createResponse<any>(request);
    const normalized = this.normalizeOpenAIResponse(stage, response);

    if (this.memorySystem) {
      await this.memorySystem.store(
        'openai_responses',
        `stage-${stage.id}-${Date.now()}`,
        {
          prompt: context.prompt,
          stage: stage.id,
          stageLabel: stage.label,
          payloadSnapshot: payload,
          response: normalized,
          storedAt: new Date().toISOString()
        },
        options?.tenantId ? { tenantId: options.tenantId } : undefined
      ).catch((error: unknown) => {
        this.logger.warn('openai', 'Failed to persist OpenAI response to memory', {
          stageId: stage.id,
          reason: (error as Error).message
        });
      });
    }

    return normalized;
  }

  private normalizeOpenAIResponse(stage: WorkflowStage, response: any): Record<string, any> {
    const responseText = this.extractOpenAIText(response);
    let structured: any;

    if (responseText) {
      try {
        structured = JSON.parse(responseText);
      } catch {
        structured = undefined;
      }
    }

    const summary = typeof structured?.summary === 'string'
      ? structured.summary
      : responseText ?? `Completed stage ${stage.label} using OpenAI.`;

    return {
      summary,
      finalAnswer: typeof structured?.finalAnswer === 'string' ? structured.finalAnswer : undefined,
      keyPoints: Array.isArray(structured?.keyPoints) ? structured.keyPoints : undefined,
      nextActions: Array.isArray(structured?.nextActions) ? structured.nextActions : undefined,
      responseText,
      structured: structured ?? null,
      raw: response
    };
  }

  private extractOpenAIText(response: any): string | undefined {
    if (!response) {
      return undefined;
    }

    if (typeof response.output_text === 'string') {
      return response.output_text;
    }

    if (Array.isArray(response.output)) {
      const textParts: string[] = [];
      for (const item of response.output) {
        if (!item) continue;
        if (typeof item === 'string') {
          textParts.push(item);
          continue;
        }
        if (typeof item.text === 'string') {
          textParts.push(item.text);
          continue;
        }
        if (Array.isArray(item.content)) {
          textParts.push(
            item.content
              .map((contentNode: any) => {
                if (typeof contentNode === 'string') {
                  return contentNode;
                }
                if (typeof contentNode.text === 'string') {
                  return contentNode.text;
                }
                return '';
              })
              .filter(Boolean)
              .join(' ')
          );
        }
      }
      const combined = textParts.filter(Boolean).join('\n').trim();
      if (combined) {
        return combined;
      }
    }

    if (Array.isArray(response.data)) {
      const dataText = response.data
        .map((entry: any) => {
          if (typeof entry?.text === 'string') {
            return entry.text;
          }
          if (Array.isArray(entry?.content)) {
            return entry.content
              .map((contentNode: any) => contentNode?.text ?? '')
              .filter(Boolean)
              .join(' ');
          }
          return '';
        })
        .filter(Boolean)
        .join('\n')
        .trim();
      if (dataText) {
        return dataText;
      }
    }

    return undefined;
  }

  private safeStringifyForOpenAI(input: unknown): string {
    try {
      const serialized = JSON.stringify(input);
      if (serialized.length > 20000) {
        return `${serialized.slice(0, 19980)}...`;
      }
      return serialized;
    } catch {
      return '[unserializable payload]';
    }
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      this.logger.warn('system', 'System already shutting down');
      return;
    }

    this.isShuttingDown = true;
    this.logger.info('system', 'Shutting down Codex-Synaptic System...');

    this.healthMonitor.stopPeriodicHealthChecks();
    this.authManager.stopPeriodicCleanup();

    try {
      // Shutdown components in reverse dependency order
      await this.a2aBridge.shutdown();
      await this.mcpBridge.shutdown();
      await this.consensusManager.shutdown();
      await this.swarmCoordinator.shutdown();
      await this.neuralMesh.shutdown();
      await this.taskScheduler.shutdown();
      await this.agentRegistry.shutdown();
      await this.apiServer?.stop();
      this.apiServer = undefined;
      
      // Shutdown infrastructure
      await this.storageManager.shutdown();
      this.resourceManager.shutdown();
      await this.gpuManager.shutdown();

      this.emit('shutdown');
      this.logger.info('system', 'Codex-Synaptic System shutdown complete');
      
    } catch (error) {
      this.logger.error('system', 'Error during shutdown', undefined, error as Error);
      throw error;
    } finally {
      this.agentRegistry.off('taskAssigned', this.onTaskAssigned);
      this.taskScheduler.off('taskCompleted', this.onTaskCompletedListener);
      this.taskScheduler.off('taskFailed', this.onTaskFailedListener);
      this.clearTaskPromises();
      await this.logger.close();
    }
  }

  async primeCodexInterface(context: CodexContext, envelope: CodexPromptEnvelope): Promise<void> {
    const username = process.env.CODEX_CLI_USERNAME ?? 'admin';
    const password = process.env.CODEX_CLI_PASSWORD;

    if (!password) {
      this.logger.error('system', 'CODEX_CLI_PASSWORD environment variable is required for authentication');
      throw new CodexSynapticError(
        ErrorCode.AGENT_NOT_FOUND,
        'Authentication credentials not configured. Set CODEX_CLI_PASSWORD environment variable.',
        { username, contextHash: context.contextHash }
      );
    }

    try {
      await this.authManager.authenticate(username, password);
    } catch (error) {
      this.logger.warn('system', 'Codex CLI authentication failed', {
        username,
        contextHash: context.contextHash
      }, error as Error);
      throw new CodexSynapticError(
        ErrorCode.AGENT_NOT_FOUND,
        'Codex CLI authentication failed',
        { username, contextHash: context.contextHash },
        true
      );
    }

    this.codexSession = {
      context: cloneCodexContext(context),
      envelope: cloneCodexEnvelope(envelope),
      primedAt: new Date()
    };

    this.logger.info('system', 'Codex CLI primed with context', {
      contextHash: context.contextHash,
      directivesChars: context.agentDirectives.length,
      directories: context.directoryInventory.roots.length,
      databases: context.databaseMetadata.length
    });
  }

  private setupEventHandlers(): void {
    // Agent Registry Events
    this.agentRegistry.on('agentRegistered', (agent) => {
      this.logger.info('system', 'Agent registered', { agentId: agent.id });
      this.emit('agentRegistered', agent);
    });

    this.agentRegistry.on('agentUnregistered', (agentId) => {
      this.logger.info('system', 'Agent unregistered', { agentId });
      this.emit('agentUnregistered', agentId);
    });

    this.agentRegistry.on('taskAssigned', this.onTaskAssigned);

    // Task Scheduler Events
    this.taskScheduler.on('taskCompleted', this.onTaskCompletedListener);
    this.taskScheduler.on('taskFailed', this.onTaskFailedListener);

    // GPU Events
    this.gpuManager.on('statusChanged', (status: GPUStatus) => {
      this.resourceManager.setGpuStatus(status);
      this.emit('gpuStatusChanged', status);
    });

    // Neural Mesh Events
    this.neuralMesh.on('topologyUpdated', (topology) => {
      this.logger.info('system', 'Neural mesh topology updated');
      this.emit('topologyUpdated', topology);
    });

    // Consensus Events
    this.consensusManager.on('consensusReached', (result) => {
      const proposalId = result?.proposal?.id ?? 'unknown';
      this.logger.info('system', 'Consensus reached', { proposalId, accepted: result?.accepted });
      this.reasoningPlanner.handleConsensusResult(result).catch((error) => {
        this.logger.warn('system', 'Failed to update reasoning planner from consensus result', {
          proposalId,
          reason: (error as Error).message
        });
      });
      this.emit('consensusReached', result);
    });
    this.consensusManager.on('consensusTelemetry', (payload) => {
      this.handleConsensusTelemetry(payload).catch((error) => {
        this.logger.warn('system', 'Failed to persist consensus telemetry', { reason: (error as Error).message });
      });
    });

    // Error handling
    process.on('uncaughtException', (error) => {
      this.logger.fatal('system', 'Uncaught exception', undefined, error);
      this.shutdown().finally(() => process.exit(1));
    });

    process.on('unhandledRejection', (reason) => {
      this.logger.fatal('system', 'Unhandled rejection', { reason });
      this.shutdown().finally(() => process.exit(1));
    });
  }

  // Public API methods
  getAgentRegistry(): AgentRegistry {
    return this.agentRegistry;
  }

  getTaskScheduler(): TaskScheduler {
    return this.taskScheduler;
  }

  getNeuralMesh(): NeuralMesh {
    return this.neuralMesh;
  }

  getSwarmCoordinator(): SwarmCoordinator {
    return this.swarmCoordinator;
  }

  getConsensusManager(): ConsensusManager {
    return this.consensusManager;
  }

  getConfigManager(): ConfigurationManager {
    return this.configManager;
  }

  private async initializeVectorClient(): Promise<void> {
    const vectorConfig = this.configManager.getVectorConfig();
    if (!vectorConfig?.enabled) {
      this.vectorClient = undefined;
      return;
    }

    if (vectorConfig.engine === 'local') {
      this.vectorClient = new LocalVectorClient();
    } else if (vectorConfig.engine === 'qdrant') {
      this.vectorClient = new QdrantVectorClient(vectorConfig.qdrant?.url ?? 'http://localhost:6333', vectorConfig.qdrant?.apiKey);
    } else {
      this.logger.warn('system', `Vector engine ${vectorConfig.engine} not implemented; falling back to local.`);
      this.vectorClient = new LocalVectorClient();
    }

    await this.vectorClient.ensureCollection(vectorConfig.collection, vectorConfig.dimensions);
  }

  getVectorClient(): VectorClient | undefined {
    return this.vectorClient;
  }


  getMCPBridge(): MCPBridge {
    return this.mcpBridge;
  }

  getA2ABridge(): A2ABridge {
    return this.a2aBridge;
  }

  getMemorySystem(): CodexMemorySystem {
    return this.memorySystem;
  }

  getToolOptimizer(): ToolOptimizer {
    return this.toolOptimizer;
  }

  getApiServer(): ApiServer | undefined {
    return this.apiServer;
  }

  async evaluateToolsForPrompt(prompt: string, candidates: ToolCandidate[], options?: { tenantId?: string }): Promise<ToolScore[]> {
    return this.toolOptimizer.evaluateTools(prompt, candidates, { tenantId: options?.tenantId });
  }

  async recordToolOutcome(record: ToolUsageRecord, options?: { tenantId?: string }): Promise<number> {
    return this.toolOptimizer.recordToolOutcome(record, { tenantId: options?.tenantId });
  }

  async createReasoningPlan(
    prompt: string,
    options?: ReasoningPlanOptions,
    context?: { tenantId?: string }
  ): Promise<ReasoningPlanCreationResult> {
    return this.reasoningPlanner.createPlan(prompt, options, { tenantId: context?.tenantId });
  }

  async checkpointReasoningPlan(
    planId: string,
    input: ReasoningCheckpointInput,
    context?: { tenantId?: string }
  ): Promise<ReasoningRunRecord> {
    return this.reasoningPlanner.checkpoint(planId, input, { tenantId: context?.tenantId });
  }

  async completeReasoningPlan(
    planId: string,
    options: ReasoningCompletionOptions,
    context?: { tenantId?: string }
  ): Promise<ReasoningRunRecord> {
    return this.reasoningPlanner.complete(planId, options, { tenantId: context?.tenantId });
  }

  async resumeReasoningPlan(planId: string, context?: { tenantId?: string }): Promise<ReasoningRunRecord | null> {
    return this.reasoningPlanner.resume(planId, { tenantId: context?.tenantId });
  }

  async listReasoningPlans(limit = 10, context?: { tenantId?: string }): Promise<ReasoningRunRecord[]> {
    return this.reasoningPlanner.list(limit, { tenantId: context?.tenantId });
  }

  getHealthMonitor(): HealthMonitor {
    return this.healthMonitor;
  }

  getAuthenticationManager(): AuthenticationManager {
    return this.authManager;
  }

  getAuthMiddleware(): AuthMiddleware {
    return this.authMiddleware;
  }

  getResourceManager(): ResourceManager {
    return this.resourceManager;
  }

  getTenantManager(): TenantManager {
    return this.tenantManager;
  }

  getTenantResolver(): TenantResolver {
    return this.tenantResolver;
  }

  isMultiTenancyEnabled(): boolean {
    return this.tenancyEnabled;
  }

  getGpuManager(): GPUManager {
    return this.gpuManager;
  }

  getAutoScaler(): AutoScaler {
    return this.autoScaler;
  }

  getStorageManager(): StorageManager {
    return this.storageManager;
  }

  isReady(): boolean {
    return this.isInitialized && !this.isShuttingDown;
  }

  getStatus(): any {
    return {
      initialized: this.isInitialized,
      shuttingDown: this.isShuttingDown,
      components: {
        agentRegistry: this.agentRegistry.getStatus(),
        taskScheduler: this.taskScheduler.getStatus(),
        neuralMesh: this.neuralMesh.getStatus(),
        swarmCoordinator: this.swarmCoordinator.getStatus(),
        consensusManager: this.consensusManager.getStatus(),
        mcpBridge: this.mcpBridge.getStatus(),
        a2aBridge: this.a2aBridge.getStatus(),
        resources: this.resourceManager.getCurrentUsage(),
        gpu: this.gpuManager.getStatus()
      }
    };
  }

  async deployAgent(type: AgentType, count: number): Promise<void> {
    if (!this.isInitialized) {
      throw new SystemError('System must be initialized before deploying agents.');
    }

    // Check resource availability
    const resourceCheck = this.resourceManager.checkResourceAvailability();
    if (!resourceCheck.available) {
      this.logger.warn('system', 'Resources not available for agent deployment', { reasons: resourceCheck.reasons });
      throw new SystemError(`Cannot deploy agents: ${resourceCheck.reasons.join(', ')}`);
    }

    const maxAgents = this.config?.system.maxAgents ?? Number.MAX_SAFE_INTEGER;
    const currentAgents = this.agentRegistry.getAgentCount();
    const availableSlots = Math.max(maxAgents - currentAgents, 0);

    if (availableSlots === 0) {
      this.logger.warn('system', 'Maximum agent capacity reached; skipping deployment.');
      return;
    }

    const deployCount = Math.min(count, availableSlots);
    const deployedAgents: Agent[] = [];

    for (let i = 0; i < deployCount; i++) {
      const agent = this.createAgentInstance(type);
      deployedAgents.push(agent);
      this.agentRegistry.register(agent);
      this.agentRegistry.updateAgentStatus(agent.getId(), AgentStatus.IDLE);
      this.agentRegistry.reportHeartbeat(agent.getId());
    }

    // Update resource tracking
    this.resourceManager.updateAgentCount(this.agentRegistry.getAgentCount());

    if (deployCount < count) {
      this.logger.warn('system', 'Deployment truncated due to capacity limits', {
        requested: count,
        deployed: deployCount
      });
    }

    this.logger.info('system', 'Agents deployed successfully', {
      type,
      count: deployCount
    });
  }

  async createNeuralMesh(topology: string, nodes: number): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('System must be initialized before configuring the neural mesh.');
    }

    this.logger.info('system', 'Configuring neural mesh', { topology, nodes });
    const meshConfig = this.config?.mesh;
    this.neuralMesh.configure({
      topology,
      desiredNodeCount: nodes,
      maxConnections: meshConfig?.maxConnections,
      supportedTopologies: meshConfig?.supportedTopologies,
      selfHealing: meshConfig?.selfHealing
    });
    this.logger.info('system', 'Neural mesh configuration applied');
  }

  async startSwarm(algorithm: string, objectives: string[] = []): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('System must be initialized before starting swarm coordination.');
    }

    const config: SwarmConfiguration = {
      algorithm: (algorithm as SwarmConfiguration['algorithm']) ||
        (this.config?.swarm.defaultAlgorithm ?? 'pso'),
      parameters: {
        inertiaWeight: 0.6,
        cognitiveCoeff: 1.8,
        socialCoeff: 1.8,
        maxIterations: this.config?.swarm.maxIterations ?? 250
      },
      objectives: objectives.length ? objectives : ['latency', 'throughput', 'resilience'],
      constraints: []
    };

    this.logger.info('system', 'Starting swarm coordination', config);
    this.swarmCoordinator.startSwarm(config);
    this.logger.info('system', 'Swarm coordination in progress');
  }

  async executeTask(prompt: string, options?: { tenantId?: string }): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('System must be initialized before executing tasks.');
    }

    this.logger.info('system', 'Executing workflow for prompt', { prompt });

    const context: WorkflowContext = {
      prompt,
      stageResults: {}
    };

    const startTime = Date.now();
    const requireConsensus = this.shouldRequireConsensusForPrompt(prompt);
    const tenantId = options?.tenantId;
    let planId: string | undefined;
    let planTracked = false;
    let planCompleted = false;
    try {
      const reasoningPlan = await this.createReasoningPlan(
        prompt,
        {
          planType: 'tot',
          requireConsensus
        },
        { tenantId }
      );
      planId = reasoningPlan.planId;
      planTracked = true;

      if (requireConsensus && reasoningPlan.consensus?.proposalId) {
        const decision = await this.waitForConsensusDecision(reasoningPlan.consensus.proposalId);
        if (!decision.accepted) {
          await this.completeReasoningPlan(reasoningPlan.planId, {
            status: 'aborted',
            summary: 'Consensus gating rejected execution',
            metadata: { decision },
            durationMs: Date.now() - startTime
          }, { tenantId });
          planCompleted = true;
          planId = undefined;
          throw new Error(`Workflow blocked by consensus (proposal ${reasoningPlan.consensus.proposalId})`);
        }
        await this.checkpointReasoningPlan(reasoningPlan.planId, {
          label: 'consensus-approved',
          status: 'complete',
          summary: 'Consensus approval granted'
        }, { tenantId });
      }
    } catch (error) {
      if (!planTracked) {
        throw error;
      }
      throw error;
    }

    const stages = this.buildWorkflow(prompt);
    const stageOutputs: Array<{ stage: string; taskId: string; result: any }> = [];
    try {
      for (const stage of stages) {
        const payload = stage.payloadBuilder(context);

        if (this.shouldExecuteStageWithOpenAI(stage)) {
          const syntheticTaskId = `openai-${stage.id}-${randomUUID()}`;
          const stageMeta = {
            id: stage.id,
            label: stage.label,
            taskId: syntheticTaskId,
            taskType: stage.taskType
          };

          this.emit('workflowStageStarted', {
            ...stageMeta,
            payload
          });

          const result = await this.executeStageWithOpenAIResponses(stage, payload, context, { tenantId });
          context.stageResults[stage.id] = { payload, result };
          stageOutputs.push({ stage: stage.label, taskId: syntheticTaskId, result });

          this.emit('workflowStageCompleted', {
            ...stageMeta,
            result
          });

          if (planId) {
            await this.checkpointReasoningPlan(planId, {
              label: stage.id,
              status: 'complete',
              summary: stage.label
            }, { tenantId });
          }

          continue;
        }

        const task = this.taskScheduler.submitTask({
          type: stage.taskType,
          priority: stage.priority,
          requiredCapabilities: stage.requiredCapabilities,
          payload,
          tenantId
        });

        const stageMeta = {
          id: stage.id,
          label: stage.label,
          taskId: task.id,
          taskType: stage.taskType
        };
        this.emit('workflowStageStarted', {
          ...stageMeta,
          payload
        });

        const result = await this.waitForTaskResult(task.id);
        context.stageResults[stage.id] = { payload, result };
        stageOutputs.push({ stage: stage.label, taskId: task.id, result });
        this.emit('workflowStageCompleted', {
          ...stageMeta,
          result
        });

        if (planId) {
          await this.checkpointReasoningPlan(planId, {
            label: stage.id,
            status: 'complete',
            summary: stage.label
          }, { tenantId });
        }
      }

      const outcome = this.buildWorkflowOutcome(prompt, context, stageOutputs);
      await this.persistWorkflowArtifacts(prompt, outcome, { tenantId });
      if (planId) {
        await this.completeReasoningPlan(planId, {
          status: 'completed',
          summary: outcome.summary,
          durationMs: Date.now() - startTime
        }, { tenantId });
        planCompleted = true;
      }
      this.logger.info('system', 'Workflow completed', { summary: outcome.summary });
      return outcome;
    } catch (error) {
      if (planId && !planCompleted) {
        await this.completeReasoningPlan(planId, {
          status: 'failed',
          summary: (error as Error).message,
          durationMs: Date.now() - startTime
        }, { tenantId });
      }
      throw error;
    }
  }

  async proposeConsensus(type: string, data: any, proposer?: AgentId): Promise<string> {
    const agent = proposer ?? this.agentRegistry.getAgentsByType(AgentType.CONSENSUS_COORDINATOR)[0]?.id;
    if (!agent) {
      throw new Error('No consensus coordinator agent is available to propose consensus.');
    }
    const proposalId = this.consensusManager.proposeConsensus(type, data, agent);
    return proposalId;
  }

  submitConsensusVote(proposalId: string, vote: boolean, voter?: AgentId): void {
    const agent = voter ?? this.agentRegistry.getAgentsByType(AgentType.CONSENSUS_COORDINATOR)[0]?.id;
    if (!agent) {
      throw new Error('No consensus coordinator agent is available to submit a vote.');
    }
    this.consensusManager.submitVote(proposalId, agent, vote, `${agent.id}-sig`);
  }

  async connectMcpEndpoint(endpoint: string): Promise<void> {
    await this.mcpBridge.connectEndpoint(endpoint);
  }

  async sendMcpMessage(endpoint: string, message: any): Promise<any> {
    return this.mcpBridge.sendMessage(endpoint, message);
  }

  async sendA2AMessage(targetId: string | AgentId, message: any, fromAgent?: AgentId): Promise<void> {
    const sender = fromAgent ?? this.agentRegistry.getAgentsByType(AgentType.A2A_BRIDGE)[0]?.id;
    if (!sender) {
      throw new Error('No A2A bridge agent is available to send messages.');
    }

    const recipient = typeof targetId === 'string'
      ? this.agentRegistry.getAgentByStringId(targetId)?.id
      : targetId;

    if (!recipient) {
      throw new Error(`Target agent ${typeof targetId === 'string' ? targetId : targetId.id} not found.`);
    }

    await this.a2aBridge.sendMessage(sender, recipient, message);
  }

  private applyLoggerSettings(): void {
    if (!this.config) return;
    const configuredLevel = (this.config.system.logLevel || 'info').toUpperCase() as keyof typeof LogLevel;
    if (Object.prototype.hasOwnProperty.call(LogLevel, configuredLevel)) {
      const value = LogLevel[configuredLevel];
      if (typeof value === 'number') {
        this.logger.setLogLevel(value as LogLevel);
      }
    }
  }

  private async connectConfiguredBridges(): Promise<void> {
    const endpoints = this.config?.bridges?.mcp?.enabled
      ? this.config?.bridges?.mcp?.endpoints ?? []
      : [];

    for (const endpoint of endpoints) {
      await this.mcpBridge.connectEndpoint(endpoint);
    }
  }

  private async startApiServerIfEnabled(): Promise<void> {
    const apiConfig = this.config?.api;
    const enabled = apiConfig?.enabled ?? true;
    if (!enabled) {
      this.logger.info('system', 'API server disabled via configuration');
      return;
    }

    if (!this.apiServer) {
      this.apiServer = new ApiServer(
        {
          evaluateTools: (prompt, candidates, context) =>
            this.toolOptimizer.evaluateTools(prompt, candidates, {
              tenantId: context?.tenant?.tenant.id
            }),
          recordToolOutcome: (record, context) =>
            this.toolOptimizer.recordToolOutcome(record, {
              tenantId: context?.tenant?.tenant.id
            }),
          createPlan: (prompt, options, context) =>
            this.createReasoningPlan(prompt, options, { tenantId: context?.tenant?.tenant.id }),
          checkpointPlan: (planId, input, context) =>
            this.checkpointReasoningPlan(planId, input, { tenantId: context?.tenant?.tenant.id }),
          completePlan: (planId, options, context) =>
            this.completeReasoningPlan(planId, options, { tenantId: context?.tenant?.tenant.id }),
          getPlan: (planId, context) =>
            this.resumeReasoningPlan(planId, { tenantId: context?.tenant?.tenant.id }),
          listPlans: (limit, context) =>
            this.listReasoningPlans(limit, { tenantId: context?.tenant?.tenant.id }),
          listTenants: (limit) => this.tenantManager.listTenants(limit),
          createTenant: (input) => this.tenantManager.createTenant(input),
          getTenant: (tenantId) => this.tenantManager.getTenant(tenantId),
          getTenantPolicy: (tenantId) => this.tenantManager.getPolicy(tenantId),
          getTenantQuota: (tenantId) => this.tenantManager.getQuota(tenantId),
          upsertTenantPolicy: (policy) => this.tenantManager.upsertPolicy(policy),
          getDefaultTenantQuota: () => this.tenantManager.getDefaultQuota(),
          resolveTenant: (headers) => this.tenantResolver.fromHeaders(headers),
          authorizeRequest: (headers, resource, action) => this.authorizeApiRequest(headers, resource, action)
        },
        this.logger
      );
    }

    const host = apiConfig?.host ?? '0.0.0.0';
    const port = apiConfig?.port ?? 4242;
    const cors = apiConfig?.cors;

    try {
      await this.apiServer.start({ host, port, cors });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        this.logger.warn('system', 'API port in use; retrying with ephemeral port', { host, port });
        await this.apiServer.start({ host, port: 0, cors });
      } else {
        throw error;
      }
    }
  }

  private shouldRequireConsensusForPrompt(prompt: string): boolean {
    const lower = prompt.toLowerCase();
    const riskSignals = [
      'deploy',
      'production',
      'migrate',
      'rollback',
      'disaster',
      'hotfix'
    ];
    const releaseRiskPatterns = [
      /release to production/, // capture coordinated release cutovers
      /production release/, // highlight language upgrades targeting prod
      /release management window/ // guard controlled release operations
    ];
    const governanceSignals = ['consensus', 'approval', 'quorum', 'vote', 'gate'];
    return (
      riskSignals.some((signal) => lower.includes(signal)) ||
      releaseRiskPatterns.some((pattern) => pattern.test(lower)) ||
      governanceSignals.some((signal) => lower.includes(signal))
    );
  }

  private waitForConsensusDecision(proposalId: string, timeoutMs = 15_000): Promise<{ accepted: boolean; votes: number; timedOut: boolean }>
  {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.off('consensusReached', handler);
        resolve({ accepted: false, votes: 0, timedOut: true });
      }, timeoutMs);

      const handler = (event: any) => {
        if (event?.proposal?.id !== proposalId) {
          return;
        }
        clearTimeout(timeout);
        this.off('consensusReached', handler);
        resolve({
          accepted: Boolean(event?.accepted),
          votes: Array.isArray(event?.votes) ? event.votes.length : 0,
          timedOut: false
        });
      };

      this.on('consensusReached', handler);
    });
  }

  private async authorizeApiRequest(headers: IncomingHttpHeaders, resource: string, action: string): Promise<void> {
    const rawHeader = headers?.authorization;
    const headerValue = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const token = typeof headerValue === 'string'
      ? headerValue.toLowerCase().startsWith('bearer ')
        ? headerValue.slice(7).trim()
        : headerValue.trim()
      : undefined;
    await this.authMiddleware.authenticateAndAuthorize(token, resource, action);
  }

  private async refreshTenancyResources(enable: boolean): Promise<void> {
    if (this.tenancyEnabled === enable) {
      return;
    }
    if (this.memorySystem) {
      try {
        await this.memorySystem.close();
      } catch (error) {
        this.logger.warn('system', 'Failed to close memory system during tenancy reinitialization', undefined, error as Error);
      }
    }
    this.initializeTenancyResources(enable);
  }

  private initializeTenancyResources(enable: boolean): void {
    this.tenancyEnabled = enable;
    this.memorySystem = new CodexMemorySystem(process.cwd(), { enableTenancy: enable });
    this.toolOptimizer = new ToolOptimizer(this.memorySystem);
    this.reasoningPlanner = new ReasoningPlanner({
      memory: this.memorySystem,
      proposeConsensus: async (data) => this.proposeConsensus('reasoning_plan', data),
      logger: this.logger
    });
    this.tenantManager = new TenantManager({
      memory: this.memorySystem,
      logger: this.logger,
      options: {
        enableTenancy: enable,
        defaultQuota: this.config?.tenancy?.defaultQuota
      },
      resourceManager: this.resourceManager
    });
    this.tenantResolver = new TenantResolver(this.tenantManager, this.logger);
  }

  private resolveTenancySetting(): boolean {
    if (this.config && typeof this.config.tenancy?.enabled === 'boolean') {
      return this.config.tenancy.enabled;
    }
    return this.tenancyEnabled;
  }

  private isTenancyEnvEnabled(): boolean {
    const flag = process.env.CODEX_TENANCY_ENABLED;
    if (!flag) {
      return false;
    }
    const normalized = flag.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }

  private async bootstrapDefaultAgents(): Promise<void> {
    const defaults: Array<{ type: AgentType; count: number }> = [
      { type: AgentType.CODE_WORKER, count: 2 },
      { type: AgentType.DATA_WORKER, count: 1 },
      { type: AgentType.VALIDATION_WORKER, count: 1 },
      { type: AgentType.RESEARCH_WORKER, count: 1 },
      { type: AgentType.ANALYST_WORKER, count: 1 },
      { type: AgentType.ARCHITECT_WORKER, count: 1 },
      { type: AgentType.KNOWLEDGE_WORKER, count: 1 },
      { type: AgentType.SWARM_COORDINATOR, count: 1 },
      { type: AgentType.TOPOLOGY_COORDINATOR, count: 1 },
      // Voting agents for RAFT consensus quorum (deploy 4 voting agents total: 2 consensus, 1 review, 1 planning)
      // With minVotes=2 and quorumFactor=0.4, this ensures reliable quorum even with 1 agent failure
      { type: AgentType.CONSENSUS_COORDINATOR, count: 2 },
      { type: AgentType.REVIEW_WORKER, count: 1 },
      { type: AgentType.PLANNING_WORKER, count: 1 },
      { type: AgentType.MCP_BRIDGE, count: 1 },
      { type: AgentType.A2A_BRIDGE, count: 1 }
    ];

    for (const entry of defaults) {
      const existing = this.agentRegistry.getAgentCountByType(entry.type);
      const missing = Math.max(entry.count - existing, 0);
      if (missing > 0) {
        await this.deployAgent(entry.type, missing);
      }
    }
  }

  private createAgentInstance(type: AgentType): Agent {
    switch (type) {
      case AgentType.CODE_WORKER:
        return new CodeWorker();
      case AgentType.DATA_WORKER:
        return new DataWorker();
      case AgentType.VALIDATION_WORKER:
        return new ValidationWorker();
      case AgentType.RESEARCH_WORKER:
        return new ResearchWorker();
      case AgentType.ARCHITECT_WORKER:
        return new ArchitectWorker();
      case AgentType.KNOWLEDGE_WORKER:
        return new KnowledgeWorker();
      case AgentType.ANALYST_WORKER:
        return new AnalystWorker();
      case AgentType.SECURITY_WORKER:
        return new SecurityWorker();
      case AgentType.OPS_WORKER:
        return new OpsWorker();
      case AgentType.PERFORMANCE_WORKER:
        return new PerformanceWorker();
      case AgentType.INTEGRATION_WORKER:
        return new IntegrationWorker();
      case AgentType.SIMULATION_WORKER:
        return new SimulationWorker();
      case AgentType.MEMORY_WORKER:
        return new MemoryWorker();
      case AgentType.PLANNING_WORKER:
        return new PlanningWorker();
      case AgentType.REVIEW_WORKER:
        return new ReviewWorker();
      case AgentType.COMMUNICATION_WORKER:
        return new CommunicationWorker();
      case AgentType.AUTOMATION_WORKER:
        return new AutomationWorker();
      case AgentType.OBSERVABILITY_WORKER:
        return new ObservabilityWorker();
      case AgentType.COMPLIANCE_WORKER:
        return new ComplianceWorker();
      case AgentType.RELIABILITY_WORKER:
        return new ReliabilityWorker();
      case AgentType.SWARM_COORDINATOR:
        return new SwarmCoordinatorAgent();
      case AgentType.TOPOLOGY_COORDINATOR:
        return new TopologyCoordinator();
      case AgentType.CONSENSUS_COORDINATOR:
        return new ConsensusCoordinator();
      case AgentType.MCP_BRIDGE:
        return new MCPBridgeAgent(this.mcpBridge);
      case AgentType.A2A_BRIDGE:
        return new A2ABridgeAgent(this.a2aBridge, this.agentRegistry);
      default:
        throw new Error(`Unsupported agent type: ${type}`);
    }
  }

  private async handleTaskAssignment(agentId: AgentId, task: Task): Promise<void> {
    const agent = this.agentRegistry.getAgentInstance(agentId);
    if (!agent) {
      throw new Error(`Agent instance not found for ${agentId.id}`);
    }

    this.agentRegistry.updateAgentStatus(agentId, AgentStatus.RUNNING);

    try {
      const result = await agent.executeTask(task);
      this.taskScheduler.completeTask(task.id, result);
    } catch (error) {
      this.taskScheduler.failTask(task.id, (error as Error).message || 'Agent execution failed');
      throw error;
    }
  }

  private waitForTaskResult(taskId: string): Promise<any> {
    const timeoutMs = this.config?.system.taskTimeout ?? 300000;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.taskPromises.has(taskId)) {
          this.taskPromises.delete(taskId);
          const err = new Error(`Task ${taskId} timed out after ${timeoutMs}ms`);
          this.taskScheduler.failTask(taskId, err.message);
          reject(err);
        }
      }, timeoutMs);

      this.taskPromises.set(taskId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timeout
      });
    });
  }

  private resolveTaskPromise(taskId: string, result: any): void {
    const tracker = this.taskPromises.get(taskId);
    if (!tracker) return;
    if (tracker.timeout) {
      clearTimeout(tracker.timeout);
    }
    tracker.resolve(result);
    this.taskPromises.delete(taskId);
  }

  private rejectTaskPromise(taskId: string, reason: any): void {
    const tracker = this.taskPromises.get(taskId);
    if (!tracker) return;
    if (tracker.timeout) {
      clearTimeout(tracker.timeout);
    }
    const error = reason instanceof Error ? reason : new Error(String(reason));
    tracker.reject(error);
    this.taskPromises.delete(taskId);
  }

  private clearTaskPromises(): void {
    for (const tracker of this.taskPromises.values()) {
      if (tracker.timeout) {
        clearTimeout(tracker.timeout);
      }
      tracker.reject(new Error('System shutting down'));
    }
    this.taskPromises.clear();
  }

  private buildWorkflow(prompt: string): WorkflowStage[] {
    const stages: WorkflowStage[] = [];

    // Analyze prompt requirements
    const reqs = analyzePromptRequirements(prompt);

    if (reqs.requiresResearch) {
      stages.push({
        id: 'research-scan',
        label: 'Knowledge Reconnaissance',
        taskType: 'research_scan',
        requiredCapabilities: ['conduct_research'],
        priority: 12,
        payloadBuilder: (ctx) => ({
          prompt: ctx.prompt,
          focusAreas: reqs.mentionsDocs ? ['documentation', 'agents'] : [],
          context: ctx.stageResults['data-analysis']?.result ?? null
        })
      });
    }

    if (reqs.requiresDataAnalysis) {
      stages.push({
        id: 'data-analysis',
        label: 'Requirement Analysis',
        taskType: 'data_analysis',
        requiredCapabilities: ['analyze_data'],
        priority: 10,
        payloadBuilder: (ctx) => ({
          data: ctx.prompt.split(/[\.;\n]/).map((item) => item.trim()).filter(Boolean),
          objective: 'Extract actionable insights and requirements'
        })
      });
    }

    if (reqs.wantsReAct) {
      stages.push({
        id: 'react-plan',
        label: 'ReAcT Plan Synthesis',
        taskType: 'react_plan',
        requiredCapabilities: ['react_plan'],
        priority: 9,
        payloadBuilder: (ctx) => ({
          prompt: ctx.prompt,
          analysis: ctx.stageResults['data-analysis']?.result ?? null,
          objective: 'Construct a Reasoning + Action + Test loop aligned with ReAcT best practices'
        })
      });
    }

    if (reqs.requiresArchitecture) {
      stages.push({
        id: 'architecture-blueprint',
        label: 'Architecture Blueprint',
        taskType: 'architecture_plan',
        requiredCapabilities: ['design_architecture'],
        priority: 8,
        payloadBuilder: (ctx) => ({
          prompt: ctx.prompt,
          requirements: ctx.stageResults['react-plan']?.result?.actions ?? [],
          constraints: ctx.stageResults['data-analysis']?.result?.insights ?? []
        })
      });
    }

    if (reqs.requiresCode) {
      stages.push({
        id: 'code-generation',
        label: 'Code Generation',
        taskType: 'code_generation',
        requiredCapabilities: ['generate_code'],
        priority: 8,
        payloadBuilder: (ctx) => ({
          description: ctx.prompt,
          language: 'typescript'
        })
      });

      stages.push({
        id: 'code-lint',
        label: 'Code Quality Pass',
        taskType: 'code_lint',
        requiredCapabilities: ['lint_code'],
        priority: 6,
        payloadBuilder: (ctx) => ({
          code: ctx.stageResults['code-generation']?.result?.generatedCode || ''
        })
      });
    }

    if (reqs.requiresCode || reqs.requiresTesting) {
      stages.push({
        id: 'validation',
        label: reqs.requiresCode ? 'Validation & Quality Gate' : 'Validation Strategy',
        taskType: 'validate_code',
        requiredCapabilities: ['validate_code'],
        priority: 5,
        payloadBuilder: (ctx) => ({
          code: ctx.stageResults['code-generation']?.result?.generatedCode || '',
          context: ctx.prompt,
          rules: ['no-console', 'prefer-async', 'document-public-apis']
        })
      });
    }

    if (reqs.requiresKnowledge) {
      stages.push({
        id: 'knowledge-distillation',
        label: 'Knowledge Distillation',
        taskType: 'knowledge_distillation',
        requiredCapabilities: ['synthesize_knowledge'],
        priority: 4,
        payloadBuilder: (ctx) => ({
          totPlan: ctx.stageResults['react-plan']?.result?.tot ?? null,
          research: ctx.stageResults['research-scan']?.result ?? null,
          architecture: ctx.stageResults['architecture-blueprint']?.result ?? null
        })
      });
    }

    stages.push({
      id: 'insight-summary',
      label: 'Insight Synthesis',
      taskType: 'data_summary',
      requiredCapabilities: ['summarize_data'],
      priority: 4,
      payloadBuilder: (ctx) => ({
        data: {
          prompt: ctx.prompt,
          research: ctx.stageResults['research-scan']?.result ?? null,
          analysis: ctx.stageResults['data-analysis']?.result ?? null,
          reactPlan: ctx.stageResults['react-plan']?.result ?? null,
          architecture: ctx.stageResults['architecture-blueprint']?.result ?? null,
          code: ctx.stageResults['code-generation']?.result ?? null,
          validation: ctx.stageResults['validation']?.result ?? null,
          knowledge: ctx.stageResults['knowledge-distillation']?.result ?? null
        },
        objective: 'Produce executive summary'
      })
    });

    if (this.shouldAppendOpenAISynthesisStage()) {
      stages.push({
        id: 'openai-synthesis',
        label: 'OpenAI Synthesis',
        taskType: 'openai_responses',
        requiredCapabilities: [],
        priority: 3,
        payloadBuilder: (ctx) => this.buildOpenAISynthesisPayload(ctx)
      });
    }

    if (stages.length === 0) {
      stages.push({
        id: 'baseline-analysis',
        label: 'Baseline Analysis',
        taskType: 'data_analysis',
        requiredCapabilities: ['analyze_data'],
        priority: 5,
        payloadBuilder: (ctx) => ({
          data: ctx.prompt,
          objective: 'General understanding'
        })
      });
    }

    return stages;
  }

  private buildWorkflowOutcome(
    prompt: string,
    context: WorkflowContext,
    stageOutputs: Array<{ stage: string; taskId: string; result: any }>
  ): any {
    // Extract artifacts from stage results
    const artifacts = extractWorkflowArtifacts(context.stageResults);

    // Build summary and extract final answer
    const summary = buildWorkflowSummary(artifacts);
    const finalAnswer = extractFinalAnswer(artifacts.openaiSynthesis);

    return {
      prompt,
      summary,
      finalAnswer,
      stages: stageOutputs,
      artifacts,
      mesh: this.neuralMesh.getStatus(),
      swarm: this.swarmCoordinator.getStatus(),
      consensus: this.consensusManager.getStatus()
    };
  }

  private async persistKnowledgeVectors(knowledge: any): Promise<void> {
    if (!knowledge || !Array.isArray(knowledge.knowledgeUpdates) || !this.vectorClient) {
      return;
    }
    const vectorConfig = this.configManager.getVectorConfig();
    if (!vectorConfig?.enabled) {
      return;
    }
    const updates = knowledge.knowledgeUpdates.filter((item: string) => typeof item === 'string' && item.trim());
    if (!updates.length) {
      return;
    }
    const records = updates.map((item: string, index: number) => buildVectorRecordFromText(`knowledge-${Date.now()}-${index}`, item, { source: 'knowledge_worker' }, vectorConfig.dimensions));
    await this.vectorClient.upsert(vectorConfig.collection, records);
  }

  private async persistWorkflowArtifacts(prompt: string, outcome: any, context: { tenantId?: string } = {}): Promise<void> {
    try {
      const reactPlan = outcome?.artifacts?.reactPlan;
      const tot = reactPlan?.tot;
      if (tot) {
        const entryId = await this.memorySystem.store('tot_runs', tot.bestBranch.id, {
          prompt,
          summary: tot.summary,
          bestBranch: {
            label: tot.bestBranch.label,
            focus: tot.bestBranch.focus,
            score: tot.bestBranch.score,
            confidence: tot.bestBranch.confidence
          },
          backlog: tot.priorityBacklog,
          verificationSuite: tot.verificationSuite,
          knowledgeUpdates: tot.knowledgeUpdates,
          monteCarlo: tot.monteCarlo,
          storedAt: new Date().toISOString()
        }, { tenantId: context.tenantId });
        await this.queueTotFollowUps(tot, entryId, context);
      }
    } catch (error) {
      const err = error as Error;
      this.logger.warn('system', 'Failed to persist workflow artifacts', { reason: err.message });
    }
  }

  private async handleConsensusTelemetry(payload: any): Promise<void> {
    try {
      const key = payload?.proposal?.id ?? `consensus-${Date.now()}`;
      const tenantId = payload?.proposal?.metadata?.tenantId ?? undefined;
      await this.memorySystem.store('consensus_events', key, {
        ...payload,
        tenantId,
        storedAt: new Date().toISOString()
      }, tenantId ? { tenantId } : undefined);
    } catch (error) {
      throw error;
    }
  }

  private async handleScaleUp(payload: { currentAgents: number; recommendedAgents: number; reason: string; utilization: number }): Promise<void> {
    const increment = payload.recommendedAgents - payload.currentAgents;
    if (increment <= 0) {
      return;
    }
    this.logger.info('system', 'Autoscaler scale-up recommendation accepted', payload);
    await this.deployBalancedWorkers(increment);
    this.resourceManager.updateAgentCount(this.agentRegistry.getAgentCount());
    await this.memorySystem.store('autoscaler_events', `scale-up-${Date.now()}`, {
      ...payload,
      appliedIncrement: increment,
      storedAt: new Date().toISOString()
    }).catch(() => {});
  }

  private handleScaleDown(payload: { currentAgents: number; recommendedAgents: number; reason: string; utilization: number }): void {
    const reduction = payload.currentAgents - payload.recommendedAgents;
    if (reduction <= 0) {
      return;
    }
    const removed = this.retireIdleWorkers(reduction);
    if (removed < reduction) {
      this.logger.warn('system', 'Unable to retire requested number of agents during scale down', {
        requested: reduction,
        removed
      });
    } else {
      this.logger.info('system', 'Autoscaler scale-down applied', { removed });
    }
    this.resourceManager.updateAgentCount(this.agentRegistry.getAgentCount());
    this.memorySystem.store('autoscaler_events', `scale-down-${Date.now()}`, {
      ...payload,
      appliedReduction: removed,
      storedAt: new Date().toISOString()
    }).catch(() => {});
  }

  private async deployBalancedWorkers(count: number): Promise<void> {
    if (count <= 0) return;
    const workerRotation: AgentType[] = [
      AgentType.RESEARCH_WORKER,
      AgentType.ARCHITECT_WORKER,
      AgentType.ANALYST_WORKER,
      AgentType.SECURITY_WORKER,
      AgentType.CODE_WORKER,
      AgentType.VALIDATION_WORKER,
      AgentType.KNOWLEDGE_WORKER,
      AgentType.DATA_WORKER,
      AgentType.PERFORMANCE_WORKER,
      AgentType.OBSERVABILITY_WORKER,
      AgentType.AUTOMATION_WORKER,
      AgentType.REVIEW_WORKER,
      AgentType.COMMUNICATION_WORKER,
      AgentType.MEMORY_WORKER,
      AgentType.PLANNING_WORKER,
      AgentType.RELIABILITY_WORKER,
      AgentType.OPS_WORKER,
      AgentType.INTEGRATION_WORKER,
      AgentType.SIMULATION_WORKER,
      AgentType.COMPLIANCE_WORKER
    ];

    for (let i = 0; i < count; i += 1) {
      const type = workerRotation[i % workerRotation.length];
      try {
        await this.deployAgent(type, 1);
      } catch (error) {
        this.logger.warn('system', 'Autoscaler failed to deploy agent', {
          type,
          reason: (error as Error).message
        });
      }
    }
  }

  private retireIdleWorkers(count: number): number {
    if (count <= 0) return 0;
    const candidateTypes: AgentType[] = [
      AgentType.KNOWLEDGE_WORKER,
      AgentType.COMMUNICATION_WORKER,
      AgentType.REVIEW_WORKER,
      AgentType.ANALYST_WORKER,
      AgentType.AUTOMATION_WORKER,
      AgentType.SIMULATION_WORKER,
      AgentType.PERFORMANCE_WORKER,
      AgentType.MEMORY_WORKER
    ];

    let removed = 0;
    for (const type of candidateTypes) {
      if (removed >= count) break;
      const agents = this.agentRegistry
        .getAgentsByType(type)
        .filter((agent) => agent.status === AgentStatus.IDLE);
      for (const agent of agents) {
        if (removed >= count) break;
        this.agentRegistry.unregisterAgent(agent.id);
        removed += 1;
      }
    }
    return removed;
  }

  private handleAgentStatusChange(agentId: AgentId, status: AgentStatus, oldStatus?: AgentStatus): void {
    const healingConfig = this.config?.system.selfHealing;
    if (!healingConfig?.enabled || !healingConfig.redeployOnFailure) {
      return;
    }

    if (status === AgentStatus.ERROR || status === AgentStatus.OFFLINE) {
      const cooldownMs = healingConfig.cooldownMs ?? 15000;
      const key = `${agentId.type}`;
      const now = Date.now();
      const nextAllowed = this.selfHealingCooldowns.get(key) ?? 0;
      if (nextAllowed > now) {
        return;
      }
      this.selfHealingCooldowns.set(key, now + cooldownMs);
      setTimeout(() => {
        this.deployAgent(agentId.type as AgentType, 1).catch((error) => {
          this.logger.warn('system', 'Self-healing redeploy failed', {
            agentType: agentId.type,
            reason: (error as Error).message
          });
        });
      }, cooldownMs);
    } else if (oldStatus === AgentStatus.ERROR && status === AgentStatus.IDLE) {
      this.selfHealingCooldowns.delete(agentId.type);
    }
  }

  private handleAgentUnregistered(agentId: AgentId): void {
    const healingConfig = this.config?.system.selfHealing;
    if (!healingConfig?.enabled || !healingConfig.redeployOnFailure) {
      return;
    }
    const currentAgents = this.agentRegistry.getAgentCount();
    const minAgents = this.scalingConfig?.minAgents ?? 2;
    if (currentAgents < minAgents) {
      this.deployAgent(agentId.type as AgentType, 1).catch((error) => {
        this.logger.warn('system', 'Self-healing replenish failed', {
          agentType: agentId.type,
          reason: (error as Error).message
        });
      });
    }
  }

  private async queueTotFollowUps(tot: TotPlanResult, totEntryId: number, context: { tenantId?: string } = {}): Promise<void> {
    const backlog = Array.isArray(tot.priorityBacklog) ? tot.priorityBacklog.slice(0, 3) : [];
    if (!backlog.length) {
      return;
    }

    for (let index = 0; index < backlog.length; index += 1) {
      const item = backlog[index];
      try {
        await this.memorySystem.store('tot_followups', `${tot.bestBranch.id}#${index + 1}`, {
          totEntryId,
          backlogIndex: index + 1,
          item,
          summary: tot.summary,
          createdAt: new Date().toISOString()
        }, { tenantId: context.tenantId });
      } catch (error) {
        const err = error as Error;
        this.logger.warn('system', 'Failed to enqueue ToT follow-up task', {
          reason: err.message,
          item
        });
      }
    }

    try {
      const consensusAgents = this.agentRegistry.getAgentsByType(AgentType.CONSENSUS_COORDINATOR);
      if (!consensusAgents.length) {
        this.logger.warn('system', 'No consensus coordinators available to propose ToT follow-up.');
        return;
      }

      const proposalId = this.consensusManager.proposeConsensus(
        'tot_backlog_followup',
        {
          totEntryId,
          bestBranch: tot.bestBranch,
          backlogItem: backlog[0],
          createdAt: new Date().toISOString()
        },
        consensusAgents[0].id
      );

      this.logger.info('system', 'ToT backlog follow-up consensus proposed', {
        proposalId,
        backlogItem: backlog[0]
      });
    } catch (error) {
      const err = error as Error;
      this.logger.warn('system', 'Failed to propose ToT backlog consensus', { reason: err.message });
    }
  }

  private async applyConfiguredTenancyDefaults(): Promise<void> {
    if (!this.tenantManager) {
      return;
    }
    const defaultQuota = this.config?.tenancy?.defaultQuota;
    if (!defaultQuota && !this.tenantManager.getDefaultQuota()) {
      return;
    }
    await this.tenantManager.configureDefaultQuota(defaultQuota);
  }
}
