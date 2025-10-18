import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { Logger } from '../core/logger.js';
import { AgentType } from '../core/types.js';
import { ToolOptimizer, type ToolCandidate, type ToolScore } from '../tools/optimizer/index.js';

/**
 * Routing evaluation result with confidence scoring
 */
export interface RoutingEvaluation {
  agentType: AgentType;
  confidence: number;
  reasoning: string;
  alternatives: Array<{
    agentType: AgentType;
    confidence: number;
    reasoning: string;
  }>;
  metadata: {
    evaluationId: string;
    timestamp: Date;
    processingTimeMs: number;
    rulesApplied: string[];
  };
  toolRecommendations?: ToolScore[];
}

/**
 * Routing policy rule with precedence and conditions
 */
export interface RoutingRule {
  id: string;
  name: string;
  description: string;
  precedence: number;
  conditions: {
    keywords?: string[];
    patterns?: string[];
    contextLength?: { min?: number; max?: number };
    agentCapabilities?: string[];
    excludeAgents?: AgentType[];
  };
  target: AgentType;
  confidence: number;
  fallback?: AgentType;
  metadata: {
    created: Date;
    lastModified: Date;
    creator: string;
    version: string;
    enabled: boolean;
  };
}

/**
 * Request for routing evaluation
 */
export interface RoutingRequest {
  prompt: string;
  toolPrompt?: string;
  toolCandidates?: ToolCandidate[];
  context?: {
    agentDirectives?: string;
    fileContext?: string;
    userPreferences?: Record<string, any>;
  };
  constraints?: {
    excludeAgents?: AgentType[];
    preferredAgents?: AgentType[];
    maxResponseTime?: number;
  };
  metadata?: {
    sessionId?: string;
    requestId?: string;
    timestamp?: Date;
  };
}

interface RoutingPolicyServiceOptions {
  toolOptimizer?: ToolOptimizer;
}

/**
 * Persona-aligned routing policy service
 */
export class RoutingPolicyService {
  private logger = Logger.getInstance();
  private rules: Map<string, RoutingRule> = new Map();
  private configPath: string;
  private historyPath: string;
  private evaluationHistory: Map<string, RoutingEvaluation> = new Map();
  private toolOptimizer?: ToolOptimizer;

  constructor(configDir?: string, options?: RoutingPolicyServiceOptions) {
    const baseDir = configDir || path.join(process.cwd(), 'config', 'routing');
    this.configPath = path.join(baseDir, 'policies.json');
    this.historyPath = path.join(process.cwd(), 'memory', 'routing');

    this.toolOptimizer = options?.toolOptimizer;
    
    // Ensure directories exist
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.mkdirSync(this.historyPath, { recursive: true });
    
    this.loadRoutingRules();
  }

  /**
   * Evaluate routing for a given request using persona-aligned decision making
   */
  async evaluateRouting(request: RoutingRequest): Promise<RoutingEvaluation> {
    const startTime = Date.now();
    const evaluationId = createHash('md5').update(`${Date.now()}-${request.prompt}`).digest('hex');
    
    this.logger.info('router', 'Starting routing evaluation', { 
      evaluationId, 
      promptLength: request.prompt.length 
    });

    try {
      // Apply routing rules in precedence order
      const applicableRules = this.findApplicableRules(request);
      const rulesApplied = applicableRules.map(r => r.id);
      
      // If no rules match, use default routing logic
      let evaluation: RoutingEvaluation;
      if (applicableRules.length === 0) {
        evaluation = this.performDefaultRouting(request, evaluationId);
      } else {
        evaluation = this.performRuleBasedRouting(request, applicableRules, evaluationId);
      }

      // Add metadata
      evaluation.metadata = {
        evaluationId,
        timestamp: new Date(),
        processingTimeMs: Date.now() - startTime,
        rulesApplied
      };

      await this.attachToolRecommendations(request, evaluation);

      // Store evaluation history
      this.evaluationHistory.set(evaluationId, evaluation);
      await this.persistEvaluationHistory(evaluation);

      this.logger.info('router', 'Routing evaluation completed', {
        evaluationId,
        agentType: evaluation.agentType,
        confidence: evaluation.confidence,
        processingTimeMs: evaluation.metadata.processingTimeMs
      });

      return evaluation;

    } catch (error) {
      this.logger.error('router', 'Routing evaluation failed', { evaluationId, error });
      
      // Return fallback routing
      return {
        agentType: AgentType.CODE_WORKER,
        confidence: 0.1,
        reasoning: `Routing evaluation failed: ${error}. Using fallback agent.`,
        alternatives: [],
        metadata: {
          evaluationId,
          timestamp: new Date(),
          processingTimeMs: Date.now() - startTime,
          rulesApplied: []
        }
      };
    }
  }

