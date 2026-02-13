/**
 * Helper functions for hive-mind spawn command
 * Extracted to reduce complexity in main CLI handler
 */

import chalk from 'chalk';
import type { CodexSynapticSystem } from '../core/system.js';
import type {
  CodexContext,
  CodexContextAggregationMetadata,
  CodexPromptEnvelope
} from '../types/codex-context.js';
import { HiveMindYamlFormatter } from '../utils/yaml-output.js';

/**
 * Execute GOAP workflow
 */
export async function executeGoapWorkflow(
  system: CodexSynapticSystem,
  manifest: any,
  goalId: string,
  originalPrompt: string,
  dryRun: boolean
): Promise<void> {
  console.log(
    chalk.blue(
      `🧭 Executing GOAP profile ${manifest.metadata?.name ?? manifest.id} (goal: ${goalId})`
    )
  );

  const { GoapExecutor } = await import('../reasoning/goap/executor.js');
  const executor = new GoapExecutor(system);
  const result = await executor.execute(manifest, {
    goalId,
    prompt: originalPrompt,
    dryRun
  });

  console.log(
    chalk.green(
      `✅ GOAP workflow complete — ${result.actionsCompleted}/${result.totalActions} actions executed.`
    )
  );

  if (result.artifacts.length) {
    console.log(chalk.cyan('📦 Generated artifacts:'));
    for (const artifact of result.artifacts) {
      console.log(chalk.gray(`  • ${artifact}`));
    }
  }
}

/**
 * Execute task with timeout and consensus
 */
export async function executeTaskWithConsensus(
  system: CodexSynapticSystem,
  prompt: string,
  originalPrompt: string,
  config: any,
  startTime: number,
  shouldRequireConsensus: (prompt: string, consensusMode: string) => boolean,
  orchestrateConsensus: (
    system: CodexSynapticSystem,
    prompt: string,
    outcome: any,
    consensusMode: string
  ) => Promise<any>
): Promise<{ outcome: any; consensusResult: any; totalTime: number }> {
  const outcome: any = await Promise.race([
    system.executeTask(prompt),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Hive-mind execution timeout')), config.timeout)
    )
  ]);

  let consensusResult: any = { performed: false };

  const consensusNeeded = shouldRequireConsensus(originalPrompt, config.consensus);
  
  if (consensusNeeded) {
    consensusResult = await orchestrateConsensus(
      system,
      originalPrompt,
      outcome,
      config.consensus
    );
  }

  const totalTime = Date.now() - startTime;
  return { outcome, consensusResult, totalTime };
}

/**
 * Collect and format execution results
 */
export function collectExecutionResults(
  outcome: any,
  consensusResult: any,
  totalTime: number,
  originalPrompt: string,
  system: CodexSynapticSystem,
  codexContext?: CodexContext
): any {
  const swarmStatus = system.getSwarmCoordinator().getStatus();
  const meshStatus = system.getNeuralMesh().getStatus();
  const agentRegistry = system.getAgentRegistry().getStatus();
  
  const reactPlanArtifact = outcome.artifacts?.reactPlan ?? null;
  const totPlan = reactPlanArtifact?.tot ?? null;

  return {
    executionId: `exec-${Date.now()}`,
    status: 'completed',
    duration: totalTime,
    originalPrompt,
    summary: outcome.summary,
    artifacts: outcome.artifacts || {},
    stages: outcome.stages || [],
    agentCount: agentRegistry.totalAgents,
    taskCount: outcome.stages?.length || 0,
    meshStatus: {
      nodeCount: meshStatus.nodeCount,
      connectionCount: meshStatus.connectionCount
    },
    consensusStatus: {
      performed: consensusResult.performed,
      proposalId: consensusResult.proposalId,
      accepted: consensusResult.accepted,
      votes: consensusResult.votes,
      timedOut: consensusResult.timedOut,
      error: consensusResult.error
    },
    swarmStatus: {
      algorithm: swarmStatus.algorithm,
      isOptimizing: swarmStatus.isOptimizing
    },
    totPlan,
    codexContext: codexContext ? {
      enabled: true,
      contextHash: codexContext.contextHash,
      sizeBytes: codexContext.sizeBytes
    } : { enabled: false }
  };
}

/**
 * Render execution summary
 */
