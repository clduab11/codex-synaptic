import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ToolOptimizer, type ToolCandidate } from '../../src/tools/optimizer';
import { CodexMemorySystem } from '../../src/memory/memory-system';
import { AgentType } from '../../src/core/types';

describe('ToolOptimizer', () => {
  let tempRoot: string;
  let memory: CodexMemorySystem;
  let optimizer: ToolOptimizer;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'tool-optimizer-'));
    memory = new CodexMemorySystem(tempRoot);
    optimizer = new ToolOptimizer(memory, { historyLimit: 50 });
  });

  afterEach(async () => {
    await memory.close();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('prioritises candidates aligned with prompt intent and telemetry', async () => {
    await optimizer.recordToolOutcome({
      toolId: 'code-generator',
      agentType: AgentType.CODE_WORKER,
      success: true,
      latencyMs: 180,
      confidence: 0.9
    });

    await optimizer.recordToolOutcome({
      toolId: 'data-profiler',
      agentType: AgentType.DATA_WORKER,
      success: false,
      latencyMs: 900
    });

    const candidates: ToolCandidate[] = [
      { id: 'code-generator', agentType: AgentType.CODE_WORKER },
      { id: 'data-profiler', agentType: AgentType.DATA_WORKER },
      { id: 'validation-suite', agentType: AgentType.VALIDATION_WORKER }
    ];

    const scores = await optimizer.evaluateTools(
      'Implement a new authentication module and refactor the code paths',
      candidates
    );

    expect(scores[0].toolId).toBe('code-generator');
    expect(scores[0].score).toBeGreaterThan(scores[1].score);
    expect(scores[0].reasoning.some((reason) => reason.includes('success 1/1'))).toBe(true);
  });

  it('returns empty array when no candidates provided', async () => {
    const scores = await optimizer.evaluateTools('Any prompt', []);
    expect(scores).toEqual([]);
  });
});