  /**
   * Add or update a routing rule
   */
  async addRule(rule: Omit<RoutingRule, 'metadata'>): Promise<RoutingRule> {
    const fullRule: RoutingRule = {
      ...rule,
      metadata: {
        created: new Date(),
        lastModified: new Date(),
        creator: 'system',
        version: '1.0.0',
        enabled: true
      }
    };

    this.rules.set(rule.id, fullRule);
    await this.saveRoutingRules();
    
    this.logger.info('router', 'Routing rule added', { ruleId: rule.id, name: rule.name });
    return fullRule;
  }

  /**
   * Update an existing routing rule
   */
  async updateRule(ruleId: string, updates: Partial<RoutingRule>): Promise<RoutingRule | null> {
    const existingRule = this.rules.get(ruleId);
    if (!existingRule) {
      return null;
    }

    const updatedRule: RoutingRule = {
      ...existingRule,
      ...updates,
      metadata: {
        ...existingRule.metadata,
        ...(updates.metadata || {}),
        lastModified: new Date()
      }
    };

    this.rules.set(ruleId, updatedRule);
    await this.saveRoutingRules();
    
    this.logger.info('router', 'Routing rule updated', { ruleId, name: updatedRule.name });
    return updatedRule;
  }

  /**
   * Delete a routing rule
   */
  async deleteRule(ruleId: string): Promise<boolean> {
    const deleted = this.rules.delete(ruleId);
    if (deleted) {
      await this.saveRoutingRules();
      this.logger.info('router', 'Routing rule deleted', { ruleId });
    }
    return deleted;
  }

  /**
   * Get all routing rules
   */
  getAllRules(): RoutingRule[] {
    return Array.from(this.rules.values())
      .sort((a, b) => b.precedence - a.precedence); // Higher precedence first
  }

  /**
   * Get a specific routing rule
   */
  getRule(ruleId: string): RoutingRule | null {
    return this.rules.get(ruleId) || null;
  }

  /**
   * Get evaluation history
   */
  getEvaluationHistory(limit: number = 100): RoutingEvaluation[] {
    return Array.from(this.evaluationHistory.values())
      .sort((a, b) => b.metadata.timestamp.getTime() - a.metadata.timestamp.getTime())
      .slice(0, limit);
  }

  private async attachToolRecommendations(request: RoutingRequest, evaluation: RoutingEvaluation): Promise<void> {
    if (!this.toolOptimizer || !request.toolCandidates || request.toolCandidates.length === 0) {
      return;
    }

    try {
      const prompt = request.toolPrompt ?? request.prompt;
      const scores = await this.toolOptimizer.evaluateTools(prompt, request.toolCandidates);
      evaluation.toolRecommendations = scores;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('router', 'Failed to generate tool recommendations', { message });
    }
  }

  /**
   * Find applicable rules for a request
   */
  private findApplicableRules(request: RoutingRequest): RoutingRule[] {
    const applicableRules: RoutingRule[] = [];

    for (const rule of this.rules.values()) {
      if (!rule.metadata.enabled) continue;

      if (this.ruleMatches(rule, request)) {
        applicableRules.push(rule);
      }
    }

    // Sort by precedence (higher first)
    return applicableRules.sort((a, b) => b.precedence - a.precedence);
  }