export function renderExecutionSummary(
  resultData: any,
  options: { yaml?: boolean; debug?: boolean }
): void {
  if (options.yaml) {
    const { HiveMindYamlFormatter } = require('../utils/yaml-output.js');
    console.log(HiveMindYamlFormatter.formatExecutionResult(resultData));
    return;
  }

  console.log(chalk.green(`\n🎉 Hive-mind execution completed in ${resultData.duration}ms`));

  if (resultData.consensusStatus.performed) {
    const statusIcon = resultData.consensusStatus.accepted ? '✅' : '❌';
    console.log(
      chalk.cyan(
        `\n🗳️  Consensus ${statusIcon} (${resultData.consensusStatus.votes?.for ?? 0} for, ${resultData.consensusStatus.votes?.against ?? 0} against)`
      )
    );
  }

  if (resultData.summary) {
    console.log(chalk.white(`\n${resultData.summary}`));
  }

  if (resultData.artifacts && Object.keys(resultData.artifacts).length > 0) {
    console.log(chalk.cyan('\n📦 Generated Artifacts:'));
    for (const [key, artifact] of Object.entries(resultData.artifacts)) {
      if (artifact && typeof artifact === 'object' && 'summary' in artifact) {
        console.log(chalk.gray(`  ${key}: ${(artifact as any).summary}`));
      } else {
        console.log(chalk.gray(`  ${key}`));
      }
    }
  }

  if (resultData.totPlan) {
    const plan = resultData.totPlan;
    console.log(chalk.blue('\n🌳 Tree-of-Thought Plan:'));
    if (plan.bestBranch?.reasoning) {
      console.log(chalk.white(`  Reasoning: ${plan.bestBranch.reasoning}`));
    }
    if (plan.branches && Array.isArray(plan.branches)) {
      console.log(chalk.gray(`  Evaluated ${plan.branches.length} branches`));
    }
    if (plan.knowledgeUpdates && Array.isArray(plan.knowledgeUpdates)) {
      console.log(chalk.gray('  Knowledge Updates:'));
      plan.knowledgeUpdates.slice(0, 5).forEach((item: string, idx: number) => {
        console.log(chalk.gray(`    ${idx + 1}. ${item}`));
      });
    }
  }

  if (resultData.stages && Array.isArray(resultData.stages)) {
    console.log(chalk.blue('\n🔄 Stage Results:'));
    resultData.stages.forEach((stage: any, idx: number) => {
      console.log(chalk.cyan(`  ${idx + 1}. ${stage.stage} (${stage.taskId})`));
      if (stage.result?.summary) {
        console.log(chalk.gray(`     ${stage.result.summary}`));
      }
    });
  }

  console.log(chalk.blue('\n📈 System Metrics:'));
  console.log(chalk.white(`  Agents: ${resultData.agentCount} active`));
  console.log(
    chalk.white(
      `  Mesh: ${resultData.meshStatus.nodeCount} nodes, ${resultData.meshStatus.connectionCount} connections`
    )
  );
  console.log(
    chalk.white(
      `  Swarm: ${resultData.swarmStatus.algorithm}, optimizing=${resultData.swarmStatus.isOptimizing}`
    )
  );
  console.log(chalk.white(`  Execution time: ${resultData.duration}ms`));

  if (!options.debug && !options.yaml) {
    console.log(chalk.blue('\n💾 Results saved to session telemetry'));
  } else if (options.debug && !options.yaml) {
    console.log(chalk.blue('\n🔍 Full Debug Output:'));
    console.log(JSON.stringify(resultData, null, 2));
  }
}

/**
 * Setup workflow event handlers
 */
export function setupWorkflowEventHandlers(
  system: CodexSynapticSystem,
  startTime: number
): { cleanup: () => void } {
  const onStageStarted = (event: any) => {
    console.log(chalk.gray(`    ▶ ${event.label} started (${event.taskType})`));
  };
  
  const onStageCompleted = (event: any) => {
    const elapsed = Date.now() - startTime;
    console.log(chalk.green(`    ✓ ${event.label} completed (+${elapsed}ms)`));
  };
  
  const onStageFailed = (event: any) => {
    console.log(chalk.red(`    ✗ ${event.label} failed: ${event.error}`));
  };

  system.on('workflowStageStarted', onStageStarted);
  system.on('workflowStageCompleted', onStageCompleted);
  system.on('workflowStageFailed', onStageFailed);

  return {
    cleanup: () => {
      system.off('workflowStageStarted', onStageStarted);
      system.off('workflowStageCompleted', onStageCompleted);
      system.off('workflowStageFailed', onStageFailed);
    }
  };
}
