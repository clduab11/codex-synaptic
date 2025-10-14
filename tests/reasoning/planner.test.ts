import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodexMemorySystem } from '../../src/memory/memory-system';
import { ReasoningPlanner } from '../../src/reasoning/planner';

describe('ReasoningPlanner', () => {
  let tempRoot: string;
  let memory: CodexMemorySystem;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'reasoning-planner-'));
    memory = new CodexMemorySystem(tempRoot);
  });

  afterEach(async () => {
    await memory.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('creates plans and logs checkpoints with consensus gating', async () => {
    const proposals: any[] = [];
    const planner = new ReasoningPlanner({
      memory,
      proposeConsensus: async (data) => {
        proposals.push(data);
        return 'proposal-123';
      }
    });

    const result = await planner.createPlan('Evaluate mesh resilience', {
      requireConsensus: true
    });

    expect(result.consensus?.proposalId).toBe('proposal-123');
    expect(result.status).toBe('awaiting_approval');

    await planner.checkpoint(result.planId, {
      label: 'analysis',
      status: 'complete',
      summary: 'Initial analysis complete'
    });

    await planner.handleConsensusResult({
      proposal: {
        id: 'proposal-123',
        type: 'reasoning_plan',
        data: { planId: result.planId }
      },
      accepted: true
    });

    const current = await planner.resume(result.planId);
    expect(current?.status).toBe('running');
    expect(current?.checkpoints?.length).toBe(1);

    await planner.complete(result.planId, {
      status: 'completed',
      summary: 'Plan executed'
    });

    const completed = await planner.resume(result.planId);
    expect(completed?.status).toBe('completed');
  });
});