  /**
   * Check if a rule matches a request
   */
  private ruleMatches(rule: RoutingRule, request: RoutingRequest): boolean {
    const conditions = rule.conditions;

    // Check keyword matches
    if (conditions.keywords && conditions.keywords.length > 0) {
      const hasKeyword = conditions.keywords.some(keyword => 
        request.prompt.toLowerCase().includes(keyword.toLowerCase())
      );
      if (!hasKeyword) return false;
    }

    // Check pattern matches (simple regex patterns)
    if (conditions.patterns && conditions.patterns.length > 0) {
      const hasPattern = conditions.patterns.some(pattern => {
        try {
          const regex = new RegExp(pattern, 'i');
          return regex.test(request.prompt);
        } catch {
          return false;
        }
      });
      if (!hasPattern) return false;
    }

    // Check context length constraints
    if (conditions.contextLength) {
      const length = request.prompt.length;
      if (conditions.contextLength.min && length < conditions.contextLength.min) return false;
      if (conditions.contextLength.max && length > conditions.contextLength.max) return false;
    }

    // Check excluded agents
    if (conditions.excludeAgents && request.constraints?.excludeAgents) {
      const hasExcluded = conditions.excludeAgents.some(agent =>
        request.constraints!.excludeAgents!.includes(agent)
      );
      if (hasExcluded) return false;
    }

    return true;
  }

  /**
   * Perform default routing when no rules match
   */
  private performDefaultRouting(request: RoutingRequest, evaluationId: string): RoutingEvaluation {
    const prompt = request.prompt.toLowerCase();
    let agentType: AgentType = AgentType.CODE_WORKER;
    let confidence = 0.6;
    let reasoning = 'Default routing based on prompt analysis';

    // Simple heuristics for default routing
    if (prompt.includes('code') || prompt.includes('implement') || prompt.includes('debug')) {
      agentType = AgentType.CODE_WORKER;
      confidence = 0.8;
      reasoning = 'Code-related keywords detected';
    } else if (prompt.includes('data') || prompt.includes('analyze') || prompt.includes('process')) {
      agentType = AgentType.DATA_WORKER;
      confidence = 0.7;
      reasoning = 'Data processing keywords detected';
    } else if (prompt.includes('test') || prompt.includes('validate') || prompt.includes('check')) {
      agentType = AgentType.VALIDATION_WORKER;
      confidence = 0.75;
      reasoning = 'Validation keywords detected';
    } else if (prompt.includes('coordinate') || prompt.includes('manage') || prompt.includes('orchestrate')) {
      agentType = AgentType.SWARM_COORDINATOR;
      confidence = 0.7;
      reasoning = 'Coordination keywords detected';
    }

    return {
      agentType,
      confidence,
      reasoning,
      alternatives: [
        {
          agentType: AgentType.CODE_WORKER,
          confidence: agentType === AgentType.CODE_WORKER ? 0 : 0.4,
          reasoning: 'General-purpose fallback'
        }
      ],
      metadata: {
        evaluationId,
        timestamp: new Date(),
        processingTimeMs: 0,
        rulesApplied: []
      }
    };
  }

  /**
   * Perform rule-based routing using the highest precedence matching rule
   */
  private performRuleBasedRouting(
    request: RoutingRequest,
    applicableRules: RoutingRule[],
    evaluationId: string
  ): RoutingEvaluation {
    const primaryRule = applicableRules[0]; // Highest precedence
    
    // Build alternatives from other matching rules
    const alternatives = applicableRules.slice(1, 4).map(rule => ({
      agentType: rule.target,
      confidence: rule.confidence * 0.8, // Reduce confidence for alternatives
      reasoning: `Alternative from rule: ${rule.name}`
    }));

    return {
      agentType: primaryRule.target,
      confidence: primaryRule.confidence,
      reasoning: `Matched rule: ${primaryRule.name} - ${primaryRule.description}`,
      alternatives,
      metadata: {
        evaluationId,
        timestamp: new Date(),
        processingTimeMs: 0,
        rulesApplied: applicableRules.map(r => r.id)
      }
    };
  }

