import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CodexMemorySystem } from '../../src/memory/memory-system';
import { AgentType } from '../../src/core/types';

const tempRoot = mkdtempSync(join(tmpdir(), 'codex-memory-'));
const memory = new CodexMemorySystem(tempRoot);

describe('CodexMemorySystem', () => {

  it('stores and retrieves namespace entries', async () => {
    const entryId = await memory.store('tot_runs', 'unit-test-branch', { summary: 'Test payload' });
    expect(entryId).toBeGreaterThan(0);
    const entries = await memory.list('tot_runs', 5);

    expect(entries.length).toBeGreaterThan(0);
    const found = entries.find((entry) => entry.key === 'unit-test-branch');
    expect(found).toBeDefined();
    expect(found?.data?.summary).toBe('Test payload');
  });

  it('reports namespace statistics', async () => {
    await memory.store('tot_runs', 'unit-test-branch-2', { summary: 'Another payload' });
    const stats = await memory.stats();
    expect(stats.tot_runs).toBeGreaterThanOrEqual(2);
    expect(memory.getDatabasePath()).toContain('.codex-synaptic');
  });

  it('retrieves entries by id', async () => {
    const thirdId = await memory.store('tot_runs', 'unit-test-branch-3', { summary: 'Third payload' });
    const entry = await memory.get('tot_runs', thirdId);
    expect(entry).not.toBeNull();
    expect(entry?.data?.summary).toBe('Third payload');
  });

  it('deletes entries when storing null', async () => {
    await memory.store('cheat_aliases', 'warp', { target: 'baseline-audit' });
    await memory.store('cheat_aliases', 'warp', null);
    const entries = await memory.list('cheat_aliases', 5);
    expect(entries.find((entry) => entry.key === 'warp')).toBeUndefined();
  });

  it('records and lists tool usage telemetry', async () => {
    await memory.logToolUsage({
      toolId: 'test-tool',
      agentType: AgentType.CODE_WORKER,
      success: true,
      latencyMs: 120,
      confidence: 0.92,
      contextTags: ['unit-test']
    });

    const usage = await memory.listToolUsage(5, { toolId: 'test-tool' });
    expect(usage.length).toBeGreaterThan(0);
    expect(usage[0].toolId).toBe('test-tool');
    expect(usage[0].agentType).toBe(AgentType.CODE_WORKER);
    expect(usage[0].contextTags).toContain('unit-test');
  });

  it('records and lists reasoning runs', async () => {
    await memory.logReasoningRun({
      planId: 'plan-123',
      planType: 'react',
      prompt: 'Evaluate repository health',
      status: 'completed',
      confidence: 0.88,
      checkpoints: [
        {
          id: 'cp-1',
          label: 'analysis',
          status: 'complete',
          summary: 'Initial analysis done',
          timestamp: new Date().toISOString()
        }
      ],
      durationMs: 4200
    });

    const runs = await memory.listReasoningRuns(5, { status: 'completed' });
    expect(runs.length).toBeGreaterThan(0);
    expect(runs[0].planId).toBe('plan-123');
    expect(runs[0].status).toBe('completed');
    expect(runs[0].checkpoints?.[0]?.label).toBe('analysis');
  });
});

afterAll(async () => {
  await memory.close();
  rmSync(tempRoot, { recursive: true, force: true });
});
