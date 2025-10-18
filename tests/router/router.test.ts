import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { 
  RoutingPolicyService,
  type RoutingRequest,
  type RoutingRule 
} from '../../src/router/index.js';
import { AgentType } from '../../src/core/types.js';
import { CodexMemorySystem } from '../../src/memory/memory-system.js';
import { ToolOptimizer } from '../../src/tools/optimizer/index.js';

describe('RoutingPolicyService', () => {
  let tempDir: string;
  let router: RoutingPolicyService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(join(tmpdir(), 'router-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('initializes with default routing rules', () => {
    router = new RoutingPolicyService(tempDir);
    const rules = router.getAllRules();
    
    expect(rules).toHaveLength(3);
    expect(rules.map(r => r.name)).toContain('Code Implementation');
    expect(rules.map(r => r.name)).toContain('Data Processing');
    expect(rules.map(r => r.name)).toContain('Validation and Testing');
  });

  it('evaluates code implementation requests correctly', async () => {
    router = new RoutingPolicyService(tempDir);
    
    const request: RoutingRequest = {
      prompt: 'implement a new authentication function for user login'
    };
    
    const evaluation = await router.evaluateRouting(request);
    
    expect(evaluation.agentType).toBe(AgentType.CODE_WORKER);
    expect(evaluation.confidence).toBe(0.9);
    expect(evaluation.reasoning).toContain('Code Implementation');
    expect(evaluation.metadata.evaluationId).toBeDefined();
    expect(evaluation.metadata.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('evaluates data processing requests correctly', async () => {
    router = new RoutingPolicyService(tempDir);
    
    const request: RoutingRequest = {
      prompt: 'analyze the customer data and process it for insights'
    };
    
    const evaluation = await router.evaluateRouting(request);
    
    expect(evaluation.agentType).toBe(AgentType.DATA_WORKER);
    expect(evaluation.confidence).toBe(0.85);
    expect(evaluation.reasoning).toContain('Data Processing');
  });

  it('evaluates validation requests correctly', async () => {
    router = new RoutingPolicyService(tempDir);
    
    const request: RoutingRequest = {
      prompt: 'validate the input parameters and test the API endpoints'
    };
    
    const evaluation = await router.evaluateRouting(request);
    
    expect(evaluation.agentType).toBe(AgentType.VALIDATION_WORKER);
    expect(evaluation.confidence).toBe(0.85);
    expect(evaluation.reasoning).toContain('Validation and Testing');
  });

  it('falls back to default routing for unmatched requests', async () => {
    router = new RoutingPolicyService(tempDir);
    
    const request: RoutingRequest = {
      prompt: 'write a haiku about distributed systems'
    };
    
    const evaluation = await router.evaluateRouting(request);
    
    expect(evaluation.agentType).toBe(AgentType.CODE_WORKER);
    expect(evaluation.confidence).toBe(0.6); // Default confidence
    expect(evaluation.reasoning).toContain('Default routing');
  });

  it('handles multiple matching rules by precedence', async () => {
    router = new RoutingPolicyService(tempDir);
    
    // Add a higher precedence rule that also matches code keywords
    const customRule: Omit<RoutingRule, 'metadata'> = {
      id: 'custom-code-rule',
      name: 'Custom Code Rule',
      description: 'Higher precedence code rule',
      precedence: 150,
      conditions: {
        keywords: ['implement', 'function']
      },
      target: AgentType.VALIDATION_WORKER,
      confidence: 0.95
    };
    
    await router.addRule(customRule);
    
    const request: RoutingRequest = {
      prompt: 'implement a function to validate user input'
    };
    
    const evaluation = await router.evaluateRouting(request);
    
    // Should use the higher precedence rule
    expect(evaluation.agentType).toBe(AgentType.VALIDATION_WORKER);
    expect(evaluation.confidence).toBe(0.95);
    expect(evaluation.reasoning).toContain('Custom Code Rule');
  });

  it('enriches evaluation with tool recommendations when optimizer configured', async () => {
    const memoryBase = join(tempDir, 'workspace');
    fs.mkdirSync(memoryBase, { recursive: true });
    const memory = new CodexMemorySystem(memoryBase);
    const optimizer = new ToolOptimizer(memory);

    try {
      await optimizer.recordToolOutcome({
        toolId: 'code-generator',
        agentType: AgentType.CODE_WORKER,
        success: true,
        latencyMs: 150
      });

      router = new RoutingPolicyService(tempDir, { toolOptimizer: optimizer });

      const request: RoutingRequest = {
        prompt: 'implement a new service endpoint',
        toolCandidates: [
          { id: 'code-generator', agentType: AgentType.CODE_WORKER }
        ]
      };

      const evaluation = await router.evaluateRouting(request);

      expect(evaluation.toolRecommendations).toBeDefined();
      expect(evaluation.toolRecommendations?.[0]?.toolId).toBe('code-generator');
    } finally {
      await memory.close();
    }
  });

  it('adds and manages routing rules', async () => {
    router = new RoutingPolicyService(tempDir);
    
    const newRule: Omit<RoutingRule, 'metadata'> = {
      id: 'test-rule',
      name: 'Test Rule',
      description: 'A test routing rule',
      precedence: 50,
      conditions: {
        keywords: ['test-keyword'],
        patterns: ['test.*pattern']
      },
      target: AgentType.SWARM_COORDINATOR,
      confidence: 0.7
    };
    
    const addedRule = await router.addRule(newRule);
    expect(addedRule.id).toBe('test-rule');
    expect(addedRule.metadata.created).toBeInstanceOf(Date);
    expect(addedRule.metadata.enabled).toBe(true);
    
    const retrievedRule = router.getRule('test-rule');
    expect(retrievedRule).toBeDefined();
    expect(retrievedRule!.name).toBe('Test Rule');
    
    const allRules = router.getAllRules();
    expect(allRules).toHaveLength(4); // 3 default + 1 new
  });

  it('updates existing routing rules', async () => {
    router = new RoutingPolicyService(tempDir);
    
    const rule = router.getRule('code-implementation');
    expect(rule).toBeDefined();
    
    // Add a small delay to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const updatedRule = await router.updateRule('code-implementation', {
      confidence: 0.95,
      description: 'Updated description'
    });
    
    expect(updatedRule).toBeDefined();
    expect(updatedRule!.confidence).toBe(0.95);
    expect(updatedRule!.description).toBe('Updated description');
    expect(updatedRule!.metadata.lastModified.getTime()).toBeGreaterThanOrEqual(
      updatedRule!.metadata.created.getTime()
    );
  });

  it('deletes routing rules', async () => {
    router = new RoutingPolicyService(tempDir);
    
    const deleted = await router.deleteRule('code-implementation');
    expect(deleted).toBe(true);
    
    const rule = router.getRule('code-implementation');
    expect(rule).toBeNull();
    
    const allRules = router.getAllRules();
    expect(allRules).toHaveLength(2); // 2 remaining default rules
  });

  it('handles pattern matching in routing rules', async () => {
    router = new RoutingPolicyService(tempDir);
    
    // Add rule with regex pattern
    const patternRule: Omit<RoutingRule, 'metadata'> = {
      id: 'pattern-rule',
      name: 'Pattern Rule',
      description: 'Rule that matches regex patterns',
      precedence: 120,
      conditions: {
        patterns: ['create\\s+.*\\s+database', 'setup\\s+.*\\s+server']
      },
      target: AgentType.SWARM_COORDINATOR,
      confidence: 0.88
    };
    
    await router.addRule(patternRule);
    
    const request: RoutingRequest = {
      prompt: 'create a new database schema for the application'
    };
    
    const evaluation = await router.evaluateRouting(request);
    
    expect(evaluation.agentType).toBe(AgentType.SWARM_COORDINATOR);
    expect(evaluation.confidence).toBe(0.88);
    expect(evaluation.reasoning).toContain('Pattern Rule');
  });

  it('respects context length constraints', async () => {
    router = new RoutingPolicyService(tempDir);
    
    // Add rule that only matches short prompts
    const shortRule: Omit<RoutingRule, 'metadata'> = {
      id: 'short-prompt-rule',
      name: 'Short Prompt Rule',
      description: 'Rule for short prompts only',
      precedence: 110,
      conditions: {
        keywords: ['code'],
        contextLength: { max: 20 }
      },
      target: AgentType.CONSENSUS_COORDINATOR,
      confidence: 0.9
    };
    
    await router.addRule(shortRule);
    
    // Short prompt should match the new rule
    const shortRequest: RoutingRequest = {
      prompt: 'code fix'
    };
    
    const shortEvaluation = await router.evaluateRouting(shortRequest);
    expect(shortEvaluation.agentType).toBe(AgentType.CONSENSUS_COORDINATOR);
    
    // Long prompt should not match the short rule and fall back to default code rule
    const longRequest: RoutingRequest = {
      prompt: 'implement a comprehensive code solution for the complex authentication system'
    };
    
    const longEvaluation = await router.evaluateRouting(longRequest);
    expect(longEvaluation.agentType).toBe(AgentType.CODE_WORKER); // Default code rule
  });

  it('handles disabled rules correctly', async () => {
    router = new RoutingPolicyService(tempDir);
    
    // First, let's verify the rule is working normally
    const testRequest: RoutingRequest = {
      prompt: 'implement a new authentication function'
    };
    
    const beforeDisabling = await router.evaluateRouting(testRequest);
    expect(beforeDisabling.reasoning).toContain('Code Implementation');
    
    // Now disable the code implementation rule
    const rule = router.getRule('code-implementation');
    expect(rule).toBeDefined();
    
    await router.updateRule('code-implementation', {
      metadata: {
        ...rule!.metadata,
        enabled: false
      }
    });
    
    // Verify the rule is disabled
    const disabledRule = router.getRule('code-implementation');
    expect(disabledRule!.metadata.enabled).toBe(false);
    
    const evaluation = await router.evaluateRouting(testRequest);
    
    // Should not match the disabled rule, fall back to default routing
    expect(evaluation.agentType).toBe(AgentType.CODE_WORKER);
    expect(evaluation.reasoning).toContain('Code-related keywords detected');
  });

  it('persists and loads rules correctly', async () => {
    // Create first router instance
    router = new RoutingPolicyService(tempDir);
    
    const customRule: Omit<RoutingRule, 'metadata'> = {
      id: 'persistent-rule',
      name: 'Persistent Rule',
      description: 'Rule that should persist',
      precedence: 60,
      conditions: {
        keywords: ['persist']
      },
      target: AgentType.TOPOLOGY_COORDINATOR,
      confidence: 0.75
    };
    
    await router.addRule(customRule);
    
    // Create second router instance (should load from file)
    const router2 = new RoutingPolicyService(tempDir);
    const loadedRule = router2.getRule('persistent-rule');
    
    expect(loadedRule).toBeDefined();
    expect(loadedRule!.name).toBe('Persistent Rule');
    expect(loadedRule!.target).toBe(AgentType.TOPOLOGY_COORDINATOR);
    expect(loadedRule!.metadata.created).toBeInstanceOf(Date);
  });

  it('tracks evaluation history', async () => {
    router = new RoutingPolicyService(tempDir);
    
    const request1: RoutingRequest = {
      prompt: 'implement function A'
    };
    
    const request2: RoutingRequest = {
      prompt: 'analyze data B'
    };
    
    const eval1 = await router.evaluateRouting(request1);
    const eval2 = await router.evaluateRouting(request2);
    
    const history = router.getEvaluationHistory(10);
    expect(history).toHaveLength(2);
    
    // Check that both evaluations are in the history
    const historyIds = history.map(h => h.metadata.evaluationId);
    expect(historyIds).toContain(eval1.metadata.evaluationId);
    expect(historyIds).toContain(eval2.metadata.evaluationId);
    
    // Check that we have the right agent types
    const agentTypes = history.map(h => h.agentType);
    expect(agentTypes).toContain(AgentType.CODE_WORKER);
    expect(agentTypes).toContain(AgentType.DATA_WORKER);
  });

  it('handles routing errors gracefully', async () => {
    router = new RoutingPolicyService(tempDir);
    
    // Create a request that would cause an error in rule processing
    const request: RoutingRequest = {
      prompt: 'normal request'
    };
    
    // Mock an error by corrupting the rules
    (router as any).rules.set('bad-rule', { 
      // Incomplete rule that might cause errors
      id: 'bad-rule',
      conditions: null
    });
    
    const evaluation = await router.evaluateRouting(request);
    
    // Should still return a valid evaluation (fallback)
    expect(evaluation.agentType).toBe(AgentType.CODE_WORKER);
    expect(evaluation.confidence).toBeGreaterThan(0);
    expect(evaluation.metadata.evaluationId).toBeDefined();
  });
});
