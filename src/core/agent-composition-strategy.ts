/**
 * Agent Composition Strategy Pattern
 * Extracted from src/core/hive-mind.ts to enable extensibility (RF-1.3)
 *
 * Strategies determine which agents to deploy based on prompt analysis.
 * Future strategies can use embeddings, ML models, or learned patterns.
 */

import { AgentType } from './types.js';

export interface AgentComposition {
  type: AgentType;
  count: number;
}

export interface AgentCompositionStrategy {
  /**
   * Analyze a prompt and determine optimal agent composition
   * @param prompt - User prompt to analyze
   * @returns Array of agent types and their counts
   */
  analyzePrompt(prompt: string): AgentComposition[];
}

/**
 * Heuristic-based composition strategy using keyword matching
 * This is the current implementation extracted from analyzePromptForAgents
 */
export class HeuristicCompositionStrategy implements AgentCompositionStrategy {
  analyzePrompt(prompt: string): AgentComposition[] {
    const promptLower = prompt.toLowerCase();
    const composition: AgentComposition[] = [];

    // Analyze prompt for specific agent needs
    if (this.needsCodeAgents(promptLower)) {
      composition.push({ type: AgentType.CODE_WORKER, count: 3 });
    }

    if (this.needsDataAgents(promptLower)) {
      composition.push({ type: AgentType.DATA_WORKER, count: 2 });
    }

    if (this.needsValidationAgents(promptLower)) {
      composition.push({ type: AgentType.VALIDATION_WORKER, count: 1 });
    }

    // Always include coordinators for hive-mind operations
    composition.push({ type: AgentType.SWARM_COORDINATOR, count: 1 });
    composition.push({ type: AgentType.TOPOLOGY_COORDINATOR, count: 1 });

    // Always include voting agents for RAFT consensus quorum (requires minVotes=2, config default)
    // These three agent types participate in consensus voting to prevent timeout
    // Note: bootstrap deploys multiple voting agents (2 consensus, 1 review, 1 planning) for redundancy
    composition.push({ type: AgentType.CONSENSUS_COORDINATOR, count: 1 });
    composition.push({ type: AgentType.REVIEW_WORKER, count: 1 });
    composition.push({ type: AgentType.PLANNING_WORKER, count: 1 });

    // Return composition or fallback to default
    return composition.length > 2 ? composition : this.getDefaultComposition();
  }

  private needsCodeAgents(promptLower: string): boolean {
    return /\b(code|program|develop|implement|refactor|debug)\b/.test(promptLower);
  }

  private needsDataAgents(promptLower: string): boolean {
    return /\b(data|analyze|process|transform|etl)\b/.test(promptLower);
  }

  private needsValidationAgents(promptLower: string): boolean {
    return /\b(test|validate|check|verify|lint)\b/.test(promptLower);
  }

  private getDefaultComposition(): AgentComposition[] {
    return [
      { type: AgentType.CODE_WORKER, count: 2 },
      { type: AgentType.DATA_WORKER, count: 1 },
      { type: AgentType.SWARM_COORDINATOR, count: 1 },
      { type: AgentType.CONSENSUS_COORDINATOR, count: 1 },
      { type: AgentType.REVIEW_WORKER, count: 1 },
      { type: AgentType.PLANNING_WORKER, count: 1 }
    ];
  }
}

/**
 * Factory function to get the default composition strategy
 * Future: Can be extended to return different strategies based on config
 */
export function getDefaultCompositionStrategy(): AgentCompositionStrategy {
  return new HeuristicCompositionStrategy();
}

/**
 * Convenience function for backward compatibility
 * Analyzes prompt and returns agent composition using default strategy
 */
export function analyzePromptForAgents(prompt: string): AgentComposition[] {
  const strategy = getDefaultCompositionStrategy();
  return strategy.analyzePrompt(prompt);
}