  /**
   * Load routing rules from configuration file
   */
  private loadRoutingRules(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf8');
        const rawRules: any[] = JSON.parse(content);
        
        this.rules.clear();
        rawRules.forEach(rawRule => {
          // Parse dates that were serialized as strings
          const rule: RoutingRule = {
            ...rawRule,
            metadata: {
              ...rawRule.metadata,
              created: new Date(rawRule.metadata.created),
              lastModified: new Date(rawRule.metadata.lastModified)
            }
          };
          this.rules.set(rule.id, rule);
        });
        
        this.logger.info('router', 'Routing rules loaded', { 
          count: rawRules.length,
          path: this.configPath 
        });
      } else {
        this.initializeDefaultRules();
      }
    } catch (error) {
      this.logger.error('router', 'Failed to load routing rules', { error, path: this.configPath });
      this.initializeDefaultRules();
    }
  }

  /**
   * Save routing rules to configuration file
   */
  private async saveRoutingRules(): Promise<void> {
    try {
      const rules = Array.from(this.rules.values());
      const content = JSON.stringify(rules, null, 2);
      fs.writeFileSync(this.configPath, content, 'utf8');
      
      this.logger.info('router', 'Routing rules saved', { 
        count: rules.length,
        path: this.configPath 
      });
    } catch (error) {
      this.logger.error('router', 'Failed to save routing rules', { error, path: this.configPath });
    }
  }

  /**
   * Initialize default routing rules
   */
  private initializeDefaultRules(): void {
    const defaultRules: RoutingRule[] = [
      {
        id: 'code-implementation',
        name: 'Code Implementation',
        description: 'Route code implementation requests to code workers',
        precedence: 100,
        conditions: {
          keywords: ['implement', 'code', 'function', 'class', 'method', 'develop', 'write'],
          patterns: ['implement.*function', 'create.*class', 'write.*code']
        },
        target: AgentType.CODE_WORKER,
        confidence: 0.9,
        fallback: AgentType.VALIDATION_WORKER,
        metadata: {
          created: new Date(),
          lastModified: new Date(),
          creator: 'system',
          version: '1.0.0',
          enabled: true
        }
      },
      {
        id: 'data-processing', 
        name: 'Data Processing',
        description: 'Route data processing and analysis requests',
        precedence: 90,
        conditions: {
          keywords: ['data', 'analyze', 'process', 'transform', 'etl', 'pipeline'],
          patterns: ['analyze.*data', 'process.*dataset', 'transform.*data']
        },
        target: AgentType.DATA_WORKER,
        confidence: 0.85,
        fallback: AgentType.CODE_WORKER,
        metadata: {
          created: new Date(),
          lastModified: new Date(),
          creator: 'system',
          version: '1.0.0',
          enabled: true
        }
      },
      {
        id: 'validation-testing',
        name: 'Validation and Testing',
        description: 'Route validation and testing requests',
        precedence: 80,
        conditions: {
          keywords: ['test', 'validate', 'verify', 'check', 'audit', 'quality'],
          patterns: ['test.*code', 'validate.*input', 'verify.*output']
        },
        target: AgentType.VALIDATION_WORKER,
        confidence: 0.85,
        fallback: AgentType.CODE_WORKER,
        metadata: {
          created: new Date(),
          lastModified: new Date(),
          creator: 'system',
          version: '1.0.0',
          enabled: true
        }
      }
    ];

    defaultRules.forEach(rule => this.rules.set(rule.id, rule));
    this.saveRoutingRules();
    
    this.logger.info('router', 'Default routing rules initialized', { count: defaultRules.length });
  }

  /**
   * Persist evaluation history to storage
   */
  private async persistEvaluationHistory(evaluation: RoutingEvaluation): Promise<void> {
    try {
      const historyFile = path.join(this.historyPath, `${new Date().toISOString().split('T')[0]}.json`);
      
      let history: RoutingEvaluation[] = [];
      if (fs.existsSync(historyFile)) {
        const content = fs.readFileSync(historyFile, 'utf8');
        history = JSON.parse(content);
      }
      
      history.push(evaluation);
      
      // Keep only the last 1000 evaluations per day
      if (history.length > 1000) {
        history = history.slice(-1000);
      }
      
      fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf8');
    } catch (error) {
      this.logger.error('router', 'Failed to persist evaluation history', { 
        evaluationId: evaluation.metadata.evaluationId,
        error 
      });
    }
  }
}
