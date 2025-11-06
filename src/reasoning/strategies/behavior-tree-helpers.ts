/**
 * Behavior tree node evaluators
 * Extracted to reduce complexity of evaluateNode function
 */

import type { StrategyStageResult } from './index.js';

export interface BehaviorTreeNode {
  type: 'sequence' | 'selector' | 'task' | 'parallel';
  children?: string[];
  evaluation?: string;
  threshold?: number;
}

/**
 * Evaluate a sequence node - all children must succeed
 */
export function evaluateSequenceNode(
  children: string[],
  evaluateChild: (nodeId: string) => boolean
): boolean {
  for (const child of children) {
    if (!evaluateChild(child)) {
      return false;
    }
  }
  return true;
}

/**
 * Evaluate a selector node - at least one child must succeed
 */
export function evaluateSelectorNode(
  children: string[],
  evaluateChild: (nodeId: string) => boolean
): boolean {
  for (const child of children) {
    if (evaluateChild(child)) {
      return true;
    }
  }
  return false;
}

/**
 * Evaluate a parallel node - threshold number of children must succeed
 */
export function evaluateParallelNode(
  children: string[],
  threshold: number,
  evaluateChild: (nodeId: string) => boolean
): boolean {
  let successes = 0;
  for (const child of children) {
    if (evaluateChild(child)) {
      successes += 1;
    }
  }
  return successes >= threshold;
}

/**
 * Evaluate a task node - execute the evaluation and record result
 */
export function evaluateTaskNode(
  nodeId: string,
  evaluationId: string | undefined,
  evaluate: (id: string) => StrategyStageResult,
  recordStage: (stage: StrategyStageResult) => void
): boolean {
  if (!evaluationId) {
    throw new Error(`Behavior tree task node "${nodeId}" missing evaluation reference.`);
  }
  const stage = evaluate(evaluationId);
  recordStage(stage);
  return stage.success;
}
